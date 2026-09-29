/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFromLuma } from './walls-detect.ts';

// Mapa 200x200, casillas de 20: roca oscura (30) con una sala clara (200) de x 64..156, y 64..136.
// El muro (roca) entre 56 y 64 rodea la sala; las aristas de la cuadrícula en 60 y 160/140 caen dentro de él.
const W = 200, grid = { size: 20, offsetX: 0, offsetY: 0, feet: 5 };
function map(fn: (x: number, y: number) => number) {
  const l = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) l[y * W + x] = fn(x, y);
  return l;
}
const room = (x: number, y: number) => (x >= 64 && x < 157 && y >= 64 && y < 137 ? 200 : 30);

test('detecta el perímetro de una sala como 4 segmentos fusionados', () => {
  const ws = detectFromLuma(map(room), W, W, grid);
  const seg = ws.map(w => `${w.a.x},${w.a.y}-${w.b.x},${w.b.y}`).sort();
  assert.deepEqual(seg, ['160,60-160,140', '60,140-160,140', '60,60-160,60', '60,60-60,140']);
  assert.ok(ws.every(w => w.id.startsWith('auto-') && w.kind === 'wall'));
});

test('un mapa liso no produce muros', () => {
  assert.equal(detectFromLuma(map(() => 120), W, W, grid).length, 0);
});
