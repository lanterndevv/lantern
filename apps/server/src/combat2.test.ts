import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatFor, createRoom, handle, joinRoom, type Room } from './room.ts';

const roll = (e: string) => ({ total: 7, detail: e });
function setup() {
  const c = createRoom('Master', 'ABC234');
  if ('error' in c) throw new Error(c.error);
  const p = joinRoom(c.room, 'Ana', undefined);
  if ('error' in p) throw new Error(p.error);
  return { room: c.room, dm: c.member, player: p.member }; // Ana controla a Kael
}
const tok = (room: Room, id: string) => room.scene.tokens.find((t) => t.id === id)!;
const order = (room: Room) => room.combat!.order.map((o) => o.tokenId);
const combat = (room: Room, ids: string[], turn = 0) => { room.combat = { round: 1, turn, order: ids.map((tokenId, i) => ({ tokenId, init: 30 - i * 5 })), used: {} }; };
const texts = (room: Room, from = 0) => room.chat.slice(from).map((c) => c.text ?? c.roll?.detail);

test('delay: pasa justo detrás del siguiente y el turno avanza', () => {
  const { room, dm, player } = setup();
  combat(room, ['kael', 'ysolde', 'nix', 'osgo']);
  assert.ok(handle(room, player, { t: 'combat', op: 'delay', tokenId: 'ysolde' }, roll).error); // no es su turno
  assert.ok(handle(room, dm, { t: 'combat', op: 'delay', tokenId: 'nix' }, roll).error);
  assert.equal(handle(room, player, { t: 'combat', op: 'delay', tokenId: 'kael' }, roll).state, true);
  assert.deepEqual(order(room), ['ysolde', 'kael', 'nix', 'osgo']);
  assert.equal(room.combat!.turn, 0);
  assert.equal(room.combat!.round, 1);
  // el último en el orden se retrasa a la ronda siguiente
  combat(room, ['kael', 'ysolde', 'nix'], 2);
  assert.equal(handle(room, dm, { t: 'combat', op: 'delay', tokenId: 'nix' }, roll).state, true);
  assert.deepEqual(order(room), ['kael', 'nix', 'ysolde']);
  assert.deepEqual([room.combat!.turn, room.combat!.round], [0, 2]);
  // solo
  combat(room, ['kael']);
  assert.ok(handle(room, dm, { t: 'combat', op: 'delay', tokenId: 'kael' }, roll).error);
});

test('add tira iniciativa y ordena; remove ajusta el turno', () => {
  const { room, dm, player } = setup();
  combat(room, ['kael', 'ysolde', 'nix'], 1); // inits 30, 25, 20
  assert.ok(handle(room, player, { t: 'combat', op: 'add', tokenId: 'osgo' }, roll).error);
  // 7 + initMod(osgo)=2 → 9: al final
  assert.equal(handle(room, dm, { t: 'combat', op: 'add', tokenId: 'osgo' }, roll).state, true);
  assert.deepEqual(order(room), ['kael', 'ysolde', 'nix', 'osgo']);
  assert.ok(handle(room, dm, { t: 'combat', op: 'add', tokenId: 'osgo' }, roll).error); // ya está
  assert.ok(handle(room, dm, { t: 'combat', op: 'add', tokenId: 'fantasma' }, roll).error);
  const hi = (e: string) => ({ total: 30, detail: e });
  handle(room, dm, { t: 'combat', op: 'add', tokenId: 'trasgo-a' }, hi); // 32 → delante de todos; el turno sigue en Ysolde
  assert.equal(order(room)[0], 'trasgo-a');
  assert.equal(order(room)[room.combat!.turn], 'ysolde');
  handle(room, dm, { t: 'combat', op: 'remove', tokenId: 'kael' }, roll); // antes del turno → turn-1
  assert.equal(order(room)[room.combat!.turn], 'ysolde');
  handle(room, dm, { t: 'combat', op: 'remove', tokenId: 'ysolde' }, roll); // el que juega: pasa al siguiente
  assert.equal(order(room)[room.combat!.turn], 'nix');
  handle(room, dm, { t: 'combat', op: 'remove', tokenId: 'osgo' }, roll);
  handle(room, dm, { t: 'combat', op: 'remove', tokenId: 'nix' }, roll); // era el último de la lista → vuelve al principio en la ronda siguiente
  assert.deepEqual([order(room)[room.combat!.turn], room.combat!.round], ['trasgo-a', 2]);
  assert.ok(handle(room, dm, { t: 'combat', op: 'remove', tokenId: 'nix' }, roll).error);
  handle(room, dm, { t: 'combat', op: 'remove', tokenId: 'trasgo-a' }, roll);
  assert.equal(room.combat, undefined);
});

test('legendarias: use/reset, reinicio en su turno y aviso solo al DM', () => {
  const { room, dm, player } = setup();
  const osgo = tok(room, 'osgo');
  osgo.legendary = { max: 3, used: 1 };
  combat(room, ['kael', 'osgo', 'ysolde']);
  assert.ok(handle(room, player, { t: 'legendary', tokenId: 'osgo', op: 'use' }, roll).error);
  assert.ok(handle(room, dm, { t: 'legendary', tokenId: 'kael', op: 'use' }, roll).error);
  assert.ok(handle(room, dm, { t: 'legendary', tokenId: 'osgo', op: 'gasta' }, roll).error);
  handle(room, dm, { t: 'legendary', tokenId: 'osgo', op: 'use' }, roll);
  assert.equal(osgo.legendary.used, 2);
  handle(room, dm, { t: 'legendary', tokenId: 'osgo', op: 'use' }, roll);
  assert.ok(handle(room, dm, { t: 'legendary', tokenId: 'osgo', op: 'use' }, roll).error); // used ≤ max
  handle(room, dm, { t: 'legendary', tokenId: 'osgo', op: 'reset' }, roll);
  osgo.legendary.used = 1;
  const n = room.chat.length;
  handle(room, dm, { t: 'combat', op: 'next' }, roll); // acaba Kael → aviso (antes del reinicio de Osgo)
  assert.ok(texts(room, n).includes('Osgo: 2/3 acciones legendarias disponibles'));
  assert.ok(!JSON.stringify(chatFor(room, player)).includes('legendarias'));
  assert.ok(JSON.stringify(chatFor(room, dm)).includes('legendarias'));
  assert.equal(osgo.legendary.used, 0); // ya es el turno de Osgo → reinicio
  const m = room.chat.length;
  handle(room, dm, { t: 'combat', op: 'next' }, roll); // acaba el turno del propio Osgo: sin aviso
  assert.ok(!texts(room, m).some((x) => x?.includes('legendarias')));
});

test('guarida: aviso al pasar por la iniciativa 20', () => {
  const { room, dm, player } = setup();
  tok(room, 'osgo').lair = true;
  room.combat = { round: 1, turn: 0, order: [{ tokenId: 'kael', init: 25 }, { tokenId: 'osgo', init: 18 }, { tokenId: 'ysolde', init: 10 }], used: {} };
  const n = room.chat.length;
  handle(room, dm, { t: 'combat', op: 'next' }, roll); // de 25 a 18
  assert.deepEqual(texts(room, n).filter((x) => x?.startsWith('Acciones de guarida')), ['Acciones de guarida de Osgo']);
  const m = room.chat.length;
  handle(room, dm, { t: 'combat', op: 'next' }, roll); // de 18 a 10: no
  assert.ok(!texts(room, m).some((x) => x?.startsWith('Acciones de guarida')));
  handle(room, dm, { t: 'combat', op: 'next' }, roll); // nueva ronda → 25: no
  assert.equal(room.combat!.round, 2);
  assert.equal(chatFor(room, player).filter((c) => c.roll?.detail?.includes('guarida')).length, 0);
});

test('validación de legendary, lair, elevation y regiones', () => {
  const { room, dm } = setup();
  const base = structuredClone(tok(room, 'osgo'));
  const up = (patch: object) => handle(room, dm, { t: 'upsert', kind: 'token', item: { ...base, ...patch } as never }, roll);
  assert.ok(up({ legendary: { max: 6, used: 0 } }).error);
  assert.ok(up({ legendary: { max: 0, used: 0 } }).error);
  assert.ok(up({ legendary: { max: 3, used: 4 } }).error);
  assert.ok(up({ lair: 'sí' }).error);
  assert.ok(up({ elevation: 5001 }).error);
  assert.ok(up({ elevation: -501 }).error);
  assert.equal(up({ legendary: { max: 3, used: 3 }, lair: true, elevation: -500 }).state, true);
  assert.deepEqual(tok(room, 'osgo').legendary, { max: 3, used: 3 });
  const reg = { id: 'r', name: 'R', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], kind: 'message', hidden: false, text: 'hola' };
  const ur = (patch: object) => handle(room, dm, { t: 'upsert', kind: 'region', item: { ...reg, ...patch } as never }, roll);
  assert.ok(ur({ trigger: 'siempre' }).error);
  assert.ok(ur({ untilRound: 0 }).error);
  assert.equal(ur({ trigger: 'turnEnd', untilRound: 3 }).state, true);
});

// ---- Escudo ----
function shieldSetup() {
  const s = setup();
  const kael = tok(s.room, 'kael');
  kael.actions!.push({ id: 'shield', name: 'Escudo', cost: 'reaction', kind: 'heal', range: 0, slot: 1 });
  tok(s.room, 'trasgo-a').actions = [{ id: 'lanza', name: 'Lanza', cost: 'action', kind: 'attack', range: 30, toHit: 5, damage: '1d6', damageType: 'piercing' }];
  return s;
}
const withDie = <T>(f: () => T) => { const r = Math.random; Math.random = () => 0.5; try { return f(); } finally { Math.random = r; } }; // d20 = 11 → total 16 contra CA 15

test('Escudo: prompt solo al dueño; react recalcula el impacto y gasta reacción y espacio', () => {
  const { room, dm, player } = shieldSetup();
  const fx = withDie(() => handle(room, dm, { t: 'act', tokenId: 'trasgo-a', actionId: 'lanza', targets: ['kael'] }, roll, 1000));
  assert.equal(fx.error, undefined);
  const card = room.pending[0];
  assert.ok(card.targets[0].attack!.hit && card.targets[0].amount! > 0);
  assert.equal(fx.sends!.length, 1);
  const sd = fx.sends![0], msg = sd.msg as Extract<typeof sd.msg, { t: 'reactionPrompt' }>;
  assert.equal(msg.t, 'reactionPrompt'); assert.equal(msg.expires, 11_000);
  assert.equal(msg.pending, card.pending); assert.equal(msg.actionId, 'shield');
  assert.ok(sd.who(player) && !sd.who(dm));
  const slot = tok(room, 'kael').slots![1].used;
  // ajena / sin ofrecer
  assert.ok(handle(room, dm, { t: 'react', pending: card.pending!, tokenId: 'kael', actionId: 'shield' }, roll, 2000).error === 'no permitido');
  assert.ok(handle(room, player, { t: 'react', pending: card.pending!, tokenId: 'kael', actionId: 'nada' }, roll, 2000).error);
  const r = handle(room, player, { t: 'react', pending: card.pending!, tokenId: 'kael', actionId: 'shield' }, roll, 2000);
  assert.equal(r.error, undefined);
  assert.equal(tok(room, 'kael').slots![1].used, slot + 1);
  assert.equal(card.targets[0].attack!.hit, false); assert.equal(card.targets[0].amount, 0);
  assert.equal(room.pending.length, 0); // ya no hay nada que confirmar
  assert.equal(r.chats!.at(-1)!.card!.targets[0].amount, 0);
  assert.ok(texts(room).includes('Kael usa Escudo'));
  assert.ok(handle(room, player, { t: 'react', pending: card.pending!, tokenId: 'kael', actionId: 'shield' }, roll, 2000).error); // ya gastada
});

test('Escudo: sin reacción usada ni espacio no hay prompt; otras reacciones solo se anotan', () => {
  const a = shieldSetup();
  combat(a.room, ['trasgo-a', 'kael']);
  a.room.combat!.used.kael = { action: false, bonus: false, reaction: true, moved: 0 };
  assert.equal(withDie(() => handle(a.room, a.dm, { t: 'act', tokenId: 'trasgo-a', actionId: 'lanza', targets: ['kael'] }, roll)).sends!.length, 0);
  const b = shieldSetup();
  for (const sl of Object.values(tok(b.room, 'kael').slots!)) sl.used = sl.max;
  assert.equal(withDie(() => handle(b.room, b.dm, { t: 'act', tokenId: 'trasgo-a', actionId: 'lanza', targets: ['kael'] }, roll)).sends!.length, 0);
  const c = shieldSetup();
  tok(c.room, 'kael').actions!.push({ id: 'contra', name: 'Contraataque', cost: 'reaction', kind: 'heal', range: 0 });
  tok(c.room, 'kael').actions = tok(c.room, 'kael').actions!.filter((x) => x.id !== 'shield');
  combat(c.room, ['trasgo-a', 'kael']);
  const fx = withDie(() => handle(c.room, c.dm, { t: 'act', tokenId: 'trasgo-a', actionId: 'lanza', targets: ['kael'] }, roll));
  const pend = c.room.pending[0], slot = tok(c.room, 'kael').slots![1].used;
  handle(c.room, c.player, { t: 'react', pending: pend.pending!, tokenId: 'kael', actionId: 'contra' }, roll);
  assert.equal(c.room.combat!.used.kael.reaction, true);
  assert.equal(c.room.pending.length, 1); assert.ok(pend.targets[0].attack!.hit); // no cambia el impacto
  assert.equal(tok(c.room, 'kael').slots![1].used, slot);
  assert.ok(texts(c.room).includes('Kael usa Contraataque'));
  assert.equal(fx.sends!.length, 1);
  // caducada
  const d = shieldSetup();
  withDie(() => handle(d.room, d.dm, { t: 'act', tokenId: 'trasgo-a', actionId: 'lanza', targets: ['kael'] }, roll, 1000));
  assert.match(handle(d.room, d.player, { t: 'react', pending: d.room.pending[0].pending!, tokenId: 'kael', actionId: 'shield' }, roll, 11_001).error!, /caducado/);
  assert.equal(d.room.pending.length, 1);
});

// ---- áreas persistentes ----
test('regiones turnStart/turnEnd: trampa al empezar, mensaje al terminar; untilRound las borra', () => {
  const { room, dm } = setup();
  const kael = tok(room, 'kael'), x = kael.x, y = kael.y;
  const poly = [{ x: x - 40, y: y - 40 }, { x: x + 40, y: y - 40 }, { x: x + 40, y: y + 40 }, { x: x - 40, y: y + 40 }];
  const put = (item: object) => handle(room, dm, { t: 'upsert', kind: 'region', item: { points: poly, hidden: false, ...item } as never }, roll);
  assert.equal(put({ id: 'aura', name: 'Espíritus', kind: 'trap', damage: '2d6', damageType: 'radiant', trigger: 'turnStart', untilRound: 1 }).state, true);
  assert.equal(put({ id: 'msg', name: 'Aviso', kind: 'message', text: 'Arde', trigger: 'turnEnd' }).state, true);
  const hp = kael.hp!.cur + kael.hp!.temp;
  // entrar no dispara las de turno
  assert.equal(handle(room, dm, { t: 'moveToken', id: 'kael', x: x + 200, y }, roll).chats!.length, 0);
  kael.x = x; kael.y = y;
  combat(room, ['ysolde', 'kael', 'nix']);
  let fx = handle(room, dm, { t: 'combat', op: 'next' }, roll); // empieza Kael → 7 de daño
  assert.equal(kael.hp!.cur + kael.hp!.temp, hp - 7);
  assert.ok(fx.chats!.some((c) => c.card?.actionName === 'Espíritus'));
  fx = handle(room, dm, { t: 'combat', op: 'next' }, roll); // acaba Kael → mensaje
  assert.ok(fx.sends!.some((sd) => sd.msg.t === 'regionMsg'));
  assert.equal(room.scene.regions!.length, 2);
  handle(room, dm, { t: 'combat', op: 'next' }, roll); // acaba la ronda 1 → se borra aura
  assert.equal(room.combat!.round, 2);
  assert.deepEqual(room.scene.regions!.map((r) => r.id), ['msg']);
});

// ---- 3D y plantillas ----
test('elevación: un volador a 30 pies queda fuera del alcance cuerpo a cuerpo', () => {
  const { room, dm } = setup();
  const y = tok(room, 'ysolde'), g = tok(room, 'trasgo-a');
  g.x = y.x; g.y = y.y + 60; // adyacente
  const go = () => handle(room, dm, { t: 'act', tokenId: 'ysolde', actionId: 'espada-larga', targets: ['trasgo-a'] }, roll);
  assert.equal(go().error, undefined);
  g.elevation = 30;
  assert.equal(go().error, 'fuera de alcance');
  g.elevation = 0; y.elevation = -3; // 3 pies de desnivel: sqrt(25+9) ≈ 5,8 > 5 → también fuera
  assert.equal(go().error, 'fuera de alcance');
  y.elevation = 0;
  assert.equal(go().error, undefined);
});

test('act con área: los objetivos deben caber en la esfera desde el centroide', () => {
  const { room, dm } = setup();
  const bola = (targets: string[]) => handle(room, dm, { t: 'act', tokenId: 'kael', actionId: 'bola-fuego', targets }, roll);
  assert.equal(bola(['trasgo-c', 'osgo']).error, 'objetivos fuera del área'); // ~60 pies entre ellos
  assert.notEqual(bola(['trasgo-a', 'ysolde']).error, 'objetivos fuera del área');
});

// ---- spawnCustom ----
test('spawnCustom: solo DM, valida cr y tamaño, crea enemigo con sufijo', () => {
  const { room, dm, player } = setup();
  const monster = { name: 'Dragón', ddbId: 1, level: 1, classes: '', darkvision: 720, hp: { cur: 100, max: 100, temp: 0 }, ac: 18,
    actions: [{ id: 'mordisco', name: 'Mordisco', cost: 'action', kind: 'attack', range: 10, toHit: 99, damage: '2d10', damageType: 'piercing' }], cr: '10', size: 4 };
  const spawn = (patch: object, who = dm, at = { x: 300, y: 300 }) => handle(room, who, { t: 'spawnCustom', monster: { ...monster, ...patch }, ...at } as never, roll);
  const n = room.scene.tokens.length;
  assert.equal(spawn({}, player).error, 'no permitido');
  assert.ok(spawn({ cr: '11/3' }).error); assert.ok(spawn({ cr: 10 }).error);
  assert.ok(spawn({ size: 5 }).error); assert.ok(spawn({ size: 1.5 }).error); assert.ok(spawn({ size: 0 }).error);
  assert.ok(spawn({ hp: { cur: 5, max: 3, temp: 0 } }).error);
  assert.ok(spawn({ actions: [{ ...monster.actions[0], toHit: 100 }] }).error);
  assert.ok(spawn({}, dm, { x: -5, y: 1 }).error);
  assert.equal(room.scene.tokens.length, n);
  assert.equal(spawn({}).state, true);
  assert.equal(spawn({ size: 1 }, dm, { x: 700, y: 300 }).state, true);
  const [a, b] = room.scene.tokens.slice(n);
  assert.equal(a.name, 'Dragón'); assert.equal(b.name, 'Dragón 2');
  assert.equal(a.faction, 'enemy'); assert.equal(a.size, 4); assert.deepEqual(a.owners, []);
  assert.equal(a.hidden, false); assert.equal(a.actions![0].toHit, 99);
  assert.notEqual(a.id, b.id);
  assert.equal(handle(room, dm, { t: 'spawnCustom', monster, x: 300, y: 600, hidden: true } as never, roll).state, true);
  assert.equal(room.scene.tokens.at(-1)!.hidden, true);
});

test('Escudo: el +5 CA persiste para otros ataques hasta el inicio del turno del lanzador', () => {
  const { room, dm, player } = shieldSetup();
  combat(room, ['trasgo-a', 'kael']);
  withDie(() => handle(room, dm, { t: 'act', tokenId: 'trasgo-a', actionId: 'lanza', targets: ['kael'] }, roll, 1000));
  assert.equal(handle(room, player, { t: 'react', pending: room.pending[0].pending!, tokenId: 'kael', actionId: 'shield' }, roll, 2000).error, undefined);
  assert.equal(tok(room, 'kael').shielded, true);
  assert.equal(tok(room, 'kael').ac, 15); // la CA base no se toca
  room.combat!.used = {}; // el goblin vuelve a tener acción
  // segundo ataque (total 16 < 20): falla
  const fx = withDie(() => handle(room, dm, { t: 'act', tokenId: 'trasgo-a', actionId: 'lanza', targets: ['kael'] }, roll, 3000));
  assert.equal(fx.error, undefined);
  assert.equal(room.chat.at(-1)!.card!.targets[0].attack!.hit, false);
  handle(room, dm, { t: 'combat', op: 'next' }, roll); // turno de Kael: caduca
  assert.equal(tok(room, 'kael').shielded, undefined);
  assert.equal(tok(room, 'kael').ac, 15);
});
