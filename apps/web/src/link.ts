import type { ImportedCharacter } from '@lantern/protocol';
import type { LinkReq, LinkRes } from '@lantern/protocol/link';

// Puente con la extensión Lantern Link (window.postMessage). Solo se aceptan respuestas de esta misma ventana.
function ask<T extends LinkRes['t']>(req: { t: 'ping' } | { t: 'getCharacter'; id: number }, ms: number): Promise<Extract<LinkRes, { t: T | 'error' }>> {
  const rid = crypto.randomUUID();
  return new Promise((ok, ko) => {
    const done = () => { clearTimeout(to); removeEventListener('message', on); };
    const on = (e: MessageEvent) => {
      const d = e.data as LinkRes;
      if (e.source !== window || d?.lantern !== 'link' || d.dir !== 'res' || d.rid !== rid) return;
      done(); ok(d as never);
    };
    const to = setTimeout(() => { done(); ko(new Error('La extensión Lantern Link no responde.')); }, ms);
    addEventListener('message', on);
    postMessage({ lantern: 'link', dir: 'req', rid, ...req } satisfies LinkReq, location.origin);
  });
}

export const linkAvailable = async (): Promise<{ ok: boolean; loggedIn: boolean; version?: string }> => {
  try {
    const r = await ask<'pong'>({ t: 'ping' }, 800);
    return r.t === 'pong' ? { ok: true, loggedIn: r.loggedIn, version: r.version } : { ok: false, loggedIn: false };
  } catch { return { ok: false, loggedIn: false }; }
};

// ponytail: 30 s fijos; la extensión hace varias peticiones a D&D Beyond
export const getCharacter = async (id: number): Promise<ImportedCharacter> => {
  const r = await ask<'character'>({ t: 'getCharacter', id }, 30000);
  if (r.t === 'error') throw new Error(r.msg);
  return r.data;
};
