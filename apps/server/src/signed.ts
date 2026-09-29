// URLs firmadas para /assets (opcional, LANTERN_SIGNED_ASSETS=1): ?e=<expira ms>&s=<hmac hex>. Solo stdlib.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const HOUR = 3600_000, TTL_H = 12;
const NAME = '[0-9a-f]{64}\\.(?:png|jpg|webp|mp3|ogg|webm|mp4|pdf)';
// solo campos que guardan un recurso (no texto libre de chat/notas: un jugador podría usarlo de oráculo de firmas)
const OUT = new RegExp(`"(url|image|img|background|pdf|portrait)":"/assets/(${NAME})"`, 'g'), IN = new RegExp(`(/assets/${NAME})\\?e=\\d+&s=[0-9a-f]{64}`, 'g');

export function createSigner(secret: Buffer = randomBytes(32)) {
  const mac = (name: string, e: number) => createHmac('sha256', secret).update(`${name}.${e}`).digest('hex');
  return {
    /** Firma cada campo JSON de recurso (url, image, img…) cuyo valor sea exactamente /assets/<sha>.<ext>. La caducidad se redondea a la hora
     *  (válida 12–13 h) para que la URL —y con ella la caché del navegador— no cambie con cada estado. */
    sign(json: string, now = Date.now()) {
      const e = (Math.floor(now / HOUR) + TTL_H + 1) * HOUR;
      return json.replace(OUT, (_m, k, name) => `"${k}":"/assets/${name}?e=${e}&s=${mac(name, e)}"`);
    },
    /** Quita la firma de lo que devuelve un cliente, para no guardar URLs con caducidad. */
    strip: (raw: string) => raw.replace(IN, '$1'),
    verify(name: string, query: URLSearchParams, now = Date.now()) {
      const e = query.get('e'), s = query.get('s');
      if (!e || !s || !/^\d{1,15}$/.test(e) || !/^[0-9a-f]{64}$/.test(s) || Number(e) < now) return false;
      return timingSafeEqual(Buffer.from(s), Buffer.from(mac(name, Number(e))));
    },
  };
}
