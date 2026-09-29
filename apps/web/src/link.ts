import type { ImportedCharacter } from '@lantern/protocol';
import type { LinkMonsterHit, LinkReq, LinkReq2, LinkReq3, LinkRes, LinkRes2, LinkRes3, LinkRoll } from '@lantern/protocol/link';

// Puente con la extensión Lantern Link (window.postMessage). Solo se aceptan respuestas de esta misma ventana.
function ask<T extends (LinkRes | LinkRes2 | LinkRes3)['t']>(req: { t: 'ping' } | { t: 'gameLogRoll'; characterId: number; roll: LinkRoll } | { t: 'getCharacter'; id: number } | { t: 'searchMonsters'; query: string } | { t: 'getMonster'; id: number }, ms: number): Promise<Extract<LinkRes | LinkRes2 | LinkRes3, { t: T | 'error' }>> {
  const rid = crypto.randomUUID();
  return new Promise((ok, ko) => {
    const done = () => { clearTimeout(to); removeEventListener('message', on); };
    const on = (e: MessageEvent) => {
      const d = e.data as LinkRes | LinkRes2 | LinkRes3;
      if (e.source !== window || d?.lantern !== 'link' || d.dir !== 'res' || d.rid !== rid) return;
      done(); ok(d as never);
    };
    const to = setTimeout(() => { done(); ko(new Error('La extensión Lantern Link no responde.')); }, ms);
    addEventListener('message', on);
    postMessage({ lantern: 'link', dir: 'req', rid, ...req } satisfies LinkReq | LinkReq2 | LinkReq3, location.origin);
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

export const searchMonsters = async (query: string): Promise<LinkMonsterHit[]> => {
  const r = await ask<'monsters'>({ t: 'searchMonsters', query }, 15000);
  if (r.t === 'error') throw new Error(r.msg);
  return r.list;
};

export const getMonster = async (id: number) => {
  const r = await ask<'monster'>({ t: 'getMonster', id }, 15000);
  if (r.t === 'error') throw new Error(r.msg);
  return r.data;
};

// Opt-in: reenvía una tirada propia al Game Log de D&D Beyond del usuario. Lanza con el motivo si no se pudo.
export const sendGameLogRoll = async (characterId: number, roll: LinkRoll): Promise<void> => {
  const r = await ask<'gameLogOk'>({ t: 'gameLogRoll', characterId, roll }, 15000);
  if (r.t === 'error') throw new Error(r.msg);
};
