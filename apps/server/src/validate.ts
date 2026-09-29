// Validación de todo lo que entra al servidor (mensajes de cliente e importaciones): nada es de fiar.
import type { ExtensionManifest, ExtensionPermission, Ability, AudioState, Id, JournalEntry, Light, Point, Region, Scene, Token, Wall } from '@lantern/protocol';
import { CONDITIONS, roll } from '@lantern/rules';
import { parseCharacter } from './import.ts';

export const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length >= 1 && v.length <= max;
export const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const short = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
export const inr = (v: unknown, a: number, b: number): v is number => num(v) && v >= a && v <= b;
const int = (v: unknown, a: number, b: number): v is number => Number.isInteger(v) && inr(v, a, b);
export const inScene = (s: Scene, x: unknown, y: unknown): x is number => num(x) && num(y) && x >= 0 && x <= s.width && y >= 0 && y <= s.height;
export const pt = (s: Scene, p: unknown): Point | null =>
  obj(p) && inScene(s, p.x, p.y) ? { x: p.x as number, y: p.y as number } : null;
// URL de recurso: https o ruta /assets/ propia (sin subdirectorios)
export const urlOk = (v: unknown): v is string => typeof v === 'string' && v.length <= 512 && (/^https:\/\/[^\s"'<>]+$/.test(v) || /^\/assets\/[\w.-]+$/.test(v));

export const WEATHER = ['none', 'rain', 'snow', 'fog', 'ash', 'storm', 'leaves', 'embers'];
export const SFX = ['door', 'thunder', 'roar', 'collapse', 'bell', 'scream', 'magic', 'coins', 'trap', 'hit', 'crit', 'heal', 'miss'];
export const MAX_ITEMS = 500, MAX_WALLS = 5000, MAX_REGIONS = 100, MAX_LAYERS = 12, MAX_SCENES = 100, MAX_JOURNAL = 500;
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const REGION_KINDS = ['difficult', 'trap', 'teleport', 'fog', 'darkness', 'sound', 'message'];

export function parseToken(s: Scene, v: unknown): Token | null {
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
  // Ficha completa: se valida con el mismo parser que los personajes importados (acciones, salvaciones, espacios…).
  const stats: Record<string, unknown> = { name: 'x', ddbId: 0, level: 1, classes: '', darkvision: 0 };
  for (const k of ['speed', 'initMod', 'saves', 'defenses', 'actions', 'slots', 'abilities', 'skills', 'prof'] as const) if (v[k] !== undefined) stats[k] = v[k];
  const c = parseCharacter(stats, 99);
  if (!c) return null;
  for (const k of ['speed', 'initMod', 'saves', 'defenses', 'actions', 'slots', 'abilities', 'skills', 'prof'] as const) if (c[k] !== undefined) (t as Record<string, unknown>)[k] = c[k];
  for (const k of ['srd', 'concentration'] as const) if (v[k] !== undefined) { if (!str(v[k], 64)) return null; t[k] = v[k]; }
  if (v.notes !== undefined) { if (!short(v.notes, 2000)) return null; t.notes = v.notes; }
  if (v.exhaustion !== undefined) { if (!int(v.exhaustion, 0, 6)) return null; t.exhaustion = v.exhaustion; }
  if (v.condRounds !== undefined) {
    const r = v.condRounds;
    if (!obj(r) || Object.keys(r).length > 50 || !Object.entries(r).every(([k, n]) => k.length <= 64 && int(n, 1, 100))) return null;
    t.condRounds = { ...r } as Record<string, number>;
  }
  if (v.deathSaves !== undefined) {
    const d = v.deathSaves;
    if (!obj(d) || !int(d.successes, 0, 3) || !int(d.failures, 0, 3)) return null;
    t.deathSaves = { successes: d.successes, failures: d.failures };
  }
  if (v.ddb !== undefined) {
    const d = v.ddb;
    if (!obj(d) || !int(d.id, 0, Number.MAX_SAFE_INTEGER) || !int(d.level, 1, 20) || !short(d.classes, 60) || !num(d.syncedAt)) return null;
    t.ddb = { id: d.id, level: d.level, classes: d.classes, syncedAt: d.syncedAt };
  }
  return t;
}

export function parseWall(s: Scene, v: unknown): Wall | null {
  if (!obj(v) || !str(v.id, 64)) return null;
  const a = pt(s, v.a), b = pt(s, v.b);
  if (!a || !b || !['wall', 'door', 'window', 'terrain'].includes(v.kind as string)) return null;
  const w: Wall = { id: v.id, a, b, kind: v.kind as Wall['kind'] };
  if (v.open !== undefined) { if (typeof v.open !== 'boolean') return null; w.open = v.open; }
  if (v.secret !== undefined) { if (typeof v.secret !== 'boolean') return null; w.secret = v.secret; }
  if (v.locked !== undefined) { if (typeof v.locked !== 'boolean') return null; w.locked = v.locked; }
  if (v.note !== undefined) { if (!short(v.note, 1000)) return null; w.note = v.note; }
  return w;
}

export function parseLight(s: Scene, v: unknown): Light | null {
  if (!obj(v) || !str(v.id, 64) || !inScene(s, v.x, v.y)) return null;
  if (!num(v.bright) || !num(v.dim) || v.bright < 0 || v.dim < 0) return null;
  if (typeof v.color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(v.color)) return null;
  const l: Light = { id: v.id, x: v.x as number, y: v.y as number, bright: v.bright, dim: v.dim, color: v.color };
  if (v.anim !== undefined) { if (v.anim !== 'none' && v.anim !== 'torch' && v.anim !== 'pulse') return null; l.anim = v.anim; }
  return l;
}

// Expresión de dados válida y acotada: 0 ≤ mínimo y máximo ≤ 1000
const diceOk = (e: unknown): e is string => {
  if (!str(e, 64)) return false;
  try { return roll(e, () => 0).total >= 0 && roll(e, () => 0.999999).total <= 1000; } catch { return false; }
};

export function parseRegion(s: Scene, v: unknown): Region | null {
  if (!obj(v) || !str(v.id, 64) || !str(v.name, 60) || !REGION_KINDS.includes(v.kind as string) || typeof v.hidden !== 'boolean') return null;
  if (!Array.isArray(v.points) || v.points.length < 3 || v.points.length > 64) return null;
  const points = v.points.map((p) => pt(s, p));
  if (points.some((p) => !p)) return null;
  const r: Region = { id: v.id, name: v.name, points: points as Point[], kind: v.kind as Region['kind'], hidden: v.hidden };
  for (const k of ['once', 'fired', 'onlyAllies'] as const) if (v[k] !== undefined) { if (typeof v[k] !== 'boolean') return null; r[k] = v[k]; }
  if (v.save !== undefined) {
    const sv = v.save;
    if (!obj(sv) || !ABILITIES.includes(sv.ability as string) || !int(sv.dc, 1, 30)) return null;
    r.save = { ability: sv.ability as Ability, dc: sv.dc };
  }
  if (v.damage !== undefined) { if (!diceOk(v.damage)) return null; r.damage = v.damage; }
  if (v.damageType !== undefined) { if (typeof v.damageType !== 'string' || !/^[a-z]{1,30}$/.test(v.damageType)) return null; r.damageType = v.damageType; }
  if (v.condition !== undefined) { if (typeof v.condition !== 'string' || !Object.hasOwn(CONDITIONS, v.condition)) return null; r.condition = v.condition; }
  if (v.to !== undefined) { const to = pt(s, v.to); if (!to) return null; r.to = to; }
  if (v.sfx !== undefined) { if (typeof v.sfx !== 'string' || !SFX.includes(v.sfx)) return null; r.sfx = v.sfx; }
  if (v.text !== undefined) { if (!short(v.text, 400)) return null; r.text = v.text; }
  if (r.kind === 'teleport' && !r.to) return null;
  if (r.kind === 'message' && !r.text) return null;
  return r;
}

export function parseLayer(l: unknown): AudioState['layers'][number] | null {
  if (!obj(l) || !str(l.id, 64) || !urlOk(l.url) || !str(l.name, 100) || !inr(l.volume, 0, 1)) return null;
  const pos = l.x !== undefined || l.y !== undefined || l.radius !== undefined;
  if (pos && !(num(l.x) && num(l.y) && num(l.radius) && l.radius > 0)) return null;
  return { id: l.id, url: l.url, name: l.name, volume: l.volume, ...(pos && { x: l.x as number, y: l.y as number, radius: l.radius as number }) };
}

export function parseAudio(v: unknown): AudioState | null {
  if (!obj(v) || !Array.isArray(v.layers) || v.layers.length > MAX_LAYERS) return null;
  const layers = v.layers.map(parseLayer);
  if (layers.some((l) => !l)) return null;
  const a: AudioState = { layers: layers as AudioState['layers'] };
  if (v.track !== undefined) {
    const t = v.track;
    if (!obj(t) || !urlOk(t.url) || !str(t.name, 100) || !num(t.startedAt) || typeof t.loop !== 'boolean') return null;
    a.track = { url: t.url, name: t.name, startedAt: t.startedAt, loop: t.loop };
  }
  return a;
}

export function parseJournal(v: unknown, members: ReadonlyMap<Id, unknown>): JournalEntry | null {
  if (!obj(v) || !str(v.id, 64) || !str(v.title, 120) || !short(v.body, 20000)) return null;
  const vt = v.visibleTo;
  let visibleTo: JournalEntry['visibleTo'];
  if (vt === 'dm' || vt === 'all') visibleTo = vt;
  else if (Array.isArray(vt) && vt.length <= 50 && vt.every((id) => str(id, 64) && members.has(id))) visibleTo = [...new Set(vt as string[])];
  else return null;
  const e: JournalEntry = { id: v.id, title: v.title, body: v.body, visibleTo };
  if (v.image !== undefined) { if (!urlOk(v.image)) return null; e.image = v.image; }
  if (v.folder !== undefined) { if (!str(v.folder, 40)) return null; e.folder = v.folder; }
  return e;
}

const PATCH_KEYS = ['name', 'background', 'globalLight', 'weather', 'story', 'grid', 'width', 'height'];

// Valida un patch de escena y lo mezcla sobre `s`. Devuelve false (sin tocar nada) si algo es inválido.
export function patchScene(s: Scene, patch: unknown): boolean {
  if (!obj(patch)) return false;
  const p = patch, n: Partial<Scene> = {};
  for (const k of Object.keys(p)) if (!PATCH_KEYS.includes(k)) return false;
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

// Escena completa (importación de campañas y UVTT): mismas funciones que los mensajes C2S.
export function parseScene(v: unknown): Scene | null {
  if (!obj(v) || !str(v.id, 64) || !('name' in v) || !('width' in v) || !('height' in v) || !('grid' in v)) return null;
  const s: Scene = { id: v.id, name: 'x', width: 100, height: 100, grid: { size: 60, offsetX: 0, offsetY: 0, feet: 5 }, walls: [], lights: [], tokens: [], globalLight: 1 };
  if (!patchScene(s, Object.fromEntries(PATCH_KEYS.filter((k) => k in v).map((k) => [k, v[k]])))) return null;
  const list = <T extends { id: Id }>(raw: unknown, max: number, f: (x: unknown) => T | null): T[] | null => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > max) return null;
    const out = raw.map(f);
    return out.some((x) => !x) || new Set(out.map((x) => x!.id)).size !== out.length ? null : out as T[];
  };
  const walls = list(v.walls, MAX_WALLS, (x) => parseWall(s, x)), lights = list(v.lights, MAX_ITEMS, (x) => parseLight(s, x));
  const tokens = list(v.tokens, MAX_ITEMS, (x) => parseToken(s, x)), regions = list(v.regions, MAX_REGIONS, (x) => parseRegion(s, x));
  if (!walls || !lights || !tokens || !regions) return null;
  Object.assign(s, { walls, lights, tokens });
  if (regions.length) s.regions = regions;
  if (v.folder !== undefined) { if (!str(v.folder, 40)) return null; s.folder = v.folder; }
  if (v.dmNotes !== undefined) { if (!short(v.dmNotes, 5000)) return null; s.dmNotes = v.dmNotes; }
  if (v.audioPreset !== undefined) { const a = parseAudio(v.audioPreset); if (!a) return null; s.audioPreset = a; }
  return s;
}

export const MAX_EXTENSIONS = 10;
const EXT_PERMS: ExtensionPermission[] = ['state', 'chat', 'roll', 'contextMenu', 'panel', 'tokens'];
/** Valida un manifiesto de extensión: devuelve el manifiesto limpio (solo campos conocidos) o el motivo del rechazo. */
export function parseManifest(v: unknown): ExtensionManifest | string {
  const bad = 'manifiesto inválido';
  if (!obj(v)) return bad;
  if (typeof v.id !== 'string' || !/^[a-z0-9-]{3,40}$/.test(v.id)) return 'id de extensión inválido';
  if (!str(v.name, 60) || !str(v.version, 20)) return bad;
  for (const [k, max] of [['author', 60], ['description', 300]] as const) if (v[k] !== undefined && !short(v[k], max)) return bad;
  if (typeof v.url !== 'string' || v.url.length > 300) return 'url de extensión inválida';
  let u: URL;
  try { u = new URL(v.url); } catch { return 'url de extensión inválida'; }
  const local = u.protocol === 'http:' && u.hostname === 'localhost' && u.port !== ''; // desarrollo
  if ((u.protocol !== 'https:' && !local) || u.username || u.password || /[\s"'<>]/.test(v.url)) return 'url de extensión inválida';
  const p = v.permissions;
  if (!Array.isArray(p) || p.length > EXT_PERMS.length || new Set(p).size !== p.length || !p.every((x) => EXT_PERMS.includes(x))) return 'permisos inválidos';
  return { id: v.id, name: v.name, version: v.version, ...(v.author !== undefined && { author: v.author as string }), ...(v.description !== undefined && { description: v.description as string }), url: v.url, permissions: p };
}
