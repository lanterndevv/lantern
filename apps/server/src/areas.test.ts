import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPELLS } from '@lantern/srd';
import { createRoom, handle } from './room.ts';

const roll = (e: string) => ({ total: 7, detail: e });

test('áreas persistentes: Nube aniquiladora crea región con duración y sourceId; romper la concentración la borra', () => {
  const c = createRoom('Master', 'ABC234');
  if ('error' in c) throw new Error(c.error);
  const { room, member: dm } = c, kael = room.scene.tokens.find((t) => t.id === 'kael')!;
  kael.slots = { 5: { max: 1, used: 0 } };
  kael.actions = [{ ...SPELLS.cloudkill, id: 'cloudkill' }];
  room.combat = { round: 2, turn: 0, order: [{ tokenId: 'kael', init: 10 }], used: {} };
  const fx = handle(room, dm, { t: 'act', tokenId: 'kael', actionId: 'cloudkill', targets: [], at: { x: kael.x + 120, y: kael.y } }, roll);
  assert.equal(fx.error, undefined);
  const r = room.scene.regions!.find((x) => x.name === kael.actions![0].name)!;
  assert.deepEqual([r.kind, r.trigger, r.untilRound, r.sourceId, r.damage], ['trap', 'turnStart', 102, 'conc:kael', '5d8']);
  const banner = fx.sends!.find((s) => s.msg.t === 'spellBanner')!.msg as { school?: string };
  assert.equal(banner.school, 'conjuration');
  handle(room, dm, { t: 'condition', tokenId: 'kael', condition: 'unconscious', on: true } as never, roll);
  assert.equal((room.scene.regions ?? []).some((x) => x.sourceId === 'conc:kael'), false);
});
