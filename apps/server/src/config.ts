// Configuración por archivo (CLAVE=valor, `#` comentarios): LANTERN_CONFIG o ./lantern.env. Las variables de entorno reales tienen prioridad.
import { existsSync } from 'node:fs';

export function loadConfig(): string | undefined {
  const file = process.env.LANTERN_CONFIG ?? 'lantern.env';
  if (!existsSync(file)) return undefined;
  process.loadEnvFile(file); // no pisa lo ya definido
  return file;
}

export const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** IP del cliente. Con TRUST_PROXY=1 se usa la última entrada de X-Forwarded-For (la añade el propio proxy),
 *  pero solo si la conexión viene de loopback: si el puerto está abierto, cualquiera podría inventarse la cabecera. */
export const clientIp = (req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string => {
  const peer = req.socket.remoteAddress ?? '?';
  if (process.env.TRUST_PROXY !== '1' || !LOOPBACK.has(peer)) return peer;
  return String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1)?.trim() || peer;
};
