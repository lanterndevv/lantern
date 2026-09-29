import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inArea } from './index.ts';

const g = { size: 60, feet: 5 }, o = { x: 0, y: 0 }, east = { x: 60, y: 0 };
const at = (ft: number, ftY = 0) => ({ x: ft / 5 * 60, y: ftY / 5 * 60 });

test('esfera: radio en pies alrededor del origen', () => {
  assert.ok(inArea('sphere', o, o, 20, g, at(20)));
  assert.ok(inArea('sphere', o, o, 20, g, at(-14, 14)));
  assert.ok(!inArea('sphere', o, o, 20, g, at(15, 15)));
});

test('cubo: esquina en el origen y hacia la dirección', () => {
  assert.ok(inArea('cube', o, east, 15, g, at(15, 15)));
  assert.ok(!inArea('cube', o, east, 15, g, at(-5, 5)));
  assert.ok(inArea('cube', o, { x: -60, y: -60 }, 15, g, at(-10, -15)));
  assert.ok(!inArea('cube', o, east, 15, g, at(20, 5)));
});

test('cono de 53°: longitud y apertura', () => {
  assert.ok(inArea('cone', o, east, 30, g, at(30)));
  assert.ok(!inArea('cone', o, east, 30, g, at(35)));
  assert.ok(inArea('cone', o, east, 30, g, at(20, 9))); // atan(9/20) = 24,2° < 26,5°
  assert.ok(!inArea('cone', o, east, 30, g, at(20, 11))); // 28,8°
  assert.ok(!inArea('cone', o, east, 30, g, at(-5)));
  assert.ok(!inArea('cone', o, o, 30, g, at(5)));
});

test('línea: 5 pies de ancho', () => {
  assert.ok(inArea('line', o, east, 60, g, at(60, 2)));
  assert.ok(!inArea('line', o, east, 60, g, at(30, 3)));
  assert.ok(!inArea('line', o, east, 60, g, at(65)));
  assert.ok(inArea('line', o, { x: 0, y: 60 }, 30, g, at(2, 30)));
});
