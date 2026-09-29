import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';
import { start } from './main.ts';
import { MIGRATIONS, openDb } from './db.ts';
import { createRoom, handle, joinRoom, filterFor } from './room.ts';

const fakeRoll = (e: string) => ({ total: 7, detail: e });
const man = (o: object = {}) => ({ id: 'mi-ext', name: 'Ext', version: '1.0', url: 'https://x.example/e.html', permissions: ['state', 'chat'], ...o });
function setup() {
  const c = createRoom('DM', 'ABC234'); if ('error' in c) throw new Error(c.error);
  const p = joinRoom(c.room, 'Ana', undefined); if ('error' in p) throw new Error(p.error);
  return { room: c.room, dm: c.member, player: p.member };
}

test('extensiones: instalar, reemplazar, validar, quitar y permisos', () => {
  const { room, dm, player } = setup();
  assert.equal(handle(room, player, { t: 'extInstall', manifest: man() }, fakeRoll).error, 'no permitido');
  assert.ok(handle(room, dm, { t: 'extInstall', manifest: man() }, fakeRoll).state);
  assert.ok(handle(room, dm, { t: 'extInstall', manifest: man({ name: 'Nuevo' }) }, fakeRoll).state);
  assert.equal(room.extensions.length, 1); assert.equal(room.extensions[0].name, 'Nuevo');
  assert.equal(filterFor(room, player).extensions[0].id, 'mi-ext'); // todos la ven
  assert.ok(handle(room, dm, { t: 'extInstall', manifest: man({ url: 'http://localhost:5173/x' }) }, fakeRoll).state);
  for (const bad of [{ id: 'AB' }, { id: 'a_b_c' }, { name: 'x'.repeat(61) }, { version: 'x'.repeat(21) }, { author: 'x'.repeat(61) }, { description: 'x'.repeat(301) },
    { url: 'http://evil.com/x' }, { url: 'http://localhost/x' }, { url: 'https://u:p@x.com/' }, { url: 'javascript:alert(1)' }, { url: 'https://x.com/' + 'a'.repeat(300) },
    { permissions: ['root'] }, { permissions: ['chat', 'chat'] }, { permissions: 'chat' }])
    assert.ok(handle(room, dm, { t: 'extInstall', manifest: man(bad) }, fakeRoll).error, JSON.stringify(bad));
  for (let i = 0; i < 9; i++) handle(room, dm, { t: 'extInstall', manifest: man({ id: 'ext-' + i }) }, fakeRoll);
  assert.equal(room.extensions.length, 10);
  assert.ok(handle(room, dm, { t: 'extInstall', manifest: man({ id: 'ext-11' }) }, fakeRoll).error);
  assert.ok(handle(room, dm, { t: 'extInstall', manifest: man({ id: 'ext-1', name: 'Otra' }) }, fakeRoll).state); // reemplazar sigue valiendo
  assert.equal(handle(room, player, { t: 'extRemove', id: 'ext-1' }, fakeRoll).error, 'no permitido');
  assert.ok(handle(room, dm, { t: 'extRemove', id: 'ext-1' }, fakeRoll).state);
  assert.equal(room.extensions.length, 9);
});

test('migraciones: una BD v1 migra sin perder datos y las extensiones persisten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lantern-db-')), path = join(dir, 'old.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE rooms (code TEXT PRIMARY KEY, scene TEXT NOT NULL, chat TEXT NOT NULL);
    CREATE TABLE members (room TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, key_hash TEXT NOT NULL, PRIMARY KEY (room, id));`);
  const scene = { id: 's1', name: 'Vieja', width: 10, height: 10, cell: 50, tokens: [], walls: [], lights: [], fog: false };
  old.prepare('INSERT INTO rooms VALUES (?, ?, ?)').run('OLD234', JSON.stringify(scene), '[]');
  old.prepare('INSERT INTO members VALUES (?, ?, ?, ?, ?)').run('OLD234', 'm1', 'Vieja Ana', 'dm', 'h');
  old.close();
  const db = openDb(path);
  const r = db.load('OLD234')!;
  assert.equal(r.scene.name, 'Vieja'); assert.equal(r.members.get('m1')!.name, 'Vieja Ana'); assert.deepEqual(r.extensions, []);
  r.extensions = [man()] as typeof r.extensions; db.save(r); db.close();
  const db2 = openDb(path); // reabrir no vuelve a migrar y conserva
  assert.equal(db2.load('OLD234')!.extensions.length, 1); db2.close();
  const chk = new DatabaseSync(path);
  assert.equal((chk.prepare('SELECT version FROM meta').get() as any).version, MIGRATIONS.length);
  chk.close();
});

async function ws(base: string, msg?: object) {
  const w = new WebSocket(base.replace('http', 'ws') + '/ws'), msgs: any[] = [];
  w.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  const closed = new Promise<number>((ok) => w.once('close', ok));
  await new Promise((ok, no) => { w.once('open', ok); w.once('error', no); });
  if (msg) w.send(JSON.stringify(msg));
  return { w, msgs, closed };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('welcome trae v y el límite de mensajes cierra con 1008', async () => {
  const srv = start(0, ':memory:'); await srv.ready;
  const base = `http://127.0.0.1:${srv.port()}`;
  const a = await ws(base, { t: 'join', name: 'DM' });
  await sleep(100);
  assert.equal(a.msgs.find((m) => m.t === 'welcome').v, 1);
  for (let i = 0; i < 300; i++) a.w.send(JSON.stringify({ t: 'clockReq' }));
  assert.equal(await a.closed, 1008);
  await srv.close();
});

test('límites por IP: conexiones, mesas y subidas', async () => {
  const srv = start(0, ':memory:'); await srv.ready;
  const base = `http://127.0.0.1:${srv.port()}`;
  const open: Awaited<ReturnType<typeof ws>>[] = [];
  for (let i = 0; i < 20; i++) open.push(await ws(base));
  const extra = await ws(base);
  assert.equal(await extra.closed, 1008);
  for (const o of open) o.w.close();
  await sleep(100);
  let creados = 0;
  for (let i = 0; i < 14; i++) {
    const batch = await Promise.all(Array.from({ length: 15 }, () => ws(base, { t: 'join', name: 'DM' })));
    await sleep(150);
    for (const b of batch) { if (b.msgs.some((m) => m.t === 'welcome')) creados++; b.w.close(); }
    await sleep(100);
  }
  assert.equal(creados, 200);
  let last: Response | undefined;
  for (let i = 0; i < 31; i++) last = await fetch(base + '/api/uvtt', { method: 'POST', body: '{}' }).catch(() => undefined);
  assert.equal(last?.status, 429); assert.ok(Number(last!.headers.get('retry-after')) > 0);
  await srv.close();
});

test('web estática: SPA, MIME, caché y sin path traversal', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'lantern-web-'));
  mkdirSync(join(dist, 'static'));
  writeFileSync(join(dist, 'index.html'), '<h1>hola</h1>'); writeFileSync(join(dist, 'static', 'a.js'), '1');
  writeFileSync(join(dist, '..', 'secreto.txt'), 'no');
  process.env.WEB_DIST = dist;
  const srv = start(0, ':memory:'); await srv.ready;
  delete process.env.WEB_DIST;
  const base = `http://127.0.0.1:${srv.port()}`;
  let r = await fetch(base + '/'); assert.equal(await r.text(), '<h1>hola</h1>'); assert.match(r.headers.get('content-type')!, /text\/html/);
  r = await fetch(base + '/mesa/ABC'); assert.equal(await r.text(), '<h1>hola</h1>');
  r = await fetch(base + '/static/a.js'); assert.match(r.headers.get('content-type')!, /javascript/); assert.match(r.headers.get('cache-control')!, /immutable/);
  assert.equal((await fetch(base + '/static/nada.js')).status, 404);
  assert.equal((await fetch(base + '/api/nada')).status, 404);
  assert.equal((await fetch(base + '/assets/nada.png')).status, 404);
  const raw = (path: string) => new Promise<string>((ok) => { import('node:net').then(({ connect }) => { const s = connect(srv.port(), '127.0.0.1', () => s.write(`GET ${path} HTTP/1.0\r\n\r\n`)); let d = ''; s.on('data', (c) => d += c); s.on('close', () => ok(d)); }); });
  for (const p of ['/../secreto.txt', '/%2e%2e/secreto.txt', '/static/..%2f..%2fsecreto.txt']) assert.ok(!(await raw(p)).includes('no\n') && !(await raw(p)).endsWith('\r\n\r\nno'), p);
  await srv.close();
});

test('migraciones: una BD en la versión 5 (antes de «extra») arranca y guarda', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { MIGRATIONS, openDb } = await import('./db.ts');
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const f = join(mkdtempSync(join(tmpdir(), 'lantern-')), 'v5.db');
  const d = new DatabaseSync(f);
  for (const m of MIGRATIONS.slice(0, 5)) m(d);
  d.exec('CREATE TABLE meta (version INTEGER NOT NULL); INSERT INTO meta VALUES (5)'); d.close();
  const db = openDb(f); // no debe lanzar «no such column extra» al preparar sentencias
  const cols = (new DatabaseSync(f).prepare('PRAGMA table_info(rooms)').all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes('extra'));
  void db;
});
