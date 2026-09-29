// Bench de render: mesa 50×50 casillas, 150 tokens, 40 luces, muros; mide tiempo de frame 10 s como DM y como jugador.
// Uso: npm run bench [-- --gpu] [-- --p95=MS] [-- --secs=10]
//   --gpu  sin swiftshader (iGPU real). Para la RTX: LANTERN_BROWSER_PREFIX="$HOME/.local/bin/prime-run" npm run bench -- --gpu
//   Umbral p95 por defecto: 2000 ms con swiftshader (informativo, es CPU) y 33 ms con --gpu.
import { startStack, makeTable, openMember, cleanup, sleep, pct } from '../lib.mjs';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const gpu = process.argv.includes('--gpu'), secs = Number(arg('secs', 10)), limit = Number(arg('p95', gpu ? 33 : 2000));
const G = 70, N = 50, W = G * N; // 50×50 casillas

// Un frame = un callback de rAF; mientras tanto mueve la cámara (barrido + zoom) y un token propio cada 250 ms.
const MEASURE = (ms, tokenId) => `(() => {
  window.__b = null; const done = (d) => (window.__b = d);
  const L = window.__lantern, t0 = performance.now(), dts = []; let last = t0, lastMove = 0, i = 0;
  (async () => { const T = await L.table; const step = (now) => {
    dts.push(now - last); last = now;
    const a = (now - t0) / 1500;
    if (now - lastMove > 100) { lastMove = now; T.focus(${W / 2} + Math.cos(a) * ${W / 3}, ${W / 2} + Math.sin(a * 1.3) * ${W / 3}, 0.35 + 0.35 * (1 + Math.sin(a / 2))); }
    if (i++ % 3 === 0 && ${JSON.stringify(tokenId)}) L.send({ t: 'moveToken', id: ${JSON.stringify(tokenId)}, x: 200 + (i * 37) % ${W - 400}, y: 200 + (i * 53) % ${W - 400} });
    if (now - t0 < ${ms}) requestAnimationFrame(step); else done(dts.slice(2));
  }; requestAnimationFrame(step); })();
})()`;

let s, fails = 0;
try {
  s = await startStack({ gpu });
  const { dm, code, dmW, plW } = await makeTable(s.sp);
  // ---- escena grande, con el ritmo que tolera el rate limit del servidor (30 msg/s) ----
  const out = [...dmW.state.scene.tokens.map((t) => ({ t: 'remove', kind: 'token', id: t.id })), ...dmW.state.scene.walls.map((t) => ({ t: 'remove', kind: 'wall', id: t.id })), ...dmW.state.scene.lights.map((t) => ({ t: 'remove', kind: 'light', id: t.id })), { t: 'scene', patch: { width: W, height: W, grid: { size: G } } }];
  const rnd = (i, m) => (i * 2654435761 % 4294967296) / 4294967296 * m;
  for (let i = 0; i < 150; i++) out.push({ t: 'upsert', kind: 'token', item: { id: `b${i}`, name: `Tok ${i}`, x: 100 + rnd(i + 1, W - 200), y: 100 + rnd(i + 7, W - 200), size: 1, faction: i % 3 ? 'enemy' : 'ally', hidden: false, owners: i === 0 ? [plW.memberId] : [], darkvision: 60, conditions: [], hp: { cur: 10, max: 10, temp: 0 }, ac: 12 } });
  for (let i = 0; i < 40; i++) out.push({ t: 'upsert', kind: 'light', item: { id: `l${i}`, x: 100 + rnd(i + 3, W - 200), y: 100 + rnd(i + 11, W - 200), bright: 140, dim: 280, color: '#ffb85c', anim: i % 2 ? 'torch' : 'none' } });
  for (let i = 0; i < 200; i++) { const x = 100 + rnd(i + 5, W - 400), y = 100 + rnd(i + 13, W - 400), h = i % 2; out.push({ t: 'upsert', kind: 'wall', item: { id: `w${i}`, kind: i % 10 ? 'wall' : 'door', a: { x, y }, b: { x: x + (h ? 0 : 210), y: y + (h ? 210 : 0) } } }); }
  for (const m of out) { dm.send(m); await sleep(37); }
  await sleep(500);
  const sc = dm.msgs.filter((m) => m.t === 'state').at(-1).state.scene;
  console.log(`mesa ${code}: ${sc.width / sc.grid.size}×${sc.height / sc.grid.size} casillas, ${sc.tokens.length} tokens, ${sc.lights.length} luces, ${sc.walls.length} muros  (${gpu ? 'GPU' : 'swiftshader'})`);
  dm.ws.close();

  const roles = [['DM', dmW.key, 'b1'], ['jugador', plW.key, 'b0']];
  
  for (const [who, key, tok] of roles) { // secuencial: una pestaña en segundo plano se throttlea
    let p, dts;
    for (let k = 0; !dts; k++) { // vite dev puede recargar la página al optimizar dependencias la primera vez → un reintento
      try { p = await openMember(s, code, who === 'DM' ? 'DM' : 'Ana', key); await p.send('Page.bringToFront'); await p.eval(MEASURE(secs * 1000, tok)); dts = await p.waitFor('window.__b', 'medición', secs * 1000 + 60000); }
      catch (e) { p?.close(); if (k) throw e; }
    }
    const [p50, p95, max] = [pct(dts, 0.5), pct(dts, 0.95), Math.max(...dts)];
    console.log(`${who.padEnd(8)} frames=${dts.length} fps=${(dts.length / (dts.reduce((a, b) => a + b, 0) / 1000)).toFixed(1)}  p50=${p50.toFixed(1)} ms  p95=${p95.toFixed(1)} ms  max=${max.toFixed(0)} ms`);
    if (p95 > limit) { fails++; console.log(`  ✗ p95 ${p95.toFixed(1)} ms > umbral ${limit} ms`); }
    p.close(); await sleep(1000);
  }
} catch (e) { fails++; console.log('✗', e.message, '\n', s?.browser.log.slice(-1500)); }
cleanup();
console.log(fails ? `\nbench FALLA (umbral p95 ${limit} ms)` : `\nbench OK (umbral p95 ${limit} ms)`);
process.exit(fails ? 1 : 0);
