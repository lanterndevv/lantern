import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Region } from '@lantern/protocol';
import { demoScene } from '@lantern/protocol/demo';
import { MONSTERS } from '@lantern/srd';
import { openDb } from './db.ts';
import { createRoom, filterFor, handle, joinRoom, type Room } from './room.ts';
import { parseToken } from './validate.ts';

const fakeRoll = (e: string) => ({ total: 7, detail: e });
function setup() {
  const c = createRoom('Master', 'ABC234');
  if ('error' in c) throw new Error(c.error);
  const p = joinRoom(c.room, 'Ana', undefined) as { member: typeof c.member };
  const dm = c.member, player = p.member, room = c.room;
  const H = (m: typeof dm, msg: unknown) => handle(room, m, msg, fakeRoll, 1000);
  return { room, dm, player, H };
}
const rect = (x1: number, y1: number, x2: number, y2: number) => [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
const region = (o: Partial<Region> = {}): Region => ({ id: 'r1', name: 'Zona', kind: 'trap', hidden: true, points: rect(200, 500, 280, 580), ...o });
const kael = (r: Room) => r.scene.tokens.find((t) => t.id === 'kael')!;

test('biblioteca de escenas: nueva, copia, activar, renombrar, borrar', () => {
  const { room, dm, player, H } = setup();
  const first = room.activeId;
  assert.equal(H(dm, { t: 'sceneNew', name: 'Vacía' }).state, true);
  assert.equal(Object.keys(room.scenes).length, 2);
  const empty = Object.values(room.scenes).find((s) => s.name === 'Vacía')!;
  assert.deepEqual([empty.width, empty.height, empty.grid.size, empty.tokens.length], [1400, 1000, 60, 0]);
  H(dm, { t: 'sceneNew', name: 'Copia', from: first });
  const copy = Object.values(room.scenes).find((s) => s.name === 'Copia')!;
  const orig = room.scenes[first];
  assert.equal(copy.tokens.length, orig.tokens.length);
  assert.ok(copy.tokens.every((t) => !orig.tokens.some((o) => o.id === t.id)) && copy.walls.every((w) => !orig.walls.some((o) => o.id === w.id)));
  copy.tokens[0].x = 1; assert.notEqual(orig.tokens[0].x, 1); // copia profunda
  assert.ok(H(dm, { t: 'sceneNew', name: 'x'.repeat(61) }).error && H(dm, { t: 'sceneNew', name: 'a', from: 'nada' }).error);
  // solo dm/assistant; la biblioteca solo la ven ellos
  for (const m of [{ t: 'sceneNew', name: 'x' }, { t: 'sceneActivate', id: empty.id }, { t: 'sceneUpdate', id: empty.id, name: 'x' }, { t: 'sceneDelete', id: empty.id }]) assert.ok(H(player, m).error, m.t);
  assert.equal(filterFor(room, dm).library!.length, 3);
  assert.equal(filterFor(room, dm).library!.filter((l) => l.active).length, 1);
  assert.equal(filterFor(room, player).library, undefined);
  // update
  assert.equal(H(dm, { t: 'sceneUpdate', id: empty.id, name: 'Taberna', folder: 'Acto 1' }).state, true);
  assert.deepEqual([empty.name, empty.folder], ['Taberna', 'Acto 1']);
  assert.ok(H(dm, { t: 'sceneUpdate', id: empty.id, folder: 'x'.repeat(41) }).error);
  // activar: termina el combate y aplica el audioPreset
  H(dm, { t: 'combat', op: 'start' }); assert.ok(room.combat);
  empty.audioPreset = { track: { url: '/assets/a.mp3', name: 'Taberna', startedAt: 5, loop: true }, layers: [] };
  assert.equal(H(dm, { t: 'sceneActivate', id: empty.id }).state, true);
  assert.equal(room.activeId, empty.id); assert.equal(room.scene, empty); assert.equal(room.combat, undefined);
  assert.equal(room.audio.track?.name, 'Taberna'); assert.equal(room.audio.track?.startedAt, 1000);
  assert.ok(H(dm, { t: 'sceneDelete', id: empty.id }).error); // la activa no
  assert.equal(H(dm, { t: 'sceneDelete', id: first }).state, true);
  assert.equal(room.scenes[first], undefined);
});

test('migración: una mesa antigua (una sola escena) pasa a la biblioteca', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'lantern-')), 'old.db');
  const raw = new DatabaseSync(path);
  raw.exec('CREATE TABLE rooms (code TEXT PRIMARY KEY, scene TEXT NOT NULL, chat TEXT NOT NULL)');
  raw.prepare('INSERT INTO rooms VALUES (?, ?, ?)').run('OLD234', JSON.stringify(demoScene()), '[]');
  raw.close();
  const db = openDb(path);
  const r = db.load('OLD234')!;
  assert.deepEqual(Object.keys(r.scenes), ['cueva-osgo']); assert.equal(r.activeId, 'cueva-osgo'); assert.equal(r.scene.name, 'Cueva del osgo'); assert.deepEqual(r.journal, []);
  r.journal = [{ id: 'j', title: 'T', body: 'B', visibleTo: 'all' }];
  db.save(r);
  const r2 = db.load('OLD234')!;
  assert.equal(r2.journal.length, 1); assert.equal(r2.scene.id, 'cueva-osgo');
  db.close();
});

test('regiones: validación estricta y permisos', () => {
  const { room, dm, player, H } = setup();
  assert.equal(H(dm, { t: 'upsert', kind: 'region', item: region({ damage: '2d6', damageType: 'fire', save: { ability: 'dex', dc: 13 }, condition: 'prone', sfx: 'trap', text: 'ok' }) }).state, true);
  assert.equal(room.scene.regions!.length, 1);
  assert.ok(H(player, { t: 'upsert', kind: 'region', item: region() }).error);
  const bad: unknown[] = [{ points: rect(0, 0, 1, 1).slice(0, 2) }, { points: Array.from({ length: 65 }, (_, i) => ({ x: i, y: 1 })) }, { points: [...rect(0, 0, 9, 9).slice(0, 2), { x: 99999, y: 1 }] },
    { kind: 'lava' }, { damage: 'nope' }, { damage: '100d100' }, { damage: '-5' }, { save: { ability: 'xxx', dc: 10 } }, { save: { ability: 'dex', dc: 99 } }, { to: { x: -1, y: 5 } },
    { kind: 'teleport' }, { text: 'x'.repeat(401) }, { sfx: 'rm -rf' }, { condition: 'nope' }, { hidden: 'no' }, { name: '' }];
  for (const b of bad) assert.ok(H(dm, { t: 'upsert', kind: 'region', item: { ...region({ id: 'z' }), ...(b as object) } }).error, JSON.stringify(b).slice(0, 60));
  assert.equal(room.scene.regions!.length, 1);
  assert.ok(H(player, { t: 'remove', kind: 'region', id: 'r1' }).error);
  assert.equal(H(dm, { t: 'remove', kind: 'region', id: 'r1' }).state, true);
});

test('los jugadores solo ven regiones no ocultas, y solo id, nombre, puntos y tipo', () => {
  const { room, dm, player, H } = setup();
  H(dm, { t: 'upsert', kind: 'region', item: region({ id: 'a', hidden: true }) });
  H(dm, { t: 'upsert', kind: 'region', item: region({ id: 'b', hidden: false, kind: 'message', text: 'secreto', damage: '1d6' }) });
  const seen = filterFor(room, player).scene.regions!;
  assert.deepEqual(seen.map((r) => r.id), ['b']);
  assert.deepEqual(Object.keys(seen[0]).sort(), ['hidden', 'id', 'kind', 'name', 'points']);
  assert.equal(filterFor(room, dm).scene.regions!.length, 2);
});

test('fog: oculta un token a un jugador, pero no al DM ni a su dueño', () => {
  const { room, dm, player, H } = setup();
  const has = (m: typeof dm, id: string) => filterFor(room, m).scene.tokens.some((t) => t.id === id);
  assert.ok(has(player, 'trasgo-a'));
  H(dm, { t: 'upsert', kind: 'region', item: region({ id: 'f', kind: 'fog', hidden: false, points: rect(540, 480, 600, 540) }) });
  assert.ok(!has(player, 'trasgo-a')); assert.ok(has(dm, 'trasgo-a'));
  assert.ok(!JSON.stringify(filterFor(room, player)).includes('Trasgo A'));
  H(dm, { t: 'upsert', kind: 'region', item: region({ id: 'f2', kind: 'fog', hidden: false, points: rect(480, 540, 540, 600) }) });
  assert.ok(has(player, 'kael')); // sus propios tokens no se ocultan
  H(dm, { t: 'remove', kind: 'region', id: 'f' });
  assert.ok(has(player, 'trasgo-a'));
});

test('trampa: salvación, daño completo/mitad, condición, tarjeta, y se dispara una sola vez', () => {
  const { room, dm, player, H } = setup();
  H(dm, { t: 'upsert', kind: 'region', item: region({ once: true, damage: '2d6', damageType: 'fire', save: { ability: 'dex', dc: 15 }, condition: 'prone', sfx: 'trap', name: 'Trampa de fuego' }) });
  assert.equal(kael(room).hp!.cur, 19);
  const r = H(player, { t: 'moveToken', id: 'kael', x: 240, y: 540 });
  assert.equal(r.state, true);
  const card = r.chats!.find((c) => c.card)!.card!;
  assert.equal(card.actionName, 'Trampa de fuego'); assert.equal(card.targets[0].save!.success, false); assert.equal(card.targets[0].amount, 7);
  assert.equal(kael(room).hp!.cur, 17); // 7 de daño: 5 temporales + 2 PG (dex mod +2 → 9 < 15 → falla)
  assert.ok(kael(room).conditions.includes('prone'));
  assert.deepEqual(r.sends!.map((s) => s.msg), [{ t: 'sfx', name: 'trap' }]);
  assert.equal(room.scene.regions![0].fired, true);
  H(player, { t: 'moveToken', id: 'kael', x: 500, y: 560 });
  const again = H(player, { t: 'moveToken', id: 'kael', x: 240, y: 540 });
  assert.equal(again.chats!.length, 0); assert.equal(kael(room).hp!.cur, 17);
  // sin once y superando la salvación: mitad del daño; y moverse dentro de la región no la re-dispara
  room.scene.regions![0] = region({ damage: '2d6', damageType: 'fire', save: { ability: 'dex', dc: 5 }, condition: 'prone' });
  kael(room).conditions = [];
  H(player, { t: 'moveToken', id: 'kael', x: 500, y: 560 });
  const half = H(player, { t: 'moveToken', id: 'kael', x: 240, y: 540 });
  assert.equal(half.chats![0].card!.targets[0].amount, 3); assert.equal(kael(room).hp!.cur, 14); assert.deepEqual(kael(room).conditions, []);
  assert.equal(H(player, { t: 'moveToken', id: 'kael', x: 250, y: 545 }).chats!.length, 0);
});

test('teleport, sonido, mensaje (solo dueños y DM), onlyAllies', () => {
  const { room, dm, player, H } = setup();
  H(dm, { t: 'upsert', kind: 'region', item: region({ id: 'tp', kind: 'teleport', to: { x: 300, y: 300 }, onlyAllies: true }) });
  assert.equal(H(dm, { t: 'moveToken', id: 'trasgo-a', x: 240, y: 540 }).state, true);
  assert.deepEqual([room.scene.tokens.find((t) => t.id === 'trasgo-a')!.x, room.scene.tokens.find((t) => t.id === 'trasgo-a')!.y], [240, 540]); // enemigo: no dispara
  H(player, { t: 'moveToken', id: 'kael', x: 240, y: 540 });
  assert.deepEqual([kael(room).x, kael(room).y], [300, 300]);
  room.scene.regions = [region({ id: 'snd', kind: 'sound', sfx: 'bell' }), region({ id: 'msg', kind: 'message', text: 'Un frío te recorre', points: rect(200, 500, 280, 580) })];
  H(player, { t: 'moveToken', id: 'kael', x: 500, y: 560 });
  const r = H(player, { t: 'moveToken', id: 'kael', x: 240, y: 540 });
  const to = (m: typeof dm) => r.sends!.filter((s) => s.who(m)).map((s) => s.msg);
  const other = joinRoom(room, 'Otro', undefined) as { member: typeof dm };
  assert.deepEqual(to(player), [{ t: 'sfx', name: 'bell' }, { t: 'regionMsg', text: 'Un frío te recorre' }]);
  assert.deepEqual(to(dm), to(player));
  assert.deepEqual(to(other.member), [{ t: 'sfx', name: 'bell' }]);
});

test('terreno difícil: el destino dentro cuesta el doble en combate', () => {
  const { room, dm, player, H } = setup();
  H(dm, { t: 'upsert', kind: 'region', item: region({ id: 'd', kind: 'difficult', hidden: false, points: rect(400, 500, 560, 620) }) });
  H(dm, { t: 'combat', op: 'start' });
  room.combat!.turn = room.combat!.order.findIndex((o) => o.tokenId === 'kael');
  H(player, { t: 'moveToken', id: 'kael', x: 450, y: 570 }); // 60 px = 1 casilla = 5 ft ×2
  assert.equal(room.combat!.used.kael.moved, 10);
  H(player, { t: 'moveToken', id: 'kael', x: 300, y: 570 }); // destino fuera: normal, 150 px = 12.5 ft
  assert.equal(room.combat!.used.kael.moved, 22.5);
});

test('notas del DM ocultas a jugadores; puerta con llave', () => {
  const { room, dm, player, H } = setup();
  room.scene.dmNotes = 'plan secreto'; kael(room).notes = 'nota de token';
  H(dm, { t: 'upsert', kind: 'wall', item: { id: 'dl', a: { x: 400, y: 600 }, b: { x: 400, y: 660 }, kind: 'door', open: false, locked: true, note: 'llave en el cofre' } });
  assert.equal(room.scene.walls.find((w) => w.id === 'dl')!.locked, true);
  const view = JSON.stringify(filterFor(room, player));
  for (const s of ['plan secreto', 'nota de token', 'llave en el cofre']) assert.ok(!view.includes(s), s);
  const d = JSON.stringify(filterFor(room, dm));
  for (const s of ['plan secreto', 'nota de token', 'llave en el cofre']) assert.ok(d.includes(s), s);
  assert.equal(H(player, { t: 'door', id: 'dl', open: true }).error, 'cerrada con llave');
  assert.equal(H(dm, { t: 'door', id: 'dl', open: true }).state, true);
  assert.equal(filterFor(room, player).scene.walls.find((w) => w.id === 'dl')!.locked, true);
  assert.ok(H(dm, { t: 'upsert', kind: 'wall', item: { id: 'x', a: { x: 1, y: 1 }, b: { x: 2, y: 2 }, kind: 'wall', locked: 'sí' } }).error);
});

test('diario: validación, visibilidad por miembro y handout', () => {
  const { room, dm, player, H } = setup();
  const other = joinRoom(room, 'Otro', undefined) as { member: typeof dm };
  const e = (id: string, visibleTo: unknown, x: object = {}) => ({ t: 'journal', entry: { id, title: 'T' + id, body: 'cuerpo', visibleTo, ...x } });
  assert.equal(H(dm, e('a', 'dm')).state, true); assert.equal(H(dm, e('b', 'all')).state, true); assert.equal(H(dm, e('c', [player.id])).state, true);
  assert.deepEqual(filterFor(room, dm).journal.map((j) => j.id), ['a', 'b', 'c']);
  assert.deepEqual(filterFor(room, player).journal.map((j) => j.id), ['b', 'c']);
  assert.deepEqual(filterFor(room, other.member).journal.map((j) => j.id), ['b']);
  assert.ok(H(player, e('z', 'all')).error);
  for (const x of [e('z', 'nadie'), e('z', ['fantasma']), e('z', 'all', { title: 'x'.repeat(121) }), e('z', 'all', { body: 'x'.repeat(20001) }), e('z', 'all', { image: 'javascript:1' }), e('z', 'all', { title: '' })])
    assert.ok(H(dm, x).error);
  assert.equal(H(dm, e('z', 'all', { body: 'x'.repeat(20000), image: '/assets/a.png' })).state, true);
  H(dm, e('b', 'all', { title: 'Nuevo' })); assert.equal(room.journal.find((j) => j.id === 'b')!.title, 'Nuevo'); assert.equal(room.journal.length, 4);
  const h = H(dm, { t: 'handout', entryId: 'c' });
  assert.equal(h.sends![0].msg.t, 'handout');
  assert.deepEqual([player, other.member, dm].map((m) => h.sends![0].who(m)), [true, false, true]);
  assert.ok(H(player, { t: 'handout', entryId: 'c' }).error && H(dm, { t: 'handout', entryId: 'nope' }).error);
  assert.ok(H(player, { t: 'journalDelete', id: 'a' }).error);
  assert.equal(H(dm, { t: 'journalDelete', id: 'a' }).state, true); assert.ok(H(dm, { t: 'journalDelete', id: 'a' }).error);
});

test('spawnMany: hasta 30, todo o nada, reutiliza spawn', () => {
  const { room, dm, player, H } = setup();
  const n0 = room.scene.tokens.length;
  const item = (srd = 'goblin') => ({ srd, x: 700, y: 300 });
  assert.equal(H(dm, { t: 'spawnMany', items: [item(), item(), item('ogre')], hidden: true }).state, true);
  const added = room.scene.tokens.slice(n0);
  assert.equal(added.length, 3); assert.ok(added.every((t) => t.hidden)); assert.equal(new Set(added.map((t) => t.id)).size, 3);
  assert.ok(H(player, { t: 'spawnMany', items: [item()] }).error);
  assert.ok(H(dm, { t: 'spawnMany', items: Array.from({ length: 31 }, () => item()) }).error);
  assert.ok(H(dm, { t: 'spawnMany', items: [] }).error);
  assert.ok(H(dm, { t: 'spawnMany', items: [item(), item('dragon-x')] }).error);
  assert.ok(H(dm, { t: 'spawnMany', items: [item(), { srd: 'goblin', x: -5, y: 1 }] }).error);
  assert.equal(room.scene.tokens.length, n0 + 3);
  assert.equal(H(dm, { t: 'spawnMany', items: Array.from({ length: 30 }, () => item()) }).state, true);
});

test('parseToken conserva la ficha completa de todos los monstruos del SRD', () => {
  const s = demoScene();
  for (const [srd, m] of Object.entries(MONSTERS)) {
    const { cr: _c, type: _t, ...base } = structuredClone(m);
    const tok = { ...base, id: srd, x: 100, y: 100, owners: [], hidden: false, srd, notes: 'n' };
    assert.deepEqual(JSON.parse(JSON.stringify(parseToken(s, tok))), JSON.parse(JSON.stringify(tok)), srd);
  }
});
