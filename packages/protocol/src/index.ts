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

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

// Una acción que el token sabe hacer. Rangos en pies.
export type Action = {
  id: Id; name: string;
  cost: 'action' | 'bonus' | 'reaction';
  kind: 'attack' | 'save' | 'heal';
  range: number;                       // 5 = cuerpo a cuerpo
  toHit?: number;                      // kind attack
  save?: { ability: Ability; dc: number; half: boolean }; // kind save
  damage?: string;                     // expresión de dados, p. ej. '2d8' o '1d8+4'
  damageType?: string;                 // 'fire', 'cold', 'slashing'… (ids en inglés, como rules)
  area?: { shape: 'sphere' | 'cone' | 'line' | 'cube'; size: number }; // pies (radio o lado/largo)
  slot?: number;                       // nivel de espacio de conjuro que gasta (0/ausente = no gasta)
};

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
  speed?: number;              // pies
  initMod?: number;
  saves?: Partial<Record<Ability, number>>;
  defenses?: { resist?: string[]; immune?: string[]; vuln?: string[] };
  actions?: Action[];
  slots?: Record<number, { max: number; used: number }>; // espacios de conjuro por nivel
  srd?: string;                // id de la entrada del compendio SRD de la que sale
  ddb?: { id: number; level: number; classes: string; syncedAt: number }; // vinculado a un personaje de D&D Beyond
  abilities?: Record<Ability, number>;        // puntuaciones (no modificadores)
  skills?: Record<string, number>;            // modificador total por habilidad (ids en inglés: 'perception', 'stealth'…)
  prof?: number;                              // bonificador de competencia
  condRounds?: Record<string, number>;        // rondas restantes por condición (ausente = indefinida)
  exhaustion?: number;                        // nivel de agotamiento 0–6
  concentration?: string;                     // nombre del conjuro que mantiene
  deathSaves?: { successes: number; failures: number };
};

// Ajustes de la mesa (los fija el DM).
export type TableSettings = {
  mode: 'simple' | 'full';                    // Sencillo: mapa, tokens, dados, chat. Completo: todas las capas activas.
  layers: { lighting: boolean; initiative: boolean; automation: boolean; effects: boolean; story: boolean };
  edition: '2014' | '2024';
  optional: { flanking: boolean; heroPoints: boolean; brutalCrit: boolean; fumbles: boolean; sideInit: boolean };
};

export const DEFAULT_SETTINGS: TableSettings = {
  mode: 'full',
  layers: { lighting: true, initiative: true, automation: true, effects: true, story: true },
  edition: '2024',
  optional: { flanking: false, heroPoints: false, brutalCrit: false, fumbles: false, sideInit: false },
};

// Lo que el puente (extensión Lantern Link) extrae de un personaje de D&D Beyond.
// Solo estadísticas de juego del propio usuario; nunca texto de reglas ni el token de sesión.
export type ImportedCharacter = Pick<Token, 'name' | 'hp' | 'ac' | 'speed' | 'initMod' | 'saves' | 'darkvision' | 'actions' | 'slots' | 'defenses' | 'abilities' | 'skills' | 'prof'> & {
  ddbId: number; level: number; classes: string; avatar?: string;
};

// Estado de combate de la mesa.
export type Combat = {
  round: number;
  turn: number;                                 // índice en order
  order: { tokenId: Id; init: number }[];       // ya ordenado de mayor a menor
  used: Record<Id, { action: boolean; bonus: boolean; reaction: boolean; moved: number }>; // moved en pies
};

// Resultado de una acción, para las tarjetas del registro.
export type ActionCard = {
  actorId: Id; actorName: string; actionName: string;
  kind: Action['kind'];
  damageType?: string;
  targets: {
    id: Id; name: string;
    attack?: { d20: number; total: number; mode: 'adv' | 'dis' | 'normal'; hit: boolean; crit: boolean };
    save?: { total: number; success: boolean; ability: Ability; dc: number };
    cover?: 0 | 2 | 5;           // cobertura por muros: ½ = +2, ¾ = +5 a CA y salvaciones de DES
    amount?: number;             // daño (o curación) que corresponde a este objetivo
  }[];
  detail?: string;               // texto de las tiradas de daño
  dice?: Die[];                  // todos los dados tirados (d20 de ataque/salvación + daño), para la animación 3D
  pending?: Id;                  // si está esperando confirmación del DM (automatización «asistida»)
  applied: boolean;
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
  weather?: Weather;
  story?: { image?: string; title?: string; subtitle?: string }; // ilustración del modo Historia
};

export type Weather = { kind: 'none' | 'rain' | 'snow' | 'fog' | 'ash' | 'storm' | 'leaves' | 'embers'; intensity: number; wind: number }; // intensity 0–1, wind −1…1

// Audio compartido: el servidor marca los tiempos con su reloj; cada cliente calcula dónde va la pista.
export type AudioState = {
  track?: { url: string; name: string; startedAt: number; pausedAt?: number; loop: boolean }; // ms del servidor
  layers: { id: Id; url: string; name: string; volume: number; x?: number; y?: number; radius?: number }[]; // ambiente; con x/y = posicional en el mapa
};

// Un dado individual de una tirada (para animarlo en 3D en todos los clientes).
export type Die = { sides: number; value: number; kept: boolean };

// Sets de dados disponibles; el aspecto visual vive en apps/web/src/dice/themes.ts.
export const DICE_THEMES = ['linterna', 'obsidiana', 'hueso', 'escarcha', 'bronce', 'esmeralda', 'arcano', 'dragon'] as const;
export type DiceTheme = typeof DICE_THEMES[number];

export type Member = { id: Id; name: string; role: Role; online: boolean; dice: DiceTheme };

// Lo que recibe cada cliente: ya filtrado por el servidor según su rol y visión.
export type ClientState = {
  code: string;
  members: Member[];
  scene: Scene;
  visible?: Point[][];         // polígonos de visión del grupo (ausente para DM)
  combat?: Combat;             // filtrado: sin tokens que el miembro no pueda ver
  automation: 'assisted' | 'auto';
  settings: TableSettings;
  view: 'tactical' | 'story';
  audio: AudioState;
};

export type ChatMsg = {
  id: Id; from: Id; at: number;
  text?: string;
  roll?: { expr: string; total: number; detail: string; secret: boolean; dice?: Die[] };
  card?: ActionCard;
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
  | { t: 'ping'; x: number; y: number }
  | { t: 'claim'; tokenId: Id }                                      // jugador elige un aliado sin dueño
  | { t: 'combat'; op: 'start' | 'next' | 'prev' | 'end' }           // DM
  | { t: 'act'; tokenId: Id; actionId: Id; targets: Id[] }           // resolver una acción
  | { t: 'confirm'; pending: Id; mode: 'full' | 'half' | 'none' }     // DM confirma daño pendiente
  | { t: 'spawn'; srd: string; x: number; y: number; hidden?: boolean } // DM añade monstruo del SRD
  | { t: 'automation'; value: 'assisted' | 'auto' }                   // DM
  | { t: 'diceTheme'; theme: DiceTheme }                              // cada miembro elige su set
  | { t: 'importCharacter'; tokenId: Id; data: ImportedCharacter }   // dueño del token (o DM): aplica un personaje de DDB
  | { t: 'settings'; patch: Partial<Omit<TableSettings, 'layers' | 'optional'>> & { layers?: Partial<TableSettings['layers']>; optional?: Partial<TableSettings['optional']> } } // DM
  | { t: 'setRole'; memberId: Id; role: Role }                        // DM
  | { t: 'condition'; tokenId: Id; condition: string; on: boolean; rounds?: number } // DM, o dueño sobre su token
  | { t: 'hp'; tokenId: Id; delta: number; kind: 'damage' | 'heal' | 'temp'; damageType?: string } // DM, o dueño sobre su token
  | { t: 'concentration'; tokenId: Id; spell: string | null }        // dueño o DM
  | { t: 'deathSave'; tokenId: Id }                                   // dueño en su turno (o DM)
  | { t: 'check'; tokenId: Id; kind: 'save' | 'skill' | 'ability'; key: string; secret?: boolean } // tirada desde la hoja: el servidor aplica mods, agotamiento y condiciones
  | { t: 'scene'; patch: Partial<Pick<Scene, 'name' | 'background' | 'globalLight' | 'weather' | 'story' | 'grid' | 'width' | 'height'>> } // DM
  | { t: 'view'; value: 'tactical' | 'story' }                         // DM: cambia la vista de todos
  | { t: 'npcSay'; name: string; text: string; portrait?: string }     // DM: un PNJ habla (modo Historia o encima del mapa)
  | { t: 'transition'; title: string; subtitle?: string }              // DM: tarjeta de título para todos
  | { t: 'audio'; op: 'play'; url: string; name: string; loop?: boolean }  // DM (y trusted)
  | { t: 'audio'; op: 'pause' | 'resume' | 'stop' }
  | { t: 'audio'; op: 'layer'; layer: AudioState['layers'][number] }  // añade/actualiza capa de ambiente
  | { t: 'audio'; op: 'unlayer'; id: Id }
  | { t: 'sfx'; name: string }                                         // DM/trusted: efecto puntual (nombre de efecto sintetizado)
  | { t: 'rtc'; to: Id; data: unknown };                              // señalización WebRTC de voz, se reenvía tal cual al destinatario

// Servidor → cliente
export type S2C =
  | { t: 'welcome'; memberId: Id; key: string; role: Role; state: ClientState; chat: ChatMsg[] }
  | { t: 'state'; state: ClientState }   // ponytail: estado completo filtrado en cada cambio; diffs cuando pese
  | { t: 'chat'; msg: ChatMsg }
  | { t: 'ping'; from: Id; x: number; y: number }
  | { t: 'npcSay'; name: string; text: string; portrait?: string }
  | { t: 'transition'; title: string; subtitle?: string }
  | { t: 'sfx'; name: string }
  | { t: 'rtc'; from: Id; data: unknown }
  | { t: 'clock'; now: number }                                        // reloj del servidor (ms) para sincronizar audio; se envía tras welcome
  | { t: 'error'; msg: string };

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L

export const blocksSight = (w: Wall) =>
  (w.kind === 'wall' || (w.kind === 'door' && !w.open));

export const blocksMove = (w: Wall) =>
  w.kind !== 'door' || !w.open;
