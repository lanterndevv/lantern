// Fase 11: tiradas con @variables, repetir d20 (inspiración/suerte), descansos, subida de nivel, personajes propios,
// cerraduras, regiones con acción (salir/interactuar/silencio/documento/escena/encuentro), pins, botín, zoom de PDF y filtro extra.
// Envuelve al manejador de room.ts (handleExtras): lo que no es suyo pasa tal cual.
import { randomUUID } from 'node:crypto';
import type { Ability, ChatMsg, ClientState, Id, Point, Region, Scene, Token } from '@lantern/protocol';
import { SKILLS, abilityMod, diceContext, longRest, proficiencyBonus } from '@lantern/rules';
import { CLASSES, SPELL_INDEX, levelUp } from '@lantern/srd';
import { pointInPolygon } from '@lantern/vision';
import { parseCharacter } from './import.ts';
import { d20Test, delCond, filterFor, fireRegion, flr, pushChat, type Ctx, type Effect, type MemberRec, type Room, type RollFn } from './room.ts';
import { MAX_ITEMS, inScene, num, obj, short, str } from './validate.ts';

type Next = (room: Room, m: MemberRec, msg: unknown, rollFn: RollFn, now: number) => Effect;
type Msg = Record<string, unknown>;
type H = (room: Room, m: MemberRec, msg: Msg, rollFn: RollFn, now: number, next: Next) => Effect;

const DENY: Effect = { error: 'no permitido' }, BAD: Effect = { error: 'mensaje inválido' };
const isDM = (m: MemberRec) => m.role === 'dm' || m.role === 'assistant';
const ABIL: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const levelOf = (t: Token) => t.hitDice?.max ?? t.ddb?.level ?? 1;
const say = (room: Room, from: Id, at: number, text: string): ChatMsg => pushChat(room, { id: randomUUID(), from, at, text });
const cx = (room: Room, m: MemberRec, rollFn: RollFn, now: number): Ctx => ({ room, from: m.id, now, rollFn });
const tokenFor = (room: Room, m: MemberRec, id: unknown) => {
  const t = str(id, 64) ? room.scene.tokens.find((x) => x.id === id) : undefined;
  return t && (isDM(m) || t.owners.includes(m.id)) ? t : undefined;
};
const inside = (r: Region, p: Point) => pointInPolygon(p, r.points);
const here = (s: Scene, r: Region, t: Token) => flr(s, r.level) === flr(s, t.level);

// @str, @prof… → números, para que cualquier rollFn (real o de prueba) reciba una expresión sin variables.
function withVars(expr: string, t: Token): string {
  const c = diceContext({ abilities: t.abilities, prof: t.prof, lvl: levelOf(t) });
  return expr.toLowerCase().replace(/@([a-z]+)/g, (all, k: string) => {
    const key = Object.keys(c).filter((x) => k.startsWith(x)).sort((a, b) => b.length - a.length)[0];
    return key ? String(Math.trunc(c[key])) + k.slice(key.length) : all;
  }).replace(/\+-/g, '-').replace(/--/g, '+');
}

// ---- regiones con acción ----
function runAction(room: Room, m: MemberRec, t: Token, r: Region, now: number, chats: ChatMsg[], sends: NonNullable<Effect['sends']>) {
  if (r.action === 'doc') {
    const e = room.journal.find((x) => x.id === r.docId);
    if (!e) return;
    if (e.visibleTo !== 'all') e.visibleTo = [...new Set([...(Array.isArray(e.visibleTo) ? e.visibleTo : []), ...t.owners])];
    sends.push({ who: (x) => t.owners.includes(x.id), msg: { t: 'handout', entry: structuredClone(e) } });
    chats.push(say(room, m.id, now, `${t.name} encuentra «${e.title}»`));
  } else if (r.action === 'encounter') {
    const hid = room.scene.tokens.filter((x) => x.hidden && r.encounter && x.encounter === r.encounter);
    for (const x of hid) x.hidden = false;
    if (hid.length) { sends.push({ who: () => true, msg: { t: 'sfx', name: 'roar' } }); chats.push(say(room, m.id, now, `¡${hid.map((x) => x.name).join(', ')} sale${hid.length > 1 ? 'n' : ''} al encuentro!`)); }
  } else if (r.action === 'scene' && r.sceneId && Object.hasOwn(room.scenes, r.sceneId) && r.sceneId !== room.activeId) {
    room.activeId = r.sceneId; room.pending = []; delete room.combat;
    const pre = room.scene.audioPreset;
    if (pre) { room.audio = structuredClone(pre); if (room.audio.track) room.audio.track.startedAt = now; }
    chats.push(say(room, m.id, now, `${t.name} cruza a «${room.scene.name}»`));
  }
}

// Salidas y acciones al entrar (el trigger 'enter' con efecto de siempre lo dispara room.ts).
function watchMoves(room: Room, m: MemberRec, msg: unknown, rollFn: RollFn, now: number, next: Next): Effect {
  const s = room.scene, before = new Map(s.tokens.map((t) => [t.id, { x: t.x, y: t.y }])), fired0 = new Map((s.regions ?? []).map((r) => [r.id, r.fired]));
  const fx = next(room, m, msg, rollFn, now);
  if (fx.error || room.scene !== s) return fx;
  const chats: ChatMsg[] = [], sends: NonNullable<Effect['sends']> = [], c = cx(room, m, rollFn, now);
  for (const t of s.tokens) {
    const from = before.get(t.id);
    if (!from || (from.x === t.x && from.y === t.y)) continue;
    const to = { x: t.x, y: t.y };
    for (const r of [...(s.regions ?? [])]) {
      if (room.scene !== s) break;
      if (!here(s, r, t) || (r.onlyAllies && t.faction !== 'ally') || (r.once && fired0.get(r.id))) continue;
      if (r.trigger === 'exit' && inside(r, from) && !inside(r, to)) { fireRegion(c, t, r, chats, sends); runAction(room, m, t, r, now, chats, sends); }
      else if (r.action && (r.trigger ?? 'enter') === 'enter' && inside(r, to) && !inside(r, from)) { if (r.once) r.fired = true; runAction(room, m, t, r, now, chats, sends); }
    }
  }
  if (!chats.length && !sends.length) return fx;
  return { ...fx, state: true, chats: [...(fx.chats ?? []), ...chats], sends: [...(fx.sends ?? []), ...sends] };
}

const H: Record<string, H> = {
  reroll(room, m, msg, rollFn, now) {
    if (!str(msg.msgId, 64) || (msg.kind !== 'inspiration' && msg.kind !== 'lucky')) return BAD;
    const t = tokenFor(room, m, msg.tokenId), c = room.chat.find((x) => x.id === msg.msgId);
    if (!t) return { error: 'token inexistente' };
    if (!c?.roll || c.from !== m.id || c.roll.rerolled || c.roll.external) return { error: 'esa tirada no se puede repetir' };
    const i = c.roll.dice?.findIndex((d) => d.sides === 20 && d.kept) ?? -1;
    if (i < 0) return { error: 'solo se repiten tiradas de d20' };
    const old = c.roll.dice![i].value;
    if (msg.kind === 'lucky' && (!t.lucky || old !== 1)) return { error: 'Suerte solo repite un 1 natural' };
    if (msg.kind === 'inspiration' && !t.inspiration) return { error: 'sin Inspiración heroica' };
    const r = rollFn('1d20');
    if (!r || !Number.isInteger(r.total)) return { error: 'tirada inválida' };
    if (msg.kind === 'inspiration') delete t.inspiration;
    c.roll.rerolled = true;
    const why = msg.kind === 'lucky' ? 'Suerte' : 'Inspiración heroica';
    return { state: true, chat: pushChat(room, { id: randomUUID(), from: m.id, at: now, roll: { expr: `${c.roll.expr} (${why})`, total: c.roll.total - old + r.total, detail: `${t.name}: d20 ${old} → ${r.total}`,
      secret: c.roll.secret, ...(c.roll.blind && { blind: true }), dice: [{ sides: 20, value: r.total, kept: true }] } }) };
  },

  rest(room, m, msg, rollFn, now) {
    if (msg.kind !== 'short' && msg.kind !== 'long') return BAD;
    const t = tokenFor(room, m, msg.tokenId);
    if (!t) return { error: 'token inexistente' };
    if (!t.hp) return { error: 'el token no tiene PG' };
    if (t.conditions.includes('dead')) return { error: `${t.name} está muerto` };
    const hd = t.hitDice ?? { die: 8, max: levelOf(t), used: 0 }; // ponytail: sin dados definidos se asume d8
    if (msg.kind === 'long') {
      if (t.hp.cur <= 0) return { error: 'con 0 PG no se aprovecha el descanso largo' };
      const st = longRest({ hp: t.hp, hitDice: hd, slots: t.slots, exhaustion: t.exhaustion });
      t.hp = st.hp; t.hitDice = st.hitDice; if (st.slots) t.slots = st.slots;
      if (t.exhaustion) { t.exhaustion = st.exhaustion; if (!t.exhaustion) { delete t.exhaustion; delCond(t, 'exhaustion'); } }
      delete t.deathSaves;
      return { state: true, chat: say(room, m.id, now, `${t.name} termina un descanso largo: PG ${t.hp.cur}/${t.hp.max}, espacios de conjuro recuperados`) };
    }
    const want = msg.spend === undefined ? 0 : msg.spend;
    if (!Number.isInteger(want) || (want as number) < 0 || (want as number) > 20) return BAD;
    const n = Math.min(want as number, hd.max - hd.used);
    if ((want as number) > 0 && n < 1) return { error: 'no quedan dados de golpe' };
    if (n > 0 && t.hp.cur <= 0) return { error: 'inconsciente: no puede gastar dados de golpe' };
    const con = abilityMod(t.abilities?.con ?? 10);
    let total = 0;
    for (let i = 0; i < n; i++) total += Math.max(0, rollFn(`1d${hd.die}`).total + con);
    const healed = Math.min(t.hp.max - t.hp.cur, total);
    t.hp = { ...t.hp, cur: t.hp.cur + healed }; t.hitDice = { ...hd, used: hd.used + n };
    return { state: true, chat: say(room, m.id, now, `${t.name} hace un descanso corto${n ? `: gasta ${n} d${hd.die} y recupera ${healed} PG` : ''}`) };
  },

  requestRest(room, m, msg, _r, now) {
    if (!isDM(m)) return DENY;
    if (msg.kind !== 'short' && msg.kind !== 'long') return BAD;
    const owners = new Set(room.scene.tokens.filter((t) => t.faction === 'ally').flatMap((t) => t.owners));
    return { chat: say(room, m.id, now, `El DM propone un descanso ${msg.kind === 'long' ? 'largo' : 'corto'}`), sends: [{ who: (x) => owners.has(x.id), msg: { t: 'restRequest', kind: msg.kind } }] };
  },

  levelUp(room, m, msg, rollFn, now) {
    const t = tokenFor(room, m, msg.tokenId);
    if (!t) return { error: 'token inexistente' };
    if (!str(msg.cls, 32) || !Object.hasOwn(CLASSES, msg.cls) || (msg.hp !== 'average' && msg.hp !== 'roll')) return BAD;
    if (t.ddb && t.ddb.id > 0) return { error: 'está vinculado con D&D Beyond: sube de nivel allí y resincroniza' };
    if (!t.abilities || !t.hp) return { error: 'la ficha no tiene características ni PG' };
    const level = levelOf(t);
    if (level >= 20) return { error: 'ya está en nivel 20' };
    const cls = CLASSES[msg.cls];
    let r;
    try { r = levelUp({ level, hp: t.hp, abilities: t.abilities, slots: t.slots, hitDice: t.hitDice }, msg.cls, { hp: msg.hp, rng: () => (rollFn('1d1000').total - 1) / 1000 }); } catch (e) { return { error: (e as Error).message }; }
    t.hp = r.char.hp; t.hitDice = r.char.hitDice; if (cls.cast) t.slots = r.char.slots;
    const prof = proficiencyBonus(r.char.level), d = prof - (t.prof ?? proficiencyBonus(level));
    if (d) { // la competencia sube: solo se ajusta lo que ya era competente (o ataque/CD)
      t.prof = prof;
      for (const a of ABIL) if (t.saves?.[a] !== undefined && t.saves[a]! > abilityMod(t.abilities[a])) t.saves[a]! += d;
      for (const [k, v] of Object.entries(t.skills ?? {})) if (SKILLS[k] && v > abilityMod(t.abilities[SKILLS[k].ability])) t.skills![k] = v + d;
      for (const a of t.actions ?? []) { if (a.toHit !== undefined) a.toHit += d; if (a.save) a.save.dc += d; }
    }
    if (r.asi) t.asi = (t.asi ?? 0) + 1;
    return { state: true, chat: say(room, m.id, now, `${t.name} sube a nivel ${r.char.level} (${cls.name}, +${r.hpGain} PG)${r.asi ? ': toca mejora de característica' : ''}`) };
  },

  abilityUp(room, m, msg, _r, now) {
    const t = tokenFor(room, m, msg.tokenId);
    if (!t) return { error: 'token inexistente' };
    const a = msg.a as Ability, b = msg.b as Ability | undefined;
    if (!ABIL.includes(a) || (b !== undefined && (!ABIL.includes(b) || b === a))) return BAD;
    if (!t.abilities || (t.asi ?? 0) < 1) return { error: 'no tienes mejoras de característica pendientes' };
    const up = b ? [[a, 1], [b, 1]] as const : [[a, 2]] as const;
    if (up.some(([k, n]) => t.abilities![k] + n > 20)) return { error: 'una característica no puede pasar de 20' };
    for (const [k, n] of up) {
      const old = abilityMod(t.abilities[k]);
      t.abilities[k] += n;
      const dm = abilityMod(t.abilities[k]) - old;
      if (!dm) continue;
      if (t.saves?.[k] !== undefined) t.saves[k]! += dm;
      for (const [s, v] of Object.entries(t.skills ?? {})) if (SKILLS[s]?.ability === k) t.skills![s] = v + dm;
      if (k === 'dex' && t.initMod !== undefined) t.initMod += dm;
      if (k === 'con' && t.hp) { const g = dm * levelOf(t); t.hp = { ...t.hp, max: Math.max(1, t.hp.max + g), cur: Math.max(1, t.hp.cur + g) }; }
    }
    t.asi = t.asi! - 1;
    if (!t.asi) delete t.asi;
    return { state: true, chat: say(room, m.id, now, `${t.name} mejora ${up.map(([k, n]) => `${k.toUpperCase()} +${n}`).join(' y ')}`) };
  },

  // Pregenerado o hoja importada: a tu token, a uno libre o a uno nuevo junto al grupo.
  myChar(room, m, msg, rollFn, now, next) {
    if (m.role !== 'player' && m.role !== 'trusted') return DENY;
    const d = parseCharacter(msg.data);
    if (!d) return { error: 'datos de personaje inválidos' };
    const s = room.scene;
    let t = s.tokens.find((x) => x.faction === 'ally' && x.owners.includes(m.id)) ?? s.tokens.find((x) => x.faction === 'ally' && !x.owners.length && !x.hidden);
    if (t && !t.owners.includes(m.id)) t.owners.push(m.id);
    if (!t) {
      if (s.tokens.length >= MAX_ITEMS) return { error: 'demasiados elementos' };
      const g = s.grid.size, ref = s.tokens.find((x) => x.faction === 'ally') ?? { x: s.width / 2, y: s.height / 2 };
      let x = ref.x, y = ref.y;
      for (let k = 1; k < 40 && s.tokens.some((o) => Math.hypot(o.x - x, o.y - y) < g * 0.9); k++) { x = Math.min(s.width, ref.x + (k % 6) * g); y = Math.min(s.height, ref.y + Math.floor(k / 6) * g); }
      t = { id: randomUUID(), name: d.name, x, y, size: 1, faction: 'ally', hidden: false, owners: [m.id], darkvision: d.darkvision, conditions: [] };
      s.tokens.push(t);
    }
    return next(room, m, { t: 'importCharacter', tokenId: t.id, data: msg.data }, rollFn, now);
  },

  unlock(room, m, msg, rollFn, now) {
    if (msg.tool !== 'athletics' && msg.tool !== 'thieves') return BAD;
    const s = room.scene, w = str(msg.wallId, 64) ? s.walls.find((x) => x.id === msg.wallId && x.kind === 'door') : undefined, t = tokenFor(room, m, msg.tokenId);
    if (!w) return { error: 'puerta inexistente' };
    if (!t) return { error: 'token inexistente' };
    if (!w.locked) return { error: 'no está cerrada con llave' };
    if (!isDM(m)) {
      const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
      if (Math.hypot(t.x - mid.x, t.y - mid.y) > 1.5 * s.grid.size) return { error: 'demasiado lejos' };
    }
    const r = msg.tool === 'athletics' ? d20Test(cx(room, m, rollFn, now), t, 'skill', 'athletics') : d20Test(cx(room, m, rollFn, now), t, 'ability', 'dex'), ok = r.total >= (w.lock?.dc ?? 15);
    if (ok) w.locked = false;
    return { state: ok, chat: pushChat(room, { id: randomUUID(), from: m.id, at: now, roll: { expr: `${t.name}: ${msg.tool === 'athletics' ? 'Atletismo' : 'Herramientas de ladrón'} contra la cerradura`, total: r.total, detail: `${r.detail} → ${ok ? '¡se abre!' : 'no cede'}`, secret: false, ...(r.dice && { dice: r.dice }) } }) };
  },

  interact(room, m, msg, rollFn, now) {
    const s = room.scene, t = tokenFor(room, m, msg.tokenId);
    if (!t) return { error: 'token inexistente' };
    const rs = (s.regions ?? []).filter((r) => r.trigger === 'interact' && here(s, r, t) && inside(r, t) && !(r.once && r.fired) && !(r.onlyAllies && t.faction !== 'ally'));
    if (!rs.length) return { error: 'aquí no hay nada con lo que interactuar' };
    const chats: ChatMsg[] = [], sends: NonNullable<Effect['sends']> = [], c = cx(room, m, rollFn, now);
    for (const r of rs) { if (room.scene !== s) break; fireRegion(c, t, r, chats, sends); runAction(room, m, t, r, now, chats, sends); }
    return { state: true, chats, sends };
  },

  loot(room, m, msg, _r, now) {
    if (!isDM(m)) return DENY;
    const ls = msg.lines;
    if (!str(msg.title, 60) || !Array.isArray(ls) || ls.length < 1 || ls.length > 30 || !ls.every((l) => obj(l) && str(l.item, 80) && (l.to === undefined || short(l.to, 40)))) return BAD;
    const lines = ls.map((l: Msg) => ({ item: l.item as string, ...(l.to ? { to: l.to as string } : {}) }));
    return { chat: pushChat(room, { id: randomUUID(), from: m.id, at: now, text: `Botín: ${msg.title}`, loot: { title: msg.title, lines } }) };
  },

  docView(room, m, msg) {
    if (!isDM(m)) return DENY;
    const e = str(msg.entryId, 64) ? room.journal.find((x) => x.id === msg.entryId) : undefined;
    if (!e?.pdf) return { error: 'no es un documento' };
    if (!Number.isInteger(msg.zoom) || (msg.zoom as number) < 25 || (msg.zoom as number) > 500 || (msg.page !== undefined && !(Number.isInteger(msg.page) && (msg.page as number) >= 1 && (msg.page as number) <= 9999))) return BAD;
    return { sends: [{ who: (x) => isDM(x) || e.visibleTo === 'all' || (Array.isArray(e.visibleTo) && e.visibleTo.includes(x.id)), msg: { t: 'docView', entryId: e.id, zoom: msg.zoom as number, ...(msg.page !== undefined && { page: msg.page as number }) } }] };
  },

  pin(room, m, msg) {
    if (!isDM(m)) return DENY;
    const s = room.scene;
    if (msg.op === 'add') {
      if (!inScene(s, msg.x, msg.y) || !num(msg.y) || !str(msg.entryId, 64)) return BAD;
      if (!room.journal.some((e) => e.id === msg.entryId)) return { error: 'no existe' };
      if ((s.pins?.length ?? 0) >= 100) return { error: 'demasiados marcadores' };
      (s.pins ??= []).push({ id: randomUUID(), x: msg.x as number, y: msg.y as number, entryId: msg.entryId });
    } else if (msg.op === 'remove') {
      if (!str(msg.id, 64) || !s.pins?.some((p) => p.id === msg.id)) return { error: 'no existe' };
      s.pins = s.pins.filter((p) => p.id !== msg.id);
      if (!s.pins.length) delete s.pins;
    } else return BAD;
    return { state: true };
  },
};

export function handleExtras(room: Room, m: MemberRec, msg: unknown, rollFn: RollFn, now: number, next: Next): Effect {
  if (!obj(msg) || typeof msg.t !== 'string') return next(room, m, msg, rollFn, now);
  if (Object.hasOwn(H, msg.t)) return m.role === 'spectator' ? DENY : H[msg.t](room, m, msg, rollFn, now, next);
  if (m.role === 'spectator') return next(room, m, msg, rollFn, now);
  if (msg.t === 'roll' && typeof msg.expr === 'string' && msg.expr.includes('@')) { // variables del personaje (el de la petición o el primero propio)
    const t = tokenFor(room, m, msg.as) ?? room.scene.tokens.find((x) => x.owners.includes(m.id));
    if (!t) return { error: 'necesitas un personaje para usar @variables' };
    const fx = next(room, m, { ...msg, expr: withVars(msg.expr, t) }, rollFn, now);
    if (fx.chat?.roll) fx.chat.roll.expr = msg.expr;
    return fx;
  }
  if (msg.t === 'moveToken' || msg.t === 'moveMany') return watchMoves(room, m, msg, rollFn, now, next);
  if (msg.t === 'act' && str(msg.tokenId, 64) && str(msg.actionId, 64)) { // silencio: sin componente verbal
    const s = room.scene, tk = s.tokens.find((x) => x.id === msg.tokenId), a = tk?.actions?.find((x) => x.id === msg.actionId);
    if (tk && a && (a.slot || SPELL_INDEX[a.id]?.components.includes('V')) && (s.regions ?? []).some((r) => r.action === 'silence' && here(s, r, tk) && inside(r, tk)))
      return { chat: say(room, m.id, now, `${tk.name} está en una zona de silencio: no puede lanzar ${a.name} (componente verbal)`) };
  }
  return next(room, m, msg, rollFn, now);
}

// Lo que el filtro de room.ts no conoce: al jugador no le llegan etiquetas de encuentro, CD de cerraduras ni marcadores de entradas que no puede leer.
export function finishState(_room: Room, m: MemberRec, st: ClientState): ClientState {
  if (isDM(m)) return st;
  const s = st.scene;
  for (const t of s.tokens) delete t.encounter;
  s.walls = s.walls.map((w) => { if (!w.lock) return w; const { lock: _l, ...r } = w; return r; });
  if (s.pins) { const ok = new Set(st.journal.map((e) => e.id)); s.pins = s.pins.filter((p) => ok.has(p.entryId)); if (!s.pins.length) delete s.pins; }
  return st;
}

// Vista «como jugador»: el estado filtrado de ese miembro, solo para el DM.
export function asPlayer(room: Room, m: MemberRec, msg: unknown, online: ReadonlySet<Id>): { error: string } | { state: ClientState } {
  if (!isDM(m)) return { error: 'no permitido' };
  const id = obj(msg) ? msg.memberId : undefined, target = id === null ? m : str(id, 64) ? room.members.get(id) : undefined;
  if (!target) return { error: 'miembro inexistente' };
  return { state: finishState(room, target, filterFor(room, target, online)) };
}
