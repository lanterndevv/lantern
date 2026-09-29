import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, filterFor, handle, joinRoom, type Room } from './room.ts';

const fakeRoll = (e: string) => { if (e === 'bad') throw new Error('x'); return { total: 7, detail: e }; };
function setup() {
  const c = createRoom('  Master ', 'ABC234');
  if ('error' in c) throw new Error(c.error);
  const p = joinRoom(c.room, 'Ana', undefined);
  if ('error' in p) throw new Error(p.error);
  return { room: c.room, dm: c.member, player: p.member, pkey: p.key! };
}
const tok = (room: Room, id: string) => room.scene.tokens.find((t) => t.id === id)!;

test('crear mesa y unirse', () => {
  const { room, dm, player } = setup();
  assert.equal(dm.role, 'dm'); assert.equal(dm.name, 'Master');
  assert.equal(player.role, 'player');
  assert.deepEqual(tok(room, 'kael').owners, [player.id]);
  assert.equal(joinRoom(room, '   ', undefined).hasOwnProperty('error'), true);
  assert.equal(joinRoom(room, 'x'.repeat(33), undefined).hasOwnProperty('error'), true);
});

test('el estado del jugador no filtra ocultos, tokens tras muros ni hp/ac enemigos', () => {
  const { room, player, dm } = setup();
  const st = filterFor(room, player);
  const names = st.scene.tokens.map((t) => t.name);
  assert.ok(!JSON.stringify(st).includes('Hobgoblin 2') && !JSON.stringify(st).includes('Trasgo C'));
  assert.ok(!names.includes('Osgo') && !names.includes('Trasgo B')); // tras muros / fuera de visión
  assert.ok(names.includes('Trasgo A'));
  for (const t of st.scene.tokens) if (t.faction !== 'ally') assert.ok(!('hp' in t) && !('ac' in t));
  assert.ok(tok({ ...room, scene: st.scene }, 'kael').hp);
  assert.ok(st.visible && st.visible.length > 0);
  // el DM lo ve todo y no recibe visible
  const d = filterFor(room, dm);
  assert.equal(d.visible, undefined);
  assert.equal(d.scene.tokens.length, room.scene.tokens.length);
});

test('la puerta secreta sale como muro', () => {
  const { room, player, dm } = setup();
  const w = filterFor(room, player).scene.walls.find((w) => w.id === 'd3')!;
  assert.equal(w.kind, 'wall'); assert.ok(!('secret' in w));
  assert.equal(filterFor(room, dm).scene.walls.find((w) => w.id === 'd3')!.kind, 'door');
});

test('el jugador no atraviesa muros ni mueve enemigos ni ajenos', () => {
  const { room, player, dm } = setup();
  // Kael (510,570) al norte cruza el muro w5/w4? destino fuera de la sala por el muro este (x=600, y 570 cerca de w4: 540-720)
  const r = handle(room, player, { t: 'moveToken', id: 'kael', x: 700, y: 600 }, fakeRoll);
  assert.ok(r.error); assert.equal(tok(room, 'kael').x, 510);
  assert.ok(handle(room, player, { t: 'moveToken', id: 'trasgo-a', x: 100, y: 100 }, fakeRoll).error);
  assert.ok(handle(room, player, { t: 'moveToken', id: 'ysolde', x: 560, y: 380 }, fakeRoll).error); // ajeno
  assert.ok(handle(room, player, { t: 'moveToken', id: 'kael', x: NaN, y: 1 }, fakeRoll).error);
  assert.ok(handle(room, player, { t: 'moveToken', id: 'kael', x: 99999, y: 1 }, fakeRoll).error);
  assert.ok(handle(room, player, { t: 'upsert', kind: 'light', item: {} }, fakeRoll).error);
  assert.ok(handle(room, player, { t: 'remove', kind: 'token', id: 'osgo' }, fakeRoll).error);
  assert.equal(handle(room, player, { t: 'moveToken', id: 'kael', x: 480, y: 600 }, fakeRoll).state, true);
  assert.equal(handle(room, dm, { t: 'moveToken', id: 'osgo', x: 480, y: 600 }, fakeRoll).state, true);
});

test('puertas: solo con token cerca', () => {
  const { room, player } = setup();
  assert.ok(handle(room, player, { t: 'door', id: 'd1', open: true }, fakeRoll).error); // Kael lejos de d1
  tok(room, 'kael').x = 330; tok(room, 'kael').y = 270;
  assert.equal(handle(room, player, { t: 'door', id: 'd1', open: true }, fakeRoll).state, true);
});

test('reconectar con key y key inválida', () => {
  const { room, player, pkey } = setup();
  const r = joinRoom(room, 'otro', pkey);
  assert.ok('member' in r && r.member.id === player.id);
  assert.notEqual(player.id, pkey);
  assert.ok('error' in joinRoom(room, 'Ana', 'nope'));
  assert.ok(!JSON.stringify([...room.members.values()]).includes(pkey)); // solo hash
});

test('chat, dados secretos y spectator', () => {
  const { room, player, dm } = setup();
  assert.ok(handle(room, player, { t: 'chat', text: '' }, fakeRoll).error);
  assert.ok(handle(room, player, { t: 'roll', expr: 'bad' }, fakeRoll).error);
  const fx = handle(room, dm, { t: 'roll', expr: '1d20', secret: true }, fakeRoll);
  assert.equal(fx.chat?.roll?.secret, true);
  const sp = { ...player, id: 's', role: 'spectator' as const };
  assert.ok(handle(room, sp, { t: 'chat', text: 'hola' }, fakeRoll).error);
});
