# Botín aleatorio (extensión de ejemplo)

Añade «Registrar botín» al menú radial de cada token; tira en una tabla y publica en el chat
«El Trasgo A llevaba: 12 po y una daga oxidada».

`sdk.js` es una copia sin tipos de `packages/sdk/src/index.ts` (esta extensión no tiene build). Actualízala si cambia el SDK.

## Servir
    cd apps/ext-example && npx vite --port 5174   # usa vite.config.js (CORS, necesario para el iframe sandbox)
(o cualquier servidor estático en el puerto 5174; debe servir `manifest.json` con CORS abierto si la mesa está en otro origen: vite lo hace por defecto en dev).

## Instalar
1. Entra como DM en la mesa y abre el instalador (`openInstaller`).
2. Pega `http://localhost:5174/manifest.json`, revisa los permisos (chat, contextMenu, state) y pulsa «Instalar».
3. Clic derecho / pulsación larga sobre un token → «Registrar botín».
