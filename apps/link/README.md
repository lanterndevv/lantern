# Lantern Link

Extensión MV3 (Chrome y Firefox) que importa tus personajes de D&D Beyond a Lantern.
Sin build de la extensión; solo hay que regenerar `ddb.js`/`srd.js` si cambia `packages/ddb` o `packages/srd`:

    node apps/link/build.mjs

## Cargarla sin empaquetar
- **Chrome/Chromium:** `chrome://extensions` → Modo desarrollador → «Cargar descomprimida» → carpeta `apps/link`.
- **Firefox (128+):** `about:debugging#/runtime/this-firefox` → «Cargar complemento temporal» → `apps/link/manifest.json`.

## Qué toca
- Usa solo tu sesión en dndbeyond.com: pide un token Bearer de corta duración y lee `character-service` del personaje que pides.
- El token nunca sale de la extensión (ni a la página ni al servidor de Lantern).
- A la página solo le entrega estadísticas de juego (`ImportedCharacter`): nada de texto de reglas ni descripciones.
- El content script solo actúa en páginas con `<meta name="lantern" content="1">`.
