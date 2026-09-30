import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoScene } from './demo.ts';
import type { Region } from './index.ts';
import { opportunities, routeCost, speedFor } from './move.ts';

const s = { ...demoScene(), regions: [] as Region[] }, kael = s.tokens.find((t) => t.id === 'kael')!, foe = s.tokens.find((t) => t.id === 'trasgo-a')!;
const p = (x: number, y: number) => ({ x, y });

test('routeCost: diagonales 5-5-5, 5/10/5 y euclídea', () => {
  const diag = [p(0, 0), p(240, 240)]; // 4 casillas en diagonal
  assert.equal(routeCost(s, kael, diag).feet, 20);
  assert.equal(routeCost(s, kael, diag, { diagonal: 'alt' }).feet, 30);
  assert.ok(Math.abs(routeCost(s, kael, diag, { diagonal: 'euclid' }).feet - 4 * Math.SQRT2 * 5) < 1e-9);
  assert.equal(routeCost(s, kael, [p(0, 0), p(120, 120), p(120, 240)], { diagonal: 'alt' }).feet, 5 + 10 + 5 + 5); // 2 diagonales (5+10) y 2 rectas; el contador sigue entre tramos
});

test('routeCost: terreno difícil por tramo, y no en vuelo; nadar sin velocidad cuesta el doble', () => {
  const sc = structuredClone(s);
  sc.regions = [{ id: 'd', name: 'D', kind: 'difficult', hidden: false, points: [p(120, 0), p(240, 0), p(240, 120), p(120, 120)] }];
  const r = routeCost(sc, kael, [p(30, 60), p(390, 60)]); // 2 casillas dentro de 6
  assert.equal(r.feet, 5 * 4 + 10 * 2);
  assert.equal(r.legs[0].difficult, true);
  assert.equal(routeCost(sc, kael, [p(30, 60), p(390, 60)], { mode: 'fly' }).feet, 30);
  assert.equal(routeCost(sc, kael, [p(30, 60), p(390, 60)], { mode: 'swim' }).feet, 80); // ×2 del terreno difícil y ×2 por nadar sin velocidad
  assert.equal(routeCost(s, kael, [p(0, 0), p(60, 0), p(60, 60)]).feet, 10); // puntos de paso: se suman los tramos
});

test('speedFor: modos y velocidades del token', () => {
  assert.equal(speedFor(kael, 'walk'), 30);
  assert.equal(speedFor(kael, 'fly'), null);
  assert.equal(speedFor({ ...kael, speeds: { fly: 60, swim: 20 } }, 'fly'), 60);
  assert.equal(speedFor(kael, 'climb'), 30); // sin velocidad propia: la de andar (a doble coste)
});

test('speedFor: condiciones y agotamiento según la edición', () => {
  assert.equal(speedFor({ ...kael, conditions: ['grappled'] }, 'walk'), 0);
  assert.equal(speedFor({ ...kael, conditions: ['stunned'] }, 'walk', '2014'), 0);
  assert.equal(speedFor({ ...kael, conditions: ['stunned'] }, 'walk', '2024'), 30);
  assert.equal(speedFor({ ...kael, exhaustion: 2 }, 'walk', '2014'), 15);
  assert.equal(speedFor({ ...kael, exhaustion: 5 }, 'walk', '2014'), 0);
  assert.equal(speedFor({ ...kael, exhaustion: 3 }, 'walk', '2024'), 15);
  assert.equal(speedFor({ ...kael, exhaustion: 2, edition: '2014' }, 'walk', '2024'), 15); // la del token prevalece
  assert.equal(speedFor({ ...kael, conditions: ['grappled'] }, 'fly'), null); // sin ese modo sigue siendo null
});

test('routeCost: hex cuenta casillas hexagonales y sin cuadrícula es euclídea', () => {
  const hx = { ...s, grid: { ...s.grid, type: 'hex' as const } }, row = 60 * Math.sqrt(3) / 2;
  assert.equal(routeCost(hx, kael, [p(0, 0), p(180, 0)], { diagonal: 'alt' }).feet, 15);
  assert.ok(Math.abs(routeCost(hx, kael, [p(0, 0), p(30, row), p(0, 2 * row)]).feet - 10) < 1e-9); // zigzag = recta (2 filas)
  assert.ok(Math.abs(routeCost(hx, kael, [p(0, 0), p(0, 2 * row)]).feet - 10) < 1e-9);
  const none = { ...s, grid: { ...s.grid, type: 'none' as const } };
  assert.ok(Math.abs(routeCost(none, kael, [p(0, 0), p(240, 240)]).feet - 4 * Math.SQRT2 * 5) < 1e-9);
});

test('opportunities: solo enemigos cuyo alcance abandona la ruta', () => {
  const near = { ...kael, x: 510, y: 570 }, f = { ...foe, x: 570, y: 510 };
  assert.equal(opportunities(s, near, [p(510, 570), p(450, 630)], [f]).length, 1);
  assert.equal(opportunities(s, near, [p(510, 570), p(570, 570)], [f]).length, 0); // sigue a su alcance
  assert.equal(opportunities(s, near, [p(510, 570), p(450, 630)], [{ ...f, conditions: ['paralyzed'] }]).length, 0);
  assert.equal(opportunities(s, near, [p(510, 570), p(450, 630)], [{ ...f, faction: 'ally' as const }]).length, 0);
  assert.equal(opportunities(s, { ...near, x: 300, y: 570 }, [p(300, 570), p(240, 570)], [f]).length, 0); // nunca estuvo a su alcance
  assert.equal(opportunities(s, near, [p(510, 570), p(570, 570), p(690, 570)], [f])[0].leg, 1); // sale en el segundo tramo
});
