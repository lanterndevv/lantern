// Contrato entre el shell (main.ts/ui) y el renderer Pixi. Lo implementa ./table.ts.
import type { ClientState, Id, Role } from '@lantern/protocol';

export type TableOptions = {
  role: Role;
  memberId: Id;
  onMoveToken(id: Id, x: number, y: number): void; // al soltar un token arrastrado
  onPing(x: number, y: number): void;               // Alt+clic
  onDoor(id: Id, open: boolean): void;              // clic en una puerta
};

export type Table = {
  setState(s: ClientState): void;                   // idempotente; se llama con cada estado del servidor
  ping(x: number, y: number, color: string): void;
  destroy(): void;
};

export type CreateTable = (el: HTMLElement, opts: TableOptions) => Promise<Table>;
