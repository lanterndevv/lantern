// Caos: proxy WS con 300 ms de latencia y 3 cortes aleatorios entre navegador y servidor. DM y jugador actúan durante el caos;
// al final el estado y el chat de ambas páginas (window.__lantern, sin recargar) deben coincidir con el del servidor.
// Uso: npm run chaos [-- --secs=20] [-- --latency=300] [-- --cuts=3]
import { startStack, makeTable, openMember, wsClient, cleanup, sleep, until } from '../lib.mjs';
import { startProxy } from './proxy.mjs';

const arg = (k, d) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const secs = arg('secs', 20), latency = arg('latency', 300), cuts = arg('cuts', 3);

// Registra cada chat que recibe la página (S2C chat + historial del welcome), antes de que cargue la app.
const HOOK = `(() => { window.__chat = {}; const d = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  Object.defineProperty(WebSocket.prototype, 'onmessage', { ...d, set(f) { d.set.call(this, f && ((e) => { try { const m = JSON.parse(e.data);
    if (m.t === 'chat') window.__chat[m.msg.id] = m.msg; else if (m.t === 'welcome') for (const c of m.chat) window.__chat[c.id] = c; } catch {} return f.call(this, e); })); } }); })();`;

const snap = (state, chat) => ({
  tokens: Object.fromEntries(state.scene.tokens.filter((t) => !t.hidden).map((t) => [t.id, `${Math.round(t.x)},${Math.round(t.y)}`])),
  chat: Object.fromEntries(chat.filter((c) => !c.to && !c.roll?.secret).map((c) => [c.id, c.text ?? (c.roll ? `roll ${c.roll.expr}` : '?')])),
});
const diff = (name, a, b) => { // a = cliente, b = servidor
  const out = [];
  for (const sec of ['tokens', 'chat']) for (const k of new Set([...Object.keys(a[sec]), ...Object.keys(b[sec])]))
    if (a[sec][k] !== b[sec][k]) out.push(`  ${name} ${sec} ${k}: cliente=${a[sec][k] ?? '(falta)'}  servidor=${b[sec][k] ?? '(falta)'}`);
  return out;
};

let fails = 0, s, proxy;
try {
  s = await startStack({ api: async (sp) => `http://127.0.0.1:${(proxy = await startProxy(sp, { latency })).port}` });
  const { dm, code, dmW, plW } = await makeTable(s.sp);
  // escena limpia y pequeña: sin muros (no rechazan movimientos), un token del jugador y uno del DM
  for (const w of dmW.state.scene.walls) dm.send({ t: 'remove', kind: 'wall', id: w.id });
  const tok = (id, owners, x) => ({ t: 'upsert', kind: 'token', item: { id, name: id, x, y: 300, size: 1, faction: 'ally', hidden: false, owners, darkvision: 0, conditions: [] } });
  dm.send(tok('tk-dm', [], 300)); dm.send(tok('tk-pl', [plW.memberId], 500));
  await sleep(500); dm.ws.close();
  const truth = wsClient(s.sp); await truth.opened; truth.send({ t: 'join', code, name: 'verdad', as: 'spectator' }); await truth.wait('welcome');
  const truthNow = () => snap(truth.msgs.filter((m) => m.t === 'state' || m.t === 'welcome').at(-1).state,
    [...truth.msgs.filter((m) => m.t === 'welcome').flatMap((m) => m.chat), ...truth.msgs.filter((m) => m.t === 'chat').map((m) => m.msg)]);

  const P = { dm: await openMember(s, code, 'DM', dmW.key, HOOK), pl: await openMember(s, code, 'Ana', plW.key, HOOK) };
  const own = { dm: 'tk-dm', pl: 'tk-pl' }, sent = { dm: [], pl: [] };
  console.log(`mesa ${code}: proxy :${proxy.port} latencia ${latency} ms, ${cuts} cortes, ${secs} s de acciones`);

  // cortes en instantes aleatorios, uno por tramo para que no se solapen
  const cutAt = Array.from({ length: cuts }, (_, i) => 2000 + (i + Math.random()) * ((secs * 1000 - 4000) / cuts));
  const t0 = Date.now(), fired = [];
  const timers = cutAt.map((t) => setTimeout(() => fired.push(`${((Date.now() - t0) / 1000).toFixed(1)}s (${proxy.cut()} conexiones)`), t));

  for (let n = 0; Date.now() - t0 < secs * 1000; n++) {
    for (const who of ['dm', 'pl']) {
      const msgs = [{ t: 'moveToken', id: own[who], x: 300 + (who === 'pl' ? 200 : 0) + (n % 10) * 40, y: 300 + (n % 7) * 30 }];
      if (n % 3 === 0) { const text = `${who}-${n}`; msgs.push({ t: 'chat', text }); sent[who].push(text); }
      if (n % 7 === 0) msgs.push({ t: 'roll', expr: '1d20' });
      await P[who].eval(`(() => { for (const m of ${JSON.stringify(msgs)}) window.__lantern.send(m); })()`);
    }
    await sleep(350);
  }
  timers.forEach(clearTimeout);
  console.log(`cortes en: ${fired.join(', ')}`);

  // ---- convergencia: sin recargar, en ≤ 45 s cada página debe igualar al servidor ----
  const clientNow = (p) => p.eval(`({ state: window.__lantern.state(), chat: Object.values(window.__chat) })`).then((r) => snap(r.state, r.chat));
  let lines = [];
  await until(async () => {
    await sleep(1000);
    lines = [];
    const t = truthNow();
    for (const who of ['dm', 'pl']) lines.push(...diff(who, await clientNow(P[who]), t));
    return !lines.length;
  }, 'convergencia', 45000).catch(() => {});
  const t = truthNow(), chatTexts = new Set(Object.values(t.chat));
  const lost = [...sent.dm, ...sent.pl].filter((x) => !chatTexts.has(x));
  const nSent = sent.dm.length + sent.pl.length;
  if (lines.length) { fails++; console.log('✗ estados divergentes:\n' + lines.join('\n')); } else console.log(`✓ DM y jugador == servidor (${Object.keys(t.tokens).length} tokens, ${Object.keys(t.chat).length} chats visibles), sin recargar`);
  const texts = Object.values(t.chat), dups = [...sent.dm, ...sent.pl].filter((x) => texts.filter((y) => y === x).length > 1);
  if (dups.length) { fails++; console.log(`✗ chats duplicados por reenvío: ${dups.join(', ')}`); } else console.log('✓ sin duplicados');
  if (lost.length) { fails++; console.log(`✗ mensajes de chat perdidos (${lost.length}/${nSent} enviados no llegaron al servidor): ${lost.join(', ')}`); } else console.log(`✓ ${nSent} chats enviados, todos en el servidor`);
} catch (e) { fails++; console.log('✗', e.message); }
cleanup();
console.log(fails ? '\nchaos FALLA' : '\nchaos OK');
process.exit(fails ? 1 : 0);
