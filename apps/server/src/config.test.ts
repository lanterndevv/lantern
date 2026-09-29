import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.ts';

test('lantern.env: carga claves, ignora comentarios y no pisa el entorno', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'lcfg-')), 'lantern.env');
  writeFileSync(f, '# comentario\nCFGT_A=uno\nCFGT_B="dos con espacios"\nCFGT_KEEP=del-archivo\nCFGT_JSON={"x-a":"b"}\n');
  process.env.LANTERN_CONFIG = f; process.env.CFGT_KEEP = 'del-entorno';
  try {
    assert.equal(loadConfig(), f);
    assert.equal(process.env.CFGT_A, 'uno'); assert.equal(process.env.CFGT_B, 'dos con espacios');
    assert.equal(process.env.CFGT_KEEP, 'del-entorno'); assert.equal(process.env.CFGT_JSON, '{"x-a":"b"}');
    process.env.LANTERN_CONFIG = f + '.no'; assert.equal(loadConfig(), undefined);
  } finally { for (const k of ['LANTERN_CONFIG', 'CFGT_A', 'CFGT_B', 'CFGT_KEEP', 'CFGT_JSON']) delete process.env[k]; }
});
