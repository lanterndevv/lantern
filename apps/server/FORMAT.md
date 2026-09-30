# Formato de campaña de Lantern (`lantern-campaign`, versión 1)

Formato abierto: un único archivo JSON (UTF-8) para que una campaña sobreviva al proyecto.
Los tipos exactos están en `packages/protocol/src/index.ts` (`Scene`, `Token`, `Wall`, `Light`, `Region`, `JournalEntry`, `Encounter`, `TableSettings`).

```jsonc
{
  "format": "lantern-campaign",
  "version": 1,
  "exportedAt": "2026-01-31T12:00:00.000Z",   // ISO 8601
  "scenes": [ /* Scene[] (la biblioteca) */ ],
  "activeId": "id-de-una-escena",             // la escena activa; si no existe, la primera
  "journal": [ /* JournalEntry[] */ ],
  "encounters": [ /* Encounter[] (opcional) */ ],
  "settings": { /* TableSettings: mode, layers, edition, optional */ },
  "assets": { "<sha256>.<ext>": "<base64>" }   // todos los /assets/… referenciados
}
```

## Reglas
- Unidades: píxeles del mapa; `grid.size` px por casilla, `grid.feet` pies por casilla.
- **Recursos**: en `scenes` y `journal` las imágenes y audios se referencian como `/assets/<sha256>.<ext>` (`png jpg webp mp3 ogg webm mp4`).
  El nombre es el SHA-256 (hex) del contenido; `assets` trae esos archivos en base64. También valen URL `https://…`.
- **Escena**: `id`, `name` (≤60), `width`/`height` (100–20000), `grid`, `walls`, `lights`, `tokens`, `globalLight` (0–1); opcionales
  `background`, `weather`, `story`, `regions`, `folder` (≤40), `audioPreset` (`AudioState`), `dmNotes` (≤5000).
- **Diario**: `visibleTo` es `"dm"`, `"all"` o una lista de ids de miembro. Al importar, las listas pasan a `"dm"` (los miembros no viajan).
- **Encuentros** (opcional; los archivos anteriores no lo traen): `id`, `name` (≤60) y `monsters` (1–20 filas `{ srd, n }`, `srd` = id de un monstruo del SRD de Lantern, `n` de 1 a 30, sin repetir `srd`). Máximo 100.
- Al importar, `owners` de los tokens se vacía (los jugadores de la mesa original no existen en la nueva).
- Los campos desconocidos se ignoran; una escena inválida rechaza todo el archivo.

## HTTP (cabeceras `x-lantern-code` y `x-lantern-key` de un DM)
- `GET /api/export` → el JSON anterior (413 si supera 200 MB de base64).
- `POST /api/import` (≤250 MB) → crea una mesa NUEVA con el importador como DM y responde `{ code, key }`.
  Valida cada escena como los mensajes del protocolo y guarda los recursos comprobando que el SHA-256 coincide con el nombre y que la extensión es admitida.
- `POST /api/uvtt` (≤60 MB de JSON) → importa un mapa Universal VTT (`.dd2vtt`/`.uvtt`) como escena NUEVA de la biblioteca (sin activarla) y responde `{ sceneId }`.
  Muros de `line_of_sight`/`objects_line_of_sight`, puertas de `portals` (`closed`), luces de `lights` (`range` = radio tenue, brillante = mitad, color ARGB → `#rrggbb`); coordenadas en casillas × `pixels_per_grid`.
