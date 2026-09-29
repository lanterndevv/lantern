import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ChatMsg, Id, S2C } from '@lantern/protocol';
import { roll } from '@lantern/rules';
import { openDb } from './db.ts';
import { canSee, chatFor, createRoom, filterFor, genCode, handle, joinRoom, normCode, type MemberRec, type Room, type RollFn } from './room.ts';

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

  const http = createServer((req, res) => {
    if (req.url === '/health') { res.end('ok'); return; }
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
        send(ws, { t: 'welcome', memberId: member.id, key, role: member.role, state: filterFor(room, member, online(room)), chat: chatFor(room.chat, member) });
        broadcastState(room); // el resto ve el nuevo miembro / online
        return;
      }

      if (!conn) return send(ws, { t: 'error', msg: 'primero join' });
      const { room, member } = conn;
      const fx = handle(room, member, msg, rollFn);
      if (fx.error) return send(ws, { t: 'error', msg: fx.error });
      if (fx.chat) for (const [w, c] of conns) if (c.room === room && canSee(fx.chat, c.member)) send(w, { t: 'chat', msg: fx.chat as ChatMsg });
      if (fx.ping) for (const [w, c] of conns) if (c.room === room) send(w, { t: 'ping', ...fx.ping });
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
