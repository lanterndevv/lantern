// SDK de extensiones de Lantern. Se ejecuta DENTRO del iframe sandbox; habla con la mesa por postMessage.
export const API_VERSION = 1;

export type Permission = 'state' | 'chat' | 'roll' | 'contextMenu' | 'panel' | 'tokens';
export type PublicToken = { id: string; name: string; x: number; y: number; faction: 'ally' | 'enemy' | 'neutral'; hp?: { cur: number; max: number } };
export type PublicState = {
  scene: { id: string; name: string; width: number; height: number; gridSize: number };
  tokens: PublicToken[];
  round?: number;          // solo en combate
  turnTokenId?: string;    // token al que le toca
};

export type SdkRequest = { lantern: 'sdk'; v: 1; id: number; method: string; params?: unknown };
export type SdkResponse = { lantern: 'sdk'; v: 1; re: number } & ({ ok: unknown } | { error: string });
export type SdkEvent = { lantern: 'sdk'; v: 1; event: 'state' | 'contextMenu'; data: unknown };

export type Lantern = {
  permissions: Permission[];
  state: { get(): Promise<PublicState>; onChange(cb: (s: PublicState) => void): () => void };
  chat: { send(text: string): Promise<void> };
  roll(expr: string, opts?: { secret?: boolean }): Promise<void>;
  contextMenu: { add(item: { id: string; label: string }): Promise<void>; onClick(cb: (tokenId: string, itemId: string) => void): () => void };
  panel: { setHeight(px: number): Promise<void> };
  tokens: { move(id: string, x: number, y: number): Promise<void> };
};

export async function connect(opts: { apiVersion: number; timeoutMs?: number }): Promise<Lantern> {
  if (window.parent === window) throw new Error('Lantern: esta página debe cargarse dentro de la mesa');
  let n = 0;
  const pending = new Map<number, { res(v: unknown): void; rej(e: Error): void }>();
  const stateCbs = new Set<(s: PublicState) => void>();
  const clickCbs = new Set<(tokenId: string, itemId: string) => void>();
  const call = <T>(method: string, params?: unknown): Promise<T> => new Promise((res, rej) => {
    const id = ++n;
    pending.set(id, { res: res as (v: unknown) => void, rej });
    const m: SdkRequest = { lantern: 'sdk', v: 1, id, method, params };
    window.parent.postMessage(m, '*'); // origen del host desconocido a propósito; el host no nos da nada secreto
  });
  window.addEventListener('message', e => {
    if (e.source !== window.parent) return;
    const m = e.data as Partial<SdkResponse & SdkEvent> | null;
    if (!m || m.lantern !== 'sdk' || m.v !== 1) return;
    if (typeof m.re === 'number') {
      const p = pending.get(m.re); if (!p) return;
      pending.delete(m.re);
      'error' in m && m.error !== undefined ? p.rej(new Error(String(m.error))) : p.res((m as { ok: unknown }).ok);
    } else if (m.event === 'state') stateCbs.forEach(cb => cb(m.data as PublicState));
    else if (m.event === 'contextMenu') { const d = m.data as { tokenId: string; itemId: string }; clickCbs.forEach(cb => cb(d.tokenId, d.itemId)); }
  });
  const hello = await Promise.race([
    call<{ apiVersion: number; permissions: Permission[] }>('hello', { apiVersion: opts.apiVersion }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Lantern: el host no responde')), opts.timeoutMs ?? 5000)),
  ]);
  const sub = <A extends unknown[]>(set: Set<(...a: A) => void>, cb: (...a: A) => void, method?: string) => {
    set.add(cb); if (method && set.size === 1) void call(method).catch(() => {});
    return () => void set.delete(cb);
  };
  return {
    permissions: hello.permissions,
    state: { get: () => call('state.get'), onChange: cb => sub(stateCbs, cb, 'state.subscribe') },
    chat: { send: text => call('chat.send', { text }) },
    roll: (expr, o) => call('roll', { expr, secret: !!o?.secret }),
    contextMenu: { add: item => call('contextMenu.add', item), onClick: cb => sub(clickCbs, cb) },
    panel: { setHeight: px => call('panel.setHeight', { px }) },
    tokens: { move: (id, x, y) => call('tokens.move', { id, x, y }) },
  };
}
