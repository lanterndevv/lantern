// Contrato entre el shell (main.ts/ui) y el renderer Pixi. Lo implementa ./table.ts.
import type { ClientState, Drawing, Id, Point, Role } from '@lantern/protocol';

export type TableOptions = {
  role: Role;
  memberId: Id;
  onMoveToken(id: Id, x: number, y: number): void; // al soltar un token arrastrado
  onPing(x: number, y: number): void;               // Alt+clic
  onDoor(id: Id, open: boolean): void;              // clic en una puerta
  onTokenClick?(id: Id, shift: boolean): void;      // clic sin arrastre sobre un token (elegir objetivo, seleccionar)
  onMapClick?(x: number, y: number): void;          // clic en el suelo (colocar monstruo, centro de plantilla); coords de mundo
  onPointer?(x: number, y: number): void;           // movimiento del puntero en coords de mundo (para plantillas que siguen al cursor)
  onDraw?(d: Drawing, persist: boolean): void;     // al soltar un trazo de la herramienta 'draw' (cualquier rol). Con persist=false, el shell lo difunde y vuelve por drawEphemeral
  onErase?(id: Id): void;                           // clic con la herramienta 'erase' sobre un dibujo
  onTokenContext?(id: Id, clientX: number, clientY: number): void; // clic derecho o pulsación larga (táctil, 500 ms) sobre un token: menú radial
};

// Marcas visuales que el shell controla (fase de combate).
export type Marks = {
  active?: Id;                 // token cuyo turno es: halo ámbar pulsante
  selected?: Id;               // token seleccionado por el usuario
  targets: Id[];               // objetivos marcados: retícula
  area?: { x: number; y: number; radius: number; color: string }; // plantilla esférica en px de mundo
  // plantilla con forma; dir = VECTOR de dirección (no hace falta normalizar). sizePx: radio (sphere), lado (cube), largo (cone, line).
  // cone = 53°; line = ancho grid.size; cube sale de origin hacia dir. Se anima suavemente entre llamadas.
  template?: { shape: 'sphere' | 'cube' | 'cone' | 'line'; origin: Point; dir: Point; sizePx: number; color: string };
};

export type Table = {
  setState(s: ClientState): void;                   // idempotente; se llama con cada estado del servidor
  setMarks(m: Marks): void;                         // idempotente
  ping(x: number, y: number, color: string): void;
  floatText(tokenId: Id, text: string, color: string): void; // número flotante (daño/curación) sobre un token
  effect(e: import("./api.ts").Effect): void;       // VFX puntual; el clima sale de scene.weather en setState
  setTool(t: import("./api.ts").EditTool): void;    // fase 5: herramientas de edición (DM); 'draw' y 'erase' valen para todos
  focus(x: number, y: number, zoom?: number): void; // fase 6: mueve la cámara con suavidad (instantáneo con movimiento reducido)
  fitScene(): void;                                  // encuadra la escena entera
  setDisplay(mode: 'normal' | 'fixed'): void;        // fixed: sin pan/zoom del usuario (mesa física, streaming); la cámara la mueve focus/fitScene
  worldToClient(x: number, y: number): { x: number; y: number }; // para anclar menús HTML a un token
  onEdit(cb: (op: import("./api.ts").EditOp) => void): void;
  setLevel(id: string | undefined, o?: { ghostBelow?: boolean }): void; // planta visible (undefined = base); ghostBelow: la inferior, tenue
  drawEphemeral(d: Drawing): void;                  // trazo que se desvanece a los 5 s
  showGhost(tokenId: Id, path: Point[]): void;      // ruta fantasma de otro jugador (se desvanece); hoy nadie la llama en tiempo real
  setCursors(list: { id: Id; name: string; color: string; x: number; y: number }[]): void; // cursores remotos; lista completa cada vez
  destroy(): void;
};

export type CreateTable = (el: HTMLElement, opts: TableOptions) => Promise<Table>;

// Efecto visual puntual en el mapa (lo dispara el shell al llegar una tarjeta aplicada, etc.).
export type Effect =
  | { kind: 'projectile'; from: { x: number; y: number }; to: { x: number; y: number }; damageType?: string }
  | { kind: 'impact'; at: { x: number; y: number }; damageType?: string; crit?: boolean }
  | { kind: 'burst'; at: { x: number; y: number }; radius: number; damageType?: string } // área (bola de fuego…)
  | { kind: 'heal'; at: { x: number; y: number } }
  | { kind: 'miss'; at: { x: number; y: number } };

export type TableFx = { effect(e: Effect): void }; // Table también implementa esto (table.effect)

// ---- Edición (fase 5): el renderer dibuja la capa de edición y emite operaciones; el shell las envía al servidor ----
export type EditTool =
  | { tool: 'none' }
  | { tool: 'select' }                                    // clic elige muro/luz/región/token; Supr borra; arrastrar vértices
  | { tool: 'wall'; kind: 'wall' | 'door' | 'window' | 'terrain' } // clics encadenados, imán a esquinas de casilla; doble clic/Esc termina
  | { tool: 'light'; bright: number; dim: number; color: string }  // clic coloca; arrastrar fija el radio
  | { tool: 'region'; kind: import('@lantern/protocol').Region['kind'] } // clics = polígono; doble clic cierra
  | { tool: 'grid' }
  | { tool: 'draw'; color: string; width: number; persist: boolean } // TODOS los roles: arrastrar dibuja; al soltar -> onDraw
  | { tool: 'erase' };                                    // TODOS los roles: clic sobre un dibujo -> onErase                                      // calibrar: arrastrar un recuadro sobre 2×2 casillas del dibujo

export type EditOp =
  | { op: 'upsert'; kind: 'wall'; item: import('@lantern/protocol').Wall }
  | { op: 'upsert'; kind: 'light'; item: import('@lantern/protocol').Light }
  | { op: 'upsert'; kind: 'region'; item: import('@lantern/protocol').Region }
  | { op: 'remove'; kind: 'wall' | 'light' | 'region' | 'token'; id: string }
  | { op: 'select'; kind: 'wall' | 'light' | 'region' | 'token' | null; id?: string } // para el inspector del shell
  | { op: 'grid'; size: number; offsetX: number; offsetY: number };

export type TableEdit = { setTool(t: EditTool): void; onEdit(cb: (op: EditOp) => void): void };
