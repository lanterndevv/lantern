# Lantern

Mesa virtual (VTT) para D&D 5e: mapa táctico con niebla y visión dinámica, fichas, combate, dados, diario, audio y extensiones, con el servidor y el cliente en TypeScript. Las mesas se crean con un código y se juegan desde el navegador.

## Desarrollo
Requiere Node 24 (ejecuta TypeScript directamente).

    npm install
    npm run server   # servidor en :8787
    npm run web      # cliente (vite) con proxy al servidor
    npm test         # tests
    npm run typecheck

## Producción
    npm start        # compila la web si falta apps/web/dist y sirve todo desde :8787
    docker build -t lantern .
    docker run -v lantern:/data -p 8787:8787 lantern

`npm start` solo compila si no existe `apps/web/dist`; para recompilar tras cambios, `npm run build`.

Variables de entorno:

| Variable | Por defecto | Uso |
|---|---|---|
| `PORT` | `8787` | Puerto |
| `HOST` | `0.0.0.0` | Dirección de escucha |
| `LANTERN_DB` | `lantern.db` | Base de datos SQLite (migra sola al arrancar) |
| `LANTERN_ASSETS` | `./assets` | Archivos subidos por los DM |
| `WEB_DIST` | `apps/web/dist` | Web compilada; si existe, el servidor la sirve |
| `TRUST_PROXY` | (vacío) | `1` para tomar la IP de `x-forwarded-for` detrás de un proxy inverso |

Límites: 30 mensajes/s por conexión (ráfaga de 60), 20 conexiones por IP, 200 mesas por IP y día, 30 subidas por IP cada 10 minutos. El servidor no cifra: en Internet, ponlo detrás de un proxy con HTTPS.

## Publicar una versión

Todo se compila desde un Linux x64 (sin runners de otras plataformas):

```sh
npm run release -- 1.2.0 [--releases-url https://mi.forja/o/r/releases/download] [--image mi.forja/o/lantern]
FORGE=forgejo FORGE_URL=https://codeberg.org FORGE_REPO=dueño/repo FORGE_TOKEN=… FORGE_TAG=v1.2.0 node tools/release/publish.mjs 1.2.0
```

`dist-release/1.2.0/` contiene `lantern-server-*` y `lantern-installer-*` (linux x64/arm64, macOS x64/arm64, windows x64) y `SHA256SUMS`. Los Node oficiales se descargan (verificados) a `~/.cache/lantern-release`. `FORGE=gitlab` también vale. Con Forgejo Actions, `.forgejo/workflows/release.yml` hace lo mismo al subir un tag `v*` (secreto `RELEASE_TOKEN`).

- macOS: firma ad hoc con `rcodesign`; sin Developer ID, Gatekeeper avisa (clic derecho > Abrir, o `xattr -d com.apple.quarantine <archivo>`).
- Windows: el `.exe` no lleva firma Authenticode; SmartScreen avisa la primera vez.

## Modo LAN
Sin Internet: `npm start` (o Docker) en un equipo y los demás abren `http://<ip-del-equipo>:8787`. Cambia `HOST` si quieres limitarlo a una interfaz (`HOST=127.0.0.1`). Ojo: los navegadores solo permiten micrófono/cámara en `https` o `localhost`.

## Voz SFU con LiveKit (opcional)
Por defecto la voz es una malla WebRTC entre navegadores (vale hasta ~6 personas). Para mesas grandes, levanta un [LiveKit](https://livekit.io) autoalojado y define estas variables en el servidor de Lantern; si falta alguna, se sigue usando la malla:

| Variable | Ejemplo | Uso |
|---|---|---|
| `LANTERN_LIVEKIT_URL` | `ws://localhost:7880` | URL del SFU que verá el navegador (`wss://` tras HTTPS) |
| `LANTERN_LIVEKIT_KEY` | `devkey` | API key de LiveKit |
| `LANTERN_LIVEKIT_SECRET` | `secret` | API secret de LiveKit |

Modo dev (key `devkey`, secret `secret`):

    docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev
    LANTERN_LIVEKIT_URL=ws://localhost:7880 LANTERN_LIVEKIT_KEY=devkey LANTERN_LIVEKIT_SECRET=secret npm start

(o `livekit-server --dev` si lo tienes instalado). El servidor firma un token de 6 h por miembro (sala = código de mesa); los espectadores solo escuchan. En producción usa claves propias y `wss://`.

## Copiloto (opcional)
Nunca actúa solo: sugiere y el DM confirma. Configuración solo por entorno del servidor (el cliente nunca elige el endpoint).

1. **Turno de monstruo (Laya, local).** `tools/laya/setup.sh` (o `--cuda`) crea `tools/laya/.venv` con torch y el paquete público [`laya`](https://huggingface.co/convaiinnovations/laya) (~1,2 GB). El servidor lo arranca en el primer uso: genera 2–6 opciones legales con el motor de reglas y Laya elige una (~0,3 s en CPU tras la carga inicial de ~4 s). Si Laya no está, falla o tarda más de 3 s, usa una heurística determinista y lo dice («Heurística»). `LANTERN_LAYA_DEVICE` (`cpu` por defecto, para no competir por VRAM), `LANTERN_LAYA_PYTHON` (otro intérprete), `LANTERN_LAYA=0` (desactivar).
2. **Reglas, PNJ y crónica (LLM).** Cualquier API compatible con OpenAI, p. ej. un gateway con el modelo mimo:

       LANTERN_LLM_URL=https://gateway.example/v1 LANTERN_LLM_KEY=… LANTERN_LLM_MODEL=mimo \
       LANTERN_LLM_HEADERS='{"x-session":"…"}' npm start

   `LANTERN_LLM_HEADERS` (JSON, cabeceras extra) y `LANTERN_LLM_TIMEOUT_MS` (60000) son opcionales. Sin LLM esas operaciones responden «no configurado» y el turno de monstruo sigue funcionando.

Seguridad: a un miembro la IA solo le llega lo que ese miembro ve (estado y chat filtrados); el recap usa el chat como lo vería un jugador; las entradas van delimitadas como datos; las salidas se truncan a 4000 caracteres; límite de 6 llamadas/min por mesa y 1 simultánea por miembro.

## Lantern Link
Extensión de navegador (Chrome y Firefox) que importa tus personajes de D&D Beyond. Usa solo la sesión del propio usuario. Instalación y detalles en [apps/link/README.md](apps/link/README.md).

## Formato abierto de campaña
Las campañas se exportan e importan como JSON documentado en [apps/server/FORMAT.md](apps/server/FORMAT.md).

## Licencias
- Código: **Licencia: pendiente, se propone AGPL-3.0.**
- Contenido de reglas: SRD 5.2.1 bajo [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Atribución obligatoria: *This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/legalcode).*

## Nota legal
Lantern no está afiliado, respaldado ni patrocinado por Wizards of the Coast ni por D&D Beyond. Dungeons & Dragons y D&D Beyond son marcas de sus propietarios. La extensión Lantern Link solo usa la sesión del propio usuario para leer sus propios personajes.
