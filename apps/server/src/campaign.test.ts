import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { start } from './main.ts';
import { sha256 } from './campaign.ts';

async function boot() {
  process.env.LANTERN_ASSETS = mkdtempSync(join(tmpdir(), 'lantern-'));
  const srv = start(0, ':memory:');
  await srv.ready;
  const base = `http://127.0.0.1:${srv.port()}`;
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port()}/ws`), msgs: any[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  await new Promise((ok) => ws.once('open', ok));
  ws.send(JSON.stringify({ t: 'join', name: 'DM' }));
  const wait = async (f: (m: any) => boolean) => { for (let i = 0; i < 100; i++) { const m = msgs.find(f); if (m) return m; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timeout'); };
  const w = await wait((m) => m.t === 'welcome');
  const h = { 'x-lantern-code': w.state.code, 'x-lantern-key': w.key };
  return { srv, base, ws, msgs, wait, w, h, done: async () => { ws.close(); await srv.close(); } };
}

test('export → import conserva escenas, diario, ajustes y recursos', async () => {
  const t = await boot();
  const png = Buffer.from('fake-png-bytes');
  const up = await fetch(t.base + '/api/assets', { method: 'POST', headers: { ...t.h, 'content-type': 'image/png' }, body: new Uint8Array(png) });
  const { url } = await up.json() as { url: string };
  t.ws.send(JSON.stringify({ t: 'scene', patch: { background: url } }));
  t.ws.send(JSON.stringify({ t: 'sceneNew', name: 'Segunda' }));
  t.ws.send(JSON.stringify({ t: 'journal', entry: { id: 'j1', title: 'Pista', body: 'Texto', visibleTo: 'all', image: url } }));
  t.ws.send(JSON.stringify({ t: 'settings', patch: { edition: '2014' } }));
  t.ws.send(JSON.stringify({ t: 'encounter', entry: { id: 'e1', name: 'Emboscada', monsters: [{ srd: 'goblin-warrior', n: 3 }] } }));
  await t.wait((m) => m.t === 'state' && m.state.journal.length === 1 && m.state.settings.edition === '2014' && m.state.library?.length === 2 && m.state.encounters?.length === 1);

  assert.equal((await fetch(t.base + '/api/export')).status, 403);
  const res = await fetch(t.base + '/api/export', { headers: t.h });
  assert.equal(res.status, 200);
  const doc: any = await res.json();
  assert.equal(doc.format, 'lantern-campaign'); assert.equal(doc.version, 1);
  assert.equal(doc.scenes.length, 2); assert.equal(doc.journal.length, 1); assert.equal(doc.settings.edition, '2014');
  assert.deepEqual(Object.keys(doc.assets), [url.slice('/assets/'.length)]);

  const imp = await fetch(t.base + '/api/import', { method: 'POST', headers: t.h, body: JSON.stringify(doc) });
  assert.equal(imp.status, 200);
  const { code, key } = await imp.json() as { code: string; key: string };
  assert.notEqual(code, t.w.state.code);
  const ws2 = new WebSocket(`ws://127.0.0.1:${t.srv.port()}/ws`), got: any[] = [];
  ws2.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((ok) => ws2.once('open', ok));
  ws2.send(JSON.stringify({ t: 'join', code, name: 'x', key }));
  await t.wait(() => got.some((m) => m.t === 'welcome'));
  const st = got.find((m) => m.t === 'welcome').state;
  assert.equal(got.find((m) => m.t === 'welcome').role, 'dm');
  assert.deepEqual(st.library.map((l: any) => l.name).sort(), ['Cueva del osgo', 'Segunda']);
  assert.equal(st.scene.background, url); assert.equal(st.journal[0].title, 'Pista'); assert.equal(st.settings.edition, '2014');
  assert.deepEqual(st.encounters, [{ id: 'e1', name: 'Emboscada', monsters: [{ srd: 'goblin-warrior', n: 3 }] }]);
  assert.deepEqual(Buffer.from(await (await fetch(t.base + url)).arrayBuffer()), png);
  ws2.close();

  // validación: formato, escena inválida, sha256 y tipo
  const post = (b: unknown) => fetch(t.base + '/api/import', { method: 'POST', headers: t.h, body: JSON.stringify(b) });
  const evil = Buffer.from('otro contenido');
  for (const bad of [{ ...doc, format: 'x' }, { ...doc, version: 2 }, { ...doc, scenes: [{ ...doc.scenes[0], width: 5 }] }, { ...doc, scenes: [] },
    { ...doc, assets: { [sha256(png) + '.png']: evil.toString('base64') } }, { ...doc, assets: { [sha256(evil) + '.exe']: evil.toString('base64') } }, { ...doc, assets: { '../x.png': 'AA==' } },
    { ...doc, scenes: [{ ...doc.scenes[0], background: 'javascript:1' }] }, { ...doc, journal: [{ id: 'x', title: '', body: '', visibleTo: 'all' }] }, { ...doc, encounters: [{ id: 'x', name: 'X', monsters: [{ srd: 'no-existe', n: 1 }] }] }])
    assert.equal((await post(bad)).status, 400);
  assert.equal((await fetch(t.base + '/api/import', { method: 'POST', headers: t.h, body: 'no es json' })).status, 400);
  await t.done();
});

test('uvtt: crea escena nueva con muros, puertas, luces e imagen sin activarla', async () => {
  const t = await boot();
  const img = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), Buffer.from('datos')]);
  const uvtt = {
    format: 0.3, resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 10, y: 8 }, pixels_per_grid: 100 },
    line_of_sight: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }]], objects_line_of_sight: [[{ x: 2, y: 2 }, { x: 4, y: 2 }]],
    portals: [{ position: { x: 5, y: 0 }, bounds: [{ x: 4.5, y: 0 }, { x: 5.5, y: 0 }], rotation: 0, closed: true, freestanding: false }, { bounds: [{ x: 1, y: 3 }, { x: 1, y: 4 }], closed: false }],
    lights: [{ position: { x: 3, y: 3 }, range: 6, intensity: 1, color: 'ffffb85c', shadows: true }],
    environment: { ambient_light: 'ffffffff' }, image: img.toString('base64'),
  };
  const post = (b: unknown) => fetch(t.base + '/api/uvtt', { method: 'POST', headers: t.h, body: JSON.stringify(b) });
  assert.equal((await fetch(t.base + '/api/uvtt', { method: 'POST', body: '{}' })).status, 403);
  const r = await post(uvtt);
  assert.equal(r.status, 200);
  const { sceneId } = await r.json() as { sceneId: string };
  const st = (await t.wait((m) => m.t === 'state' && m.state.library.length === 2)).state;
  assert.notEqual(st.scene.id, sceneId); // no se activa
  t.ws.send(JSON.stringify({ t: 'sceneActivate', id: sceneId }));
  const s = (await t.wait((m) => m.t === 'state' && m.state.scene.id === sceneId)).state.scene;
  assert.deepEqual([s.width, s.height, s.grid.size], [1000, 800, 100]);
  assert.equal(s.walls.filter((w: any) => w.kind === 'wall').length, 3);
  const doors = s.walls.filter((w: any) => w.kind === 'door');
  assert.deepEqual(doors.map((d: any) => d.open), [false, true]);
  assert.deepEqual(doors[0].a, { x: 450, y: 0 });
  assert.deepEqual(s.lights[0], { id: 'uvtt-l0', x: 300, y: 300, dim: 600, bright: 300, color: '#ffb85c' });
  assert.equal(s.background, `/assets/${sha256(img)}.png`);
  assert.equal((await fetch(t.base + s.background)).status, 200);
  // errores
  assert.equal((await post({ ...uvtt, image: Buffer.from('<html>').toString('base64') })).status, 415);
  assert.equal((await post({ ...uvtt, resolution: { ...uvtt.resolution, pixels_per_grid: 5 } })).status, 400);
  assert.equal((await post({ ...uvtt, line_of_sight: [[{ x: 'a', y: 0 }, { x: 1, y: 1 }]] })).status, 400);
  assert.equal((await post({ hola: 1 })).status, 400);
  await t.done();
});
