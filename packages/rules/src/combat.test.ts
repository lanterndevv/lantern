import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Token } from '@lantern/protocol';
import { applyCard, resolveAction } from './index.ts';

const tok = (o: Partial<Token> = {}): Token => ({
  id: 't', name: 'T', x: 0, y: 0, size: 1, faction: 'enemy', hidden: false, owners: [], darkvision: 0,
  hp: { cur: 20, max: 20, temp: 0 }, ac: 12, conditions: [], ...o,
});
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };
// rng que produce el valor de dado n en un dado de f caras
const face = (n: number, f: number) => (n - 1) / f + 0.001;
const sword: Action = { id: 's', name: 'Espada', cost: 'action', kind: 'attack', range: 5, toHit: 4, damage: '1d8+2', damageType: 'slashing' };

test('impacto y fallo', () => {
  const hit = resolveAction(tok(), sword, [tok()], seq(face(10, 20), face(5, 8)));
  assert.equal(hit.targets[0].attack!.hit, true);
  assert.equal(hit.targets[0].amount, 7);
  const miss = resolveAction(tok(), sword, [tok()], seq(face(2, 20), face(5, 8)));
  assert.equal(miss.targets[0].attack!.hit, false);
  assert.equal(miss.targets[0].amount, 0);
});

test('crítico duplica dados', () => {
  const c = resolveAction(tok(), sword, [tok()], seq(face(20, 20), face(3, 8), face(4, 8)));
  assert.equal(c.targets[0].attack!.crit, true);
  assert.equal(c.targets[0].amount, 3 + 4 + 2);
});

test('salvación con mitad y fallo automático de DES', () => {
  const fb: Action = { id: 'f', name: 'Bola', cost: 'action', kind: 'save', range: 150, damage: '8d6', damageType: 'fire',
    save: { ability: 'dex', dc: 13, half: true } };
  const c = resolveAction(tok(), fb, [tok({ id: 'a' }), tok({ id: 'b', conditions: ['paralyzed'] })], seq(...Array(8).fill(face(4, 6)), face(15, 20), face(20, 20)));
  const [a, b] = c.targets;
  assert.equal(a.save!.success, true);
  assert.equal(b.amount, 32);
  assert.equal(a.amount, 16);
  assert.equal(b.save!.success, false);
});

test('applyCard con resistencia, half y none', () => {
  const card = resolveAction(tok(), sword, [tok()], seq(face(10, 20), face(8, 8))); // 10 daño
  const t = tok({ defenses: { resist: ['slashing'] } });
  assert.equal(applyCard(card, [t], 'full')[0].hp!.cur, 15);
  assert.equal(applyCard(card, [tok()], 'half')[0].hp!.cur, 15);
  assert.equal(applyCard(card, [t], 'none')[0].hp!.cur, 20);
});
