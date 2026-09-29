import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { livekitToken } from './livekit.ts';

test('JWT de LiveKit: firma y claims', () => {
  const t = livekitToken('devkey', 'secret', 'ABC123', 'm1', 'Ana', false, 1_000_000);
  const [h, p, sig] = t.split('.');
  assert.equal(sig, createHmac('sha256', 'secret').update(`${h}.${p}`).digest('base64url'));
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'HS256', typ: 'JWT' });
  const c = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.deepEqual(c, { iss: 'devkey', sub: 'm1', name: 'Ana', nbf: 1000, exp: 1000 + 6 * 3600, video: { room: 'ABC123', roomJoin: true, canPublish: false, canSubscribe: true } });
});
