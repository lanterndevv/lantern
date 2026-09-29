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

test('card.dice: ventaja, salvación y daño', () => {
  const adv = resolveAction(tok({ conditions: ['invisible'] }), sword, [tok()], seq(face(4, 20), face(15, 20), face(5, 8)));
  assert.deepEqual(adv.dice, [{ sides: 20, value: 4, kept: false }, { sides: 20, value: 15, kept: true }, { sides: 8, value: 5, kept: true }]);
  const save = resolveAction(tok(), { ...sword, kind: 'save', damage: '2d6', save: { ability: 'dex', dc: 12, half: true } }, [tok(), tok({ id: 'u' })], seq(face(3, 6), face(4, 6), face(9, 20), face(18, 20)));
  assert.equal(save.dice!.length, 4);
  assert.deepEqual(save.dice!.slice(2).map((d) => d.sides), [20, 20]);
});

test('brutalCrit: dados al máximo más una tirada normal; agotamiento 2024/2014 en ataques', async () => {
  const { resolveAction } = await import('./combat.ts');
  const actor: any = { id: 'a', name: 'A', conditions: [] }, tgt: any = { id: 't', name: 'T', conditions: [], ac: 10 };
  const act: any = { id: 'x', name: 'X', cost: 'action', kind: 'attack', range: 5, toHit: 5, damage: '1d8+4' };
  const seq = (...v: number[]) => () => v.shift() ?? 0;
  assert.equal(resolveAction(actor, act, [tgt], seq(0.99, 0)).targets[0].amount, 6); // 2d8+4 con mínimos
  assert.equal(resolveAction(actor, act, [tgt], seq(0.99, 0), { brutalCrit: true }).targets[0].amount, 13); // 8 + 1 + 4
  assert.equal(resolveAction(actor, act, [tgt], seq(0.5)).targets[0].attack!.total, 16);
  assert.equal(resolveAction({ ...actor, exhaustion: 2 }, act, [tgt], seq(0.5)).targets[0].attack!.total, 12);
  assert.equal(resolveAction({ ...actor, exhaustion: 2 }, act, [tgt], seq(0.5), { edition: '2014' }).targets[0].attack!.mode, 'normal');
  assert.equal(resolveAction({ ...actor, exhaustion: 3 }, act, [tgt], seq(0.5, 0.5), { edition: '2014' }).targets[0].attack!.mode, 'dis');
  assert.equal(resolveAction(actor, act, [tgt], seq(0.5, 0.5), { flank: () => true }).targets[0].attack!.mode, 'adv');
});

test('edición por criatura, desventaja 2014 en salvaciones, sentidos contra invisible y Esquivar', () => {
  const fb: Action = { id: 'f', name: 'Bola', cost: 'action', kind: 'save', range: 150, damage: '1d6', save: { ability: 'dex', dc: 10, half: true } };
  // criatura 2014 con agotamiento 3 en mesa 2024: dos d20 y se queda el menor, sin el −6 de 2024
  const s = resolveAction(tok(), fb, [tok({ edition: '2014', exhaustion: 3 })], seq(face(1, 6), face(15, 20), face(4, 20)));
  assert.deepEqual(s.dice!.slice(1).map((d) => [d.value, d.kept]), [[15, false], [4, true]]);
  assert.equal(s.targets[0].save!.total, 4);
  // atacante 2014 con agotamiento 3 en mesa 2024: desventaja y sin penalizador
  const a = resolveAction(tok({ edition: '2014', exhaustion: 3 }), sword, [tok()], seq(face(10, 20), face(10, 20), face(1, 8)));
  assert.deepEqual([a.targets[0].attack!.mode, a.targets[0].attack!.total], ['dis', 14]);
  // visión ciega al alcance anula la invisibilidad del objetivo; fuera de alcance, no
  const inv = tok({ conditions: ['invisible'], x: 60 });
  assert.equal(resolveAction(tok({ senses: { blindsight: 60 } }), sword, [inv], seq(0.5, 0.5, 0.5)).targets[0].attack!.mode, 'normal');
  assert.equal(resolveAction(tok({ senses: { blindsight: 30 } }), sword, [inv], seq(0.5, 0.5, 0.5)).targets[0].attack!.mode, 'dis');
  // Esquivar es desventaja real: la visión ciega no la anula
  assert.equal(resolveAction(tok({ senses: { blindsight: 60 } }), sword, [tok()], seq(0.5, 0.5, 0.5), { dodge: () => true }).targets[0].attack!.mode, 'dis');
});
