import test from 'node:test';
import assert from 'node:assert/strict';
import * as r from './index.ts';

const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };
// rng que produce la cara f en un dado de m caras
const face = (f: number, m: number) => (f - 1) / m;

test('roll básico con constante y espacios/mayúsculas', () => {
  const x = r.roll('1D20 + 7', seq(face(14, 20)));
  assert.equal(x.total, 21);
  assert.equal(x.detail, '1d20+7 → [14]+7 = 21');
});

test('roll ventaja kh y desventaja kl', () => {
  const a = r.roll('2d20kh1', seq(face(5, 20), face(17, 20)));
  assert.equal(a.total, 17);
  assert.match(a.detail, /\[~~5~~,17\]/);
  assert.equal(r.roll('2d20kl1', seq(face(5, 20), face(17, 20))).total, 5);
});

test('roll resta y d sin N', () => {
  assert.equal(r.roll('d6-2+2d4', seq(face(6, 6), face(1, 4), face(2, 4))).total, 6 - 2 + 3);
});

test('roll valida', () => {
  for (const bad of ['', 'abc', '101d6', '1d1', '1d1001', '2d20kh3', '1d6++2', '1d6+', '0d6', ...[Array(21).fill('1').join('+')]])
    assert.throws(() => r.roll(bad), Error, bad);
  assert.equal(r.roll(Array(20).fill('1').join('+')).total, 20);
});

test('attackMode derribado cerca y lejos', () => {
  assert.equal(r.attackMode([], ['prone'], { ranged: false, within5ft: true }), 'adv');
  assert.equal(r.attackMode([], ['prone'], { ranged: false, within5ft: false }), 'dis');
  assert.equal(r.attackMode([], ['prone'], { ranged: true, within5ft: true }), 'dis');
});

test('attackMode cancelación y condiciones', () => {
  const o = { ranged: false, within5ft: true };
  assert.equal(r.attackMode(['poisoned'], ['stunned'], o), 'normal');
  assert.equal(r.attackMode(['invisible'], [], o), 'adv');
  assert.equal(r.attackMode([], ['invisible'], o), 'dis');
  assert.equal(r.attackMode(['frightened'], [], o), 'dis');
});

test('autoFailSave y autoCrit', () => {
  assert.equal(r.autoFailSave(['stunned'], 'dex'), true);
  assert.equal(r.autoFailSave(['stunned'], 'wis'), false);
  assert.equal(r.autoFailSave([], 'str'), false);
  assert.equal(r.autoCrit(['paralyzed'], true), true);
  assert.equal(r.autoCrit(['paralyzed'], false), false);
  assert.equal(r.autoCrit(['stunned'], true), false);
});

test('applyDamage con temporales y resistencia', () => {
  const x = r.applyDamage({ cur: 10, max: 20, temp: 4 }, 15, 'fire', { resist: ['fire'] });
  assert.equal(x.taken, 7);
  assert.deepEqual(x.hp, { cur: 7, max: 20, temp: 0 });
  assert.equal(r.applyDamage({ cur: 10, max: 20, temp: 0 }, 9, 'fire', { immune: ['fire'] }).taken, 0);
  // resistencia y vulnerabilidad no se anulan: se aplican en orden (SRD 5.2.1), 3 → 1 → 2
  assert.equal(r.applyDamage({ cur: 10, max: 20, temp: 0 }, 3, 'fire', { resist: ['fire'], vuln: ['fire'] }).taken, 2);
  assert.equal(r.applyDamage({ cur: 10, max: 20, temp: 0 }, 5, 'cold', { vuln: ['cold'] }).hp.cur, 0);
  assert.equal(r.applyDamage({ cur: 3, max: 20, temp: 0 }, 99, 'x').hp.cur, 0);
});

test('heal, grantTemp, saveDamage', () => {
  assert.equal(r.heal({ cur: 18, max: 20, temp: 0 }, 9).cur, 20);
  assert.equal(r.grantTemp({ cur: 1, max: 5, temp: 8 }, 5).temp, 8);
  assert.equal(r.grantTemp({ cur: 1, max: 5, temp: 3 }, 5).temp, 5);
  assert.equal(r.saveDamage(11, true), 5);
  assert.equal(r.saveDamage(11, true, false), 0);
  assert.equal(r.saveDamage(11, false), 11);
});

test('concentrationDC', () => {
  assert.equal(r.concentrationDC(4), 10);
  assert.equal(r.concentrationDC(31), 15);
  assert.equal(r.concentrationDC(200), 30);
});

test('deathSave', () => {
  const z = { successes: 0, failures: 0 };
  assert.deepEqual(r.deathSave(z, 20), { state: z, stable: false, dead: false, revived: true, hp: 1 });
  assert.equal(r.deathSave(z, 1).state.failures, 2);
  assert.equal(r.deathSave({ successes: 0, failures: 2 }, 1).dead, true);
  assert.equal(r.deathSave(z, 5).state.failures, 1);
  assert.equal(r.deathSave({ successes: 2, failures: 0 }, 10).stable, true);
});

test('abilityMod, proficiencyBonus, agotamiento, condiciones', () => {
  assert.equal(r.abilityMod(9), -1);
  assert.equal(r.abilityMod(20), 5);
  assert.equal(r.proficiencyBonus(1), 2);
  assert.equal(r.proficiencyBonus(5), 3);
  assert.equal(r.proficiencyBonus(17), 6);
  assert.equal(r.d20Penalty(3, '2024'), -6);
  assert.equal(r.d20Penalty(3, '2014'), 0);
  assert.equal(r.exhaustion2014Effects(0).length, 0);
  assert.equal(r.exhaustion2014Effects(2).length, 2);
  assert.equal(Object.keys(r.CONDITIONS).length, 16);
  assert.equal(r.CONDITIONS.blinded, 'Cegado');
});

test('roll devuelve dice con kept', () => {
  const d = r.roll('2d20kh1+1d6+2', seq(0.9, 0.1, 0.5)).dice; // 19, 3, 4
  assert.deepEqual(d, [{ sides: 20, value: 19, kept: true }, { sides: 20, value: 3, kept: false }, { sides: 6, value: 4, kept: true }]);
  assert.equal(r.roll('5').dice.length, 0);
});

test('roll variables @str/@prof/@lvl (negativos incluidos)', () => {
  const ctx = r.diceContext({ abilities: { str: 8, dex: 16, con: 10, int: 10, wis: 10, cha: 10 }, prof: 3, lvl: 9 });
  assert.equal(r.roll('1d20+@dex+@prof', seq(face(10, 20)), ctx).total, 10 + 3 + 3);
  assert.equal(r.roll('1d20+@str', seq(face(10, 20)), ctx).total, 9);
  assert.equal(r.roll('1d20-@str', seq(face(10, 20)), ctx).total, 11);
  assert.equal(r.roll('@lvld6', seq(face(1, 6)), ctx).dice.length, 9);
  assert.throws(() => r.roll('1d20+@foo', Math.random, ctx), /@foo/);
});

test('roll explosión d6!', () => {
  const x = r.roll('1d6!', seq(face(6, 6), face(6, 6), face(2, 6)));
  assert.equal(x.total, 14);
  assert.equal(x.dice.length, 3);
  assert.equal(r.roll('1d2!', () => 0.99).dice.length, 100); // tope de dados
});

test('roll repetición N#', () => {
  const x = r.roll('3#1d20+5', seq(face(1, 20), face(10, 20), face(20, 20)));
  assert.deepEqual(x.totals, [6, 15, 25]);
  assert.equal(x.total, 46);
  assert.equal(x.dice.length, 3);
  assert.throws(() => r.roll('21#1d4'));
  assert.throws(() => r.roll('20#6d6'), /Demasiados dados/);
});

test('roll reroll rN y min/max', () => {
  const x = r.roll('2d6r2', seq(face(1, 6), face(5, 6), face(4, 6)));
  assert.equal(x.total, 9);
  assert.deepEqual(x.dice.map((d) => d.kept), [false, true, true]);
  assert.equal(r.roll('2d6min3', seq(face(1, 6), face(5, 6))).total, 8);
  assert.equal(r.roll('2d6max4', seq(face(6, 6), face(2, 6))).total, 6);
  assert.equal(r.roll('4d6r1kh3min2', seq(face(1, 6), face(1, 6), face(4, 6), face(6, 6), face(5, 6))).total, 15);
});
