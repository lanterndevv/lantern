// This work includes material from the System Reference Document 5.2 by Wizards of the Coast LLC, licensed under CC BY 4.0
import type { Action, Token } from '@lantern/protocol';

export type SrdMonster = Omit<Token, 'id' | 'x' | 'y' | 'owners' | 'hidden'> & { cr: string; type: string };

// 1 casilla = 60 px = 5 pies. Todo lo que no ataca (Multiataque, rasgos, Telaraña, veneno…) queda fuera.
// ponytail: monstruos sin rasgos especiales; añadirlos cuando el servidor los automatice.
const DV60 = 720;
const atk = (id: string, name: string, toHit: number, damage: string, damageType: string, range = 5): Action =>
  ({ id, name, cost: 'action', kind: 'attack', range, toHit, damage, damageType });
const mon = (
  name: string, cr: string, type: string, o: { size?: number; darkvision?: number; hp: number; ac: number; speed: number; initMod: number;
    saves: NonNullable<Token['saves']>; defenses?: Token['defenses']; actions: Action[] },
): SrdMonster => ({
  name, faction: 'enemy', size: o.size ?? 1, darkvision: o.darkvision ?? DV60, hp: { cur: o.hp, max: o.hp, temp: 0 }, ac: o.ac,
  speed: o.speed, initMod: o.initMod, saves: o.saves, defenses: o.defenses, actions: o.actions, cr, type, conditions: [],
});
const s = (str: number, dex: number, con: number, int: number, wis: number, cha: number) => ({ str, dex, con, int, wis, cha });

export const MONSTERS: Record<string, SrdMonster> = {
  goblin: mon('Trasgo', '1/4', 'feérico', { hp: 10, ac: 15, speed: 30, initMod: 2, saves: s(-1, 2, 0, 0, -1, -1),
    actions: [atk('scimitar', 'Cimitarra', 4, '1d6+2', 'slashing'), atk('shortbow', 'Arco corto', 4, '1d6+2', 'piercing', 80)] }),
  hobgoblin: mon('Hobgoblin', '1/2', 'feérico', { hp: 11, ac: 18, speed: 30, initMod: 1, saves: s(1, 1, 1, 0, 0, -1),
    actions: [atk('longsword', 'Espada larga', 3, '2d10+1', 'slashing'), atk('longbow', 'Arco largo', 3, '1d8+1', 'piercing', 150)] }),
  bugbear: mon('Osgo', '1', 'feérico', { hp: 33, ac: 14, speed: 30, initMod: 2, saves: s(2, 2, 1, -1, 0, -1),
    actions: [atk('morningstar', 'Lucero del alba', 5, '2d8+3', 'piercing', 10), atk('javelin', 'Jabalina', 5, '3d6+3', 'piercing', 30)] }),
  ogre: mon('Ogro', '2', 'gigante', { size: 2, hp: 68, ac: 11, speed: 40, initMod: -1, saves: s(4, -1, 3, -3, -2, -2),
    actions: [atk('greatclub', 'Garrote', 6, '2d8+4', 'bludgeoning'), atk('javelin', 'Jabalina', 6, '2d6+4', 'piercing', 30)] }),
  wolf: mon('Lobo', '1/4', 'bestia', { darkvision: 0, hp: 11, ac: 12, speed: 40, initMod: 2, saves: s(2, 2, 1, -4, 1, -2),
    actions: [atk('bite', 'Mordisco', 4, '1d6+2', 'piercing')] }),
  skeleton: mon('Esqueleto', '1/4', 'no muerto', { hp: 13, ac: 14, speed: 30, initMod: 3, saves: s(0, 3, 2, -2, -1, -3),
    defenses: { vuln: ['bludgeoning'], immune: ['poison'] },
    actions: [atk('shortsword', 'Espada corta', 5, '1d6+3', 'piercing'), atk('shortbow', 'Arco corto', 5, '1d6+3', 'piercing', 80)] }),
  zombie: mon('Zombi', '1/4', 'no muerto', { hp: 15, ac: 8, speed: 20, initMod: -2, saves: s(1, -2, 3, -4, 0, -3),
    defenses: { immune: ['poison'] }, actions: [atk('slam', 'Golpe', 3, '1d8+1', 'bludgeoning')] }),
  // SRD 5.1 (el orco no está en el SRD 5.2.1)
  orc: mon('Orco', '1/2', 'humanoide', { hp: 15, ac: 13, speed: 30, initMod: 1, saves: s(3, 1, 3, -2, 0, 0),
    actions: [atk('greataxe', 'Hacha grande', 5, '1d12+3', 'slashing'), atk('javelin', 'Jabalina', 5, '1d6+3', 'piercing', 30)] }),
  'giant-spider': mon('Araña gigante', '1', 'bestia', { size: 2, hp: 26, ac: 14, speed: 30, initMod: 3, saves: s(2, 3, 1, -4, 0, -3),
    actions: [atk('bite', 'Mordisco', 5, '1d8+3', 'piercing')] }),
  gnoll: mon('Gnoll', '1/2', 'infernal', { hp: 27, ac: 15, speed: 30, initMod: 1, saves: s(2, 1, 0, -2, 0, -2),
    actions: [atk('rend', 'Desgarrar', 4, '1d6+2', 'piercing'), atk('bonebow', 'Arco de hueso', 3, '1d10+1', 'piercing', 150)] }),
};

// CD 13 y toHit 5 son marcadores: el servidor los ajusta según el lanzador.
const DC = 13;
const spell = (a: Omit<Action, 'cost' | 'kind'> & Partial<Pick<Action, 'cost' | 'kind'>>): Action =>
  ({ cost: 'action', kind: 'attack', ...a });
const dexHalf = { ability: 'dex' as const, dc: DC, half: true };

export const SPELLS: Record<string, Action> = {
  'fire-bolt': spell({ id: 'fire-bolt', name: 'Descarga de fuego', range: 120, toHit: 5, damage: '1d10', damageType: 'fire' }),
  'ray-of-frost': spell({ id: 'ray-of-frost', name: 'Rayo de escarcha', range: 60, toHit: 5, damage: '1d8', damageType: 'cold' }),
  'sacred-flame': spell({ id: 'sacred-flame', name: 'Llama sagrada', kind: 'save', range: 60, save: { ability: 'dex', dc: DC, half: false },
    damage: '1d8', damageType: 'radiant' }),
  fireball: spell({ id: 'fireball', name: 'Bola de fuego', kind: 'save', range: 150, save: dexHalf, damage: '8d6', damageType: 'fire',
    area: { shape: 'sphere', size: 20 }, slot: 3 }),
  'cure-wounds': spell({ id: 'cure-wounds', name: 'Curar heridas', kind: 'heal', range: 5, damage: '2d8+3', slot: 1 }),
  'healing-word': spell({ id: 'healing-word', name: 'Palabra sanadora', kind: 'heal', cost: 'bonus', range: 60, damage: '2d4+3', slot: 1 }),
  'guiding-bolt': spell({ id: 'guiding-bolt', name: 'Saeta guía', range: 120, toHit: 5, damage: '4d6', damageType: 'radiant', slot: 1 }),
  'burning-hands': spell({ id: 'burning-hands', name: 'Manos ardientes', kind: 'save', range: 15, save: dexHalf, damage: '3d6',
    damageType: 'fire', area: { shape: 'cone', size: 15 }, slot: 1 }),
};

export * from './classes.ts';
export * from './species.ts';
