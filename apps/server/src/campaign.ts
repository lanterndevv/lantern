// Exportar/importar campañas (formato abierto, ver FORMAT.md) e importar mapas Universal VTT.
import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS } from '@lantern/protocol';
import type { JournalEntry, Light, Scene, TableSettings, Wall } from '@lantern/protocol';
import { mergeSettings, type Room } from './room.ts';
import { MAX_JOURNAL, MAX_SCENES, obj, parseJournal, parseScene } from './validate.ts';

export const MAX_ASSET = 25 * 1024 * 1024, MAX_EXPORT = 200 * 1024 * 1024;
export const ASSET_RE = /^([0-9a-f]{64})\.(png|jpg|webp|mp3|ogg|webm|mp4)$/;
export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export async function exportCampaign(room: Room, read: (name: string) => Promise<Buffer | null>): Promise<object | 'tooLarge'> {
  const scenes = Object.values(room.scenes), journal = room.journal;
  const refs = new Set([...JSON.stringify([scenes, journal]).matchAll(/\/assets\/([0-9a-f]{64}\.(?:png|jpg|webp|mp3|ogg|webm|mp4))/g)].map((m) => m[1]));
  const assets: Record<string, string> = {};
  let size = 0;
  for (const name of refs) {
    const b = await read(name);
    if (!b) continue; // referencia rota: se omite
    if ((size += Math.ceil(b.length / 3) * 4) > MAX_EXPORT) return 'tooLarge'; // el límite cuenta el base64
    assets[name] = b.toString('base64');
  }
  return { format: 'lantern-campaign', version: 1, exportedAt: new Date().toISOString(), scenes, activeId: room.activeId, journal, settings: room.settings, assets };
}

export type Imported = { scenes: Scene[]; activeId: string; journal: JournalEntry[]; settings: TableSettings; assets: Map<string, Buffer> };

export function importCampaign(v: unknown): Imported | { error: string } {
  if (!obj(v) || v.format !== 'lantern-campaign' || v.version !== 1) return { error: 'formato no reconocido' };
  if (!Array.isArray(v.scenes) || v.scenes.length < 1 || v.scenes.length > MAX_SCENES) return { error: 'escenas inválidas' };
  const scenes = v.scenes.map(parseScene);
  const bad = scenes.findIndex((s) => !s);
  if (bad >= 0) return { error: `escena ${bad + 1} inválida` };
  const ok = scenes as Scene[];
  if (new Set(ok.map((s) => s.id)).size !== ok.length) return { error: 'ids de escena repetidos' };
  for (const s of ok) for (const t of s.tokens) t.owners = []; // los miembros de la mesa original no existen aquí
  const activeId = typeof v.activeId === 'string' && ok.some((s) => s.id === v.activeId) ? v.activeId : ok[0].id;
  const rawJ = v.journal ?? [];
  if (!Array.isArray(rawJ) || rawJ.length > MAX_JOURNAL) return { error: 'diario inválido' };
  const journal = rawJ.map((e) => parseJournal(obj(e) && Array.isArray(e.visibleTo) ? { ...e, visibleTo: 'dm' } : e, new Map())); // listas de miembros → solo DM
  if (journal.some((e) => !e) || new Set(journal.map((e) => e!.id)).size !== journal.length) return { error: 'diario inválido' };
  const settings = v.settings === undefined ? structuredClone(DEFAULT_SETTINGS) : mergeSettings(structuredClone(DEFAULT_SETTINGS), v.settings);
  if (!settings) return { error: 'ajustes inválidos' };
  const assets = new Map<string, Buffer>();
  if (v.assets !== undefined) {
    if (!obj(v.assets) || Object.keys(v.assets).length > 2000) return { error: 'recursos inválidos' };
    for (const [name, b64] of Object.entries(v.assets)) {
      const m = ASSET_RE.exec(name);
      if (!m || typeof b64 !== 'string') return { error: `recurso inválido: ${name.slice(0, 80)}` };
      const b = Buffer.from(b64, 'base64');
      if (b.length > MAX_ASSET) return { error: `recurso demasiado grande: ${name}` };
      if (sha256(b) !== m[1]) return { error: `sha256 no coincide: ${name}` };
      assets.set(name, b);
    }
  }
  return { scenes: ok, activeId, journal: journal as JournalEntry[], settings, assets };
}

// ---- Universal VTT (.dd2vtt / .uvtt): coordenadas en casillas ----
const sniff = (b: Buffer) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'png'
  : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' ? 'webp'
  : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpg' : null;

export function parseUvtt(v: unknown): { scene: Scene; image?: { name: string; data: Buffer } } | { error: string; status?: number } {
  const bad = (error: string, status?: number) => ({ error, status });
  if (!obj(v) || !obj(v.resolution) || !obj(v.resolution.map_size)) return bad('no es un archivo Universal VTT');
  const ppg = v.resolution.pixels_per_grid, ms = v.resolution.map_size;
  if (typeof ppg !== 'number' || typeof ms.x !== 'number' || typeof ms.y !== 'number') return bad('resolución inválida');
  const W = ms.x * ppg, H = ms.y * ppg;
  const P = (p: unknown) => obj(p) && typeof p.x === 'number' && typeof p.y === 'number' ? { x: Math.min(W, Math.max(0, p.x * ppg)), y: Math.min(H, Math.max(0, p.y * ppg)) } : null;
  const walls: Wall[] = [];
  const add = (a: ReturnType<typeof P>, b: ReturnType<typeof P>, kind: Wall['kind'], extra: Partial<Wall> = {}) => {
    if (!a || !b) return false;
    walls.push({ id: 'uvtt-' + walls.length, a, b, kind, ...extra });
    return true;
  };
  for (const k of ['line_of_sight', 'objects_line_of_sight'] as const) {
    if (v[k] === undefined) continue;
    if (!Array.isArray(v[k])) return bad(k + ' inválido');
    for (const line of v[k]) {
      if (!Array.isArray(line)) return bad(k + ' inválido');
      for (let i = 0; i + 1 < line.length; i++) if (!add(P(line[i]), P(line[i + 1]), 'wall')) return bad(k + ' inválido');
    }
  }
  if (v.portals !== undefined) {
    if (!Array.isArray(v.portals)) return bad('portals inválido');
    for (const p of v.portals) if (!obj(p) || !Array.isArray(p.bounds) || !add(P(p.bounds[0]), P(p.bounds[1]), 'door', { open: p.closed === false })) return bad('portals inválido');
  }
  const lights: Light[] = [];
  if (v.lights !== undefined) {
    if (!Array.isArray(v.lights)) return bad('lights inválido');
    for (const l of v.lights) {
      const pos = obj(l) ? P(l.position) : null;
      if (!pos || !obj(l) || typeof l.range !== 'number') return bad('lights inválido');
      const c = typeof l.color === 'string' ? l.color.replace(/^#/, '') : '', dim = l.range * ppg; // color ARGB (aarrggbb) → #rrggbb
      lights.push({ id: 'uvtt-l' + lights.length, x: pos.x, y: pos.y, dim, bright: dim / 2, color: /^[0-9a-f]{8}$/i.test(c) ? '#' + c.slice(2) : /^[0-9a-f]{6}$/i.test(c) ? '#' + c : '#ffb85c' });
    }
  }
  let image: { name: string; data: Buffer } | undefined;
  if (v.image !== undefined) {
    if (typeof v.image !== 'string') return bad('imagen inválida');
    const data = Buffer.from(v.image, 'base64'), ext = sniff(data);
    if (!ext) return bad('imagen inválida (se admite png, webp o jpg)', 415);
    if (data.length > MAX_ASSET) return bad('imagen demasiado grande', 413);
    image = { name: sha256(data) + '.' + ext, data };
  }
  const scene = parseScene({ id: randomUUID(), name: 'Importada UVTT', width: W, height: H, grid: { size: ppg, offsetX: 0, offsetY: 0, feet: 5 }, walls, lights, tokens: [], globalLight: 1,
    ...(image && { background: '/assets/' + image.name }) });
  return scene ? { scene, image } : bad('mapa inválido (revisa tamaño, cuadrícula y número de muros)');
}
