import test from 'node:test';
import assert from 'node:assert/strict';
import { clipCone, gridCells, hexCenter, hexToPx, hueShift } from './geom.ts';

const g = { type: 'hex' as const, size: 60, offsetX: 0, offsetY: 0, feet: 5 };
const sq = [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 }];
const area = (p: { x: number; y: number }[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;

test('hex: ida y vuelta, vecinos a 1, distancia', () => {
  const c = hexToPx(g, 2, -1);
  assert.deepEqual(hexCenter(g, { x: c.x + 3, y: c.y - 3 }), c);
  assert.equal(gridCells(g, hexToPx(g, 0, 0), hexToPx(g, 1, 0)), 1);
  assert.equal(gridCells(g, hexToPx(g, 0, 0), hexToPx(g, 3, -3)), 3);
  assert.equal(gridCells(g, hexToPx(g, 0, 0), hexToPx(g, 2, 2)), 4);
  assert.equal(gridCells({ ...g, type: 'square' }, { x: 0, y: 0 }, { x: 180, y: 60 }), 3);
});
test('cono: 90° recorta un cuarto, 270° son dos semiplanos que se solapan', () => {
  const o = { x: 0, y: 0 };
  assert.ok(Math.abs(area(clipCone(sq, o, 0, 90).flat()) - 10000) < 1);
  assert.equal(clipCone(sq, o, 0, 270).length, 2);
  assert.ok(clipCone(sq, o, 0, 270).reduce((s, p) => s + area(p), 0) >= 30000);
});
test('hueShift: 0° no cambia', () => assert.equal(hueShift('#ffb85c', 0), 0xffb85c));
