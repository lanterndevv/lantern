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

## Modo LAN
Sin Internet: `npm start` (o Docker) en un equipo y los demás abren `http://<ip-del-equipo>:8787`. Cambia `HOST` si quieres limitarlo a una interfaz (`HOST=127.0.0.1`). Ojo: los navegadores solo permiten micrófono/cámara en `https` o `localhost`.

## Copiloto IA (opcional)
Se activa solo con variables de entorno del servidor (el cliente nunca elige el endpoint): `LANTERN_LLM_URL` (API compatible con OpenAI, p. ej. `http://localhost:8080/v1`), `LANTERN_LLM_KEY` (Bearer, opcional), `LANTERN_LLM_MODEL` (opcional) y `LANTERN_LLM_TIMEOUT_MS` (60000 por defecto).
Operaciones: `monsterTurn` (propone movimiento, acción y objetivos de un monstruo; validado con visión, velocidad, muros y alcance), `npc` y `recap` (crónica en el diario), solo DM/asistente (recap solo DM), y `rules` (duda de reglas, cualquier miembro no espectador).
Seguridad: a un miembro la IA solo le llega lo que ese miembro ve (estado y chat filtrados); el recap usa el chat como lo vería un jugador; las entradas van delimitadas como datos; las salidas se truncan a 4000 caracteres y nunca se ejecutan solas (el DM confirma); límite de 6 llamadas/min por mesa y 1 simultánea por miembro.

## Lantern Link
Extensión de navegador (Chrome y Firefox) que importa tus personajes de D&D Beyond. Usa solo la sesión del propio usuario. Instalación y detalles en [apps/link/README.md](apps/link/README.md).

## Formato abierto de campaña
Las campañas se exportan e importan como JSON documentado en [apps/server/FORMAT.md](apps/server/FORMAT.md).

## Licencias
- Código: **Licencia: pendiente, se propone AGPL-3.0.**
- Contenido de reglas: SRD 5.2.1 bajo [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Atribución obligatoria: *This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/legalcode).*

## Nota legal
Lantern no está afiliado, respaldado ni patrocinado por Wizards of the Coast ni por D&D Beyond. Dungeons & Dragons y D&D Beyond son marcas de sus propietarios. La extensión Lantern Link solo usa la sesión del propio usuario para leer sus propios personajes.
