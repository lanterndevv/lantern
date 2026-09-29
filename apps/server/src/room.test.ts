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
  tok(room, 'trasgo-a').hp!.cur = 20;
  const b2 = 20;
  act(room, dm, 'kael', 'proyectil-magico', ['trasgo-a']);
  assert.ok(tok(room, 'trasgo-a').hp!.cur < b2);
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
  room.scene.walls = []; // sin muros para que haya línea de visión
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

test('diceTheme: válido, inválido, difusión y persistencia; roll lleva dice', async () => {
  const { room, player, dm } = setup();
  assert.equal(player.dice, 'linterna');
  assert.deepEqual(handle(room, player, { t: 'diceTheme', theme: 'dragon' }, fakeRoll), { state: true });
  assert.ok(handle(room, player, { t: 'diceTheme', theme: 'nope' }, fakeRoll).error);
  assert.ok(handle(room, player, { t: 'diceTheme' }, fakeRoll).error);
  assert.equal(filterFor(room, dm).members.find((m) => m.id === player.id)!.dice, 'dragon');
  const { openDb } = await import('./db.ts');
  const db = openDb(':memory:');
  db.save(room);
  assert.equal(db.load(room.code)!.members.get(player.id)!.dice, 'dragon');
  db.close();
  const { roll } = await import('@lantern/rules');
  const fx = handle(room, player, { t: 'roll', expr: '2d20kh1+1d6' }, roll);
  assert.equal(fx.chat!.roll!.dice!.length, 3);
  assert.equal(fx.chat!.roll!.dice!.filter((d) => !d.kept).length, 1);
});

test('persistencia: automation, combat y pending sobreviven a recargar', async () => {
  const { room, dm, player } = setup();
  handle(room, dm, { t: 'automation', value: 'auto' }, fakeRoll);
  handle(room, dm, { t: 'automation', value: 'assisted' }, fakeRoll);
  handle(room, dm, { t: 'combat', op: 'start' }, fakeRoll);
  toTurn(room, dm, 'kael');
  assert.ok(act(room, player, 'kael', 'proyectil-magico', ['trasgo-a']).chat!.card!.pending);
  const { openDb } = await import('./db.ts');
  const db = openDb(':memory:');
  db.save(room);
  const r = db.load(room.code)!;
  assert.equal(r.automation, 'assisted');
  assert.deepEqual(r.combat, room.combat);
  assert.deepEqual(r.pending, room.pending);
  assert.equal(r.pending.length, 1);
  handle(room, dm, { t: 'combat', op: 'end' }, fakeRoll);
  db.save(room);
  assert.equal(db.load(room.code)!.combat, undefined);
  db.close();
});

test('movimiento en combate: turno y pies (5-5-5)', () => {
  const { room, dm, player } = setup();
  handle(room, dm, { t: 'combat', op: 'start' }, fakeRoll);
  const mv = (m: any, x: number, y = 570) => handle(room, m, { t: 'moveToken', id: 'kael', x, y }, fakeRoll);
  toTurn(room, dm, 'nix');
  assert.equal(mv(player, 450).error, 'no es su turno');
  toTurn(room, dm, 'kael');
  tok(room, 'kael').speed = 10;
  assert.equal(mv(player, 450).state, true);            // 60 px = 5 pies
  assert.equal(room.combat!.used.kael.moved, 5);
  assert.equal(mv(player, 390, 510).state, true);       // diagonal: 5 pies
  assert.equal(mv(player, 330).error, 'sin movimiento: te quedan 0 pies');
  assert.equal(tok(room, 'kael').x, 390);
  assert.equal(mv(dm, 330).state, true);                // el DM no tiene límite
  assert.equal(room.combat!.used.kael.moved, 10);
});

test('cobertura: total invalida, media suma a la CA y a salvaciones de DES', () => {
  const wall = (y2: number) => ({ id: 'cw', kind: 'wall' as const, a: { x: 535, y: 0 }, b: { x: 535, y: y2 } });
  let s = setup();
  s.room.scene.walls.push(wall(1000));
  assert.equal(act(s.room, s.dm, 'kael', 'rayo-escarcha', ['trasgo-a']).error, 'sin línea de visión');
  s = setup(); s.room.scene.walls.push(wall(500)); // tapa 1 de 5 puntos → media (+2)
  const c = act(s.room, s.dm, 'kael', 'rayo-escarcha', ['trasgo-a']).chat!.card!;
  assert.equal(c.targets[0].cover, 2);
  const base = setup();
  const save = (r: Room, d: any) => act(r, d, 'kael', 'bola-fuego', ['trasgo-a']).chat!.card!.targets[0];
  const t0 = save(base.room, base.dm);
  s = setup(); s.room.scene.walls.push(wall(500));
  const t1 = save(s.room, s.dm);
  assert.equal(t1.cover, 2);
  assert.equal(t1.save!.total, t0.save!.total + 2);
});

const goodChar = () => ({
  name: 'Kael el Grande', hp: { cur: 20, max: 30, temp: 0 }, ac: 16, speed: 30, initMod: 3, saves: { dex: 5, wis: 2 }, darkvision: 720,
  defenses: { resist: ['fire'] },
  actions: [{ id: 'daga', name: 'Daga', cost: 'action', kind: 'attack', range: 5, toHit: 6, damage: '1d4+3', damageType: 'piercing' }],
  slots: { 1: { max: 4, used: 1 } }, ddbId: 12345, level: 5, classes: 'Mago 5', avatar: 'https://www.dndbeyond.com/avatars/1.png',
});

test('importCharacter: válido conserva id, posición, dueños y condiciones', () => {
  const { room, player } = setup();
  const k = tok(room, 'kael'); k.conditions = ['prone'];
  const fx = handle(room, player, { t: 'importCharacter', tokenId: 'kael', data: goodChar() }, fakeRoll, 42);
  assert.equal(fx.state, true);
  assert.equal(fx.chat!.text, 'Kael el Grande se ha vinculado con D&D Beyond (nivel 5)');
  assert.deepEqual([k.id, k.x, k.y, k.owners, k.conditions], ['kael', 510, 570, [player.id], ['prone']]);
  assert.deepEqual([k.name, k.hp!.cur, k.ac, k.actions![0].id, k.slots![1].used, k.img], ['Kael el Grande', 20, 16, 'daga', 1, 'https://www.dndbeyond.com/avatars/1.png']);
  assert.deepEqual(k.ddb, { id: 12345, level: 5, classes: 'Mago 5', syncedAt: 42 });
  const g = goodChar(); g.avatar = 'https://evil.com/a.png';
  handle(room, player, { t: 'importCharacter', tokenId: 'kael', data: g }, fakeRoll);
  assert.equal(k.img, 'https://www.dndbeyond.com/avatars/1.png'); // avatar descartado: se conserva el anterior
});

test('importCharacter: datos maliciosos y permisos', () => {
  const { room, player, dm } = setup();
  const before = JSON.stringify(room.scene);
  const bad = (f: (c: any) => void) => {
    const c: any = goodChar(); f(c);
    assert.equal(handle(room, player, { t: 'importCharacter', tokenId: 'kael', data: c }, fakeRoll).error, 'datos de personaje inválidos');
  };
  bad((c) => { c.actions[0].damage = '1d1000000'; });
  bad((c) => { c.hp.cur = -1; });
  bad((c) => { c.hp.cur = 40; });
  bad((c) => { c.name = 'x'.repeat(41); });
  bad((c) => { c.ac = 0; });
  bad((c) => { c.saves = { foo: 1 }; });
  bad((c) => { c.saves = JSON.parse('{"__proto__": 1}'); });
  bad((c) => { c.slots = { 1: { max: 2, used: 3 } }; });
  bad((c) => { c.slots = { 10: { max: 2, used: 0 } }; });
  bad((c) => { c.actions = Array.from({ length: 41 }, (_, i) => ({ ...c.actions[0], id: 'a' + i })); });
  bad((c) => { c.level = 21; });
  bad((c) => { c.ddbId = 1.5; });
  bad((c) => { c.defenses = { resist: Array(21).fill('fire') }; });
  assert.equal(JSON.stringify(room.scene), before);
  // avatar peligroso: se acepta el personaje pero sin imagen
  const c: any = goodChar(); c.avatar = 'javascript:alert(1)';
  assert.equal(handle(room, player, { t: 'importCharacter', tokenId: 'kael', data: c }, fakeRoll).state, true);
  assert.equal(tok(room, 'kael').img, undefined);
  // no dueño, token enemigo y espectador
  const otra = joinRoom(room, 'Otra', undefined) as { member: any };
  assert.equal(handle(room, otra.member, { t: 'importCharacter', tokenId: 'kael', data: goodChar() }, fakeRoll).error, 'no permitido');
  assert.ok(handle(room, dm, { t: 'importCharacter', tokenId: 'trasgo-a', data: goodChar() }, fakeRoll).error);
  assert.equal(handle(room, dm, { t: 'importCharacter', tokenId: 'nix', data: goodChar() }, fakeRoll).state, true);
});
