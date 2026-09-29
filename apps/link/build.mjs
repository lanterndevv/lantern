// Copia packages/ddb (sin tipos) y empaqueta lo necesario de packages/srd a apps/link/ para que la extensión no necesite build.
// Uso: node apps/link/build.mjs
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
const here = new URL('.', import.meta.url), src = (p) => readFileSync(new URL(p, here), 'utf8');
const strip = (code) => stripTypeScriptTypes(code, { mode: 'strip' });
// srd.js: index.ts solo reexporta módulos hermanos que no viajan con la extensión, así que se empaqueta (solo SPELLS, lo que usa ddb.js).
const [srd] = buildSync({ stdin: { contents: `export { SPELLS } from ${JSON.stringify(new URL('../../packages/srd/src/index.ts', here).pathname)};`, loader: 'ts', resolveDir: new URL('.', here).pathname }, bundle: true, format: 'esm', minify: true, write: false, banner: { js: '// This work includes material from the System Reference Document 5.2.1 by Wizards of the Coast LLC, licensed under CC BY 4.0' } }).outputFiles;
writeFileSync(new URL('srd.js', here), srd.text);
writeFileSync(new URL('gamelog.js', here), strip(src('../../packages/ddb/src/gamelog.ts')));
writeFileSync(new URL('ddb.js', here), strip(src('../../packages/ddb/src/index.ts')).replace("'@lantern/srd'", "'./srd.js'"));
