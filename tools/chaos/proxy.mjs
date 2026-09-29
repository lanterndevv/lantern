// Proxy WS de caos: latencia fija en ambos sentidos y cortes a demanda. HTTP se reenvía tal cual.
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

export function startProxy(target, { latency = 300 } = {}) {
  const pairs = new Set();
  const srv = http.createServer((req, res) => {
    const up = http.request({ host: '127.0.0.1', port: target, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => res.destroy()); req.pipe(up);
  });
  const wss = new WebSocketServer({ server: srv, path: '/ws' });
  wss.on('connection', (c) => {
    const s = new WebSocket(`ws://127.0.0.1:${target}/ws`, { perMessageDeflate: false }), pair = [c, s], early = [];
    pairs.add(pair);
    // Cada mensaje sale `latency` ms después de llegar; el orden se conserva (mismo retardo). Al cortar, lo que iba en vuelo se pierde.
    const fwd = (from, to) => from.on('message', (d, bin) => setTimeout(() => { if (to.readyState === WebSocket.OPEN) to.send(d, { binary: bin }); else if (to === s && s.readyState === WebSocket.CONNECTING) early.push([d, bin]); }, latency));
    s.on('open', () => early.splice(0).forEach(([d, b]) => s.send(d, { binary: b })));
    fwd(c, s); fwd(s, c);
    const end = () => { pairs.delete(pair); pair.forEach((w) => w.terminate()); };
    c.on('close', end); s.on('close', end); c.on('error', end); s.on('error', end);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({
    port: srv.address().port,
    cut() { const n = pairs.size; [...pairs].forEach((p) => p.forEach((w) => w.terminate())); return n; },
  })));
}
