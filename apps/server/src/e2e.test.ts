import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { start } from './main.ts';

function client(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const raw: string[] = [];
  const msgs: any[] = [];
  ws.on('message', (d) => { raw.push(d.toString()); msgs.push(JSON.parse(d.toString())); });
  const opened = new Promise((ok) => ws.once('open', ok));
  const wait = async (f: (m: any) => boolean) => {
    for (let i = 0; i < 100; i++) { const m = msgs.find(f); if (m) return m; await new Promise((r) => setTimeout(r, 20)); }
    throw new Error('timeout');
  };
  return { ws, raw, msgs, opened, wait, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}
const tick = () => new Promise((r) => setTimeout(r, 150));

test('e2e: el jugador nunca recibe tokens ocultos', async () => {
  const srv = start(0, ':memory:', (e) => ({ total: 11, detail: e }));
  await srv.ready;
  const port = srv.port();
  const dm = client(port), pl = client(port);
  await Promise.all([dm.opened, pl.opened]);
  dm.send({ t: 'join', name: 'DM' });
  const w = await dm.wait((m) => m.t === 'welcome');
  assert.equal(w.role, 'dm');
  pl.send({ t: 'join', code: w.state.code.toLowerCase().replace(/^(...)/, '$1-'), name: 'Ana' });
  const pw = await pl.wait((m) => m.t === 'welcome');
  assert.equal(pw.role, 'player');

  dm.send({ t: 'moveToken', id: 'hobgoblin-2', x: 570, y: 450 }); // oculto, dentro de la vista
  dm.send({ t: 'moveToken', id: 'trasgo-c', x: 480, y: 600 });
  dm.send({ t: 'upsert', kind: 'token', item: { ...w.state.scene.tokens.find((t: any) => t.id === 'osgo'), hidden: true } });
  dm.send({ t: 'combat', op: 'start' });
  dm.send({ t: 'roll', expr: '1d20', secret: true });
  dm.send({ t: 'chat', text: 'hola' });
  pl.send({ t: 'moveToken', id: 'trasgo-c', x: 1, y: 1 }); // prohibido
  pl.send({ t: 'roll', expr: '1d6' });
  pl.send('basura' as any);
  await tick();
  await pl.wait((m) => m.t === 'error');
  await pl.wait((m) => m.t === 'chat' && m.msg.roll?.expr === '1d6');
  assert.ok(!pl.msgs.some((m) => m.t === 'chat' && m.msg.roll?.secret));
  assert.ok(dm.msgs.some((m) => m.t === 'chat' && m.msg.roll?.secret));
  for (const r of pl.raw) assert.ok(!r.includes('Hobgoblin 2') && !r.includes('Trasgo C'), r.slice(0, 200));
  assert.ok(dm.raw.some((r) => r.includes('Hobgoblin 2'))); // el DM sí lo ve

  // reconexión con key
  const pl2 = client(port); await pl2.opened;
  pl2.send({ t: 'join', code: w.state.code, name: 'x', key: pw.key });
  assert.equal((await pl2.wait((m) => m.t === 'welcome')).memberId, pw.memberId);
  const bad = client(port); await bad.opened;
  bad.send({ t: 'join', code: w.state.code, name: 'x', key: 'mala' });
  await bad.wait((m) => m.t === 'error');
  for (const c of [dm, pl, pl2, bad]) c.ws.close();
  await srv.close();
});
