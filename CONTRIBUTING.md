# Contribuir a Lantern

¡Gracias por el interés! Errores, ideas, traducciones y PRs son bienvenidos. Sé amable: [Código de conducta](CODE_OF_CONDUCT.md).

## Entorno

Requiere Node 24 (ejecuta TypeScript directamente) y, para el asistente, Go (versión de `installer/go.mod`).

```sh
npm install
npm run server      # servidor en :8787
npm run web         # cliente (vite) con proxy al servidor
```

## Pruebas

```sh
npm test            # unitarias (packages, servidor, partes de la web)
npm run typecheck   # tsc
npm run e2e         # servidor + Vite + Chromium headless (LANTERN_BROWSER=ruta para elegir navegador)
(cd installer && go test ./...)   # asistente en Go
```

Antes de abrir un PR deben pasar `npm test`, `npm run typecheck` y `go test` si tocaste `installer/`. Si cambias `packages/ddb` o `packages/srd`, regenera la extensión: `node apps/link/build.mjs`.

## Estructura

- `apps/server`: servidor (WebSocket + HTTP + SQLite). `apps/web`: cliente. `apps/link`: extensión Lantern Link.
- `packages/*`: protocolo, motor de reglas, SRD, D&D Beyond.
- `installer/`: asistente TUI en Go. `tools/`: release, e2e, Laya, etc.

## Estilo

- TypeScript sin paso de build en servidor; sin dependencias nuevas salvo que sean imprescindibles.
- Textos de la interfaz en español e inglés (`apps/web/src/i18n.ts` y `lang/`); todo texto visible pasa por `t()`.
- Cambios pequeños y enfocados, con una prueba cuando haya lógica.
- Contenido de reglas: solo SRD 5.2.1 (CC-BY-4.0). No añadas texto de libros con copyright.

## Commits y PRs

- Mensajes en imperativo y concisos (`Arregla la visión con puertas cerradas`). Un tema por commit.
- Describe qué cambia y cómo lo probaste en el PR (hay plantilla).
- Si usaste IA generativa para escribir el cambio, dilo; se revisa igual que cualquier otro.
- Al contribuir aceptas que tu aporte se publique bajo [AGPL-3.0](LICENSE).

## Publicar una versión

Todo se compila desde un Linux x64 (sin runners de otras plataformas). Lo normal es subir un tag y dejar que GitHub Actions (`.github/workflows/release.yml`) compile, adjunte los binarios a la release y publique la imagen `ghcr.io/lanterndevv/lantern`:

```sh
git tag v1.2.0 && git push origin v1.2.0
```

En local: `npm run release -- v1.2.0` deja en `dist-release/v1.2.0/`:

- `lantern-server-<os>-<arch>` y `lantern-installer-<os>-<arch>` (linux x64/arm64, macOS x64/arm64, windows x64; `.exe` en Windows),
- `lantern-link-<versión>.zip` (la extensión),
- `install.sh`, `install.ps1` y `SHA256SUMS`.

Los Node oficiales se descargan verificados a `~/.cache/lantern-release`. Para otra forja (Forgejo/Codeberg o GitLab) están `--releases-url`/`--image` y `tools/release/publish.mjs` (`FORGE=forgejo|gitlab`).

- macOS: firma ad hoc con `rcodesign`; sin Developer ID, Gatekeeper avisa (clic derecho > Abrir, o `xattr -d com.apple.quarantine <archivo>`).
- Windows: el `.exe` no lleva firma Authenticode; SmartScreen avisa la primera vez.

Los scripts `install.sh`/`install.ps1` se sirven desde `raw.githubusercontent.com` (rama `master`) y descargan `releases/latest`. `LANTERN_VERSION=vX.Y.Z` fija versión y `LANTERN_RELEASES_BASE` (solo pruebas) apunta a otro servidor.
