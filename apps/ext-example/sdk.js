// Copia de packages/sdk/src/index.ts sin tipos (sin build). Si cambia el SDK, actualiza este archivo.
export async function connect(opts) {
  if (window.parent === window) throw new Error('Lantern: esta página debe cargarse dentro de la mesa');
  let n = 0;
  const pending = new Map(), stateCbs = new Set(), clickCbs = new Set();
  const call = (method, params) => new Promise((res, rej) => {
    const id = ++n; pending.set(id, { res, rej });
    window.parent.postMessage({ lantern: 'sdk', v: 1, id, method, params }, '*');
  });
  window.addEventListener('message', e => {
    if (e.source !== window.parent) return;
    const m = e.data;
    if (!m || m.lantern !== 'sdk' || m.v !== 1) return;
    if (typeof m.re === 'number') {
      const p = pending.get(m.re); if (!p) return;
      pending.delete(m.re);
      m.error !== undefined ? p.rej(new Error(String(m.error))) : p.res(m.ok);
    } else if (m.event === 'state') stateCbs.forEach(cb => cb(m.data));
    else if (m.event === 'contextMenu') clickCbs.forEach(cb => cb(m.data.tokenId, m.data.itemId));
  });
  const hello = await Promise.race([
    call('hello', { apiVersion: opts.apiVersion }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Lantern: el host no responde')), opts.timeoutMs ?? 5000)),
  ]);
  const sub = (set, cb, method) => { set.add(cb); if (method && set.size === 1) call(method).catch(() => {}); return () => set.delete(cb); };
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
