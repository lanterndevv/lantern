// Contrato compartido cliente ↔ servidor. Todo en píxeles de mapa salvo que se diga.

export type StoryLayer = { image: string; depth: number }; // parallax de Historia: de atrás adelante; depth 0 = fija, 1 = la que más se mueve (máx. 4)
export type Id = string;
export type Point = { x: number; y: number };

export type Role = 'dm' | 'assistant' | 'trusted' | 'player' | 'spectator';
export type Faction = 'ally' | 'enemy' | 'neutral';

// wall: bloquea vista y paso · door: igual salvo abierta · window: deja ver, no pasar · terrain: deja ver, no pasar
// invisible: bloquea vista, no paso · ethereal: bloquea paso, no vista
export type WallKind = 'wall' | 'door' | 'window' | 'terrain' | 'invisible' | 'ethereal';
export type Wall = { id: Id; a: Point; b: Point; kind: WallKind; open?: boolean; secret?: boolean; locked?: boolean; note?: string; level?: Id; oneWay?: 'left' | 'right'; lock?: { dc: number } }; // oneWay: bloquea la vista solo desde ese lado de a→b · note: solo DM · level: planta (ausente = planta base)

export type Light = {
  id: Id; x: number; y: number;
  bright: number; dim: number; // radios en px
  color: string;               // '#ffb85c'
  anim?: 'none' | 'torch' | 'pulse' | 'candle' | 'magic' | 'lightning';
  cone?: { dir: number; angle: number }; // luz en cono: dir y apertura total en grados (0 = +x, horario)
  level?: Id;
  burnUntil?: number;          // minuto del reloj del mundo en que se apaga (antorchas); ausente = permanente
  follow?: Id;                 // la luz sigue a este token (antorcha en mano)
};

export type Hp = { cur: number; max: number; temp: number };
export type MoveMode = 'walk' | 'fly' | 'swim' | 'climb';
// Efecto que se recuerda al empezar/acabar el turno del token: salvación repetida, daño continuo, regeneración, o fin de una condición.
export type TurnEffect = { id: Id; name: string; when: 'start' | 'end'; save?: { ability: Ability; dc: number }; damage?: string; damageType?: string; heal?: string; endsCondition?: string; sourceId?: string };

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
  area?: { shape: 'sphere' | 'cone' | 'line' | 'cube' | 'cylinder'; size: number }; // cylinder: en 2D es una esfera // pies (radio o lado/largo)
  slot?: number;                       // nivel de espacio de conjuro que gasta (0/ausente = no gasta)
  school?: string;                     // escuela del conjuro (para el rótulo)
  condition?: string;                  // condición que aplica a quien falla la salvación (ligada a la concentración del lanzador)
  multi?: { id: Id; n: number }[];     // Multiataque: encadena n veces cada acción (por id) con los mismos objetivos, gastando solo esta acción
};

export type Token = {
  id: Id; name: string;
  x: number; y: number;        // centro, px
  size: number;                // casillas por lado (1 = mediano, 2 = grande…)
  faction: Faction;
  img?: string;
  hidden: boolean;             // oculto por el DM
  shape?: 'round' | 'free';    // free: la imagen se dibuja sin máscara circular
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
  notes?: string;              // nota privada del DM (el servidor la quita para los demás)
  level?: Id;                  // planta en la que está (ausente = planta base)
  heroPoints?: number;         // regla opcional «puntos de héroe»
  elevation?: number;          // pies sobre el suelo (vuelo, balcón); cuenta en distancias
  carriedBy?: Id;              // montura/agarre: se mueve con este token
  legendary?: { max: number; used: number }; // acciones legendarias por ronda
  lair?: boolean;              // tiene acciones de guarida (turno en iniciativa 20)
  ddb?: { id: number; level: number; classes: string; syncedAt: number }; // vinculado a un personaje de D&D Beyond
  abilities?: Record<Ability, number>;        // puntuaciones (no modificadores)
  skills?: Record<string, number>;            // modificador total por habilidad (ids en inglés: 'perception', 'stealth'…)
  prof?: number;                              // bonificador de competencia
  condRounds?: Record<string, number>;        // rondas restantes por condición (ausente = indefinida)
  exhaustion?: number;                        // nivel de agotamiento 0–6
  concentration?: string;                     // nombre del conjuro que mantiene
  shielded?: boolean;                         // Escudo activo (+5 CA) hasta el inicio del siguiente turno del lanzador
  speeds?: Partial<Record<Exclude<MoveMode, 'walk'>, number>>; // velocidades de vuelo/nado/trepa (pies); ausente = no tiene
  initAdv?: boolean;                          // ventaja en iniciativa (Alerta…)
  effects?: TurnEffect[];                     // recordatorios de inicio/fin de turno
  condSource?: Record<string, string>;        // condición → sourceId del conjuro de concentración que la creó
  hpState?: 'ok' | 'hurt' | 'bloodied' | 'critical' | 'down'; // solo en lo que reciben los jugadores de un enemigo (hpView 'status')
  deathSaves?: { successes: number; failures: number };
  senses?: { darkvision?: number; blindsight?: number; truesight?: number; tremorsense?: number; devilsSight?: number }; // radios en px
  edition?: '2014' | '2024';                  // prevalece sobre la de la mesa
  hitDice?: { die: number; max: number; used: number };
  lucky?: boolean;                            // rasgo Suerte (mediano): repite un 1 natural
  inspiration?: boolean;                      // Inspiración heroica: permite repetir una tirada
  encounter?: string;                         // etiqueta de encuentro: una región 'encounter' con la misma etiqueta lo revela
  asi?: number;                               // mejoras de característica pendientes tras subir de nivel
};

// Ajustes de la mesa (los fija el DM).
export type TableSettings = {
  mode: 'simple' | 'full';                    // Sencillo: mapa, tokens, dados, chat. Completo: todas las capas activas.
  layers: { lighting: boolean; initiative: boolean; automation: boolean; effects: boolean; story: boolean };
  edition: '2014' | '2024';
  optional: { flanking: boolean; heroPoints: boolean; brutalCrit: boolean; fumbles: boolean; sideInit: boolean; playerInit?: boolean; groupInit?: boolean; playerSaves?: boolean; ghostRoutes?: boolean };
  hpView?: 'exact' | 'status' | 'none';       // PG de enemigos en el carrusel para los jugadores (por defecto none)
  diagonal?: 'chebyshev' | 'alt' | 'euclid';  // regla de diagonales (por defecto chebyshev 5-5-5)
  drawing?: 'dm' | 'all';                     // quién puede dibujar de forma persistente (por defecto solo el DM)
};

export const DEFAULT_SETTINGS: TableSettings = {
  mode: 'full',
  layers: { lighting: true, initiative: true, automation: true, effects: true, story: true },
  edition: '2024',
  optional: { flanking: false, heroPoints: false, brutalCrit: false, fumbles: false, sideInit: false },
};

// Lo que el puente (extensión Lantern Link) extrae de un personaje de D&D Beyond.
// Solo estadísticas de juego del propio usuario; nunca texto de reglas ni el token de sesión.
export type ImportedCharacter = Pick<Token, 'name' | 'hp' | 'ac' | 'speed' | 'initMod' | 'saves' | 'darkvision' | 'actions' | 'slots' | 'defenses' | 'abilities' | 'skills' | 'prof' | 'hitDice' | 'lucky'> & {
  ddbId: number; level: number; classes: string; avatar?: string;
};

// Estado de combate de la mesa.
export type Combat = {
  round: number;
  turn: number;                                 // índice en order
  order: { tokenId: Id; init: number }[];       // ya ordenado de mayor a menor
  used: Record<Id, { action: boolean; bonus: boolean; reaction: boolean; moved: number; object?: boolean; dash?: number; dodge?: boolean; disengage?: boolean; helped?: Id }>; // moved en pies · dash: velocidad extra por Correr · helped: enemigo contra el que ayuda (Ayudar)
  awaiting?: Id[];                              // iniciativa pedida a los jugadores: aún sin tirar (el combate no avanza)
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
  manual?: boolean;              // automatización manual: sin comparar con CA ni CD; Aplicar/Mitad/Curar
  awaiting?: Id[];               // objetivos cuyo dueño aún no ha tirado la salvación
  applied: boolean;
};

export type Grid = { type?: 'square' | 'hex' | 'none'; /* hex = filas (pointy-top); ausente = square */ size: number; offsetX: number; offsetY: number; feet: number };

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
  regions?: Region[];
  levels?: { id: Id; name: string; weather?: Weather }[]; // plantas de abajo arriba; la base es la primera (o la única si no hay lista) · weather: clima de esa planta (prevalece sobre el de la escena)
  miles?: number;                           // mapa del mundo: millas por casilla (herramienta de viaje)
  drawings?: Drawing[];                     // dibujo persistente (el efímero va solo por S2C)
  outdoor?: boolean;                        // al aire libre: la luz global sigue al reloj del mundo
  folder?: string;             // carpeta en la biblioteca
  audioPreset?: AudioState;    // música/ambiente que se activan con la escena
  dmNotes?: string;            // notas del DM de la escena (solo DM)
  story?: { image?: string; title?: string; subtitle?: string; layers?: StoryLayer[] }; // ilustración del modo Historia
  visibleTo?: Id[];            // solo estos miembros (y el DM) ven la escena cuando está activa; ausente = todos
  pins?: { id: Id; x: number; y: number; entryId: Id }[]; // marcadores enlazados a entradas del diario (el jugador solo recibe los de entradas que puede leer)
};

// Región del mapa con comportamiento. points = polígono en px de mundo.
export type Region = {
  id: Id; name: string; points: Point[];
  kind: 'difficult' | 'trap' | 'teleport' | 'fog' | 'darkness' | 'sound' | 'message' | 'weather';
  weather?: Weather;                        // kind weather: clima recortado al polígono (kind none = zona despejada)
  // difficult: el movimiento dentro cuesta el doble · fog: oculta a los jugadores lo que hay dentro hasta que el DM la quita
  // darkness: sin luz dentro · trap/teleport/sound/message: se disparan al entrar un token
  hidden: boolean;             // los jugadores no ven la región (las trampas suelen estarlo)
  once?: boolean; fired?: boolean;
  onlyAllies?: boolean;        // solo la disparan personajes
  save?: { ability: Ability; dc: number };  // trap
  damage?: string; damageType?: string;     // trap (mitad si supera la salvación)
  condition?: string;                       // trap: condición si falla (p. ej. 'prone')
  to?: Point;                               // teleport
  sfx?: string;                             // sound/trap
  text?: string;                            // message (lo ve quien entra) / descripción
  level?: Id;                               // planta de la región
  toLevel?: Id;                             // teleport/escalera: planta de destino (con `to` o misma posición)
  fx?: 'fire' | 'web' | 'fog' | 'ice' | 'brambles'; // efecto visual persistente en bucle dentro de la región
  trigger?: 'enter' | 'exit' | 'interact' | 'turnStart' | 'turnEnd'; // cuándo se dispara (por defecto al entrar); turnStart/End: áreas persistentes (Espíritus guardianes…)
  action?: 'silence' | 'doc' | 'scene' | 'encounter'; // efecto extra: silencio (sin conjuros verbales), mostrar documento, cambiar de escena, revelar encuentro
  docId?: Id; sceneId?: Id; encounter?: string;       // parámetros de action
  untilRound?: number;                      // se borra al acabar esa ronda (conjuros con duración)
  sourceId?: string;                        // conjuro de concentración que la creó (`conc:<tokenId>`): se borra al romperse
};

export type Drawing = { id: Id; points: Point[]; color: string; width: number; by: Id; level?: Id };

export type JournalEntry = {
  id: Id; title: string; body: string;      // body: texto plano con saltos de línea
  image?: string;                            // URL https o /assets/…
  visibleTo: 'dm' | 'all' | Id[];            // quién puede leerla
  table?: { dice: string; rows: { min: number; max: number; text: string }[] }; // tabla aleatoria («1d6», filas por rango)
  folder?: string;
  pdf?: string;                              // /assets/….pdf: se muestra en un visor
};

/** Encuentro guardado del constructor (solo DM/asistente): monstruos del SRD y cuántos. */
export type Encounter = { id: Id; name: string; monsters: { srd: string; n: number }[] };

export type LibraryItem = { id: Id; name: string; folder?: string; visibleTo?: Id[]; active: boolean; tokens: number; walls: number; background?: string };

// Turno propuesto por el copiloto; el cliente del DM lo aplica con los C2S normales (moveToken + act) si lo acepta.
export type CopilotTurn = { tokenId: Id; moveTo?: Point; actionId?: Id; turnOp?: 'dodge' | 'hide'; targets: Id[]; rationale: string };

export type SessionSummary = {
  started: number; ended: number; rounds: number;
  highlights: { kind: 'crit' | 'fumble' | 'kill' | 'down' | 'highest'; text: string }[];
  perToken: { tokenId: Id; name: string; damageDealt: number; damageTaken: number; healed: number; crits: number }[];
  xp?: number;                 // PX de los enemigos derrotados (SRD)
  tips?: { text: string; patch: Extract<C2S, { t: 'settings' }>['patch'] }[]; // solo DM, mesa en modo Sencillo: «¿Activar X?» con el ajuste que lo activa
};

export type TransitionKind = 'fade' | 'ink' | 'scroll' | 'title'; // fundido · barrido de tinta · pergamino que pasa · corte a título
export type TravelPace = 'slow' | 'normal' | 'fast';

export type Weather = { kind: 'none' | 'rain' | 'snow' | 'fog' | 'ash' | 'storm' | 'leaves' | 'embers' | 'fireflies' | 'sand' | 'dust'; intensity: number; wind: number }; // intensity 0–1, wind −1…1

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
  automation: 'assisted' | 'auto' | 'manual';
  settings: TableSettings;
  view: 'tactical' | 'story';
  audio: AudioState;
  journal: JournalEntry[];     // filtrado por visibleTo
  library?: LibraryItem[];     // solo DM/asistente
  encounters?: Encounter[];    // solo DM/asistente: encuentros guardados
  extensions: ExtensionManifest[]; // instaladas en la mesa (todos las cargan)
  safety: { lines: string[]; veils: string[] }; // líneas y velos de la mesa (anónimos)
  sessionStart?: number;       // ms del servidor en que empezó la sesión actual
  copilot: boolean;            // hay Laya o un LLM en el servidor (turno de monstruo)
  copilotLlm: boolean;         // hay un LLM (reglas, PNJ, crónica)
  livekit?: boolean;           // el servidor ofrece voz SFU (LiveKit); si no, la voz es malla WebRTC
  clock: number;               // reloj del mundo en minutos desde el inicio de la campaña (día = floor(/1440))
  canUndo: boolean;            // hay algo que deshacer para este miembro
};

export type ChatMsg = {
  id: Id; from: Id; at: number;
  text?: string;
  to?: Id[];                   // susurro: solo estos miembros (y el DM) lo ven
  as?: string;                 // en personaje: nombre del token con el que habla
  emote?: boolean;             // /me: acción narrada
  roll?: { expr: string; total: number; detail: string; secret: boolean; dice?: Die[]; blind?: boolean; external?: 'beyond20'; rerolled?: true }; // blind: ni quien tira lo ve · external: tirada hecha fuera (confianza del cliente)
  card?: ActionCard;
  loot?: { title: string; lines: { item: string; to?: string }[] }; // tarjeta de botín con su reparto
  doc?: { entryId: Id; title: string; image?: string; pdf?: boolean }; // tarjeta de documento mostrado (susurro a quienes lo reciben)
};

// Cliente → servidor
export type C2S =
  // sin code → crea mesa nueva y quien la crea es DM. key = secreto devuelto en welcome, para reconectar.
  | { t: 'join'; code?: string; name: string; key?: string; as?: 'spectator'; sid?: string } // sid: sesión de la pestaña, para no duplicar reenvíos // as: entra como espectador (pantalla de mesa física, streaming)
  | { t: 'moveToken'; id: Id; x: number; y: number; path?: Point[]; mode?: MoveMode } // path: puntos de paso intermedios (el destino es x,y)
  | { t: 'upsert'; kind: 'token'; item: Token }
  | { t: 'upsert'; kind: 'wall'; item: Wall }
  | { t: 'upsert'; kind: 'light'; item: Light }
  | { t: 'remove'; kind: 'token' | 'wall' | 'light'; id: Id }
  | { t: 'door'; id: Id; open: boolean }
  | { t: 'chat'; text: string; to?: Id[]; as?: Id; emote?: boolean } // as = token propio para hablar en personaje
  | { t: 'roll'; expr: string; secret?: boolean; as?: Id } // as: token cuyas @variables (@str, @prof…) se usan
  | { t: 'ping'; x: number; y: number }
  | { t: 'claim'; tokenId: Id }                                      // jugador elige un aliado sin dueño
  | { t: 'combat'; op: 'start' | 'next' | 'prev' | 'end' }           // DM
  | { t: 'combat'; op: 'delay'; tokenId: Id }                       // dueño en su turno (o DM): retrasa hasta después del siguiente
  | { t: 'combat'; op: 'add' | 'remove'; tokenId: Id }               // DM: meter/sacar una criatura en caliente
  | { t: 'combat'; op: 'group' | 'split'; tokenId: Id }              // DM: agrupar (misma iniciativa) o separar (tirada propia) a los monstruos idénticos a tokenId
  | { t: 'combat'; op: 'move'; tokenId: Id; to: number }             // DM: reordenar el tracker
  | { t: 'combat'; op: 'forceInit' | 'undoTurn' }                    // DM: tira lo que falta de iniciativa / deshace el último turno real
  | { t: 'rollInit'; tokenId: Id }                                   // dueño: tira su iniciativa cuando la mesa lo pide
  | { t: 'answerSave'; pending: Id; tokenId: Id }                    // dueño: tira la salvación de una tarjeta que la espera
  | { t: 'route'; tokenId: Id; points: Point[] }                     // ruta planificada mientras se arrastra (fantasma para los demás)
  | { t: 'turnAction'; tokenId: Id; op: 'dodge' | 'dash' | 'disengage' | 'hide' | 'useObject' | 'help'; target?: Id } // help: target = enemigo contiguo; el siguiente ataque de un aliado contra él va con ventaja
  | { t: 'budget'; tokenId: Id; slot: 'action' | 'bonus' | 'reaction' | 'object'; used: boolean } // corrección manual del presupuesto
  | { t: 'effect'; op: 'add'; tokenId: Id; effect: Omit<TurnEffect, 'id'> } | { t: 'effect'; op: 'apply' | 'dismiss'; tokenId: Id; effectId: Id } // add: DM
  | { t: 'legendary'; tokenId: Id; op: 'use' | 'reset' }             // DM
  | { t: 'react'; pending: Id; tokenId: Id; actionId: Id }           // dueño del objetivo: reacción (Escudo) sobre una tarjeta aún pendiente
  | { t: 'draw'; item: Drawing; persist: boolean }                   // dibujo: efímero (5 s, solo difusión) o persistente
  | { t: 'erase'; id: Id | 'mine' | 'all' }                          // 'all' solo DM
  | { t: 'cursor'; x: number; y: number }                            // posición del puntero (limitado)
  | { t: 'focusAll'; x: number; y: number }                          // DM: mueve la cámara de todos (ping forzado / modo cinematográfico)
  | { t: 'undo' }                                                    // deshace el último cambio propio (DM: el último de la escena)
  | { t: 'clock'; advance: number }                                  // DM: avanza el reloj del mundo (minutos, puede ser negativo)
  | { t: 'rollTable'; entryId: Id; secret?: boolean }                // tira en una tabla aleatoria del diario
  | { t: 'tokenImage'; tokenId: Id; img: string }                    // dueño: cambia la imagen de su token (https o /assets/)
  | { t: 'moveMany'; moves: { id: Id; x: number; y: number }[] }     // mover un grupo en formación (mismas reglas que moveToken)
  | { t: 'carry'; tokenId: Id; by: Id | null }                       // montura/agarre: tokenId pasa a moverse con `by`
  | { t: 'spawnCustom'; monster: ImportedCharacter & { cr?: string; size?: number; srdLike?: true }; x: number; y: number; hidden?: boolean } // DM: monstruo traído de su cuenta DDB
  | { t: 'act'; tokenId: Id; actionId: Id; targets: Id[]; at?: Point; dir?: Point; slot?: number } // resolver una acción · at/dir: punto y dirección de la plantilla (el servidor calcula los objetivos) · slot: nivel del espacio (≥ el del conjuro; sin él, el menor libre)
  | { t: 'confirm'; pending: Id; mode: 'full' | 'half' | 'none' | 'heal' } // heal: solo tarjetas manuales     // DM confirma daño pendiente
  | { t: 'spawn'; srd: string; x: number; y: number; hidden?: boolean } // DM añade monstruo del SRD
  | { t: 'automation'; value: 'assisted' | 'auto' | 'manual' }                   // DM
  | { t: 'diceTheme'; theme: DiceTheme }                              // cada miembro elige su set
  | { t: 'importCharacter'; tokenId: Id; data: ImportedCharacter }   // dueño del token (o DM): aplica un personaje de DDB
  | { t: 'settings'; patch: Partial<Omit<TableSettings, 'layers' | 'optional'>> & { layers?: Partial<TableSettings['layers']>; optional?: Partial<TableSettings['optional']> } } // DM
  | { t: 'setRole'; memberId: Id; role: Role }                        // DM
  | { t: 'condition'; tokenId: Id; condition: string; on: boolean; rounds?: number; saveEnd?: { ability: Ability; dc: number }; sourceId?: string } // DM, o dueño sobre su token
  | { t: 'hp'; tokenId: Id; delta: number; kind: 'damage' | 'heal' | 'temp'; damageType?: string } // DM, o dueño sobre su token
  | { t: 'concentration'; tokenId: Id; spell: string | null }        // dueño o DM
  | { t: 'deathSave'; tokenId: Id }                                   // dueño en su turno (o DM)
  | { t: 'check'; tokenId: Id; kind: 'save' | 'skill' | 'ability'; key: string; secret?: boolean } // tirada desde la hoja: el servidor aplica mods, agotamiento y condiciones
  | { t: 'scene'; patch: Partial<Pick<Scene, 'name' | 'background' | 'globalLight' | 'weather' | 'story' | 'grid' | 'width' | 'height' | 'miles'>> } // DM
  | { t: 'view'; value: 'tactical' | 'story' }                         // DM: cambia la vista de todos
  | { t: 'npcSay'; name: string; text: string; portrait?: string }     // DM: un PNJ habla (modo Historia o encima del mapa)
  | { t: 'transition'; title: string; subtitle?: string; kind?: TransitionKind; ms?: number } // DM: tarjeta de título para todos (kind/ms: estilo y duración)
  | { t: 'audio'; op: 'play'; url: string; name: string; loop?: boolean }  // DM (y trusted)
  | { t: 'audio'; op: 'pause' | 'resume' | 'stop' }
  | { t: 'audio'; op: 'layer'; layer: AudioState['layers'][number] }  // añade/actualiza capa de ambiente
  | { t: 'audio'; op: 'unlayer'; id: Id }
  | { t: 'sfx'; name: string }                                         // DM/trusted: efecto puntual (nombre de efecto sintetizado)
  | { t: 'rtc'; to: Id; data: unknown }                               // señalización WebRTC de voz, se reenvía tal cual al destinatario
  | { t: 'upsert'; kind: 'region'; item: Region }                    // DM
  | { t: 'remove'; kind: 'region'; id: Id }                          // DM
  | { t: 'sceneNew'; name: string; from?: Id }                       // DM: escena vacía o duplicada de `from`
  | { t: 'sceneActivate'; id: Id; transition?: { kind: TransitionKind; ms: number } } // DM: todos pasan a esa escena (se aplica su audioPreset) · transition: efecto con el que se cambia
  | { t: 'sceneUpdate'; id: Id; name?: string; folder?: string; visibleTo?: Id[] | null } // DM · visibleTo: null/[] = visible para todos
  | { t: 'sceneDelete'; id: Id }                                     // DM (no la activa)
  | { t: 'journal'; entry: JournalEntry }                            // DM: crea/actualiza
  | { t: 'journalDelete'; id: Id }                                   // DM
  | { t: 'encounter'; entry: Encounter }                             // DM: guardar (crear o sustituir por id) un encuentro
  | { t: 'encounterDelete'; id: Id }                                 // DM
  | { t: 'handout'; entryId: Id }                                    // DM: muestra la entrada a quienes pueden verla
  | { t: 'spawnMany'; items: { srd: string; x: number; y: number }[]; hidden?: boolean } // DM: encuentro
  | { t: 'extInstall'; manifest: ExtensionManifest }                 // DM (el cliente descarga el manifiesto; el servidor lo valida)
  | { t: 'extRemove'; id: string }                                   // DM
  | { t: 'upsert'; kind: 'level'; item: { id: Id; name: string; weather?: Weather | null } } | { t: 'remove'; kind: 'level'; id: Id } // DM
  | { t: 'heroPoint'; tokenId: Id }                                   // dueño: gasta 1 punto de héroe → +1d6 a su última tirada/tarjeta
  | { t: 'heroPoints'; tokenId: Id; value: number }                   // DM: fija los puntos
  | { t: 'safety'; op: 'x' }                                         // cualquiera: tarjeta X anónima (pausa)
  | { t: 'safety'; op: 'add' | 'remove'; list: 'lines' | 'veils'; text: string } // cualquiera, anónimo
  | { t: 'requestCheck'; tokenIds: Id[]; kind: 'save' | 'skill' | 'ability'; key: string; dc?: number; blind?: boolean } // DM
  | { t: 'answerCheck'; requestId: Id; tokenId: Id }                  // dueño responde a una prueba pedida
  | { t: 'sessionEnd' }                                               // DM: cierra la sesión → resumen
  | { t: 'externalRoll'; source: 'beyond20'; name: string; expr: string; total: number; dice: Die[]; kind?: string } // tirada hecha en la hoja de DDB vía Beyond20
  // Copiloto IA (opcional; Laya para el turno de monstruo, LANTERN_LLM_URL para el texto). Nunca actúa solo: sugiere y alguien confirma.
  | { t: 'copilot'; op: 'monsterTurn'; tokenId: Id; rid: string }     // DM: propone el turno de un monstruo
  | { t: 'copilot'; op: 'rules'; question: string; rid: string }      // cualquiera: duda de reglas (contexto = lo que ve quien pregunta)
  | { t: 'copilot'; op: 'npc'; prompt: string; rid: string }          // DM: nombre/descripción/voz de un PNJ
  | { t: 'copilot'; op: 'recap'; rid: string }
  | { t: 'livekit' }
  // fase 11 (extras.ts)
  | { t: 'reroll'; msgId: Id; kind: 'inspiration' | 'lucky'; tokenId: Id } // repite el d20 de una tirada propia
  | { t: 'rest'; tokenId: Id; kind: 'short' | 'long'; spend?: number }  // spend = dados de golpe a gastar (corto)
  | { t: 'requestRest'; kind: 'short' | 'long' }                        // DM: pide descanso a todo el grupo
  | { t: 'levelUp'; tokenId: Id; cls: string; hp: 'average' | 'roll' }
  | { t: 'abilityUp'; tokenId: Id; a: Ability; b?: Ability }            // gasta una mejora pendiente: +2 a `a` o +1 a `a` y `b`
  | { t: 'myChar'; data: ImportedCharacter }                            // personaje pregenerado o importado: a tu token, a uno libre o uno nuevo
  | { t: 'unlock'; wallId: Id; tokenId: Id; tool: 'athletics' | 'thieves' } // prueba contra la cerradura de una puerta
  | { t: 'interact'; tokenId: Id }                                      // dispara las regiones 'interact' bajo el token
  | { t: 'asPlayer'; memberId: Id | null }                              // DM: pide el estado filtrado de ese jugador (null = el propio)
  | { t: 'loot'; title: string; lines: { item: string; to?: string }[] } // DM
  | { t: 'docView'; entryId: Id; zoom: number; page?: number }          // DM: zoom sincronizado del visor PDF
  | { t: 'pin'; op: 'add'; x: number; y: number; entryId: Id } | { t: 'pin'; op: 'remove'; id: Id } // DM
  | { t: 'backup'; op: 'list' | 'now' } | { t: 'backup'; op: 'restore'; name: string } // DM
  | { t: 'scenePrepare'; id: Id }                                    // DM: los clientes precargan las imágenes de esa escena antes de activarla
  | { t: 'travel'; points: Point[]; pace: TravelPace; tableId?: Id; dc?: number } // DM: viaje medido con la regla (mapa del mundo): avanza el reloj y tira encuentros (1d20 ≥ dc por jornada; tableId = tabla del diario)
  | { t: 'tokenOwners'; tokenId: Id; owners: Id[] }; // DM: quién controla (mueve/actúa) el token; // DM                                                 // miembro: pide token de voz SFU (solo si state.livekit)                       // DM: resumen narrativo de la sesión → diario

// Servidor → cliente
export type S2C =
  | { t: 'welcome'; memberId: Id; key: string; role: Role; state: ClientState; chat: ChatMsg[]; v: number; seq?: number } // v = PROTOCOL_VERSION del servidor; seq = último mensaje recibido de esta sid
  | { t: 'state'; state: ClientState }   // ponytail: estado completo filtrado en cada cambio; diffs cuando pese
  | { t: 'chat'; msg: ChatMsg }
  | { t: 'ping'; from: Id; x: number; y: number }
  | { t: 'npcSay'; name: string; text: string; portrait?: string }
  | { t: 'transition'; title: string; subtitle?: string; kind?: TransitionKind; ms?: number }
  | { t: 'prepare'; urls: string[] }                                   // precarga de la escena que el DM va a activar (solo imágenes)
  | { t: 'sfx'; name: string }
  | { t: 'rtc'; from: Id; data: unknown }
  | { t: 'clock'; now: number }                                        // reloj del servidor (ms) para sincronizar audio; se envía tras welcome
  | { t: 'handout'; entry: JournalEntry }
  | { t: 'regionMsg'; text: string }                                   // mensaje de una región al token que entra
  | { t: 'draw'; item: Drawing }                                        // dibujo efímero (se borra solo a los 5 s)
  | { t: 'cursor'; from: Id; x: number; y: number }
  | { t: 'focus'; x: number; y: number }                                // el DM mueve la cámara de todos
  | { t: 'reactionPrompt'; pending: Id; tokenId: Id; actionId: Id; text: string; expires: number } // «¿Usas Escudo?»
  | { t: 'safety'; op: 'x' }                                           // tarjeta X: todos ven la pausa (sin autor)
  | { t: 'route'; tokenId: Id; points: Point[] }                        // ruta planificada por otro jugador
  | { t: 'turnReminder'; tokenId: Id; phase: 'start' | 'end'; effects: TurnEffect[] } // al dueño y al DM
  | { t: 'saveRequest'; pending: Id; tokenId: Id; ability: Ability; dc: number; text: string; expires: number } // al dueño: tira tu salvación
  | { t: 'spellBanner'; name: string; school?: string; level?: number; caster: string }
  | { t: 'checkRequest'; id: Id; tokenIds: Id[]; kind: 'save' | 'skill' | 'ability'; key: string; label: string; dc?: number } // a los dueños
  | { t: 'sessionSummary'; summary: SessionSummary }
  | { t: 'copilot'; rid: string; ok: true; text?: string; turn?: CopilotTurn }
  | { t: 'copilot'; rid: string; ok: false; error: string }
  | { t: 'error'; msg: string; re?: string } // re: tipo del mensaje del cliente que falló
  | { t: 'livekit'; url: string; token: string }
  | { t: 'restRequest'; kind: 'short' | 'long' }
  | { t: 'asState'; memberId: Id | null; state: ClientState } // respuesta a asPlayer
  | { t: 'docView'; entryId: Id; zoom: number; page?: number }
  | { t: 'backups'; list: { name: string; at: number; size: number }[] };                    // respuesta a C2S livekit: URL del SFU y JWT de acceso

// Versión del protocolo: sube cuando un cambio rompe clientes viejos; el cliente ofrece recargar si no coincide.
export const PROTOCOL_VERSION = 2;

// Extensión de terceros: página en un iframe sandbox que habla con la mesa por postMessage (ver packages/sdk).
export type ExtensionPermission = 'state' | 'chat' | 'roll' | 'contextMenu' | 'panel' | 'tokens';
export type ExtensionManifest = {
  id: string;                  // [a-z0-9-]{3,40}
  name: string; version: string; author?: string; description?: string;
  url: string;                 // https:// (o http://localhost en desarrollo): página del iframe
  permissions: ExtensionPermission[];
};

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L

// from: origen de la vista, para los muros de una dirección (izquierda = lado con cruce a→b positivo)
export const blocksSight = (w: Wall, from?: Point) =>
  (w.kind === 'wall' || w.kind === 'invisible' || (w.kind === 'door' && !w.open)) &&
  (!w.oneWay || !from || (((w.b.x - w.a.x) * (from.y - w.a.y) - (w.b.y - w.a.y) * (from.x - w.a.x)) > 0) === (w.oneWay === 'left'));

export const blocksMove = (w: Wall) =>
  w.kind !== 'invisible' && (w.kind !== 'door' || !w.open);
