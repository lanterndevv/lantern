// Lógica pura de una mesa: sin sockets ni BD. Todo lo que llega de un cliente se valida aquí.
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { CODE_ALPHABET, blocksMove } from '@lantern/protocol';
import type { C2S, ChatMsg, ClientState, Id, Light, Member, Point, Role, Scene, Token, Wall } from '@lantern/protocol';
import { demoScene } from '@lantern/protocol/demo';
import { pointInPolygon, sightSegments, visibility } from '@lantern/vision';

export type MemberRec = { id: Id; name: string; role: Role; keyHash: string };
export type Room = { code: string; scene: Scene; members: Map<Id, MemberRec>; chat: ChatMsg[] };
export type RollFn = (expr: string) => { total: number; detail: string };
export type Effect = { error?: string; state?: boolean; chat?: ChatMsg; ping?: { from: Id; x: number; y: number } };

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
  const m: MemberRec = { id: randomUUID(), name, role, keyHash: sha(key) };
  room.members.set(m.id, m);
  return { member: m, key };
}

export function createRoom(name: unknown, code: string, scene: Scene = demoScene()): { error: string } | { room: Room; member: MemberRec; key: string } {
  const n = cleanName(name);
  if (!n) return { error: 'nombre inválido' };
  const room: Room = { code, scene, members: new Map(), chat: [] };
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
  const members: Member[] = [...room.members.values()].map((m) => ({ id: m.id, name: m.name, role: m.role, online: online.has(m.id) }));
  const s = room.scene;
  if (member.role === 'dm' || member.role === 'assistant') return { code: room.code, members, scene: structuredClone(s) };

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
  return { code: room.code, members, visible, scene: { ...structuredClone(s), walls, lights, tokens } };
}

export const chatFor = (chat: ChatMsg[], m: MemberRec) => chat.filter((c) => canSee(c, m));
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
      return { chat: pushChat(room, { id: randomUUID(), from: m.id, at: now, roll: { expr: m2.expr, total: r.total, detail: String(r.detail), secret: m2.secret === true } }) };
    }
    case 'ping': {
      if (!inScene(s, m2.x, m2.y)) return { error: 'mensaje inválido' };
      return { ping: { from: m.id, x: m2.x as number, y: m2.y as number } };
    }
    default: return { error: 'mensaje desconocido' };
  }
}

function pushChat(room: Room, c: ChatMsg) {
  room.chat.push(c);
  if (room.chat.length > MAX_CHAT) room.chat.splice(0, room.chat.length - MAX_CHAT);
  return c;
}
