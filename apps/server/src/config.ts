// Configuración por archivo (CLAVE=valor, `#` comentarios): LANTERN_CONFIG o ./lantern.env. Las variables de entorno reales tienen prioridad.
import { existsSync } from 'node:fs';

export function loadConfig(): string | undefined {
  const file = process.env.LANTERN_CONFIG ?? 'lantern.env';
  if (!existsSync(file)) return undefined;
  process.loadEnvFile(file); // no pisa lo ya definido
  return file;
}
