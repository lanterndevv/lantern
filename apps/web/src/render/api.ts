// Contrato entre el shell (main.ts/ui) y el renderer Pixi. Lo implementa ./table.ts.
import type { ClientState, Id, Role } from '@lantern/protocol';

export type TableOptions = {
  role: Role;
  memberId: Id;
  onMoveToken(id: Id, x: number, y: number): void; // al soltar un token arrastrado
  onPing(x: number, y: number): void;               // Alt+clic
  onDoor(id: Id, open: boolean): void;              // clic en una puerta
  onTokenClick?(id: Id, shift: boolean): void;      // clic sin arrastre sobre un token (elegir objetivo, seleccionar)
  onMapClick?(x: number, y: number): void;          // clic en el suelo (colocar monstruo, centro de plantilla); coords de mundo
  onPointer?(x: number, y: number): void;           // movimiento del puntero en coords de mundo (para plantillas que siguen al cursor)
};

// Marcas visuales que el shell controla (fase de combate).
export type Marks = {
  active?: Id;                 // token cuyo turno es: halo ámbar pulsante
  selected?: Id;               // token seleccionado por el usuario
  targets: Id[];               // objetivos marcados: retícula
  area?: { x: number; y: number; radius: number; color: string }; // plantilla esférica en px de mundo
};

export type Table = {
  setState(s: ClientState): void;                   // idempotente; se llama con cada estado del servidor
  setMarks(m: Marks): void;                         // idempotente
  ping(x: number, y: number, color: string): void;
  floatText(tokenId: Id, text: string, color: string): void; // número flotante (daño/curación) sobre un token
  effect(e: import("./api.ts").Effect): void;       // VFX puntual; el clima sale de scene.weather en setState
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
