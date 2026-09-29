import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameLogRoll } from './gamelog.ts';

const c = { gameId: '77', userId: '5', entityId: '123', name: 'Willie', id: 'x', now: 1000 };

test('tirada con constante', () => {
  const m = buildGameLogRoll({ expr: '1d20+5', total: 17, dice: [{ sides: 20, value: 12, kept: true }] }, c);
  assert.equal(m.eventType, 'dice/roll/fulfilled');
  assert.equal(m.dateTime, '1000');
  assert.equal(m.messageTarget, '77');
  const r = m.data.rolls[0]!;
  assert.equal(r.diceNotation.constant, 5);
  assert.deepEqual(r.diceNotation.set, [{ count: 1, dieType: 'd20', dice: [{ dieType: 'd20', dieValue: 12 }], operation: 0 }]);
  assert.deepEqual(r.result, { constant: 5, values: [12], total: 17, text: '12+5' });
  assert.equal(r.rollKind, '');
  assert.equal(m.data.context.name, 'Willie');
});

test('ventaja y desventaja se deducen del d20 descartado', () => {
  const dice = (a: number, b: number, ka: boolean) => [{ sides: 20, value: a, kept: ka }, { sides: 20, value: b, kept: !ka }];
  assert.equal(buildGameLogRoll({ expr: '2d20kh1', total: 15, dice: dice(3, 15, false) }, c).data.rolls[0]!.rollKind, 'advantage');
  assert.equal(buildGameLogRoll({ expr: '2d20kl1', total: 3, dice: dice(15, 3, false) }, c).data.rolls[0]!.rollKind, 'disadvantage');
});

test('varios tipos de dado y constante negativa', () => {
  const m = buildGameLogRoll({ expr: '1d8+1d6-1', total: 8, dice: [{ sides: 8, value: 5, kept: true }, { sides: 6, value: 4, kept: true }] }, c);
  const r = m.data.rolls[0]!;
  assert.equal(r.diceNotation.set.length, 2);
  assert.equal(r.result.constant, -1);
  assert.equal(r.result.text, '5+4-1');
});
