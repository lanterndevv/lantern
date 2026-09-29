// This work includes material from the System Reference Document 5.2.1 by Wizards of the Coast LLC, licensed under CC BY 4.0
import type { Ability, Action } from '@lantern/protocol';

export type SrdClass = {
  name: string; hitDie: number; saves: Ability[]; cast?: Ability;
  armor: { light: boolean; medium: boolean; heavy: boolean; shield: boolean };
  weapon: Action & { ability: Ability };      // arma inicial; toHit y modificador de daño los ajusta el creador
  skills: string[];                           // habilidades sugeridas (ids en inglés)
  cantrips: string[];                         // ids de SPELLS con daño que la clase puede llevar
  slots: number[][];                          // slots[nivel-1][k] = espacios de conjuro de nivel k+1
};

// Tablas compactas: una cadena de dígitos por nivel, un dígito por nivel de espacio ('42' = 4 de nv. 1 y 2 de nv. 2).
const dec = (t: string[]) => t.map(r => [...r].map(Number));
const FULL = dec(['2', '3', '42', '43', '432', '433', '4331', '4332', '43331', '43332', '433321', '433321', '4333211', '4333211',
  '43332111', '43332111', '433321111', '433331111', '433332111', '433332211']);
const HALF = dec(['2', '2', '3', '3', '42', '42', '43', '43', '432', '432', '433', '433', '4331', '4331', '4332', '4332',
  '43331', '43331', '43332', '43332']);
const NONE: number[][] = Array.from({ length: 20 }, () => []);
// Brujo: pacto. Pocos espacios, todos del mismo nivel, que sube hasta el 5.º.
const PACT = Array.from({ length: 20 }, (_, i) => {
  const lvl = i < 2 ? 1 : i < 4 ? 2 : i < 6 ? 3 : i < 8 ? 4 : 5;
  return [...Array(lvl - 1).fill(0), i === 0 ? 1 : i < 10 ? 2 : i < 16 ? 3 : 4];
});

const w = (id: string, name: string, ability: Ability, damage: string, damageType: string, range = 5): SrdClass['weapon'] =>
  ({ id, name, ability, cost: 'action', kind: 'attack', range, toHit: 0, damage, damageType });
const AL = { light: true, medium: false, heavy: false, shield: false };
const c = (name: string, hitDie: number, saves: Ability[], cast: Ability | undefined, armor: Partial<SrdClass['armor']>,
  weapon: SrdClass['weapon'], skills: string[], slots: number[][], cantrips: string[] = []): SrdClass =>
  ({ name, hitDie, saves, cast, armor: { light: false, medium: false, heavy: false, shield: false, ...armor }, weapon, skills, cantrips, slots });

export const CLASSES: Record<string, SrdClass> = {
  barbarian: c('Bárbaro', 12, ['str', 'con'], undefined, { light: true, medium: true, shield: true }, w('greataxe', 'Hacha a dos manos', 'str', '1d12', 'slashing'),
    ['athletics', 'perception', 'survival', 'intimidation'], NONE),
  bard: c('Bardo', 8, ['dex', 'cha'], 'cha', AL, w('rapier', 'Estoque', 'dex', '1d8', 'piercing'),
    ['performance', 'persuasion', 'deception', 'acrobatics'], FULL),
  cleric: c('Clérigo', 8, ['wis', 'cha'], 'wis', { light: true, medium: true, shield: true }, w('mace', 'Maza', 'str', '1d6', 'bludgeoning'),
    ['medicine', 'religion', 'insight', 'persuasion'], FULL, ['sacred-flame']),
  druid: c('Druida', 8, ['int', 'wis'], 'wis', { light: true, shield: true }, w('quarterstaff', 'Bastón', 'str', '1d6', 'bludgeoning'),
    ['nature', 'perception', 'survival', 'animal-handling'], FULL),
  fighter: c('Guerrero', 10, ['str', 'con'], undefined, { light: true, medium: true, heavy: true, shield: true }, w('longsword', 'Espada larga', 'str', '1d8', 'slashing'),
    ['athletics', 'perception', 'intimidation', 'acrobatics'], NONE),
  monk: c('Monje', 8, ['str', 'dex'], undefined, {}, w('unarmed', 'Golpe sin armas', 'dex', '1d6', 'bludgeoning'),
    ['acrobatics', 'stealth', 'insight', 'athletics'], NONE),
  paladin: c('Paladín', 10, ['wis', 'cha'], 'cha', { light: true, medium: true, heavy: true, shield: true }, w('longsword', 'Espada larga', 'str', '1d8', 'slashing'),
    ['athletics', 'persuasion', 'insight', 'intimidation'], HALF),
  ranger: c('Explorador', 10, ['str', 'dex'], 'wis', { light: true, medium: true, shield: true }, w('longbow', 'Arco largo', 'dex', '1d8', 'piercing', 150),
    ['stealth', 'survival', 'perception', 'nature'], HALF),
  rogue: c('Pícaro', 8, ['dex', 'int'], undefined, AL, w('shortsword', 'Espada corta', 'dex', '1d6', 'piercing'),
    ['stealth', 'sleight-of-hand', 'acrobatics', 'perception'], NONE),
  sorcerer: c('Hechicero', 6, ['con', 'cha'], 'cha', {}, w('dagger', 'Daga', 'dex', '1d4', 'piercing'),
    ['arcana', 'persuasion', 'deception', 'insight'], FULL, ['fire-bolt', 'ray-of-frost']),
  warlock: c('Brujo', 8, ['wis', 'cha'], 'cha', AL, w('light-crossbow', 'Ballesta ligera', 'dex', '1d8', 'piercing', 80),
    ['arcana', 'deception', 'intimidation', 'investigation'], PACT, ['fire-bolt']),
  wizard: c('Mago', 6, ['int', 'wis'], 'int', {}, w('quarterstaff', 'Bastón', 'str', '1d6', 'bludgeoning'),
    ['arcana', 'investigation', 'history', 'insight'], FULL, ['fire-bolt', 'ray-of-frost']),
};
