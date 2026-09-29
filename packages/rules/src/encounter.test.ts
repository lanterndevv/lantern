import test from 'node:test';
import assert from 'node:assert/strict';
import { encounterDifficulty, encounterXP } from './index.ts';

test('PX por VD', () => {
  assert.equal(encounterXP(['1/4', '1/4', '2']), 550);
  assert.equal(encounterXP([]), 0);
  assert.throws(() => encounterXP(['99']));
});

test('2024: presupuesto por nivel', () => {
  const p = [3, 3, 3, 3]; // bajo 600, moderado 900, alto 1600
  assert.deepEqual(encounterDifficulty(p, ['2', '1'], '2024'), { xp: 650, rating: 'moderate' });
  assert.equal(encounterDifficulty(p, ['1'], '2024').rating, 'low');
  assert.equal(encounterDifficulty(p, ['5'], '2024').rating, 'high');
});

test('2014: umbrales y multiplicador', () => {
  const p = [1, 1, 1, 1]; // fácil 100, medio 200, difícil 300, mortal 400
  const r = encounterDifficulty(p, ['1/4', '1/4', '1/4', '1/4'], '2014'); // 200 × 2
  assert.deepEqual(r, { xp: 200, adjusted: 400, rating: 'deadly' });
  assert.equal(encounterDifficulty(p, ['1'], '2014').rating, 'medium'); // 200 × 1
  assert.equal(encounterDifficulty(p, ['1/8'], '2014').rating, 'trivial');
  assert.throws(() => encounterDifficulty([0], ['1'], '2014'));
});
