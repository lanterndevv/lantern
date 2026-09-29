import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import es from './lang/es.ts';
import en from './lang/en.ts';

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join();
const ts = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? ts(p) : /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && !p.includes('/lang/') ? [p] : []; });

test('en: sin claves ni valores vacíos y mismas {variables} y plurales que la clave', () => {
  for (const [k, v] of Object.entries(en)) {
    assert.ok(k.trim() && v.trim(), `vacío: «${k}»`);
    assert.equal(vars(v), vars(k), `variables distintas: «${k}»`);
    assert.equal(v.includes('|'), k.includes('|'), `plural: «${k}»`);
  }
  for (const [k, v] of Object.entries(es)) assert.ok(k.trim() && v.trim(), `vacío en es: «${k}»`);
});

test('todo t("…") literal del código tiene traducción al inglés', () => {
  const falta = new Set<string>();
  for (const f of ts(new URL('.', import.meta.url).pathname))
    for (const m of readFileSync(f, 'utf8').matchAll(/(?<![\w.$])t\((['"`])((?:(?!\1)[^\\\n])*)\1/g)) if (!(m[2] in en)) falta.add(m[2]);
  assert.deepEqual([...falta], []);
});
