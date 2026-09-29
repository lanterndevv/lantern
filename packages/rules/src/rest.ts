// Descansos, edición por criatura y carga. Funciones puras sobre el estado de la ficha.
import type { Token } from '@lantern/protocol';
import { d20Penalty, roll, type HP } from './index.ts';

export type CharState = { hp: HP; hitDice: NonNullable<Token['hitDice']>; slots?: Token['slots']; exhaustion?: number };
type Edition = '2014' | '2024';

/** La edición de la criatura prevalece sobre la de la mesa. */
export const editionOf = (t: { edition?: Edition } | undefined, table: Edition): Edition => t?.edition ?? table;

/** Penalizador a las d20 por agotamiento según la edición efectiva de la criatura (solo 2024 lo aplica). */
export const exhaustionPenalty = (t: { exhaustion?: number; edition?: Edition }, table: Edition): number =>
  d20Penalty(t.exhaustion ?? 0, editionOf(t, table));

/**
 * Descanso corto: gasta `spent` dados de golpe (los que queden), cada uno cura 1dX + CON (mín. 0).
 * Igual en 2014 y 2024 (el SRD 5.2.1 no cambia esta regla).
 */
export function shortRest(c: CharState, spent: number, o: { conMod?: number; rng?: () => number } = {}): { state: CharState; healed: number; rolls: number[] } {
  const n = Math.max(0, Math.min(Math.floor(spent), c.hitDice.max - c.hitDice.used));
  const rolls = Array.from({ length: n }, () => Math.max(0, roll(`1d${c.hitDice.die}`, o.rng).total + (o.conMod ?? 0)));
  const healed = Math.min(c.hp.max - c.hp.cur, rolls.reduce((a, b) => a + b, 0));
  return { state: { ...c, hp: { ...c.hp, cur: c.hp.cur + healed }, hitDice: { ...c.hitDice, used: c.hitDice.used + n } }, healed, rolls };
}

/**
 * Descanso largo (2014 y 2024 coinciden): con 0 PG no aprovecha nada; si no, PG al máximo (los temporales se conservan),
 * todos los espacios, la mitad del total de dados de golpe (mín. 1) y −1 nivel de agotamiento.
 */
export function longRest(c: CharState): CharState {
  if (c.hp.cur <= 0) return c;
  const slots = c.slots && Object.fromEntries(Object.entries(c.slots).map(([lv, s]) => [lv, { ...s, used: 0 }]));
  return {
    ...c, hp: { ...c.hp, cur: c.hp.max },
    hitDice: { ...c.hitDice, used: Math.max(0, c.hitDice.used - Math.max(1, Math.floor(c.hitDice.max / 2))) },
    ...(slots && { slots }), ...(c.exhaustion !== undefined && { exhaustion: Math.max(0, c.exhaustion - 1) }),
  };
}

const SIZE_MULT = [0.5, 1, 2, 4, 8]; // Menudo, Mediano, Grande, Enorme, Gargantuesco
export type Encumbrance = { capacity: number; status: 'ok' | 'encumbered' | 'heavy' | 'over'; speedPenalty: number; disadv: boolean };

/**
 * Carga (lb). Simple: capacidad 15×FUE; pasarse deja la velocidad a 0.
 * Variante: >5×FUE cargado (−10 pies), >10×FUE muy cargado (−20 pies y desventaja en FUE/DES/CON).
 * `size`: 0 Menudo … 4 Gargantuesco (por defecto Mediano = 1).
 */
export function encumbrance(str: number, weight: number, o: { variant?: boolean; size?: number } = {}): Encumbrance {
  const m = SIZE_MULT[o.size ?? 1] ?? 1, cap = 15 * str * m;
  if (weight > cap) return { capacity: cap, status: 'over', speedPenalty: Infinity, disadv: true };
  if (!o.variant) return { capacity: cap, status: 'ok', speedPenalty: 0, disadv: false };
  if (weight > 10 * str * m) return { capacity: cap, status: 'heavy', speedPenalty: 20, disadv: true };
  if (weight > 5 * str * m) return { capacity: cap, status: 'encumbered', speedPenalty: 10, disadv: false };
  return { capacity: cap, status: 'ok', speedPenalty: 0, disadv: false };
}
