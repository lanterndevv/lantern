# Lantern Link (extensión para D&D Beyond)

Lantern Link es una extensión de navegador (Chrome, Chromium y Firefox 128+) que importa **tus** personajes de D&D Beyond a la mesa de Lantern. Como DM también puede consultar estadísticas de los monstruos a los que tu cuenta tiene acceso.

## Instalarla

Todavía no está en las tiendas de Chrome ni de Firefox, así que se carga «descomprimida»:

1. Descarga `lantern-link-<versión>.zip` de la [última release](https://github.com/lanterndevv/lantern/releases/latest) y **descomprímelo** en una carpeta que no vayas a borrar.
2. **Chrome / Edge / Brave:** abre `chrome://extensions`, activa **Modo desarrollador** y pulsa **Cargar descomprimida**; elige la carpeta.
3. **Firefox:** abre `about:debugging#/runtime/this-firefox`, pulsa **Cargar complemento temporal** y elige `manifest.json` de la carpeta. (En Firefox, el complemento temporal se quita al cerrar el navegador.)
4. Inicia sesión en dndbeyond.com en el mismo navegador.
5. Abre tu mesa de Lantern. La primera vez, la extensión pregunta si ese sitio puede usar tu sesión de D&D Beyond: acepta solo si es tu servidor de Lantern.
6. Usa la opción de importar de D&D Beyond: Lantern detecta la extensión y muestra tus personajes.

Desde el código: `node apps/link/build.mjs` y carga la carpeta `apps/link`. Detalles técnicos: [apps/link/README.md](../apps/link/README.md).

## Privacidad

- Usa **solo tu propia sesión** de dndbeyond.com. Pide un token de corta duración y lee tus personajes.
- **El token nunca sale del navegador:** ni a la página de Lantern ni al servidor de Lantern.
- A la mesa solo llegan **estadísticas de juego** (`ImportedCharacter`), sin textos de reglas ni descripciones.
- Solo responde a los sitios que hayas autorizado (la pregunta del paso 5). Una página cualquiera no puede pedir tus personajes aunque imite a Lantern.
- Permisos: acceso a `dndbeyond.com` y a su servicio de Game Log, y `storage` para recordar los sitios autorizados.

## Relé al Game Log de D&D Beyond (opcional)

Desactivado por defecto; cada jugador lo activa con la casilla «Enviar mis tiradas al Game Log de D&D Beyond». Solo reenvía tus tiradas públicas hechas como ese personaje. **No se ha probado aún contra D&D Beyond real** y va contra sus términos de servicio: úsalo bajo tu responsabilidad. Detalles en el [README de la extensión](../apps/link/README.md).

## ¿Y Beyond20?

Si ya usas Beyond20, sus tiradas también aparecen en la mesa: [beyond20.md](beyond20.md).

Lantern no está afiliado a D&D Beyond ni a Wizards of the Coast.
