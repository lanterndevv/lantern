import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, clipCone, gridCells, hexCenter, hexCorners, hexToPx, hueShift, snapPoint } from './geom.ts';

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

test('hex: el imán va a la esquina del hexágono y el calibrado recupera la cuadrícula', () => {
  const c = hexToPx(g, 1, 1), v = hexCorners(g, c);
  assert.deepEqual(snapPoint(g, { x: v[2].x + 2, y: v[2].y - 2 }), v[2]);
  assert.ok(v.every((q) => Math.abs(Math.hypot(q.x - c.x, q.y - c.y) - 60 / Math.sqrt(3)) < 1e-9));
  assert.deepEqual(snapPoint({ ...g, type: 'square' }, { x: 62, y: 118 }), { x: 60, y: 120 });
  // rectángulo de 2 casillas × 2 filas que empieza en la casilla (q,r)=(1,2) de una cuadrícula con desfase
  const g2 = { ...g, size: 70, offsetX: 13, offsetY: 9 }, tl = hexToPx(g2, 1, 2), R = 70 / Math.sqrt(3);
  const x0 = tl.x - 35, y0 = tl.y - R, cal = calibrate(g2, { x: x0, y: y0 }, { x: x0 + 140, y: y0 + 2 * 1.5 * R });
  assert.ok(Math.abs(cal.size - 70) < 1e-9);
  const c2 = { ...g2, ...cal };
  assert.ok(Math.hypot(hexToPx(c2, 1, 2).x - tl.x, hexToPx(c2, 1, 2).y - tl.y) < 1e-6); // la casilla elegida cae donde estaba
  assert.equal(calibrate({ ...g, type: 'square' }, { x: 10, y: 10 }, { x: 150, y: 150 }).size, 70);
});
