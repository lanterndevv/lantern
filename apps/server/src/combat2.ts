// Combate ampliado: retrasar/añadir/quitar, legendarias y guarida, reacción Escudo, áreas persistentes, 3D, spawn personalizado.
// La lógica vive aquí; room.ts solo la engancha. (Import circular con room.ts: solo se usan funciones en tiempo de llamada.)
import { randomUUID } from 'node:crypto';
import type { Action, ActionCard, ChatMsg, Grid, Id, Scene, Token } from '@lantern/protocol';
import { encounterXP, inArea } from '@lantern/rules';
import { pointInPolygon } from '@lantern/vision';
import { parseCharacter } from './import.ts';
import { MAX_ITEMS, inScene, obj, str } from './validate.ts';
import { fireRegion, flr, pushChat, type Ctx, type Effect, type MemberRec, type Room } from './room.ts';

type Out = Pick<Effect, 'chats' | 'sends'>;
const dmOf = (m: MemberRec) => m.role === 'dm' || m.role === 'assistant';
const fresh = () => ({ action: false, bonus: false, reaction: false, moved: 0 });
const say = (c: Ctx, text: string) => pushChat(c.room, { id: randomUUID(), from: c.from, at: c.now, text });
// Mensaje solo para DM y asistente (tirada «a ciegas»: canSee lo oculta al resto).
const dmOnly = (c: Ctx, text: string) => pushChat(c.room, { id: randomUUID(), from: c.from, at: c.now, roll: { expr: text, total: 0, detail: text, secret: true, blind: true } });

// ---- 3D y plantillas ----
/** Distancia en pies entre centros: horizontal 5-5-5 combinada con la diferencia de elevación. */
export const dist3d = (g: Grid, a: Token, b: Token) =>
  Math.hypot(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / g.size * g.feet, (b.elevation ?? 0) - (a.elevation ?? 0));

/** Valida que los objetivos caben en la plantilla. ponytail: el C2S act no lleva punto ni dirección, así que solo sphere (radio desde el centroide) y cube (caja mínima); cone y line no se validan. */
export function areaError(g: Grid, area: NonNullable<Action['area']>, ts: Token[]): string | null {
  if (area.shape === 'sphere') {
    const c = { x: ts.reduce((n, t) => n + t.x, 0) / ts.length, y: ts.reduce((n, t) => n + t.y, 0) / ts.length };
    return ts.every((t) => inArea('sphere', c, c, area.size, g, t)) ? null : 'objetivos fuera del área';
  }
  if (area.shape === 'cube') {
    const o = { x: Math.min(...ts.map((t) => t.x)), y: Math.min(...ts.map((t) => t.y)) };
    return ts.every((t) => inArea('cube', o, { x: o.x + 1, y: o.y + 1 }, area.size, g, t)) ? null : 'objetivos fuera del área';
  }
  return null;
}

// ---- turnos: hooks comunes ----
/**
 * Tras cambiar de turno (next, delay, remove, start). `ended` = token que acaba su turno (si lo hay); oldRound/oldInit = ronda e iniciativa del turno anterior (null al empezar).
 * Efectos de fin de turno, aviso de legendarias, borrado de áreas caducadas, guarida (iniciativa 20), reinicio de legendarias y efectos de inicio de turno.
 */
export function afterTurn(c: Ctx, ended: Token | undefined, oldRound: number, oldInit: number | null): Out {
  const { room } = c, s = room.scene, cb = room.combat!, chats: ChatMsg[] = [], sends: NonNullable<Effect['sends']> = [];
  const inOrder = (t: Token) => cb.order.some((o) => o.tokenId === t.id);
  const fire = (t: Token, when: 'turnStart' | 'turnEnd') => {
    for (const r of s.regions ?? []) {
      if (r.trigger !== when || !['trap', 'sound', 'message'].includes(r.kind) || flr(s, r.level) !== flr(s, t.level) || !pointInPolygon(t, r.points)
        || (r.once && r.fired) || (r.onlyAllies && t.faction !== 'ally')) continue;
      fireRegion(c, t, r, chats, sends);
    }
  };
  if (ended) {
    fire(ended, 'turnEnd');
    for (const l of s.tokens) if (l.legendary && l.id !== ended.id && inOrder(l) && !l.conditions.includes('dead') && l.legendary.used < l.legendary.max)
      chats.push(dmOnly(c, `${l.name}: ${l.legendary.max - l.legendary.used}/${l.legendary.max} acciones legendarias disponibles`));
  }
  if (cb.round > oldRound && s.regions) s.regions = s.regions.filter((r) => r.untilRound === undefined || r.untilRound > oldRound);
  const entry = cb.order[cb.turn], cur = s.tokens.find((t) => t.id === entry?.tokenId);
  // ponytail: la guarida salta al pasar de init ≥ 20 a < 20 (o al empezar la ronda); si todos tienen ≥ 20 no se anuncia
  if (entry && entry.init < 20 && (oldInit === null || cb.round !== oldRound || oldInit >= 20))
    for (const l of s.tokens) if (l.lair && inOrder(l) && !l.conditions.includes('dead')) chats.push(dmOnly(c, `Acciones de guarida de ${l.name}`));
  if (cur) {
    if (cur.legendary) cur.legendary.used = 0;
    fire(cur, 'turnStart');
  }
  return { chats, sends };
}

// ---- retrasar / añadir / quitar ----
export function combatEdit(c: Ctx, m: MemberRec, msg: { op: string; tokenId: unknown }): Effect {
  const { room } = c, s = room.scene, cb = room.combat;
  if (!cb) return { error: 'sin combate' };
  if (!str(msg.tokenId, 64)) return { error: 'mensaje inválido' };
  const tid: Id = msg.tokenId, t = s.tokens.find((x) => x.id === tid), dm = dmOf(m);
  if (msg.op === 'delay') {
    const cur = cb.order[cb.turn];
    if (cur?.tokenId !== tid) return { error: 'no es su turno' };
    if (!t) return { error: 'token inexistente' };
    if (!dm && !t.owners.includes(m.id)) return { error: 'no permitido' };
    const rest = cb.order.filter((_, i) => i !== cb.turn), n = rest.length;
    let j = -1, wrap = false; // j = quien juega ahora (el siguiente que exista); el token se coloca justo detrás
    for (let k = 0; k < n && j < 0; k++) if (s.tokens.some((x) => x.id === rest[(cb.turn + k) % n].tokenId)) { j = (cb.turn + k) % n; wrap = cb.turn + k >= n; }
    if (j < 0) return { error: 'nadie más en el orden' };
    rest.splice(j + 1, 0, { tokenId: tid, init: rest[j].init });
    const oldRound = cb.round;
    cb.order = rest; cb.turn = j;
    if (wrap) cb.round++;
    room.maxRound = Math.max(room.maxRound, cb.round);
    cb.used[rest[j].tokenId] = fresh();
    const h = afterTurn(c, undefined, oldRound, cur.init);
    return { state: true, chats: [say(c, `${t.name} retrasa su turno`), ...(h.chats ?? [])], sends: h.sends };
  }
  if (!dm) return { error: 'no permitido' };
  if (msg.op === 'add') {
    if (!t) return { error: 'token inexistente' };
    if (cb.order.some((o) => o.tokenId === tid)) return { error: 'ya está en el combate' };
    const init = c.rollFn('1d20').total + (t.initMod ?? 0);
    const i = cb.order.findIndex((o) => o.init < init), at = i < 0 ? cb.order.length : i; // a igualdad, detrás de los que ya estaban
    cb.order.splice(at, 0, { tokenId: tid, init });
    if (at <= cb.turn) cb.turn++;
    const text = `${t.name} se une al combate (iniciativa ${init})`;
    return { state: true, chats: [t.hidden ? dmOnly(c, text) : say(c, text)] };
  }
  // remove
  const i = cb.order.findIndex((o) => o.tokenId === tid);
  if (i < 0) return { error: 'no está en el combate' };
  const [gone] = cb.order.splice(i, 1), oldRound = cb.round, wasCur = i === cb.turn;
  delete cb.used[tid];
  const text = `${t?.name ?? 'Un combatiente'} sale del combate`, msgOut = t?.hidden ? dmOnly(c, text) : say(c, text);
  if (!cb.order.length) { delete room.combat; return { state: true, chats: [msgOut] }; }
  if (i < cb.turn) cb.turn--;
  else if (wasCur) {
    const step = () => { if (++cb.turn >= cb.order.length) { cb.turn = 0; cb.round++; } };
    if (cb.turn >= cb.order.length) { cb.turn = 0; cb.round++; }
    for (let k = 0; k < cb.order.length && !s.tokens.some((x) => x.id === cb.order[cb.turn].tokenId); k++) step();
    room.maxRound = Math.max(room.maxRound, cb.round);
    cb.used[cb.order[cb.turn].tokenId] = fresh();
    const h = afterTurn(c, undefined, oldRound, gone.init);
    return { state: true, chats: [msgOut, ...(h.chats ?? [])], sends: h.sends };
  }
  return { state: true, chats: [msgOut] };
}

// ---- acciones legendarias ----
export function legendary(m: MemberRec, s: Scene, msg: { tokenId: unknown; op: unknown }): Effect {
  if (!dmOf(m)) return { error: 'no permitido' };
  if (!str(msg.tokenId, 64) || (msg.op !== 'use' && msg.op !== 'reset')) return { error: 'mensaje inválido' };
  const l = s.tokens.find((t) => t.id === msg.tokenId)?.legendary;
  if (!l) return { error: 'el token no tiene acciones legendarias' };
  if (msg.op === 'reset') l.used = 0;
  else if (l.used >= l.max) return { error: 'sin acciones legendarias' };
  else l.used++;
  return { state: true };
}

// ---- reacción (Escudo) ----
const REACT_MS = 10_000;
const offered = new WeakMap<Room, Map<string, number>>(); // `${pending}|${tokenId}|${actionId}` → expires (ms); solo en memoria
const slotLvl = (t: Token, need?: number): number | null => !need ? 0 : Object.keys(t.slots ?? {}).map(Number).sort((a, b) => a - b).find((l) => l >= need && t.slots![l].used < t.slots![l].max) ?? null;
const canReact = (room: Room, t: Token, a: Action) => a.cost === 'reaction' && !room.combat?.used[t.id]?.reaction && slotLvl(t, a.slot) !== null;
const isShield = (a: Action) => /^shield/i.test(a.id) || a.name.toLowerCase() === 'escudo';

/** S2C reactionPrompt (solo a los dueños del objetivo) por cada impacto sobre un token con una reacción disponible. */
export function reactionPrompts(room: Room, card: ActionCard, now: number): NonNullable<Effect['sends']> {
  if (!card.pending || card.kind !== 'attack') return [];
  const out: NonNullable<Effect['sends']> = [], pending = card.pending;
  for (const ct of card.targets) {
    const t = room.scene.tokens.find((x) => x.id === ct.id);
    if (!ct.attack?.hit || !t?.owners.length) continue;
    for (const a of t.actions ?? []) {
      if (!canReact(room, t, a)) continue;
      const expires = now + REACT_MS;
      let map = offered.get(room);
      if (!map) offered.set(room, map = new Map());
      map.set(`${pending}|${t.id}|${a.id}`, expires);
      out.push({ who: (m) => t.owners.includes(m.id), msg: { t: 'reactionPrompt', pending, tokenId: t.id, actionId: a.id, text: `${card.actorName} te impacta con ${card.actionName}. ¿Usas ${a.name}?`, expires } });
    }
  }
  return out;
}

export function react(c: Ctx, m: MemberRec, msg: { pending: unknown; tokenId: unknown; actionId: unknown }): Effect {
  const { room, now } = c;
  if (!str(msg.pending, 64) || !str(msg.tokenId, 64) || !str(msg.actionId, 64)) return { error: 'mensaje inválido' };
  const t = room.scene.tokens.find((x) => x.id === msg.tokenId);
  if (!t) return { error: 'token inexistente' };
  if (!t.owners.includes(m.id)) return { error: 'no permitido' };
  const map = offered.get(room), key = `${msg.pending}|${t.id}|${msg.actionId}`, expires = map?.get(key);
  if (expires === undefined) return { error: 'no se te ha ofrecido esa reacción' };
  if (now > expires) { map!.delete(key); return { error: 'la reacción ha caducado' }; }
  const pi = room.pending.findIndex((x) => x.pending === msg.pending), card = room.pending[pi];
  if (!card) return { error: 'no hay tarjeta pendiente' };
  const ct = card.targets.find((x) => x.id === t.id), a = t.actions?.find((x) => x.id === msg.actionId);
  if (!ct?.attack?.hit) return { error: 'el ataque no te impacta' };
  if (!a || !canReact(room, t, a)) return { error: 'reacción no disponible' };
  for (const k of map!.keys()) if (k.startsWith(`${msg.pending}|${t.id}|`)) map!.delete(k); // una sola reacción por tarjeta
  if (room.combat) (room.combat.used[t.id] ??= fresh()).reaction = true;
  const uses = say(c, `${t.name} usa ${a.name}`);
  if (!isShield(a)) return { state: true, chat: uses };
  // Escudo: +5 a la CA. ponytail: solo recalcula este impacto; el +5 no persiste hasta el siguiente turno
  const lvl = slotLvl(t, a.slot);
  if (lvl) t.slots![lvl].used++;
  const at = ct.attack;
  at.hit = at.d20 !== 1 && (at.d20 === 20 || at.total >= (t.ac ?? 10) + 5 + (ct.cover ?? 0));
  if (!at.hit) { ct.amount = 0; at.crit = false; }
  card.detail = `${card.detail ? card.detail + '\n' : ''}${t.name} usa ${a.name} (+5 CA)${at.hit ? '' : ': el ataque falla'}`;
  const old = room.chat.find((x) => x.card?.pending === msg.pending);
  if (old?.card) delete old.card.pending; // la tarjeta vieja queda sustituida por la republicada
  if (!card.targets.some((x) => (x.amount ?? 0) > 0)) { room.pending.splice(pi, 1); delete card.pending; card.applied = true; }
  return { state: true, chats: [uses, pushChat(room, { id: randomUUID(), from: m.id, at: now, card: structuredClone(card) })] };
}

// ---- monstruo personalizado (cuenta DDB del DM) ----
export function spawnCustom(c: Ctx, msg: { monster: unknown; x: unknown; y: unknown; hidden?: unknown }): Effect {
  const s = c.room.scene, mo = msg.monster;
  if (!obj(mo) || !inScene(s, msg.x, msg.y) || (msg.hidden !== undefined && typeof msg.hidden !== 'boolean')) return { error: 'mensaje inválido' };
  const ch = parseCharacter(mo, 99); // mismo parser que los tokens del DM (impacto automático hasta 99)
  if (!ch) return { error: 'monstruo inválido' };
  if (mo.cr !== undefined) { try { if (typeof mo.cr !== 'string') throw 0; encounterXP([mo.cr]); } catch { return { error: 'VD inválido' }; } }
  const size = mo.size ?? 1;
  if (!Number.isInteger(size) || (size as number) < 1 || (size as number) > 4) return { error: 'tamaño inválido' };
  if (mo.srdLike !== undefined && mo.srdLike !== true) return { error: 'mensaje inválido' };
  if (s.tokens.length >= MAX_ITEMS) return { error: 'demasiados elementos' };
  const sz = size as number, g = s.grid, snap = (v: number, off: number) => sz % 2 === 0 ? Math.round((v - off) / g.size) * g.size + off : Math.floor((v - off) / g.size) * g.size + off + g.size / 2;
  const names = new Set(s.tokens.map((t) => t.name));
  let name = ch.name;
  for (let n = 2; names.has(name); n++) name = `${ch.name} ${n}`;
  const { ddbId: _i, level: _l, classes: _c, avatar, name: _n, ...stats } = ch;
  s.tokens.push({ ...stats, id: `custom-${randomUUID().slice(0, 8)}`, name, x: snap(msg.x as number, g.offsetX), y: snap(msg.y as number, g.offsetY), size: sz,
    faction: 'enemy', hidden: msg.hidden === true, owners: [], conditions: [], ...(avatar && { img: avatar }) });
  return { state: true };
}
