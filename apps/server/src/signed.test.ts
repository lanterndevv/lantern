import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createSigner } from './signed.ts';
import { start } from './main.ts';

const NAME = 'a'.repeat(64) + '.png';

test('signer: firma solo valores exactos /assets/, verifica, caduca y quita la firma', () => {
  const s = createSigner(Buffer.alloc(32, 1)), now = 1_700_000_000_000;
  const out = JSON.parse(s.sign(JSON.stringify({ img: '/assets/' + NAME, txt: '/assets/' + NAME, ext: 'https://x/assets/' + NAME }), now));
  assert.match(out.img, new RegExp(`^/assets/${NAME}\\?e=\\d+&s=[0-9a-f]{64}$`));
  assert.equal(out.txt, '/assets/' + NAME, 'texto libre sin firmar'); assert.equal(out.ext, 'https://x/assets/' + NAME);
  const q = new URL('http://x' + out.img).searchParams;
  assert.ok(s.verify(NAME, q, now)); assert.ok(s.verify(NAME, q, now + 11 * 3600_000), 'vale ≥ 12 h');
  assert.ok(!s.verify(NAME, q, now + 13 * 3600_000 + 1), 'caduca');
  assert.ok(!s.verify('b'.repeat(64) + '.png', q, now), 'ligada al archivo');
  assert.ok(!s.verify(NAME, new URLSearchParams({ e: q.get('e')!, s: '0'.repeat(64) }), now));
  assert.ok(!s.verify(NAME, new URLSearchParams({ e: String(Number(q.get('e')) + 3600_000), s: q.get('s')! }), now), 'no se puede alargar la caducidad');
  assert.ok(!createSigner(Buffer.alloc(32, 2)).verify(NAME, q, now), 'otro secreto');
  assert.ok(!s.verify(NAME, new URLSearchParams(), now));
  assert.equal(s.strip(JSON.stringify(out)), JSON.stringify({ img: '/assets/' + NAME, txt: out.txt, ext: out.ext }));
  const again = JSON.parse(s.sign(JSON.stringify({ img: '/assets/' + NAME }), now + 10 * 60_000)).img; // misma hora → misma URL (la caché no se invalida en cada estado)
  assert.equal(again, JSON.parse(s.sign(JSON.stringify({ img: '/assets/' + NAME }), now + 20 * 60_000)).img);
});

test('e2e con LANTERN_SIGNED_ASSETS=1: 403 sin firma, 200/206 con firma, estado y subida firmados', async () => {
  process.env.LANTERN_ASSETS = mkdtempSync(join(tmpdir(), 'lantern-'));
  process.env.LANTERN_SIGNED_ASSETS = '1';
  const srv = start(0, ':memory:');
  try {
    await srv.ready;
    const base = `http://127.0.0.1:${srv.port()}`, msgs: any[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port()}/ws`);
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise((ok) => ws.once('open', ok));
    ws.send(JSON.stringify({ t: 'join', name: 'DM' }));
    const wait = async (f: (m: any) => boolean) => { for (let i = 0; i < 100; i++) { const m = msgs.find(f); if (m) return m; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timeout'); };
    const w = await wait((m) => m.t === 'welcome');
    const up = await fetch(base + '/api/assets', { method: 'POST', headers: { 'x-lantern-code': w.state.code, 'x-lantern-key': w.key, 'content-type': 'image/png' }, body: new Uint8Array(Buffer.from('0123456789')) });
    const { url } = await up.json() as { url: string };
    assert.match(url, /^\/assets\/[0-9a-f]{64}\.png\?e=\d+&s=[0-9a-f]{64}$/, 'la subida devuelve URL firmada');
    const bare = url.split('?')[0];
    assert.equal((await fetch(base + bare)).status, 403);
    assert.equal((await fetch(base + bare + '?e=1&s=' + '0'.repeat(64))).status, 403);
    assert.equal((await fetch(base + url.slice(0, -1) + (url.endsWith('0') ? '1' : '0'))).status, 403, 'firma alterada');
    const ok = await fetch(base + url);
    assert.equal(ok.status, 200); assert.match(ok.headers.get('cache-control')!, /^private/);
    const r = await fetch(base + url, { headers: { range: 'bytes=2-4' } });
    assert.equal(r.status, 206); assert.equal(await r.text(), '234');
    // el estado que llega al cliente lleva las URLs firmadas, y lo que devuelve firmado se guarda sin firma
    ws.send(JSON.stringify({ t: 'scene', patch: { background: url } }));
    const st = await wait((m) => m.t === 'state' && m.state.scene.background);
    assert.equal(st.state.scene.background.split('?')[0], bare); assert.match(st.state.scene.background, /\?e=\d+&s=/);
    assert.equal((await fetch(base + st.state.scene.background)).status, 200);
    ws.close();
  } finally { delete process.env.LANTERN_SIGNED_ASSETS; await srv.close(); }
});
