import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Scene, Token } from '@lantern/protocol';
import { canSee, chatFor, createRoom, filterFor, handle, joinRoom } from './room.ts';
import { clockOf } from './world.ts';

const tok = (id: string, x: number, y: number, o: Partial<Token> = {}): Token => ({ id, name: id, x, y, size: 1, faction: 'ally', hidden: false, owners: [], darkvision: 0, conditions: [], speed: 30, ...o });
const blank = (): Scene => ({ id: 's', name: 'S', width: 1400, height: 1000, grid: { size: 60, offsetX: 0, offsetY: 0, feet: 5 }, walls: [], lights: [], tokens: [], globalLight: 1 });
let t0 = 1000;
function setup(rolls: number[] = []) {
  const c = createRoom('Master', 'ABC234', blank());
  if ('error' in c) throw new Error(c.error);
  const room = c.room, dm = c.member;
  const mk = (n: string) => (joinRoom(room, n, undefined) as { member: typeof dm }).member;
  const ana = mk('Ana'), bo = mk('Bo');
  const q = [...rolls];
  const H = (m: typeof dm, msg: unknown) => handle(room, m, msg, (e) => ({ total: q.length ? q.shift()! : 4, detail: e }), (t0 += 100));
  return { room, dm, ana, bo, H };
}
const mkScene = (H: ReturnType<typeof setup>['H'], dm: ReturnType<typeof setup>['dm'], name: string) => {
  H(dm, { t: 'sceneNew', name });
};

test('transición de escena: elegible, validada y solo para el DM', () => {
  const { room, dm, ana, H } = setup();
  mkScene(H, dm, 'Bosque');
  const id = Object.values(room.scenes).find((s) => s.name === 'Bosque')!.id;
  const fx = H(dm, { t: 'sceneActivate', id, transition: { kind: 'ink', ms: 3000 } });
  assert.deepEqual(fx.all, { t: 'transition', title: 'Bosque', kind: 'ink', ms: 3000 });
  assert.equal(room.activeId, id);
  assert.equal(H(dm, { t: 'sceneActivate', id: 's' }).all, undefined); // sin transición: como siempre
  for (const bad of [{ kind: 'zoom', ms: 1000 }, { kind: 'fade', ms: 100 }, { kind: 'fade', ms: 99999 }, 'fade'])
    assert.ok(H(dm, { t: 'sceneActivate', id, transition: bad }).error, JSON.stringify(bad));
  assert.equal(room.activeId, 's'); // las inválidas no cambian nada
  assert.equal(H(ana, { t: 'sceneActivate', id, transition: { kind: 'fade', ms: 1000 } }).error, 'no permitido');
  // tarjeta de título con estilo
  assert.deepEqual(H(dm, { t: 'transition', title: 'Capítulo 2', kind: 'title', ms: 1500 }).all, { t: 'transition', title: 'Capítulo 2', kind: 'title', ms: 1500 });
  assert.equal((H(dm, { t: 'transition', title: 'X' }).all as { kind?: string }).kind, undefined);
  assert.ok(H(dm, { t: 'transition', title: 'X', kind: 'nada' }).error);
  assert.equal(H(ana, { t: 'transition', title: 'X', kind: 'fade' }).error, 'no permitido');
});

test('precarga: solo imágenes de la escena, sin fichas ocultas', () => {
  const { room, dm, ana, H } = setup();
  mkScene(H, dm, 'Cripta');
  const id = Object.values(room.scenes).find((s) => s.name === 'Cripta')!.id, sc = room.scenes[id];
  sc.background = '/assets/mapa.png'; sc.story = { image: '/assets/hist.png', layers: [{ image: '/assets/l1.png', depth: 0.5 }] };
  sc.tokens.push(tok('boss', 10, 10, { hidden: true, faction: 'enemy', img: '/assets/secreto.png' }));
  const fx = H(dm, { t: 'scenePrepare', id });
  assert.deepEqual(fx.all, { t: 'prepare', id, urls: ['/assets/mapa.png', '/assets/hist.png', '/assets/l1.png'] });
  assert.ok(!JSON.stringify(fx).includes('secreto'));
  assert.equal(room.activeId, 's'); // preparar no activa
  assert.equal(H(ana, { t: 'scenePrepare', id }).error, 'no permitido');
  assert.ok(H(dm, { t: 'scenePrepare', id: 'nope' }).error);
});

test('viaje: escala, ritmo, reloj y encuentros por jornada', () => {
  const { room, dm, ana, H } = setup([5, 19, 3]);
  const pts = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }]; // 600 px = 10 casillas
  const msg = { t: 'travel', points: pts, pace: 'normal' };
  assert.match(H(dm, msg).error!, /escala/);
  assert.equal(H(dm, { t: 'scene', patch: { miles: 3 } }).state, true); // 10 casillas × 3 mi = 30 mi
  assert.equal(H(ana, msg).error, 'no permitido');
  const before = clockOf(room);
  H(dm, { t: 'journal', entry: { id: 'enc', title: 'Encuentros', body: '', visibleTo: 'dm', table: { dice: '1d6', rows: [{ min: 1, max: 6, text: 'Lobos' }] } } });
  const fx = H(dm, { ...msg, tableId: 'enc' });
  assert.equal(fx.error, undefined);
  assert.equal(clockOf(room) - before, 600 + 960); // 30 mi a 3 mi/h = 10 h + 16 h de descanso entre 2 jornadas
  const txt = fx.chats!.map((c) => c.text ?? c.roll?.expr).join('|');
  assert.match(txt, /30 mi a ritmo normal/); assert.match(txt, /2 jornadas/);
  assert.ok(!/Jornada 1/.test(txt)); // tirada 5: sin encuentro; 19: encuentro en la jornada 2
  assert.match(txt, /Jornada 2: encuentro/); assert.match(txt, /Lobos/);
  for (const c of fx.chats!.filter((x) => x.roll)) assert.equal(canSee(c, ana), false); // secretos
  assert.ok(!JSON.stringify(chatFor(room, ana)).includes('Lobos'));
  // ritmo rápido avisa del penalizador; validaciones
  assert.match(H(dm, { ...msg, pace: 'fast' }).chats![0].text!, /−5 a la Percepción pasiva/);
  assert.match(H(dm, { ...msg, pace: 'slow' }).chats![0].text!, /sigilo/);
  for (const bad of [{ pace: 'volando' }, { points: [pts[0]] }, { points: [pts[0], { x: -5, y: 0 }] }, { dc: 1 }, { dc: 21 }, { tableId: 'nada' }])
    assert.ok(H(dm, { ...msg, ...bad }).error, JSON.stringify(bad));
  H(dm, { t: 'scene', patch: { miles: 1000 } });
  assert.match(H(dm, { ...msg, points: [{ x: 0, y: 0 }, { x: 1400, y: 1000 }, { x: 0, y: 0 }, { x: 1400, y: 1000 }, { x: 0, y: 0 }, { x: 1400, y: 1000 }] }).error!, /largo/); // pasa de 30 días
});

test('aviso tras la sesión: solo en Sencillo, solo para el DM', () => {
  const { room, dm, ana, H } = setup();
  H(dm, { t: 'upsert', kind: 'token', item: tok('a', 100, 100, { owners: [ana.id], hp: { cur: 5, max: 9, temp: 0 } }) });
  H(dm, { t: 'settings', patch: { mode: 'simple' } });
  for (let i = 0; i < 8; i++) H(dm, { t: 'hp', tokenId: 'a', delta: 1, kind: 'damage' });
  for (let i = 0; i < 2; i++) H(dm, { t: 'roll', expr: '1d20+2' }); // por debajo del umbral
  const fx = H(dm, { t: 'sessionEnd' });
  assert.equal(fx.all, undefined);
  const to = (m: typeof dm) => fx.sends!.filter((s) => s.who({ ...m })).map((s) => s.msg as { summary: { tips?: { text: string; patch: unknown }[] } });
  const forDm = to(dm), forAna = to(ana);
  assert.equal(forDm.length, 1); assert.equal(forAna.length, 1);
  assert.equal(forDm[0].summary.tips!.length, 1);
  assert.match(forDm[0].summary.tips![0].text, /PG a mano 8 veces/);
  assert.deepEqual(forDm[0].summary.tips![0].patch, { mode: 'full', layers: { automation: true } });
  assert.equal(forAna[0].summary.tips, undefined);
  assert.equal(H(dm, { t: 'settings', patch: forDm[0].summary.tips![0].patch }).state, true); // el botón lo activa
  assert.equal(room.settings.mode, 'full');
  // contadores reiniciados y en modo Completo no hay aviso
  for (let i = 0; i < 9; i++) H(dm, { t: 'hp', tokenId: 'a', delta: 1, kind: 'heal' });
  assert.equal(H(dm, { t: 'sessionEnd' }).sends, undefined);
});

test('tarjeta de documento: solo para quienes lo reciben', () => {
  const { room, dm, ana, bo, H } = setup();
  H(dm, { t: 'journal', entry: { id: 'carta', title: 'Carta', body: 'x', image: '/assets/carta.png', visibleTo: [ana.id] } });
  const fx = H(dm, { t: 'handout', entryId: 'carta' });
  const card = fx.chats![0];
  assert.deepEqual(card.doc, { entryId: 'carta', title: 'Carta', image: '/assets/carta.png' });
  assert.deepEqual(card.to, [ana.id]);
  assert.equal(canSee(card, ana), true); assert.equal(canSee(card, dm), true); assert.equal(canSee(card, bo), false);
  assert.ok(!JSON.stringify(chatFor(room, bo)).includes('carta'));
  assert.ok(JSON.stringify(chatFor(room, ana)).includes('carta'));
  H(dm, { t: 'journal', entry: { id: 'sec', title: 'Secreto', body: 'x', visibleTo: 'dm' } });
  assert.equal(H(dm, { t: 'handout', entryId: 'sec' }).chats, undefined); // nadie más lo recibe: sin tarjeta
  assert.equal(H(ana, { t: 'handout', entryId: 'carta' }).error, 'no permitido');
});

test('clima por región y por planta', () => {
  const { room, dm, ana, H } = setup();
  H(dm, { t: 'upsert', kind: 'token', item: tok('a', 100, 100, { owners: [ana.id] }) });
  const poly = [{ x: 50, y: 50 }, { x: 300, y: 50 }, { x: 300, y: 300 }];
  const w = { kind: 'rain', intensity: 0.7, wind: 0.2 };
  assert.equal(H(dm, { t: 'upsert', kind: 'region', item: { id: 'r1', name: 'Llovizna', points: poly, kind: 'weather', hidden: false, weather: w } }).state, true);
  assert.ok(H(dm, { t: 'upsert', kind: 'region', item: { id: 'r2', name: 'x', points: poly, kind: 'weather', hidden: false } }).error); // sin clima
  assert.ok(H(dm, { t: 'upsert', kind: 'region', item: { id: 'r3', name: 'x', points: poly, kind: 'weather', hidden: false, weather: { kind: 'lava', intensity: 1, wind: 0 } } }).error);
  H(dm, { t: 'upsert', kind: 'region', item: { id: 'r4', name: 'Oculta', points: poly, kind: 'weather', hidden: true, weather: { kind: 'snow', intensity: 1, wind: 0 } } });
  const seen = filterFor(room, ana).scene.regions!;
  assert.deepEqual(seen.map((r) => [r.id, r.weather?.kind]), [['r1', 'rain']]); // la oculta no llega
  assert.equal(filterFor(room, dm).scene.regions!.length, 2);
  // planta: se conserva al renombrar y se quita con null
  H(dm, { t: 'upsert', kind: 'level', item: { id: 'L0', name: 'Base' } });
  H(dm, { t: 'upsert', kind: 'level', item: { id: 'L1', name: 'Torre', weather: w } });
  assert.deepEqual(room.scene.levels![1].weather, w);
  H(dm, { t: 'upsert', kind: 'level', item: { id: 'L1', name: 'Torre alta' } });
  assert.deepEqual(room.scene.levels![1].weather, w);
  assert.ok(H(dm, { t: 'upsert', kind: 'level', item: { id: 'L1', name: 'T', weather: { kind: 'x' } } }).error);
  H(dm, { t: 'upsert', kind: 'level', item: { id: 'L1', name: 'Torre alta', weather: null } });
  assert.equal(room.scene.levels![1].weather, undefined);
});
