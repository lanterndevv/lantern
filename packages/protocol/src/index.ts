// Contrato compartido cliente ↔ servidor. Todo en píxeles de mapa salvo que se diga.

export type Id = string;
export type Point = { x: number; y: number };

export type Role = 'dm' | 'assistant' | 'trusted' | 'player' | 'spectator';
export type Faction = 'ally' | 'enemy' | 'neutral';

// wall: bloquea vista y paso · door: igual salvo abierta · window: deja ver, no pasar · terrain: deja ver, no pasar
export type WallKind = 'wall' | 'door' | 'window' | 'terrain';
export type Wall = { id: Id; a: Point; b: Point; kind: WallKind; open?: boolean; secret?: boolean };

export type Light = {
  id: Id; x: number; y: number;
  bright: number; dim: number; // radios en px
  color: string;               // '#ffb85c'
  anim?: 'none' | 'torch' | 'pulse';
};

export type Hp = { cur: number; max: number; temp: number };

export type Token = {
  id: Id; name: string;
  x: number; y: number;        // centro, px
  size: number;                // casillas por lado (1 = mediano, 2 = grande…)
  faction: Faction;
  img?: string;
  hidden: boolean;             // oculto por el DM
  owners: Id[];                // memberIds que lo controlan
  darkvision: number;          // px; 0 = sin visión en la oscuridad
  hp?: Hp;
  ac?: number;
  conditions: string[];        // ids de condición de @lantern/rules
};

export type Grid = { size: number; offsetX: number; offsetY: number; feet: number };

export type Scene = {
  id: Id; name: string;
  width: number; height: number;
  background?: string;         // URL de imagen
  grid: Grid;
  walls: Wall[];
  lights: Light[];
  tokens: Token[];
  globalLight: number;         // 0 = oscuridad total, 1 = pleno día
};

export type Member = { id: Id; name: string; role: Role; online: boolean };

// Lo que recibe cada cliente: ya filtrado por el servidor según su rol y visión.
export type ClientState = {
  code: string;
  members: Member[];
  scene: Scene;
  visible?: Point[][];         // polígonos de visión del grupo (ausente para DM)
};

export type ChatMsg = {
  id: Id; from: Id; at: number;
  text?: string;
  roll?: { expr: string; total: number; detail: string; secret: boolean };
};

// Cliente → servidor
export type C2S =
  // sin code → crea mesa nueva y quien la crea es DM. key = secreto devuelto en welcome, para reconectar.
  | { t: 'join'; code?: string; name: string; key?: string }
  | { t: 'moveToken'; id: Id; x: number; y: number }
  | { t: 'upsert'; kind: 'token'; item: Token }
  | { t: 'upsert'; kind: 'wall'; item: Wall }
  | { t: 'upsert'; kind: 'light'; item: Light }
  | { t: 'remove'; kind: 'token' | 'wall' | 'light'; id: Id }
  | { t: 'door'; id: Id; open: boolean }
  | { t: 'chat'; text: string }
  | { t: 'roll'; expr: string; secret?: boolean }
  | { t: 'ping'; x: number; y: number };

// Servidor → cliente
export type S2C =
  | { t: 'welcome'; memberId: Id; key: string; role: Role; state: ClientState; chat: ChatMsg[] }
  | { t: 'state'; state: ClientState }   // ponytail: estado completo filtrado en cada cambio; diffs cuando pese
  | { t: 'chat'; msg: ChatMsg }
  | { t: 'ping'; from: Id; x: number; y: number }
  | { t: 'error'; msg: string };

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L

export const blocksSight = (w: Wall) =>
  (w.kind === 'wall' || (w.kind === 'door' && !w.open));

export const blocksMove = (w: Wall) =>
  w.kind !== 'door' || !w.open;
