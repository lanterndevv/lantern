import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocksMove } from '@lantern/protocol';
import { visibility, pointInPolygon, sightSegments, cover } from './index.ts';

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

test('cobertura: libre, media, tres cuartos y total', () => {
  const from = { x: 0, y: 0 }, to = { x: 100, y: 0 };
  const wall = (y1: number, y2: number) => sightSegments([{ id: 'w', kind: 'wall', a: { x: 50, y: y1 }, b: { x: 50, y: y2 } }]);
  assert.equal(cover(from, to, 10, []), 0);
  assert.equal(cover(from, to, 10, wall(0.5, 100)), 2); // tapa las 2 esquinas de abajo
  assert.equal(cover(from, to, 10, wall(-3, 100)), 5); // centro + 2 esquinas
  assert.equal(cover(from, to, 10, wall(-100, 100)), 'total');
  const win = [{ id: 'v', kind: 'window' as const, a: { x: 50, y: -100 }, b: { x: 50, y: 100 } }];
  assert.equal(cover(from, to, 10, sightSegments(win)), 0);
});

import { perceives } from './index.ts';

test('muros invisible/ethereal y de una dirección', () => {
  const w = (kind: 'invisible' | 'ethereal' | 'wall', oneWay?: 'left' | 'right') => ({ id: 'w', kind, oneWay, a: { x: 50, y: 0 }, b: { x: 50, y: 100 } });
  const from = { x: 10, y: 50 }; // cruce a→b positivo para x<50 → lado 'left'
  assert.equal(sightSegments([w('invisible')]).length, 1);
  assert.equal(blocksMove(w('invisible')), false);
  assert.equal(sightSegments([w('ethereal')]).length, 0);
  assert.equal(blocksMove(w('ethereal')), true);
  assert.equal(sightSegments([w('wall', 'left')], from).length, 1);
  assert.equal(sightSegments([w('wall', 'right')], from).length, 0);
  assert.equal(sightSegments([w('wall', 'right')], { x: 90, y: 50 }).length, 1);
});

test('sentidos: oscuridad, mágica, invisibles, blindsight y tremorsense', () => {
  const at = (x: number, extra: object = {}, conditions: string[] = []) => ({ x, y: 0, conditions, ...extra });
  const v = (o: object = {}) => ({ x: 0, y: 0, darkvision: 0, ...o });
  const dk = { light: 'dark' as const, los: true };
  assert.ok(perceives(v(), at(50), { light: 'dim', los: true }));
  assert.ok(!perceives(v(), at(50), dk));
  assert.ok(perceives(v({ darkvision: 60 }), at(60), dk));
  assert.ok(!perceives(v({ darkvision: 60 }), at(61), dk));
  assert.ok(!perceives(v({ darkvision: 60 }), at(10), { light: 'magic', los: true }));
  assert.ok(perceives(v({ senses: { devilsSight: 60 } }), at(10), { light: 'magic', los: true }));
  assert.ok(perceives(v({ senses: { truesight: 60 } }), at(10, {}, ['invisible']), { light: 'magic', los: true }));
  assert.ok(!perceives(v({ darkvision: 60 }), at(10, {}, ['invisible']), { light: 'bright', los: true }));
  assert.ok(perceives(v({ senses: { blindsight: 30 } }), at(20, {}, ['invisible']), dk));
  assert.ok(!perceives(v({ senses: { tremorsense: 30 } }), at(20, { grounded: false }), dk));
  assert.ok(perceives(v({ senses: { tremorsense: 30 } }), at(20), dk));
  assert.ok(!perceives(v({ senses: { blindsight: 30 } }), at(20), { light: 'dark', los: false }));
});
