// Copias automáticas de la campaña (JSON sin recursos: estos ya viven en disco, direccionados por hash), restauración y fusión selectiva.
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Scene } from '@lantern/protocol';
import { exportCampaign, importCampaign, type Imported } from './campaign.ts';
import { mergeSettings, type Room } from './room.ts';
import { MAX_ITEMS, MAX_JOURNAL, MAX_SCENES, obj, parseJournal } from './validate.ts';

const KEEP = 10, NAME = /^\d{8}T\d{9}Z\.json$/;
const stamp = (at: number) => new Date(at).toISOString().replace(/[-:.]/g, '');

export function createBackups(root: string | undefined) {
  const last = new Map<string, string>(); // hash del último contenido guardado por mesa
  const dir = (code: string) => join(root!, code.replace(/[^A-Z0-9]/g, ''));
  const list = (code: string) => {
    if (!root) return [];
    try { return readdirSync(dir(code)).filter((n) => NAME.test(n)).sort().reverse().map((name) => ({ name, at: Date.parse(name.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z\.json$/, '$1-$2-$3T$4:$5:$6.$7Z')), size: statSync(join(dir(code), name)).size })); } catch { return []; }
  };
  return {
    enabled: !!root,
    list,
    /** Guarda una copia si algo cambió desde la anterior; rota las últimas 10. Devuelve el nombre o null. */
    async save(room: Room, now = Date.now()): Promise<string | null> {
      if (!root) return null;
      const out = await exportCampaign(room, async () => null);
      if (out === 'tooLarge') return null;
      const { exportedAt: _e, ...rest } = out as Record<string, unknown>, body = JSON.stringify(rest), h = createHash('sha256').update(body).digest('hex');
      if (last.get(room.code) === h) return null;
      mkdirSync(dir(room.code), { recursive: true });
      let name = stamp(now) + '.json';
      while (list(room.code).some((b) => b.name === name)) name = stamp(++now) + '.json';
      writeFileSync(join(dir(room.code), name), JSON.stringify({ ...rest, exportedAt: new Date(now).toISOString(), members: [...room.members.values()].map((m) => m.id) }));
      last.set(room.code, h);
      for (const b of list(room.code).slice(KEEP)) rmSync(join(dir(room.code), b.name), { force: true });
      return name;
    },
    read(code: string, name: unknown): unknown {
      if (!root || typeof name !== 'string' || !NAME.test(name)) return undefined;
      try { return JSON.parse(readFileSync(join(dir(code), name), 'utf8')); } catch { return undefined; }
    },
  };
}

/** Restaura una copia en la misma mesa: conserva miembros, dueños de tokens y visibilidad del diario. */
export function restoreInto(room: Room, raw: unknown): string | null {
  const imp = importCampaign(raw);
  if ('error' in imp) return imp.error;
  const rs = (raw as { scenes: { id: string; tokens?: { id: string; owners?: unknown }[] }[] }).scenes;
  for (const s of imp.scenes) for (const t of s.tokens) {
    const o = rs.find((x) => x.id === s.id)?.tokens?.find((x) => x.id === t.id)?.owners;
    if (Array.isArray(o)) t.owners = o.filter((id): id is string => typeof id === 'string' && room.members.has(id));
  }
  const rj = (raw as { journal?: unknown[] }).journal ?? [];
  room.scenes = Object.fromEntries(imp.scenes.map((s) => [s.id, s]));
  room.activeId = imp.activeId;
  room.journal = rj.map((e) => parseJournal(e, room.members)).filter((e): e is NonNullable<typeof e> => !!e);
  room.settings = mergeSettings(structuredClone(room.settings), imp.settings) ?? room.settings;
  room.pending = []; delete room.combat;
  return null;
}

export type Selection = { scenes: string[]; journal: string[]; characters: string[] };
/** Fusión selectiva: añade a la mesa solo lo elegido (ids nuevos si chocan). Devuelve cuántos elementos entraron. */
export function mergeInto(room: Room, imp: Imported, pick: Selection) {
  const n = { scenes: 0, journal: 0, characters: 0 };
  for (const s of imp.scenes) {
    if (!pick.scenes.includes(s.id) || Object.keys(room.scenes).length >= MAX_SCENES) continue;
    const c: Scene = structuredClone(s);
    if (Object.hasOwn(room.scenes, c.id)) c.id = randomUUID();
    room.scenes[c.id] = c; n.scenes++;
  }
  for (const e of imp.journal) {
    if (!pick.journal.includes(e.id) || room.journal.length >= MAX_JOURNAL) continue;
    room.journal.push({ ...structuredClone(e), id: room.journal.some((x) => x.id === e.id) ? randomUUID() : e.id }); n.journal++;
  }
  const s = room.scene;
  for (const t of imp.scenes.flatMap((x) => x.tokens)) {
    if (!pick.characters.includes(t.id) || t.faction !== 'ally' || s.tokens.length >= MAX_ITEMS) continue;
    const c = structuredClone(t);
    if (s.tokens.some((x) => x.id === c.id)) c.id = randomUUID();
    c.owners = []; c.x = Math.min(s.width, s.width / 2 + n.characters * s.grid.size); c.y = s.height / 2; delete c.level;
    s.tokens.push(c); n.characters++;
  }
  return n;
}

export const parsePick = (v: unknown): Selection | null => {
  const ids = (x: unknown) => Array.isArray(x) && x.length <= 2000 && x.every((i) => typeof i === 'string') ? x as string[] : null;
  if (!obj(v)) return null;
  const scenes = ids(v.scenes ?? []), journal = ids(v.journal ?? []), characters = ids(v.characters ?? []);
  return scenes && journal && characters ? { scenes, journal, characters } : null;
};
