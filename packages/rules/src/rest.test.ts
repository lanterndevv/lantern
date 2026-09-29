import test from 'node:test';
import assert from 'node:assert/strict';
import { encumbrance, editionOf, exhaustionPenalty, longRest, shortRest, type CharState } from './index.ts';

const base = (): CharState => ({ hp: { cur: 10, max: 40, temp: 3 }, hitDice: { die: 8, max: 5, used: 4 }, slots: { 1: { max: 4, used: 3 } }, exhaustion: 2 });

test('descanso corto: gasta dados disponibles y cura sin pasarse del máximo', () => {
  const r = shortRest(base(), 3, { conMod: 2, rng: () => 0.5 }); // 1d8=5 → 7 por dado, solo queda 1 dado
  assert.deepEqual(r.rolls, [7]);
  assert.equal(r.state.hp.cur, 17);
  assert.equal(r.state.hitDice.used, 5);
  const x = shortRest({ ...base(), hp: { cur: 38, max: 40, temp: 0 }, hitDice: { die: 8, max: 5, used: 0 } }, 2, { conMod: 5, rng: () => 0.99 });
  assert.equal(x.state.hp.cur, 40);
  assert.equal(x.healed, 2);
  assert.equal(shortRest(base(), 1, { conMod: -5, rng: () => 0 }).healed, 0); // mín. 0
});

test('descanso largo: PG, espacios, mitad de DG (mín. 1) y agotamiento −1', () => {
  const r = longRest(base());
  assert.equal(r.hp.cur, 40);
  assert.equal(r.hp.temp, 3);
  assert.equal(r.slots![1].used, 0);
  assert.equal(r.hitDice.used, 2); // 4 − floor(5/2)
  assert.equal(r.exhaustion, 1);
  assert.equal(longRest({ ...base(), hitDice: { die: 8, max: 1, used: 1 } }).hitDice.used, 0);
  assert.equal(longRest({ ...base(), exhaustion: 0 }).exhaustion, 0);
  const down = { ...base(), hp: { cur: 0, max: 40, temp: 0 } };
  assert.equal(longRest(down), down);
});

test('edición por criatura prevalece sobre la mesa', () => {
  assert.equal(editionOf({ edition: '2014' }, '2024'), '2014');
  assert.equal(editionOf({}, '2024'), '2024');
  assert.equal(exhaustionPenalty({ exhaustion: 2, edition: '2014' }, '2024'), 0);
  assert.equal(exhaustionPenalty({ exhaustion: 2 }, '2024'), -4);
});

test('carga simple y variante', () => {
  assert.equal(encumbrance(10, 150).status, 'ok');
  assert.equal(encumbrance(10, 151).speedPenalty, Infinity);
  assert.equal(encumbrance(10, 100).status, 'ok');
  assert.deepEqual(encumbrance(10, 60, { variant: true }), { capacity: 150, status: 'encumbered', speedPenalty: 10, disadv: false });
  assert.equal(encumbrance(10, 101, { variant: true }).status, 'heavy');
  assert.equal(encumbrance(10, 50, { variant: true }).status, 'ok');
  assert.equal(encumbrance(10, 200, { size: 2 }).capacity, 300);
});
