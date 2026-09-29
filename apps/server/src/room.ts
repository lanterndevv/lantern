// Lógica pura de una mesa: sin sockets ni BD. Todo lo que llega de un cliente se valida aquí.
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { CODE_ALPHABET, DEFAULT_SETTINGS, DICE_THEMES, blocksMove } from '@lantern/protocol';
import type { Ability, ActionCard, AudioState, C2S, ChatMsg, ClientState, Combat, DiceTheme, Die, Hp, Id, Light, Member, Point, Role, S2C, Scene, TableSettings, Token, Wall } from '@lantern/protocol';
import { ABILITY_ES, CONDITIONS, SKILLS, abilityMod, applyCard, applyDamage, autoFailSave, concentrationDC, d20Penalty, deathSave, grantTemp, heal, resolveAction } from '@lantern/rules';
import { MONSTERS } from '@lantern/srd';
import { parseCharacter } from './import.ts';
import { demoScene } from '@lantern/protocol/demo';
import { cover, pointInPolygon, sightSegments, visibility } from '@lantern/vision';

export type MemberRec = { id: Id; name: string; role: Role; keyHash: string; dice: DiceTheme };
export type Room = { code: string; scene: Scene; members: Map<Id, MemberRec>; chat: ChatMsg[]; automation: 'assisted' | 'auto'; combat?: Combat; pending: ActionCard[]; settings: TableSettings; view: 'tactical' | 'story'; audio: AudioState };
export type RollFn = (expr: string) => { total: number; detail: string; dice?: Die[] };
export type Effect = { error?: string; state?: boolean; chat?: ChatMsg; chats?: ChatMsg[]; ping?: { from: Id; x: number; y: number }; all?: S2C; to?: { id: Id; msg: S2C }; clock?: boolean };

const MAX_CHAT = 200, MAX_ITEMS = 500;
export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
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
  const room: Room = { code, scene, members: new Map(), chat: [], automation: 'assisted', pending: [], settings: structuredClone(DEFAULT_SETTINGS), view: 'tactical', audio: { layers: [] } };
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
  const automation = room.automation, settings = structuredClone(room.settings), view = room.view, audio = structuredClone(room.audio);
  if (member.role === 'dm' || member.role === 'assistant') return { code: room.code, members, scene: structuredClone(s), automation, settings, view, audio, ...(room.combat && { combat: structuredClone(room.combat) }) };

  // ponytail: las capas de audio posicionales NO se filtran por visión: el sonido atraviesa paredes (y el jugador ve x/y de capas ajenas)
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
  return { code: room.code, members, visible, scene: { ...structuredClone(s), walls, lights, tokens }, automation, settings, view, audio, ...(combat && { combat }) };
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

// URL de recurso: https o ruta /assets/ propia (sin subdirectorios)
const urlOk = (v: unknown): v is string => typeof v === 'string' && v.length <= 512 && (/^https:\/\/[^\s"'<>]+$/.test(v) || /^\/assets\/[\w.-]+$/.test(v));
const short = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const inr = (v: unknown, a: number, b: number): v is number => num(v) && v >= a && v <= b;
const WEATHER = ['none', 'rain', 'snow', 'fog', 'ash', 'storm', 'leaves', 'embers'];
const SFX = ['door', 'thunder', 'roar', 'collapse', 'bell', 'scream', 'magic', 'coins', 'trap', 'hit', 'crit', 'heal', 'miss'];
const MAX_LAYERS = 12, MAX_RTC = 16 * 1024;

// Valida un patch de escena y lo mezcla sobre `s`. Devuelve false (sin tocar nada) si algo es inválido.
function patchScene(s: Scene, patch: unknown): boolean {
  if (!obj(patch)) return false;
  const p = patch, n: Partial<Scene> = {};
  for (const k of Object.keys(p)) if (!['name', 'background', 'globalLight', 'weather', 'story', 'grid', 'width', 'height'].includes(k)) return false;
  if ('name' in p) { if (!str(p.name, 60)) return false; n.name = p.name; }
  if ('background' in p) { if (!urlOk(p.background)) return false; n.background = p.background; }
  if ('globalLight' in p) { if (!inr(p.globalLight, 0, 1)) return false; n.globalLight = p.globalLight; }
  if ('width' in p) { if (!inr(p.width, 100, 20000)) return false; n.width = p.width; }
  if ('height' in p) { if (!inr(p.height, 100, 20000)) return false; n.height = p.height; }
  if ('weather' in p) {
    const w = p.weather;
    if (!obj(w) || !WEATHER.includes(w.kind as string) || !inr(w.intensity, 0, 1) || !inr(w.wind, -1, 1)) return false;
    n.weather = { kind: w.kind as NonNullable<Scene['weather']>['kind'], intensity: w.intensity, wind: w.wind };
  }
  if ('story' in p) {
    const t = p.story;
    if (!obj(t) || (t.image !== undefined && !urlOk(t.image)) || (t.title !== undefined && !short(t.title, 80)) || (t.subtitle !== undefined && !short(t.subtitle, 80))) return false;
    n.story = { ...s.story, ...(t.image !== undefined && { image: t.image as string }), ...(t.title !== undefined && { title: t.title }), ...(t.subtitle !== undefined && { subtitle: t.subtitle }) };
  }
  if ('grid' in p) {
    const g = p.grid;
    if (!obj(g)) return false;
    const m = { ...s.grid, ...g };
    for (const k of Object.keys(g)) if (!['size', 'offsetX', 'offsetY', 'feet'].includes(k)) return false;
    if (!inr(m.size, 20, 400) || !inr(m.offsetX, 0, m.size) || !inr(m.offsetY, 0, m.size) || !inr(m.feet, 1, 20)) return false;
    n.grid = { size: m.size, offsetX: m.offsetX, offsetY: m.offsetY, feet: m.feet };
  }
  Object.assign(s, n);
  return true;
}

// ---- ajustes de mesa ----
// Mezcla profunda validada: sin claves desconocidas y con tipos correctos. null = patch inválido.
export function mergeSettings(cur: TableSettings, patch: unknown): TableSettings | null {
  if (!obj(patch)) return null;
  const out = structuredClone(cur) as any;
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'mode') { if (v !== 'simple' && v !== 'full') return null; out.mode = v; }
    else if (k === 'edition') { if (v !== '2014' && v !== '2024') return null; out.edition = v; }
    else if (k === 'layers' || k === 'optional') {
      if (!obj(v)) return null;
      for (const [kk, vv] of Object.entries(v)) { if (!Object.hasOwn(out[k], kk) || typeof vv !== 'boolean') return null; out[k][kk] = vv; }
    } else return null;
  }
  return out;
}

// ---- reglas automáticas (condiciones, PG, tiradas) ----
type Ctx = { room: Room; from: Id; now: number; rollFn: RollFn };
const ROLES: Role[] = ['dm', 'assistant', 'trusted', 'player', 'spectator'];
// ponytail: lista corta de conjuros de concentración (por nombre); ampliar o mover a los datos del SRD
const CONC = new Set(['bendición', 'maldición', 'retener persona', 'telaraña', 'invisibilidad', 'mirada de fuego', 'fuego feérico', 'rayo de luna']);
const DOWN = ['unconscious', 'dead', 'incapacitated', 'paralyzed', 'stunned', 'petrified'];
const sg = (n: number) => (n >= 0 ? '+' : '') + n;
const has = (t: Token, ...ids: string[]) => ids.some((i) => t.conditions.includes(i));
const addCond = (t: Token, ...ids: string[]) => { for (const i of ids) if (!t.conditions.includes(i)) t.conditions.push(i); };
const delCond = (t: Token, ...ids: string[]) => { t.conditions = t.conditions.filter((c) => !ids.includes(c)); for (const i of ids) if (t.condRounds) delete t.condRounds[i]; };
const say = (c: Ctx, text: string) => pushChat(c.room, { id: randomUUID(), from: c.from, at: c.now, text });

// Tirada de d20 de un token con modificador, agotamiento (según edición) y condiciones.
function d20Test(c: Ctx, t: Token, kind: 'save' | 'skill' | 'ability', key: string) {
  const ed = c.room.settings.edition, ex = t.exhaustion ?? 0;
  const ab = (kind === 'skill' ? SKILLS[key].ability : key) as Ability;
  const base = kind === 'save' ? t.saves?.[ab] : kind === 'skill' ? t.skills?.[key] : undefined;
  const mod = (base ?? abilityMod(t.abilities?.[ab] ?? 10)) + d20Penalty(ex, ed);
  if (kind === 'save' && autoFailSave(t.conditions, ab)) return { mod, total: 0, detail: 'fallo automático', dice: undefined as Die[] | undefined };
  // 2014: desventaja en pruebas desde nv. 1 y en salvaciones desde nv. 3; envenenado/asustado: desventaja en pruebas
  const dis = (ed === '2014' && ex >= (kind === 'save' ? 3 : 1)) || (kind !== 'save' && has(t, 'poisoned', 'frightened'));
  const r = c.rollFn(dis ? '2d20kl1' : '1d20');
  return { mod, total: r.total + mod, detail: `${r.detail} ${sg(mod)}${dis ? ' (desventaja)' : ''}`, dice: r.dice };
}

// Efectos de recibir `taken` de daño (ya aplicado a t.hp; prev = PG antes).
function damageFx(c: Ctx, t: Token, prev: Hp, taken: number): ChatMsg[] {
  const out: ChatMsg[] = [], hp = t.hp!;
  if (taken <= 0 || has(t, 'dead')) return out;
  if (t.concentration) {
    const dc = concentrationDC(taken), r = d20Test(c, t, 'save', 'con'), ok = r.total >= dc, spell = t.concentration;
    const card: ActionCard = { actorId: t.id, actorName: t.name, actionName: 'Concentración', kind: 'save',
      targets: [{ id: t.id, name: t.name, save: { total: r.total, success: ok, ability: 'con', dc } }],
      detail: `${spell}: ${r.detail}`, ...(r.dice && { dice: r.dice }), applied: true };
    out.push(pushChat(c.room, { id: randomUUID(), from: c.from, at: c.now, card }));
    if (!ok) { delete t.concentration; out.push(say(c, `${t.name} pierde la concentración en ${spell}`)); }
  }
  const kill = () => { addCond(t, 'dead'); delete t.deathSaves; out.push(say(c, `${t.name} muere`)); };
  if (prev.cur > 0 && hp.cur === 0) {
    if (taken - prev.cur - prev.temp >= hp.max) kill(); // daño masivo
    else if (t.faction === 'ally') { addCond(t, 'unconscious', 'prone'); t.deathSaves = { successes: 0, failures: 0 }; out.push(say(c, `${t.name} cae inconsciente`)); }
    else kill();
  } else if (prev.cur === 0 && t.faction === 'ally') {
    const d = (t.deathSaves ??= { successes: 0, failures: 0 });
    d.failures++; // ponytail: el crítico no se conoce aquí, así que siempre un fallo (dos si fuera crítico)
    if (taken >= hp.max || d.failures >= 3) kill();
    else out.push(say(c, `${t.name} falla una salvación de muerte (${d.failures}/3)`));
  }
  return out;
}

function healFx(c: Ctx, t: Token, prev: Hp): ChatMsg[] {
  if (prev.cur > 0 || t.hp!.cur <= 0 || has(t, 'dead')) return [];
  delCond(t, 'unconscious'); delete t.deathSaves;
  return [say(c, `${t.name} recupera la consciencia`)];
}

// Aplica una tarjeta a la escena y dispara los efectos automáticos en sus objetivos.
function applyCardFx(c: Ctx, card: ActionCard, mode: 'full' | 'half' | 'none'): ChatMsg[] {
  const prev = new Map(c.room.scene.tokens.map((t) => [t.id, t.hp && { ...t.hp }]));
  c.room.scene.tokens = applyCard(card, c.room.scene.tokens, mode);
  const out: ChatMsg[] = [];
  for (const ct of card.targets) {
    const t = c.room.scene.tokens.find((x) => x.id === ct.id), p = prev.get(ct.id);
    if (mode === 'none' || !t?.hp || !p) continue;
    const amt = mode === 'half' ? Math.floor((ct.amount ?? 0) / 2) : ct.amount ?? 0;
    if (card.kind === 'heal') { if (has(t, 'dead')) { t.hp = p; continue; } out.push(...healFx(c, t, p)); } // curar no resucita
    else out.push(...damageFx(c, t, p, applyDamage(p, amt, card.damageType ?? '', t.defenses).taken));
  }
  return out;
}

// Flanqueo: otro aliado consciente adyacente al objetivo, en el lado opuesto (ángulo > 135°).
function flanked(s: Scene, at: Token, t: Token) {
  const d = (a: Token, b: Token) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / s.grid.size * s.grid.feet;
  return s.tokens.some((a) => {
    if (a.id === at.id || a.id === t.id || a.faction !== at.faction || has(a, ...DOWN) || d(a, t) > 5 * (a.size + t.size) / 2 + 1e-6) return false;
    const ux = at.x - t.x, uy = at.y - t.y, vx = a.x - t.x, vy = a.y - t.y, n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    return n > 0 && (ux * vx + uy * vy) / n < -Math.SQRT1_2; // cos(135°)
  });
}

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
  if (msg.t === 'clockReq' || msg.t === 'clock') return { clock: true }; // ponytail: una sola muestra, sin NTP
  if (role === 'spectator') return DENY;

  const ctx: Ctx = { room, from: m.id, now, rollFn };
  const tokenOf = () => str(m2.tokenId, 64) ? s.tokens.find((t) => t.id === m2.tokenId) : undefined;

  switch (m2.t) {
    case 'scene': {
      if (!isDM(m)) return DENY;
      return patchScene(s, m2.patch) ? { state: true } : { error: 'escena inválida' };
    }
    case 'view': {
      if (!isDM(m)) return DENY;
      if (m2.value !== 'tactical' && m2.value !== 'story') return { error: 'mensaje inválido' };
      room.view = m2.value;
      return { state: true };
    }
    case 'npcSay': {
      if (!isDM(m)) return DENY;
      if (!str(m2.name, 40) || !str(m2.text, 600) || (m2.portrait !== undefined && !urlOk(m2.portrait))) return { error: 'mensaje inválido' };
      return { all: { t: 'npcSay', name: m2.name, text: m2.text, ...(m2.portrait !== undefined && { portrait: m2.portrait as string }) }, chat: pushChat(room, { id: randomUUID(), from: m.id, at: now, text: `${m2.name}: ${m2.text}` }) };
    }
    case 'transition': {
      if (!isDM(m)) return DENY;
      if (!str(m2.title, 80) || (m2.subtitle !== undefined && !str(m2.subtitle, 120))) return { error: 'mensaje inválido' };
      return { all: { t: 'transition', title: m2.title, ...(m2.subtitle !== undefined && { subtitle: m2.subtitle as string }) } };
    }
    case 'audio': {
      if (!isDM(m) && role !== 'trusted') return DENY;
      const a = room.audio, op = m2.op;
      if (op === 'play') {
        if (!urlOk(m2.url) || !str(m2.name, 100) || (m2.loop !== undefined && typeof m2.loop !== 'boolean')) return { error: 'mensaje inválido' };
        a.track = { url: m2.url, name: m2.name, startedAt: now, loop: m2.loop === true };
      } else if (op === 'pause') {
        if (!a.track) return { error: 'sin pista' };
        a.track.pausedAt ??= now;
      } else if (op === 'resume') {
        if (!a.track) return { error: 'sin pista' };
        if (a.track.pausedAt !== undefined) { a.track.startedAt += now - a.track.pausedAt; delete a.track.pausedAt; }
      } else if (op === 'stop') delete a.track;
      else if (op === 'layer') {
        const l = m2.layer;
        if (!obj(l) || !str(l.id, 64) || !urlOk(l.url) || !str(l.name, 100) || !inr(l.volume, 0, 1)) return { error: 'mensaje inválido' };
        const pos = l.x !== undefined || l.y !== undefined || l.radius !== undefined;
        if (pos && !(num(l.x) && num(l.y) && num(l.radius) && l.radius > 0)) return { error: 'mensaje inválido' };
        const layer: AudioState['layers'][number] = { id: l.id, url: l.url, name: l.name, volume: l.volume, ...(pos && { x: l.x as number, y: l.y as number, radius: l.radius as number }) };
        const i = a.layers.findIndex((x) => x.id === layer.id);
        if (i >= 0) a.layers[i] = layer;
        else if (a.layers.length >= MAX_LAYERS) return { error: 'demasiadas capas' };
        else a.layers.push(layer);
      } else if (op === 'unlayer') {
        if (!str(m2.id, 64)) return { error: 'mensaje inválido' };
        a.layers = a.layers.filter((x) => x.id !== m2.id);
      } else return { error: 'mensaje inválido' };
      return { state: true };
    }
    case 'sfx': {
      if (!isDM(m) && role !== 'trusted') return DENY;
      if (typeof m2.name !== 'string' || !SFX.includes(m2.name)) return { error: 'efecto inválido' };
      return { all: { t: 'sfx', name: m2.name } };
    }
    case 'rtc': {
      if (!str(m2.to, 64)) return { error: 'mensaje inválido' };
      let size = 0;
      try { size = JSON.stringify(m2.data)?.length ?? 0; } catch { /* size 0 */ }
      if (!size || size > MAX_RTC) return { error: 'mensaje inválido' };
      if (!room.members.has(m2.to)) return { error: 'miembro inexistente' };
      return { to: { id: m2.to, msg: { t: 'rtc', from: m.id, data: m2.data } } };
    }
    case 'settings': {
      if (role !== 'dm') return DENY;
      const next = mergeSettings(room.settings, m2.patch);
      if (!next) return { error: 'ajustes inválidos' };
      room.settings = next; // ponytail: 'simple' no toca las capas; el cliente decide qué muestra
      return { state: true };
    }
    case 'setRole': {
      if (role !== 'dm') return DENY;
      if (!str(m2.memberId, 64) || !ROLES.includes(m2.role as Role)) return { error: 'mensaje inválido' };
      const target = room.members.get(m2.memberId);
      if (!target) return { error: 'miembro inexistente' };
      if (target.role === 'dm' && m2.role !== 'dm' && [...room.members.values()].filter((x) => x.role === 'dm').length <= 1) return { error: 'tiene que quedar al menos un DM' };
      target.role = m2.role as Role;
      return { state: true };
    }
    case 'condition': {
      if (!str(m2.condition, 32) || typeof m2.on !== 'boolean' || (m2.rounds !== undefined && !(Number.isInteger(m2.rounds) && (m2.rounds as number) >= 1 && (m2.rounds as number) <= 100))) return { error: 'mensaje inválido' };
      if (!Object.hasOwn(CONDITIONS, m2.condition)) return { error: 'condición inexistente' };
      const t = tokenOf();
      if (!t) return { error: 'token inexistente' };
      if (!isDM(m) && !t.owners.includes(m.id)) return DENY;
      const cond = m2.condition;
      if (cond === 'exhaustion') { // ponytail: el nivel 6 no mata solo; el DM lo decide
        t.exhaustion = Math.min(6, Math.max(0, (t.exhaustion ?? 0) + (m2.on ? 1 : -1)));
        if (t.exhaustion > 0) addCond(t, cond); else delCond(t, cond);
      } else if (m2.on) {
        addCond(t, cond);
        if (m2.rounds) (t.condRounds ??= {})[cond] = m2.rounds as number;
        else if (t.condRounds) delete t.condRounds[cond];
      } else delCond(t, cond);
      return { state: true };
    }
    case 'hp': {
      const d = m2.delta as number;
      if (!Number.isInteger(d) || d < 1 || d > 999 || !['damage', 'heal', 'temp'].includes(m2.kind as string) || (m2.damageType !== undefined && !str(m2.damageType, 32))) return { error: 'mensaje inválido' };
      const t = tokenOf();
      if (!t) return { error: 'token inexistente' };
      if (!isDM(m) && !t.owners.includes(m.id)) return DENY;
      if (!t.hp) return { error: 'el token no tiene PG' };
      if (m2.kind !== 'damage' && has(t, 'dead')) return { error: `${t.name} está muerto: curar no lo devuelve a la vida` };
      const prev = { ...t.hp };
      let chats: ChatMsg[] = [];
      if (m2.kind === 'damage') { const r = applyDamage(prev, d, (m2.damageType as string | undefined) ?? '', t.defenses); t.hp = r.hp; chats = damageFx(ctx, t, prev, r.taken); }
      else if (m2.kind === 'heal') { t.hp = heal(prev, d); chats = healFx(ctx, t, prev); }
      else t.hp = grantTemp(prev, d);
      return { state: true, chats };
    }
    case 'concentration': {
      if (m2.spell !== null && !str(m2.spell, 64)) return { error: 'mensaje inválido' };
      const t = tokenOf();
      if (!t) return { error: 'token inexistente' };
      if (!isDM(m) && !t.owners.includes(m.id)) return DENY;
      if (m2.spell === null) delete t.concentration; else t.concentration = m2.spell as string;
      return { state: true };
    }
    case 'deathSave': {
      const t = tokenOf();
      if (!t) return { error: 'token inexistente' };
      if (!isDM(m)) {
        if (!t.owners.includes(m.id)) return DENY;
        if (room.combat && room.combat.order[room.combat.turn]?.tokenId !== t.id) return { error: 'no es su turno' }; // fuera de combate, cuando quiera
      }
      if (!t.deathSaves || !t.hp || t.hp.cur > 0) return { error: 'no está haciendo salvaciones de muerte' };
      const r = ctx.rollFn('1d20'), res = deathSave(t.deathSaves, r.total);
      let out = `${r.detail}: `;
      if (res.revived) { t.hp = { ...t.hp, cur: 1 }; delCond(t, 'unconscious'); delete t.deathSaves; out += `¡20 natural! ${t.name} revive con 1 PG`; }
      else if (res.dead) { addCond(t, 'dead'); delete t.deathSaves; out += `${t.name} muere`; }
      else if (res.stable) { delete t.deathSaves; out += `${t.name} queda estable`; }
      else { t.deathSaves = res.state; out += `éxitos ${res.state.successes}/3, fallos ${res.state.failures}/3`; }
      return { state: true, chat: pushChat(room, { id: randomUUID(), from: m.id, at: now, roll: { expr: `Salvación de muerte de ${t.name}`, total: r.total, detail: out, secret: false, ...(r.dice && { dice: r.dice }) } }) };
    }
    case 'check': {
      const kind = m2.kind as string, key = m2.key as string;
      if (!['save', 'skill', 'ability'].includes(kind) || !str(key, 32) || !Object.hasOwn(kind === 'skill' ? SKILLS : ABILITY_ES, key) || (m2.secret !== undefined && typeof m2.secret !== 'boolean')) return { error: 'mensaje inválido' };
      const t = tokenOf();
      if (!t) return { error: 'token inexistente' };
      if (!isDM(m) && !t.owners.includes(m.id)) return DENY;
      const r = d20Test(ctx, t, kind as 'save', key), ab = kind === 'skill' ? SKILLS[key].ability : key as Ability;
      const expr = kind === 'skill' ? `${SKILLS[key].name} (${ABILITY_ES[ab]}) ${sg(r.mod)}` : kind === 'save' ? `Salvación ${ABILITY_ES[ab]} ${sg(r.mod)}` : `Prueba de ${ABILITY_ES[ab]} ${sg(r.mod)}`;
      return { chat: pushChat(room, { id: randomUUID(), from: m.id, at: now, roll: { expr, total: r.total, detail: r.detail, secret: m2.secret === true, ...(r.dice && { dice: r.dice }) } }) };
    }
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
      const chats: ChatMsg[] = [];
      const ended = m2.op === 'next' ? s.tokens.find((t) => t.id === c.order[c.turn]?.tokenId) : undefined;
      for (const [k, n] of Object.entries(ended?.condRounds ?? {})) { // duración de condiciones: al terminar el turno del token
        if (n > 1) ended!.condRounds![k] = n - 1;
        else { delCond(ended!, k); chats.push(say(ctx, `${ended!.name} ya no está ${CONDITIONS[k]?.toLowerCase() ?? k}`)); }
      }
      c.turn = i; c.round = r;
      c.used[c.order[i].tokenId] = { action: false, bonus: false, reaction: false, moved: 0 };
      return { state: true, chats };
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
      const opt = room.settings.optional;
      const card = resolveAction(tk, act, rt, undefined, { within5ft: (t) => dist(t) <= 5 + 5 * (tk.size - 1), cover: (t) => cov.get(t.id) ?? 0,
        edition: room.settings.edition, brutalCrit: opt.brutalCrit, flank: opt.flanking && act.range <= 5 ? (t) => flanked(s, tk, t) : undefined });
      if (act.kind === 'attack' || dexSave) for (const ct of card.targets) { const c = cov.get(ct.id); if (c) ct.cover = c; }
      if (lvl) { tk.slots![lvl].used++; if (CONC.has(act.name.toLowerCase())) tk.concentration = act.name; } // reemplaza a la anterior
      if (cb) (cb.used[tk.id] ??= { action: false, bonus: false, reaction: false, moved: 0 })[act.cost] = true;
      // en modo sencillo, o sin la capa de automatización, el servidor no automatiza el daño: se comporta como 'assisted'
      const auto = room.automation === 'auto' && room.settings.mode === 'full' && room.settings.layers.automation;
      const now2 = auto || act.kind === 'heal';
      if (now2) card.applied = true;
      else if (card.targets.some((t) => (t.amount ?? 0) > 0)) { card.pending = randomUUID(); room.pending.push(card); }
      else card.applied = true; // nada que aplicar (todo fallado)
      const cardMsg = pushChat(room, { id: randomUUID(), from: m.id, at: now, card: structuredClone(card) });
      const chats = now2 ? applyCardFx(ctx, card, 'full') : [];
      if (opt.fumbles && card.targets.some((x) => x.attack?.d20 === 1)) chats.push(say(ctx, `¡Pifia! ${tk.name} falla estrepitosamente`)); // ponytail: sin tabla de pifias
      return { state: true, chat: cardMsg, chats };
    }
    case 'importCharacter': {
      if (!str(m2.tokenId, 64)) return { error: 'mensaje inválido' };
      const t = s.tokens.find((t) => t.id === m2.tokenId);
      if (!t || t.faction !== 'ally') return { error: 'token inexistente' };
      if (!isDM(m) && !t.owners.includes(m.id)) return DENY;
      const d = parseCharacter(m2.data);
      if (!d) return { error: 'datos de personaje inválidos' };
      const { ddbId, level, classes, avatar, ...stats } = d;
      Object.assign(t, stats, ddbId && { ddb: { id: ddbId, level, classes, syncedAt: now } }, avatar && { img: avatar }); // ddbId 0 = creado en Lantern, sin vínculo
      return { state: true, chat: pushChat(room, { id: randomUUID(), from: m.id, at: now, text: ddbId ? `${t.name} se ha vinculado con D&D Beyond (nivel ${level})` : `${t.name} se ha actualizado (nivel ${level})` }) };
    }
    case 'confirm': {
      if (!isDM(m)) return DENY;
      if (!str(m2.pending, 64) || !['full', 'half', 'none'].includes(m2.mode as string)) return { error: 'mensaje inválido' };
      const i = room.pending.findIndex((c) => c.pending === m2.pending);
      if (i < 0) return { error: 'no hay tarjeta pendiente' };
      const [card] = room.pending.splice(i, 1);
      const old = room.chat.find((c) => c.card === undefined ? false : c.card.pending === m2.pending);
      if (old?.card) { delete old.card.pending; old.card.applied = true; }
      delete card.pending; card.applied = true;
      const cardMsg = pushChat(room, { id: randomUUID(), from: m.id, at: now, card: structuredClone(card) });
      return { state: true, chat: cardMsg, chats: applyCardFx(ctx, card, m2.mode as 'full' | 'half' | 'none') };
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
