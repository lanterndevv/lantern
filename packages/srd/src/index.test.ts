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
