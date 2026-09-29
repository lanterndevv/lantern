// Service worker. El token Bearer vive solo aquí: nunca se envía a la página ni a Lantern.
import { mapCharacter } from './ddb.js';

const version = chrome.runtime.getManifest().version;
let token, exp = 0;   // ponytail: caché en memoria; si el worker se duerme, se pide otro (barato)

async function getToken() {
  if (token && Date.now() < exp) return token;
  let r;
  try { r = await fetch('https://auth-service.dndbeyond.com/v1/cobalt-token', { method: 'POST', credentials: 'include' }); }
  catch { throw new Error('No se pudo conectar con dndbeyond.com'); }
  if (!r.ok) throw new Error('Inicia sesión en dndbeyond.com');
  const j = await r.json();
  if (!j.token) throw new Error('Inicia sesión en dndbeyond.com');
  token = j.token; exp = Date.now() + Math.max(10, (j.ttl ?? 300) - 30) * 1000;
  return token;
}

async function handle(m) {
  if (m.t === 'ping') return { t: 'pong', version, loggedIn: await getToken().then(() => true, () => false) };
  if (m.t === 'getCharacter') {
    if (!Number.isInteger(m.id)) throw new Error('Id de personaje no válido');
    const r = await fetch(`https://character-service.dndbeyond.com/character/v5/character/${m.id}`,
      { headers: { Authorization: 'Bearer ' + await getToken() } });
    if (r.status === 401) { token = undefined; throw new Error('Inicia sesión en dndbeyond.com'); }
    if (!r.ok) throw new Error('Personaje privado o inexistente');
    const j = await r.json();
    return { t: 'character', data: mapCharacter(j.data ?? j) };
  }
  throw new Error('Mensaje desconocido');
}

chrome.runtime.onMessage.addListener((m, sender, send) => {
  if (sender.id !== chrome.runtime.id) return;
  handle(m).then(send, (e) => send({ t: 'error', msg: e.message }));
  return true;
});
