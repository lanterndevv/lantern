// node tools/release/publish.mjs <versión>: sube dist-release/<versión>/* a una release de Forgejo/Codeberg o GitLab.
// Env: FORGE=forgejo|gitlab, FORGE_URL (https://codeberg.org), FORGE_REPO (dueño/repo), FORGE_TOKEN, FORGE_TAG (por defecto <versión>).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { FORGE = 'forgejo', FORGE_URL, FORGE_REPO, FORGE_TOKEN } = process.env;
const version = process.argv[2];
if (!version || !FORGE_URL || !FORGE_REPO || !FORGE_TOKEN || !['forgejo', 'gitlab'].includes(FORGE)) {
  console.error('uso: FORGE=forgejo|gitlab FORGE_URL=… FORGE_REPO=dueño/repo FORGE_TOKEN=… node tools/release/publish.mjs <versión>'); process.exit(2);
}
const tag = process.env.FORGE_TAG ?? version, dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist-release', version);
const files = readdirSync(dir), base = FORGE_URL.replace(/\/+$/, '');
const call = async (method, url, body, headers = {}) => {
  const r = await fetch(url, { method, body, headers });
  if (!r.ok && !(method === 'GET' && r.status === 404)) throw new Error(`${method} ${url}: HTTP ${r.status} ${await r.text()}`);
  return r;
};

if (FORGE === 'forgejo') {
  const api = `${base}/api/v1/repos/${FORGE_REPO}`, auth = { Authorization: `token ${FORGE_TOKEN}` };
  let r = await call('GET', `${api}/releases/tags/${encodeURIComponent(tag)}`, undefined, auth), rel;
  if (r.status === 404) rel = await (await call('POST', `${api}/releases`, JSON.stringify({ tag_name: tag, name: tag }), { ...auth, 'Content-Type': 'application/json' })).json();
  else rel = await r.json();
  const have = new Set((rel.assets ?? []).map((a) => a.name));
  for (const f of files) {
    if (have.has(f)) { console.log('ya existe:', f); continue; }
    const form = new FormData(); form.append('attachment', new Blob([readFileSync(join(dir, f))]), f);
    await call('POST', `${api}/releases/${rel.id}/assets?name=${encodeURIComponent(f)}`, form, auth); console.log('subido:', f);
  }
} else { // GitLab: los archivos van al registro de paquetes genérico y la release los enlaza
  const api = `${base}/api/v4/projects/${encodeURIComponent(FORGE_REPO)}`, auth = { 'PRIVATE-TOKEN': FORGE_TOKEN };
  const links = [];
  for (const f of files) {
    const url = `${api}/packages/generic/lantern/${encodeURIComponent(version)}/${encodeURIComponent(f)}`;
    await call('PUT', url, readFileSync(join(dir, f)), auth); console.log('subido:', f);
    links.push({ name: f, url, link_type: 'package' });
  }
  const r = await call('POST', `${api}/releases`, JSON.stringify({ tag_name: tag, name: tag, assets: { links } }), { ...auth, 'Content-Type': 'application/json' });
  console.log('release GitLab:', r.status);
}
