// Escena de demo «Cueva del osgo» (la del diseño). La usan el seed del servidor y la demo del renderer.
import type { Scene, Token, Wall } from './index.ts';

const W = (id: string, x1: number, y1: number, x2: number, y2: number, kind: Wall['kind'] = 'wall', extra: Partial<Wall> = {}): Wall =>
  ({ id, a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, kind, ...extra });

const T = (id: string, name: string, x: number, y: number, faction: Token['faction'], extra: Partial<Token> = {}): Token =>
  ({ id, name, x, y, size: 1, faction, hidden: false, owners: [], darkvision: 0, conditions: [], ...extra });

export function demoScene(): Scene {
  return {
    id: 'cueva-osgo', name: 'Cueva del osgo',
    width: 1440, height: 900, globalLight: 0,
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
      T('kael', 'Kael', 510, 570, 'ally', { darkvision: 720, hp: { cur: 19, max: 27, temp: 5 }, ac: 15 }),
      T('ysolde', 'Ysolde', 570, 390, 'ally', { hp: { cur: 44, max: 44, temp: 0 }, ac: 18 }),
      T('brida', 'Brida', 390, 630, 'ally', { darkvision: 720, hp: { cur: 31, max: 38, temp: 0 }, ac: 18 }),
      T('nix', 'Nix', 750, 450, 'ally', { darkvision: 720, hp: { cur: 31, max: 33, temp: 0 }, ac: 15 }),
      T('trasgo-a', 'Trasgo A', 570, 510, 'enemy', { hp: { cur: 2, max: 7, temp: 0 }, ac: 15 }),
      T('trasgo-b', 'Trasgo B', 930, 510, 'enemy', { hp: { cur: 7, max: 7, temp: 0 }, ac: 15 }),
      T('hobgoblin', 'Hobgoblin', 1020, 390, 'enemy', { hp: { cur: 11, max: 11, temp: 0 }, ac: 18 }),
      T('osgo', 'Osgo', 990, 630, 'enemy', { hp: { cur: 27, max: 27, temp: 0 }, ac: 16 }),
      T('hobgoblin-2', 'Hobgoblin 2', 870, 690, 'enemy', { hidden: true, hp: { cur: 11, max: 11, temp: 0 }, ac: 18 }),
      T('trasgo-c', 'Trasgo C', 450, 150, 'enemy', { hidden: true, hp: { cur: 7, max: 7, temp: 0 }, ac: 15 }),
    ],
  };
}
