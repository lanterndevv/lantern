/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBeyond20, parseBeyond20All } from './beyond20.ts';

const d = (faces: number, ...rolls: number[]) => ({ formula: `${rolls.length}d${faces}`, amount: rolls.length, faces, total: rolls.reduce((a, b) => a + b, 0), rolls: rolls.map(roll => ({ roll })) });
const roll = (parts: any[], total: number, formula: string, extra = {}) => ({ formula, parts, total, ...extra });
const base = { action: 'rendered-roll', character: { name: 'Thorin' } };

test('ataque con daño → dos tiradas', () => {
  const r = parseBeyond20All({
    ...base, title: 'Longsword', request: { type: 'attack', whisper: 0 },
    attack_rolls: [roll([d(20, 14), '+', 5], 19, '1d20 + 5')],
    damage_rolls: [['Slashing', roll([d(8, 6), '+', 3], 9, '1d8 + 3'), 1], ['Fire', roll([d(6, 4)], 4, '1d6'), 4], ['nota', roll([], 0, ''), 0]],
  });
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { name: 'Longsword (Thorin)', expr: '1d20 + 5', total: 19, dice: [{ sides: 20, value: 14, kept: true }], kind: 'attack' });
  assert.equal(r[1].total, 13);
  assert.equal(r[1].expr, '1d8 + 3 Slashing + 1d6 Fire');
  assert.deepEqual(r[1].dice.map(x => x.value), [6, 4]);
  assert.equal(r[1].kind, 'damage');
});

test('salvación con ventaja: el dado descartado sale como no conservado', () => {
  const r = parseBeyond20({
    ...base, title: 'DEX Save', request: { type: 'saving-throw' },
    attack_rolls: [roll([d(20, 7), '+', 2], 9, '1d20 + 2', { discarded: true }), roll([d(20, 16), '+', 2], 18, '1d20 + 2')],
  })!;
  assert.equal(r.total, 18);
  assert.equal(r.kind, 'saving-throw');
  assert.deepEqual(r.dice.map(x => x.kept), [false, true]);
});

test('habilidad e iniciativa', () => {
  const s = parseBeyond20({ ...base, title: 'Stealth', request: { type: 'skill' }, attack_rolls: [roll([d(20, 11), '+', 7], 18, '1d20 + 7')] })!;
  assert.equal(s.kind, 'skill');
  const i = parseBeyond20({ ...base, title: 'Initiative', request: { type: 'initiative' }, attack_rolls: [roll([d(20, 3), '+', 2], 5, '1d20 + 2')] })!;
  assert.deepEqual([i.kind, i.total, i.name], ['initiative', 5, 'Initiative (Thorin)']);
});

test('descartes: susurro, no rendered-roll, sin tiradas, basura', () => {
  const ok = { ...base, title: 'x', attack_rolls: [roll([d(20, 1)], 1, '1d20')] };
  assert.equal(parseBeyond20({ ...ok, request: { whisper: 1 } }), null);
  assert.equal(parseBeyond20({ ...ok, action: 'roll' }), null);
  assert.equal(parseBeyond20({ ...base, title: 'x' }), null);
  assert.equal(parseBeyond20(undefined), null);
  assert.equal(parseBeyond20('x'), null);
});
