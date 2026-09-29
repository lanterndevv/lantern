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
  destroy(): void;
};

export type CreateTable = (el: HTMLElement, opts: TableOptions) => Promise<Table>;
