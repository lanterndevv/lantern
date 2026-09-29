// WebAuthn (passkeys) sin dependencias: CBOR mínimo + verificación ES256/RS256 con node:crypto.
// Solo attestation 'none' (no se valida la cadena del fabricante: no nos hace falta para cuentas opcionales).
import { createHash, createPublicKey, verify } from 'node:crypto';

type JsonWebKey = Record<string, string>;

const bad = (why: string): never => { throw new Error('webauthn: ' + why); };
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();

/** CBOR mínimo: enteros ≤32 bits, bytes, texto, arrays y mapas definidos (sin flotantes, tags ni indefinidos). */
export function cbor(b: Buffer, o = 0, depth = 0): [unknown, number] {
  if (depth > 6 || o >= b.length) bad('cbor');
  const ib = b[o++], mt = ib >> 5, ai = ib & 31;
  let n: number;
  if (ai < 24) n = ai;
  else if (ai === 24) { n = b.readUInt8(o); o += 1; }
  else if (ai === 25) { n = b.readUInt16BE(o); o += 2; }
  else if (ai === 26) { n = b.readUInt32BE(o); o += 4; }
  else return bad('cbor no soportado');
  if (mt === 0) return [n, o];
  if (mt === 1) return [-1 - n, o];
  if (mt === 2 || mt === 3) {
    if (o + n > b.length) bad('cbor corto');
    const s = b.subarray(o, o + n);
    return [mt === 2 ? Buffer.from(s) : s.toString('utf8'), o + n];
  }
  if ((mt === 4 || mt === 5) && n <= 64) {
    const arr: unknown[] = [];
    for (let i = 0; i < (mt === 5 ? 2 * n : n); i++) { const [v, next] = cbor(b, o, depth + 1); arr.push(v); o = next; }
    if (mt === 4) return [arr, o];
    const m = new Map<unknown, unknown>();
    for (let i = 0; i < arr.length; i += 2) m.set(arr[i], arr[i + 1]);
    return [m, o];
  }
  return bad('cbor no soportado');
}

export type Cred = { jwk: JsonWebKey; alg: -7 | -257 };
const b64u = (b: Buffer) => b.toString('base64url');

function coseToJwk(m: unknown): Cred {
  if (!(m instanceof Map)) return bad('clave');
  const buf = (k: number, len?: number) => { const v = m.get(k); return Buffer.isBuffer(v) && (len === undefined || v.length === len) ? v : bad('clave'); };
  if (m.get(1) === 2 && m.get(3) === -7 && m.get(-1) === 1) return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b64u(buf(-2, 32)), y: b64u(buf(-3, 32)) } };
  if (m.get(1) === 3 && m.get(3) === -257) { const n = buf(-1); if (n.length < 256) bad('RSA < 2048 bits'); return { alg: -257, jwk: { kty: 'RSA', n: b64u(n), e: b64u(buf(-2)) } }; }
  return bad('algoritmo no soportado');
}

type Exp = { challenge: string; origin: string; rpId: string };
function clientData(raw: Buffer, type: string, e: Exp) {
  let c: any;
  try { c = JSON.parse(raw.toString('utf8')); } catch { bad('clientData'); }
  if (!c || c.type !== type || c.challenge !== e.challenge || c.origin !== e.origin || c.crossOrigin === true) bad('clientData no coincide');
}
function authData(ad: Buffer, e: Exp) {
  if (ad.length < 37 || !ad.subarray(0, 32).equals(sha256(e.rpId))) bad('rpId');
  return { flags: ad[32], counter: ad.readUInt32BE(33) };
}

/** Registro: devuelve credencial (id, clave pública como JWK, contador). Lanza si algo no cuadra. */
export function verifyRegistration(i: { clientDataJSON: Buffer; attestationObject: Buffer }, e: Exp) {
  clientData(i.clientDataJSON, 'webauthn.create', e);
  const att = cbor(i.attestationObject)[0] as Map<string, any>, stmt = att instanceof Map ? att.get('attStmt') : undefined;
  if (!(att instanceof Map) || att.get('fmt') !== 'none' || !(stmt instanceof Map) || stmt.size) bad('solo attestation none');
  const ad = att.get('authData');
  if (!Buffer.isBuffer(ad)) return bad('authData');
  const { flags, counter } = authData(ad, e);
  if (!(flags & 0x01) || !(flags & 0x40)) bad('faltan UP/AT');
  if (ad.length < 55) bad('authData corto');
  const len = ad.readUInt16BE(53);
  if (len < 1 || len > 1023 || ad.length < 55 + len) bad('credId');
  const id = Buffer.from(ad.subarray(55, 55 + len)), cred = coseToJwk(cbor(ad, 55 + len)[0]);
  createPublicKey({ key: cred.jwk, format: 'jwk' }); // valida que el punto/módulo sean claves reales
  return { id, ...cred, counter };
}

/** Aserción: verifica firma y contador (anti-clonado). Devuelve el nuevo contador. */
export function verifyAssertion(i: { clientDataJSON: Buffer; authenticatorData: Buffer; signature: Buffer }, e: Exp & { requireUV: boolean }, cred: Cred & { counter: number }) {
  clientData(i.clientDataJSON, 'webauthn.get', e);
  const { flags, counter } = authData(i.authenticatorData, e);
  if (!(flags & 0x01) || (e.requireUV && !(flags & 0x04))) bad('faltan UP/UV');
  const key = createPublicKey({ key: cred.jwk, format: 'jwk' }), data = Buffer.concat([i.authenticatorData, sha256(i.clientDataJSON)]);
  const ok = cred.alg === -7 ? verify('sha256', data, { key, dsaEncoding: 'der' }, i.signature) : verify('sha256', data, key, i.signature);
  if (!ok) bad('firma');
  if ((counter !== 0 || cred.counter !== 0) && counter <= cred.counter) bad('contador: posible clon');
  return counter;
}
