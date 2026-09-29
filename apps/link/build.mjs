// Copia packages/ddb y packages/srd (sin tipos) a apps/link/ para que la extensión no necesite build.
// Uso: node apps/link/build.mjs
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const here = new URL('.', import.meta.url), src = (p) => readFileSync(new URL(p, here), 'utf8');
const strip = (code) => stripTypeScriptTypes(code, { mode: 'strip' });
writeFileSync(new URL('srd.js', here), strip(src('../../packages/srd/src/index.ts')));
writeFileSync(new URL('gamelog.js', here), strip(src('../../packages/ddb/src/gamelog.ts')));
writeFileSync(new URL('ddb.js', here), strip(src('../../packages/ddb/src/index.ts')).replace("'@lantern/srd'", "'./srd.js'"));
