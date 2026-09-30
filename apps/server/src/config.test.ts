import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientIp, loadConfig } from './config.ts';

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

test('clientIp: X-Forwarded-For solo con TRUST_PROXY=1 y desde loopback', () => {
  const req = (peer: string, xff?: string) => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: peer } });
  delete process.env.TRUST_PROXY;
  assert.equal(clientIp(req('127.0.0.1', '1.2.3.4')), '127.0.0.1');
  process.env.TRUST_PROXY = '1';
  try {
    assert.equal(clientIp(req('127.0.0.1', 'falsa, 1.2.3.4')), '1.2.3.4'); // la última la pone el proxy
    assert.equal(clientIp(req('::1')), '::1');
    assert.equal(clientIp(req('203.0.113.9', '1.2.3.4')), '203.0.113.9'); // directo al puerto: la cabecera no cuenta
  } finally { delete process.env.TRUST_PROXY; }
});
