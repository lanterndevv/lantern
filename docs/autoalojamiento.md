# Autoalojamiento

El asistente (`install.sh`/`install.ps1`) cubre la mayoría de casos. Esta guía es para quien quiere hacerlo a mano: Docker, un VPS propio o compilar desde el código.

## Docker

```sh
docker run -v lantern:/data -p 8787:8787 ghcr.io/lanterndevv/lantern
```

O compilando: `docker build -t lantern .` y `docker run -v lantern:/data -p 8787:8787 lantern`. Etiquetas: `latest` y una por versión (`vX.Y.Z`).

## Sin Docker

Requiere Node 24 (ejecuta TypeScript directamente).

```sh
npm install
npm start   # compila la web si falta apps/web/dist y sirve todo desde :8787
```

`npm start` solo compila si no existe `apps/web/dist`; para recompilar, `npm run build`. También puedes bajar el binario `lantern-server-<os>-<arch>` de la release: es un ejecutable único que no necesita Node.

## Variables de entorno

Pueden ir en el entorno o en un archivo `CLAVE=valor` (`lantern.env` o `LANTERN_CONFIG`); el entorno real tiene prioridad.

| Variable | Por defecto | Uso |
|---|---|---|
| `PORT` | `8787` | Puerto |
| `HOST` | `0.0.0.0` | Dirección de escucha (`127.0.0.1` para limitarlo) |
| `LANTERN_DB` | `lantern.db` | Base de datos SQLite (migra sola al arrancar) |
| `LANTERN_ASSETS` | `./assets` | Archivos subidos por los DM |
| `WEB_DIST` | `apps/web/dist` | Web compilada; si existe, el servidor la sirve |
| `TRUST_PROXY` | (vacío) | `1` para tomar la IP de `x-forwarded-for` detrás de un proxy inverso local (solo en conexiones desde loopback) |
| `LANTERN_CONFIG` | `lantern.env` | Archivo de configuración |
| `LANTERN_ORIGIN` | `http://localhost:<puerto>` | URL pública, para los enlaces de invitación |
| `LANTERN_BACKUP_DIR` / `LANTERN_BACKUP_MIN` | `backups/` junto a la BD / `10` | Carpeta e intervalo (minutos) de las copias automáticas |
| `LANTERN_SIGNED_ASSETS` | (vacío) | `1` para servir los assets con URLs firmadas |
| `LANTERN_ADMIN_TOKEN` | (vacío) | Activa la administración local que usa el asistente (solo loopback) |

**Límites:** 30 mensajes/s por conexión (ráfaga de 60), 20 conexiones por IP, 200 mesas por IP y día, 30 subidas por IP cada 10 minutos.

## HTTPS y proxy

El servidor **no cifra**: en Internet ponlo detrás de un proxy con HTTPS (Caddy, nginx…) en la misma máquina y define `HOST=127.0.0.1` y `TRUST_PROXY=1`. Con `TRUST_PROXY=1` los límites por IP usan `X-Forwarded-For`, pero solo en conexiones que llegan desde loopback (el proxy); `HOST=127.0.0.1` evita además que se salte el proxy entrando directamente al puerto 8787. Ejemplo con Caddy:

```
lantern.ejemplo.es {
  reverse_proxy localhost:8787
}
```

Alternativa sin abrir puertos: un túnel de Cloudflare (lo configura el asistente). Los navegadores solo permiten micrófono/cámara en `https` o `localhost`.

## VPS

El asistente puede crear un VPS (Hetzner/DigitalOcean) o desplegar en una VM de Oracle Cloud Always Free, con Caddy y certificado automático (dominio propio o `<ip>.sslip.io`). A mano: instala Docker, lanza la imagen con un volumen y pon Caddy delante.

## Modo LAN

Sin Internet: `npm start` (o Docker) en un equipo y los demás abren `http://<ip-del-equipo>:8787`. La voz en la LAN solo funciona en el propio equipo, salvo que uses HTTPS.

## Voz para mesas grandes (LiveKit, opcional)

Por defecto la voz es una malla WebRTC entre navegadores (hasta ~6 personas). Para más, levanta un [LiveKit](https://livekit.io) y define estas variables; si falta alguna, se sigue usando la malla:

| Variable | Ejemplo | Uso |
|---|---|---|
| `LANTERN_LIVEKIT_URL` | `ws://localhost:7880` | URL del SFU que verá el navegador (`wss://` tras HTTPS) |
| `LANTERN_LIVEKIT_KEY` | `devkey` | API key |
| `LANTERN_LIVEKIT_SECRET` | `secret` | API secret |

Modo dev:

```sh
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev
LANTERN_LIVEKIT_URL=ws://localhost:7880 LANTERN_LIVEKIT_KEY=devkey LANTERN_LIVEKIT_SECRET=secret npm start
```

El servidor firma un token de 6 h por miembro (sala = código de mesa); los espectadores solo escuchan. En producción usa claves propias y `wss://`.

## Copiloto de IA (opcional)

Nunca actúa solo: sugiere y el DM confirma. Se configura solo por el entorno del servidor (el cliente nunca elige el endpoint).

1. **Turno de monstruo (Laya, local).** `tools/laya/setup.sh` (o `--cuda`) crea `tools/laya/.venv` con torch y el paquete público [`laya`](https://huggingface.co/convaiinnovations/laya) (~1,2 GB). El servidor lo arranca en el primer uso: genera 2-6 opciones legales con el motor de reglas y Laya elige una. Si Laya no está, falla o tarda más de 3 s, usa una heurística determinista y lo dice («Heurística»). Variables: `LANTERN_LAYA_DEVICE` (`cpu` por defecto), `LANTERN_LAYA_PYTHON`, `LANTERN_LAYA=0` (desactivar).
2. **Reglas, PNJ y crónica (LLM).** Cualquier API compatible con OpenAI (y adaptadores `anthropic` y `gemini` con `LANTERN_LLM_FORMAT`):

   ```sh
   LANTERN_LLM_URL=https://gateway.example/v1 LANTERN_LLM_KEY=… LANTERN_LLM_MODEL=mimo npm start
   ```

   Opcionales: `LANTERN_LLM_HEADERS` (JSON con cabeceras extra), `LANTERN_LLM_TIMEOUT_MS` (60000) y un proveedor de reserva `LANTERN_LLM2_URL`/`_FORMAT`… que se usa si el principal falla. Sin LLM esas operaciones responden «no configurado» y el turno de monstruo sigue funcionando.

Seguridad: a un miembro la IA solo le llega lo que ese miembro ve; el recap usa el chat como lo vería un jugador; las entradas van delimitadas como datos; las salidas se truncan a 4000 caracteres; límite de 6 llamadas/min por mesa y 1 simultánea por miembro.

## Más

- Formato de campaña: [apps/server/FORMAT.md](../apps/server/FORMAT.md)
- Beyond20: [beyond20.md](beyond20.md) · Lantern Link: [lantern-link.md](lantern-link.md)
- Publicar una versión: [CONTRIBUTING.md](../CONTRIBUTING.md#publicar-una-versión)
