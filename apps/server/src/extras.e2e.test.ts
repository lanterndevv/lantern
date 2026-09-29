import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { start } from './main.ts';

function client(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), msgs: any[] = [], raw: string[] = [];
  ws.on('message', (d) => { raw.push(d.toString()); msgs.push(JSON.parse(d.toString())); });
  const opened = new Promise((ok) => ws.once('open', ok));
  const wait = async (f: (m: any) => boolean) => { for (let i = 0; i < 100; i++) { const m = msgs.find(f); if (m) return m; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timeout'); };
  return { ws, msgs, raw, opened, wait, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

test('e2e fase 11: como jugador, copias, PDF, fusión y créditos', async () => {
  process.env.LANTERN_BACKUP_DIR = mkdtempSync(join(tmpdir(), 'lantern-bk-'));
  process.env.LANTERN_ASSETS = mkdtempSync(join(tmpdir(), 'lantern-as-'));
  const srv = start(0, ':memory:', (e) => ({ total: 11, detail: e }));
  await srv.ready;
  const port = srv.port(), dm = client(port), pl = client(port);
  await Promise.all([dm.opened, pl.opened]);
  dm.send({ t: 'join', name: 'DM' });
  const w = await dm.wait((m) => m.t === 'welcome');
  pl.send({ t: 'join', code: w.state.code, name: 'Ana' });
  const pw = await pl.wait((m) => m.t === 'welcome');

  // vista como jugador
  dm.send({ t: 'upsert', kind: 'token', item: { ...w.state.scene.tokens.find((t: any) => t.id === 'ysolde'), encounter: 'secreto' } });
  dm.send({ t: 'asPlayer', memberId: pw.memberId });
  const as = await dm.wait((m) => m.t === 'asState');
  assert.equal(as.memberId, pw.memberId);
  assert.ok(!JSON.stringify(as.state).includes('Hobgoblin 2') && !JSON.stringify(as.state).includes('secreto'));
  pl.send({ t: 'asPlayer', memberId: null });
  await pl.wait((m) => m.t === 'error' && m.msg === 'no permitido');
  assert.ok(!pl.raw.some((r) => r.includes('secreto')));

  // copias y restauración
  dm.send({ t: 'backup', op: 'now' });
  const l1 = await dm.wait((m) => m.t === 'backups' && m.list.length === 1);
  dm.send({ t: 'journal', entry: { id: 'x', title: 'Nueva', body: '', visibleTo: 'all' } });
  dm.send({ t: 'backup', op: 'restore', name: l1.list[0].name });
  await dm.wait((m) => m.t === 'state' && !m.state.journal.some((e: any) => e.id === 'x') && m.state.scene.tokens.length > 5);
  pl.send({ t: 'backup', op: 'list' });
  await pl.wait((m) => m.t === 'error' && m.msg === 'no permitido');

  // PDF: solo el DM, con firma válida
  const hdr = { 'x-lantern-code': w.state.code, 'x-lantern-key': w.key, 'content-type': 'application/pdf' };
  const bad = await fetch(`http://127.0.0.1:${port}/api/assets`, { method: 'POST', headers: hdr, body: 'no soy un pdf' });
  assert.equal(bad.status, 415);
  const ok = await fetch(`http://127.0.0.1:${port}/api/assets`, { method: 'POST', headers: hdr, body: '%PDF-1.4\n%%EOF' });
  assert.equal(ok.status, 200);
  const { url } = await ok.json() as { url: string };
  const got = await fetch(`http://127.0.0.1:${port}${url}`);
  assert.equal(got.headers.get('content-type'), 'application/pdf');
  const asPl = await fetch(`http://127.0.0.1:${port}/api/assets`, { method: 'POST', headers: { ...hdr, 'x-lantern-key': pw.key }, body: '%PDF-1.4' });
  assert.equal(asPl.status, 415); // los jugadores solo suben imágenes
  dm.send({ t: 'journal', entry: { id: 'doc', title: 'Manual', body: '', visibleTo: 'all', pdf: url } });
  await dm.wait((m) => m.t === 'state' && m.state.journal.some((e: any) => e.pdf === url));

  // atribución de un recurso
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  const up = await fetch(`http://127.0.0.1:${port}/api/assets`, { method: 'POST', headers: { ...hdr, 'content-type': 'image/png', 'x-lantern-attr': encodeURIComponent(JSON.stringify({ title: 'Dragón', creator: 'Ana', license: 'CC BY 2.0', url: 'https://example.org', source: 'openverse' })) }, body: png });
  const img = (await up.json() as { url: string }).url;
  dm.send({ t: 'scene', patch: { background: img } });
  await dm.wait((m) => m.t === 'state' && m.state.scene.background === img);
  const cred = await (await fetch(`http://127.0.0.1:${port}/api/credits`, { headers: { 'x-lantern-code': w.state.code, 'x-lantern-key': pw.key } })).json() as any[];
  assert.equal(cred[0].creator, 'Ana');

  // fusión selectiva por HTTP
  const camp = await (await fetch(`http://127.0.0.1:${port}/api/export`, { headers: hdr })).json() as any;
  const merge = await fetch(`http://127.0.0.1:${port}/api/merge`, { method: 'POST', headers: { ...hdr, 'content-type': 'application/json' }, body: JSON.stringify({ ...camp, select: { scenes: [], journal: ['doc'], characters: ['nix'] } }) });
  assert.deepEqual(await merge.json(), { scenes: 0, journal: 1, characters: 1 });
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/merge`, { method: 'POST', headers: { ...hdr, 'x-lantern-key': pw.key, 'content-type': 'application/json' }, body: '{}' })).status, 403);
  for (const c of [dm, pl]) c.ws.close();
  await srv.close();
  delete process.env.LANTERN_BACKUP_DIR; delete process.env.LANTERN_ASSETS;
});
