// Traducciones de los campos fijos del SRD (tamaño, tipo, alineamiento, tipos de daño, escuelas) y nombres de los monstruos más comunes.
// Los textos largos de reglas (rasgos, acciones legendarias) NO se traducen. Lo usa tools/srd-import.mjs y la interfaz.
export const SIZE_ES: Record<string, string> = { Tiny: 'Diminuto', Small: 'Pequeño', Medium: 'Mediano', Large: 'Grande', Huge: 'Enorme', Gargantuan: 'Gargantuesco', 'Medium or small': 'Mediano o pequeño' };

export const TYPE_ES: Record<string, string> = { aberration: 'aberración', beast: 'bestia', celestial: 'celestial', construct: 'constructo', dragon: 'dragón', elemental: 'elemental', fey: 'feérico',
  fiend: 'infernal', giant: 'gigante', humanoid: 'humanoide', monstrosity: 'monstruosidad', ooze: 'cieno', plant: 'planta', 'swarm of tiny beasts': 'enjambre de bestias diminutas',
  'swarm of tiny undead': 'enjambre de no muertos diminutos', undead: 'no muerto' };

const ALIGN_WORD: Record<string, string> = { lawful: 'legal', neutral: 'neutral', chaotic: 'caótico', good: 'bueno', evil: 'malvado' };
/** «lawful evil» → «legal malvado»; «neutral» / «unaligned» → «neutral» / «sin alineamiento». */
export const alignES = (a: string) => a === 'unaligned' ? 'sin alineamiento' : a === 'neutral' ? 'neutral' : a.split(' ').map((w) => ALIGN_WORD[w] ?? w).join(' ');

export const DAMAGE_ES: Record<string, string> = { acid: 'ácido', bludgeoning: 'contundente', cold: 'frío', fire: 'fuego', force: 'fuerza', lightning: 'rayo', necrotic: 'necrótico',
  piercing: 'perforante', poison: 'veneno', psychic: 'psíquico', radiant: 'radiante', slashing: 'cortante', thunder: 'trueno' };

export const SCHOOL_ES: Record<string, string> = { abjuration: 'abjuración', conjuration: 'conjuración', divination: 'adivinación', enchantment: 'encantamiento', evocation: 'evocación',
  illusion: 'ilusión', necromancy: 'nigromancia', transmutation: 'transmutación' };

// id SRD → nombre en español (solo los más comunes; el resto queda en inglés)
export const MONSTER_ES: Record<string, string> = {
  aboleth: 'Aboleth', 'air-elemental': 'Elemental de aire', 'animated-armor': 'Armadura animada', ankheg: 'Ankheg', assassin: 'Asesino', 'awakened-shrub': 'Arbusto despierto', 'awakened-tree': 'Árbol despierto',
  'axe-beak': 'Pico hacha', balor: 'Balor', bandit: 'Bandido', 'bandit-captain': 'Capitán bandido', 'barbed-devil': 'Diablo barbado', basilisk: 'Basilisco', 'bearded-devil': 'Diablo barbudo', behir: 'Behir',
  berserker: 'Berserker', 'black-pudding': 'Pudin negro', 'blink-dog': 'Perro intermitente', 'bone-devil': 'Diablo de hueso', 'bugbear-warrior': 'Osgo guerrero', 'bugbear-stalker': 'Osgo acechador', bulette: 'Bulette',
  chimera: 'Quimera', chuul: 'Chuul', 'clay-golem': 'Gólem de arcilla', cloaker: 'Capa', 'cloud-giant': 'Gigante de las nubes', cockatrice: 'Cocatriz', commoner: 'Plebeyo', couatl: 'Couatl', cultist: 'Cultista',
  'cultist-fanatic': 'Fanático cultista', darkmantle: 'Manto oscuro', 'death-dog': 'Perro de la muerte', deva: 'Deva', djinni: 'Djinn', doppelganger: 'Doppelgänger', 'dragon-turtle': 'Tortuga dragón', dretch: 'Dretch',
  drider: 'Driderano', druid: 'Druida', dryad: 'Dríada', 'earth-elemental': 'Elemental de tierra', efreeti: 'Efrit', erinyes: 'Erinia', ettercap: 'Ettercap', ettin: 'Ettin', 'fire-elemental': 'Elemental de fuego',
  'fire-giant': 'Gigante de fuego', 'flesh-golem': 'Gólem de carne', 'frost-giant': 'Gigante de escarcha', gargoyle: 'Gárgola', 'gelatinous-cube': 'Cubo gelatinoso', ghast: 'Necrófago maldito', ghost: 'Fantasma',
  ghoul: 'Necrófago', gladiator: 'Gladiador', 'gnoll-warrior': 'Gnoll guerrero', 'goblin-minion': 'Esbirro trasgo', 'goblin-warrior': 'Trasgo guerrero', 'goblin-boss': 'Jefe trasgo', gorgon: 'Gorgona', 'gray-ooze': 'Cieno gris',
  'green-hag': 'Saga verde', grick: 'Grick', griffon: 'Grifo', grimlock: 'Grimlock', guard: 'Guardia', 'guard-captain': 'Capitán de la guardia', harpy: 'Arpía', 'hell-hound': 'Perro infernal', hezrou: 'Hezrou',
  'hill-giant': 'Gigante de las colinas', hippogriff: 'Hipogrifo', 'hobgoblin-warrior': 'Hobgoblin guerrero', 'hobgoblin-captain': 'Capitán hobgoblin', homunculus: 'Homúnculo', 'horned-devil': 'Diablo cornudo', hydra: 'Hidra',
  'ice-devil': 'Diablo de hielo', imp: 'Diablillo', incubus: 'Íncubo', 'iron-golem': 'Gólem de hierro', knight: 'Caballero', 'kobold-warrior': 'Kobold guerrero', kraken: 'Kraken', lamia: 'Lamia', lemure: 'Lémur', lich: 'Lich',
  mage: 'Mago', archmage: 'Archimago', manticore: 'Mantícora', marilith: 'Marilith', medusa: 'Medusa', mimic: 'Mímico', mummy: 'Momia', 'mummy-lord': 'Señor momia', 'night-hag': 'Saga nocturna', nightmare: 'Pesadilla',
  noble: 'Noble', 'ochre-jelly': 'Gelatina ocre', ogre: 'Ogro', oni: 'Oni', otyugh: 'Otyugh', owlbear: 'Osolechuza', pegasus: 'Pegaso', 'phase-spider': 'Araña de fase', pirate: 'Pirata', 'pit-fiend': 'Diablo del foso',
  priest: 'Sacerdote', pseudodragon: 'Pseudodragón', 'purple-worm': 'Gusano púrpura', quasit: 'Quasit', rakshasa: 'Rakshasa', remorhaz: 'Remorhaz', roc: 'Roc', roper: 'Roper', 'rust-monster': 'Monstruo del óxido',
  salamander: 'Salamandra', satyr: 'Sátiro', scout: 'Explorador', 'sea-hag': 'Saga marina', shadow: 'Sombra', 'shambling-mound': 'Montón errante', 'shield-guardian': 'Guardián escudo', skeleton: 'Esqueleto',
  'warhorse-skeleton': 'Caballo de guerra esqueleto', solar: 'Solar', specter: 'Espectro', sprite: 'Sprite', spy: 'Espía', stirge: 'Chupasangre', 'stone-giant': 'Gigante de piedra', 'stone-golem': 'Gólem de piedra',
  'storm-giant': 'Gigante de las tormentas', succubus: 'Súcubo', tarrasque: 'Tarasca', tough: 'Matón', treant: 'Ent', troll: 'Trol', unicorn: 'Unicornio', 'vampire-spawn': 'Vástago vampiro', vampire: 'Vampiro', vrock: 'Vrock',
  'warrior-infantry': 'Guerrero de infantería', 'warrior-veteran': 'Guerrero veterano', 'water-elemental': 'Elemental de agua', wight: 'Tumulario', 'will-o-wisp': 'Fuego fatuo', 'winter-wolf': 'Lobo invernal', worg: 'Huargo',
  wraith: 'Alma en pena', wyvern: 'Wyvern', xorn: 'Xorn', zombie: 'Zombi', 'ogre-zombie': 'Zombi ogro', ape: 'Simio', badger: 'Tejón', bat: 'Murciélago', 'black-bear': 'Oso negro', boar: 'Jabalí', 'brown-bear': 'Oso pardo',
  cat: 'Gato', crocodile: 'Cocodrilo', 'dire-wolf': 'Lobo terrible', eagle: 'Águila', elephant: 'Elefante', frog: 'Rana', 'giant-ape': 'Simio gigante', 'giant-bat': 'Murciélago gigante', 'giant-boar': 'Jabalí gigante',
  'giant-crab': 'Cangrejo gigante', 'giant-eagle': 'Águila gigante', 'giant-rat': 'Rata gigante', 'giant-scorpion': 'Escorpión gigante', 'giant-shark': 'Tiburón gigante', 'giant-spider': 'Araña gigante',
  'giant-venomous-snake': 'Serpiente venenosa gigante', 'giant-wolf-spider': 'Araña lobo gigante', goat: 'Cabra', hawk: 'Halcón', hyena: 'Hiena', jackal: 'Chacal', lion: 'León', lizard: 'Lagarto', mastiff: 'Mastín',
  owl: 'Búho', panther: 'Pantera', 'polar-bear': 'Oso polar', pony: 'Poni', rat: 'Rata', raven: 'Cuervo', 'riding-horse': 'Caballo de monta', scorpion: 'Escorpión', spider: 'Araña', 'swarm-of-bats': 'Enjambre de murciélagos',
  'swarm-of-insects': 'Enjambre de insectos', 'swarm-of-rats': 'Enjambre de ratas', 'swarm-of-ravens': 'Enjambre de cuervos', tiger: 'Tigre', 'tyrannosaurus-rex': 'Tiranosaurio rex', 'venomous-snake': 'Serpiente venenosa',
  vulture: 'Buitre', warhorse: 'Caballo de guerra', wolf: 'Lobo',
  'black-dragon-wyrmling': 'Dracoleto negro', 'young-black-dragon': 'Dragón negro joven', 'adult-black-dragon': 'Dragón negro adulto', 'ancient-black-dragon': 'Dragón negro ancestral',
  'blue-dragon-wyrmling': 'Dracoleto azul', 'young-blue-dragon': 'Dragón azul joven', 'adult-blue-dragon': 'Dragón azul adulto', 'ancient-blue-dragon': 'Dragón azul ancestral',
  'green-dragon-wyrmling': 'Dracoleto verde', 'young-green-dragon': 'Dragón verde joven', 'adult-green-dragon': 'Dragón verde adulto', 'ancient-green-dragon': 'Dragón verde ancestral',
  'red-dragon-wyrmling': 'Dracoleto rojo', 'young-red-dragon': 'Dragón rojo joven', 'adult-red-dragon': 'Dragón rojo adulto', 'ancient-red-dragon': 'Dragón rojo ancestral',
  'white-dragon-wyrmling': 'Dracoleto blanco', 'young-white-dragon': 'Dragón blanco joven', 'adult-white-dragon': 'Dragón blanco adulto', 'ancient-white-dragon': 'Dragón blanco ancestral',
};
