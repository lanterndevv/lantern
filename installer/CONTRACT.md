# Contrato instalador ↔ lantern-server

## Binario
- `lantern-server` (Node SEA, uno por os/arch: linux-x64, linux-arm64, macos-x64, macos-arm64, windows-x64.exe).
- Publicado junto a `SHA256SUMS` en `<LANTERN_RELEASES>/<versión>/` (por defecto GitHub Releases; configurable con `--releases` o la env `LANTERN_RELEASES`; en desarrollo `--server-bin <ruta>` usa un binario local).
- `lantern-server --version` imprime la versión y sale.

## Configuración
- Carpeta de datos (`os.UserConfigDir()/Lantern`, en Linux `~/.config/lantern`) con `lantern.env` (formato `CLAVE=valor`, una por línea, `#` comentarios, permisos 600).
- El servidor lee `LANTERN_CONFIG=<ruta a lantern.env>` o, si no existe, `lantern.env` en el directorio de trabajo; las variables de entorno reales tienen prioridad.
- Claves: `PORT`, `HOST`, `LANTERN_DB`, `LANTERN_ASSETS`, `LANTERN_BACKUP_DIR`, `LANTERN_ORIGIN` (URL pública, p.ej. https://xxx.trycloudflare.com),
  `LANTERN_ADMIN_TOKEN`, `LANTERN_LLM_FORMAT` (openai|anthropic|gemini), `LANTERN_LLM_URL`, `LANTERN_LLM_KEY`, `LANTERN_LLM_MODEL`, `LANTERN_LLM_HEADERS` (JSON),
  `LANTERN_LLM2_*` (reserva, mismas claves), `LANTERN_LAYA`, `LANTERN_LAYA_PYTHON`, `LANTERN_LAYA_DEVICE`, `LANTERN_LIVEKIT_URL/KEY/SECRET`.

## Administración (solo 127.0.0.1, cabecera `authorization: Bearer <LANTERN_ADMIN_TOKEN>`)
- `GET  /health` → `ok`
- `GET  /admin/status` → `{ version, rooms, llm: bool, laya: 'off'|'loading'|'ready', origin }`
- `POST /admin/bootstrap` `{ dmName, title? }` → `{ code, inviteUrl, dmUrl }` — crea una mesa; `dmUrl` abre la mesa como DM en el navegador (lleva la key en el fragmento `#k=`).
- `POST /admin/import?code=<código>&kind=lantern|uvtt` con el archivo en el cuerpo (bytes) → `{ ok, summary }`.
- La prueba de claves de IA la hace el propio instalador en Go (no el servidor), para poder probarlas antes de instalar nada.
