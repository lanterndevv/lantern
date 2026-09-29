import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roll } from '@lantern/rules';
import { MONSTERS, SPELLS } from './index.ts';

test('todas las acciones tienen daño válido para roll', () => {
  for (const [id, m] of Object.entries(MONSTERS)) {
    for (const a of m.actions ?? []) assert.doesNotThrow(() => roll(a.damage!), `${id}/${a.id}`);
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

import { PREGENS, levelUp, SPELL_INDEX } from './index.ts';

test('catálogo SRD completo', () => {
  assert.ok(Object.keys(MONSTERS).length >= 300, 'monstruos');
  assert.ok(Object.keys(SPELL_INDEX).length >= 300, 'conjuros');
  assert.equal(MONSTERS.goblin.name, 'Trasgo'); // lo hecho a mano prevalece
  assert.equal(SPELLS.fireball.name, 'Bola de fuego');
  assert.ok(SPELLS['magic-missile'] === undefined || SPELLS['magic-missile'].damage);
});

test('pregenerados de nivel 1 coherentes', () => {
  assert.equal(Object.keys(PREGENS).length, 6);
  const f = PREGENS.fighter;
  assert.equal(f.hp!.max, 12); // d10 + CON 14 (+2)
  assert.equal(f.actions![0].toHit, 4); // +2 competencia +2 FUE
  assert.equal(f.saves!.str, 4);
  const w = PREGENS.wizard;
  assert.equal(w.hp!.max, 7);
  assert.deepEqual(w.slots, { 1: { max: 2, used: 0 } });
  assert.equal(w.actions!.find((x) => x.id === 'fire-bolt')!.toHit, 4);
  for (const p of Object.values(PREGENS)) for (const x of p.actions!) assert.doesNotThrow(() => roll(x.damage!), p.name);
});

test('levelUp: PG medios/tirada, dado, espacios y mejora de característica', () => {
  const w = PREGENS.wizard;
  const ch = { level: 1, hp: w.hp!, abilities: w.abilities!, slots: { 1: { max: 2, used: 2 } }, hitDice: w.hitDice };
  const r = levelUp(ch, 'wizard'); // d6 medio 4 + CON 13 (+1)
  assert.equal(r.hpGain, 5);
  assert.equal(r.char.hp.max, 12);
  assert.equal(r.char.hitDice!.max, 2);
  assert.deepEqual(r.char.slots, { 1: { max: 3, used: 2 } });
  assert.equal(r.asi, false);
  assert.equal(levelUp(ch, 'wizard', { hp: 'roll', rng: () => 0.99 }).hpGain, 7);
  assert.equal(levelUp({ ...ch, level: 3 }, 'wizard').asi, true);
  assert.equal(levelUp({ ...ch, level: 5 }, 'fighter').asi, true);
  assert.equal(levelUp({ ...ch, level: 5 }, 'fighter').char.slots, ch.slots); // sin conjuros: no toca los espacios
  assert.equal(levelUp({ ...ch, abilities: { ...ch.abilities, con: 1 } }, 'wizard').hpGain, 1); // mín. 1
  assert.throws(() => levelUp({ ...ch, level: 20 }, 'wizard'));
  assert.throws(() => levelUp(ch, 'nope'));
});
