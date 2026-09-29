// Lógica pura de una mesa: sin sockets ni BD. Todo lo que llega de un cliente se valida aquí.
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { CODE_ALPHABET, DEFAULT_SETTINGS, DICE_THEMES, blocksMove } from '@lantern/protocol';
import type { Ability, ActionCard, AudioState, C2S, ChatMsg, ClientState, Combat, DiceTheme, Die, ExtensionManifest, Hp, Id, JournalEntry, LibraryItem, Member, MoveMode, Point, Region, Role, S2C, Scene, SessionSummary, TableSettings, Token, Wall } from '@lantern/protocol';
import { ABILITY_ES, CONDITIONS, SKILLS, abilityMod, applyCard, applyDamage, autoFailSave, concentrationDC, d20Penalty, deathSave, encounterXP, grantTemp, heal, inArea, resolveAction, roll as diceRoll } from '@lantern/rules';
import { MONSTERS, SPELL_INDEX } from '@lantern/srd';
import { spellRegions } from './areas.ts';
import { livekitOn, livekitToken } from './livekit.ts';
import { parseCharacter } from './import.ts';
import { acOf, afterTurn, answerSave, areaError, breakConcentration, budget, combatEdit, dist3d, effectOp, endCombat, forceInit, forceSaves, holdSaves, legendary, oppChats, react, reactionPrompts, rollInit, saveEndEffect, seenBy, snapshotTurn, spawnCustom, startCombat, sweepSaves, turnAction, undoTurn } from './combat2.ts';
import { routeCost, speedFor } from '@lantern/protocol/move';
import { demoScene } from '@lantern/protocol/demo';
import { cover, perceives, pointInPolygon, sightSegments, visibility } from '@lantern/vision';
import { canUndo, clockOf, handleWorld, hiddenWhisper } from './world.ts';
import { handleExtras } from './extras.ts';
import { handleJourney } from './journey.ts';
import { canReadDoc, canSeeScene } from './perms.ts';
import { MAX_EXTENSIONS, MAX_ITEMS, MAX_JOURNAL, MAX_LAYERS, MAX_LEVELS, MAX_REGIONS, MAX_SCENES, MAX_WALLS, SFX, inScene, inr, num, obj, parseAudio, parseJournal, parseLayer, parseLight, parseManifest, parseRegion, parseToken, parseWall, parseWeather, patchScene, pt, short, str, urlOk } from './validate.ts';

/** Salvaciones tiradas por el servidor y ocultas hasta que el dueño pulse (o caduquen), por tarjeta pendiente. */
export type SaveHold = { until: number; res: Record<Id, { save: NonNullable<ActionCard['targets'][number]['save']>; amount?: number; die?: Die }> };
export type MemberRec = { id: Id; name: string; role: Role; keyHashes: string[]; dice: DiceTheme };
export type Room = { code: string; scene: Scene; scenes: Record<Id, Scene>; activeId: Id; journal: JournalEntry[]; members: Map<Id, MemberRec>; chat: ChatMsg[]; automation: 'assisted' | 'auto' | 'manual'; combat?: Combat; pending: ActionCard[]; settings: TableSettings; view: 'tactical' | 'story'; audio: AudioState; extensions: ExtensionManifest[];
  safety: { lines: string[]; veils: string[] }; sessionStart: number; maxRound: number; clock?: number; holds?: Record<Id, SaveHold>; // persistidos (clock: minutos del mundo, 480 por defecto; holds: salvaciones de jugadores ya tiradas y ocultas)
  checks?: Map<Id, CheckReq>; xAt?: number; extLog?: Map<Id, number[]> }; // solo en memoria
type CheckReq = { id: Id; tokenIds: Id[]; kind: 'save' | 'skill' | 'ability'; key: string; dc?: number; blind: boolean; label: string; answers: Map<Id, { name: string; total: number; ok?: boolean }> };
export type RollFn = (expr: string) => { total: number; detail: string; dice?: Die[] };
export type Effect = { error?: string; state?: boolean; chat?: ChatMsg; chats?: ChatMsg[]; ping?: { from: Id; x: number; y: number }; all?: S2C; to?: { id: Id; msg: S2C }; clock?: boolean;
  sends?: { who: (m: MemberRec) => boolean; msg: S2C }[] }; // mensajes a los miembros que cumplan `who`

const MAX_CHAT = 200, MAX_RTC = 16 * 1024;
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
  const m: MemberRec = { id: randomUUID(), name, role, keyHashes: [sha(key)], dice: 'linterna' };
  room.members.set(m.id, m);
  return { member: m, key };
}

// `room.scene` es siempre la escena activa de la biblioteca.
export function mkRoom(r: Omit<Room, 'scene'>): Room {
  return Object.defineProperty(r, 'scene', { enumerable: true, get(this: Room) { return this.scenes[this.activeId]; }, set(this: Room, v: Scene) { this.scenes[this.activeId] = v; } }) as Room;
}

export function createRoom(name: unknown, code: string, scene: Scene = demoScene()): { error: string } | { room: Room; member: MemberRec; key: string } {
  const n = cleanName(name);
  if (!n) return { error: 'nombre inválido' };
  const room = mkRoom({ code, scenes: { [scene.id]: scene }, activeId: scene.id, journal: [], members: new Map(), chat: [], automation: 'assisted', pending: [], settings: structuredClone(DEFAULT_SETTINGS), view: 'tactical', audio: { layers: [] }, extensions: [], safety: { lines: [], veils: [] }, sessionStart: Date.now(), maxRound: 0 });
  return { room, ...addMember(room, n, 'dm') };
}

function cleanName(name: unknown) {
  if (typeof name !== 'string') return null;
  const n = name.trim();
  return n.length >= 1 && n.length <= 32 ? n : null;
}

export function joinRoom(room: Room, name: unknown, key: unknown, as?: unknown): { member: MemberRec; key?: string } | { error: string } {
  if (key !== undefined) {
    if (typeof key !== 'string' || key.length > 200) return { error: 'key inválida' };
    const h = sha(key);
    for (const m of room.members.values()) if (m.keyHashes.includes(h)) return { member: m };
    return { error: 'key inválida' };
  }
  const n = cleanName(name);
  if (!n) return { error: 'nombre inválido' };
  if (as !== undefined && as !== 'spectator') return { error: 'mensaje inválido' };
  if (as === 'spectator') return addMember(room, n, 'spectator'); // pantalla de mesa física / streaming: ve lo que ve el grupo, no actúa
  const r = addMember(room, n, 'player');
  const tk = room.scene.tokens.find((t) => t.faction === 'ally' && t.owners.length === 0);
  if (tk) tk.owners.push(r.member.id);
  return r;
}

// ---- filtrado por miembro ----
const inRegion = (r: Region, p: Point) => pointInPolygon(p, r.points);
const canRead = canReadDoc;
const libraryOf = (room: Room): LibraryItem[] => Object.values(room.scenes).map((s) => ({ id: s.id, name: s.name, ...(s.folder && { folder: s.folder }), ...(s.visibleTo && { visibleTo: [...s.visibleTo] }), active: s.id === room.activeId,
  tokens: s.tokens.length, walls: s.walls.length, ...(s.background && { background: s.background }) }));

export const filterFor = (room: Room, member: MemberRec, online?: ReadonlySet<Id>): ClientState => ({ ...filterBase(room, member, online), clock: clockOf(room), canUndo: canUndo(room, member) });
function filterBase(room: Room, member: MemberRec, online: ReadonlySet<Id> = new Set()): Omit<ClientState, 'clock' | 'canUndo'> {
  const members: Member[] = [...room.members.values()].map((m) => ({ id: m.id, name: m.name, role: m.role, online: online.has(m.id), dice: m.dice }));
  const s = room.scene;
  const extensions = structuredClone(room.extensions), automation = room.automation, settings = structuredClone(room.settings), view = room.view, audio = structuredClone(room.audio);
  const journal = structuredClone(room.journal.filter((e) => canRead(e, member)));
  const safety = structuredClone(room.safety), sessionStart = room.sessionStart;
  if (isDM(member)) return { code: room.code, members, scene: structuredClone(s), automation, settings, view, audio, journal, extensions, safety, sessionStart, copilot: !!process.env.LANTERN_LLM_URL, livekit: livekitOn(), library: libraryOf(room), ...(room.combat && { combat: structuredClone(room.combat) }) };

  if (!canSeeScene(s, member)) { // escena reservada a otros: mapa en blanco, sin fichas, paredes ni historia
    const blank: Scene = { id: s.id, name: '', width: s.width, height: s.height, grid: structuredClone(s.grid), walls: [], lights: [], tokens: [], globalLight: 0 };
    return { code: room.code, members, visible: [], scene: blank, automation, settings, view, audio, journal, extensions, safety, sessionStart, copilot: !!process.env.LANTERN_LLM_URL, livekit: livekitOn() };
  }
  // ponytail: las capas de audio posicionales NO se filtran por visión: el sonido atraviesa paredes (y el jugador ve x/y de capas ajenas)
  // Plantas: el jugador recibe las entidades de las plantas donde tiene algún token (o la base); la visión usa solo los muros de cada planta.
  const mine = new Set(s.tokens.filter((t) => t.owners.includes(member.id)).map((t) => flr(s, t.level)));
  if (!mine.size) mine.add(undefined);
  const segCache = new Map<Id | undefined, Wall[]>();
  const wallsOf = (f: Id | undefined) => { let g = segCache.get(f); if (!g) segCache.set(f, g = s.walls.filter((w) => flr(s, w.level) === f)); return g; };
  const vis = s.tokens
    .filter((t) => t.faction === 'ally' && t.owners.length > 0)
    .map((t) => ({ t, f: flr(s, t.level), poly: visibility({ x: t.x, y: t.y }, sightSegments(wallsOf(flr(s, t.level)), t), s.width, s.height) }));
  const visible = vis.filter((v) => mine.has(v.f)).map((v) => v.poly);
  const seen = (p: Point, l?: Id) => vis.some((v) => v.f === flr(s, l) && pointInPolygon(p, v.poly));
  // Un invisible solo lo ven quienes lo perciben por otros sentidos (truesight, blindsight, tremorsense); la luz no se modela aquí.
  const seenTok = (t: Token) => !t.conditions.includes('invisible') ? seen(t, t.level) : vis.some((v) => v.f === flr(s, t.level) && pointInPolygon(t, v.poly) && perceives(v.t, t, { light: 'bright', los: true }));
  const fogs = (s.regions ?? []).filter((r) => r.kind === 'fog');
  // Los aliados llegan siempre (la barra de grupo los necesita); el cliente solo los dibuja en el mapa si son de su misma planta (t.level).
  const tokens = s.tokens
    .filter((t) => !t.hidden && (t.faction === 'ally' || (mine.has(flr(s, t.level)) && seenTok(t))) && (t.owners.includes(member.id) || !fogs.some((r) => flr(s, r.level) === flr(s, t.level) && inRegion(r, t)))) // la niebla oculta lo que hay dentro (salvo tus propios tokens)
    .map((t) => {
      const c = structuredClone(t);
      delete c.notes;
      delete c.condSource;
      if (t.faction !== 'ally') {
        delete c.hp; delete c.ac; delete c.legendary; delete c.lair; delete c.shielded; delete c.effects; delete c.initAdv;
        const hp = t.hp, v = room.settings.hpView; // PG de enemigos según la mesa: exactos, por estado o nada
        if (hp && v === 'exact') c.hp = { cur: hp.cur, max: hp.max, temp: 0 };
        else if (hp && v === 'status') c.hpState = hp.cur <= 0 ? 'down' : hp.cur * 4 <= hp.max ? 'critical' : hp.cur * 2 <= hp.max ? 'bloodied' : hp.cur < hp.max ? 'hurt' : 'ok';
      } else if (!t.owners.includes(member.id)) delete c.effects;
      return c;
    });
  const walls = s.walls.filter((w) => mine.has(flr(s, w.level))).map((w): Wall => {
    const { note: _n, ...v } = w;
    if (!v.secret) return v;
    const { secret: _s, open: _o, ...rest } = v; // una puerta secreta se ve como muro (y no revela si está abierta)
    return { ...rest, kind: 'wall' };
  });
  // ponytail: luces filtradas solo por su centro; un halo que asome desde fuera de la visión no se distingue
  const lights = s.lights.filter((l) => mine.has(flr(s, l.level)) && seen(l, l.level));
  // ponytail: a los jugadores solo llegan id, nombre, polígono, tipo y plantas de las regiones no ocultas
  const regions = (s.regions ?? []).filter((r) => !r.hidden && mine.has(flr(s, r.level))).map((r): Region => ({ id: r.id, name: r.name, points: structuredClone(r.points), kind: r.kind, hidden: false, ...(r.level && { level: r.level }), ...(r.toLevel && { toLevel: r.toLevel }), ...(r.weather && { weather: r.weather }) }));
  const ids = new Set(tokens.map((t) => t.id));
  let combat: Combat | undefined;
  if (room.combat) {
    const c = room.combat, order = c.order.filter((o) => ids.has(o.tokenId));
    // turno oculto: apunta al último visible anterior (o -1)
    let turn = -1;
    for (let i = Math.min(c.turn, c.order.length - 1); i >= 0 && turn < 0; i--) turn = order.findIndex((o) => o.tokenId === c.order[i].tokenId);
    combat = { round: c.round, turn, order, used: Object.fromEntries(Object.entries(c.used).filter(([id]) => ids.has(id))), ...(c.awaiting && { awaiting: c.awaiting.filter((id) => ids.has(id)) }) };
  }
  const { dmNotes: _d, regions: _r, tokens: _t, walls: _w, lights: _l, visibleTo: _v, ...pub } = structuredClone(s);
  if (pub.pins) pub.pins = pub.pins.filter((p) => room.journal.some((e) => e.id === p.entryId && canRead(e, member))); // solo marcadores de entradas legibles
  return { code: room.code, members, visible, scene: { ...pub, walls, lights, tokens, ...(regions.length && { regions }) }, automation, settings, view, audio, journal, extensions, safety, sessionStart, copilot: !!process.env.LANTERN_LLM_URL, livekit: livekitOn(), ...(combat && { combat }) };
}

export function chatFor(room: Room, m: MemberRec) {
  const vis = m.role === 'dm' || m.role === 'assistant' ? undefined : new Set(filterFor(room, m).scene.tokens.map((t) => t.id));
  return room.chat.filter((c) => canSee(c, m)).map((c) => redact(room, c, m, vis));
}
// Tarjeta para un jugador: lo que no ve sale como '???' y las CD ajenas se ocultan. La CA nunca viaja en la tarjeta.
export function redact(room: Room, c: ChatMsg, m: MemberRec, vis?: Set<Id>): ChatMsg {
  if (hiddenWhisper(c, m)) return { id: c.id, from: c.from, at: c.at, text: 'Susurro' };
  if (c.roll?.blind && !isDM(m)) return { id: c.id, from: c.from, at: c.at, text: 'Tirada a ciegas' }; // defensa: canSee ya la filtra
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
export const canSee = (c: ChatMsg, m: MemberRec) => !hiddenWhisper(c, m) &&
  (c.roll?.blind ? isDM(m) : !c.roll?.secret || c.from === m.id || m.role === 'dm' || m.role === 'assistant');

// ¿el segmento p1-p2 corta (o toca) q1-q2?
function cross(p1: Point, p2: Point, q1: Point, q2: Point) {
  const o = (a: Point, b: Point, c: Point) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const on = (a: Point, b: Point, c: Point) =>
    Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);
  const o1 = o(p1, p2, q1), o2 = o(p1, p2, q2), o3 = o(q1, q2, p1), o4 = o(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && on(p1, p2, q1)) || (o2 === 0 && on(p1, p2, q2)) || (o3 === 0 && on(q1, q2, p1)) || (o4 === 0 && on(q1, q2, p2));
}

// Planta normalizada: la base (primera de scene.levels) equivale a `undefined`.
export const flr = (s: Scene, l?: Id) => l === s.levels?.[0]?.id ? undefined : l;
export const pathBlocked = (s: Scene, from: Point, to: Point, level?: Id) => s.walls.some((w) => flr(s, w.level) === flr(s, level) && blocksMove(w) && cross(from, to, w.a, w.b));

// ---- ajustes de mesa ----
// Mezcla profunda validada: sin claves desconocidas y con tipos correctos. null = patch inválido.
const OPT_EXTRA = ['playerInit', 'groupInit', 'playerSaves', 'ghostRoutes'];
export function mergeSettings(cur: TableSettings, patch: unknown): TableSettings | null {
  if (!obj(patch)) return null;
  const out = structuredClone(cur) as any;
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'mode') { if (v !== 'simple' && v !== 'full') return null; out.mode = v; }
    else if (k === 'edition') { if (v !== '2014' && v !== '2024') return null; out.edition = v; }
    else if (k === 'layers' || k === 'optional') {
      if (!obj(v)) return null;
      for (const [kk, vv] of Object.entries(v)) { if ((!Object.hasOwn(out[k], kk) && !(k === 'optional' && OPT_EXTRA.includes(kk))) || typeof vv !== 'boolean') return null; out[k][kk] = vv; }
    } else if (k === 'hpView') { if (v !== 'exact' && v !== 'status' && v !== 'none') return null; out.hpView = v;
    } else if (k === 'diagonal') { if (v !== 'chebyshev' && v !== 'alt' && v !== 'euclid') return null; out.diagonal = v;
    } else if (k === 'drawing') { if (v !== 'dm' && v !== 'all') return null; out.drawing = v; } // dibujo persistente de jugadores (TableSettings no lo declara: falta en el contrato)
    else return null;
  }
  return out;
}

// ---- reglas automáticas (condiciones, PG, tiradas) ----
export type Ctx = { room: Room; from: Id; now: number; rollFn: RollFn };
const ROLES: Role[] = ['dm', 'assistant', 'trusted', 'player', 'spectator'];
// ponytail: lista corta de conjuros de concentración (por nombre); ampliar o mover a los datos del SRD
const CONC = new Set(['bendición', 'maldición', 'retener persona', 'telaraña', 'invisibilidad', 'mirada de fuego', 'fuego feérico', 'rayo de luna']);
const DOWN = ['unconscious', 'dead', 'incapacitated', 'paralyzed', 'stunned', 'petrified'];
const sg = (n: number) => (n >= 0 ? '+' : '') + n;
const has = (t: Token, ...ids: string[]) => ids.some((i) => t.conditions.includes(i));
const addCond = (t: Token, ...ids: string[]) => { for (const i of ids) if (!t.conditions.includes(i)) t.conditions.push(i); };
export const delCond = (t: Token, ...ids: string[]) => {
  t.conditions = t.conditions.filter((c) => !ids.includes(c));
  for (const i of ids) { if (t.condRounds) delete t.condRounds[i]; if (t.condSource) delete t.condSource[i]; }
  if (t.effects) t.effects = t.effects.filter((e) => !e.endsCondition || !ids.includes(e.endsCondition));
};
const say = (c: Ctx, text: string) => pushChat(c.room, { id: randomUUID(), from: c.from, at: c.now, text });

// Tirada de d20 de un token con modificador, agotamiento (según edición) y condiciones.
export function d20Test(c: Ctx, t: Token, kind: 'save' | 'skill' | 'ability', key: string) {
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
export function damageFx(c: Ctx, t: Token, prev: Hp, taken: number): ChatMsg[] {
  const out: ChatMsg[] = [], hp = t.hp!;
  if (taken <= 0 || has(t, 'dead')) return out;
  if (t.concentration) {
    const dc = concentrationDC(taken), r = d20Test(c, t, 'save', 'con'), ok = r.total >= dc, spell = t.concentration;
    const card: ActionCard = { actorId: t.id, actorName: t.name, actionName: 'Concentración', kind: 'save',
      targets: [{ id: t.id, name: t.name, save: { total: r.total, success: ok, ability: 'con', dc } }],
      detail: `${spell}: ${r.detail}`, ...(r.dice && { dice: r.dice }), applied: true };
    out.push(pushChat(c.room, { id: randomUUID(), from: c.from, at: c.now, card }));
    if (!ok) out.push(say(c, `${t.name} pierde la concentración en ${spell}`), ...breakConcentration(c, t));
  }
  const kill = () => { addCond(t, 'dead'); delete t.deathSaves; out.push(say(c, `${t.name} muere`)); if (t.concentration) out.push(...breakConcentration(c, t)); };
  if (prev.cur > 0 && hp.cur === 0) {
    if (taken - prev.cur - prev.temp >= hp.max) kill(); // daño masivo
    else if (t.faction === 'ally') { addCond(t, 'unconscious', 'prone'); t.deathSaves = { successes: 0, failures: 0 }; out.push(say(c, `${t.name} cae inconsciente`)); if (t.concentration) out.push(...breakConcentration(c, t)); }
    else kill();
  } else if (prev.cur === 0 && t.faction === 'ally') {
    const d = (t.deathSaves ??= { successes: 0, failures: 0 });
    d.failures++; // ponytail: el crítico no se conoce aquí, así que siempre un fallo (dos si fuera crítico)
    if (taken >= hp.max || d.failures >= 3) kill();
    else out.push(say(c, `${t.name} falla una salvación de muerte (${d.failures}/3)`));
  }
  return out;
}

export function healFx(c: Ctx, t: Token, prev: Hp): ChatMsg[] {
  if (prev.cur > 0 || t.hp!.cur <= 0 || has(t, 'dead')) return [];
  delCond(t, 'unconscious'); delete t.deathSaves;
  return [say(c, `${t.name} recupera la consciencia`)];
}

// Aplica una tarjeta a la escena y dispara los efectos automáticos en sus objetivos.
export function applyCardFx(c: Ctx, card: ActionCard, mode: 'full' | 'half' | 'none'): ChatMsg[] {
  const prev = new Map(c.room.scene.tokens.map((t) => [t.id, t.hp && { ...t.hp }]));
  c.room.scene.tokens = applyCard(card, c.room.scene.tokens, mode);
  const out: ChatMsg[] = [];
  const actor = c.room.scene.tokens.find((t) => t.id === card.actorId), act = actor?.actions?.find((a) => a.name === card.actionName);
  for (const ct of card.targets) {
    const t = c.room.scene.tokens.find((x) => x.id === ct.id), p = prev.get(ct.id);
    if (mode !== 'none' && act?.condition && t && (ct.save ? !ct.save.success : ct.attack?.hit)) { // la condición del conjuro, ligada a la concentración del lanzador
      addCond(t, act.condition);
      if (actor?.concentration === act.name) (t.condSource ??= {})[act.condition] = `conc:${actor.id}`;
    }
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

const OFF_SCENE = ['chat', 'roll', 'rtc', 'diceTheme', 'safety', 'clock', 'clockReq', 'livekit', 'rollTable', 'join']; // lo único que puede hacer quien no ve la escena activa
export const handle = (room: Room, m: MemberRec, msg: unknown, rollFn: RollFn, now = Date.now()): Effect => {
  if (!canSeeScene(room.scene, m) && !(obj(msg) && OFF_SCENE.includes(msg.t as string))) return { error: 'no permitido' };
  const swept = sweepSaves({ room, from: m.id, now, rollFn }); // salvaciones de jugadores caducadas (además del temporizador del servidor)
  const fx = handleJourney(room, m, msg, rollFn, now, (r1, m1, g1, rf1, n1) => handleExtras(r1, m1, g1, rf1, n1, (r2, m2, g, rf, n) => handleWorld(r2, m2, g, rf, n, handleBase))); // journey.ts: transiciones, viaje, avisos · extras.ts: mensajes de la fase 11
  return swept.length ? { ...fx, state: true, chats: [...swept, ...(fx.chats ?? [])] } : fx;
};
function handleBase(room: Room, m: MemberRec, msg: unknown, rollFn: RollFn, now = Date.now()): Effect {
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
  if (m2.t === 'safety') { // cualquier miembro, espectadores incluidos; nunca se registra quién
    if (m2.op === 'x') {
      if (room.xAt !== undefined && now - room.xAt < 10_000) return { error: 'espera unos segundos antes de otra tarjeta X' };
      room.xAt = now; // ponytail: solo el aviso a todos; el combate no se congela en servidor
      return { all: { t: 'safety', op: 'x' } };
    }
    const text = typeof m2.text === 'string' ? m2.text.trim() : '';
    if ((m2.op !== 'add' && m2.op !== 'remove') || (m2.list !== 'lines' && m2.list !== 'veils') || !str(text, 60)) return { error: 'mensaje inválido' };
    const list = room.safety[m2.list], i = list.findIndex((x) => x.toLowerCase() === text.toLowerCase());
    if (m2.op === 'add') {
      if (i >= 0) return { error: 'ya existe' };
      if (list.length >= 30) return { error: 'demasiadas entradas' };
      list.push(text);
    } else {
      if (i < 0) return { error: 'no existe' };
      list.splice(i, 1);
    }
    return { state: true };
  }
  if (m2.t === 'livekit') { // antes del veto a espectadores: ellos también escuchan (canPublish:false)
    const { LANTERN_LIVEKIT_URL: url, LANTERN_LIVEKIT_KEY: key, LANTERN_LIVEKIT_SECRET: secret } = process.env;
    if (!url || !key || !secret) return { error: 'voz SFU no disponible' };
    return { to: { id: m.id, msg: { t: 'livekit', url, token: livekitToken(key, secret, room.code, m.id, m.name, role !== 'spectator') } } };
  }
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
        const layer = parseLayer(m2.layer);
        if (!layer) return { error: 'mensaje inválido' };
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
      if (!room.settings.optional.heroPoints && next.optional.heroPoints) // al activar la regla, los aliados con dueño reciben 5 + ⌊nivel/2⌋
        for (const sc of Object.values(room.scenes)) for (const t of sc.tokens) if (t.faction === 'ally' && t.owners.length) t.heroPoints = 5 + Math.floor((t.ddb?.level ?? 1) / 2);
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
      const cond = m2.condition, se = m2.saveEnd;
      if (se !== undefined && (!obj(se) || !Object.hasOwn(ABILITY_ES, se.ability as string) || !Number.isInteger(se.dc) || (se.dc as number) < 1 || (se.dc as number) > 30)) return { error: 'mensaje inválido' };
      if (m2.sourceId !== undefined && !str(m2.sourceId, 80)) return { error: 'mensaje inválido' };
      if (!isDM(m) && (se !== undefined || m2.sourceId !== undefined)) return DENY;
      if (cond === 'exhaustion') { // ponytail: el nivel 6 no mata solo; el DM lo decide
        t.exhaustion = Math.min(6, Math.max(0, (t.exhaustion ?? 0) + (m2.on ? 1 : -1)));
        if (t.exhaustion > 0) addCond(t, cond); else delCond(t, cond);
      } else if (m2.on) {
        addCond(t, cond);
        if (m2.rounds) (t.condRounds ??= {})[cond] = m2.rounds as number;
        else if (t.condRounds) delete t.condRounds[cond];
        if (m2.sourceId !== undefined) (t.condSource ??= {})[cond] = m2.sourceId as string;
        if (se !== undefined) saveEndEffect(t, cond, CONDITIONS[cond], se as { ability: Ability; dc: number }, m2.sourceId as string | undefined);
      } else delCond(t, cond);
      return { state: true, chats: m2.on && DOWN.includes(cond) && t.concentration ? breakConcentration(ctx, t) : [] };
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
      const chats = t.concentration && t.concentration !== m2.spell ? breakConcentration(ctx, t) : []; // cambiar de conjuro o soltarlo disipa los efectos del anterior
      if (m2.spell !== null) t.concentration = m2.spell as string;
      return { state: true, chats };
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
      const to = { x: m2.x as number, y: m2.y as number }, mode = m2.mode ?? 'walk';
      const via = m2.path === undefined ? [] : Array.isArray(m2.path) && m2.path.length <= 16 ? m2.path.map((p) => pt(s, p)) : null;
      if (!via || via.some((p) => !p) || !['walk', 'fly', 'swim', 'climb'].includes(mode)) return { error: 'mensaje inválido' };
      const pts: Point[] = [{ x: t.x, y: t.y }, ...(via as Point[]), to]; // ruta con puntos de paso
      if (!isDM(m)) {
        if (role === 'trusted' ? t.faction !== 'ally' : !t.owners.includes(m.id)) return DENY;
        // trusted no está sujeto a muros (solo el jugador raso), según el plan
        if (role === 'player' && pts.slice(1).some((p, i) => pathBlocked(s, pts[i], p, t.level))) return { error: 'camino bloqueado' };
      }
      const cb = room.combat;
      if (cb && !isDM(m)) {
        if (cb.order[cb.turn]?.tokenId !== t.id) return { error: 'no es su turno' };
        const sp = speedFor(t, mode as MoveMode);
        if (sp === null) return { error: 'no puede moverse así' };
        // coste por tramo: terreno difícil casilla a casilla, diagonales según la mesa (routeCost)
        const feet = routeCost(s, t, pts, { diagonal: room.settings.diagonal, mode: mode as MoveMode }).feet;
        const u = (cb.used[t.id] ??= { action: false, bonus: false, reaction: false, moved: 0 });
        const speed = sp + (u.dash ?? 0);
        if (u.moved + feet > speed + 1e-6) return { error: `sin movimiento: te quedan ${Math.max(0, Math.floor(speed - u.moved))} pies` };
        u.moved += feet;
      }
      const opp = oppChats(ctx, t, pts);
      const from = { x: t.x, y: t.y };
      t.x = to.x; t.y = to.y;
      const rf = regionFx(ctx, t, from);
      return { state: true, chats: [...opp, ...(rf.chats ?? [])], sends: rf.sends };
    }
    case 'upsert': {
      if (!isDM(m)) return DENY;
      if (m2.kind === 'level') {
        const it = m2.item;
        if (!obj(it) || !str(it.id, 40) || !str(it.name, 40)) return { error: 'mensaje inválido' };
        const ls = (s.levels ??= []), i = ls.findIndex((l) => l.id === it.id);
        const w = 'weather' in it ? (it.weather === null ? undefined : parseWeather(it.weather)) : i >= 0 ? ls[i].weather : undefined; // weather ausente = se conserva · null = quita
        if ('weather' in it && it.weather !== null && !w) return { error: 'mensaje inválido' };
        const lv = { id: it.id, name: it.name, ...(w && { weather: w }) };
        if (i >= 0) ls[i] = lv;
        else if (ls.length >= MAX_LEVELS) return { error: 'demasiadas plantas' };
        else ls.push(lv);
        return { state: true };
      }
      const list = m2.kind === 'token' ? s.tokens : m2.kind === 'wall' ? s.walls : m2.kind === 'light' ? s.lights : m2.kind === 'region' ? (s.regions ??= []) : null;
      const item = m2.kind === 'token' ? parseToken(s, m2.item) : m2.kind === 'wall' ? parseWall(s, m2.item) : m2.kind === 'light' ? parseLight(s, m2.item) : m2.kind === 'region' ? parseRegion(s, m2.item) : null;
      if (!list || !item) return { error: 'mensaje inválido' };
      const i = (list as { id: Id }[]).findIndex((e) => e.id === item.id);
      if (i >= 0) (list as unknown[])[i] = item;
      else if (list.length >= (m2.kind === 'wall' ? MAX_WALLS : m2.kind === 'region' ? MAX_REGIONS : MAX_ITEMS)) return { error: 'demasiados elementos' };
      else (list as unknown[]).push(item);
      return { state: true };
    }
    case 'remove': {
      if (!isDM(m)) return DENY;
      if (m2.kind === 'level') {
        const i = str(m2.id, 40) ? (s.levels ?? []).findIndex((l) => l.id === m2.id) : -1;
        if (i < 0) return { error: 'no existe' };
        const f = flr(s, m2.id as Id), gone = (e: { level?: Id }) => flr(s, e.level) === f; // se borra todo lo que hay en la planta
        s.tokens = s.tokens.filter((e) => !gone(e)); s.walls = s.walls.filter((e) => !gone(e)); s.lights = s.lights.filter((e) => !gone(e));
        if (s.regions) s.regions = s.regions.filter((e) => !gone(e));
        s.levels!.splice(i, 1);
        if (!s.levels!.length) delete s.levels;
        return { state: true };
      }
      if (!str(m2.id, 64) || (m2.kind !== 'token' && m2.kind !== 'wall' && m2.kind !== 'light' && m2.kind !== 'region')) return { error: 'mensaje inválido' };
      const k = m2.kind === 'token' ? 'tokens' : m2.kind === 'wall' ? 'walls' : m2.kind === 'light' ? 'lights' : 'regions';
      const list = (s[k] ?? []) as { id: Id }[];
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
        if (w.locked && m2.open) return { error: 'cerrada con llave' };
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
    case 'extInstall': {
      if (role !== 'dm') return DENY;
      const man = parseManifest(m2.manifest);
      if (typeof man === 'string') return { error: man };
      const i = room.extensions.findIndex((e) => e.id === man.id);
      if (i < 0 && room.extensions.length >= MAX_EXTENSIONS) return { error: 'demasiadas extensiones' };
      if (i < 0) room.extensions.push(man); else room.extensions[i] = man;
      return { state: true };
    }
    case 'extRemove': {
      if (role !== 'dm') return DENY;
      if (!str(m2.id, 64)) return { error: 'mensaje inválido' };
      room.extensions = room.extensions.filter((e) => e.id !== m2.id);
      return { state: true };
    }
    case 'automation': {
      if (role !== 'dm') return DENY;
      if (m2.value !== 'assisted' && m2.value !== 'auto' && m2.value !== 'manual') return { error: 'mensaje inválido' };
      room.automation = m2.value;
      return { state: true };
    }
    case 'combat': {
      // El dueño del token activo puede pasar su propio turno («Fin de turno»); lo demás es del DM.
      const own = (m2.op === 'next' || m2.op === 'delay') && !!room.combat && !!s.tokens.find((t) => t.id === room.combat!.order[room.combat!.turn]?.tokenId)?.owners.includes(m.id);
      if (!isDM(m) && !own) return DENY;
      if (m2.op === 'end') { endCombat(room); return { state: true }; }
      if (room.combat?.awaiting && m2.op !== 'start' && m2.op !== 'forceInit') return { error: 'esperando la iniciativa de los jugadores' };
      if (m2.op === 'forceInit') return isDM(m) ? forceInit(ctx) : DENY;
      if (m2.op === 'undoTurn') return isDM(m) ? undoTurn(ctx) : DENY;
      if (['delay', 'add', 'remove', 'group', 'split', 'move'].includes(m2.op)) return combatEdit(ctx, m, m2 as never);
      if (m2.op === 'start') return startCombat(ctx, m);
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
      if (m2.op === 'next') snapshotTurn(room); // para «deshacer turno»
      const chats: ChatMsg[] = [];
      const ended = m2.op === 'next' ? s.tokens.find((t) => t.id === c.order[c.turn]?.tokenId) : undefined;
      for (const [k, n] of Object.entries(ended?.condRounds ?? {})) { // duración de condiciones: al terminar el turno del token
        if (n > 1) ended!.condRounds![k] = n - 1;
        else { delCond(ended!, k); chats.push(say(ctx, `${ended!.name} ya no está ${CONDITIONS[k]?.toLowerCase() ?? k}`)); }
      }
      const oldRound = c.round, oldInit = c.order[c.turn]?.init ?? null;
      c.turn = i; c.round = r; room.maxRound = Math.max(room.maxRound, r);
      c.used[c.order[i].tokenId] = { action: false, bonus: false, reaction: false, moved: 0 };
      if (m2.op !== 'next') return { state: true, chats };
      const hk = afterTurn(ctx, ended, oldRound, oldInit); // fin/inicio de turno: áreas persistentes, legendarias, guarida
      return { state: true, chats: [...chats, ...(hk.chats ?? [])], sends: hk.sends };
    }
    case 'act': {
      const at = m2.at === undefined ? undefined : pt(s, m2.at), aim = m2.dir === undefined ? undefined : pt(s, m2.dir);
      if (!str(m2.tokenId, 64) || !str(m2.actionId, 64) || !Array.isArray(m2.targets) || (m2.targets.length < 1 && !at) || m2.targets.length > 20 || !m2.targets.every((x) => str(x, 64))
        || (m2.at !== undefined && !at) || (m2.dir !== undefined && !aim))
        return { error: 'mensaje inválido' };
      const tk = s.tokens.find((t) => t.id === m2.tokenId);
      if (!tk) return { error: 'token inexistente' };
      if (!isDM(m) && !tk.owners.includes(m.id) && !(role === 'trusted' && tk.faction === 'ally')) return DENY;
      const act = tk.actions?.find((a) => a.id === m2.actionId);
      if (!act) return { error: 'acción inexistente' };
      if (act.multi) { // Multiataque: cada ataque va como un `act` normal con los mismos objetivos; el coste se gasta una sola vez
        const cb = room.combat, chats: ChatMsg[] = [], sends: NonNullable<Effect['sends']> = [];
        if (cb && !isDM(m) && cb.order[cb.turn]?.tokenId !== tk.id) return { error: 'no es su turno' };
        if (cb?.used[tk.id]?.[act.cost]) return { error: 'ya usada' };
        for (const { id, n } of act.multi) for (let i = 0; i < n; i++) {
          const sub = tk.actions?.find((a) => a.id === id);
          if (!sub || sub.multi) return { error: 'acción inexistente' };
          if (cb?.used[tk.id]) cb.used[tk.id][act.cost] = false; // cada golpe pasa por la comprobación de «ya usada»
          const fx = handleBase(room, m, { ...m2, actionId: id }, rollFn, now);
          if (fx.error) { if (cb) (cb.used[tk.id] ??= { action: false, bonus: false, reaction: false, moved: 0 })[act.cost] = !!chats.length; return chats.length ? { state: true, chats, sends } : fx; }
          chats.push(...[fx.chat, ...(fx.chats ?? [])].filter((c): c is ChatMsg => !!c)); sends.push(...(fx.sends ?? []));
        }
        if (cb) cb.used[tk.id][act.cost] = true;
        return { state: true, chats, sends };
      }
      let targets: Token[] = [];
      const dist = (t: Token) => dist3d(s.grid, tk, t); // 5-5-5 horizontal + elevación
      const lvlWalls = s.walls.filter((w) => flr(s, w.level) === flr(s, tk.level));
      let from: Point = tk; // origen de la cobertura: el lanzador, o el punto de la plantilla
      if (act.area && at) {
        // plantilla colocada: el servidor decide quién queda dentro, respetando muros (cobertura total = fuera)
        const shape = act.area.shape === 'cylinder' ? 'sphere' : act.area.shape, fromCaster = shape === 'cone' || shape === 'line';
        const origin: Point = fromCaster ? tk : at;
        const toward = fromCaster ? (aim ?? at) : shape === 'cube' ? (aim ?? { x: at.x + (at.x < tk.x ? -1 : 1), y: at.y + (at.y < tk.y ? -1 : 1) }) : at;
        if (!fromCaster && act.range > 0 && dist3d(s.grid, tk, { ...tk, x: at.x, y: at.y }) > act.range + 5 * (tk.size - 1) + 1e-6) return { error: 'fuera de alcance' };
        const so = sightSegments(lvlWalls, origin);
        targets = s.tokens.filter((t) => flr(s, t.level) === flr(s, tk.level) && (!fromCaster || t.id !== tk.id) && inArea(shape, origin, toward, act.area!.size, s.grid, t)
          && cover(origin, t, t.size * s.grid.size / 2, so) !== 'total');
        from = origin;
      } else {
        if (!m2.targets.length) return { error: 'mensaje inválido' };
        const vis = isDM(m) ? null : new Set(filterFor(room, m).scene.tokens.map((t) => t.id));
        for (const id of new Set(m2.targets as string[])) {
          const t = s.tokens.find((t) => t.id === id);
          if (!t || (vis && !vis.has(id))) return { error: 'objetivo inválido' };
          targets.push(t);
        }
        const reach = act.range + 5 * (tk.size - 1);
        // ponytail: sin punto de plantilla (`at`) solo se comprueba el alcance al primer objetivo
        if ((act.area ? targets.slice(0, 1) : targets).some((t) => dist(t) > reach + 1e-6)) return { error: 'fuera de alcance' };
        if (act.area) { const ae = areaError(s.grid, act.area, targets); if (ae) return { error: ae }; }
      }
      // cobertura por muros: 'total' invalida al objetivo; ½ y ¾ suman a la CA (ataques) y a las salvaciones de DES
      const segs = sightSegments(lvlWalls, tk), cov = new Map<Id, 0 | 2 | 5>();
      for (const t of targets) {
        const c = cover(from, t, t.size * s.grid.size / 2, segs);
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
      const manual = room.automation === 'manual';
      const sv = act.save?.ability;
      // copias con la CA efectiva (Escudo), Esquivar (desventaja = «invisible» para el atacante) y, en manual, sin comparar CA ni CD
      const rt = targets.map((t) => ({ ...t, ac: manual ? -999 : acOf(t),
        ...(act.kind === 'attack' && cb?.used[t.id]?.dodge && { conditions: [...t.conditions, 'invisible'] }),
        ...((dexSave || (manual && sv)) && { saves: { ...t.saves, ...(dexSave && { dex: (t.saves?.dex ?? 0) + cov.get(t.id)! }), ...(manual && sv && { [sv]: (t.saves?.[sv] ?? 0) + (dexSave && sv === 'dex' ? cov.get(t.id)! : 0) - 999 }) } }) }));
      const opt = room.settings.optional;
      const card = resolveAction(tk, act, rt, undefined, { within5ft: (t) => dist(t) <= 5 + 5 * (tk.size - 1), cover: (t) => cov.get(t.id) ?? 0,
        edition: room.settings.edition, brutalCrit: opt.brutalCrit, flank: opt.flanking && act.range <= 5 ? (t) => flanked(s, tk, t) : undefined });
      if (act.kind === 'attack' || dexSave) for (const ct of card.targets) { const c = cov.get(ct.id); if (c) ct.cover = c; }
      if (manual) { card.manual = true; for (const ct of card.targets) if (ct.save) ct.save.total += 999; }
      const brk: ChatMsg[] = [];
      if (lvl) { tk.slots![lvl].used++; if (CONC.has(act.name.toLowerCase()) || SPELL_INDEX[act.id]?.concentration) { if (tk.concentration) brk.push(...breakConcentration(ctx, tk)); tk.concentration = act.name; } } // reemplaza a la anterior
      if (lvl) { // área persistente del conjuro: región con su comportamiento, duración y (si concentra) sourceId para que se borre al romperse
        const rs = spellRegions(s, tk, act, { at: at ?? undefined, aim: aim ?? undefined, targets, round: cb?.round, conc: tk.concentration === act.name });
        if (rs.length && (s.regions?.length ?? 0) + rs.length <= MAX_REGIONS) (s.regions ??= []).push(...rs);
      }
      if (cb) (cb.used[tk.id] ??= { action: false, bonus: false, reaction: false, moved: 0 })[act.cost] = true;
      // en modo sencillo, o sin la capa de automatización, el servidor no automatiza el daño: se comporta como 'assisted'
      const auto = room.automation === 'auto' && room.settings.mode === 'full' && room.settings.layers.automation;
      const hold = opt.playerSaves && !manual ? holdSaves(ctx, card) : []; // salvaciones que tiran los jugadores en su cliente
      const held = !!card.awaiting, now2 = !manual && !held && (auto || act.kind === 'heal');
      if (now2) card.applied = true;
      else if (held) { /* pendiente hasta que respondan o caduque */ }
      else if (manual || card.targets.some((t) => (t.amount ?? 0) > 0)) { card.pending = randomUUID(); room.pending.push(card); }
      else card.applied = true; // nada que aplicar (todo fallado)
      const cardMsg = pushChat(room, { id: randomUUID(), from: m.id, at: now, card: structuredClone(card) });
      const chats = [...brk, ...(now2 ? applyCardFx(ctx, card, 'full') : [])];
      if (opt.fumbles && card.targets.some((x) => x.attack?.d20 === 1)) chats.push(say(ctx, `¡Pifia! ${tk.name} falla estrepitosamente`)); // ponytail: sin tabla de pifias
      const sends = [...hold, ...reactionPrompts(room, card, now)];
      if (act.slot !== undefined) sends.push({ who: seenBy(room, tk.id), msg: { t: 'spellBanner', name: act.name, school: act.school ?? SPELL_INDEX[act.id]?.school, level: act.slot, caster: tk.name } }); // rótulo del conjuro
      return { state: true, chat: cardMsg, chats, sends };
    }
    case 'route': { // ruta planificada mientras se arrastra: fantasma para quien ve el token (opción de mesa)
      const t = tokenOf();
      if (!t) return { error: 'token inexistente' };
      if (!isDM(m) && !t.owners.includes(m.id)) return DENY;
      const ps = m2.points;
      if (!room.settings.optional.ghostRoutes) return {};
      if (!Array.isArray(ps) || ps.length < 1 || ps.length > 20 || ps.some((p) => !pt(s, p))) return { error: 'mensaje inválido' };
      return { sends: [{ who: seenBy(room, t.id, m.id), msg: { t: 'route', tokenId: t.id, points: ps.map((p: Point) => ({ x: p.x, y: p.y })) } }] };
    }
    case 'turnAction': return turnAction(ctx, m, m2);
    case 'budget': return budget(m, room, m2);
    case 'effect': return effectOp(ctx, m, m2);
    case 'rollInit': return rollInit(ctx, m, m2);
    case 'answerSave': return answerSave(ctx, m, m2);
    case 'legendary': return legendary(m, s, m2);
    case 'react': return react(ctx, m, m2);
    case 'spawnCustom': return isDM(m) ? spawnCustom(ctx, m2) : DENY;
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
      if (!str(m2.pending, 64) || !['full', 'half', 'none', 'heal'].includes(m2.mode as string)) return { error: 'mensaje inválido' };
      const i = room.pending.findIndex((c) => c.pending === m2.pending);
      if (i < 0) return { error: 'no hay tarjeta pendiente' };
      if (m2.mode === 'heal' && !room.pending[i].manual) return { error: 'solo en tarjetas manuales' };
      const [card] = room.pending.splice(i, 1);
      forceSaves(ctx, card); // salvaciones aún sin tirar: se revelan
      const old = room.chat.find((c) => c.card === undefined ? false : c.card.pending === m2.pending);
      if (old?.card) { delete old.card.pending; old.card.applied = true; }
      delete card.pending; card.applied = true;
      const cardMsg = pushChat(room, { id: randomUUID(), from: m.id, at: now, card: structuredClone(card) });
      if (m2.mode === 'heal') card.kind = 'heal'; // Curar: los importes de la tarjeta se aplican como curación
      return { state: true, chat: cardMsg, chats: applyCardFx(ctx, card, m2.mode === 'heal' ? 'full' : m2.mode as 'full' | 'half' | 'none') };
    }
    case 'spawn': {
      if (!isDM(m)) return DENY;
      if (!str(m2.srd, 64) || !inScene(s, m2.x, m2.y) || (m2.hidden !== undefined && typeof m2.hidden !== 'boolean')) return { error: 'mensaje inválido' };
      if (!Object.hasOwn(MONSTERS, m2.srd)) return { error: 'monstruo inexistente' };
      if (s.tokens.length >= MAX_ITEMS) return { error: 'demasiados elementos' };
      spawnOne(s, m2.srd, m2.x, m2.y as number, m2.hidden === true);
      return { state: true };
    }
    case 'spawnMany': {
      if (!isDM(m)) return DENY;
      const items = m2.items;
      if (!Array.isArray(items) || items.length < 1 || items.length > 30 || (m2.hidden !== undefined && typeof m2.hidden !== 'boolean')) return { error: 'mensaje inválido' };
      if (!items.every((i) => obj(i) && str(i.srd, 64) && inScene(s, i.x, i.y))) return { error: 'mensaje inválido' };
      if (!items.every((i) => Object.hasOwn(MONSTERS, i.srd))) return { error: 'monstruo inexistente' };
      if (s.tokens.length + items.length > MAX_ITEMS) return { error: 'demasiados elementos' };
      for (const i of items) spawnOne(s, i.srd, i.x, i.y, m2.hidden === true);
      return { state: true };
    }
    // ---- puntos de héroe ----
    case 'heroPoints': {
      if (!isDM(m)) return DENY;
      if (!room.settings.optional.heroPoints) return { error: 'regla desactivada' };
      const t = tokenOf();
      if (!t) return { error: 'token inexistente' };
      if (!Number.isInteger(m2.value) || (m2.value as number) < 0 || (m2.value as number) > 20) return { error: 'mensaje inválido' };
      t.heroPoints = m2.value as number;
      return { state: true };
    }
    case 'heroPoint': {
      if (!room.settings.optional.heroPoints) return { error: 'regla desactivada' };
      const t = tokenOf();
      if (!t) return { error: 'token inexistente' };
      if (!t.owners.includes(m.id)) return DENY;
      if ((t.heroPoints ?? 0) < 1) return { error: 'sin puntos de héroe' };
      const last = [...room.chat].reverse().find((c) => c.from === m.id), r = rollFn('1d6'); // ponytail: no recalcula el impacto, el DM decide
      if (!r || !Number.isInteger(r.total)) return { error: 'tirada inválida' };
      t.heroPoints = (t.heroPoints ?? 0) - 1;
      const orig = last?.roll?.expr ?? last?.card?.actionName;
      const roll = { expr: `Punto de héroe +${r.total}`, total: r.total, detail: `${t.name}: ${r.detail}${orig ? ` · sobre: ${orig}` : ''}`, secret: last?.roll?.secret === true, ...(last?.roll?.blind && { blind: true }), ...(Array.isArray(r.dice) && { dice: r.dice }) };
      return { state: true, chat: pushChat(room, { id: randomUUID(), from: m.id, at: now, roll }) };
    }
    // ---- pruebas pedidas ----
    case 'requestCheck': {
      if (!isDM(m)) return DENY;
      const ids = m2.tokenIds, kind = m2.kind as string, key = m2.key as string;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 12 || !ids.every((x) => str(x, 64)) || new Set(ids).size !== ids.length) return { error: 'mensaje inválido' };
      if (!['save', 'skill', 'ability'].includes(kind) || !str(key, 32) || !Object.hasOwn(kind === 'skill' ? SKILLS : ABILITY_ES, key)) return { error: 'mensaje inválido' };
      if ((m2.dc !== undefined && !(Number.isInteger(m2.dc) && (m2.dc as number) >= 1 && (m2.dc as number) <= 40)) || (m2.blind !== undefined && typeof m2.blind !== 'boolean')) return { error: 'mensaje inválido' };
      const toks = ids.map((id) => s.tokens.find((t) => t.id === id));
      if (toks.some((t) => !t)) return { error: 'token inexistente' };
      const blind = m2.blind === true, dc = m2.dc as number | undefined, ab = (kind === 'skill' ? SKILLS[key].ability : key) as Ability;
      const label = (kind === 'save' ? `Salvación de ${ABILITY_ES[ab]}` : kind === 'skill' ? `${SKILLS[key].name} (${ABILITY_ES[ab]})` : `Prueba de ${ABILITY_ES[ab]}`) + (dc && !blind ? ` CD ${dc}` : '');
      const rq: CheckReq = { id: randomUUID(), tokenIds: ids as Id[], kind: kind as CheckReq['kind'], key, ...(dc && { dc }), blind, label, answers: new Map() };
      const checks = (room.checks ??= new Map());
      if (checks.size >= 20) checks.delete(checks.keys().next().value!); // ponytail: las 20 peticiones más recientes
      checks.set(rq.id, rq);
      const owners = new Set(toks.flatMap((t) => t!.owners)); // solo los dueños reciben la petición (el DM ya la conoce)
      return { sends: [...owners].map((o) => ({ who: (x: MemberRec) => x.id === o, msg: { t: 'checkRequest', id: rq.id, tokenIds: toks.filter((t) => t!.owners.includes(o)).map((t) => t!.id), kind: rq.kind, key, label, ...(dc && !blind && { dc }) } as S2C })) };
    }
    case 'answerCheck': {
      if (!str(m2.requestId, 64) || !str(m2.tokenId, 64)) return { error: 'mensaje inválido' };
      const rq = room.checks?.get(m2.requestId);
      if (!rq) return { error: 'petición inexistente o cerrada' };
      if (m2.tokenId === '*') { // el DM cierra la petición aunque falten respuestas
        if (!isDM(m)) return DENY;
        return { state: true, chats: closeCheck(ctx, rq) };
      }
      if (!rq.tokenIds.includes(m2.tokenId)) return { error: 'el token no está en la petición' };
      const t = s.tokens.find((x) => x.id === m2.tokenId);
      if (!t) return { error: 'token inexistente' };
      if (!t.owners.includes(m.id) && !(isDM(m) && t.owners.length === 0)) return DENY; // el DM responde por los PNJ sin dueño
      if (rq.answers.has(t.id)) return { error: 'ya respondida' };
      const r = d20Test(ctx, t, rq.kind, rq.key), ab = rq.kind === 'skill' ? SKILLS[rq.key].ability : rq.key as Ability;
      const ok = rq.dc === undefined ? undefined : r.total >= rq.dc;
      rq.answers.set(t.id, { name: t.name, total: r.total, ...(ok !== undefined && { ok }) });
      const expr = `${t.name}: ${rq.kind === 'skill' ? `${SKILLS[rq.key].name} (${ABILITY_ES[ab]})` : rq.kind === 'save' ? `Salvación ${ABILITY_ES[ab]}` : `Prueba de ${ABILITY_ES[ab]}`} ${sg(r.mod)}`;
      const chat = pushChat(room, { id: randomUUID(), from: m.id, at: now, roll: { expr, total: r.total, detail: r.detail, secret: false, ...(rq.blind && { blind: true }), ...(r.dice && { dice: r.dice }) } });
      const chats = rq.answers.size >= rq.tokenIds.length ? closeCheck(ctx, rq) : [];
      return { state: true, chat, chats, ...(rq.blind && !isDM(m) && { to: { id: m.id, msg: { t: 'chat', msg: { id: randomUUID(), from: m.id, at: now, text: 'Has tirado: el DM verá el resultado' } } as S2C } }) };
    }
    // ---- cierre de sesión ----
    case 'sessionEnd': {
      if (role !== 'dm') return DENY;
      const summary = summarize(room, now);
      const date = new Date(now).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
      if (room.journal.length < MAX_JOURNAL) room.journal.push({ id: randomUUID(), title: `Sesión del ${date}`, body: summaryText(summary), visibleTo: 'all' });
      room.sessionStart = now; room.maxRound = 0;
      return { state: true, all: { t: 'sessionSummary', summary } };
    }
    // ---- tirada externa (Beyond20) ----
    case 'externalRoll': {
      if (m2.source !== 'beyond20' || !str(m2.name, 60) || !str(m2.expr, 100) || (m2.kind !== undefined && !short(m2.kind, 32))) return { error: 'mensaje inválido' };
      const dice = m2.dice;
      if (!Number.isInteger(m2.total) || Math.abs(m2.total as number) > 100_000 || !Array.isArray(dice) || dice.length > 30
        || !dice.every((d) => obj(d) && Number.isInteger(d.sides) && (d.sides as number) >= 2 && (d.sides as number) <= 1000 && Number.isInteger(d.value) && (d.value as number) >= 1 && (d.value as number) <= (d.sides as number) && typeof d.kept === 'boolean')) return { error: 'tirada inválida' };
      const expected = expectedTotal(m2.expr, dice as Die[]);
      if (expected === null || expected !== m2.total) return { error: 'la tirada no cuadra con la expresión' };
      const log = ((room.extLog ??= new Map()).get(m.id) ?? []).filter((x: number) => now - x < 60_000);
      if (log.length >= 20) return { error: 'demasiadas tiradas externas (máximo 20 por minuto)' };
      log.push(now); room.extLog.set(m.id, log);
      const ds = (dice as Die[]).map((d) => d.value + (d.kept ? '' : '✗')).join(', ');
      // ponytail: el servidor no puede verificar que los dados sean reales; solo comprueba coherencia. El cliente la marca «tirada externa».
      return { chat: pushChat(room, { id: randomUUID(), from: m.id, at: now, roll: { expr: m2.name, total: m2.total as number, detail: `${m2.expr}${ds ? ` [${ds}]` : ''} = ${m2.total}`, secret: false, external: 'beyond20', dice: (dice as Die[]).map((d) => ({ sides: d.sides, value: d.value, kept: d.kept })) } }) };
    }
    // ---- biblioteca de escenas ----
    case 'sceneNew': {
      if (!isDM(m)) return DENY;
      if (!str(m2.name, 60) || (m2.from !== undefined && !str(m2.from, 64))) return { error: 'mensaje inválido' };
      if (Object.keys(room.scenes).length >= MAX_SCENES) return { error: 'demasiadas escenas' };
      const src = m2.from === undefined ? null : Object.hasOwn(room.scenes, m2.from) ? room.scenes[m2.from] : undefined;
      if (src === undefined) return { error: 'escena inexistente' };
      const sc: Scene = src ? structuredClone(src) : { id: '', name: '', width: 1400, height: 1000, grid: { size: 60, offsetX: 0, offsetY: 0, feet: 5 }, walls: [], lights: [], tokens: [], globalLight: 1 };
      sc.id = randomUUID(); sc.name = m2.name;
      for (const e of [...sc.tokens, ...sc.walls]) e.id = randomUUID();
      for (const r of sc.regions ?? []) delete r.fired;
      room.scenes[sc.id] = sc;
      return { state: true };
    }
    case 'sceneActivate': {
      if (!isDM(m)) return DENY;
      if (!str(m2.id, 64) || !Object.hasOwn(room.scenes, m2.id)) return { error: 'escena inexistente' };
      room.activeId = m2.id;
      room.pending = [];
      delete room.combat;
      const pre = room.scenes[m2.id].audioPreset;
      if (pre) { room.audio = structuredClone(pre); if (room.audio.track) room.audio.track.startedAt = now; }
      return { state: true };
    }
    case 'sceneUpdate': {
      if (!isDM(m)) return DENY;
      if (!str(m2.id, 64) || (m2.name !== undefined && !str(m2.name, 60)) || (m2.folder !== undefined && !short(m2.folder, 40))) return { error: 'mensaje inválido' };
      if (!Object.hasOwn(room.scenes, m2.id)) return { error: 'escena inexistente' };
      const sc = room.scenes[m2.id];
      if (m2.name !== undefined) sc.name = m2.name;
      if (m2.folder !== undefined) { if (m2.folder) sc.folder = m2.folder; else delete sc.folder; } // '' quita la carpeta
      if (m2.visibleTo !== undefined) { // null/[] = todos; solo miembros existentes
        if (m2.visibleTo !== null && !(Array.isArray(m2.visibleTo) && m2.visibleTo.length <= 50 && m2.visibleTo.every((id) => str(id, 64) && room.members.has(id)))) return { error: 'mensaje inválido' };
        if (m2.visibleTo?.length) sc.visibleTo = [...new Set(m2.visibleTo)]; else delete sc.visibleTo;
      }
      return { state: true };
    }
    case 'sceneDelete': {
      if (!isDM(m)) return DENY;
      if (!str(m2.id, 64) || !Object.hasOwn(room.scenes, m2.id)) return { error: 'escena inexistente' };
      if (m2.id === room.activeId) return { error: 'no se puede borrar la escena activa' };
      delete room.scenes[m2.id];
      return { state: true };
    }
    // ---- diario ----
    case 'journal': {
      if (!isDM(m)) return DENY;
      const e = parseJournal(m2.entry, room.members);
      if (!e) return { error: 'entrada inválida' };
      const i = room.journal.findIndex((x) => x.id === e.id);
      if (i >= 0) room.journal[i] = e;
      else if (room.journal.length >= MAX_JOURNAL) return { error: 'demasiadas entradas' };
      else room.journal.push(e);
      return { state: true };
    }
    case 'journalDelete': {
      if (!isDM(m)) return DENY;
      const i = str(m2.id, 64) ? room.journal.findIndex((x) => x.id === m2.id) : -1;
      if (i < 0) return { error: 'no existe' };
      room.journal.splice(i, 1);
      return { state: true };
    }
    case 'handout': {
      if (!isDM(m)) return DENY;
      const e = str(m2.entryId, 64) ? room.journal.find((x) => x.id === m2.entryId) : undefined;
      if (!e) return { error: 'no existe' };
      return { sends: [{ who: (x) => canRead(e, x), msg: { t: 'handout', entry: structuredClone(e) } }] };
    }
    case 'tokenOwners': {
      if (!isDM(m)) return DENY;
      const t = tokenOf();
      if (!t) return { error: 'token inexistente' };
      if (!Array.isArray(m2.owners) || m2.owners.length > 50 || !m2.owners.every((id) => str(id, 64) && room.members.get(id) && room.members.get(id)!.role !== 'spectator')) return { error: 'mensaje inválido' };
      t.owners = [...new Set(m2.owners as string[])];
      return { state: true };
    }
    default: return { error: 'mensaje desconocido' };
  }
}

export function pushChat(room: Room, c: ChatMsg) {
  room.chat.push(c);
  if (room.chat.length > MAX_CHAT) room.chat.splice(0, room.chat.length - MAX_CHAT);
  return c;
}

// Crea un monstruo del SRD en la escena (tamaño par → esquina de casilla; impar → centro de casilla).
function spawnOne(s: Scene, srd: string, x: number, y: number, hidden: boolean) {
  const { cr: _cr, type: _ty, sizeName: _sn, align: _al, traits: _tr, legend: _lg, condImm: _ci, ...base } = structuredClone(MONSTERS[srd]); // la ficha completa se consulta por `srd`
  const g = s.grid, snap = (v: number, off: number) => base.size % 2 === 0 ? Math.round((v - off) / g.size) * g.size + off : Math.floor((v - off) / g.size) * g.size + off + g.size / 2;
  const names = new Set(s.tokens.map((t) => t.name));
  let name = base.name;
  for (let n = 2; names.has(name); n++) name = `${base.name} ${n}`;
  let id = srd;
  for (let n = 2; s.tokens.some((t) => t.id === id); n++) id = `${srd}-${n}`;
  s.tokens.push({ ...base, id, name, x: snap(x, g.offsetX), y: snap(y, g.offsetY), owners: [], hidden, srd });
}

// Efectos de las regiones al entrar un token (centro nuevo dentro, viejo fuera). `once` marca `fired`.
function regionFx(c: Ctx, t: Token, from: Point): Pick<Effect, 'chats' | 'sends'> {
  const chats: ChatMsg[] = [], sends: NonNullable<Effect['sends']> = [], s = c.room.scene, to = { x: t.x, y: t.y };
  const entered = (s.regions ?? []).filter((r) => flr(s, r.level) === flr(s, t.level) && inRegion(r, to) && !inRegion(r, from) && !(r.once && r.fired) && !(r.onlyAllies && t.faction !== 'ally') && (r.trigger ?? 'enter') === 'enter');
  for (const r of entered) {
    if (!['trap', 'teleport', 'sound', 'message'].includes(r.kind) && !r.toLevel) continue;
    fireRegion(c, t, r, chats, sends);
  }
  return { chats, sends };
}

// Dispara una región sobre un token (al entrar, o al empezar/terminar turno: combat2). `once` marca `fired`.
export function fireRegion(c: Ctx, t: Token, r: Region, chats: ChatMsg[], sends: NonNullable<Effect['sends']>) {
  const s = c.room.scene;
  if (r.once) r.fired = true;
  if (r.sfx) sends.push({ who: () => true, msg: { t: 'sfx', name: r.sfx } });
  if (r.kind === 'message' && r.text) sends.push({ who: (m) => isDM(m) || t.owners.includes(m.id), msg: { t: 'regionMsg', text: r.text } });
  if ((r.kind === 'teleport' || r.toLevel) && r.to) { t.x = r.to.x; t.y = r.to.y; }
  if ((r.kind === 'teleport' || r.toLevel) && r.toLevel) { if (flr(s, r.toLevel)) t.level = r.toLevel; else delete t.level; } // escalera: cambia de planta (la base = sin level)
  if (r.kind !== 'trap') return;
  let ok = false, roll: ReturnType<typeof d20Test> | undefined;
  if (r.save) { roll = d20Test(c, t, 'save', r.save.ability); ok = roll.total >= r.save.dc; }
  const dmg = r.damage ? c.rollFn(r.damage) : undefined, full = dmg?.total ?? 0, amount = ok ? Math.floor(full / 2) : full;
  const card: ActionCard = { actorId: t.id, actorName: t.name, actionName: r.name, kind: 'save', ...(r.damageType && { damageType: r.damageType }),
    targets: [{ id: t.id, name: t.name, ...(r.save && roll && { save: { total: roll.total, success: ok, ability: r.save.ability, dc: r.save.dc } }), ...(dmg && { amount }) }],
    detail: [roll?.detail, dmg?.detail].filter(Boolean).join(' · '), dice: [...(roll?.dice ?? []), ...(dmg?.dice ?? [])], applied: true };
  chats.push(pushChat(c.room, { id: randomUUID(), from: c.from, at: c.now, card }));
  if (t.hp && amount > 0) {
    const prev = { ...t.hp }, res = applyDamage(prev, amount, r.damageType ?? '', t.defenses);
    t.hp = res.hp; chats.push(...damageFx(c, t, prev, res.taken));
  }
  if (!ok && r.condition) addCond(t, r.condition);
}

// Total esperado de una tirada externa: dados (según `kept`) con el signo de su término + constantes; null si no cuadra la estructura con la expresión.
function expectedTotal(expr: string, dice: Die[]): number | null {
  try { diceRoll(expr, () => 0); } catch { return null; } // solo valida la sintaxis
  let i = 0, total = 0;
  for (const p of expr.toLowerCase().replace(/\s+/g, '').match(/[+-]?[^+-]+/g)!) {
    const sign = p.startsWith('-') ? -1 : 1, body = p.replace(/^[+-]/, ''), d = /^(\d*)d(\d+)(?:k([hl])(\d+))?$/.exec(body);
    if (!d) { total += sign * Number(body); continue; }
    const n = d[1] === '' ? 1 : Number(d[1]), keep = d[4] ? Number(d[4]) : n, mine = dice.slice(i, i + n);
    i += n;
    if (mine.length < n || mine.some((x) => x.sides !== Number(d[2])) || mine.filter((x) => x.kept).length !== keep) return null;
    total += sign * mine.reduce((a, x) => a + (x.kept ? x.value : 0), 0);
  }
  return i === dice.length ? total : null;
}

// Cierra una petición de prueba: tarjeta resumen con éxitos y fallos (si hay CD). A ciegas, solo la ve el DM.
function closeCheck(c: Ctx, rq: CheckReq): ChatMsg[] {
  c.room.checks?.delete(rq.id);
  if (!rq.answers.size) return [];
  const ab = (rq.kind === 'skill' ? SKILLS[rq.key].ability : rq.key) as Ability, all = [...rq.answers.entries()];
  const ok = all.filter(([, a]) => a.ok).length;
  const card: ActionCard = { actorId: rq.tokenIds[0], actorName: rq.label, actionName: rq.label, kind: 'save',
    targets: all.map(([id, a]) => ({ id, name: a.name, ...(rq.dc !== undefined && { save: { total: a.total, success: a.ok!, ability: ab, dc: rq.dc } }) })),
    detail: all.map(([, a]) => `${a.name} ${a.total}`).join(', ') + (rq.dc !== undefined ? ` · Éxitos: ${ok}, fallos: ${all.length - ok}` : ''), applied: true };
  // a ciegas: el mensaje lleva una tirada blind para que canSee/redact lo oculten a todos salvo DM y asistente
  return [pushChat(c.room, { id: randomUUID(), from: c.from, at: c.now, card, ...(rq.blind && { roll: { expr: rq.label, total: ok, detail: 'resumen', secret: true, blind: true } }) })];
}

// Resumen de sesión a partir del chat desde sessionStart.
// ponytail: el chat guarda 200 mensajes; una sesión larga se resume solo con lo que queda. Confirmar «mitad»/«nada» cuenta como daño completo. Kills y caídas se leen del texto del chat y solo se reconocen tokens que siguen en alguna escena.
function summarize(room: Room, now: number): SessionSummary {
  const toks = Object.values(room.scenes).flatMap((sc) => sc.tokens), hid = new Set(toks.filter((t) => t.hidden).map((t) => t.id)), hidName = new Set(toks.filter((t) => t.hidden).map((t) => t.name));
  const per = new Map<Id, SessionSummary['perToken'][number]>(), highlights: SessionSummary['highlights'] = [], crs: string[] = [], done = new Set<string>();
  const P = (tokenId: Id, name: string) => { let p = per.get(tokenId); if (!p) per.set(tokenId, p = { tokenId, name, damageDealt: 0, damageTaken: 0, healed: 0, crits: 0 }); return p; };
  let best: { v: number; who: string } | undefined;
  const d20 = (dice: Die[] | undefined, who: string) => { for (const d of dice ?? []) if (d.sides === 20 && d.kept && (!best || d.value > best.v)) best = { v: d.value, who }; };
  for (const c of room.chat) {
    if (c.at < room.sessionStart) continue;
    if (c.roll && !c.roll.secret && !c.roll.blind) d20(c.roll.dice, room.members.get(c.from)?.name ?? '?');
    const card = c.card;
    if (card?.applied && !c.roll && !hid.has(card.actorId)) {
      const key = JSON.stringify(card); // la confirmación repite la tarjeta del chat: se cuenta una vez
      if (done.has(key)) continue;
      done.add(key);
      d20(card.dice, card.actorName);
      for (const t of card.targets) {
        if (hid.has(t.id)) continue;
        const amt = t.amount ?? 0;
        if (card.kind === 'heal') P(t.id, t.name).healed += amt;
        else if (amt > 0) { P(t.id, t.name).damageTaken += amt; if (t.id !== card.actorId) P(card.actorId, card.actorName).damageDealt += amt; }
        if (t.attack?.crit) { P(card.actorId, card.actorName).crits++; highlights.push({ kind: 'crit', text: `${card.actorName} logra un crítico contra ${t.name}` }); }
        else if (t.attack?.d20 === 1) highlights.push({ kind: 'fumble', text: `${card.actorName} pifia contra ${t.name}` });
      }
    }
    const e = c.text && /^(.+) (muere|cae inconsciente)$/.exec(c.text);
    if (e && !done.has(c.id)) {
      const tk = toks.find((t) => t.name === e[1]), hide = hidName.has(e[1]);
      if (e[2] === 'muere' && tk && tk.faction !== 'ally' && !done.has('k' + tk.name)) {
        done.add('k' + tk.name);
        if (tk.srd && Object.hasOwn(MONSTERS, tk.srd)) crs.push(MONSTERS[tk.srd].cr);
        if (!hide) highlights.push({ kind: 'kill', text: `${tk.name} derrotado` });
      } else if (e[2] !== 'muere' && tk?.faction === 'ally') highlights.push({ kind: 'down', text: `${tk.name} cae a 0 PG` });
    }
  }
  if (best) highlights.push({ kind: 'highest', text: `${best.who} sacó un ${best.v} en un d20` });
  return { started: room.sessionStart, ended: now, rounds: room.maxRound, highlights, perToken: [...per.values()], xp: encounterXP(crs) };
}

const summaryText = (r: SessionSummary) => [
  `Rondas de combate: ${r.rounds}`, `PX ganados: ${r.xp ?? 0}`,
  ...r.highlights.map((h) => `- ${h.text}`),
  ...r.perToken.map((p) => `${p.name}: daño hecho ${p.damageDealt}, recibido ${p.damageTaken}, curación ${p.healed}, críticos ${p.crits}`),
].join('\n');

/** Temporizador del servidor: revela las salvaciones de jugadores caducadas aunque nadie escriba (y las que quedaron retenidas antes de un reinicio). */
export function sweepHolds(room: Room, rollFn: RollFn, now = Date.now()): Effect | null {
  if (!room.pending.some((c) => c.awaiting)) return null;
  const dm = [...room.members.values()].find((m) => m.role === 'dm');
  const chats = dm ? sweepSaves({ room, from: dm.id, now, rollFn }) : [];
  return chats.length ? { state: true, chats } : null;
}
