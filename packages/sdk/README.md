# @lantern/sdk

Cliente para autores de extensiones de Lantern (estilo Owlbear Rodeo). Una extensión es una página web
que la mesa carga en un `<iframe sandbox="allow-scripts allow-forms">` y que habla con ella por `postMessage`.

```ts
import { connect } from '@lantern/sdk';
const lantern = await connect({ apiVersion: 1 });
await lantern.contextMenu.add({ id: 'botin', label: 'Registrar botín' });
lantern.contextMenu.onClick((tokenId, itemId) => lantern.chat.send(`Clic en ${tokenId}`));
```

Sin build: copia `src/index.ts` quitando los tipos (ver `apps/ext-example/sdk.js`).

## API (todas devuelven Promise salvo `onChange`/`onClick`, que devuelven la función para darse de baja)
| Llamada | Permiso | Qué hace |
|---|---|---|
| `state.get()` / `state.onChange(cb)` | `state` | `PublicState`: escena, tokens visibles (id, nombre, x, y, facción, PG si el miembro los ve), `round`, `turnTokenId`. Nunca más de lo que recibe el cliente del miembro. |
| `chat.send(text)` | `chat` | Mensaje de chat como el miembro (máx. 500). |
| `roll(expr, { secret? })` | `roll` | Tirada como el miembro. |
| `contextMenu.add({ id, label })` / `onClick(cb(tokenId, itemId))` | `contextMenu` | Entrada en el menú radial del token (máx. 10). |
| `panel.setHeight(px)` | `panel` | Altura del panel de la extensión (40–800). |
| `tokens.move(id, x, y)` | `tokens` | Mueve un token; el servidor valida que el miembro pueda. |

## Protocolo
Petición: `{ lantern: 'sdk', v: 1, id, method, params }`. Respuesta: `{ lantern: 'sdk', v: 1, re: id, ok }` o `{ ..., re: id, error }`.
Eventos del host: `{ lantern: 'sdk', v: 1, event: 'state' | 'contextMenu', data }`.
Primer mensaje obligatorio: `hello { apiVersion }` → `{ apiVersion, permissions }`.

## Modelo de seguridad
- Iframe sin `allow-same-origin`: origen opaco, sin acceso a cookies, storage, DOM ni key de la mesa.
- El host solo atiende mensajes cuyo `event.source` es el `contentWindow` del iframe de esa extensión, y responde con `targetOrigin '*'` (el origen es `null`); nunca envía key ni memberIds.
- Cada método exige su permiso del manifiesto; sin permiso, error. Los parámetros se validan (tipos y longitudes).
- Máx. 20 llamadas/s por extensión.
- Las acciones salen como el propio miembro: el servidor aplica sus permisos normales (una extensión de un jugador no puede hacer de DM).
- Solo el DM instala, viendo la lista de permisos. URLs: https, o http://localhost.

## Versionado
`apiVersion` es un entero. El host actual acepta solo la `1`; otra versión falla en el handshake con error. Los cambios compatibles no suben versión; uno que rompa sube a 2 y el host podrá aceptar varias.

## Requisito de alojamiento: CORS

El iframe de una extensión se crea con `sandbox="allow-scripts allow-forms"` **sin** `allow-same-origin`, así que su origen es opaco (`null`).
Los `<script type="module">` (y cualquier `fetch` a tu propio servidor) se piden en modo CORS: el servidor que aloja la extensión
**debe responder con `Access-Control-Allow-Origin: *`** (o `null`). Sin esa cabecera el navegador bloquea tus scripts y la extensión
no llega a hacer el handshake. Con Vite: `server: { cors: { origin: '*' } }` (ver `apps/ext-example/vite.config.js`).
