// E2E: servidor + Vite + Chromium headless controlado por CDP. Uso: npm run e2e  (LANTERN_BROWSER=ruta para elegir navegador)
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'tools/e2e/out');
const tmp = mkdtempSync(join(tmpdir(), 'lantern-e2e-'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
async function until(f, what, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await f(); if (v) return v; } catch { /* reintenta */ }
    if (Date.now() - t0 > ms) throw new Error('timeout esperando: ' + what);
    await sleep(100);
  }
}

// ---- procesos: cada uno en su grupo, se matan por PID de grupo (nunca por patrón) ----
const procs = [];
function run(cmd, args, env = {}) {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  p.log = ''; p.stdout.on('data', (d) => (p.log += d)); p.stderr.on('data', (d) => (p.log += d));
  procs.push(p); return p;
}
function cleanup() {
  for (const p of procs) try { process.kill(-p.pid, 'SIGTERM'); } catch { /* ya muerto */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* nada */ }
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });

function findBrowser() {
  const c = [process.env.LANTERN_BROWSER, join(homedir(), '.local/bin/helium'), 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'].filter(Boolean);
  for (const b of c) {
    if (b.includes('/')) { if (existsSync(b)) return b; continue; }
    const w = spawnSync('which', [b], { encoding: 'utf8' });
    if (w.status === 0) return w.stdout.trim();
  }
  throw new Error('No encuentro Chromium (define LANTERN_BROWSER)');
}

// ---- CDP mínimo ----
async function openPage(dbgPort, url = 'about:blank') {
  const r = await fetch(`http://127.0.0.1:${dbgPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const ws = new WebSocket((await r.json()).webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((ok, ko) => { ws.once('open', ok); ws.once('error', ko); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { const { ok, ko } = pend.get(m.id); pend.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); } });
  const send = (method, params = {}) => new Promise((ok, ko) => { pend.set(++id, { ok, ko }); ws.send(JSON.stringify({ id, method, params })); });
  const page = {
    send,
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async goto(u) { await send('Page.navigate', { url: u }); await sleep(300); },
    waitFor: (expr, what, ms) => until(() => page.eval(expr), what, ms),
    async shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name + '.png'), Buffer.from(r.data, 'base64')); },
    mouse: async (type, x, y, button = 'none') => send('Input.dispatchMouseEvent', { type, x, y, button, buttons: button === 'right' ? 2 : 0, clickCount: 1 }),
    close: () => ws.close(),
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return page;
}

// Hook previo a la carga: guarda todo lo que llega por WebSocket (para comprobar que no se filtran tokens ocultos).
const HOOK = `(() => { window.__wsLog = []; const d = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  Object.defineProperty(WebSocket.prototype, 'onmessage', { ...d, set(f) { d.set.call(this, f && ((e) => { window.__wsLog.push(String(e.data)); return f.call(this, e); })); } }); })();`;

// ---- cliente WS de Node (DM / jugador previos) ----
function wsClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), msgs = [];
  ws.on('message', (d) => msgs.push(d.toString()));
  const opened = new Promise((ok) => ws.once('open', ok));
  return { ws, msgs, opened, send: (m) => ws.send(JSON.stringify(m)),
    wait: (t) => until(() => msgs.map((r) => JSON.parse(r)).find((m) => m.t === t), 'mensaje ' + t) };
}

// ---- comprobaciones ----
let fails = 0;
async function check(name, f) {
  try { const extra = await f(); console.log(`✓ ${name}${extra ? ' — ' + extra : ''}`); }
  catch (e) { fails++; console.log(`✗ ${name}\n    ${String(e.message ?? e).split('\n')[0]}`); }
}
const must = (c, msg) => { if (!c) throw new Error(msg); };

async function main() {
  const [sp, vp, dp] = [await freePort(), await freePort(), await freePort()];
  const server = run('node', ['apps/server/src/main.ts'], { PORT: String(sp), HOST: '127.0.0.1', LANTERN_DB: join(tmp, 'e2e.db'), LANTERN_ASSETS: join(tmp, 'assets') });
  const vite = run('npx', ['vite', 'apps/web', '--port', String(vp), '--strictPort', '--host', '127.0.0.1'], { LANTERN_API: `http://127.0.0.1:${sp}` });
  const browser = run(findBrowser(), ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${dp}`,
    `--user-data-dir=${join(tmp, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', '--no-sandbox', 'about:blank']);
  console.log(`servidor :${sp}  vite :${vp}  cdp :${dp}\n`);
  try {
    await until(() => fetch(`http://127.0.0.1:${sp}/`).then(() => true), 'servidor');
    await until(() => fetch(`http://127.0.0.1:${vp}/`).then((r) => r.ok), 'vite');
    await until(() => fetch(`http://127.0.0.1:${dp}/json/version`).then((r) => r.ok), 'navegador');
  } catch (e) { console.log('✗ arranque:', e.message, '\n', server.log, vite.log, browser.log.slice(-500)); throw e; }
  const base = `http://127.0.0.1:${vp}`;
  const pages = [];
  const newPage = async (hook = true) => { const p = await openPage(dp); if (hook) await p.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK }); pages.push(p); return p; };

  let dm, dmW, plW, code, player;
  await check('(a) la pantalla de unirse se renderiza', async () => {
    player = await newPage();
    await player.goto(base + '/');
    await player.waitFor(`!!document.querySelector('.unirse #code') && !!document.querySelector('.unirse #name')`, '.unirse');
    await player.shot('a-unirse');
  });

  await check('(b) el DM crea la mesa por WebSocket y el jugador entra con su key', async () => {
    dm = wsClient(sp); await dm.opened; dm.send({ t: 'join', name: 'DM' });
    dmW = await dm.wait('welcome'); code = dmW.state.code; must(dmW.role === 'dm', 'rol DM');
    const pl = wsClient(sp); await pl.opened; pl.send({ t: 'join', code, name: 'Ana' });
    plW = await pl.wait('welcome'); pl.ws.close();
    must(plW.role === 'player', 'rol jugador');
    await player.eval(`localStorage.setItem('lantern:key:${code}', ${JSON.stringify(plW.key)}); localStorage.setItem('lantern:name', 'Ana'); localStorage.setItem('lantern:tutorial:done', '1')`);
    await player.goto(`${base}/?code=${code}`);
    await player.waitFor(`!!document.querySelector('.mesa canvas')`, 'la mesa con su canvas', 40000);
    // Antesala (fase 7): se muestra al entrar; «Estoy listo» la cierra y da paso a la mesa
    await player.waitFor(`!!document.getElementById('an-ok')`, 'la antesala', 15000);
    await player.shot('b-antesala');
    await player.eval(`document.getElementById('an-ok').click()`);
    await player.waitFor(`!document.querySelector('dialog[open] #an-ok')`, 'antesala cerrada', 5000);
    await sleep(1500); await player.shot('b-mesa');
    return `mesa ${code} (antesala → Estoy listo)`;
  });

  let pt;
  await check('(c) __lantern existe y worldToClient(Kael) golpea el token en Pixi', async () => {
    await player.waitFor(`!!window.__lantern && !!globalThis.__pixi`, '__lantern');
    const r = await player.eval(`(async () => {
      const L = window.__lantern, t = await L.table, k = L.state().scene.tokens.find(t => t.name === 'Kael');
      const p = t.worldToClient(k.x, k.y), rc = globalThis.__pixi.canvas.getBoundingClientRect();
      const rb = globalThis.__pixi.renderer.events.rootBoundary; rb.rootTarget ??= globalThis.__pixi.renderer.lastObjectRendered; // Pixi lo fija en el primer evento
      const hit = rb.hitTest(p.x - rc.left, p.y - rc.top);
      const has = (c, n) => c.text === n || (c.children ?? []).some((h) => has(h, n));
      let a = hit; while (a && !has(a, 'Kael')) a = a.parent;
      return { p, hit: !!hit, kael: !!a && !has(a, 'Ysolde') };
    })()`);
    pt = r.p; must(r.hit, 'hitTest devuelve null'); must(r.kael, 'el hit no es el token de Kael (capas interactivas tapando)');
    return `(${Math.round(pt.x)}, ${Math.round(pt.y)})`;
  });

  await check('(d) clic derecho sobre Kael abre .rad', async () => {
    await player.mouse('mouseMoved', pt.x, pt.y);
    await player.mouse('mousePressed', pt.x, pt.y, 'right'); await player.mouse('mouseReleased', pt.x, pt.y, 'right');
    await player.waitFor(`!!document.querySelector('.rad')`, '.rad', 5000);
    await sleep(500); await player.shot('d-radial');
    await player.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await player.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await player.waitFor(`!document.querySelector('.rad')`, 'cerrar .rad', 3000).catch(() => {});
  });

  await check('(e) Ctrl+K abre la paleta y «2d6+3» propone «Tirar 2d6+3»', async () => {
    await player.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
    await player.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
    await player.waitFor(`!!document.querySelector('dialog[open]')`, 'paleta abierta', 3000);
    await player.send('Input.insertText', { text: '2d6+3' });
    await player.waitFor(`[...document.querySelectorAll('dialog[open] li')].some(l => l.textContent.includes('Tirar 2d6+3'))`, 'opción «Tirar 2d6+3»', 3000);
    await player.shot('e-paleta');
    await player.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await player.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  });

  await check('(f) combate: el HUD del turno de Kael aparece', async () => {
    dm.send({ t: 'combat', op: 'start' });
    await player.waitFor(`(() => { const h = document.querySelector('#hud'); return !!h && !h.hidden && h.textContent.includes('Kael'); })()`, '#hud con Kael', 8000);
    await player.shot('f-hud');
  });

  await check('(g) el jugador no recibe los nombres de los tokens ocultos', async () => {
    const log = await player.eval(`window.__wsLog.join('\\n')`);
    must(log.length > 1000, 'el hook no capturó mensajes');
    const hidden = dmW.state.scene.tokens.filter((t) => t.hidden).map((t) => t.name);
    must(hidden.length > 0, 'la escena demo no tiene tokens ocultos');
    for (const n of hidden) must(!log.includes(n), `se filtró «${n}»`);
    must(dm.msgs.some((r) => hidden.every((n) => r.includes(n))), 'el DM sí debería verlos (control)');
    return `sin «${hidden.join('», «')}»`;
  });

  await check('(h) ?vista=mesa oculta .lado', async () => {
    const v = await newPage();
    await v.goto(`${base}/?code=${code}&vista=mesa`);
    await v.waitFor(`!!document.querySelector('.mesa canvas')`, 'vista mesa', 40000);
    await sleep(800);
    await v.waitFor(`(() => { const l = document.querySelector('.lado'); return !l || getComputedStyle(l).display === 'none' || l.hidden; })()`, '.lado oculto', 3000);
    await v.shot('h-vista-mesa');
  });

  dm.ws.close();
  for (const p of pages) p.close();
}

try { await main(); } catch (e) { fails++; console.log('✗ fallo general:', e.message); }
cleanup();
console.log(fails ? `\n${fails} comprobación(es) fallida(s)` : '\nTodo OK');
process.exit(fails ? 1 : 0);
