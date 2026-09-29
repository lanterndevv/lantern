// Lógica pura de una mesa: sin sockets ni BD. Todo lo que llega de un cliente se valida aquí.
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { CODE_ALPHABET, DICE_THEMES, blocksMove } from '@lantern/protocol';
import type { ActionCard, C2S, ChatMsg, ClientState, Combat, DiceTheme, Die, Id, Light, Member, Point, Role, Scene, Token, Wall } from '@lantern/protocol';
import { applyCard, resolveAction } from '@lantern/rules';
import { MONSTERS } from '@lantern/srd';
import { parseCharacter } from './import.ts';
import { demoScene } from '@lantern/protocol/demo';
import { cover, pointInPolygon, sightSegments, visibility } from '@lantern/vision';

export type MemberRec = { id: Id; name: string; role: Role; keyHash: string; dice: DiceTheme };
export type Room = { code: string; scene: Scene; members: Map<Id, MemberRec>; chat: ChatMsg[]; automation: 'assisted' | 'auto'; combat?: Combat; pending: ActionCard[] };
export type RollFn = (expr: string) => { total: number; detail: string; dice?: Die[] };
export type Effect = { error?: string; state?: boolean; chat?: ChatMsg; chats?: ChatMsg[]; ping?: { from: Id; x: number; y: number } };

const MAX_CHAT = 200, MAX_ITEMS = 500;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const normCode = (s: string) => s.toUpperCase().replace(/[\s-]/g, '');
export const genCode = (taken: (c: string) => boolean = () => false) => {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!taken(c)) return c;
  }
};

// ---- unirse ----
function addMember(room: Room, name: string, role: Role) {
  const key = randomBytes(24).toString('base64url');
  const m: MemberRec = { id: randomUUID(), name, role, keyHash: sha(key), dice: 'linterna' };
  room.members.set(m.id, m);
  return { member: m, key };
}

export function createRoom(name: unknown, code: string, scene: Scene = demoScene()): { error: string } | { room: Room; member: MemberRec; key: string } {
  const n = cleanName(name);
  if (!n) return { error: 'nombre inválido' };
  const room: Room = { code, scene, members: new Map(), chat: [], automation: 'assisted', pending: [] };
  return { room, ...addMember(room, n, 'dm') };
}

function cleanName(name: unknown) {
  if (typeof name !== 'string') return null;
  const n = name.trim();
  return n.length >= 1 && n.length <= 32 ? n : null;
}

export function joinRoom(room: Room, name: unknown, key: unknown): { member: MemberRec; key?: string } | { error: string } {
  if (key !== undefined) {
    if (typeof key !== 'string' || key.length > 200) return { error: 'key inválida' };
    const h = sha(key);
    for (const m of room.members.values()) if (m.keyHash === h) return { member: m };
    return { error: 'key inválida' };
  }
  const n = cleanName(name);
  if (!n) return { error: 'nombre inválido' };
  const r = addMember(room, n, 'player');
  // ponytail: selector de personaje más adelante
  const tk = room.scene.tokens.find((t) => t.faction === 'ally' && t.owners.length === 0);
  if (tk) tk.owners.push(r.member.id);
  return r;
}

// ---- filtrado por miembro ----
export function filterFor(room: Room, member: MemberRec, online: ReadonlySet<Id> = new Set()): ClientState {
  const members: Member[] = [...room.members.values()].map((m) => ({ id: m.id, name: m.name, role: m.role, online: online.has(m.id), dice: m.dice }));
  const s = room.scene;
  const automation = room.automation;
  if (member.role === 'dm' || member.role === 'assistant') return { code: room.code, members, scene: structuredClone(s), automation, ...(room.combat && { combat: structuredClone(room.combat) }) };

  const segs = sightSegments(s.walls);
  const visible = s.tokens
    .filter((t) => t.faction === 'ally' && t.owners.length > 0)
    .map((t) => visibility({ x: t.x, y: t.y }, segs, s.width, s.height));
  const seen = (p: Point) => visible.some((poly) => pointInPolygon(p, poly));
  const tokens = s.tokens
    .filter((t) => !t.hidden && (t.faction === 'ally' || seen(t)))
    .map((t) => {
      const c = structuredClone(t);
      if (t.faction !== 'ally') { delete c.hp; delete c.ac; }
      return c;
    });
  const walls = s.walls.map((w): Wall => {
    if (!w.secret) return { ...w };
    const { secret: _s, open: _o, ...rest } = w; // una puerta secreta se ve como muro (y no revela si está abierta)
    return { ...rest, kind: 'wall' };
  });
  // ponytail: luces filtradas solo por su centro; un halo que asome desde fuera de la visión no se distingue
  const lights = s.lights.filter((l) => seen(l));
  const ids = new Set(tokens.map((t) => t.id));
  let combat: Combat | undefined;
  if (room.combat) {
    const c = room.combat, order = c.order.filter((o) => ids.has(o.tokenId));
    // turno oculto: apunta al último visible anterior (o -1)
    let turn = -1;
    for (let i = Math.min(c.turn, c.order.length - 1); i >= 0 && turn < 0; i--) turn = order.findIndex((o) => o.tokenId === c.order[i].tokenId);
    combat = { round: c.round, turn, order, used: Object.fromEntries(Object.entries(c.used).filter(([id]) => ids.has(id))) };
  }
  return { code: room.code, members, visible, scene: { ...structuredClone(s), walls, lights, tokens }, automation, ...(combat && { combat }) };
}

export function chatFor(room: Room, m: MemberRec) {
  const vis = m.role === 'dm' || m.role === 'assistant' ? undefined : new Set(filterFor(room, m).scene.tokens.map((t) => t.id));
  return room.chat.filter((c) => canSee(c, m)).map((c) => redact(room, c, m, vis));
}
// Tarjeta para un jugador: lo que no ve sale como '???' y las CD ajenas se ocultan. La CA nunca viaja en la tarjeta.
export function redact(room: Room, c: ChatMsg, m: MemberRec, vis?: Set<Id>): ChatMsg {
  if (!c.card || m.role === 'dm' || m.role === 'assistant') return c;
  const v = vis ?? new Set(filterFor(room, m).scene.tokens.map((t) => t.id));
  const card = structuredClone(c.card);
  const own = room.scene.tokens.find((t) => t.id === card.actorId)?.owners.includes(m.id) ?? false;
  const hide: string[] = [];
  if (!v.has(card.actorId)) { hide.push(card.actorName); card.actorName = '???'; card.actorId = '???'; }
  card.targets.forEach((t, i) => {
    if (!v.has(t.id)) { hide.push(t.name); t.name = '???'; t.id = '???' + i; }
    if (t.save && !own) delete (t.save as { dc?: number }).dc; // ponytail: el contrato tipa dc como number; el cliente debe tolerar su ausencia
  });
  if (card.detail) for (const h of hide) card.detail = card.detail.replaceAll(h, '???');
  return { ...c, card };
}
export const canSee = (c: ChatMsg, m: MemberRec) =>
  !c.roll?.secret || c.from === m.id || m.role === 'dm' || m.role === 'assistant';

// ---- validación ----
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length >= 1 && v.length <= max;
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inScene = (s: Scene, x: unknown, y: unknown): x is number => num(x) && num(y) && x >= 0 && x <= s.width && y >= 0 && y <= s.height;
const pt = (s: Scene, p: unknown): Point | null =>
  obj(p) && inScene(s, p.x, p.y) ? { x: p.x as number, y: p.y as number } : null;

function parseToken(s: Scene, v: unknown): Token | null {
  if (!obj(v) || !str(v.id, 64) || !str(v.name, 64) || !inScene(s, v.x, v.y)) return null;
  if (!num(v.size) || v.size <= 0 || v.size > 20 || !num(v.darkvision) || v.darkvision < 0) return null;
  if (v.faction !== 'ally' && v.faction !== 'enemy' && v.faction !== 'neutral') return null;
  if (typeof v.hidden !== 'boolean' || !Array.isArray(v.owners) || v.owners.length > 50 || !v.owners.every((o) => str(o, 64))) return null;
  if (!Array.isArray(v.conditions) || v.conditions.length > 50 || !v.conditions.every((o) => str(o, 64))) return null;
  const t: Token = { id: v.id, name: v.name, x: v.x as number, y: v.y as number, size: v.size, faction: v.faction, hidden: v.hidden,
    owners: [...v.owners] as string[], darkvision: v.darkvision, conditions: [...v.conditions] as string[] };
  if (v.img !== undefined) { if (!str(v.img, 512) || !/^(https?:\/\/|\/)/.test(v.img)) return null; t.img = v.img; }
  if (v.ac !== undefined) { if (!num(v.ac)) return null; t.ac = v.ac; }
  if (v.hp !== undefined) {
    const h = v.hp;
    if (!obj(h) || !num(h.cur) || !num(h.max) || !num(h.temp)) return null;
    t.hp = { cur: h.cur, max: h.max, temp: h.temp };
  }
  return t;
}

function parseWall(s: Scene, v: unknown): Wall | null {
  if (!obj(v) || !str(v.id, 64)) return null;
  const a = pt(s, v.a), b = pt(s, v.b);
  if (!a || !b || !['wall', 'door', 'window', 'terrain'].includes(v.kind as string)) return null;
  const w: Wall = { id: v.id, a, b, kind: v.kind as Wall['kind'] };
  if (v.open !== undefined) { if (typeof v.open !== 'boolean') return null; w.open = v.open; }
  if (v.secret !== undefined) { if (typeof v.secret !== 'boolean') return null; w.secret = v.secret; }
  return w;
}

function parseLight(s: Scene, v: unknown): Light | null {
  if (!obj(v) || !str(v.id, 64) || !inScene(s, v.x, v.y)) return null;
  if (!num(v.bright) || !num(v.dim) || v.bright < 0 || v.dim < 0) return null;
  if (typeof v.color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(v.color)) return null;
  const l: Light = { id: v.id, x: v.x as number, y: v.y as number, bright: v.bright, dim: v.dim, color: v.color };
  if (v.anim !== undefined) { if (v.anim !== 'none' && v.anim !== 'torch' && v.anim !== 'pulse') return null; l.anim = v.anim; }
  return l;
}

// ¿el segmento p1-p2 corta (o toca) q1-q2?
function cross(p1: Point, p2: Point, q1: Point, q2: Point) {
  const o = (a: Point, b: Point, c: Point) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const on = (a: Point, b: Point, c: Point) =>
    Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);
  const o1 = o(p1, p2, q1), o2 = o(p1, p2, q2), o3 = o(q1, q2, p1), o4 = o(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && on(p1, p2, q1)) || (o2 === 0 && on(p1, p2, q2)) || (o3 === 0 && on(q1, q2, p1)) || (o4 === 0 && on(q1, q2, p2));
}

export const pathBlocked = (s: Scene, from: Point, to: Point) => s.walls.some((w) => blocksMove(w) && cross(from, to, w.a, w.b));

// ---- mutaciones ----
const DENY: Effect = { error: 'no permitido' };
const isDM = (m: MemberRec) => m.role === 'dm' || m.role === 'assistant';

export function handle(room: Room, m: MemberRec, msg: unknown, rollFn: RollFn, now = Date.now()): Effect {
  if (!obj(msg) || typeof msg.t !== 'string') return { error: 'mensaje inválido' };
  const m2 = msg as C2S & Record<string, unknown>;
  const s = room.scene;
  const role = m.role;
  if (m2.t === 'diceTheme') { // cualquier miembro, espectadores incluidos
    if (!DICE_THEMES.includes(m2.theme as DiceTheme)) return { error: 'mensaje inválido' };
    m.dice = m2.theme as DiceTheme;
    return { state: true };
  }
  if (role === 'spectator') return DENY;

  switch (m2.t) {
    case 'moveToken': {
      if (!str(m2.id, 64) || !inScene(s, m2.x, m2.y)) return { error: 'mensaje inválido' };
      const t = s.tokens.find((t) => t.id === m2.id);
      if (!t) return { error: 'token inexistente' };
      const to = { x: m2.x as number, y: m2.y as number };
      if (!isDM(m)) {
        if (role === 'trusted' ? t.faction !== 'ally' : !t.owners.includes(m.id)) return DENY;
        // trusted no está sujeto a muros (solo el jugador raso), según el plan
        if (role === 'player' && pathBlocked(s, t, to)) return { error: 'camino bloqueado' };
      }
      const cb = room.combat;
      if (cb && !isDM(m)) {
        if (cb.order[cb.turn]?.tokenId !== t.id) return { error: 'no es su turno' };
        // regla 5-5-5: cada movimiento cuesta max(|dx|,|dy|) casillas × pies por casilla
        const feet = Math.max(Math.abs(to.x - t.x), Math.abs(to.y - t.y)) / s.grid.size * s.grid.feet;
        const u = (cb.used[t.id] ??= { action: false, bonus: false, reaction: false, moved: 0 });
        const speed = t.speed ?? 30;
        if (u.moved + feet > speed + 1e-6) return { error: `sin movimiento: te quedan ${Math.max(0, Math.floor(speed - u.moved))} pies` };
        u.moved += feet;
      }
      t.x = to.x; t.y = to.y;
      return { state: true };
    }
    case 'upsert': {
      if (!isDM(m)) return DENY;
      const list = m2.kind === 'token' ? s.tokens : m2.kind === 'wall' ? s.walls : m2.kind === 'light' ? s.lights : null;
      const item = m2.kind === 'token' ? parseToken(s, m2.item) : m2.kind === 'wall' ? parseWall(s, m2.item) : m2.kind === 'light' ? parseLight(s, m2.item) : null;
      if (!list || !item) return { error: 'mensaje inválido' };
      const i = (list as { id: Id }[]).findIndex((e) => e.id === item.id);
      if (i >= 0) (list as unknown[])[i] = item;
      else if (list.length >= MAX_ITEMS) return { error: 'demasiados elementos' };
      else (list as unknown[]).push(item);
      return { state: true };
    }
    case 'remove': {
      if (!isDM(m)) return DENY;
      if (!str(m2.id, 64) || (m2.kind !== 'token' && m2.kind !== 'wall' && m2.kind !== 'light')) return { error: 'mensaje inválido' };
      const k = m2.kind === 'token' ? 'tokens' : m2.kind === 'wall' ? 'walls' : 'lights';
      const list = s[k] as { id: Id }[];
      const i = list.findIndex((e) => e.id === m2.id);
      if (i < 0) return { error: 'no existe' };
      list.splice(i, 1);
      return { state: true };
    }
    case 'door': {
      if (!str(m2.id, 64) || typeof m2.open !== 'boolean') return { error: 'mensaje inválido' };
      const w = s.walls.find((w) => w.id === m2.id && w.kind === 'door');
      if (!w) return { error: 'puerta inexistente' };
      if (!isDM(m)) {
        if (role !== 'player') return DENY;
        const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
        const near = s.tokens.some((t) => t.owners.includes(m.id) && Math.hypot(t.x - mid.x, t.y - mid.y) <= 1.5 * s.grid.size);
        if (!near) return { error: 'demasiado lejos' };
      }
      w.open = m2.open;
      return { state: true };
    }
    case 'chat': {
      if (!str(m2.text, 500)) return { error: 'mensaje inválido' };
      return { chat: pushChat(room, { id: randomUUID(), from: m.id, at: now, text: m2.text }) };
    }
    case 'roll': {
      if (!str(m2.expr, 100) || (m2.secret !== undefined && typeof m2.secret !== 'boolean')) return { error: 'mensaje inválido' };
      let r;
      try { r = rollFn(m2.expr); } catch { return { error: 'expresión inválida' }; }
      if (!r || !num(r.total)) return { error: 'expresión inválida' };
      return { chat: pushChat(room, { id: randomUUID(), from: m.id, at: now, roll: { expr: m2.expr, total: r.total, detail: String(r.detail), secret: m2.secret === true, ...(Array.isArray(r.dice) && { dice: r.dice }) } }) };
    }
    case 'ping': {
      if (!inScene(s, m2.x, m2.y)) return { error: 'mensaje inválido' };
      return { ping: { from: m.id, x: m2.x as number, y: m2.y as number } };
    }
    case 'claim': {
      if (role !== 'player' && role !== 'trusted') return DENY;
      if (!str(m2.tokenId, 64)) return { error: 'mensaje inválido' };
      const t = s.tokens.find((t) => t.id === m2.tokenId);
      if (!t || t.faction !== 'ally') return { error: 'token inexistente' };
      if (!t.owners.includes(m.id) && t.owners.length > 0) return { error: 'ya tiene dueño' };
      for (const o of s.tokens) o.owners = o.owners.filter((x) => x !== m.id);
      t.owners.push(m.id);
      return { state: true };
    }
    case 'automation': {
      if (role !== 'dm') return DENY;
      if (m2.value !== 'assisted' && m2.value !== 'auto') return { error: 'mensaje inválido' };
      room.automation = m2.value;
      return { state: true };
    }
    case 'combat': {
      // El dueño del token activo puede pasar su propio turno («Fin de turno»); lo demás es del DM.
      const own = m2.op === 'next' && !!room.combat && !!s.tokens.find((t) => t.id === room.combat!.order[room.combat!.turn]?.tokenId)?.owners.includes(m.id);
      if (!isDM(m) && !own) return DENY;
      if (m2.op === 'end') { delete room.combat; return { state: true }; }
      if (m2.op === 'start') {
        if (!s.tokens.length) return { error: 'sin tokens' };
        const rows = s.tokens.map((t) => ({ t, init: rollFn('1d20').total + (t.initMod ?? 0) }))
          .sort((a, b) => b.init - a.init || (b.t.initMod ?? 0) - (a.t.initMod ?? 0));
        room.combat = { round: 1, turn: 0, order: rows.map((r) => ({ tokenId: r.t.id, init: r.init })), used: {} };
        const fmt = (h: boolean) => rows.filter((r) => r.t.hidden === h).map((r) => `${r.t.name} ${r.init}`).join(', ');
        // Público: solo el aviso (el carrusel ya llega filtrado por visión). El orden completo, secreto para DM/asistente.
        const chats = [pushChat(room, { id: randomUUID(), from: m.id, at: now, text: '¡Comienza el combate! Ronda 1' })];
        chats.push(pushChat(room, { id: randomUUID(), from: m.id, at: now, roll: { expr: 'iniciativa', total: 0, detail: fmt(false) + (rows.some((r) => r.t.hidden) ? ' · ocultos: ' + fmt(true) : ''), secret: true } }));
        return { state: true, chats };
      }
      if (m2.op !== 'next' && m2.op !== 'prev') return { error: 'mensaje inválido' };
      const c = room.combat;
      if (!c) return { error: 'sin combate' };
      const n = c.order.length, step = m2.op === 'next' ? 1 : -1;
      let i = c.turn, r = c.round;
      for (let k = 0; k < n; k++) { // salta tokens borrados
        i += step;
        if (i >= n) { i = 0; r++; } else if (i < 0) { i = n - 1; r--; }
        if (s.tokens.some((t) => t.id === c.order[i].tokenId)) break;
      }
      if (r < 1) return { error: 'primera ronda' };
      c.turn = i; c.round = r;
      c.used[c.order[i].tokenId] = { action: false, bonus: false, reaction: false, moved: 0 };
      return { state: true };
    }
    case 'act': {
      if (!str(m2.tokenId, 64) || !str(m2.actionId, 64) || !Array.isArray(m2.targets) || m2.targets.length < 1 || m2.targets.length > 20 || !m2.targets.every((x) => str(x, 64)))
        return { error: 'mensaje inválido' };
      const tk = s.tokens.find((t) => t.id === m2.tokenId);
      if (!tk) return { error: 'token inexistente' };
      if (!isDM(m) && !tk.owners.includes(m.id) && !(role === 'trusted' && tk.faction === 'ally')) return DENY;
      const act = tk.actions?.find((a) => a.id === m2.actionId);
      if (!act) return { error: 'acción inexistente' };
      const vis = isDM(m) ? null : new Set(filterFor(room, m).scene.tokens.map((t) => t.id));
      const targets: Token[] = [];
      for (const id of new Set(m2.targets as string[])) {
        const t = s.tokens.find((t) => t.id === id);
        if (!t || (vis && !vis.has(id))) return { error: 'objetivo inválido' };
        targets.push(t);
      }
      // distancia en pies entre centros, regla 5-5-5 (la diagonal cuenta como una casilla)
      const dist = (t: Token) => Math.max(Math.abs(t.x - tk.x), Math.abs(t.y - tk.y)) / s.grid.size * s.grid.feet;
      const reach = act.range + 5 * (tk.size - 1);
      // ponytail: en acciones de área solo se comprueba el alcance al primer objetivo (punto de impacto); sin plantilla de área real
      if ((act.area ? targets.slice(0, 1) : targets).some((t) => dist(t) > reach + 1e-6)) return { error: 'fuera de alcance' };
      // cobertura por muros: 'total' invalida al objetivo; ½ y ¾ suman a la CA (ataques) y a las salvaciones de DES
      const segs = sightSegments(s.walls), cov = new Map<Id, 0 | 2 | 5>();
      for (const t of targets) {
        const c = cover(tk, t, t.size * s.grid.size / 2, segs);
        if (c === 'total') return { error: 'sin línea de visión' };
        cov.set(t.id, c);
      }
      const cb = room.combat;
      if (cb) {
        if (!isDM(m) && act.cost !== 'reaction' && cb.order[cb.turn]?.tokenId !== tk.id) return { error: 'no es su turno' };
        if (cb.used[tk.id]?.[act.cost]) return { error: 'ya usada' };
      }
      let lvl = 0;
      if (act.slot) {
        lvl = Object.keys(tk.slots ?? {}).map(Number).sort((a, b) => a - b).find((l) => l >= act.slot! && tk.slots![l].used < tk.slots![l].max) ?? 0;
        if (!lvl) return { error: 'sin espacios de conjuro' };
      }
      const dexSave = act.kind === 'save' && act.save?.ability === 'dex';
      // resolveAction solo aplica la cobertura a la CA: en salvaciones de DES se suma al bono de la salvación del objetivo
      const rt = dexSave ? targets.map((t) => ({ ...t, saves: { ...t.saves, dex: (t.saves?.dex ?? 0) + cov.get(t.id)! } })) : targets;
      const card = resolveAction(tk, act, rt, undefined, { within5ft: (t) => dist(t) <= 5 + 5 * (tk.size - 1), cover: (t) => cov.get(t.id) ?? 0 });
      if (act.kind === 'attack' || dexSave) for (const ct of card.targets) { const c = cov.get(ct.id); if (c) ct.cover = c; }
      if (lvl) tk.slots![lvl].used++;
      if (cb) (cb.used[tk.id] ??= { action: false, bonus: false, reaction: false, moved: 0 })[act.cost] = true;
      if (room.automation === 'auto' || act.kind === 'heal') { s.tokens = applyCard(card, s.tokens, 'full'); card.applied = true; }
      else if (card.targets.some((t) => (t.amount ?? 0) > 0)) { card.pending = randomUUID(); room.pending.push(card); }
      else card.applied = true; // nada que aplicar (todo fallado)
      return { state: true, chat: pushChat(room, { id: randomUUID(), from: m.id, at: now, card: structuredClone(card) }) };
    }
    case 'importCharacter': {
      if (!str(m2.tokenId, 64)) return { error: 'mensaje inválido' };
      const t = s.tokens.find((t) => t.id === m2.tokenId);
      if (!t || t.faction !== 'ally') return { error: 'token inexistente' };
      if (!isDM(m) && !t.owners.includes(m.id)) return DENY;
      const d = parseCharacter(m2.data);
      if (!d) return { error: 'datos de personaje inválidos' };
      const { ddbId, level, classes, avatar, ...stats } = d;
      Object.assign(t, stats, { ddb: { id: ddbId, level, classes, syncedAt: now } }, avatar && { img: avatar });
      return { state: true, chat: pushChat(room, { id: randomUUID(), from: m.id, at: now, text: `${t.name} se ha vinculado con D&D Beyond (nivel ${level})` }) };
    }
    case 'confirm': {
      if (!isDM(m)) return DENY;
      if (!str(m2.pending, 64) || !['full', 'half', 'none'].includes(m2.mode as string)) return { error: 'mensaje inválido' };
      const i = room.pending.findIndex((c) => c.pending === m2.pending);
      if (i < 0) return { error: 'no hay tarjeta pendiente' };
      const [card] = room.pending.splice(i, 1);
      if (m2.mode !== 'none') s.tokens = applyCard(card, s.tokens, m2.mode as 'full' | 'half');
      const old = room.chat.find((c) => c.card === undefined ? false : c.card.pending === m2.pending);
      if (old?.card) { delete old.card.pending; old.card.applied = true; }
      delete card.pending; card.applied = true;
      return { state: true, chat: pushChat(room, { id: randomUUID(), from: m.id, at: now, card: structuredClone(card) }) };
    }
    case 'spawn': {
      if (!isDM(m)) return DENY;
      if (!str(m2.srd, 64) || !inScene(s, m2.x, m2.y) || (m2.hidden !== undefined && typeof m2.hidden !== 'boolean')) return { error: 'mensaje inválido' };
      if (!Object.hasOwn(MONSTERS, m2.srd)) return { error: 'monstruo inexistente' };
      if (s.tokens.length >= MAX_ITEMS) return { error: 'demasiados elementos' };
      const { cr: _cr, type: _ty, ...base } = structuredClone(MONSTERS[m2.srd]);
      // tamaño par → esquina de casilla; impar → centro de casilla
      const g = s.grid, snap = (v: number, off: number) => base.size % 2 === 0 ? Math.round((v - off) / g.size) * g.size + off : Math.floor((v - off) / g.size) * g.size + off + g.size / 2;
      const names = new Set(s.tokens.map((t) => t.name));
      let name = base.name;
      for (let n = 2; names.has(name); n++) name = `${base.name} ${n}`;
      let id = m2.srd as string;
      for (let n = 2; s.tokens.some((t) => t.id === id); n++) id = `${m2.srd}-${n}`;
      s.tokens.push({ ...base, id, name, x: snap(m2.x as number, g.offsetX), y: snap(m2.y as number, g.offsetY), owners: [], hidden: m2.hidden === true, srd: m2.srd as string });
      return { state: true };
    }
    default: return { error: 'mensaje desconocido' };
  }
}

function pushChat(room: Room, c: ChatMsg) {
  room.chat.push(c);
  if (room.chat.length > MAX_CHAT) room.chat.splice(0, room.chat.length - MAX_CHAT);
  return c;
}
