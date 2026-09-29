import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, filterFor, handle, joinRoom } from './room.ts';

const fakeRoll = (e: string) => ({ total: 7, detail: e });
function setup() {
  const c = createRoom('Master', 'ABC234');
  if ('error' in c) throw new Error(c.error);
  const a = joinRoom(c.room, 'Ana', undefined), b = joinRoom(c.room, 'Bo', undefined);
  if ('error' in a || 'error' in b) throw new Error('join');
  return { room: c.room, dm: c.member, ana: a.member, bo: b.member };
}

test('tokenOwners: solo DM, valida miembros y da/quita control', () => {
  const { room, dm, ana, bo } = setup();
  const t = room.scene.tokens.find((x) => x.faction === 'neutral' || x.faction === 'enemy')!;
  assert.ok(handle(room, ana, { t: 'moveToken', id: t.id, x: t.x + 5, y: t.y }, fakeRoll).error, 'sin permiso no mueve');
  assert.ok(handle(room, ana, { t: 'tokenOwners', tokenId: t.id, owners: [ana.id] }, fakeRoll).error, 'jugador no concede');
  assert.ok(handle(room, dm, { t: 'tokenOwners', tokenId: t.id, owners: ['fantasma'] }, fakeRoll).error);
  assert.ok(handle(room, dm, { t: 'tokenOwners', tokenId: 'nada', owners: [] }, fakeRoll).error);
  assert.equal(handle(room, dm, { t: 'tokenOwners', tokenId: t.id, owners: [ana.id, ana.id] }, fakeRoll).state, true);
  assert.deepEqual(t.owners, [ana.id]);
  assert.equal(handle(room, ana, { t: 'moveToken', id: t.id, x: t.x + 5, y: t.y }, fakeRoll).error, undefined, 'con permiso mueve');
  assert.ok(handle(room, bo, { t: 'moveToken', id: t.id, x: t.x, y: t.y }, fakeRoll).error, 'otro jugador sigue sin poder');
  handle(room, dm, { t: 'tokenOwners', tokenId: t.id, owners: [] }, fakeRoll);
  assert.ok(handle(room, ana, { t: 'moveToken', id: t.id, x: t.x, y: t.y }, fakeRoll).error, 'revocado');
});

test('escena visibleTo: el excluido no recibe mapa ni puede actuar; el DM y los listados lo ven', () => {
  const { room, dm, ana, bo } = setup();
  const id = room.activeId, n = room.scene.tokens.length;
  assert.ok(handle(room, ana, { t: 'sceneUpdate', id, visibleTo: [ana.id] }, fakeRoll).error, 'jugador no puede');
  assert.ok(handle(room, dm, { t: 'sceneUpdate', id, visibleTo: ['fantasma'] }, fakeRoll).error);
  assert.equal(handle(room, dm, { t: 'sceneUpdate', id, visibleTo: [ana.id] }, fakeRoll).state, true);
  assert.ok(filterFor(room, ana).scene.tokens.length > 0 || n === 0);
  const off = filterFor(room, bo);
  assert.equal(off.scene.tokens.length, 0); assert.equal(off.scene.walls.length, 0); assert.equal(off.scene.name, ''); assert.ok(!('visibleTo' in off.scene));
  assert.equal(JSON.stringify(off).includes(room.scene.name), false);
  assert.ok(!('library' in off));
  assert.deepEqual(filterFor(room, ana).scene.visibleTo, undefined, 'la lista no viaja a los jugadores');
  assert.equal(filterFor(room, dm).library![0].visibleTo?.[0], ana.id);
  // el excluido solo puede hablar/tirar
  const t = room.scene.tokens.find((x) => x.owners.includes(bo.id)) ?? room.scene.tokens[0];
  t.owners.push(bo.id);
  assert.ok(handle(room, bo, { t: 'moveToken', id: t.id, x: t.x + 5, y: t.y }, fakeRoll).error);
  assert.ok(handle(room, bo, { t: 'ping', x: 1, y: 1 }, fakeRoll).error);
  assert.ok(!handle(room, bo, { t: 'chat', text: 'hola' }, fakeRoll).error);
  // quitar la restricción
  handle(room, dm, { t: 'sceneUpdate', id, visibleTo: null }, fakeRoll);
  assert.ok(filterFor(room, bo).scene.tokens.length > 0);
});

test('diario: visibleTo por miembro en lista, pins, rollTable y handout', () => {
  const { room, dm, ana, bo } = setup();
  const entry = { id: 'e1', title: 'Secreto', body: 'x', visibleTo: [ana.id], table: { dice: '1d6', rows: [{ min: 1, max: 20, text: 'ok' }] } };
  assert.equal(handle(room, dm, { t: 'journal', entry }, fakeRoll).state, true);
  assert.equal(filterFor(room, ana).journal.length, 1);
  assert.equal(filterFor(room, bo).journal.length, 0);
  assert.ok(handle(room, bo, { t: 'journal', entry: { ...entry, visibleTo: 'all' } }, fakeRoll).error, 'jugador no edita');
  assert.ok(handle(room, bo, { t: 'rollTable', entryId: 'e1' }, fakeRoll).error, 'ni tira en tablas ajenas');
  assert.ok(!handle(room, ana, { t: 'rollTable', entryId: 'e1' }, fakeRoll).error);
  room.scene.pins = [{ id: 'p1', x: 10, y: 10, entryId: 'e1' }];
  assert.equal(filterFor(room, bo).scene.pins?.length, 0);
  assert.equal(filterFor(room, ana).scene.pins?.length, 1);
  const h = handle(room, dm, { t: 'handout', entryId: 'e1' }, fakeRoll);
  assert.ok(h.sends![0].who(ana) && !h.sends![0].who(bo));
});
