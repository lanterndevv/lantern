# Lantern Link

Extensión MV3 (Chrome y Firefox) que importa tus personajes de D&D Beyond a Lantern.
Sin build de la extensión; solo hay que regenerar `ddb.js`/`srd.js` si cambia `packages/ddb` o `packages/srd`:

    node apps/link/build.mjs

## Cargarla sin empaquetar
- **Chrome/Chromium:** `chrome://extensions` → Modo desarrollador → «Cargar descomprimida» → carpeta `apps/link`.
- **Firefox (128+):** `about:debugging#/runtime/this-firefox` → «Cargar complemento temporal» → `apps/link/manifest.json`.

## Qué toca
- Usa solo tu sesión en dndbeyond.com: pide un token Bearer de corta duración y lee `character-service` del personaje que pides.
- Monstruos (pestaña «Tu cuenta» del compendio, solo DM): `searchMonsters` consulta `monster-service.dndbeyond.com/v1/Monster?search=…&skip=0&take=100` y deja hasta 20 con `isReleased` o `isHomebrew` (lo que tu cuenta puede abrir); `getMonster` pide `?ids=<id>` y lo convierte con `mapMonster`. Solo salen estadísticas: nunca rasgos ni descripciones.
- El token nunca sale de la extensión (ni a la página ni al servidor de Lantern).
- A la página solo le entrega estadísticas de juego (`ImportedCharacter`): nada de texto de reglas ni descripciones.
- El content script solo actúa en páginas con `<meta name="lantern" content="1">`.

## Relé al Game Log de D&D Beyond (opcional)
- **Desactivado por defecto.** Cada jugador lo activa con la casilla «Enviar mis tiradas al Game Log de D&D Beyond» (pestaña Mesa, se guarda en el navegador). Solo aparece con Link conectado y un personaje tuyo vinculado a DDB.
- Solo se reenvían tus tiradas públicas hechas como ese personaje (`gameLogRoll`): nunca las secretas, a ciegas, susurradas ni las que ya vienen de DDB (Beyond20). Las tarjetas de ataque/daño no se reenvían.
- El background abre un WebSocket a `wss://game-log-api-live.dndbeyond.com/v1?gameId=…&userId=…&stt=<token>` con tu sesión (gameId = campaña del personaje, userId = del token) y envía un `dice/roll/fulfilled`. Es el mismo canal que usa AboveVTT; no se inyecta nada en las páginas de DDB.
- Si DDB cambia el formato del Game Log, puede dejar de funcionar sin aviso (el mensaje se arma en `packages/ddb/src/gamelog.ts`; `node apps/link/build.mjs` regenera `gamelog.js`).
- Va contra los términos de servicio de D&D Beyond: úsalo bajo tu propia responsabilidad.
