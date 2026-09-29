// Cuentas opcionales: sirven para recuperar tus mesas en otro dispositivo. Solo stdlib.
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { Room } from './room.ts';
import { sha } from './room.ts';
import { verifyAssertion, verifyRegistration } from './webauthn.ts';

const SESSION_MS = 30 * 24 * 3600 * 1000, WINDOW_MS = 15 * 60 * 1000, MAX_TRIES = 10, MAX_KEYS = 20;
const CHALLENGE_MS = 5 * 60 * 1000, MAX_PASSKEYS = 10;
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 32;

// ---- scrypt: formato `scrypt$N$r$p$sal$hash` (los parámetros viajan con el hash) ----
const kdf = (pw: string, salt: Buffer, n: number, r: number, p: number) =>
  new Promise<Buffer>((ok, ko) => scrypt(pw.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 + 1024 * 1024 }, (e, k) => e ? ko(e) : ok(k)));
export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${(await kdf(pw, salt, N, R, P)).toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [, n, r, p, salt, hash] = stored.split('$');
  const want = Buffer.from(hash ?? '', 'base64');
  const got = await kdf(pw, Buffer.from(salt ?? '', 'base64'), Number(n), Number(r), Number(p));
  return want.length === got.length && timingSafeEqual(want, got);
}

// ---- TOTP RFC 6238 (SHA-1, 6 dígitos, 30 s) ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const b32encode = (b: Buffer) => { let bits = '', out = ''; for (const x of b) bits += x.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; };
export const b32decode = (s: string) => { let bits = ''; for (const c of s.replace(/=+$/, '')) bits += B32.indexOf(c).toString(2).padStart(5, '0'); return Buffer.from(bits.match(/.{8}/g)!.map((x) => parseInt(x, 2))); };
export function totp(secret: Buffer, step: number, digits = 6, alg = 'sha1') {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(step));
  const h = createHmac(alg, secret).update(c).digest(), o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}
/** Devuelve el paso aceptado (ventana ±1) o -1. */
export function verifyTotp(secretB32: string, code: unknown, now = Date.now()) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return -1;
  const s = b32decode(secretB32), t = Math.floor(now / 30000);
  let hit = -1;
  for (const d of [-1, 0, 1]) { const w = totp(s, t + d); if (timingSafeEqual(Buffer.from(w), Buffer.from(code))) hit = t + d; }
  return hit;
}

// ---- módulo ----
type PkRow = { cred_id: string; account_id: number; jwk: string; alg: -7 | -257; counter: number; name: string; created: number };
type Acc = { id: number; email: string; name: string; pass_hash: string; totp_secret: string | null; totp_pending: string | null };
const bad = (res: ServerResponse, st: number, error: string, extra: object = {}) => json(res, st, { error, ...extra });
const json = (res: ServerResponse, st: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(st, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body)); };

export function createAccounts(db: DatabaseSync, host: { getRoom: (code: string) => Room | undefined; dirty: (r: Room) => void }) {
  // tablas: migración «cuentas» en db.ts
  const q = (sql: string) => db.prepare(sql);
  const byEmail = q('SELECT * FROM accounts WHERE email = ?'), byId = q('SELECT * FROM accounts WHERE id = ?');
  const insAcc = q('INSERT INTO accounts (email, name, pass_hash, created) VALUES (?, ?, ?, ?)');
  const insSes = q('INSERT INTO account_sessions (token_hash, account_id, expires) VALUES (?, ?, ?)');
  const getSes = q('SELECT account_id, expires FROM account_sessions WHERE token_hash = ?'), delSes = q('DELETE FROM account_sessions WHERE token_hash = ?');
  const purge = q('DELETE FROM account_sessions WHERE expires < ?');
  const tries = new Map<string, number[]>(); // ponytail: en memoria y sin barrer claves viejas; tabla si hay varias instancias
  const lastStep = new Map<number, number>(); // anti-replay del TOTP
  let dummy: Promise<string> | undefined;

  // ---- passkeys (WebAuthn) ----
  const pkAll = q('SELECT * FROM account_passkeys WHERE account_id = ? ORDER BY created'), pkOne = q('SELECT * FROM account_passkeys WHERE cred_id = ?');
  const pks = (accId: number) => pkAll.all(accId) as unknown as PkRow[];
  const chal = new Map<string, { kind: 'reg' | '2fa' | 'login'; acc?: number; exp: number }>(); // ponytail: en memoria; tabla si hay varias instancias
  const newChallenge = (kind: 'reg' | '2fa' | 'login', acc?: number) => {
    const now = Date.now();
    for (const [k, v] of chal) if (v.exp < now) chal.delete(k);
    if (chal.size >= 2000) chal.delete(chal.keys().next().value!); // tope: el más viejo cae
    const c = randomBytes(32).toString('base64url');
    chal.set(c, { kind, acc, exp: now + CHALLENGE_MS });
    return c;
  };
  const takeChallenge = (c: unknown, kind: string, acc?: number) => { // de un solo uso, caduca, ligado a tipo y cuenta
    const v = typeof c === 'string' ? chal.get(c) : undefined;
    if (typeof c === 'string') chal.delete(c);
    return !!v && v.exp >= Date.now() && v.kind === kind && v.acc === acc;
  };
  const where = (req: IncomingMessage) => { // LANTERN_ORIGIN fija el origen tras proxies raros
    const origin = process.env.LANTERN_ORIGIN ?? `${(req.socket as any).encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;
    return { origin, rpId: new URL(origin).hostname };
  };
  const b64 = (v: unknown) => typeof v === 'string' && v.length <= 8192 ? Buffer.from(v, 'base64url') : Buffer.alloc(0);
  const challengeOf = (clientDataJSON: Buffer) => { try { return JSON.parse(clientDataJSON.toString('utf8')).challenge as unknown; } catch { return undefined; } };
  /** Verifica una aserción; devuelve la cuenta dueña de la credencial o null. */
  const assertion = (req: IncomingMessage, a: unknown, kind: '2fa' | 'login', acc?: number) => {
    if (!a || typeof a !== 'object') return null;
    const o = a as Record<string, unknown>, row = typeof o.id === 'string' && o.id.length <= 1400 ? pkOne.get(o.id) as PkRow | undefined : undefined;
    if (!row || (acc !== undefined && row.account_id !== acc)) return null;
    const clientDataJSON = b64(o.clientDataJSON), ch = challengeOf(clientDataJSON);
    if (!takeChallenge(ch, kind, acc)) return null;
    try {
      const counter = verifyAssertion({ clientDataJSON, authenticatorData: b64(o.authenticatorData), signature: b64(o.signature) }, { challenge: ch as string, ...where(req), requireUV: kind === 'login' }, { jwk: JSON.parse(row.jwk), alg: row.alg, counter: row.counter });
      q('UPDATE account_passkeys SET counter = ? WHERE cred_id = ?').run(counter, row.cred_id);
      return row.account_id;
    } catch { return null; }
  };
  const who = (a: Acc) => ({ email: a.email, name: a.name, has2fa: !!a.totp_secret, passkeys: pks(a.id).length });

  const limited = (...keys: string[]) => { // cuenta el intento y dice si se ha excedido
    const now = Date.now(); let over = false;
    for (const k of keys) {
      const a = (tries.get(k) ?? []).filter((t) => now - t < WINDOW_MS);
      if (a.length >= MAX_TRIES) over = true; else a.push(now);
      tries.set(k, a);
    }
    return over;
  };
  const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
  const cookie = (req: IncomingMessage, v: string, age: number) =>
    `lantern_session=${v}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}` + ((req.socket as any).encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '');
  const session = (req: IncomingMessage) => {
    const tok = /(?:^|;\s*)lantern_session=([\w-]{20,64})/.exec(req.headers.cookie ?? '')?.[1];
    if (!tok) return null;
    const s = getSes.get(sha256(tok)) as { account_id: number; expires: number } | undefined;
    if (!s) return null;
    if (s.expires < Date.now()) { delSes.run(sha256(tok)); return null; }
    return { tok, acc: byId.get(s.account_id) as unknown as Acc };
  };
  const startSession = (req: IncomingMessage, res: ServerResponse, accId: number, body: object) => {
    purge.run(Date.now());
    const tok = randomBytes(32).toString('base64url');
    insSes.run(sha256(tok), accId, Date.now() + SESSION_MS);
    json(res, 200, { ok: true, ...body }, { 'set-cookie': cookie(req, tok, SESSION_MS / 1000) });
  };
  const readJson = async (req: IncomingMessage) => {
    let n = 0; const parts: Buffer[] = [];
    for await (const c of req) { n += c.length; if (n > 16384) throw new Error('grande'); parts.push(c); }
    const v = parts.length ? JSON.parse(Buffer.concat(parts).toString()) : {};
    if (!v || typeof v !== 'object') throw new Error('json');
    return v as Record<string, unknown>;
  };
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max ? v : '';

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = (req.url ?? '').split('?')[0];
    if (!path.startsWith('/api/account/')) return false;
    const sub = path.slice('/api/account'.length), post = req.method === 'POST';
    try {
      if (post && req.headers['x-lantern'] !== '1') return bad(res, 403, 'falta x-lantern'), true;
      const ip = req.socket.remoteAddress ?? '?';

      if (req.method === 'GET' && sub === '/me') {
        const s = session(req);
        if (!s) return bad(res, 401, 'sin sesión'), true;
        return json(res, 200, who(s.acc)), true;
      }
      if (req.method === 'GET' && sub === '/tables') {
        const s = session(req);
        if (!s) return bad(res, 401, 'sin sesión'), true;
        const rows = q('SELECT code, member_id FROM account_tables WHERE account_id = ?').all(s.acc.id) as { code: string; member_id: string }[];
        const out = rows.flatMap((r) => { const room = host.getRoom(r.code), m = room?.members.get(r.member_id); return room && m ? [{ code: r.code, name: room.scene.name, role: m.role }] : []; });
        return json(res, 200, out), true;
      }
      if (req.method === 'GET' && sub === '/passkeys') {
        const s = session(req);
        if (!s) return bad(res, 401, 'sin sesión'), true;
        return json(res, 200, pks(s.acc.id).map((p) => ({ id: p.cred_id, name: p.name, created: p.created }))), true;
      }
      if (!post) return bad(res, 404, 'no existe'), true;
      const b = await readJson(req);

      if (sub === '/register') {
        const email = str(b.email, 254).trim().toLowerCase(), name = str(b.name, 32).trim(), pw = str(b.password, 200);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 400, 'correo inválido'), true;
        if (!name) return bad(res, 400, 'nombre inválido'), true;
        if (pw.length < 10) return bad(res, 400, 'la contraseña necesita al menos 10 caracteres'), true;
        if (limited('reg:' + ip)) return bad(res, 429, 'demasiados intentos, espera un rato'), true;
        if (byEmail.get(email)) return bad(res, 409, 'ese correo ya tiene cuenta'), true;
        const r = insAcc.run(email, name, await hashPassword(pw), Date.now());
        return startSession(req, res, Number(r.lastInsertRowid), { email, name, has2fa: false }), true;
      }
      if (sub === '/login') {
        const email = str(b.email, 254).trim().toLowerCase(), pw = str(b.password, 200);
        if (limited('ip:' + ip, 'em:' + email)) return bad(res, 429, 'demasiados intentos, espera un rato'), true;
        const acc = byEmail.get(email) as Acc | undefined;
        dummy ??= hashPassword('dummy-' + randomBytes(8).toString('hex'));
        const ok = await verifyPassword(pw, acc?.pass_hash ?? await dummy); // siempre gasta scrypt
        const generic = () => bad(res, 401, 'correo o contraseña incorrectos');
        if (!acc || !ok) return generic(), true;
        const keys = pks(acc.id); // con passkeys registradas, la contraseña sola no basta: segundo factor = passkey o TOTP
        if (acc.totp_secret || keys.length) {
          if (b.passkey !== undefined) {
            if (assertion(req, b.passkey, '2fa', acc.id) !== acc.id) return generic(), true;
          } else if (acc.totp_secret && b.totp !== undefined && b.totp !== '') {
            const step = verifyTotp(acc.totp_secret, b.totp);
            if (step < 0 || step <= (lastStep.get(acc.id) ?? -1)) return generic(), true;
            lastStep.set(acc.id, step);
          } else {
            return bad(res, 401, 'código de verificación requerido', { need2fa: true, totp: !!acc.totp_secret,
              ...(keys.length && { passkey: { challenge: newChallenge('2fa', acc.id), rpId: where(req).rpId, allowCredentials: keys.map((k) => k.cred_id) } }) }), true;
          }
        }
        return startSession(req, res, acc.id, who(acc)), true;
      }
      // inicio de sesión sin contraseña: credencial descubrible + verificación de usuario obligatoria (PIN/biometría)
      if (sub === '/passkey/login/options') {
        if (limited('pko:' + ip)) return bad(res, 429, 'demasiados intentos, espera un rato'), true;
        return json(res, 200, { challenge: newChallenge('login'), rpId: where(req).rpId }), true;
      }
      if (sub === '/passkey/login') {
        if (limited('ip:' + ip)) return bad(res, 429, 'demasiados intentos, espera un rato'), true;
        const id = assertion(req, b, 'login'), acc = id === null ? undefined : byId.get(id) as Acc | undefined;
        if (!acc) return bad(res, 401, 'passkey inválida'), true;
        return startSession(req, res, acc.id, who(acc)), true;
      }

      const s = session(req);
      if (!s) return bad(res, 401, 'sin sesión'), true;
      const acc = s.acc;
      if (sub === '/logout') { delSes.run(sha256(s.tok)); return json(res, 200, { ok: true }, { 'set-cookie': cookie(req, '', 0) }), true; }

      if (sub === '/2fa/setup') {
        if (acc.totp_secret) return bad(res, 400, 'el 2FA ya está activo'), true;
        const secret = b32encode(randomBytes(20));
        q('UPDATE accounts SET totp_pending = ? WHERE id = ?').run(secret, acc.id);
        return json(res, 200, { secret, otpauth: `otpauth://totp/Lantern:${encodeURIComponent(acc.email)}?secret=${secret}&issuer=Lantern` }), true;
      }
      if (sub === '/2fa/enable') {
        if (!acc.totp_pending) return bad(res, 400, 'primero pide /2fa/setup'), true;
        if (limited('em:' + acc.email)) return bad(res, 429, 'demasiados intentos, espera un rato'), true;
        const step = verifyTotp(acc.totp_pending, b.totp);
        if (step < 0) return bad(res, 400, 'código incorrecto'), true;
        lastStep.set(acc.id, step);
        q('UPDATE accounts SET totp_secret = totp_pending, totp_pending = NULL WHERE id = ?').run(acc.id);
        return json(res, 200, { ok: true }), true;
      }
      if (sub === '/2fa/disable') {
        if (limited('em:' + acc.email)) return bad(res, 429, 'demasiados intentos, espera un rato'), true;
        const okPw = await verifyPassword(str(b.password, 200), acc.pass_hash);
        const step = acc.totp_secret ? verifyTotp(acc.totp_secret, b.totp) : -1;
        if (!okPw || step < 0 || step <= (lastStep.get(acc.id) ?? -1)) return bad(res, 400, 'contraseña o código incorrectos'), true;
        q('UPDATE accounts SET totp_secret = NULL, totp_pending = NULL WHERE id = ?').run(acc.id);
        return json(res, 200, { ok: true }), true;
      }
      if (sub === '/passkey/register/options') {
        if (pks(acc.id).length >= MAX_PASSKEYS) return bad(res, 400, 'demasiadas passkeys'), true;
        return json(res, 200, { challenge: newChallenge('reg', acc.id), rp: { id: where(req).rpId, name: 'Lantern' }, user: { id: createHash('sha256').update(`lantern:${acc.id}`).digest('base64url'), name: acc.email, displayName: acc.name },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], excludeCredentials: pks(acc.id).map((k) => k.cred_id), authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' }, attestation: 'none' }), true;
      }
      if (sub === '/passkey/register') {
        const clientDataJSON = b64(b.clientDataJSON);
        if (!takeChallenge(challengeOf(clientDataJSON), 'reg', acc.id) || pks(acc.id).length >= MAX_PASSKEYS) return bad(res, 400, 'registro caducado o inválido'), true;
        let cred;
        try { cred = verifyRegistration({ clientDataJSON, attestationObject: b64(b.attestationObject) }, { challenge: challengeOf(clientDataJSON) as string, ...where(req) }); } catch { return bad(res, 400, 'passkey inválida'), true; }
        const id = cred.id.toString('base64url');
        if (pkOne.get(id)) return bad(res, 409, 'esa passkey ya está registrada'), true;
        q('INSERT INTO account_passkeys (cred_id, account_id, jwk, alg, counter, name, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, acc.id, JSON.stringify(cred.jwk), cred.alg, cred.counter, str(b.name, 40).trim() || 'Passkey', Date.now());
        return json(res, 200, { ok: true, id }), true;
      }
      if (sub === '/passkey/delete') { // como desactivar el TOTP: pide la contraseña
        if (limited('em:' + acc.email)) return bad(res, 429, 'demasiados intentos, espera un rato'), true;
        if (!await verifyPassword(str(b.password, 200), acc.pass_hash)) return bad(res, 400, 'contraseña incorrecta'), true;
        const r = q('DELETE FROM account_passkeys WHERE cred_id = ? AND account_id = ?').run(str(b.id, 1400), acc.id);
        return r.changes ? json(res, 200, { ok: true }) : bad(res, 404, 'no existe'), true;
      }
      if (sub === '/link') {
        if (limited('link:' + acc.id)) return bad(res, 429, 'demasiados intentos, espera un rato'), true;
        const code = str(b.code, 31).toUpperCase().replace(/[^A-Z0-9]/g, ''), key = str(b.key, 200);
        const h = key && sha(key), room = host.getRoom(code);
        const m = h && room ? [...room.members.values()].find((x) => x.keyHashes.includes(h)) : undefined;
        if (!room || !m) return bad(res, 400, 'mesa o key inválida'), true;
        q('INSERT INTO account_tables (account_id, code, member_id) VALUES (?, ?, ?) ON CONFLICT(account_id, code) DO UPDATE SET member_id = excluded.member_id').run(acc.id, room.code, m.id);
        return json(res, 200, { ok: true }), true;
      }
      const k = /^\/tables\/([A-Za-z0-9-]{1,31})\/key$/.exec(sub);
      if (k) {
        const code = k[1].toUpperCase().replace(/-/g, '');
        const row = q('SELECT member_id FROM account_tables WHERE account_id = ? AND code = ?').get(acc.id, code) as { member_id: string } | undefined;
        const room = host.getRoom(code), m = row && room?.members.get(row.member_id);
        if (!room || !m) return bad(res, 404, 'mesa no vinculada'), true;
        const key = randomBytes(24).toString('base64url');
        m.keyHashes = [...m.keyHashes, sha(key)].slice(-MAX_KEYS); // ponytail: al pasar de 20 dispositivos caduca la key más vieja
        host.dirty(room);
        return json(res, 200, { key }), true;
      }
      return bad(res, 404, 'no existe'), true;
    } catch (e) {
      console.error('accounts:', e instanceof Error ? e.message : e);
      return bad(res, e instanceof SyntaxError || (e as Error).message === 'json' ? 400 : 500, 'petición inválida'), true;
    }
  }
  return { handle };
}
