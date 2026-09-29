// Escena de demo «Cueva del osgo» (la del diseño). La usan el seed del servidor y la demo del renderer.
import type { Action, Ability, Scene, Token, Wall } from './index.ts';
import { MONSTERS } from '@lantern/srd';

const W = (id: string, x1: number, y1: number, x2: number, y2: number, kind: Wall['kind'] = 'wall', extra: Partial<Wall> = {}): Wall =>
  ({ id, a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, kind, ...extra });

const T = (id: string, name: string, x: number, y: number, faction: Token['faction'], extra: Partial<Token> = {}): Token =>
  ({ id, name, x, y, size: 1, faction, hidden: false, owners: [], darkvision: 0, conditions: [], ...extra });

// Enemigo con estadísticas y acciones del SRD; conserva id, posición, hidden y los PG actuales de la demo.
const E = (id: string, name: string, x: number, y: number, srd: string, extra: { hidden?: boolean; cur?: number } = {}): Token => {
  const { cr: _c, type: _t, ...m } = structuredClone(MONSTERS[srd]);
  return { ...m, id, name, x, y, faction: 'enemy', hidden: extra.hidden ?? false, owners: [], srd,
    ...(m.hp && { hp: { ...m.hp, cur: Math.min(extra.cur ?? m.hp.max, m.hp.max) } }) };
};
const A = (id: string, name: string, toHit: number, damage: string, damageType: string, range = 5): Action =>
  ({ id, name, cost: 'action', kind: 'attack', range, toHit, damage, damageType });
const sv = (o: Partial<Record<Ability, number>>) => o;
const ab = (str: number, dex: number, con: number, int: number, wis: number, cha: number): Record<Ability, number> => ({ str, dex, con, int, wis, cha });

export function demoScene(): Scene {
  return {
    id: 'cueva-osgo', name: 'Cueva del osgo',
    width: 1440, height: 900, globalLight: 0,
    weather: { kind: 'fog', intensity: 0.3, wind: 0.2 },
    story: { title: 'Risco del Cuervo', subtitle: 'antes del alba' },
    grid: { size: 60, offsetX: 0, offsetY: 0, feet: 5 },
    walls: [
      // sala de guardia
      W('w1', 120, 240, 300, 240), W('w2', 360, 240, 600, 240), W('w3', 600, 240, 600, 420),
      W('w4', 600, 540, 600, 720), W('w5', 600, 720, 120, 720), W('w6', 120, 720, 120, 240),
      // sala norte
      W('w7', 180, 240, 180, 60), W('w8', 180, 60, 540, 60), W('w9', 540, 60, 540, 240),
      // pasillo
      W('w10', 600, 420, 840, 420), W('w11', 600, 540, 840, 540),
      // cámara del osgo
      W('w12', 840, 420, 840, 180), W('w13', 840, 180, 1320, 180), W('w14', 1320, 180, 1320, 780),
      W('w15', 1320, 780, 1080, 780), W('w16', 1020, 780, 840, 780), W('w17', 840, 780, 840, 540),
      W('w18', 1020, 780, 1020, 900), W('w19', 1080, 780, 1080, 900),
      // puertas
      W('d1', 300, 240, 360, 240, 'door', { open: false }),
      W('d2', 600, 420, 600, 540, 'door', { open: true }),
      W('d3', 1320, 540, 1320, 600, 'door', { open: false, secret: true }),
    ],
    lights: [
      { id: 'l1', x: 360, y: 262, bright: 120, dim: 240, color: '#ffb85c', anim: 'torch' },
      { id: 'l2', x: 1080, y: 480, bright: 180, dim: 340, color: '#ff9a3c', anim: 'torch' },
      { id: 'l3', x: 1296, y: 420, bright: 120, dim: 240, color: '#ffb85c', anim: 'torch' },
    ],
    tokens: [
      T('kael', 'Kael', 510, 570, 'ally', { darkvision: 720, hp: { cur: 19, max: 27, temp: 5 }, ac: 15, speed: 30, initMod: 2,
        saves: sv({ int: 7, wis: 4 }), prof: 3, abilities: ab(8, 14, 14, 18, 12, 10), skills: { arcana: 7, history: 7, investigation: 7, perception: 1 },
        actions: [
          A('rayo-escarcha', 'Rayo de escarcha', 7, '2d8', 'cold', 60),
          { id: 'bola-fuego', name: 'Bola de fuego', cost: 'action', kind: 'save', range: 150, save: { ability: 'dex', dc: 15, half: true }, damage: '8d6', damageType: 'fire', area: { shape: 'sphere', size: 20 }, slot: 3 },
          // ponytail: Proyectil mágico como ataque que siempre impacta (toHit 99); no es una tirada de ataque real
          { ...A('proyectil-magico', 'Proyectil mágico', 99, '3d4+3', 'force', 120), slot: 1 },
        ],
        slots: { 1: { max: 4, used: 1 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 1 } } }),
      T('ysolde', 'Ysolde', 570, 390, 'ally', { hp: { cur: 44, max: 44, temp: 0 }, ac: 18, speed: 30, initMod: 1, saves: sv({ wis: 4, cha: 6 }), prof: 3, abilities: ab(16, 10, 14, 8, 12, 16), skills: { athletics: 6, intimidation: 6, persuasion: 6, perception: 1 }, actions: [A('espada-larga', 'Espada larga', 6, '1d8+4', 'slashing')] }),
      T('brida', 'Brida', 390, 630, 'ally', { darkvision: 720, hp: { cur: 31, max: 38, temp: 0 }, ac: 18, speed: 30, initMod: 0, saves: sv({ wis: 7, cha: 4 }), prof: 3, abilities: ab(12, 10, 14, 10, 18, 12), skills: { medicine: 7, insight: 7, religion: 3, persuasion: 4, perception: 4 },
        actions: [A('maza', 'Maza', 5, '1d6+3', 'bludgeoning'),
          { id: 'palabra-sanadora', name: 'Palabra sanadora', cost: 'bonus', kind: 'heal', range: 60, damage: '1d4+3', slot: 1 }],
        slots: { 1: { max: 4, used: 0 } } }),
      T('nix', 'Nix', 750, 450, 'ally', { darkvision: 720, hp: { cur: 31, max: 33, temp: 0 }, ac: 15, speed: 30, initMod: 4, saves: sv({ dex: 7, int: 4 }), prof: 3, abilities: ab(10, 18, 12, 12, 10, 14), skills: { stealth: 10, acrobatics: 7, sleightOfHand: 7, perception: 3, deception: 5 }, // pericia (x2 competencia) en Sigilo
         actions: [A('arco-corto', 'Arco corto', 7, '1d6+4', 'piercing', 80)] }),
      E('trasgo-a', 'Trasgo A', 570, 510, 'goblin', { cur: 2 }),
      E('trasgo-b', 'Trasgo B', 930, 510, 'goblin'),
      E('hobgoblin', 'Hobgoblin', 1020, 390, 'hobgoblin'),
      E('osgo', 'Osgo', 990, 630, 'bugbear', { cur: 27 }),
      E('hobgoblin-2', 'Hobgoblin 2', 870, 690, 'hobgoblin', { hidden: true }),
      E('trasgo-c', 'Trasgo C', 450, 150, 'goblin', { hidden: true }),
    ],
  };
}
