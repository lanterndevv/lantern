import { DatabaseSync } from 'node:sqlite';
import type { Room, MemberRec } from './room.ts';

export function openDb(path = process.env.LANTERN_DB ?? 'lantern.db') {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, scene TEXT NOT NULL, chat TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members (room TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, key_hash TEXT NOT NULL, PRIMARY KEY (room, id));
  `);
  const upRoom = db.prepare('INSERT INTO rooms (code, scene, chat) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET scene = excluded.scene, chat = excluded.chat');
  const delMembers = db.prepare('DELETE FROM members WHERE room = ?');
  const insMember = db.prepare('INSERT INTO members (room, id, name, role, key_hash) VALUES (?, ?, ?, ?, ?)');
  const getRoom = db.prepare('SELECT scene, chat FROM rooms WHERE code = ?');
  const getMembers = db.prepare('SELECT id, name, role, key_hash FROM members WHERE room = ?');
  return {
    exists: (code: string) => getRoom.get(code) !== undefined,
    save(r: Room) {
      db.exec('BEGIN');
      try {
        upRoom.run(r.code, JSON.stringify(r.scene), JSON.stringify(r.chat));
        delMembers.run(r.code); // ponytail: reescribe todos los miembros; incremental si crecen las mesas
        for (const m of r.members.values()) insMember.run(r.code, m.id, m.name, m.role, m.keyHash);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    load(code: string): Room | null {
      const row = getRoom.get(code) as { scene: string; chat: string } | undefined;
      if (!row) return null;
      const ms = getMembers.all(code) as { id: string; name: string; role: MemberRec['role']; key_hash: string }[];
      return {
        code, scene: JSON.parse(row.scene), chat: JSON.parse(row.chat),
        members: new Map(ms.map((m) => [m.id, { id: m.id, name: m.name, role: m.role, keyHash: m.key_hash }])),
      };
    },
    close: () => db.close(),
  };
}
