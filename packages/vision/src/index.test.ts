import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibility, pointInPolygon, sightSegments } from './index.ts';

test('un muro tapa lo que hay detrás', () => {
  const walls = [{ id: 'w', kind: 'wall' as const, a: { x: 50, y: 0 }, b: { x: 50, y: 60 } }];
  const poly = visibility({ x: 10, y: 30 }, sightSegments(walls), 100, 100);
  assert.ok(pointInPolygon({ x: 30, y: 30 }, poly), 'delante del muro se ve');
  assert.ok(!pointInPolygon({ x: 80, y: 30 }, poly), 'detrás del muro no');
  assert.ok(pointInPolygon({ x: 80, y: 90 }, poly), 'por debajo del muro sí');
});

test('puerta abierta no bloquea', () => {
  const walls = [{ id: 'd', kind: 'door' as const, open: true, a: { x: 50, y: 0 }, b: { x: 50, y: 100 } }];
  const poly = visibility({ x: 10, y: 50 }, sightSegments(walls), 100, 100);
  assert.ok(pointInPolygon({ x: 80, y: 50 }, poly));
});
