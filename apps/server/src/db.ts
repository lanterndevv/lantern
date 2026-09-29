import { DatabaseSync } from 'node:sqlite';
import { DICE_THEMES } from '@lantern/protocol';
import type { Combat } from '@lantern/protocol';
import type { Room, MemberRec } from './room.ts';

export function openDb(path = process.env.LANTERN_DB ?? 'lantern.db') {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, scene TEXT NOT NULL, chat TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members (room TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, key_hash TEXT NOT NULL, PRIMARY KEY (room, id));
  `);
  try { db.exec("ALTER TABLE members ADD COLUMN dice TEXT NOT NULL DEFAULT 'linterna'"); } catch { /* ya existe */ }
  for (const col of ["automation TEXT NOT NULL DEFAULT 'assisted'", "combat TEXT NOT NULL DEFAULT 'null'", "pending TEXT NOT NULL DEFAULT '[]'"])
    try { db.exec(`ALTER TABLE rooms ADD COLUMN ${col}`); } catch { /* ya existe */ }
  const upRoom = db.prepare('INSERT INTO rooms (code, scene, chat, automation, combat, pending) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET scene = excluded.scene, chat = excluded.chat, automation = excluded.automation, combat = excluded.combat, pending = excluded.pending');
  const delMembers = db.prepare('DELETE FROM members WHERE room = ?');
  const insMember = db.prepare('INSERT INTO members (room, id, name, role, key_hash, dice) VALUES (?, ?, ?, ?, ?, ?)');
  const getRoom = db.prepare('SELECT scene, chat, automation, combat, pending FROM rooms WHERE code = ?');
  const getMembers = db.prepare('SELECT id, name, role, key_hash, dice FROM members WHERE room = ?');
  return {
    exists: (code: string) => getRoom.get(code) !== undefined,
    save(r: Room) {
      db.exec('BEGIN');
      try {
        upRoom.run(r.code, JSON.stringify(r.scene), JSON.stringify(r.chat), r.automation, JSON.stringify(r.combat ?? null), JSON.stringify(r.pending));
        delMembers.run(r.code); // ponytail: reescribe todos los miembros; incremental si crecen las mesas
        for (const m of r.members.values()) insMember.run(r.code, m.id, m.name, m.role, m.keyHash, m.dice);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    load(code: string): Room | null {
      const row = getRoom.get(code) as { scene: string; chat: string; automation: string; combat: string; pending: string } | undefined;
      if (!row) return null;
      const ms = getMembers.all(code) as { id: string; name: string; role: MemberRec['role']; key_hash: string; dice: MemberRec['dice'] }[];
      const parse = (j: string): unknown => { try { return JSON.parse(j); } catch { return null; } };
      const c = parse(row.combat) as Combat | null, p = parse(row.pending);
      const combat = c && typeof c === 'object' && Number.isInteger(c.round) && Number.isInteger(c.turn) && Array.isArray(c.order) && c.used && typeof c.used === 'object' ? c : undefined;
      return {
        code, scene: JSON.parse(row.scene), chat: JSON.parse(row.chat), automation: row.automation === 'auto' ? 'auto' : 'assisted',
        ...(combat && { combat }), pending: Array.isArray(p) ? p : [],
        members: new Map(ms.map((m) => [m.id, { id: m.id, name: m.name, role: m.role, keyHash: m.key_hash, dice: DICE_THEMES.includes(m.dice) ? m.dice : 'linterna' }])),
      };
    },
    close: () => db.close(),
  };
}
