import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { start } from './main.ts';

test('e2e: assets, reloj y rtc', async () => {
  process.env.LANTERN_ASSETS = mkdtempSync(join(tmpdir(), 'lantern-'));
  const srv = start(0, ':memory:');
  await srv.ready;
  const base = `http://127.0.0.1:${srv.port()}`;
  const open = async (join_: object) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port()}/ws`), msgs: any[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise((ok) => ws.once('open', ok));
    ws.send(JSON.stringify({ t: 'join', ...join_ }));
    const wait = async (f: (m: any) => boolean) => { for (let i = 0; i < 100; i++) { const m = msgs.find(f); if (m) return m; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timeout'); };
    return { ws, msgs, wait, w: await wait((m) => m.t === 'welcome') };
  };
  const dm = await open({ name: 'DM' }), code = dm.w.state.code;
  const pl = await open({ code, name: 'Ana' }), pl2 = await open({ code, name: 'Bo' });
  await dm.wait((m) => m.t === 'clock');
  dm.ws.send(JSON.stringify({ t: 'clockReq' }));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(dm.msgs.filter((m) => m.t === 'clock').length, 2);

  // rtc solo llega al destinatario
  pl.ws.send(JSON.stringify({ t: 'rtc', to: dm.w.memberId, data: { hi: 1 } }));
  await dm.wait((m) => m.t === 'rtc' && m.from === pl.w.memberId);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!pl2.msgs.some((m) => m.t === 'rtc') && !pl.msgs.some((m) => m.t === 'rtc'));

  const up = (who: any, type: string, body: Buffer) => fetch(base + '/api/assets', { method: 'POST', headers: { 'x-lantern-code': code, 'x-lantern-key': who.w.key, 'content-type': type }, body: new Uint8Array(body) });
  const png = Buffer.from('fake-png-bytes');
  const ok = await up(dm, 'image/png', png);
  assert.equal(ok.status, 200);
  const { url } = await ok.json() as { url: string };
  assert.match(url, /^\/assets\/[0-9a-f]{64}\.png$/);
  // jugadores: solo png/jpeg/webp de hasta 5 MB, con límite propio por IP (10)
  assert.equal((await up(pl, 'image/png', png)).status, 200);
  assert.equal((await up(pl, 'audio/mpeg', png)).status, 415);
  assert.equal((await up(pl, 'image/webp', Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await up(dm, 'image/png', Buffer.alloc(6 * 1024 * 1024))).status, 200); // el DM conserva su límite
  const sp = await open({ code, name: 'Esp', as: 'spectator' });
  assert.equal((await up(sp, 'image/png', png)).status, 403);
  sp.ws.close();
  let last = 0;
  for (let i = 0; i < 10; i++) last = (await up(pl, 'image/jpeg', Buffer.from('j' + i))).status;
  assert.equal(last, 429);
  assert.equal((await up(dm, 'text/html', png)).status, 415);
  assert.equal((await up(dm, 'image/png', Buffer.alloc(25 * 1024 * 1024 + 1))).status, 413);
  const g = await fetch(base + url);
  assert.equal(g.status, 200);
  assert.equal(g.headers.get('content-type'), 'image/png');
  assert.equal(g.headers.get('x-content-type-options'), 'nosniff');
  assert.match(g.headers.get('cache-control')!, /immutable/);
  assert.deepEqual(Buffer.from(await g.arrayBuffer()), png);
  // Range: imprescindible para que el jukebox salte a mitad de pista
  const pr = await fetch(base + url, { headers: { range: 'bytes=2-5' } });
  assert.equal(pr.status, 206);
  assert.equal(pr.headers.get('content-range'), `bytes 2-5/${png.length}`);
  assert.deepEqual(Buffer.from(await pr.arrayBuffer()), png.subarray(2, 6));
  assert.equal((await fetch(base + url, { headers: { range: 'bytes=999999-' } })).status, 416);
  assert.equal((await fetch(base + '/assets/..%2f..%2fetc%2fpasswd')).status, 404);
  assert.equal((await fetch(base + '/assets/../x.png')).status, 404);

  for (const c of [dm, pl, pl2]) c.ws.close();
  await srv.close();
});
