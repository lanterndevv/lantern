import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_SETTINGS, DICE_THEMES } from '@lantern/protocol';
import type { AudioState, Combat, JournalEntry, Scene } from '@lantern/protocol';
import { mergeSettings, mkRoom, type Room, type MemberRec } from './room.ts';

export function openDb(path = process.env.LANTERN_DB ?? 'lantern.db') {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, scene TEXT NOT NULL, chat TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members (room TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, key_hash TEXT NOT NULL, PRIMARY KEY (room, id));
  `);
  try { db.exec("ALTER TABLE members ADD COLUMN dice TEXT NOT NULL DEFAULT 'linterna'"); } catch { /* ya existe */ }
  for (const col of ["automation TEXT NOT NULL DEFAULT 'assisted'", "combat TEXT NOT NULL DEFAULT 'null'", "pending TEXT NOT NULL DEFAULT '[]'", "settings TEXT NOT NULL DEFAULT '{}'", "view TEXT NOT NULL DEFAULT 'tactical'", "audio TEXT NOT NULL DEFAULT '{}'", "scenes TEXT NOT NULL DEFAULT '{}'", "active TEXT NOT NULL DEFAULT ''", "journal TEXT NOT NULL DEFAULT '[]'"])
    try { db.exec(`ALTER TABLE rooms ADD COLUMN ${col}`); } catch { /* ya existe */ }
  const upRoom = db.prepare('INSERT INTO rooms (code, scene, chat, automation, combat, pending, settings, view, audio, scenes, active, journal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET scene = excluded.scene, chat = excluded.chat, automation = excluded.automation, combat = excluded.combat, pending = excluded.pending, settings = excluded.settings, view = excluded.view, audio = excluded.audio, scenes = excluded.scenes, active = excluded.active, journal = excluded.journal');
  const delMembers = db.prepare('DELETE FROM members WHERE room = ?');
  const insMember = db.prepare('INSERT INTO members (room, id, name, role, key_hash, dice) VALUES (?, ?, ?, ?, ?, ?)');
  const getRoom = db.prepare('SELECT scene, chat, automation, combat, pending, settings, view, audio, scenes, active, journal FROM rooms WHERE code = ?');
  const getMembers = db.prepare('SELECT id, name, role, key_hash, dice FROM members WHERE room = ?');
  return {
    exists: (code: string) => getRoom.get(code) !== undefined,
    save(r: Room) {
      db.exec('BEGIN');
      try {
        upRoom.run(r.code, 'null', // la columna scene es solo de migración: la biblioteca vive en scenes
           JSON.stringify(r.chat), r.automation, JSON.stringify(r.combat ?? null), JSON.stringify(r.pending), JSON.stringify(r.settings), r.view, JSON.stringify(r.audio), JSON.stringify(r.scenes), r.activeId, JSON.stringify(r.journal));
        delMembers.run(r.code); // ponytail: reescribe todos los miembros; incremental si crecen las mesas
        for (const m of r.members.values()) insMember.run(r.code, m.id, m.name, m.role, m.keyHash, m.dice);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    load(code: string): Room | null {
      const row = getRoom.get(code) as { scene: string; chat: string; automation: string; combat: string; pending: string; settings: string; view: string; audio: string; scenes: string; active: string; journal: string } | undefined;
      if (!row) return null;
      const ms = getMembers.all(code) as { id: string; name: string; role: MemberRec['role']; key_hash: string; dice: MemberRec['dice'] }[];
      const parse = (j: string): unknown => { try { return JSON.parse(j); } catch { return null; } };
      const c = parse(row.combat) as Combat | null, p = parse(row.pending);
      const combat = c && typeof c === 'object' && Number.isInteger(c.round) && Number.isInteger(c.turn) && Array.isArray(c.order) && c.used && typeof c.used === 'object' ? c : undefined;
      const au = parse(row.audio) as any, tr = au?.track;
      const audio: AudioState = { // migración tolerante: solo se conserva lo bien formado
        ...(tr && typeof tr.url === 'string' && typeof tr.name === 'string' && Number.isFinite(tr.startedAt) && { track: { url: tr.url, name: tr.name, startedAt: tr.startedAt, loop: tr.loop === true, ...(Number.isFinite(tr.pausedAt) && { pausedAt: tr.pausedAt }) } }),
        layers: Array.isArray(au?.layers) ? au.layers.filter((l: any) => l && typeof l.id === 'string' && typeof l.url === 'string' && Number.isFinite(l.volume)).slice(0, 12) : [],
      };
      // migración: una mesa antigua solo tiene `scene`, que pasa a ser la primera de la biblioteca
      const sc = parse(row.scenes) as Record<string, Scene> | null;
      let scenes = sc && typeof sc === 'object' ? Object.fromEntries(Object.entries(sc).filter(([, v]) => v && typeof v === 'object')) : {};
      if (!Object.keys(scenes).length) { const old = parse(row.scene) as Scene; scenes = { [old.id]: old }; }
      const j = parse(row.journal);
      return mkRoom({
        scenes, activeId: Object.hasOwn(scenes, row.active) ? row.active : Object.keys(scenes)[0],
        journal: Array.isArray(j) ? (j as JournalEntry[]).filter((e) => e && typeof e.id === 'string') : [],
        view: row.view === 'story' ? 'story' : 'tactical', audio,
        code, chat: JSON.parse(row.chat), automation: row.automation === 'auto' ? 'auto' : 'assisted',
        settings: mergeSettings(structuredClone(DEFAULT_SETTINGS), parse(row.settings)) ?? structuredClone(DEFAULT_SETTINGS), // migración tolerante
        ...(combat && { combat }), pending: Array.isArray(p) ? p : [],
        members: new Map(ms.map((m) => [m.id, { id: m.id, name: m.name, role: m.role, keyHash: m.key_hash, dice: DICE_THEMES.includes(m.dice) ? m.dice : 'linterna' }])),
      });
    },
    close: () => db.close(),
  };
}
