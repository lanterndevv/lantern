import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { start } from './main.ts';
import { cbor } from './webauthn.ts';

// ---- autenticador simulado (ES256) ----
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest();
const head = (mt: number, n: number) => n < 24 ? Buffer.from([mt << 5 | n]) : n < 256 ? Buffer.from([mt << 5 | 24, n]) : Buffer.from([mt << 5 | 25, n >> 8, n & 255]);
const enc = (v: unknown): Buffer => typeof v === 'number' ? (v >= 0 ? head(0, v) : head(1, -1 - v)) : typeof v === 'string' ? Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)])
  : Buffer.isBuffer(v) ? Buffer.concat([head(2, v.length), v]) : Buffer.concat([head(5, (v as Map<unknown, unknown>).size), ...[...(v as Map<unknown, unknown>)].flatMap(([k, x]) => [enc(k), enc(x)])]);
const ORIGIN = 'http://localhost:1234', RP = 'localhost';
class Authn {
  key = generateKeyPairSync('ec', { namedCurve: 'P-256' }); id = randomBytes(32); counter = 0;
  cd = (type: string, challenge: string, origin = ORIGIN) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  cose() { const j = this.key.publicKey.export({ format: 'jwk' }) as any; return enc(new Map<unknown, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(j.x, 'base64url')], [-3, Buffer.from(j.y, 'base64url')]])); }
  auth(flags: number, at = false, rp = RP) {
    const c = Buffer.alloc(4); c.writeUInt32BE(this.counter);
    const base = Buffer.concat([sha(rp), Buffer.from([flags]), c]);
    if (!at) return base;
    const l = Buffer.alloc(2); l.writeUInt16BE(this.id.length);
    return Buffer.concat([base, Buffer.alloc(16), l, this.id, this.cose()]);
  }
  create(challenge: string, o: { fmt?: string; origin?: string; rp?: string } = {}) {
    const attestationObject = enc(new Map<unknown, unknown>([['fmt', o.fmt ?? 'none'], ['attStmt', new Map()], ['authData', this.auth(0x41 | 0x04, true, o.rp)]]));
    return { id: this.id.toString('base64url'), clientDataJSON: this.cd('webauthn.create', challenge, o.origin).toString('base64url'), attestationObject: attestationObject.toString('base64url') };
  }
  get(challenge: string, o: { flags?: number; bump?: boolean; key?: KeyObject } = {}) {
    if (o.bump !== false) this.counter++;
    const authenticatorData = this.auth(o.flags ?? 0x05), clientDataJSON = this.cd('webauthn.get', challenge);
    const signature = sign('sha256', Buffer.concat([authenticatorData, sha(clientDataJSON)]), { key: o.key ?? this.key.privateKey, dsaEncoding: 'der' });
    return { id: this.id.toString('base64url'), clientDataJSON: clientDataJSON.toString('base64url'), authenticatorData: authenticatorData.toString('base64url'), signature: signature.toString('base64url') };
  }
}

test('cbor: enteros, cadenas, mapas anidados y rechazo de lo no soportado', () => {
  const v = cbor(enc(new Map<unknown, unknown>([['a', -7], [1, Buffer.from('xy')], [-2, new Map([['k', 300]])]])))[0] as Map<unknown, unknown>;
  assert.equal(v.get('a'), -7); assert.deepEqual(v.get(1), Buffer.from('xy')); assert.equal((v.get(-2) as Map<string, number>).get('k'), 300);
  assert.throws(() => cbor(Buffer.from([0xf9, 0, 0]))); // float
  assert.throws(() => cbor(Buffer.from([0x5f]))); // indefinido
  assert.throws(() => cbor(Buffer.from([0x42, 1]))); // truncado
});

process.env.LANTERN_ORIGIN = ORIGIN;
async function setup() {
  const srv = start(0, ':memory:');
  await srv.ready;
  const base = `http://127.0.0.1:${srv.port()}`;
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + '/api/account' + path, { method, headers: { 'content-type': 'application/json', 'x-lantern': '1', ...(cookie && { cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return { status: r.status, body: await r.json() as any };
  };
  return { srv, call, forget: () => { cookie = ''; } };
}
const creds = { email: 'ana@example.com', name: 'Ana', password: 'una-clave-larga' };

test('passkeys: registro, segundo factor, login sin contraseña, contador y borrado', async () => {
  const { srv, call, forget } = await setup();
  try {
    await call('POST', '/register', creds);
    const dev = new Authn();
    // registro: attestation distinta de none, otro origen y otro rpId se rechazan; el challenge es de un solo uso
    let o = (await call('POST', '/passkey/register/options', {})).body;
    assert.equal(o.rp.id, 'localhost'); assert.equal(o.attestation, 'none');
    assert.equal((await call('POST', '/passkey/register', dev.create(o.challenge, { fmt: 'packed' }))).status, 400);
    o = (await call('POST', '/passkey/register/options', {})).body;
    assert.equal((await call('POST', '/passkey/register', dev.create(o.challenge, { origin: 'https://evil.example' }))).status, 400);
    o = (await call('POST', '/passkey/register/options', {})).body;
    assert.equal((await call('POST', '/passkey/register', dev.create(o.challenge, { rp: 'evil.example' }))).status, 400);
    o = (await call('POST', '/passkey/register/options', {})).body;
    assert.equal((await call('POST', '/passkey/register', { ...dev.create('otro-challenge') })).status, 400, 'challenge desconocido');
    const reg = dev.create(o.challenge);
    assert.equal((await call('POST', '/passkey/register', { ...reg, name: 'Llave' })).status, 200);
    assert.equal((await call('POST', '/passkey/register', reg)).status, 400, 'challenge ya usado');
    assert.equal((await call('GET', '/me')).body.passkeys, 1);
    assert.equal((await call('GET', '/passkeys')).body[0].name, 'Llave');

    // segundo factor: la contraseña sola ya no basta
    forget();
    const need = await call('POST', '/login', { email: creds.email, password: creds.password });
    assert.equal(need.status, 401); assert.equal(need.body.need2fa, true); assert.deepEqual(need.body.passkey.allowCredentials, [dev.id.toString('base64url')]);
    const ch = need.body.passkey.challenge;
    const badSig = dev.get(ch, { key: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey });
    assert.equal((await call('POST', '/login', { ...creds, passkey: badSig })).status, 401, 'firma de otra clave');
    const ch2 = (await call('POST', '/login', { email: creds.email, password: creds.password })).body.passkey.challenge;
    assert.equal((await call('POST', '/login', { email: creds.email, password: 'mala-mala-mala', passkey: dev.get(ch2) })).status, 401, 'contraseña mala');
    const ch3 = (await call('POST', '/login', { email: creds.email, password: creds.password })).body.passkey.challenge;
    assert.equal((await call('POST', '/login', { ...creds, passkey: dev.get(ch3) })).status, 200);
    assert.equal((await call('GET', '/me')).status, 200);

  } finally { srv.close(); }
});

test('passkeys: login sin contraseña (UV), contador anti-clon y borrado', async () => {
  const { srv, call, forget } = await setup();
  try {
    await call('POST', '/register', creds);
    const dev = new Authn();
    await call('POST', '/passkey/register', dev.create((await call('POST', '/passkey/register/options', {})).body.challenge));
    // sin contraseña: exige verificación de usuario (UV) y challenge propio de «login»
    forget();
    const l = (await call('POST', '/passkey/login/options', {})).body;
    assert.equal((await call('POST', '/passkey/login', dev.get(l.challenge, { flags: 0x01 }))).status, 401, 'sin UV');
    const l2 = (await call('POST', '/passkey/login/options', {})).body;
    assert.equal((await call('POST', '/passkey/login', dev.get(l2.challenge, { bump: true }))).status, 200);
    assert.equal((await call('GET', '/me')).body.email, creds.email);
    // un challenge de 2fa no sirve para login sin contraseña
    forget();
    const c4 = (await call('POST', '/login', { email: creds.email, password: creds.password })).body.passkey.challenge;
    assert.equal((await call('POST', '/passkey/login', dev.get(c4))).status, 401);
    // contador: repetir uno anterior = clon
    forget();
    const l3 = (await call('POST', '/passkey/login/options', {})).body;
    dev.counter = 1;
    assert.equal((await call('POST', '/passkey/login', dev.get(l3.challenge, { bump: false }))).status, 401, 'contador no crece');
    const l4 = (await call('POST', '/passkey/login/options', {})).body;
    assert.equal((await call('POST', '/passkey/login', dev.get(l4.challenge))).status, 401, 'contador ya consumido');
    dev.counter = 100;
    const l5 = (await call('POST', '/passkey/login/options', {})).body;
    assert.equal((await call('POST', '/passkey/login', dev.get(l5.challenge))).status, 200);

    // borrar pide contraseña; sin passkeys vuelve el login normal
    assert.equal((await call('POST', '/passkey/delete', { id: dev.id.toString('base64url'), password: 'mala-mala-mala' })).status, 400);
    assert.equal((await call('POST', '/passkey/delete', { id: dev.id.toString('base64url'), password: creds.password })).status, 200);
    forget();
    assert.equal((await call('POST', '/login', { email: creds.email, password: creds.password })).status, 200);
  } finally { srv.close(); }
});

test('passkeys: sin sesión no hay registro y una credencial ajena no vale de segundo factor', async () => {
  const { srv, call, forget } = await setup();
  try {
    assert.equal((await call('POST', '/passkey/register/options', {})).status, 401);
    await call('POST', '/register', creds);
    const dev = new Authn();
    await call('POST', '/passkey/register', dev.create((await call('POST', '/passkey/register/options', {})).body.challenge));
    forget();
    await call('POST', '/register', { email: 'bo@example.com', name: 'Bo', password: 'otra-clave-larga' });
    const mine = new Authn();
    await call('POST', '/passkey/register', mine.create((await call('POST', '/passkey/register/options', {})).body.challenge));
    forget();
    const ch = (await call('POST', '/login', { email: 'bo@example.com', password: 'otra-clave-larga' })).body.passkey.challenge;
    assert.equal((await call('POST', '/login', { email: 'bo@example.com', password: 'otra-clave-larga', passkey: dev.get(ch) })).status, 401, 'passkey de Ana en la cuenta de Bo');
  } finally { srv.close(); }
});

test('RS256: aserción con clave RSA-2048 y rechazo de mensaje alterado', async () => {
  const { verifyAssertion } = await import('./webauthn.ts');
  const kp = generateKeyPairSync('rsa', { modulusLength: 2048 }), jwk = kp.publicKey.export({ format: 'jwk' }) as Record<string, string>;
  const dev = new Authn(), ad = dev.auth(0x05), cdj = dev.cd('webauthn.get', 'abc');
  const sig = sign('sha256', Buffer.concat([ad, sha(cdj)]), kp.privateKey);
  const exp = { challenge: 'abc', origin: ORIGIN, rpId: RP, requireUV: true }, cred = { jwk, alg: -257 as const, counter: 0 };
  assert.equal(verifyAssertion({ clientDataJSON: cdj, authenticatorData: ad, signature: sig }, exp, cred), 0);
  assert.throws(() => verifyAssertion({ clientDataJSON: cdj, authenticatorData: ad, signature: Buffer.concat([sig.subarray(1), Buffer.from([0])]) }, exp, cred));
});
