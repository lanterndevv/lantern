// Mundo compartido: susurros, dibujo, cursores, deshacer, reloj, tablas, imágenes, formaciones y montura/agarre.
// Todo entra por `handleWorld`, que envuelve al `handle` de room.ts (solo tipos importados: sin ciclo en ejecución).
import { randomUUID } from 'node:crypto';
import type { ChatMsg, Drawing, Id, Point, Scene, Token } from '@lantern/protocol';
import type { Effect, MemberRec, Room, RollFn } from './room.ts';
import { canReadDoc } from './perms.ts';
import { inScene, inr, obj, parseLevel, str, urlOk } from './validate.ts';

type Base = (room: Room, m: MemberRec, msg: unknown, rollFn: RollFn, now: number) => Effect;
type H = (room: Room, m: MemberRec, msg: Record<string, unknown>, rollFn: RollFn, now: number, base: Base) => Effect;

const DENY: Effect = { error: 'no permitido' }, BAD: Effect = { error: 'mensaje inválido' };
const isDM = (m: MemberRec) => m.role === 'dm' || m.role === 'assistant';
const flr = (s: Scene, l?: Id) => l === s.levels?.[0]?.id ? undefined : l;
const MAX_UNDO = 30, MAX_DRAWINGS = 300;

export const clockOf = (room: Room) => room.clock ?? 480; // minutos; 480 = 8:00 del día 0

// Susurro que este miembro no debe ver (canSee y redact de room.ts).
export const hiddenWhisper = (c: ChatMsg, m: MemberRec) => !!c.to && !isDM(m) && c.from !== m.id && !c.to.includes(m.id);

// Luz global según la hora: noche 20:00–5:00 = 0, amanecer 5–7 y atardecer 18–20 en rampa, día = 1.
export function daylight(clock: number) {
  const h = (((clock % 1440) + 1440) % 1440) / 60;
  return Math.round((h < 5 || h >= 20 ? 0 : h < 7 ? (h - 5) / 2 : h < 18 ? 1 : (20 - h) / 2) * 100) / 100;
}

// ---- estado en memoria por mesa ----
type Mv = { id: Id; x: number; y: number; level?: Id; moved?: number };
type Entry = { sceneId: Id; by: Id; kind: string; json: string; touched: Set<Id>; mv: Mv[]; main?: Id };
const worlds = new WeakMap<Room, { undo: Entry[]; cur: Map<Id, number[]> }>();
const W = (room: Room) => { let w = worlds.get(room); if (!w) worlds.set(room, w = { undo: [], cur: new Map() }); return w; };

const say = (room: Room, from: Id, at: number, text: string): ChatMsg => {
  const c: ChatMsg = { id: randomUUID(), from, at, text };
  room.chat.push(c);
  if (room.chat.length > 200) room.chat.splice(0, room.chat.length - 200);
  return c;
};

// Las luces con `follow` se colocan sobre su token.
function followLights(s: Scene, ids: ReadonlySet<Id>) {
  for (const l of s.lights) {
    const t = l.follow !== undefined && ids.has(l.follow) ? s.tokens.find((x) => x.id === l.follow) : undefined;
    if (t) { l.x = t.x; l.y = t.y; if (t.level) l.level = t.level; else delete l.level; }
  }
}

// Tras cualquier cambio de posición: los llevados (carriedBy, en cadena) se desplazan igual y las luces siguen a su token.
function sync(s: Scene, before: Map<Id, { x: number; y: number }>) {
  const moved = new Map<Id, Point>();
  for (const t of s.tokens) { const p = before.get(t.id); if (p && (p.x !== t.x || p.y !== t.y)) moved.set(t.id, { x: t.x - p.x, y: t.y - p.y }); }
  if (!moved.size) return;
  const own = new Set(moved.keys()), queue = [...moved.keys()];
  for (let i = 0; i < queue.length; i++) {
    const d = moved.get(queue[i])!;
    for (const c of s.tokens) if (c.carriedBy === queue[i] && !own.has(c.id) && !moved.has(c.id)) { // ya movido por su cuenta = no se suma
      c.x = Math.min(s.width, Math.max(0, c.x + d.x)); c.y = Math.min(s.height, Math.max(0, c.y + d.y));
      moved.set(c.id, d); queue.push(c.id);
    }
  }
  followLights(s, new Set(moved.keys()));
}

// ---- deshacer ----
const SNAP = new Set(['upsert', 'remove', 'moveToken', 'moveMany', 'door', 'spawn', 'spawnMany', 'spawnCustom', 'scene', 'hp', 'condition', 'concentration', 'deathSave',
  'claim', 'act', 'confirm', 'importCharacter', 'heroPoint', 'heroPoints', 'tokenImage', 'carry']);

// ponytail: instantánea = JSON de toda la escena (hasta 30 por mesa); diff por token para saber qué tocó cada cambio. Cambios de combate/chat no se deshacen.
function snapped(room: Room, m: MemberRec, t: string, run: () => Effect, main?: Id): Effect {
  const s = room.scene, json = JSON.stringify(s), before = new Map(s.tokens.map((k) => [k.id, { x: k.x, y: k.y, level: k.level, js: JSON.stringify(k), moved: room.combat?.used[k.id]?.moved }]));
  const fx = run();
  if (fx.error || room.scene !== s) return fx;
  sync(s, before);
  if (!fx.state) return fx;
  const after = JSON.stringify(s);
  if (after === json) return fx;
  const touched = new Set<Id>(), mv: Mv[] = [];
  for (const k of s.tokens) { const b = before.get(k.id); if (!b || b.js !== JSON.stringify(k)) touched.add(k.id); }
  for (const [id, b] of before) {
    const k = s.tokens.find((x) => x.id === id);
    if (!k) touched.add(id);
    else if (k.x !== b.x || k.y !== b.y || k.level !== b.level) mv.push({ id, x: b.x, y: b.y, ...(b.level !== undefined && { level: b.level }), ...(b.moved !== undefined && { moved: b.moved }) });
  }
  const u = W(room).undo;
  u.push({ sceneId: room.activeId, by: m.id, kind: t, json, touched, mv, ...(main !== undefined && { main }) });
  if (u.length > MAX_UNDO) u.shift();
  return fx;
}

// Índice de la entrada que este miembro puede deshacer (-1 = ninguna). Jugador: su último movimiento, si nada posterior tocó esos tokens y sigue siendo su turno.
function undoIndex(room: Room, m: MemberRec): number {
  const u = W(room).undo;
  if (m.role === 'spectator') return -1;
  if (isDM(m)) { for (let i = u.length - 1; i >= 0; i--) if (u[i].sceneId === room.activeId) return i; return -1; }
  const i = u.findLastIndex((e) => e.by === m.id && (e.kind === 'moveToken' || e.kind === 'moveMany'));
  const e = u[i];
  if (!e || e.sceneId !== room.activeId || !e.mv.length) return -1;
  if (u.slice(i + 1).some((l) => e.mv.some((p) => l.touched.has(p.id)))) return -1;
  const s = room.scene, c = room.combat;
  if (c && (e.kind !== 'moveToken' || c.order[c.turn]?.tokenId !== e.main)) return -1;
  return e.mv.every((p) => s.tokens.some((t) => t.id === p.id)) ? i : -1;
}
export const canUndo = (room: Room, m: MemberRec) => undoIndex(room, m) >= 0;

const setPos = (t: Token | undefined, p: Mv) => { if (!t) return; t.x = p.x; t.y = p.y; if (p.level !== undefined) t.level = p.level; else delete t.level; };

// ---- manejadores ----
const HANDLERS: Record<string, H> = {
  chat(room, m, msg, _r, now) {
    if (!str(msg.text, 500)) return BAD;
    const c: ChatMsg = { id: randomUUID(), from: m.id, at: now, text: msg.text };
    if (msg.to !== undefined) {
      if (!Array.isArray(msg.to) || msg.to.length < 1 || msg.to.length > 10 || !msg.to.every((x) => str(x, 64))) return BAD;
      if (!msg.to.every((x) => room.members.has(x))) return { error: 'miembro inexistente' };
      c.to = [...new Set(msg.to as Id[])];
    }
    if (msg.as !== undefined) {
      const t = str(msg.as, 64) ? room.scene.tokens.find((x) => x.id === msg.as) : undefined;
      if (!t) return { error: 'token inexistente' };
      if (!isDM(m) && !t.owners.includes(m.id)) return DENY;
      c.as = t.name; // ponytail: si el token no es visible para algún receptor, el nombre se muestra igual (habla en voz alta)
    }
    if (msg.emote !== undefined) { if (typeof msg.emote !== 'boolean') return BAD; if (msg.emote) c.emote = true; }
    room.chat.push(c);
    if (room.chat.length > 200) room.chat.splice(0, room.chat.length - 200);
    return { chat: c };
  },

  draw(room, m, msg) {
    const s = room.scene, it = msg.item;
    if (typeof msg.persist !== 'boolean' || !obj(it) || !str(it.id, 64) || !Array.isArray(it.points) || it.points.length < 1 || it.points.length > 500) return BAD;
    if (!it.points.every((p) => obj(p) && inScene(s, p.x, p.y))) return BAD;
    if (typeof it.color !== 'string' || !/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(it.color) || !inr(it.width, 1, 20)) return BAD;
    const level = parseLevel(s, it.level);
    if (level === null) return BAD;
    const d: Drawing = { id: it.id, points: it.points.map((p: Point) => ({ x: p.x, y: p.y })), color: it.color, width: it.width, by: m.id, ...(level !== undefined && { level }) };
    if (!msg.persist) return { all: { t: 'draw', item: d } };
    if (!isDM(m) && (m.role === 'trusted' || m.role === 'player' ? (room.settings as { drawing?: string }).drawing !== 'all' : true)) return DENY;
    const list = (s.drawings ??= []);
    if (list.some((x) => x.id === d.id)) return { error: 'ya existe' };
    if (list.length >= MAX_DRAWINGS) return { error: 'demasiados dibujos' };
    list.push(d);
    return { state: true };
  },

  erase(room, m, msg) {
    const s = room.scene, list = s.drawings ?? [];
    if (msg.id === 'all') { if (!isDM(m)) return DENY; s.drawings = []; return { state: true }; }
    if (msg.id === 'mine') { s.drawings = list.filter((d) => d.by !== m.id); return { state: true }; }
    if (!str(msg.id, 64)) return BAD;
    const d = list.find((x) => x.id === msg.id);
    if (!d) return { error: 'no existe' };
    if (!isDM(m) && d.by !== m.id) return DENY;
    s.drawings = list.filter((x) => x !== d);
    return { state: true };
  },

  cursor(room, m, msg, _r, now) {
    const s = room.scene;
    if (m.role === 'spectator') return {};
    if (!inScene(s, msg.x, msg.y)) return BAD;
    const w = W(room), log = (w.cur.get(m.id) ?? []).filter((t) => now - t < 1000);
    if (log.length >= 15) return {}; // 15 por segundo y miembro
    log.push(now); w.cur.set(m.id, log);
    const floors = (id: Id) => { const f = new Set(s.tokens.filter((t) => t.owners.includes(id)).map((t) => flr(s, t.level))); if (!f.size) f.add(undefined); return f; };
    const mine = floors(m.id); // ponytail: sin filtrar por visión, solo por planta
    return { sends: [{ who: (x) => x.id !== m.id && (isDM(x) || [...floors(x.id)].some((f) => mine.has(f))), msg: { t: 'cursor', from: m.id, x: msg.x, y: msg.y as number } }] };
  },

  focusAll(room, m, msg) {
    if (!isDM(m)) return DENY;
    if (!inScene(room.scene, msg.x, msg.y)) return BAD;
    return { all: { t: 'focus', x: msg.x, y: msg.y as number } };
  },

  undo(room, m) {
    const i = undoIndex(room, m);
    if (i < 0) return { error: 'nada que deshacer' };
    const u = W(room).undo, [e] = u.splice(i, 1);
    if (isDM(m)) { room.scene = JSON.parse(e.json); return { state: true }; }
    const s = room.scene;
    for (const p of e.mv) {
      setPos(s.tokens.find((t) => t.id === p.id), p);
      const used = room.combat?.used[p.id];
      if (used) used.moved = p.moved ?? 0; // devuelve el movimiento gastado
    }
    followLights(s, new Set(e.mv.map((p) => p.id)));
    for (const l of u.slice(i)) { // las instantáneas posteriores también parten de la posición deshecha
      if (l.sceneId !== e.sceneId) continue;
      const sc = JSON.parse(l.json) as Scene;
      for (const p of e.mv) setPos(sc.tokens.find((t) => t.id === p.id), p);
      l.json = JSON.stringify(sc);
    }
    return { state: true };
  },

  clock(room, m, msg, _r, now) {
    if (!isDM(m)) return DENY;
    const a = msg.advance;
    if (!Number.isInteger(a) || (a as number) < -1440 || (a as number) > 43200) return BAD;
    const c = room.clock = Math.max(0, clockOf(room) + (a as number)), chats: ChatMsg[] = [];
    for (const sc of Object.values(room.scenes)) {
      if (sc.outdoor) sc.globalLight = daylight(c);
      const out = sc.lights.filter((l) => l.burnUntil !== undefined && l.burnUntil <= c);
      if (!out.length) continue;
      if (sc === room.scene) for (const l of out) { const t = sc.tokens.find((x) => x.id === l.follow); chats.push(say(room, m.id, now, t ? `La antorcha de ${t.name} se apaga` : 'Una antorcha se apaga')); }
      sc.lights = sc.lights.filter((l) => !out.includes(l));
    }
    return { state: true, chats };
  },

  rollTable(room, m, msg, rollFn, now) {
    const e = str(msg.entryId, 64) ? room.journal.find((x) => x.id === msg.entryId) : undefined;
    if (!e || !canReadDoc(e, m)) return { error: 'no existe' };
    if (!e.table) return { error: 'no es una tabla' };
    if (msg.secret !== undefined && typeof msg.secret !== 'boolean') return BAD;
    let r;
    try { r = rollFn(e.table.dice); } catch { return { error: 'expresión inválida' }; }
    const row = e.table.rows.find((x) => r.total >= x.min && r.total <= x.max);
    if (!row) return { error: `sin resultado para ${r.total}` };
    const c: ChatMsg = { id: randomUUID(), from: m.id, at: now, roll: { expr: `Tabla ${e.title}: ${row.text}`, total: r.total, detail: r.detail, secret: msg.secret === true, ...(Array.isArray(r.dice) && { dice: r.dice }) } };
    room.chat.push(c);
    if (room.chat.length > 200) room.chat.splice(0, room.chat.length - 200);
    return { chat: c };
  },

  tokenImage(room, m, msg) {
    const t = str(msg.tokenId, 64) ? room.scene.tokens.find((x) => x.id === msg.tokenId) : undefined;
    if (!urlOk(msg.img)) return BAD;
    if (!t) return { error: 'token inexistente' };
    if (!isDM(m) && !t.owners.includes(m.id)) return DENY;
    t.img = msg.img;
    return { state: true };
  },

  // Todo o nada: cada paso pasa por el moveToken de room.ts; si uno falla, se restaura la escena, el combate y el chat.
  moveMany(room, m, msg, rollFn, now, base) {
    const mv = msg.moves;
    if (!Array.isArray(mv) || mv.length < 1 || mv.length > 12 || !mv.every((x) => obj(x) && str(x.id, 64)) || new Set(mv.map((x) => x.id)).size !== mv.length) return BAD;
    const scene = structuredClone(room.scene), combat = structuredClone(room.combat), chat = [...room.chat], pending = [...room.pending];
    const out: Effect = { state: true, chats: [], sends: [] };
    for (const x of mv) {
      const fx = base(room, m, { t: 'moveToken', id: x.id, x: x.x, y: x.y }, rollFn, now);
      if (fx.error) {
        room.scene = scene; if (combat) room.combat = combat; else delete room.combat;
        room.chat.splice(0, room.chat.length, ...chat); room.pending.splice(0, room.pending.length, ...pending);
        return { error: `${x.id}: ${fx.error}` };
      }
      out.chats!.push(...(fx.chats ?? [])); out.sends!.push(...(fx.sends ?? []));
    }
    return out;
  },

  carry(room, m, msg) {
    const s = room.scene, dm = isDM(m);
    if (!str(msg.tokenId, 64) || (msg.by !== null && !str(msg.by, 64))) return BAD;
    const t = s.tokens.find((x) => x.id === msg.tokenId);
    if (!t) return { error: 'token inexistente' };
    if (msg.by === null) {
      if (!t.carriedBy) return { error: 'no lo lleva nadie' };
      const c = s.tokens.find((x) => x.id === t.carriedBy);
      if (!dm && !t.owners.includes(m.id) && !c?.owners.includes(m.id)) return DENY;
      delete t.carriedBy;
      return { state: true };
    }
    const b = s.tokens.find((x) => x.id === msg.by);
    if (!b || b === t) return { error: 'token inexistente' };
    if (!dm) {
      if (!b.owners.includes(m.id)) return DENY;
      // solo se carga lo propio, a un aliado o a quien ya está apresado (la condición la pone el DM o la tirada de agarre)
      if (!t.owners.includes(m.id) && t.faction !== 'ally' && !t.conditions.includes('grappled')) return DENY;
      if (t.hidden || flr(s, t.level) !== flr(s, b.level)) return { error: 'token inexistente' };
      // contiguo a 5 pies o menos (bordes): distancia entre centros ≤ 5 × (tamaño medio) con la regla 5-5-5
      if (Math.max(Math.abs(t.x - b.x), Math.abs(t.y - b.y)) / s.grid.size * s.grid.feet > 5 * (t.size + b.size) / 2 + 1e-6) return { error: 'demasiado lejos' };
      if (t.carriedBy && t.carriedBy !== b.id) return { error: 'ya lo lleva otro' };
    }
    let c: Token | undefined = b;
    for (let i = 0; c && i <= s.tokens.length; i++, c = s.tokens.find((x) => x.id === c!.carriedBy)) if (c.id === t.id) return { error: 'no se permiten ciclos' };
    t.carriedBy = b.id;
    return { state: true };
  },
};

export function handleWorld(room: Room, m: MemberRec, msg: unknown, rollFn: RollFn, now: number, base: Base): Effect {
  if (!obj(msg) || typeof msg.t !== 'string') return base(room, m, msg, rollFn, now);
  const t = msg.t;
  // 'clock' sin `advance` es la sincronización de reloj del servidor (room.ts); 'chat' sin campos nuevos sigue por el camino antiguo
  const own = Object.hasOwn(HANDLERS, t) && (t !== 'clock' || 'advance' in msg) && (t !== 'chat' || 'to' in msg || 'as' in msg || 'emote' in msg);
  if (!own && !SNAP.has(t)) return base(room, m, msg, rollFn, now);
  if (m.role === 'spectator') return t === 'cursor' ? {} : DENY;
  const run = () => own ? HANDLERS[t](room, m, msg, rollFn, now, base) : base(room, m, msg, rollFn, now);
  if (!SNAP.has(t)) return run();
  return snapped(room, m, t, run, t === 'moveToken' && str(msg.id, 64) ? msg.id : undefined); // main: token movido, para comprobar el turno al deshacer
}
