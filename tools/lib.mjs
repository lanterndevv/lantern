// Utilidades compartidas por bench y chaos: procesos, servidor+vite+navegador, CDP mínimo, cliente WS.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const freePort = () => new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
export async function until(f, what, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await f(); if (v) return v; } catch { /* reintenta */ }
    if (Date.now() - t0 > ms) throw new Error('timeout esperando: ' + what);
    await sleep(100);
  }
}

const procs = [], tmp = mkdtempSync(join(tmpdir(), 'lantern-tool-'));
export const cleanup = () => { for (const p of procs) try { process.kill(-p.pid, 'SIGTERM'); } catch { /* ya muerto */ } try { rmSync(tmp, { recursive: true, force: true }); } catch { /* nada */ } };
process.on('SIGINT', () => { cleanup(); process.exit(130); });
export function run(cmd, args, env = {}) { // cada proceso en su grupo; se mata por PID de grupo
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  p.log = ''; p.stdout.on('data', (d) => (p.log += d)); p.stderr.on('data', (d) => (p.log += d));
  procs.push(p); return p;
}

function findBrowser() {
  for (const b of [process.env.LANTERN_BROWSER, join(homedir(), '.local/bin/helium'), 'chromium', 'google-chrome-stable'].filter(Boolean)) {
    if (b.includes('/')) { if (existsSync(b)) return b; continue; }
    const w = spawnSync('which', [b], { encoding: 'utf8' });
    if (w.status === 0) return w.stdout.trim();
  }
  throw new Error('No encuentro Chromium (define LANTERN_BROWSER)');
}

/** Arranca servidor (DB temporal) + vite dev + navegador headless. `api(sp)` opcional: URL a la que vite proxya (p. ej. un proxy de caos). */
export async function startStack({ gpu = false, api = (sp) => `http://127.0.0.1:${sp}` } = {}) {
  const [sp, vp, dp] = [await freePort(), await freePort(), await freePort()];
  const server = run('node', ['apps/server/src/main.ts'], { PORT: String(sp), HOST: '127.0.0.1', LANTERN_DB: join(tmp, 'x.db'), LANTERN_ASSETS: join(tmp, 'assets') });
  const vite = run('npx', ['vite', 'apps/web', '--port', String(vp), '--strictPort', '--host', '127.0.0.1'], { LANTERN_API: await api(sp) });
  // LANTERN_BROWSER_PREFIX="$HOME/.local/bin/prime-run" → navegador en la RTX (con --gpu)
  const pre = (process.env.LANTERN_BROWSER_PREFIX ?? '').split(' ').filter(Boolean);
  const args = ['--headless=new', ...(gpu ? ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), `--remote-debugging-port=${dp}`,
    `--user-data-dir=${join(tmp, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', '--no-sandbox', 'about:blank'];
  const browser = run(pre[0] ?? findBrowser(), [...pre.slice(1), ...(pre.length ? [findBrowser()] : []), ...args]);
  try {
    await until(() => fetch(`http://127.0.0.1:${sp}/`).then(() => true), 'servidor');
    await until(() => fetch(`http://127.0.0.1:${vp}/`).then((r) => r.ok), 'vite');
    await until(() => fetch(`http://127.0.0.1:${dp}/json/version`).then((r) => r.ok), 'navegador');
  } catch (e) { throw new Error(`${e.message}\n${server.log}${vite.log}${browser.log.slice(-500)}`); }
  return { sp, vp, dp, browser, base: `http://127.0.0.1:${vp}` };
}

export async function openPage(dbgPort) {
  const r = await fetch(`http://127.0.0.1:${dbgPort}/json/new?about:blank`, { method: 'PUT' });
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
    close: () => { send('Page.close').catch(() => {}); setTimeout(() => ws.close(), 200); },
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return page;
}

export function wsClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  const opened = new Promise((ok) => ws.once('open', ok));
  return { ws, msgs, opened, send: (m) => ws.send(JSON.stringify(m)), wait: (t) => until(() => msgs.find((m) => m.t === t), 'mensaje ' + t) };
}

/** Crea mesa por WS: DM + jugador (con key). Devuelve códigos, keys y ids; deja el cliente DM abierto. */
export async function makeTable(sp) {
  const dm = wsClient(sp); await dm.opened; dm.send({ t: 'join', name: 'DM' });
  const dmW = await dm.wait('welcome'), code = dmW.state.code;
  const pl = wsClient(sp); await pl.opened; pl.send({ t: 'join', code, name: 'Ana' });
  const plW = await pl.wait('welcome'); pl.ws.close();
  return { dm, code, dmW, plW };
}

/** Abre una página como miembro (key ya emitida por el servidor) y pasa la antesala. */
export async function openMember(s, code, name, key, hook = '') {
  const p = await openPage(s.dp);
  if (hook) await p.send('Page.addScriptToEvaluateOnNewDocument', { source: hook });
  await p.goto(s.base + '/');
  await p.eval(`localStorage.setItem('lantern:key:${code}', ${JSON.stringify(key)}); localStorage.setItem('lantern:name', ${JSON.stringify(name)}); localStorage.setItem('lantern:tutorial:done', '1')`);
  await p.goto(`${s.base}/?code=${code}`);
  const ready = `!!document.querySelector('.mesa canvas') && !!window.__lantern && !!globalThis.__pixi`;
  await p.waitFor(ready, 'la mesa de ' + name, 60000);
  await sleep(3000); // vite dev puede recargar una vez al optimizar dependencias: se espera a que se estabilice
  await p.waitFor(ready, 'la mesa de ' + name, 60000);
  await p.waitFor(`!!document.getElementById('an-ok')`, 'antesala', 15000).then(() => p.eval(`document.getElementById('an-ok').click()`)).catch(() => {});
  await sleep(1000);
  return p;
}

export const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
