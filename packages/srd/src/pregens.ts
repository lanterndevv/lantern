import type { Ability, Token } from '@lantern/protocol';
import { SKILLS, abilityMod, proficiencyBonus } from '@lantern/rules';
import { SPELLS } from './compendium.ts';
import { CLASSES } from './classes.ts';
import { SPECIES } from './species.ts';

export type SrdPregen = Pick<Token, 'name' | 'faction' | 'size' | 'darkvision' | 'hp' | 'ac' | 'speed' | 'initMod' | 'saves' | 'abilities' | 'skills' | 'prof' | 'actions' | 'slots' | 'hitDice' | 'conditions' | 'defenses'> & { class: string; species: string; level: 1 };

const camel = (s: string) => s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const a = (str: number, dex: number, con: number, int: number, wis: number, cha: number): Record<Ability, number> => ({ str, dex, con, int, wis, cha });

function make(name: string, cls: string, species: string, abilities: Record<Ability, number>, ac: number): SrdPregen {
  const k = CLASSES[cls], sp = SPECIES[species], prof = proficiencyBonus(1), mod = (x: Ability) => abilityMod(abilities[x]);
  const w = k.weapon, wm = mod(w.ability), cm = k.cast ? mod(k.cast) : 0;
  const bonus = (n: number) => (n ? (n > 0 ? `+${n}` : `${n}`) : '');
  const actions = [
    { ...w, toHit: prof + wm, damage: w.damage + bonus(wm) },
    ...k.cantrips.map((id) => ({ ...SPELLS[id], ...(SPELLS[id].kind === 'save' ? { save: { ...SPELLS[id].save!, dc: 8 + prof + cm } } : { toHit: prof + cm }) })),
  ].map(({ ability: _, ...x }: Record<string, unknown>) => x) as SrdPregen['actions'];
  const skills = Object.fromEntries(k.skills.slice(0, 2).map((s) => [camel(s), mod(SKILLS[camel(s)].ability) + prof]));
  return {
    name, class: cls, species, level: 1, faction: 'ally', size: 1, darkvision: sp.darkvision * 12, hp: { cur: k.hitDie + mod('con'), max: k.hitDie + mod('con'), temp: 0 },
    ac, speed: sp.speed, initMod: mod('dex'), abilities, prof, skills, actions, conditions: [], hitDice: { die: k.hitDie, max: 1, used: 0 },
    saves: Object.fromEntries((Object.keys(abilities) as Ability[]).map((x) => [x, mod(x) + (k.saves.includes(x) ? prof : 0)])),
    ...(sp.resist.length && { defenses: { resist: sp.resist } }),
    ...(k.cast && { slots: Object.fromEntries(k.slots[0].map((max, i) => [i + 1, { max, used: 0 }]).filter(([, s]) => (s as { max: number }).max > 0)) }),
  };
}

// Matriz estándar (15, 14, 13, 12, 10, 8) repartida según la clase.
export const PREGENS: Record<string, SrdPregen> = {
  fighter: make('Bruna Hierro', 'fighter', 'human', a(15, 13, 14, 8, 12, 10), 16),
  wizard: make('Elaith Umbra', 'wizard', 'elf', a(8, 14, 13, 15, 12, 10), 12),
  cleric: make('Dorn Yunque', 'cleric', 'dwarf', a(13, 10, 14, 8, 15, 12), 16),
  rogue: make('Pip Zarza', 'rogue', 'halfling', a(8, 15, 14, 13, 12, 10), 13),
  ranger: make('Sylva Bosque', 'ranger', 'elf', a(12, 15, 13, 10, 14, 8), 13),
  bard: make('Mireya Vox', 'bard', 'tiefling', a(8, 14, 13, 10, 12, 15), 13),
};
