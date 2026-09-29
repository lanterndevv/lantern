import type { C2S, S2C } from '@lantern/protocol';

export type Conn = 'online' | 'reconnecting';
const keyOf = (code: string) => `lantern:key:${code}`;
export const savedKey = (code: string) => localStorage.getItem(keyOf(code));
export const savedName = () => localStorage.getItem('lantern:name') ?? '';

let ws: WebSocket | undefined;
let delay = 1000;
let conn: Conn = 'reconnecting';
let session: { code?: string; name: string } | undefined; // último join, para reconectar
const queue: C2S[] = [];
const handlers = new Set<(m: S2C) => void>();
const connHandlers = new Set<(c: Conn) => void>();

const setConn = (c: Conn) => { conn = c; connHandlers.forEach(h => h(c)); };
const raw = (m: C2S) => ws?.send(JSON.stringify(m));

function open() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => {
    delay = 1000;
    setConn('online');
    if (session) raw({ t: 'join', code: session.code, name: session.name, key: session.code ? savedKey(session.code) ?? undefined : undefined });
    while (queue.length) raw(queue.shift()!);
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data) as S2C;
    if (m.t === 'welcome') {
      session = { code: m.state.code, name: session?.name ?? '' };
      localStorage.setItem(keyOf(m.state.code), m.key);
    }
    handlers.forEach(h => h(m));
  };
  ws.onclose = () => {
    setConn('reconnecting');
    setTimeout(open, delay);
    delay = Math.min(delay * 2, 10000);
  };
}
open();

export const net = {
  send(m: C2S) {
    if (m.t === 'join') {
      session = { code: m.code, name: m.name };
      localStorage.setItem('lantern:name', m.name);
      if (ws?.readyState === WebSocket.OPEN) raw(m);
      return; // si no hay conexión, onopen enviará el join
    }
    if (ws?.readyState === WebSocket.OPEN) raw(m); else queue.push(m);
  },
  on(h: (m: S2C) => void) { handlers.add(h); return () => handlers.delete(h); },
  onConn(h: (c: Conn) => void) { connHandlers.add(h); h(conn); return () => connHandlers.delete(h); },
  get conn() { return conn; },
};
