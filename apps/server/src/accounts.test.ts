import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { start } from './main.ts';
import { b32encode, b32decode, totp, verifyTotp, hashPassword, verifyPassword } from './accounts.ts';

test('TOTP: vectores RFC 6238 (SHA-1, 6 dígitos)', () => {
  const s = Buffer.from('12345678901234567890');
  for (const [t, code] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']] as const)
    assert.equal(totp(s, Math.floor(t / 30)), code);
  assert.equal(b32decode(b32encode(s)).toString(), s.toString());
  const sec = b32encode(s);
  assert.ok(verifyTotp(sec, '287082', 59_000 + 30_000) >= 0, 'ventana +1');
  assert.equal(verifyTotp(sec, '287082', 59_000 + 90_000), -1);
  assert.equal(verifyTotp(sec, 'abcdef', 59_000), -1);
});

test('scrypt: hash con parámetros y sal', async () => {
  const h = await hashPassword('correcta-1234');
  assert.match(h, /^scrypt\$32768\$8\$1\$/);
  assert.ok(await verifyPassword('correcta-1234', h));
  assert.ok(!await verifyPassword('otra-cosa-123', h));
});

async function setup() {
  const srv = start(0, ':memory:');
  await srv.ready;
  const base = `http://127.0.0.1:${srv.port()}`;
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown, hdr: Record<string, string> = { 'x-lantern': '1' }) => {
    const r = await fetch(base + '/api/account' + path, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }), ...hdr }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return { status: r.status, body: await r.json() as any, sc };
  };
  const join = (msg: object) => new Promise<any>((ok, ko) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port()}/ws`);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', ...msg })));
    ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.t === 'welcome' || m.t === 'error') { ws.close(); ok(m); } });
    ws.on('error', ko);
  });
  return { srv, call, join, forget: () => { cookie = ''; } };
}
const creds = { email: 'Ana@Example.com', name: 'Ana', password: 'una-clave-larga' };

test('cuentas: registro, sesión, login, logout, CSRF y error genérico', async () => {
  const { srv, call, forget } = await setup();
  try {
    assert.equal((await call('POST', '/register', creds, {})).status, 403, 'CSRF sin cabecera');
    assert.equal((await call('POST', '/register', { ...creds, password: 'corta' })).status, 400);
    const r = await call('POST', '/register', creds);
    assert.equal(r.status, 200); assert.equal(r.body.ok, true);
    assert.match(r.sc!, /lantern_session=[\w-]+; HttpOnly; SameSite=Lax; Path=\/;/);
    assert.deepEqual((await call('GET', '/me')).body, { email: 'ana@example.com', name: 'Ana', has2fa: false, passkeys: 0 });
    assert.equal((await call('POST', '/register', creds)).status, 409);
    await call('POST', '/logout', {});
    assert.equal((await call('GET', '/me')).status, 401);
    forget();
    const bad1 = await call('POST', '/login', { email: 'ana@example.com', password: 'mala-mala-mala' });
    const bad2 = await call('POST', '/login', { email: 'nadie@example.com', password: 'mala-mala-mala' });
    assert.equal(bad1.status, 401); assert.deepEqual(bad1.body, bad2.body);
    assert.equal((await call('POST', '/login', { email: 'ANA@example.com', password: creds.password })).status, 200);
    assert.equal((await call('GET', '/me')).status, 200);
  } finally { await srv.close(); }
});

test('cuentas: 2FA completo', async () => {
  const { srv, call, forget } = await setup();
  try {
    await call('POST', '/register', creds);
    const { secret, otpauth } = (await call('POST', '/2fa/setup', {})).body;
    assert.match(otpauth, /^otpauth:\/\/totp\/Lantern:ana%40example\.com\?secret=[A-Z2-7]+&issuer=Lantern$/);
    const code = () => totp(b32decode(secret), Math.floor(Date.now() / 30000));
    assert.equal((await call('POST', '/2fa/enable', { totp: '000000' })).status, 400);
    assert.equal((await call('POST', '/2fa/enable', { totp: code() })).status, 200);
    assert.equal((await call('GET', '/me')).body.has2fa, true);
    forget();
    const l = { email: creds.email, password: creds.password };
    const no = await call('POST', '/login', l);
    assert.equal(no.status, 401); assert.equal(no.body.need2fa, true);
    assert.equal((await call('POST', '/login', { ...l, totp: '000000' })).body.need2fa, undefined);
    // el código ya usado en /enable no se puede reutilizar (anti-replay); se prueba con el paso siguiente
    const next = totp(b32decode(secret), Math.floor(Date.now() / 30000) + 1);
    assert.equal((await call('POST', '/login', { ...l, totp: next })).status, 200);
    assert.equal((await call('POST', '/2fa/disable', { password: 'x'.repeat(12), totp: next })).status, 400);
  } finally { await srv.close(); }
});

test('cuentas: link, tables y keys nuevas (la vieja sigue valiendo)', async () => {
  const { srv, call, join } = await setup();
  try {
    const dm = await join({ name: 'DM' });
    const code = dm.state.code as string;
    await call('POST', '/register', creds);
    assert.equal((await call('POST', '/link', { code, key: 'inventada' })).status, 400);
    assert.equal((await call('POST', '/link', { code, key: dm.key })).status, 200);
    const t = (await call('GET', '/tables')).body;
    assert.deepEqual(t, [{ code, name: dm.state.scene.name, role: 'dm' }]);
    const { key } = (await call('POST', `/tables/${code}/key`, {})).body;
    assert.notEqual(key, dm.key);
    const a = await join({ code, key }), b = await join({ code, key: dm.key });
    assert.equal(a.t, 'welcome'); assert.equal(a.memberId, dm.memberId);
    assert.equal(b.t, 'welcome'); assert.equal(b.memberId, dm.memberId);
    assert.equal((await call('POST', '/tables/ZZZZZZ/key', {})).status, 404);
  } finally { await srv.close(); }
});

test('cuentas: límite de intentos de login', async () => {
  const { srv, call } = await setup();
  try {
    const st: number[] = [];
    for (let i = 0; i < 11; i++) st.push((await call('POST', '/login', { email: `x${i % 2}@e.com`, password: 'nada-nada-nada' })).status);
    assert.equal(st[9], 401); assert.equal(st[10], 429);
  } finally { await srv.close(); }
});
