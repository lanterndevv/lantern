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
  // grupo pequeño: 2 PJ nv1 (fácil 50, medio 100, difícil 150, mortal 200), 1 monstruo VD 1/2 = 100 × 1.5 = 150
  assert.deepEqual(encounterDifficulty([1, 1], ['1/2'], '2014'), { xp: 100, adjusted: 150, rating: 'hard' });
  // grupo grande: 6 PJ nv1 (medio 300), 1 monstruo VD 2 = 450 × 0.5 = 225 -> fácil (150) pero no medio
  assert.deepEqual(encounterDifficulty([1, 1, 1, 1, 1, 1], ['2'], '2014'), { xp: 450, adjusted: 225, rating: 'easy' });
  // 3 monstruos, grupo de 4 nv5 (medio 2000, difícil 3000): 3×700... VD 3 = 2100 × 2 = 4200 -> difícil
  assert.equal(encounterDifficulty([5, 5, 5, 5], ['3', '3', '3'], '2014').rating, 'hard');
});
