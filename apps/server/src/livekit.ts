// Token de acceso LiveKit (JWT HS256) firmado con node:crypto; sin dependencias. Solo activo con las 3 env LANTERN_LIVEKIT_*.
import { createHmac } from 'node:crypto';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

export const livekitOn = () => !!(process.env.LANTERN_LIVEKIT_URL && process.env.LANTERN_LIVEKIT_KEY && process.env.LANTERN_LIVEKIT_SECRET);

export function livekitToken(key: string, secret: string, room: string, id: string, name: string, canPublish: boolean, now = Date.now()): string {
  const s = Math.floor(now / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: key, sub: id, name, nbf: s, exp: s + 6 * 3600, video: { room, roomJoin: true, canPublish, canSubscribe: true } })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
