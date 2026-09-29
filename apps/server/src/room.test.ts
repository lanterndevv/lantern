import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatFor, createRoom, filterFor, handle, joinRoom, redact, type Room } from './room.ts';

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

// d20 fijo (0.5 → 11) para que los ataques con toHit 99 impacten siempre
const fixed = <T>(f: () => T) => { const r = Math.random; Math.random = () => 0.5; try { return f(); } finally { Math.random = r; } };
const act = (room: Room, m: any, tokenId: string, actionId: string, targets: string[]) => fixed(() => handle(room, m, { t: 'act', tokenId, actionId, targets }, fakeRoll));
const toTurn = (room: Room, dm: any, id: string) => { while (room.combat!.order[room.combat!.turn].tokenId !== id) handle(room, dm, { t: 'combat', op: 'next' }, fakeRoll); };

test('combate: start ordena, crea used vacío y next da la vuelta', () => {
  const { room, dm, player } = setup();
  assert.ok(handle(room, player, { t: 'combat', op: 'start' }, fakeRoll).error);
  const fx = handle(room, dm, { t: 'combat', op: 'start' }, fakeRoll);
  const c = room.combat!;
  assert.equal(c.order.length, room.scene.tokens.length);
  assert.equal(c.order[0].tokenId, 'nix'); // 7 + 4, el mejor initMod
  assert.deepEqual(c.used, {});
  assert.ok(fx.chats!.some((m) => m.roll?.secret && m.roll.detail.includes('Trasgo C'))); // ocultos: solo secreto
  assert.ok(!fx.chats![0].text!.includes('Trasgo C'));
  for (let i = 0; i < c.order.length; i++) handle(room, dm, { t: 'combat', op: 'next' }, fakeRoll);
  assert.equal(c.round, 2); assert.equal(c.turn, 0);
  handle(room, dm, { t: 'combat', op: 'prev' }, fakeRoll);
  assert.equal(c.round, 1); assert.equal(c.turn, c.order.length - 1);
  assert.deepEqual(c.used[c.order[c.turn].tokenId], { action: false, bonus: false, reaction: false, moved: 0 });
  handle(room, dm, { t: 'combat', op: 'end' }, fakeRoll);
  assert.equal(room.combat, undefined);
});

test('act: turno, una vez por turno y alcance', () => {
  const { room, dm, player } = setup();
  handle(room, dm, { t: 'combat', op: 'start' }, fakeRoll);
  assert.equal(act(room, player, 'kael', 'proyectil-magico', ['trasgo-a']).error, 'no es su turno');
  toTurn(room, dm, 'kael');
  assert.ok(act(room, player, 'ysolde', 'espada-larga', ['trasgo-a']).error); // ajeno
  assert.equal(act(room, player, 'kael', 'proyectil-magico', ['hobgoblin-2']).error, 'objetivo inválido'); // oculto
  assert.equal(act(room, player, 'kael', 'proyectil-magico', ['trasgo-a']).state, true);
  assert.equal(act(room, player, 'kael', 'proyectil-magico', ['trasgo-a']).error, 'ya usada');
  assert.equal(room.scene.tokens.find((t) => t.id === 'kael')!.slots![1].used, 2);
  assert.equal(act(room, dm, 'ysolde', 'espada-larga', ['trasgo-a']).error, 'fuera de alcance');
});

test('act: espacios agotados', () => {
  const { room, dm } = setup();
  const k = tok(room, 'kael'); k.slots![3].used = 2;
  assert.equal(act(room, dm, 'kael', 'bola-fuego', ['trasgo-a']).error, 'sin espacios de conjuro');
});

test('assisted deja pendiente y confirm aplica; auto aplica al momento', () => {
  const { room, dm, player } = setup();
  const before = tok(room, 'trasgo-a').hp!.cur;
  const fx = act(room, player, 'kael', 'proyectil-magico', ['trasgo-a']);
  assert.ok(fx.chat!.card!.pending && !fx.chat!.card!.applied);
  assert.equal(tok(room, 'trasgo-a').hp!.cur, before);
  const id = fx.chat!.card!.pending!;
  assert.ok(handle(room, player, { t: 'confirm', pending: id, mode: 'full' }, fakeRoll).error);
  const c = handle(room, dm, { t: 'confirm', pending: id, mode: 'full' }, fakeRoll);
  assert.ok(c.chat!.card!.applied && !c.chat!.card!.pending);
  assert.ok(tok(room, 'trasgo-a').hp!.cur < before);
  assert.ok(handle(room, dm, { t: 'confirm', pending: id, mode: 'full' }, fakeRoll).error); // ya aplicada
  handle(room, dm, { t: 'automation', value: 'auto' }, fakeRoll);
  const b2 = tok(room, 'trasgo-b').hp!.cur;
  act(room, dm, 'kael', 'proyectil-magico', ['trasgo-b']);
  assert.ok(tok(room, 'trasgo-b').hp!.cur < b2);
  assert.ok(handle(room, player, { t: 'automation', value: 'assisted' }, fakeRoll).error);
});

test('spawn: sufijo, solo DM, monstruo inexistente y ajuste a casilla', () => {
  const { room, dm, player } = setup();
  assert.ok(handle(room, player, { t: 'spawn', srd: 'goblin', x: 10, y: 10 }, fakeRoll).error);
  assert.ok(handle(room, dm, { t: 'spawn', srd: 'nope', x: 10, y: 10 }, fakeRoll).error);
  assert.ok(handle(room, dm, { t: 'spawn', srd: 'constructor', x: 10, y: 10 }, fakeRoll).error);
  handle(room, dm, { t: 'spawn', srd: 'goblin', x: 100, y: 100 }, fakeRoll);
  handle(room, dm, { t: 'spawn', srd: 'goblin', x: 100, y: 100, hidden: true }, fakeRoll);
  const t = room.scene.tokens.filter((t) => t.id.startsWith('goblin'));
  assert.deepEqual(t.map((x) => x.name), ['Trasgo', 'Trasgo 2']);
  assert.equal(new Set(room.scene.tokens.map((x) => x.id)).size, room.scene.tokens.length);
  assert.deepEqual([t[0].x, t[0].y, t[1].hidden], [90, 90, true]);
  handle(room, dm, { t: 'spawn', srd: 'ogre', x: 100, y: 100 }, fakeRoll);
  const o = room.scene.tokens.find((x) => x.srd === 'ogre')!;
  assert.deepEqual([o.x, o.y], [120, 120]);
});

test('claim cambia de token', () => {
  const { room, player, dm } = setup();
  assert.ok(handle(room, player, { t: 'claim', tokenId: 'kael' }, fakeRoll).state); // ya suyo
  assert.ok(handle(room, dm, { t: 'claim', tokenId: 'nix' }, fakeRoll).error);
  assert.equal(handle(room, player, { t: 'claim', tokenId: 'trasgo-a' }, fakeRoll).error, 'token inexistente');
  assert.ok(handle(room, player, { t: 'claim', tokenId: 'nix' }, fakeRoll).state);
  assert.deepEqual([tok(room, 'kael').owners, tok(room, 'nix').owners], [[], [player.id]]);
});

test('combate y tarjetas no filtran ocultos al jugador', () => {
  const { room, player, dm } = setup();
  handle(room, dm, { t: 'combat', op: 'start' }, fakeRoll);
  toTurn(room, dm, 'trasgo-c'); // turno oculto
  const st = filterFor(room, player);
  assert.ok(!JSON.stringify(st.combat).includes('trasgo-c') && !JSON.stringify(st.combat).includes('hobgoblin-2'));
  assert.equal(st.combat!.order.length, st.scene.tokens.length);
  assert.ok(st.combat!.turn < st.combat!.order.length);
  // kael ataca a un oculto (como DM) y luego una CD ajena
  const fx = act(room, dm, 'kael', 'rayo-escarcha', ['hobgoblin-2']);
  assert.equal(fx.error, undefined);
  const s = JSON.stringify(chatFor(room, player));
  assert.ok(!s.includes('Hobgoblin 2') && !s.includes('hobgoblin-2') && !s.includes('Trasgo C'), s);
  assert.ok(JSON.stringify(redact(room, fx.chat!, dm)).includes('Hobgoblin 2'));
  delete room.combat!.used.kael;
  const f2 = act(room, dm, 'kael', 'bola-fuego', ['trasgo-a']);
  const other = { ...player, id: 'otro' };
  assert.ok(!('dc' in redact(room, f2.chat!, other).card!.targets[0].save!));
});
