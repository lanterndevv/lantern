# Beyond20 → Lantern

Las tiradas que haces en tu hoja de D&D Beyond con la extensión [Beyond20](https://beyond20.here-for-more.info) aparecen en la mesa de Lantern.

## Activarlo (jugador)
1. Ten Beyond20 instalado y funcionando en tu hoja de D&D Beyond.
2. Abre las opciones de Beyond20 y marca «Show advanced options».
3. En **List of custom domains to load Beyond20 into** añade, una por línea y con protocolo, la URL de Lantern con comodín, p. ej. `https://lantern.ejemplo.es/*` (o `http://localhost:5173/*` en local).
4. Acepta el permiso de acceso al sitio que pide el navegador.
5. Recarga la mesa de Lantern y la hoja de D&D Beyond. Deja las dos pestañas abiertas.

Beyond20 reenvía cada tirada a las pestañas registradas; no hay que «anunciar» nada desde Lantern (al cargar en un dominio custom, Beyond20 emite él mismo `Beyond20_Loaded`).

## Qué se ve
- Cada tirada llega como tirada marcada **externa** (`externalRoll`, `source: 'beyond20'`), con nombre, fórmula, total y dados.
- Un ataque con daño produce dos tiradas: ataque y daño (suma de los daños normales; los condicionales y los avisos de texto se ignoran).
- Con ventaja/desventaja se ven los dos d20, el descartado como no conservado.
- Tipos: ataque, conjuro, salvación, habilidad, característica, iniciativa, custom, etc. (`kind` = el `type` de Beyond20; el daño es `damage`).

## Límites
- El servidor **no puede verificar** el resultado: lo tira el cliente (Beyond20/D&D Beyond). Es una tirada de confianza.
- Las tiradas en secreto de Beyond20 (whisper «sí» o «ocultar nombres») **no se envían**: `externalRoll` no tiene destinatario.
- Solo se leen `rendered-roll`; HP, condiciones y combate de Beyond20 no se usan.
- Beyond20 solo reenvía si tu navegador tiene ambas pestañas abiertas y tiene permiso para el dominio de Lantern.
- El Game Log de D&D Beyond no recibe las tiradas de Lantern (ver más abajo).

## Relé al Game Log de DDB: no implementado
AboveVTT no publica por una API HTTP: coge el objeto message broker propio de la página de DDB (`window[key]`, `DiceRoller.js` líneas ~640-647) y envuelve su `dispatch`, sobre el websocket `game-log-api-live` que abre DDB. Eso exige inyectar código en la página de DDB y suplantar el formato interno (`userId`, `setId`, `entityId`, `dice/roll/fulfilled`). Desde el background de Lantern Link (fetch con el token `cobalt-token`) no hay un endpoint público documentado de escritura, y sería frágil (formato interno sin contrato) y a un paso de suplantar. Se deja fuera.
