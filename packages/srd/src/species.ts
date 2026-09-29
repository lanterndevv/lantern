// This work includes material from the System Reference Document 5.2.1 by Wizards of the Coast LLC, licensed under CC BY 4.0
export type SrdSpecies = { name: string; speed: number; darkvision: number; resist: string[] }; // pies

// ponytail: los rasgos con elección (linaje, herencia, antepasado gigante) usan el valor por defecto; ampliar cuando se automaticen.
export const SPECIES: Record<string, SrdSpecies> = {
  dragonborn: { name: 'Dracónido', speed: 30, darkvision: 60, resist: ['fire'] },   // antepasado dragón rojo
  dwarf: { name: 'Enano', speed: 30, darkvision: 120, resist: ['poison'] },
  elf: { name: 'Elfo', speed: 30, darkvision: 60, resist: [] },
  gnome: { name: 'Gnomo', speed: 30, darkvision: 60, resist: [] },
  goliath: { name: 'Goliat', speed: 35, darkvision: 0, resist: [] },
  halfling: { name: 'Mediano', speed: 30, darkvision: 0, resist: [] },
  human: { name: 'Humano', speed: 30, darkvision: 0, resist: [] },
  orc: { name: 'Orco', speed: 30, darkvision: 120, resist: [] },
  tiefling: { name: 'Tiflin', speed: 30, darkvision: 60, resist: ['fire'] },        // legado infernal
};
