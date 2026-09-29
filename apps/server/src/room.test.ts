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

test('niebla: en la oscuridad solo llegan los enemigos que se perciben (luz, visión en la oscuridad)', () => {
  const { room, player } = setup();
  const s = room.scene, trasgo = tok(room, 'trasgo-a'), sees = () => filterFor(room, player).scene.tokens.some((t) => t.id === 'trasgo-a');
  s.lights = []; s.globalLight = 0;
  for (const t of s.tokens) if (t.faction === 'ally') { t.darkvision = 0; delete t.senses; }
  assert.equal(sees(), false, 'a oscuras y sin visión en la oscuridad no se envía');
  tok(room, 'kael').darkvision = 5000;
  assert.equal(sees(), true, 'con visión en la oscuridad que llega');
  tok(room, 'kael').darkvision = 0;
  s.lights = [{ id: 'l', x: trasgo.x, y: trasgo.y, bright: 30, dim: 60, color: '#fff' }];
  assert.equal(sees(), true, 'iluminado por una luz');
  s.regions = [{ id: 'r', name: 'Oscuridad', kind: 'darkness', hidden: false, points: [{ x: trasgo.x - 50, y: trasgo.y - 50 }, { x: trasgo.x + 50, y: trasgo.y - 50 }, { x: trasgo.x + 50, y: trasgo.y + 50 }, { x: trasgo.x - 50, y: trasgo.y + 50 }] }];
  tok(room, 'kael').darkvision = 5000;
  assert.equal(sees(), false, 'la oscuridad mágica tapa luz y visión en la oscuridad');
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
  // la puerta secreta le llega como muro: por protocolo tampoco se abre, aunque esté al lado
  tok(room, 'kael').x = 1300; tok(room, 'kael').y = 570;
  assert.equal(handle(room, player, { t: 'door', id: 'd3', open: true }, fakeRoll).error, 'puerta inexistente');
  assert.equal(room.scene.walls.find((w) => w.id === 'd3')!.open, false);
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

// ---- ajustes, roles, condiciones, PG y tiradas ----
const rollOf = (v: number, seen: string[] = []) => (e: string) => { seen.push(e); return { total: v, detail: e, dice: [{ sides: 20, value: v, kept: true }] }; };
const H = (room: Room, m: any, msg: any, rf: any = fakeRoll) => handle(room, m, msg, rf);

test('settings: solo DM, mezcla profunda validada y persistencia', async () => {
  const { room, dm, player } = setup();
  assert.deepEqual(room.settings, filterFor(room, player).settings);
  assert.equal(H(room, dm, { t: 'settings', patch: { mode: 'simple', layers: { lighting: false }, optional: { flanking: true } } }).state, true);
  assert.deepEqual([room.settings.mode, room.settings.layers.lighting, room.settings.layers.story, room.settings.optional.flanking, room.settings.edition], ['simple', false, true, true, '2024']);
  assert.equal(filterFor(room, player).settings.mode, 'simple');
  const before = JSON.stringify(room.settings);
  assert.equal(H(room, player, { t: 'settings', patch: { mode: 'full' } }).error, 'no permitido');
  for (const patch of [{ foo: 1 }, { layers: { x: true } }, { layers: { story: 'si' } }, { layers: null }, { edition: '2020' }, { mode: 'raro' }, { optional: [] }, null, 'x'])
    assert.equal(H(room, dm, { t: 'settings', patch }).error, 'ajustes inválidos');
  assert.equal(JSON.stringify(room.settings), before); // un patch inválido no aplica nada
  const { openDb } = await import('./db.ts');
  const db = openDb(':memory:');
  db.save(room);
  assert.deepEqual(db.load(room.code)!.settings, room.settings);
});

test('settings: modo sencillo o sin automatización fuerza assisted', () => {
  const { room, dm, player } = setup();
  H(room, dm, { t: 'automation', value: 'auto' });
  H(room, dm, { t: 'settings', patch: { mode: 'simple' } });
  assert.ok(act(room, player, 'kael', 'proyectil-magico', ['trasgo-a']).chat!.card!.pending);
  H(room, dm, { t: 'settings', patch: { mode: 'full', layers: { automation: false } } });
  assert.ok(act(room, player, 'kael', 'proyectil-magico', ['trasgo-a']).chat!.card!.pending);
  H(room, dm, { t: 'settings', patch: { layers: { automation: true } } });
  assert.equal(act(room, player, 'kael', 'proyectil-magico', ['trasgo-a']).chat!.card!.applied, true);
});

test('setRole: solo dm, valida el rol y el último DM no se degrada', () => {
  const { room, dm, player } = setup();
  assert.equal(H(room, player, { t: 'setRole', memberId: player.id, role: 'dm' }).error, 'no permitido');
  assert.ok(H(room, dm, { t: 'setRole', memberId: player.id, role: 'rey' }).error);
  assert.ok(H(room, dm, { t: 'setRole', memberId: 'nadie', role: 'player' }).error);
  assert.ok(H(room, dm, { t: 'setRole', memberId: dm.id, role: 'player' }).error); // único DM
  assert.equal(dm.role, 'dm');
  assert.equal(H(room, dm, { t: 'setRole', memberId: player.id, role: 'dm' }).state, true);
  assert.equal(H(room, dm, { t: 'setRole', memberId: dm.id, role: 'player' }).state, true); // ya hay otro DM
  assert.equal(dm.role, 'player');
});

test('condition: permisos, validación, agotamiento y rondas que expiran', () => {
  const { room, dm, player } = setup();
  const k = tok(room, 'kael');
  const otra = (joinRoom(room, 'Otra', undefined) as { member: any }).member;
  assert.equal(H(room, otra, { t: 'condition', tokenId: 'kael', condition: 'poisoned', on: true }).error, 'no permitido');
  for (const [condition, rounds] of [['foo', undefined], ['poisoned', 0], ['poisoned', 101], ['poisoned', 1.5]] as const)
    assert.ok(H(room, player, { t: 'condition', tokenId: 'kael', condition, on: true, rounds }).error);
  H(room, player, { t: 'condition', tokenId: 'kael', condition: 'poisoned', on: true, rounds: 2 });
  assert.deepEqual([k.conditions, k.condRounds], [['poisoned'], { poisoned: 2 }]);
  H(room, dm, { t: 'condition', tokenId: 'kael', condition: 'exhaustion', on: true });
  H(room, dm, { t: 'condition', tokenId: 'kael', condition: 'exhaustion', on: true });
  assert.deepEqual([k.exhaustion, k.conditions.includes('exhaustion')], [2, true]);
  H(room, dm, { t: 'condition', tokenId: 'kael', condition: 'exhaustion', on: false });
  H(room, dm, { t: 'condition', tokenId: 'kael', condition: 'exhaustion', on: false });
  assert.deepEqual([k.exhaustion, k.conditions.includes('exhaustion')], [0, false]);
  H(room, dm, { t: 'combat', op: 'start' });
  toTurn(room, dm, 'kael');
  H(room, dm, { t: 'combat', op: 'next' });
  assert.equal(k.condRounds!.poisoned, 1);
  toTurn(room, dm, 'kael');
  const fx = H(room, dm, { t: 'combat', op: 'next' });
  assert.deepEqual([k.conditions, k.condRounds], [[], {}]);
  assert.match(fx.chats![0].text!, /Kael ya no está envenenado/);
});

test('hp: daño rompe la concentración; si la supera, se mantiene', () => {
  const { room, dm, player } = setup();
  const k = tok(room, 'kael');
  H(room, player, { t: 'concentration', tokenId: 'kael', spell: 'Bendición' });
  assert.equal(k.concentration, 'Bendición');
  let fx = H(room, player, { t: 'hp', tokenId: 'kael', delta: 8, kind: 'damage' }, rollOf(15)); // 15 + CON +2 >= CD 10
  assert.equal(k.concentration, 'Bendición');
  assert.equal(fx.chats![0].card!.actionName, 'Concentración');
  assert.equal(fx.chats![0].card!.targets[0].save!.success, true);
  fx = H(room, dm, { t: 'hp', tokenId: 'kael', delta: 2, kind: 'damage' }, rollOf(1)); // 1 + 2 < 10
  assert.equal(k.concentration, undefined);
  assert.equal(fx.chats![0].card!.targets[0].save!.success, false);
  assert.match(fx.chats![1].text!, /pierde la concentración en Bendición/);
  assert.ok(H(room, player, { t: 'hp', tokenId: 'kael', delta: 0, kind: 'damage' }).error);
  assert.ok(H(room, player, { t: 'hp', tokenId: 'trasgo-a', delta: 1, kind: 'heal' }).error); // ajeno
});

test('hp: 0 PG deja inconsciente al aliado y mata al enemigo; curar desde 0 despierta', () => {
  const { room, dm, player } = setup();
  const k = tok(room, 'kael');
  H(room, player, { t: 'hp', tokenId: 'kael', delta: 30, kind: 'damage' }); // 19 + 5 temp = 24 → 0, sobran 6
  assert.equal(k.hp!.cur, 0);
  assert.deepEqual([k.conditions.includes('unconscious'), k.conditions.includes('prone'), k.deathSaves], [true, true, { successes: 0, failures: 0 }]);
  H(room, dm, { t: 'hp', tokenId: 'kael', delta: 1, kind: 'damage' }); // a 0 PG: un fallo
  assert.equal(k.deathSaves!.failures, 1);
  H(room, dm, { t: 'hp', tokenId: 'kael', delta: 5, kind: 'heal' });
  assert.deepEqual([k.hp!.cur, k.conditions.includes('unconscious'), k.deathSaves], [5, false, undefined]);
  H(room, dm, { t: 'hp', tokenId: 'trasgo-a', delta: 5, kind: 'damage' });
  assert.ok(tok(room, 'trasgo-a').conditions.includes('dead'));
  H(room, dm, { t: 'hp', tokenId: 'kael', delta: 999, kind: 'damage' }); // daño masivo
  assert.ok(k.conditions.includes('dead'));
});

test('tarjetas aplican los mismos efectos (auto y confirm)', () => {
  const { room, dm, player } = setup();
  H(room, dm, { t: 'automation', value: 'auto' });
  const fx = act(room, player, 'kael', 'proyectil-magico', ['trasgo-a']);
  assert.ok(tok(room, 'trasgo-a').conditions.includes('dead'));
  assert.match(fx.chats!.map((c) => c.text).join(), /Trasgo A muere/);
  H(room, dm, { t: 'automation', value: 'assisted' });
  tok(room, 'ysolde').hp!.cur = 1; tok(room, 'kael').concentration = 'Bendición';
  tok(room, 'nix').actions![0] = { ...tok(room, 'nix').actions![0], toHit: 99, damage: '20' };
  const nixCard = fixed(() => H(room, dm, { t: 'act', tokenId: 'nix', actionId: 'arco-corto', targets: ['ysolde'] })).chat!.card!;
  const c = H(room, dm, { t: 'confirm', pending: nixCard.pending, mode: 'full' });
  assert.ok(tok(room, 'ysolde').conditions.includes('unconscious'));
  assert.ok(c.chats!.some((x) => /cae inconsciente/.test(x.text ?? '')));
});

test('deathSave: 20 natural revive, éxitos estabilizan y 3 fallos matan', () => {
  const { room, dm, player } = setup();
  const k = tok(room, 'kael');
  H(room, dm, { t: 'hp', tokenId: 'kael', delta: 99, kind: 'damage' }, rollOf(1));
  k.hp!.max = 200; k.conditions = ['unconscious', 'prone']; k.deathSaves = { successes: 0, failures: 0 }; k.hp!.cur = 0;
  let fx = H(room, dm, { t: 'deathSave', tokenId: 'kael' }, rollOf(20));
  assert.deepEqual([k.hp!.cur, k.conditions.includes('unconscious'), k.deathSaves], [1, false, undefined]);
  assert.match(fx.chat!.roll!.detail, /revive/);
  k.hp!.cur = 0; k.conditions = ['unconscious']; k.deathSaves = { successes: 0, failures: 0 };
  for (let i = 0; i < 3; i++) fx = H(room, dm, { t: 'deathSave', tokenId: 'kael' }, rollOf(12));
  assert.deepEqual([k.deathSaves, k.conditions, k.hp!.cur], [undefined, ['unconscious'], 0]); // estable
  assert.ok(H(room, dm, { t: 'deathSave', tokenId: 'kael' }).error); // ya no hace salvaciones
  k.deathSaves = { successes: 0, failures: 0 };
  for (let i = 0; i < 3; i++) H(room, dm, { t: 'deathSave', tokenId: 'kael' }, rollOf(5));
  assert.ok(k.conditions.includes('dead')); assert.equal(k.deathSaves, undefined);
  // dueño en su turno de combate
  k.conditions = ['unconscious']; k.deathSaves = { successes: 0, failures: 0 };
  H(room, dm, { t: 'combat', op: 'start' }); toTurn(room, dm, 'ysolde');
  assert.equal(H(room, player, { t: 'deathSave', tokenId: 'kael' }).error, 'no es su turno');
  toTurn(room, dm, 'kael');
  assert.equal(H(room, player, { t: 'deathSave', tokenId: 'kael' }, rollOf(15)).state, true);
  assert.equal(k.deathSaves!.successes, 1);
});

test('check: modificadores, agotamiento 2024/2014 y condiciones', () => {
  const { room, dm, player } = setup();
  const k = tok(room, 'kael');
  k.skills = { perception: 3 }; k.abilities = { str: 8, dex: 14, con: 14, int: 18, wis: 12, cha: 10 };
  assert.ok(H(room, player, { t: 'check', tokenId: 'kael', kind: 'skill', key: 'nope' }).error);
  assert.ok(H(room, player, { t: 'check', tokenId: 'kael', kind: 'save', key: 'perception' }).error);
  assert.equal(H(room, player, { t: 'check', tokenId: 'trasgo-a', kind: 'ability', key: 'str' }).error, 'no permitido');
  let fx = H(room, player, { t: 'check', tokenId: 'kael', kind: 'skill', key: 'perception', secret: true }, rollOf(10));
  assert.deepEqual([fx.chat!.roll!.expr, fx.chat!.roll!.total, fx.chat!.roll!.secret], ['Percepción (SAB) +3', 13, true]);
  assert.equal(H(room, player, { t: 'check', tokenId: 'kael', kind: 'save', key: 'int' }, rollOf(10)).chat!.roll!.total, 17); // saves.int = 7
  assert.equal(H(room, player, { t: 'check', tokenId: 'kael', kind: 'ability', key: 'dex' }, rollOf(10)).chat!.roll!.total, 12); // mod de 14
  k.exhaustion = 2; // 2024: −2 por nivel
  fx = H(room, player, { t: 'check', tokenId: 'kael', kind: 'skill', key: 'perception' }, rollOf(10));
  assert.deepEqual([fx.chat!.roll!.expr, fx.chat!.roll!.total], ['Percepción (SAB) -1', 9]);
  H(room, dm, { t: 'settings', patch: { edition: '2014' } });
  const seen: string[] = [];
  fx = H(room, player, { t: 'check', tokenId: 'kael', kind: 'skill', key: 'perception' }, rollOf(10, seen));
  assert.deepEqual([seen[0], fx.chat!.roll!.total], ['2d20kl1', 13]); // desventaja, sin penalizador
  H(room, player, { t: 'check', tokenId: 'kael', kind: 'save', key: 'int' }, rollOf(10, seen));
  assert.equal(seen[1], '1d20'); // salvaciones: desventaja solo desde nv. 3
  k.exhaustion = 0; k.conditions = ['poisoned'];
  H(room, player, { t: 'check', tokenId: 'kael', kind: 'ability', key: 'str' }, rollOf(10, seen));
  assert.equal(seen[2], '2d20kl1');
  k.conditions = ['unconscious'];
  fx = H(room, player, { t: 'check', tokenId: 'kael', kind: 'save', key: 'dex' }, rollOf(20));
  assert.deepEqual([fx.chat!.roll!.total, fx.chat!.roll!.detail], [0, 'fallo automático']);
});

test('act: flanqueo da ventaja solo con aliado en el lado opuesto y la opción activa', () => {
  const { room, dm } = setup();
  const ys = tok(room, 'ysolde'), nix = tok(room, 'nix');
  ys.x = 570; ys.y = 450; nix.x = 570; nix.y = 570; // trasgo-a está en (570,510): lados opuestos
  const mode = () => fixed(() => H(room, dm, { t: 'act', tokenId: 'ysolde', actionId: 'espada-larga', targets: ['trasgo-a'] })).chat!.card!.targets[0].attack!.mode;
  assert.equal(mode(), 'normal');
  H(room, dm, { t: 'settings', patch: { optional: { flanking: true } } });
  assert.equal(mode(), 'adv');
  nix.x = 510; nix.y = 510; // a 90°
  assert.equal(mode(), 'normal');
  nix.x = 570; nix.y = 570; nix.conditions = ['unconscious'];
  assert.equal(mode(), 'normal');
});

test('act: pifia con la opción; ranuras de concentración; import con abilities/skills/prof', () => {
  const { room, dm, player } = setup();
  const ys = tok(room, 'ysolde');
  H(room, dm, { t: 'settings', patch: { optional: { fumbles: true } } });
  ys.y = 450;
  const r = Math.random; Math.random = () => 0; // d20 = 1
  const fx = H(room, dm, { t: 'act', tokenId: 'ysolde', actionId: 'espada-larga', targets: ['trasgo-a'] });
  Math.random = r;
  assert.ok(fx.chats!.some((c) => /¡Pifia!/.test(c.text ?? '')));
  // conjuro con espacio y nombre de concentración
  tok(room, 'kael').actions!.push({ id: 'bend', name: 'Bendición', cost: 'action', kind: 'heal', range: 30, damage: '1', slot: 1 });
  act(room, player, 'kael', 'bend', ['ysolde']);
  assert.equal(tok(room, 'kael').concentration, 'Bendición');
  // import
  const ok: any = { ...goodChar(), ddbId: 0, abilities: { str: 8, dex: 14, con: 14, int: 18, wis: 12, cha: 10 }, skills: { arcana: 7 }, prof: 3 };
  assert.equal(H(room, player, { t: 'importCharacter', tokenId: 'kael', data: ok }).state, true);
  const k = tok(room, 'kael');
  assert.deepEqual([k.abilities!.int, k.skills, k.prof], [18, { arcana: 7 }, 3]);
  for (const f of [(c: any) => { c.skills = { nope: 1 }; }, (c: any) => { c.abilities.str = 31; }, (c: any) => { delete c.abilities.str; }, (c: any) => { c.prof = 1; }, (c: any) => { c.skills = { arcana: 21 }; }]) {
    const c = structuredClone(ok); f(c);
    assert.equal(H(room, player, { t: 'importCharacter', tokenId: 'kael', data: c }).error, 'datos de personaje inválidos');
  }
});

test('curar a un muerto no lo devuelve a la vida; salvación de muerte fuera de combate', () => {
  const { room, member: dm } = createRoom('DM', 'TESTDD') as Extract<ReturnType<typeof createRoom>, { room: unknown }>;
  const j = joinRoom(room, 'Sara', undefined) as { member: Parameters<typeof handle>[1] };
  const kael = room.scene.tokens.find((t) => t.id === 'kael')!;
  kael.owners = [j.member.id];
  handle(room, dm, { t: 'hp', tokenId: 'kael', delta: 19 + 5, kind: 'damage' }, fakeRoll);
  assert.equal(kael.hp!.cur, 0);
  assert.ok(kael.deathSaves, 'inconsciente con salvaciones de muerte');
  const r = handle(room, j.member, { t: 'deathSave', tokenId: 'kael' }, fakeRoll);
  assert.ok(!('error' in r && r.error), 'fuera de combate el dueño puede tirar');
  kael.conditions.push('dead');
  const h = handle(room, dm, { t: 'hp', tokenId: 'kael', delta: 5, kind: 'heal' }, fakeRoll);
  assert.ok('error' in h && h.error);
  assert.equal(kael.hp!.cur, 0);
});

// ---- escena, audio, rtc ----
const Hd = (r: Room, m: Parameters<typeof handle>[1], msg: unknown, now?: number) => handle(r, m, msg, fakeRoll, now);
function withRoles() {
  const b = setup();
  const t = joinRoom(b.room, 'Tru', undefined) as { member: typeof b.dm };
  const sp = joinRoom(b.room, 'Esp', undefined) as { member: typeof b.dm };
  t.member.role = 'trusted'; sp.member.role = 'spectator';
  return { ...b, trusted: t.member, spectator: sp.member };
}

test('scene patch: válido se mezcla; malicioso se rechaza sin tocar nada', () => {
  const { room, dm } = withRoles();
  const ok = Hd(room, dm, { t: 'scene', patch: { name: 'Nueva', background: '/assets/x.png', globalLight: 0.5, weather: { kind: 'rain', intensity: 1, wind: -1 },
    story: { title: 'T' }, grid: { size: 100, feet: 10 }, width: 2000 } });
  assert.equal(ok.state, true);
  assert.equal(room.scene.name, 'Nueva'); assert.equal(room.scene.grid.size, 100); assert.equal(room.scene.grid.offsetX, 0);
  assert.equal(room.scene.story?.subtitle, 'antes del alba'); assert.equal(room.scene.story?.title, 'T');
  const before = JSON.stringify(room.scene);
  for (const patch of [{ background: 'javascript:alert(1)' }, { story: { image: 'javascript:x' } }, { background: '//evil.com/x.png' }, { grid: { size: 0 } }, { grid: { size: 30, offsetX: 31 } },
    { globalLight: 2 }, { weather: { kind: 'lava', intensity: 0, wind: 0 } }, { weather: { kind: 'fog', intensity: 0, wind: 2 } }, { name: 'x'.repeat(61) },
    { width: 50 }, { walls: [] }, { story: { title: 'x'.repeat(81) } }, { name: 'ok', grid: { feet: 0 } }])
    assert.ok(Hd(room, dm, { t: 'scene', patch }).error, JSON.stringify(patch));
  assert.equal(JSON.stringify(room.scene), before);
});

test('scene patch: capas de parallax de Historia', () => {
  const { room, dm } = withRoles();
  const L = (n: number) => Array.from({ length: n }, (_, i) => ({ image: `/assets/${i}.png`, depth: i / 4 }));
  assert.equal(Hd(room, dm, { t: 'scene', patch: { story: { layers: L(4) } } }).state, true);
  assert.equal(room.scene.story?.layers?.length, 4);
  const before = JSON.stringify(room.scene);
  for (const layers of [L(5), [{ image: 'javascript:x', depth: 0 }], [{ image: '/assets/a.png', depth: 2 }], [{ image: '/assets/a.png' }], 'x', [null]])
    assert.ok(Hd(room, dm, { t: 'scene', patch: { story: { layers } } }).error, JSON.stringify(layers));
  assert.equal(JSON.stringify(room.scene), before);
  assert.equal(Hd(room, dm, { t: 'scene', patch: { story: { layers: [] } } }).state, true); assert.equal(room.scene.story?.layers?.length, 0);
});

test('un jugador no puede usar scene, view, npcSay, transition, audio ni sfx', () => {
  const { room, player } = withRoles();
  for (const m of [{ t: 'scene', patch: { name: 'x' } }, { t: 'view', value: 'story' }, { t: 'npcSay', name: 'A', text: 'b' }, { t: 'transition', title: 'x' },
    { t: 'audio', op: 'play', url: '/assets/a.mp3', name: 'a' }, { t: 'sfx', name: 'door' }])
    assert.ok(Hd(room, player, m).error, m.t);
  assert.equal(room.view, 'tactical');
});

test('view y npcSay (con chat) y transition', () => {
  const { room, dm } = withRoles();
  assert.equal(Hd(room, dm, { t: 'view', value: 'story' }).state, true); assert.equal(room.view, 'story');
  assert.ok(Hd(room, dm, { t: 'view', value: 'x' }).error);
  const r = Hd(room, dm, { t: 'npcSay', name: 'Bruja', text: 'Hola', portrait: 'https://x.io/a.png' });
  assert.equal(r.all?.t, 'npcSay'); assert.equal(r.chat?.text, 'Bruja: Hola');
  assert.ok(Hd(room, dm, { t: 'npcSay', name: 'B', text: 'h', portrait: 'javascript:1' }).error);
  assert.ok(Hd(room, dm, { t: 'npcSay', name: 'B'.repeat(41), text: 'h' }).error);
  assert.equal(Hd(room, dm, { t: 'transition', title: 'Acto', subtitle: 's' }).all?.t, 'transition');
  assert.ok(Hd(room, dm, { t: 'transition', title: 'x'.repeat(81) }).error);
});

test('audio: trusted puede; pause/resume ajusta startedAt; capas', () => {
  const { room, trusted } = withRoles();
  assert.equal(Hd(room, trusted, { t: 'audio', op: 'play', url: '/assets/a.mp3', name: 'Tema', loop: true }, 1000).state, true);
  assert.deepEqual(room.audio.track, { url: '/assets/a.mp3', name: 'Tema', startedAt: 1000, loop: true });
  Hd(room, trusted, { t: 'audio', op: 'pause' }, 1500);
  assert.equal(room.audio.track!.pausedAt, 1500);
  Hd(room, trusted, { t: 'audio', op: 'resume' }, 4000);
  assert.equal(room.audio.track!.startedAt, 3500); assert.ok(!('pausedAt' in room.audio.track!));
  assert.ok(Hd(room, trusted, { t: 'audio', op: 'play', url: 'javascript:1', name: 'x' }).error);
  Hd(room, trusted, { t: 'audio', op: 'stop' }); assert.equal(room.audio.track, undefined);
  const L = (id: string, volume = 0.5) => ({ t: 'audio', op: 'layer', layer: { id, url: 'https://x.io/l.ogg', name: id, volume } });
  for (let i = 0; i < 12; i++) assert.equal(Hd(room, trusted, L('l' + i)).state, true);
  assert.ok(Hd(room, trusted, L('otra')).error);
  assert.equal(Hd(room, trusted, L('l0', 1)).state, true); assert.equal(room.audio.layers[0].volume, 1);
  assert.ok(Hd(room, trusted, L('l0', 1.5)).error);
  Hd(room, trusted, { t: 'audio', op: 'unlayer', id: 'l0' }); assert.equal(room.audio.layers.length, 11);
  assert.equal(filterFor(room, room.members.values().next().value!).audio.layers.length, 11);
});

test('sfx: lista blanca', () => {
  const { room, trusted } = withRoles();
  assert.deepEqual(Hd(room, trusted, { t: 'sfx', name: 'thunder' }).all, { t: 'sfx', name: 'thunder' });
  assert.ok(Hd(room, trusted, { t: 'sfx', name: 'rm -rf' }).error);
});

test('rtc: solo al destinatario; espectador no; tamaño limitado', () => {
  const { room, player, dm, spectator } = withRoles();
  const r = Hd(room, player, { t: 'rtc', to: dm.id, data: { sdp: 'x' } });
  assert.deepEqual(r.to, { id: dm.id, msg: { t: 'rtc', from: player.id, data: { sdp: 'x' } } });
  assert.equal(r.all, undefined); assert.equal(r.state, undefined);
  assert.ok(Hd(room, spectator, { t: 'rtc', to: dm.id, data: 1 }).error);
  assert.ok(Hd(room, player, { t: 'rtc', to: dm.id, data: 'x'.repeat(16 * 1024) }).error);
  assert.ok(Hd(room, player, { t: 'rtc', to: 'nadie', data: 1 }).error);
});

test('unirse como espectador: ve lo del grupo, no controla tokens', () => {
  const { room } = createRoom('DM', 'TESTSP') as Extract<ReturnType<typeof createRoom>, { room: unknown }>;
  const r = joinRoom(room, 'Mesa', undefined, 'spectator') as { member: Parameters<typeof handle>[1] };
  assert.equal(r.member.role, 'spectator');
  assert.ok(!room.scene.tokens.some((t) => t.owners.includes(r.member.id)), 'no se le asigna personaje');
  assert.ok(!filterFor(room, r.member).scene.tokens.some((t) => t.hidden));
  assert.ok('error' in joinRoom(room, 'X', undefined, 'dm'));
});
