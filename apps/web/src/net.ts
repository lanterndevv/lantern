import type { C2S, S2C } from '@lantern/protocol';

export type Conn = 'online' | 'reconnecting';
// La key del espectador (pantalla de mesa/streaming) va aparte: no debe pisar la del jugador en el mismo navegador.
const keyOf = (code: string, as?: 'spectator') => `lantern:key:${code}${as ? ':' + as : ''}`;
export const savedKey = (code: string, as?: 'spectator') => localStorage.getItem(keyOf(code, as));
export const saveKey = (code: string, key: string) => localStorage.setItem(keyOf(code), key);
export const savedName = () => localStorage.getItem('lantern:name') ?? '';

let ws: WebSocket | undefined;
let delay = 1000;
let conn: Conn = 'reconnecting';
// último join, para reconectar. key en memoria: otra pestaña de la misma mesa (DM probando como jugador) pisa la de localStorage
let session: { code?: string; name: string; as?: 'spectator'; key?: string } | undefined;
const queue: C2S[] = [];
// Cada mensaje lleva un número `s`; se guardan los últimos para reenviar los que un corte dejó en vuelo.
// El welcome dice hasta cuál recibió el servidor para esta pestaña (sid) y él descarta duplicados.
const sid = Math.random().toString(36).slice(2, 12);
let seq = 0, welcomed = false;
let sent: { m: C2S & { s: number }; at: number }[] = [];
// ponytail: solo 200 y de los últimos 30 s (si el servidor se reinició no sabe qué recibió: se acota el duplicado)
const handlers = new Set<(m: S2C) => void>();
let filter: ((m: S2C) => boolean) | undefined; // extras: puede consumir mensajes (vista «como jugador»)
const connHandlers = new Set<(c: Conn) => void>();

const setConn = (c: Conn) => { conn = c; connHandlers.forEach(h => h(c)); };
const raw = (m: C2S) => ws?.send(JSON.stringify(m));
const numbered = (m: C2S) => { const n = { ...m, s: ++seq }; sent.push({ m: n, at: Date.now() }); if (sent.length > 200) sent.shift(); raw(n); };

function open() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => {
    delay = 1000;
    welcomed = false;
    setConn('online');
    if (session) raw({ t: 'join', code: session.code, name: session.name, as: session.as, sid, key: session.key ?? (session.code ? savedKey(session.code, session.as) ?? undefined : undefined) });
    else while (queue.length) numbered(queue.shift()!);
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data) as S2C;
    if (filter?.(m)) return;
    if (m.t === 'welcome') {
      welcomed = true;
      session = { code: m.state.code, name: session?.name ?? '', as: session?.as, key: m.key };
      localStorage.setItem(keyOf(m.state.code, session?.as), m.key);
      // Reenvía lo que no llegó (s > seq) y después lo encolado sin conexión.
      const since = Date.now() - 30000;
      sent = sent.filter(x => x.m.s > (m.seq ?? seq) && x.at > since);
      for (const x of sent) raw(x.m);
      while (queue.length) numbered(queue.shift()!);
    } else if (m.t === 'error' && session?.code && (m.msg === 'key inválida' || m.msg === 'mesa inexistente')) {
      // Key caducada o mesa borrada: olvidarla. Con key inválida se reintenta como jugador nuevo.
      localStorage.removeItem(keyOf(session.code, session.as));
      session.key = undefined;
      sent = []; // el miembro nuevo no hereda acciones del anterior
      if (m.msg === 'key inválida' && session.name) raw({ t: 'join', code: session.code, name: session.name, as: session.as, sid });
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
      session = { code: m.code, name: m.name, as: m.as, key: m.key };
      if (!m.as) localStorage.setItem('lantern:name', m.name);
      sent = []; // otra mesa u otro miembro: no se reenvía nada de la anterior
      if (ws?.readyState === WebSocket.OPEN) raw({ ...m, sid });
      return; // si no hay conexión, onopen enviará el join
    }
    if (ws?.readyState === WebSocket.OPEN && !(session && !welcomed)) numbered(m); else queue.push(m);
  },
  on(h: (m: S2C) => void) { handlers.add(h); return () => handlers.delete(h); },
  onConn(h: (c: Conn) => void) { connHandlers.add(h); h(conn); return () => connHandlers.delete(h); },
  /** Reparte un mensaje a los manejadores como si viniera del servidor. */
  emit(m: S2C) { handlers.forEach(h => h(m)); },
  /** Un solo filtro: si devuelve true el mensaje no llega a los manejadores. */
  setFilter(f: typeof filter) { filter = f; },
  get conn() { return conn; },
};
