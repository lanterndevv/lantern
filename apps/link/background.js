// Service worker. El token Bearer vive solo aquí: nunca se envía a la página ni a Lantern.
import { mapCharacter, mapMonster } from './ddb.js';

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

// Bearer del usuario contra un servicio de DDB; 401 = sesión caducada.
async function ddb(url) {
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + await getToken() } });
  if (r.status === 401) { token = undefined; throw new Error('Inicia sesión en dndbeyond.com'); }
  if (!r.ok) throw new Error('D&D Beyond respondió ' + r.status);
  return (await r.json()).data;
}
const TYPES = { 1: 'Aberration', 2: 'Beast', 3: 'Celestial', 4: 'Construct', 6: 'Dragon', 7: 'Elemental', 8: 'Fey', 9: 'Fiend', 10: 'Giant', 11: 'Humanoid', 13: 'Monstrosity', 14: 'Ooze', 15: 'Plant', 16: 'Undead' };
const crOf = (id) => id <= 1 ? '0' : id <= 4 ? ['1/8', '1/4', '1/2'][id - 2] : String(id > 28 ? id - 5 : id - 4);
const visible = (x) => x.isReleased === true || x.isHomebrew === true;   // como AboveVTT: lo que la cuenta puede abrir

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
  if (m.t === 'searchMonsters') {
    const q = String(m.query ?? '').trim();
    if (q.length < 2) return { t: 'monsters', list: [] };
    // ponytail: se piden 100 y se filtran en local; sin paginar
    const d = await ddb(`https://monster-service.dndbeyond.com/v1/Monster?search=${encodeURIComponent(q)}&skip=0&take=100`);
    return { t: 'monsters', list: (d ?? []).filter(visible).slice(0, 20)
      .map((x) => ({ id: x.id, name: x.name, cr: crOf(x.challengeRatingId), type: TYPES[x.typeId] ?? '', avatar: x.avatarUrl || undefined })) };
  }
  if (m.t === 'getMonster') {
    if (!Number.isInteger(m.id)) throw new Error('Id de monstruo no válido');
    const x = (await ddb(`https://monster-service.dndbeyond.com/v1/Monster?ids=${m.id}`))?.[0];
    if (!x || !visible(x)) throw new Error('Monstruo inexistente o sin acceso');
    return { t: 'monster', data: mapMonster(x) };
  }
  throw new Error('Mensaje desconocido');
}

chrome.runtime.onMessage.addListener((m, sender, send) => {
  if (sender.id !== chrome.runtime.id) return;
  handle(m).then(send, (e) => send({ t: 'error', msg: e.message }));
  return true;
});
