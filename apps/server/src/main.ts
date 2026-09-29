import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ChatMsg, Id, S2C } from '@lantern/protocol';
import { roll } from '@lantern/rules';
import { openDb } from './db.ts';
import { canSee, chatFor, redact, createRoom, filterFor, genCode, handle, joinRoom, normCode, sha, type MemberRec, type Room, type RollFn } from './room.ts';

const MAX_ASSET = 25 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'video/webm': 'webm', 'video/mp4': 'mp4' };
const TYPE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg', ogg: 'audio/ogg', webm: 'video/webm', mp4: 'video/mp4' };

type Conn = { room: Room; member: MemberRec };

export function start(port = Number(process.env.PORT ?? 8787), dbPath?: string, rollFn: RollFn = roll) {
  const db = openDb(dbPath);
  const rooms = new Map<string, Room>();
  const conns = new Map<WebSocket, Conn>();
  const timers = new Map<string, NodeJS.Timeout>();
  // ponytail: las mesas nunca se expulsan de memoria; añadir evicción por inactividad si hace falta

  const getRoom = (code: string) => {
    let r = rooms.get(code);
    if (!r) { r = db.load(code) ?? undefined; if (r) rooms.set(code, r); }
    return r;
  };
  const dirty = (r: Room) => {
    if (timers.has(r.code)) return;
    timers.set(r.code, setTimeout(() => { timers.delete(r.code); db.save(r); }, 500).unref());
  };
  const send = (ws: WebSocket, m: S2C) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  const online = (r: Room) => new Set([...conns.values()].filter((c) => c.room === r).map((c) => c.member.id as Id));
  const broadcastState = (r: Room) => {
    const on = online(r);
    for (const [ws, c] of conns) if (c.room === r) send(ws, { t: 'state', state: filterFor(r, c.member, on) });
  };

  const assets = process.env.LANTERN_ASSETS ?? './assets';
  const fail = (req: IncomingMessage, res: ServerResponse, code: number) => { // responde y corta el stream de subida
    res.writeHead(code, { connection: 'close' });
    res.end(() => req.destroy());
  };
  const http = createServer(async (req, res) => {
    if (req.url === '/health') { res.end('ok'); return; }
    if (req.method === 'POST' && req.url === '/api/assets') {
      const code = req.headers['x-lantern-code'], key = req.headers['x-lantern-key'], type = req.headers['content-type'] ?? '';
      const room = typeof code === 'string' && code.length < 32 ? getRoom(normCode(code)) : undefined;
      const h = typeof key === 'string' && key.length < 200 ? sha(key) : '';
      const who = h && [...(room?.members.values() ?? [])].find((m) => m.keyHash === h);
      if (!who || !['dm', 'assistant', 'trusted'].includes(who.role)) return fail(req, res, 403);
      const ext = EXT[type];
      if (!ext) return fail(req, res, 415);
      if (Number(req.headers['content-length']) > MAX_ASSET) return fail(req, res, 413);
      const parts: Buffer[] = []; let n = 0;
      for await (const c of req) {
        n += c.length;
        if (n > MAX_ASSET) return fail(req, res, 413);
        parts.push(c);
      }
      const body = Buffer.concat(parts), name = createHash('sha256').update(body).digest('hex') + '.' + ext;
      mkdirSync(assets, { recursive: true });
      await writeFile(join(assets, name), body);
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ url: '/assets/' + name }));
      return;
    }
    const f = req.method === 'GET' && /^\/assets\/([0-9a-f]{64}\.(png|jpg|webp|mp3|ogg|webm|mp4))$/.exec(req.url ?? '');
    if (f) {
      // Range es necesario para que <audio>/<video> puedan saltar (sincronizar el jukebox a mitad de pista).
      // ponytail: el archivo entero en memoria (≤25 MB); .webm se sirve como video/webm también para audio.
      const data = await readFile(join(assets, f[1])).catch(() => null);
      if (data) {
        const head = { 'content-type': TYPE[f[2]], 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes' };
        const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
        if (r && (r[1] || r[2])) {
          const size = data.length;
          let start = r[1] ? Number(r[1]) : size - Number(r[2]), end = r[1] && r[2] ? Number(r[2]) : size - 1;
          start = Math.max(0, start); end = Math.min(end, size - 1);
          if (start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
          res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
          res.end(data.subarray(start, end + 1)); return;
        }
        res.writeHead(200, { ...head, 'content-length': data.length });
        res.end(data); return;
      }
    }
    res.statusCode = 404; res.end();
  });
  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024 });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { t: 'error', msg: 'JSON inválido' }); }
      if (typeof msg !== 'object' || msg === null) return send(ws, { t: 'error', msg: 'mensaje inválido' });
      const conn = conns.get(ws);

      if (msg.t === 'join') {
        if (conn) return send(ws, { t: 'error', msg: 'ya estás en una mesa' });
        let room: Room | undefined, member: MemberRec, key: string;
        if (msg.code === undefined) {
          const r = createRoom(msg.name, genCode((c) => rooms.has(c) || db.exists(c)));
          if ('error' in r) return send(ws, { t: 'error', msg: r.error });
          room = r.room; member = r.member; key = r.key;
          rooms.set(room.code, room);
        } else {
          room = typeof msg.code === 'string' ? getRoom(normCode(msg.code)) : undefined;
          if (!room) return send(ws, { t: 'error', msg: 'mesa inexistente' });
          const r = joinRoom(room, msg.name, msg.key);
          if ('error' in r) return send(ws, { t: 'error', msg: r.error });
          member = r.member; key = r.key ?? (msg.key as string);
        }
        conns.set(ws, { room, member });
        dirty(room);
        send(ws, { t: 'welcome', memberId: member.id, key, role: member.role, state: filterFor(room, member, online(room)), chat: chatFor(room, member) });
        send(ws, { t: 'clock', now: Date.now() });
    broadcastState(room); // el resto ve el nuevo miembro / online
        return;
      }

      if (!conn) return send(ws, { t: 'error', msg: 'primero join' });
      const { room, member } = conn;
      const fx = handle(room, member, msg, rollFn);
      if (fx.error) return send(ws, { t: 'error', msg: fx.error });
      for (const cm of [fx.chat, ...(fx.chats ?? [])]) if (cm) for (const [w, c] of conns) if (c.room === room && canSee(cm, c.member)) send(w, { t: 'chat', msg: redact(room, cm, c.member) as ChatMsg });
      if (fx.ping) for (const [w, c] of conns) if (c.room === room) send(w, { t: 'ping', ...fx.ping });
      if (fx.all) for (const [w, c] of conns) if (c.room === room) send(w, fx.all);
      if (fx.to) for (const [w, c] of conns) if (c.room === room && c.member.id === fx.to.id) send(w, fx.to.msg);
      if (fx.clock) send(ws, { t: 'clock', now: Date.now() });
      if (fx.state) broadcastState(room);
      dirty(room);
    });
    ws.on('close', () => {
      const c = conns.get(ws);
      conns.delete(ws);
      if (c) broadcastState(c.room);
    });
    ws.on('error', () => ws.terminate());
  });

  http.listen(port);
  return {
    port: () => (http.address() as { port: number }).port,
    ready: new Promise<void>((ok) => http.once('listening', ok)),
    close: () => new Promise<void>((done) => {
      for (const [code, t] of timers) { clearTimeout(t); const r = rooms.get(code); if (r) db.save(r); }
      timers.clear();
      for (const ws of wss.clients) ws.terminate();
      wss.close(() => http.close(() => { db.close(); done(); }));
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
  console.log('lantern server en :' + (process.env.PORT ?? 8787));
}
