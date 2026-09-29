// Formato de intercambio de personajes: pregenerados SRD → ImportedCharacter y ficha → JSON exportable.
import type { Action, ImportedCharacter, Token } from '@lantern/protocol';
import { CLASSES } from './classes.ts';
import type { SrdPregen } from './pregens.ts';

const KEYS = ['id', 'name', 'cost', 'kind', 'range', 'toHit', 'save', 'damage', 'damageType', 'area', 'slot', 'school', 'multi'] as const;
/** Deja solo lo que valida el servidor (parseCharacter); el cilindro pasa a esfera. */
export function cleanActions(as: Action[] | undefined): Action[] | undefined {
  return as?.map((a) => {
    const o = Object.fromEntries(KEYS.filter((k) => a[k] !== undefined).map((k) => [k, a[k]])) as unknown as Action;
    if (o.area?.shape === 'cylinder') o.area = { ...o.area, shape: 'sphere' };
    return o;
  });
}

export function pregenToImported(p: SrdPregen): ImportedCharacter {
  return {
    ddbId: 0, name: p.name, level: p.level, classes: `${CLASSES[p.class]?.name ?? p.class} ${p.level}`, darkvision: p.darkvision, hp: p.hp, ac: p.ac, speed: p.speed, initMod: p.initMod,
    saves: p.saves, abilities: p.abilities, skills: p.skills, prof: p.prof, actions: cleanActions(p.actions), slots: p.slots, hitDice: p.hitDice,
    ...(p.defenses && { defenses: p.defenses }), ...(p.species === 'halfling' && { lucky: true }),
  };
}

export const CHAR_FORMAT = 'lantern-character';
/** Hoja propia para descargar: solo estadísticas de juego (sin vínculo con D&D Beyond). */
export function tokenToExport(t: Token): { format: typeof CHAR_FORMAT; version: 1; data: ImportedCharacter } {
  const level = t.hitDice?.max ?? t.ddb?.level ?? 1;
  const d: ImportedCharacter = { ddbId: 0, name: t.name, level, classes: t.ddb?.classes ?? '', darkvision: t.darkvision };
  for (const k of ['hp', 'ac', 'speed', 'initMod', 'saves', 'defenses', 'slots', 'abilities', 'skills', 'prof', 'hitDice', 'lucky'] as const) if (t[k] !== undefined) (d as Record<string, unknown>)[k] = structuredClone(t[k]);
  if (t.actions) d.actions = cleanActions(structuredClone(t.actions));
  return { format: CHAR_FORMAT, version: 1, data: d };
}
