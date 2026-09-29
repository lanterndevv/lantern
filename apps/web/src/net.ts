import type { C2S, S2C } from '@lantern/protocol';

export type Conn = 'online' | 'reconnecting';
// La key del espectador (pantalla de mesa/streaming) va aparte: no debe pisar la del jugador en el mismo navegador.
const keyOf = (code: string, as?: 'spectator') => `lantern:key:${code}${as ? ':' + as : ''}`;
export const savedKey = (code: string, as?: 'spectator') => localStorage.getItem(keyOf(code, as));
export const savedName = () => localStorage.getItem('lantern:name') ?? '';

let ws: WebSocket | undefined;
let delay = 1000;
let conn: Conn = 'reconnecting';
let session: { code?: string; name: string; as?: 'spectator' } | undefined; // último join, para reconectar
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
    if (session) raw({ t: 'join', code: session.code, name: session.name, as: session.as, key: session.code ? savedKey(session.code, session.as) ?? undefined : undefined });
    while (queue.length) raw(queue.shift()!);
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data) as S2C;
    if (m.t === 'welcome') {
      session = { code: m.state.code, name: session?.name ?? '', as: session?.as };
      localStorage.setItem(keyOf(m.state.code, session?.as), m.key);
    } else if (m.t === 'error' && session?.code && (m.msg === 'key inválida' || m.msg === 'mesa inexistente')) {
      // Key caducada o mesa borrada: olvidarla. Con key inválida se reintenta como jugador nuevo.
      localStorage.removeItem(keyOf(session.code, session.as));
      if (m.msg === 'key inválida' && session.name) raw({ t: 'join', code: session.code, name: session.name, as: session.as });
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
      session = { code: m.code, name: m.name, as: m.as };
      if (!m.as) localStorage.setItem('lantern:name', m.name);
      if (ws?.readyState === WebSocket.OPEN) raw(m);
      return; // si no hay conexión, onopen enviará el join
    }
    if (ws?.readyState === WebSocket.OPEN) raw(m); else queue.push(m);
  },
  on(h: (m: S2C) => void) { handlers.add(h); return () => handlers.delete(h); },
  onConn(h: (c: Conn) => void) { connHandlers.add(h); h(conn); return () => connHandlers.delete(h); },
  get conn() { return conn; },
};
