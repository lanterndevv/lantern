import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brushPolygon, simplify } from './brush.ts';
import { pointInPolygon } from './index.ts';

test('simplify quita los puntos alineados', () => {
  const line = Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: i % 2 ? 0.2 : 0 }));
  assert.equal(simplify(line, 1).length, 2);
});

test('un lazo cerrado se rellena y un trazo abierto se engrosa', () => {
  const circle = Array.from({ length: 200 }, (_, i) => ({ x: 300 + 100 * Math.cos(i / 199 * 2 * Math.PI), y: 300 + 100 * Math.sin(i / 199 * 2 * Math.PI) }));
  const a = brushPolygon(circle, 20)!;
  assert.ok(a.length >= 3 && a.length <= 60 && pointInPolygon({ x: 300, y: 300 }, a));
  const line = Array.from({ length: 50 }, (_, i) => ({ x: 100 + i * 10, y: 100 }));
  const b = brushPolygon(line, 20)!;
  assert.ok(pointInPolygon({ x: 300, y: 110 }, b) && !pointInPolygon({ x: 300, y: 150 }, b));
  assert.equal(brushPolygon([{ x: 1, y: 1 }], 20), null);
});
