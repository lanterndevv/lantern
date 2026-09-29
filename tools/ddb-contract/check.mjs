// Contrato con D&D Beyond: pide a los endpoints JSON que usa Lantern Link (apps/link/background.js) y comprueba que la forma
// mínima que espera el mapeador (packages/ddb) sigue ahí. Si DDB cambia algo, falla aquí y no en la mesa.
//
// Uso:  DDB_COBALT='<valor de la cookie CobaltSession>' DDB_CHARACTER_ID=12345678 npm run ddb-contract
//   DDB_COBALT        cookie CobaltSession de dndbeyond.com (DevTools → Application → Cookies). NO se guarda ni se imprime.
//   DDB_CHARACTER_ID  id de un personaje de la cuenta (la cuenta debe poder leerlo). Opcional: sin él se omite esa parte.
//   DDB_MONSTER_QUERY búsqueda de monstruo (por defecto «goblin»).
// Sin DDB_COBALT imprime «skip» y sale con 0. Son 3-4 peticiones; no lo pongas en un bucle.
import { mapCharacter, mapMonster } from '../../packages/ddb/src/index.ts';

const cobalt = process.env.DDB_COBALT;
if (!cobalt) { console.log('skip: sin DDB_COBALT (ver cabecera de tools/ddb-contract/check.mjs)'); process.exit(0); }

let fails = 0;
const ok = (n, extra = '') => console.log(`✓ ${n}${extra && ' — ' + extra}`);
const ko = (n, e) => { fails++; console.log(`✗ ${n}\n    ${e.message ?? e}`); };
const must = (c, m) => { if (!c) throw new Error(m); };
const step = async (n, f) => { try { ok(n, await f()); } catch (e) { ko(n, e); } };
const getJson = async (url, init) => { const r = await fetch(url, init); must(r.ok, `HTTP ${r.status} en ${new URL(url).pathname}`); return r.json(); };

let bearer;
await step('auth-service: cobalt-token → { token }', async () => {
  const j = await getJson('https://auth-service.dndbeyond.com/v1/cobalt-token', { method: 'POST', headers: { Cookie: `CobaltSession=${cobalt}` } });
  must(typeof j.token === 'string' && j.token.length > 20, 'falta token');
  must(j.ttl === undefined || typeof j.ttl === 'number', 'ttl no es número');
  bearer = { Authorization: 'Bearer ' + j.token };
});
if (!bearer) { console.log('\nddb-contract FALLA (sin token no se sigue)'); process.exit(1); }

const id = process.env.DDB_CHARACTER_ID;
if (id) await step(`character-service v5 #${id} → mapCharacter`, async () => {
  const j = await getJson(`https://character-service.dndbeyond.com/character/v5/character/${id}`, { headers: bearer });
  const d = j.data ?? j;
  for (const k of ['classes', 'stats', 'inventory', 'characterValues']) must(Array.isArray(d[k]), `data.${k} ya no es un array`);
  must(typeof d.name === 'string', 'data.name ausente');
  const c = mapCharacter(j);
  must(c.hp?.max > 0 && typeof c.ac === 'number' && c.abilities?.str > 0, `mapeo incompleto: hp=${JSON.stringify(c.hp)} ac=${c.ac}`);
  return `${c.name}, nivel ${c.level}, PG ${c.hp.max}, CA ${c.ac}`;
}); else console.log('skip: personaje (sin DDB_CHARACTER_ID)');

let hit;
await step('monster-service: búsqueda → lista con la forma de Link', async () => {
  const q = process.env.DDB_MONSTER_QUERY ?? 'goblin';
  const j = await getJson(`https://monster-service.dndbeyond.com/v1/Monster?search=${encodeURIComponent(q)}&skip=0&take=100`, { headers: bearer });
  must(Array.isArray(j.data) && j.data.length, `data vacío o no es array para «${q}»`);
  hit = j.data.find((x) => x.isReleased === true || x.isHomebrew === true);
  must(hit, 'ningún resultado visible (isReleased/isHomebrew)');
  for (const k of ['id', 'name', 'challengeRatingId', 'typeId']) must(hit[k] !== undefined, `monstruo sin «${k}»`);
  return `${j.data.length} resultados`;
});
if (hit) await step(`monster-service ?ids=${hit.id} → mapMonster`, async () => {
  const j = await getJson(`https://monster-service.dndbeyond.com/v1/Monster?ids=${hit.id}`, { headers: bearer });
  const m = mapMonster(j);
  must(m.hp.max > 0 && typeof m.ac === 'number' && typeof m.cr === 'string', 'mapeo incompleto');
  return `${m.name}, CR ${m.cr}, PG ${m.hp.max}, CA ${m.ac}, ${m.actions?.length ?? 0} ataques`;
});

console.log(fails ? '\nddb-contract FALLA' : '\nddb-contract OK');
process.exit(fails ? 1 : 0);
