import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roll } from '@lantern/rules';
import { MONSTERS, SPELLS } from './index.ts';

test('todas las acciones tienen daño válido para roll', () => {
  for (const [id, m] of Object.entries(MONSTERS)) {
    assert.ok(m.actions?.length, id);
    for (const a of m.actions!) assert.doesNotThrow(() => roll(a.damage!), `${id}/${a.id}`);
  }
  for (const [id, a] of Object.entries(SPELLS)) assert.doesNotThrow(() => roll(a.damage!), id);
});

import { CLASSES, SPECIES } from './index.ts';

test('clases: tablas de espacios bien formadas y arma válida para roll', () => {
  assert.equal(Object.keys(CLASSES).length, 12);
  assert.equal(Object.keys(SPECIES).length, 9);
  for (const [id, k] of Object.entries(CLASSES)) {
    assert.equal(k.slots.length, 20, id);
    let prev = 0;
    k.slots.forEach((r, i) => {
      assert.ok(r.length <= 9 && r.every(n => Number.isInteger(n) && n >= 0), `${id} nv${i + 1}`);
      const t = r.reduce((a, b) => a + b, 0);
      assert.ok(t >= prev, `${id} nv${i + 1} decrece`); prev = t;
    });
    assert.equal(k.slots[19].length > 0, !!k.cast, id);
    assert.doesNotThrow(() => roll(k.weapon.damage!), id);
  }
});
