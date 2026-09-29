import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_SETTINGS, DICE_THEMES } from '@lantern/protocol';
import type { AudioState, Combat, JournalEntry, Scene } from '@lantern/protocol';
import { parseManifest, MAX_EXTENSIONS } from './validate.ts';
import { mergeSettings, mkRoom, type Room, type MemberRec } from './room.ts';

// Migraciones ordenadas y numeradas (índice + 1 = versión). Nunca se editan las ya publicadas: se añade una nueva.
// Son idempotentes: una BD anterior al versionado (sin tabla meta) las reejecuta sin daño.
const addCol = (db: DatabaseSync, table: string, col: string, def: string) => {
  if (!(db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
// ⚠ SOLO AÑADIR AL FINAL: el índice es la versión. Insertar en medio hace que BD ya migradas se salten la nueva.
export const MIGRATIONS: ((db: DatabaseSync) => void)[] = [
  (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, scene TEXT NOT NULL, chat TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members (room TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, key_hash TEXT NOT NULL, PRIMARY KEY (room, id));`),
  (db) => addCol(db, 'members', 'dice', "TEXT NOT NULL DEFAULT 'linterna'"),
  (db) => {
    for (const [c, d] of [['automation', "'assisted'"], ['combat', "'null'"], ['pending', "'[]'"], ['settings', "'{}'"], ['view', "'tactical'"], ['audio', "'{}'"], ['scenes', "'{}'"], ['active', "''"], ['journal', "'[]'"]])
      addCol(db, 'rooms', c, `TEXT NOT NULL DEFAULT ${d}`);
  },
  (db) => addCol(db, 'rooms', 'extensions', "TEXT NOT NULL DEFAULT '[]'"),
  (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pass_hash TEXT NOT NULL, totp_secret TEXT, totp_pending TEXT, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_sessions (token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_tables (account_id INTEGER NOT NULL, code TEXT NOT NULL, member_id TEXT NOT NULL, PRIMARY KEY (account_id, code));
  `), // cuentas opcionales (accounts.ts)
  (db) => addCol(db, 'rooms', 'extra', "TEXT NOT NULL DEFAULT '{}'"), // safety, sessionStart, maxRound
];

export function migrate(db: DatabaseSync) {
  db.exec('CREATE TABLE IF NOT EXISTS meta (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM meta').get() as { version: number } | undefined;
  const cur = row?.version ?? 0;
  if (cur > MIGRATIONS.length) throw new Error(`BD de una versión más nueva (${cur}) que este servidor (${MIGRATIONS.length})`);
  if (cur === MIGRATIONS.length) return;
  db.exec('BEGIN');
  try {
    for (let i = cur; i < MIGRATIONS.length; i++) MIGRATIONS[i](db);
    if (row) db.prepare('UPDATE meta SET version = ?').run(MIGRATIONS.length);
    else db.prepare('INSERT INTO meta (version) VALUES (?)').run(MIGRATIONS.length);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// key_hash guarda un array JSON; las filas antiguas tienen un solo hash suelto.
const hashes = (s: string): string[] => { try { const v = JSON.parse(s); if (Array.isArray(v)) return v.filter((x) => typeof x === 'string'); } catch { /* hash suelto */ } return [s]; };

export function openDb(path = process.env.LANTERN_DB ?? 'lantern.db') {
  const db = new DatabaseSync(path);
  migrate(db);
  const upRoom = db.prepare('INSERT INTO rooms (code, scene, chat, automation, combat, pending, settings, view, audio, scenes, active, journal, extensions, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET scene = excluded.scene, chat = excluded.chat, automation = excluded.automation, combat = excluded.combat, pending = excluded.pending, settings = excluded.settings, view = excluded.view, audio = excluded.audio, scenes = excluded.scenes, active = excluded.active, journal = excluded.journal, extensions = excluded.extensions, extra = excluded.extra');
  const delMembers = db.prepare('DELETE FROM members WHERE room = ?');
  const insMember = db.prepare('INSERT INTO members (room, id, name, role, key_hash, dice) VALUES (?, ?, ?, ?, ?, ?)');
  const getRoom = db.prepare('SELECT scene, chat, automation, combat, pending, settings, view, audio, scenes, active, journal, extensions, extra FROM rooms WHERE code = ?');
  const getMembers = db.prepare('SELECT id, name, role, key_hash, dice FROM members WHERE room = ?');
  return {
    exists: (code: string) => getRoom.get(code) !== undefined,
    save(r: Room) {
      db.exec('BEGIN');
      try {
        upRoom.run(r.code, 'null', // la columna scene es solo de migración: la biblioteca vive en scenes
           JSON.stringify(r.chat), r.automation, JSON.stringify(r.combat ?? null), JSON.stringify(r.pending), JSON.stringify(r.settings), r.view, JSON.stringify(r.audio), JSON.stringify(r.scenes), r.activeId, JSON.stringify(r.journal), JSON.stringify(r.extensions), JSON.stringify({ safety: r.safety, sessionStart: r.sessionStart, maxRound: r.maxRound, clock: r.clock ?? 480 }));
        delMembers.run(r.code); // ponytail: reescribe todos los miembros; incremental si crecen las mesas
        for (const m of r.members.values()) insMember.run(r.code, m.id, m.name, m.role, JSON.stringify(m.keyHashes), m.dice);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    load(code: string): Room | null {
      const row = getRoom.get(code) as { scene: string; chat: string; automation: string; combat: string; pending: string; settings: string; view: string; audio: string; scenes: string; active: string; journal: string; extensions: string; extra: string } | undefined;
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
      const j = parse(row.journal), ex = parse(row.extensions);
      const ex2 = parse(row.extra) as any, sl = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length >= 1 && x.length <= 60).slice(0, 30) : [];
      return mkRoom({
        safety: { lines: sl(ex2?.safety?.lines), veils: sl(ex2?.safety?.veils) },
        sessionStart: Number.isFinite(ex2?.sessionStart) ? ex2.sessionStart : Date.now(), maxRound: Number.isInteger(ex2?.maxRound) ? ex2.maxRound : 0, ...(Number.isFinite(ex2?.clock) && { clock: ex2.clock }),
        scenes, activeId: Object.hasOwn(scenes, row.active) ? row.active : Object.keys(scenes)[0],
        journal: Array.isArray(j) ? (j as JournalEntry[]).filter((e) => e && typeof e.id === 'string') : [],
        extensions: Array.isArray(ex) ? ex.flatMap((e) => { const m = parseManifest(e); return typeof m === 'string' ? [] : [m]; }).slice(0, MAX_EXTENSIONS) : [], // migración tolerante
        view: row.view === 'story' ? 'story' : 'tactical', audio,
        code, chat: JSON.parse(row.chat), automation: row.automation === 'auto' ? 'auto' : 'assisted',
        settings: mergeSettings(structuredClone(DEFAULT_SETTINGS), parse(row.settings)) ?? structuredClone(DEFAULT_SETTINGS), // migración tolerante
        ...(combat && { combat }), pending: Array.isArray(p) ? p : [],
        members: new Map(ms.map((m) => [m.id, { id: m.id, name: m.name, role: m.role, keyHashes: hashes(m.key_hash), dice: DICE_THEMES.includes(m.dice) ? m.dice : 'linterna' }])),
      });
    },
    raw: db, // para accounts.ts (mismas BD y conexión)
    close: () => db.close(),
  };
}
