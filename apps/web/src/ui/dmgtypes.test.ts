import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAMAGE_ES } from '@lantern/srd';
import { DMG_TYPES, dmgColor, dmgIcon, dmgName, dmgSvg } from './dmgtypes.ts';

test('los 13 tipos de daño tienen nombre, color e icono SVG', () => {
  assert.deepEqual(Object.keys(DMG_TYPES).sort(), Object.keys(DAMAGE_ES).sort());
  assert.equal(Object.keys(DMG_TYPES).length, 13);
  for (const t of Object.keys(DMG_TYPES)) {
    assert.match(dmgColor(t), /^#[0-9A-Fa-f]{6}$/);
    assert.ok(dmgName(t) && dmgIcon(t).startsWith('<svg') && dmgSvg(t, '#fff').includes('stroke="#fff"'), t);
  }
  assert.equal(dmgIcon('nada'), '');
});
