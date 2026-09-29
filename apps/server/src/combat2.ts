// Combate ampliado: retrasar/añadir/quitar, legendarias y guarida, reacción Escudo, áreas persistentes, 3D, spawn personalizado.
// La lógica vive aquí; room.ts solo la engancha. (Import circular con room.ts: solo se usan funciones en tiempo de llamada.)
import { randomUUID } from 'node:crypto';
import type { Ability, Action, ActionCard, ChatMsg, Grid, Id, Point, Scene, Token } from '@lantern/protocol';
import { opportunities } from '@lantern/protocol/move';
import { ABILITY_ES, abilityMod, applyDamage, encounterXP, heal, inArea } from '@lantern/rules';
import { cover, pointInPolygon, sightSegments } from '@lantern/vision';
import { parseCharacter } from './import.ts';
import { MAX_ITEMS, inScene, obj, parseEffect, str } from './validate.ts';
import { applyCardFx, d20Test, damageFx, delCond, filterFor, fireRegion, flr, healFx, pushChat, type Ctx, type Effect, type MemberRec, type Room } from './room.ts';

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
  if (area.shape === 'sphere' || area.shape === 'cylinder') { // cylinder: en 2D es una esfera
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
/** CA efectiva: la base más el +5 de Escudo mientras `shielded` (un campo del token: sobrevive a reinicios y se limpia al acabar el combate). */
export const acOf = (t: Token) => (t.ac ?? 10) + (t.shielded ? 5 : 0);
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
  const remind = (t: Token, phase: 'start' | 'end') => {
    const effects = (t.effects ?? []).filter((e) => e.when === phase);
    if (effects.length) sends.push({ who: (m) => dmOf(m) || t.owners.includes(m.id), msg: { t: 'turnReminder', tokenId: t.id, phase, effects: structuredClone(effects) } });
  };
  if (ended) {
    fire(ended, 'turnEnd'); remind(ended, 'end');
    for (const l of s.tokens) if (l.legendary && l.id !== ended.id && inOrder(l) && !l.conditions.includes('dead') && l.legendary.used < l.legendary.max)
      chats.push(dmOnly(c, `${l.name}: ${l.legendary.max - l.legendary.used}/${l.legendary.max} acciones legendarias disponibles`));
  }
  if (cb.round > oldRound && s.regions) s.regions = s.regions.filter((r) => r.untilRound === undefined || r.untilRound > oldRound);
  const entry = cb.order[cb.turn], cur = s.tokens.find((t) => t.id === entry?.tokenId);
  // ponytail: la guarida salta al pasar de init ≥ 20 a < 20 (o al empezar la ronda); si todos tienen ≥ 20 no se anuncia
  if (entry && entry.init < 20 && (oldInit === null || cb.round !== oldRound || oldInit >= 20))
    for (const l of s.tokens) if (l.lair && inOrder(l) && !l.conditions.includes('dead')) chats.push(dmOnly(c, `Acciones de guarida de ${l.name}`));
  if (cur) {
    delete cur.shielded; // Escudo caduca al inicio del turno del lanzador
    if (cur.legendary) cur.legendary.used = 0;
    fire(cur, 'turnStart'); remind(cur, 'start');
  }
  return { chats, sends };
}

// ---- retrasar / añadir / quitar ----
export function combatEdit(c: Ctx, m: MemberRec, msg: { op: string; tokenId: unknown; to?: unknown }): Effect {
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
  if (msg.op === 'group' || msg.op === 'split' || msg.op === 'move') return reorder(c, msg, t);
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
  delete cb.used[tid]; if (t) delete t.shielded;
  const text = `${t?.name ?? 'Un combatiente'} sale del combate`, msgOut = t?.hidden ? dmOnly(c, text) : say(c, text);
  if (!cb.order.length) { endCombat(room); return { state: true, chats: [msgOut] }; }
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
const REACT_MS = 10_000, COUNTER_MS = 5_000, SAVE_MS = 20_000;
const offered = new WeakMap<Room, Map<string, number>>(); // `${pending}|${tokenId}|${actionId}` → expires (ms); solo en memoria
const slotLvl = (t: Token, need?: number): number | null => !need ? 0 : Object.keys(t.slots ?? {}).map(Number).sort((a, b) => a - b).find((l) => l >= need && t.slots![l].used < t.slots![l].max) ?? null;
const canReact = (room: Room, t: Token, a: Action) => a.cost === 'reaction' && !room.combat?.used[t.id]?.reaction && slotLvl(t, a.slot) !== null;
const isShield = (a: Action) => /^shield/i.test(a.id) || a.name.toLowerCase() === 'escudo';
const isCounter = (a: Action) => /^counterspell/i.test(a.id) || a.name.toLowerCase() === 'contraconjuro';

/** S2C reactionPrompt (solo a los dueños del objetivo) por cada impacto sobre un token con una reacción disponible, y Contraconjuro ante conjuros visibles a 60 pies. */
export function reactionPrompts(room: Room, card: ActionCard, now: number): NonNullable<Effect['sends']> {
  if (!card.pending) return [];
  const out: NonNullable<Effect['sends']> = [], pending = card.pending;
  const offer = (t: Token, a: Action, ms: number, text: string) => {
    const expires = now + ms;
    let map = offered.get(room);
    if (!map) offered.set(room, map = new Map());
    map.set(`${pending}|${t.id}|${a.id}`, expires);
    out.push({ who: (m) => t.owners.includes(m.id), msg: { t: 'reactionPrompt', pending, tokenId: t.id, actionId: a.id, text, expires } });
  };
  if (card.kind === 'attack') for (const ct of card.targets) {
    const t = room.scene.tokens.find((x) => x.id === ct.id);
    if (!ct.attack?.hit || !t?.owners.length) continue;
    for (const a of t.actions ?? []) if (!isCounter(a) && canReact(room, t, a)) offer(t, a, REACT_MS, `${card.actorName} te impacta con ${card.actionName}. ¿Usas ${a.name}?`);
  }
  const s = room.scene, actor = s.tokens.find((x) => x.id === card.actorId);
  if (actor && !actor.hidden && actor.actions?.find((a) => a.name === card.actionName)?.slot) {
    const segs = sightSegments(s.walls.filter((w) => flr(s, w.level) === flr(s, actor.level)));
    for (const t of s.tokens) {
      const a = t.actions?.find(isCounter);
      if (!a || !t.owners.length || t.faction === actor.faction || !canReact(room, t, a) || dist3d(s.grid, actor, t) > 60 + 1e-6 || cover(t, actor, actor.size * s.grid.size / 2, segs) === 'total') continue;
      offer(t, a, COUNTER_MS, `${actor.name} lanza ${card.actionName}. ¿Usas ${a.name}?`);
    }
  }
  return out;
}

// Contraconjuro: si el espacio gastado alcanza el nivel del conjuro se anula; si no, prueba de característica CD 10 + nivel.
function counter(c: Ctx, m: MemberRec, t: Token, a: Action, card: ActionCard, pi: number): Effect {
  const { room, now } = c, actor = room.scene.tokens.find((x) => x.id === card.actorId), spell = actor?.actions?.find((x) => x.name === card.actionName);
  if (!actor || !spell?.slot) return { error: 'no hay conjuro que contrarrestar' };
  if (!canReact(room, t, a)) return { error: 'reacción no disponible' };
  for (const k of offered.get(room)!.keys()) if (k.startsWith(`${card.pending}|${t.id}|`)) offered.get(room)!.delete(k);
  if (room.combat) (room.combat.used[t.id] ??= fresh()).reaction = true;
  const lvl = slotLvl(t, a.slot);
  if (lvl) t.slots![lvl].used++;
  const need = 10 + spell.slot, uses = say(c, `${t.name} usa ${a.name} contra ${card.actionName}`);
  let ok = (lvl ?? 0) >= spell.slot, detail = '';
  if (!ok) {
    const ab = Math.max(...(['int', 'wis', 'cha'] as const).map((k) => abilityMod(t.abilities?.[k] ?? 10))), r = c.rollFn('1d20');
    ok = r.total + ab >= need; detail = ` (prueba ${r.total + ab} contra ${need})`;
  }
  const old = room.chat.find((x) => x.card?.pending === card.pending);
  if (old?.card) delete old.card.pending;
  if (!ok) return { state: true, chats: [uses, say(c, `${a.name} falla${detail}`)] };
  room.pending.splice(pi, 1);
  for (const ct of card.targets) { ct.amount = 0; delete ct.save; delete ct.attack; }
  delete card.pending; delete card.awaiting; card.applied = true;
  card.detail = `${card.detail ? card.detail + '\n' : ''}Contrarrestado por ${t.name}${detail}`;
  return { state: true, chats: [uses, pushChat(room, { id: randomUUID(), from: m.id, at: now, card: structuredClone(card) })] };
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
  if (a && isCounter(a)) return counter(c, m, t, a, card, pi);
  if (!ct?.attack?.hit) return { error: 'el ataque no te impacta' };
  if (!a || !canReact(room, t, a)) return { error: 'reacción no disponible' };
  for (const k of map!.keys()) if (k.startsWith(`${msg.pending}|${t.id}|`)) map!.delete(k); // una sola reacción por tarjeta
  if (room.combat) (room.combat.used[t.id] ??= fresh()).reaction = true;
  const uses = say(c, `${t.name} usa ${a.name}`);
  if (!isShield(a)) return { state: true, chat: uses };
  // Escudo: +5 a la CA hasta el inicio del siguiente turno del lanzador (afterTurn lo retira)
  const lvl = slotLvl(t, a.slot);
  if (lvl) t.slots![lvl].used++;
  const at = ct.attack;
  t.shielded = true;
  at.hit = at.d20 !== 1 && (at.d20 === 20 || at.total >= acOf(t) + (ct.cover ?? 0));
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

// ---- fin de combate, deshacer turno ----
const snaps = new WeakMap<Room, string[]>(); // instantáneas antes de cada «siguiente turno»; solo en memoria
export function endCombat(room: Room) {
  for (const t of room.scene.tokens) delete t.shielded;
  delete room.combat; snaps.delete(room);
}
export function snapshotTurn(room: Room) {
  const l = snaps.get(room) ?? [];
  l.push(JSON.stringify({ sceneId: room.activeId, combat: room.combat, tokens: room.scene.tokens, regions: room.scene.regions, pending: room.pending }));
  if (l.length > 5) l.shift();
  snaps.set(room, l);
}
export function undoTurn(c: Ctx): Effect {
  const { room } = c, j = snaps.get(room)?.pop();
  if (!j) return { error: 'nada que deshacer' };
  const o = JSON.parse(j);
  if (o.sceneId !== room.activeId || !room.combat) return { error: 'nada que deshacer' };
  room.scene.tokens = o.tokens; room.combat = o.combat; room.pending = o.pending;
  if (o.regions) room.scene.regions = o.regions; else delete room.scene.regions;
  return { state: true, chats: [say(c, 'Se deshace el último turno')] };
}

// ---- concentración ----
/** Rompe la concentración de `t`: borra regiones y condiciones que el conjuro creó (enlazadas por sourceId `conc:<tokenId>`). */
export function breakConcentration(c: Ctx, t: Token): ChatMsg[] {
  const s = c.room.scene, sid = `conc:${t.id}`, spell = t.concentration;
  delete t.concentration;
  let n = 0;
  if (s.regions) { const before = s.regions.length; s.regions = s.regions.filter((r) => r.sourceId !== sid); n += before - s.regions.length; }
  for (const o of s.tokens) for (const [k, v] of Object.entries(o.condSource ?? {})) if (v === sid) { delCond(o, k); n++; }
  return n ? [say(c, `${t.name}: se disipan los efectos de ${spell}`)] : [];
}

// ---- iniciativa ----
const initRoll = (c: Ctx, t: Token) => c.rollFn(t.initAdv ? '2d20kh1' : '1d20').total;
export function startCombat(c: Ctx, m: MemberRec): Effect {
  const { room, now, rollFn } = c, s = room.scene, opt = room.settings.optional;
  if (!s.tokens.length) return { error: 'sin tokens' };
  // Iniciativa por bandos: un d20 para los aliados y otro para el resto; el bando ganador (empate: aliados) va primero, y dentro de cada bloque por initMod.
  const side = opt.sideInit ? { ally: rollFn('1d20').total, rest: rollFn('1d20').total } : undefined;
  const ask = !side && opt.playerInit ? s.tokens.filter((t) => t.faction === 'ally' && t.owners.length && !t.hidden).map((t) => t.id) : []; // los jugadores tiran la suya
  const grouped = new Map<string, number>(); // groupInit: un d20 por tipo de monstruo idéntico
  const d20 = (t: Token) => {
    if (side) return t.faction === 'ally' ? side.ally : side.rest;
    const key = opt.groupInit && t.faction === 'enemy' && t.srd ? t.srd : undefined;
    if (key && grouped.has(key)) return grouped.get(key)!;
    const r = initRoll(c, t);
    if (key) grouped.set(key, r);
    return r;
  };
  const blk = (t: Token) => side ? (t.faction === 'ally' ? 0 : 1) : 0, first = side && side.rest > side.ally ? 1 : 0;
  const rows = s.tokens.filter((t) => !ask.includes(t.id)).map((t) => ({ t, init: d20(t) + (t.initMod ?? 0) }))
    .sort((a, b) => (blk(a.t) === first ? 0 : 1) - (blk(b.t) === first ? 0 : 1) || b.init - a.init || (b.t.initMod ?? 0) - (a.t.initMod ?? 0));
  room.maxRound = Math.max(room.maxRound, 1);
  snaps.delete(room);
  room.combat = { round: 1, turn: 0, order: rows.map((r) => ({ tokenId: r.t.id, init: r.init })), used: {}, ...(ask.length && { awaiting: ask }) };
  const fmt = (h: boolean) => rows.filter((r) => r.t.hidden === h).map((r) => `${r.t.name} ${r.init}`).join(', ');
  // Público: solo el aviso (el carrusel ya llega filtrado por visión). El orden completo, secreto para DM/asistente.
  const chats = [pushChat(room, { id: randomUUID(), from: m.id, at: now, text: ask.length ? '¡Comienza el combate! Los jugadores tiran su iniciativa' : '¡Comienza el combate! Ronda 1' + (side ? ` · Iniciativa por bandos: aliados ${side.ally}, resto ${side.rest}` : '') })];
  chats.push(pushChat(room, { id: randomUUID(), from: m.id, at: now, roll: { expr: 'iniciativa', total: 0, detail: fmt(false) + (rows.some((r) => r.t.hidden) ? ' · ocultos: ' + fmt(true) : ''), secret: true } }));
  if (ask.length) return { state: true, chats };
  const h0 = afterTurn(c, undefined, 0, null);
  return { state: true, chats: [...chats, ...(h0.chats ?? [])], sends: h0.sends };
}

// Un jugador (o el DM al forzar) tira la iniciativa que faltaba; al llegar la última empieza la ronda 1.
function addInit(c: Ctx, t: Token): ChatMsg {
  const cb = c.room.combat!, init = initRoll(c, t) + (t.initMod ?? 0), i = cb.order.findIndex((o) => o.init < init);
  cb.order.splice(i < 0 ? cb.order.length : i, 0, { tokenId: t.id, init });
  cb.awaiting = cb.awaiting!.filter((x) => x !== t.id);
  return say(c, `${t.name} tira la iniciativa: ${init}`);
}
function finishInit(c: Ctx, chats: ChatMsg[]): Effect {
  const cb = c.room.combat!;
  if (cb.awaiting?.length) return { state: true, chats };
  delete cb.awaiting; cb.turn = 0; cb.round = 1; cb.used = {};
  const h = afterTurn(c, undefined, 0, null);
  return { state: true, chats: [...chats, say(c, 'Ronda 1'), ...(h.chats ?? [])], sends: h.sends };
}
export function rollInit(c: Ctx, m: MemberRec, msg: { tokenId: unknown }): Effect {
  const cb = c.room.combat, t = str(msg.tokenId, 64) ? c.room.scene.tokens.find((x) => x.id === msg.tokenId) : undefined;
  if (!t) return { error: 'token inexistente' };
  if (!dmOf(m) && !t.owners.includes(m.id)) return { error: 'no permitido' };
  if (!cb?.awaiting?.includes(t.id)) return { error: 'no se pide su iniciativa' };
  return finishInit(c, [addInit(c, t)]);
}
export function forceInit(c: Ctx): Effect {
  const cb = c.room.combat;
  if (!cb?.awaiting?.length) return { error: 'no se espera ninguna iniciativa' };
  const chats = [...cb.awaiting].map((id) => c.room.scene.tokens.find((t) => t.id === id)).filter((t): t is Token => !!t).map((t) => addInit(c, t));
  cb.awaiting = [];
  return finishInit(c, chats);
}

// Agrupar / separar monstruos idénticos y reordenar a mano (DM). El turno sigue en quien jugaba.
function reorder(c: Ctx, msg: { op: string; tokenId: unknown; to?: unknown }, t: Token | undefined): Effect {
  const cb = c.room.combat!, tid = msg.tokenId as Id, cur = cb.order[cb.turn]?.tokenId, i = cb.order.findIndex((o) => o.tokenId === tid);
  if (i < 0 || !t) return { error: 'no está en el combate' };
  const keep = () => { cb.turn = Math.max(0, cb.order.findIndex((o) => o.tokenId === cur)); };
  if (msg.op === 'move') {
    const to = msg.to;
    if (typeof to !== 'number' || !Number.isInteger(to) || to < 0 || to >= cb.order.length) return { error: 'mensaje inválido' };
    const [e] = cb.order.splice(i, 1);
    cb.order.splice(to, 0, e);
    e.init = to > 0 ? cb.order[to - 1].init : (cb.order[1]?.init ?? e.init); // hereda la iniciativa del vecino para que el orden siga siendo coherente
    keep();
    return { state: true };
  }
  const peers = cb.order.filter((o) => { const p = c.room.scene.tokens.find((x) => x.id === o.tokenId); return p && p.srd && p.srd === t.srd && p.faction === t.faction; });
  if (!t.srd || peers.length < 2) return { error: 'no hay monstruos idénticos' };
  if (msg.op === 'group') {
    const init = cb.order[i].init, ids = new Set(peers.map((p) => p.tokenId));
    for (const p of peers) p.init = init;
    const rest = cb.order.filter((o) => !ids.has(o.tokenId)), at = cb.order.slice(0, i).filter((o) => !ids.has(o.tokenId)).length;
    cb.order = [...rest.slice(0, at), ...peers, ...rest.slice(at)];
    keep();
    return { state: true, chats: [say(c, `${t.name}: los ${peers.length} de su grupo actúan juntos`)] };
  }
  for (const p of peers) p.init = c.rollFn('1d20').total + (c.room.scene.tokens.find((x) => x.id === p.tokenId)?.initMod ?? 0);
  cb.order = cb.order.map((o, k) => ({ o, k })).sort((a, b) => b.o.init - a.o.init || a.k - b.k).map((x) => x.o);
  keep();
  return { state: true, chats: [say(c, `${t.name}: el grupo tira la iniciativa por separado`)] };
}

// ---- acciones del radial, presupuesto ----
export function turnAction(c: Ctx, m: MemberRec, msg: { tokenId: unknown; op: unknown }): Effect {
  const { room } = c, t = str(msg.tokenId, 64) ? room.scene.tokens.find((x) => x.id === msg.tokenId) : undefined;
  if (!t) return { error: 'token inexistente' };
  if (!dmOf(m) && !t.owners.includes(m.id)) return { error: 'no permitido' };
  const cb = room.combat, op = msg.op;
  if (op !== 'dodge' && op !== 'dash' && op !== 'disengage' && op !== 'hide' && op !== 'useObject') return { error: 'mensaje inválido' };
  const u = cb && (cb.used[t.id] ??= fresh());
  if (cb && !dmOf(m) && cb.order[cb.turn]?.tokenId !== t.id) return { error: 'no es su turno' };
  if (u) { // useObject: la primera interacción es gratuita; la segunda gasta la acción
    if (op === 'useObject' && !u.object) u.object = true;
    else if (u.action) return { error: 'ya usada' };
    else u.action = true;
    if (op === 'dodge') u.dodge = true;
    else if (op === 'disengage') u.disengage = true;
    else if (op === 'dash') u.dash = (u.dash ?? 0) + (t.speed ?? 30);
  }
  if (op === 'hide') {
    const r = d20Test(c, t, 'skill', 'stealth');
    return { state: true, chats: [pushChat(room, { id: randomUUID(), from: c.from, at: c.now, roll: { expr: `Sigilo de ${t.name} (Esconderse)`, total: r.total, detail: r.detail, secret: true, ...(r.dice && { dice: r.dice }) } })] };
  }
  const say2 = { dodge: 'se pone a la defensiva (Esquivar)', dash: 'corre (Correr)', disengage: 'se destraba (Destrabarse)', useObject: 'usa un objeto' }[op];
  return { state: true, chats: [say(c, `${t.name} ${say2}`)] };
}
export function budget(m: MemberRec, room: Room, msg: { tokenId: unknown; slot: unknown; used: unknown }): Effect {
  const t = str(msg.tokenId, 64) ? room.scene.tokens.find((x) => x.id === msg.tokenId) : undefined;
  if (!t) return { error: 'token inexistente' };
  if (!dmOf(m) && !t.owners.includes(m.id)) return { error: 'no permitido' };
  if (!room.combat) return { error: 'sin combate' };
  if (!['action', 'bonus', 'reaction', 'object'].includes(msg.slot as string) || typeof msg.used !== 'boolean') return { error: 'mensaje inválido' };
  (room.combat.used[t.id] ??= fresh())[msg.slot as 'action'] = msg.used;
  return { state: true };
}

// ---- ataques de oportunidad (aviso, sin reacción automática) ----
/** Avisos de ataque de oportunidad de la ruta: los enemigos visibles al chat público, los ocultos solo al DM. */
export function oppChats(c: Ctx, t: Token, pts: Point[]): ChatMsg[] {
  const { room } = c, cb = room.combat;
  if (!cb || cb.used[t.id]?.disengage) return [];
  const foes = room.scene.tokens.filter((f) => !cb.used[f.id]?.reaction && flr(room.scene, f.level) === flr(room.scene, t.level));
  return opportunities(room.scene, t, pts, foes).map(({ foe }) => (foe.hidden ? dmOnly : say)(c, `${t.name} provoca un ataque de oportunidad de ${foe.name}`));
}

// ---- efectos de turno: salvación repetida, daño continuo, regeneración ----
export function effectOp(c: Ctx, m: MemberRec, msg: { op: unknown; tokenId: unknown; effect?: unknown; effectId?: unknown }): Effect {
  const t = str(msg.tokenId, 64) ? c.room.scene.tokens.find((x) => x.id === msg.tokenId) : undefined;
  if (!t) return { error: 'token inexistente' };
  if (msg.op === 'add') {
    if (!dmOf(m)) return { error: 'no permitido' };
    const e = obj(msg.effect) ? parseEffect({ ...msg.effect, id: randomUUID() }) : null;
    if (!e) return { error: 'efecto inválido' };
    if ((t.effects ??= []).length >= 10) return { error: 'demasiados efectos' };
    t.effects.push(e);
    return { state: true };
  }
  const eff = t.effects?.find((x) => x.id === msg.effectId);
  if (!eff) return { error: 'efecto inexistente' };
  if (!dmOf(m) && !t.owners.includes(m.id)) return { error: 'no permitido' };
  if (msg.op === 'dismiss') { t.effects = t.effects!.filter((x) => x !== eff); return { state: true }; }
  if (msg.op !== 'apply') return { error: 'mensaje inválido' };
  const chats: ChatMsg[] = [];
  let done = !eff.save && !eff.damage && !eff.heal, saved = false;
  if (eff.save) {
    const r = d20Test(c, t, 'save', eff.save.ability);
    saved = r.total >= eff.save.dc;
    chats.push(say(c, `${t.name}: salvación de ${ABILITY_ES[eff.save.ability]} contra ${eff.name}: ${r.total} — ${saved ? 'supera' : 'falla'}`));
    done = saved;
  }
  if (eff.damage && t.hp && !saved) {
    const r = c.rollFn(eff.damage), prev = { ...t.hp }, res = applyDamage(prev, r.total, eff.damageType ?? '', t.defenses);
    t.hp = res.hp;
    chats.push(say(c, `${t.name} sufre ${r.total}${eff.damageType ? ' ' + eff.damageType : ''} por ${eff.name}`), ...damageFx(c, t, prev, res.taken));
  }
  if (eff.heal && t.hp && !t.conditions.includes('dead')) {
    const r = c.rollFn(eff.heal), prev = { ...t.hp };
    t.hp = heal(prev, r.total);
    chats.push(say(c, `${t.name} recupera ${r.total} PG (${eff.name})`), ...healFx(c, t, prev));
  }
  if (done) { if (eff.endsCondition) delCond(t, eff.endsCondition); t.effects = t.effects!.filter((x) => x !== eff); chats.push(say(c, `${eff.name} termina en ${t.name}`)); }
  return { state: true, chats };
}
/** Alta de efecto al aplicar una condición con salvación para terminarla (condition + saveEnd). */
export function saveEndEffect(t: Token, cond: string, name: string, save: { ability: Ability; dc: number }, sourceId?: string) {
  t.effects = (t.effects ?? []).filter((e) => e.endsCondition !== cond);
  t.effects.push({ id: randomUUID(), name, when: 'end', save, endsCondition: cond, ...(sourceId && { sourceId }) });
}

// ---- salvaciones tiradas por los jugadores (opción de mesa playerSaves) ----
type Hold = { until: number; res: Map<Id, { save: NonNullable<ActionCard['targets'][number]['save']>; amount?: number; die?: import('@lantern/protocol').Die }> };
const holds = new WeakMap<Room, Map<Id, Hold>>(); // resultados ya tirados por el servidor, ocultos hasta que el dueño pulse (o caduque)
/** Retiene las salvaciones de los tokens con dueño: la tarjeta queda pendiente («esperando») y cada dueño recibe una petición. */
export function holdSaves(c: Ctx, card: ActionCard): NonNullable<Effect['sends']> {
  const { room, now } = c, toks = card.targets.map((ct) => room.scene.tokens.find((t) => t.id === ct.id));
  if (card.kind !== 'save' || !toks.some((t) => t?.owners.length)) return [];
  const dice = card.dice ?? [], base = dice.length - card.targets.length, res: Hold['res'] = new Map(), out: NonNullable<Effect['sends']> = [];
  card.pending ??= randomUUID();
  if (!room.pending.includes(card)) room.pending.push(card);
  const expires = now + SAVE_MS;
  card.targets.forEach((ct, i) => {
    const t = toks[i];
    if (!t?.owners.length || !ct.save) return;
    res.set(ct.id, { save: ct.save, amount: ct.amount, die: dice[base + i] });
    out.push({ who: (m) => t.owners.includes(m.id), msg: { t: 'saveRequest', pending: card.pending!, tokenId: t.id, ability: ct.save!.ability, dc: ct.save!.dc, text: `${card.actorName} te obliga a una salvación de ${ABILITY_ES[ct.save!.ability]} (${card.actionName})`, expires } });
    delete ct.save; delete ct.amount;
  });
  delete card.dice;
  card.awaiting = [...res.keys()];
  let h = holds.get(room);
  if (!h) holds.set(room, h = new Map());
  h.set(card.pending, { until: expires, res });
  return out;
}
const reveal = (card: ActionCard, id: Id, h: Hold) => {
  const r = h.res.get(id), ct = card.targets.find((x) => x.id === id);
  if (!r || !ct) return;
  ct.save = r.save; if (r.amount !== undefined) ct.amount = r.amount;
  card.awaiting = card.awaiting?.filter((x) => x !== id);
};
/** Con todas las salvaciones a la vista: en automático se aplica; si no, sigue pendiente para el DM. Se republica la tarjeta. */
function finishSaves(c: Ctx, card: ActionCard): ChatMsg[] {
  const { room, now } = c;
  delete card.awaiting; holds.get(room)?.delete(card.pending!);
  const old = room.chat.find((x) => x.card?.pending === card.pending);
  if (old?.card) { delete old.card.pending; delete old.card.awaiting; }
  const auto = room.automation === 'auto' && room.settings.mode === 'full' && room.settings.layers.automation;
  if (auto || !card.targets.some((t) => (t.amount ?? 0) > 0)) { room.pending = room.pending.filter((x) => x !== card); delete card.pending; card.applied = true; }
  const msg = pushChat(room, { id: randomUUID(), from: c.from, at: now, card: structuredClone(card) });
  return [msg, ...(card.applied ? applyCardFx(c, card, 'full') : [])];
}
export function answerSave(c: Ctx, m: MemberRec, msg: { pending: unknown; tokenId: unknown }): Effect {
  const { room, now } = c, h = str(msg.pending, 64) ? holds.get(room)?.get(msg.pending) : undefined, card = room.pending.find((x) => x.pending === msg.pending);
  const t = str(msg.tokenId, 64) ? room.scene.tokens.find((x) => x.id === msg.tokenId) : undefined;
  if (!h || !card || !t) return { error: 'no hay salvación pendiente' };
  if (!t.owners.includes(m.id)) return { error: 'no permitido' };
  if (!card.awaiting?.includes(t.id)) return { error: 'ya has tirado' };
  const r = h.res.get(t.id)!;
  reveal(card, t.id, h);
  const chats = [pushChat(room, { id: randomUUID(), from: m.id, at: now, roll: { expr: `Salvación de ${ABILITY_ES[r.save.ability]} de ${t.name}`, total: r.save.total, detail: `${r.save.total}`, secret: false, ...(r.die && { dice: [r.die] }) } })];
  if (!card.awaiting?.length) chats.push(...finishSaves(c, card));
  return { state: true, chats };
}
/** Caducidad de las salvaciones (20 s): se revela lo que el servidor ya había tirado. Se llama al principio de cada mensaje. */
export function sweepSaves(c: Ctx): ChatMsg[] {
  const hs = holds.get(c.room), out: ChatMsg[] = [];
  if (!hs) return out;
  for (const [pid, h] of [...hs]) {
    if (h.until > c.now) continue;
    const card = c.room.pending.find((x) => x.pending === pid);
    if (!card) { hs.delete(pid); continue; }
    for (const id of [...(card.awaiting ?? [])]) reveal(card, id, h);
    out.push(...finishSaves(c, card));
  }
  return out;
}
/** El DM confirma con salvaciones sin tirar: se revelan ya (la tarjeta la republica el propio confirm). */
export function forceSaves(c: Ctx, card: ActionCard) {
  const h = holds.get(c.room)?.get(card.pending!);
  if (h) for (const id of [...(card.awaiting ?? [])]) reveal(card, id, h);
  delete card.awaiting; holds.get(c.room)?.delete(card.pending!);
}

// ---- quién ve a un token (para difundir rótulos y rutas solo a quien corresponde) ----
export function seenBy(room: Room, tokenId: Id, except?: Id) {
  const memo = new Map<Id, boolean>();
  return (m: MemberRec) => m.id !== except && (memo.get(m.id) ?? (memo.set(m.id, dmOf(m) || filterFor(room, m).scene.tokens.some((t) => t.id === tokenId)), memo.get(m.id)!));
}
