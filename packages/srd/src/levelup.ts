import type { Ability, Token } from '@lantern/protocol';
import { abilityMod, roll, type HP } from '@lantern/rules';
import { CLASSES } from './classes.ts';

export type Leveler = { level: number; hp: HP; abilities: Record<Ability, number>; slots?: Token['slots']; hitDice?: Token['hitDice'] };
export type LevelUpResult = { char: Leveler; hpGain: number; asi: boolean; newSlots: Token['slots'] };

// Niveles con mejora de característica (todas las clases; guerrero y pícaro tienen extras).
const ASI = [4, 8, 12, 16, 19];
const asiAt = (cls: string, lvl: number) => ASI.includes(lvl) || (cls === 'fighter' && (lvl === 6 || lvl === 14)) || (cls === 'rogue' && lvl === 10);

/**
 * Sube un nivel en `cls` (id de CLASSES): PG (media fija o tirada, + CON, mín. 1), un dado de golpe más y
 * espacios de conjuro de la tabla de la clase (conserva los gastados). `asi` avisa de que toca mejora de característica.
 * ponytail: una sola clase (sin multiclase); los rasgos por nivel no están en los datos del SRD, solo espacios y mejoras.
 */
export function levelUp(c: Leveler, cls: string, o: { hp?: 'average' | 'roll'; rng?: () => number } = {}): LevelUpResult {
  const k = CLASSES[cls];
  if (!k) throw new Error(`Clase desconocida: ${cls}`);
  if (c.level < 1 || c.level >= 20) throw new Error('El nivel debe estar entre 1 y 19 para subir');
  const level = c.level + 1;
  const die = c.hitDice?.die ?? k.hitDie;
  const base = o.hp === 'roll' ? roll(`1d${die}`, o.rng).total : Math.floor(die / 2) + 1;
  const hpGain = Math.max(1, base + abilityMod(c.abilities.con));
  const newSlots = Object.fromEntries(k.slots[level - 1].map((max, i) => [i + 1, { max, used: Math.min(max, c.slots?.[i + 1]?.used ?? 0) }]).filter(([, s]) => (s as { max: number }).max > 0));
  return {
    char: { ...c, level, hp: { ...c.hp, max: c.hp.max + hpGain, cur: c.hp.cur + hpGain }, hitDice: { die, max: level, used: c.hitDice?.used ?? 0 }, ...(k.cast && { slots: newSlots }) },
    hpGain, asi: asiAt(cls, level), newSlots,
  };
}
