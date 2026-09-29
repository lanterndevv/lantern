import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Scene, Token } from '@lantern/protocol';
import { canSee, chatFor, createRoom, filterFor, handle, joinRoom, mergeSettings, redact } from './room.ts';
import { daylight } from './world.ts';
import { parseJournal } from './validate.ts';

const tok = (id: string, x: number, y: number, o: Partial<Token> = {}): Token => ({ id, name: id, x, y, size: 1, faction: 'ally', hidden: false, owners: [], darkvision: 0, conditions: [], speed: 30, ...o });
const blank = (): Scene => ({ id: 's', name: 'S', width: 1400, height: 1000, grid: { size: 60, offsetX: 0, offsetY: 0, feet: 5 }, walls: [], lights: [], tokens: [], globalLight: 1 });
let t0 = 1000;
function setup() {
  const c = createRoom('Master', 'ABC234', blank());
  if ('error' in c) throw new Error(c.error);
  const room = c.room, dm = c.member;
  const mk = (n: string) => (joinRoom(room, n, undefined) as { member: typeof dm }).member;
  const ana = mk('Ana'), bo = mk('Bo'), cy = mk('Cy');
  const H = (m: typeof dm, msg: unknown, now = (t0 += 100)) => handle(room, m, msg, (e) => ({ total: 4, detail: e }), now);
  const put = (t: Token) => H(dm, { t: 'upsert', kind: 'token', item: t });
  put(tok('a', 120, 120, { owners: [ana.id] })); put(tok('b', 600, 600, { owners: [bo.id] })); put(tok('ogro', 300, 300, { faction: 'enemy' }));
  return { room, dm, ana, bo, cy, H, put };
}
const tk = (r: ReturnType<typeof setup>['room'], id: string) => r.scene.tokens.find((t) => t.id === id)!;

test('chat: susurro, en personaje y emote', () => {
  const { room, dm, ana, bo, cy, H } = setup();
  const w = H(ana, { t: 'chat', text: 'psst', to: [bo.id], as: 'a', emote: true });
  assert.deepEqual([w.chat!.to, w.chat!.as, w.chat!.emote], [[bo.id], 'a', true]);
  for (const [m, ok] of [[ana, true], [bo, true], [dm, true], [cy, false]] as const) assert.equal(canSee(w.chat!, m), ok);
  assert.ok(!JSON.stringify(chatFor(room, cy)).includes('psst'));
  assert.ok(JSON.stringify(chatFor(room, bo)).includes('psst'));
  assert.equal(redact(room, w.chat!, cy).text, 'Susurro'); // defensa
  assert.ok(H(ana, { t: 'chat', text: 'x', to: ['nadie'] }).error);
  assert.ok(H(ana, { t: 'chat', text: 'x', to: [] }).error);
  assert.ok(H(ana, { t: 'chat', text: 'x', to: Array(11).fill(bo.id) }).error);
  assert.ok(H(ana, { t: 'chat', text: 'x', as: 'b' }).error); // token ajeno
  assert.equal(H(dm, { t: 'chat', text: 'x', as: 'b' }).chat!.as, 'b');
  assert.ok(H(ana, { t: 'chat', text: 'x', emote: 'si' }).error);
  assert.equal(H(ana, { t: 'chat', text: 'hola' }).chat!.to, undefined);
});

test('dibujo: efímero, persistente con permiso, límites y borrado', () => {
  const { room, dm, ana, bo, H } = setup();
  const d = (id: string, o: object = {}) => ({ t: 'draw', persist: true, item: { id, points: [{ x: 1, y: 1 }, { x: 50, y: 50 }], color: '#ff0000', width: 3, by: 'falso', ...o } });
  const eph = H(ana, { ...d('e'), persist: false });
  assert.equal(eph.all!.t, 'draw'); assert.equal(room.scene.drawings, undefined);
  assert.equal(H(ana, d('p1')).error, 'no permitido'); // por defecto solo el DM
  assert.equal(H(dm, d('p1')).state, true);
  assert.equal(room.scene.drawings![0].by, dm.id); // `by` no se fía del cliente
  assert.equal((mergeSettings(room.settings, { drawing: 'all' }) as { drawing?: string }).drawing, 'all');
  assert.ok(!mergeSettings(room.settings, { drawing: 'x' }));
  assert.equal(H(dm, { t: 'settings', patch: { drawing: 'all' } }).state, true);
  assert.equal(H(ana, d('p2')).state, true);
  for (const bad of [{ points: [] }, { points: Array(501).fill({ x: 1, y: 1 }) }, { points: [{ x: -1, y: 1 }] }, { color: 'red' }, { width: 0 }, { width: 21 }, { level: 'nope' }])
    assert.ok(H(ana, d('bad', bad)).error, JSON.stringify(bad));
  assert.ok(H(ana, d('p2')).error); // duplicado
  assert.equal(H(bo, { t: 'erase', id: 'p2' }).error, 'no permitido');
  assert.ok(H(bo, { t: 'erase', id: 'all' }).error);
  assert.equal(H(ana, { t: 'erase', id: 'p2' }).state, true);
  H(ana, d('p3')); H(ana, d('p4'));
  H(ana, { t: 'erase', id: 'mine' });
  assert.deepEqual(room.scene.drawings!.map((x) => x.id), ['p1']);
  H(dm, { t: 'erase', id: 'all' }); assert.equal(room.scene.drawings!.length, 0);
  for (let i = 0; i < 300; i++) assert.equal(H(dm, d('m' + i)).state, true);
  assert.equal(H(dm, d('m300')).error, 'demasiados dibujos');
});

test('cursor y focusAll', () => {
  const { room, dm, ana, bo, cy, H } = setup();
  const us = (fx: ReturnType<typeof H>, m: typeof dm) => fx.sends!.some((s) => s.who(m));
  const fx = H(ana, { t: 'cursor', x: 10, y: 10 }, 5000);
  assert.ok(us(fx, bo) && us(fx, dm) && !us(fx, ana)); // todos comparten planta base
  let sent = 0;
  for (let i = 0; i < 40; i++) if (H(bo, { t: 'cursor', x: 10, y: 10 }, 8000 + i * 10).sends) sent++;
  assert.equal(sent, 15);
  assert.ok(H(bo, { t: 'cursor', x: 10, y: 10 }, 9500).sends); // pasado el segundo
  assert.ok(H(ana, { t: 'cursor', x: -5, y: 1 }, 20000).error);
  // otra planta: Bo sube y deja de ver el cursor de Ana
  H(dm, { t: 'upsert', kind: 'level', item: { id: 'L1', name: 'Base' } }); H(dm, { t: 'upsert', kind: 'level', item: { id: 'L2', name: 'Alta' } });
  tk(room, 'b').level = 'L2';
  assert.ok(!us(H(ana, { t: 'cursor', x: 1, y: 1 }, 30000), bo));
  const spec = (joinRoom(room, 'Esp', undefined, 'spectator') as { member: typeof dm }).member;
  assert.deepEqual(H(spec, { t: 'cursor', x: 1, y: 1 }, 40000), {});
  assert.equal(H(dm, { t: 'focusAll', x: 5, y: 5 }).all!.t, 'focus');
  assert.equal(H(ana, { t: 'focusAll', x: 5, y: 5 }).error, 'no permitido');
  assert.ok(H(dm, { t: 'focusAll', x: 5e9, y: 5 }).error);
  void cy;
});

test('deshacer: DM el último cambio, jugador solo su movimiento', () => {
  const { room, dm, ana, bo, H } = setup();
  assert.equal(filterFor(room, dm).canUndo, true); // los upserts de setup
  while (H(dm, { t: 'undo' }).state) { /* vacía la pila */ }
  assert.equal(filterFor(room, dm).canUndo, false);
  assert.equal(H(dm, { t: 'undo' }).error, 'nada que deshacer');
  H(dm, { t: 'upsert', kind: 'token', item: tok('a', 120, 120, { owners: [ana.id], hp: { cur: 5, max: 10, temp: 0 } }) });
  H(dm, { t: 'upsert', kind: 'token', item: tok('b', 600, 600, { owners: [bo.id] }) });
  H(dm, { t: 'upsert', kind: 'token', item: tok('ogro', 300, 300, { faction: 'enemy' }) });
  H(ana, { t: 'moveToken', id: 'a', x: 180, y: 120 });
  assert.equal(filterFor(room, ana).canUndo, true); assert.equal(filterFor(room, bo).canUndo, false);
  H(bo, { t: 'moveToken', id: 'b', x: 660, y: 600 });
  assert.equal(H(bo, { t: 'undo' }).state, true); assert.equal(tk(room, 'b').x, 600);
  assert.equal(H(bo, { t: 'undo' }).error, 'nada que deshacer');
  // el DM toca a `a` después: Ana ya no puede deshacer
  H(dm, { t: 'hp', tokenId: 'a', delta: 1, kind: 'temp' });
  assert.equal(H(ana, { t: 'undo' }).error, 'nada que deshacer');
  // deshacer del DM: quita el temp y luego (siguiente) el movimiento
  H(dm, { t: 'undo' }); assert.equal(tk(room, 'a').hp!.temp, 0);
  assert.equal(tk(room, 'a').x, 180);
  H(dm, { t: 'undo' }); assert.equal(tk(room, 'a').x, 120);
  // límite de 30
  for (let i = 0; i < 40; i++) H(dm, { t: 'door', id: 'x' }), H(dm, { t: 'moveToken', id: 'ogro', x: 300 + i, y: 300 });
  let n = 0; while (H(dm, { t: 'undo' }).state) n++;
  assert.equal(n, 30); assert.equal(tk(room, 'ogro').x, 300 + 9);
  assert.equal(H(dm, { t: 'spawn', srd: 'goblin', x: 100, y: 100 }).error === undefined, true);
  assert.equal(H(dm, { t: 'undo' }).state, true); assert.ok(!room.scene.tokens.some((t) => t.srd === 'goblin'));
});

test('deshacer en combate: solo en tu turno y devuelve el movimiento', () => {
  const { room, dm, ana, H } = setup();
  H(dm, { t: 'combat', op: 'start' });
  const c = room.combat!;
  const first = c.order[c.turn].tokenId;
  const owner = first === 'a' ? ana : null;
  if (!owner) { c.turn = c.order.findIndex((o) => o.tokenId === 'a'); }
  c.used['a'] = { action: false, bonus: false, reaction: false, moved: 0 };
  assert.equal(H(ana, { t: 'moveToken', id: 'a', x: 180, y: 120 }).state, true);
  assert.equal(c.used['a'].moved, 5);
  c.turn = c.order.findIndex((o) => o.tokenId === 'ogro'); // ya no es su turno
  assert.equal(H(ana, { t: 'undo' }).error, 'nada que deshacer');
  assert.equal(filterFor(room, ana).canUndo, false);
  c.turn = c.order.findIndex((o) => o.tokenId === 'a');
  assert.equal(H(ana, { t: 'undo' }).state, true);
  assert.equal(c.used['a'].moved, 0); assert.equal(tk(room, 'a').x, 120);
});

test('reloj del mundo: luz exterior y antorchas', () => {
  const { room, dm, ana, H } = setup();
  assert.equal(filterFor(room, ana).clock, 480);
  assert.equal(H(dm, { t: 'clock' }).clock, true); // sin advance sigue siendo la sincronización
  assert.deepEqual([0, 5 * 60, 6 * 60, 7 * 60, 12 * 60, 18 * 60, 19 * 60, 20 * 60, 23 * 60].map(daylight), [0, 0, 0.5, 1, 1, 1, 0.5, 0, 0]);
  H(dm, { t: 'scene', patch: { outdoor: true } });
  assert.equal(room.scene.outdoor, true);
  H(dm, { t: 'upsert', kind: 'light', item: { id: 'tea', x: 1, y: 1, bright: 10, dim: 20, color: '#ffaa00', burnUntil: 600, follow: 'a' } });
  H(dm, { t: 'upsert', kind: 'light', item: { id: 'fija', x: 1, y: 1, bright: 10, dim: 20, color: '#ffaa00' } });
  assert.equal(H(ana, { t: 'clock', advance: 5 }).error, 'no permitido');
  for (const bad of [-1441, 43201, 1.5, 'x']) assert.ok(H(dm, { t: 'clock', advance: bad }).error);
  H(dm, { t: 'clock', advance: 60 }); // 9:00
  assert.equal(room.clock, 540); assert.equal(room.scene.globalLight, 1);
  H(ana, { t: 'moveToken', id: 'a', x: 180, y: 180 });
  const lt = room.scene.lights.find((l) => l.id === 'tea')!;
  assert.deepEqual([lt.x, lt.y], [180, 180]); // la luz sigue a su token
  const fx = H(dm, { t: 'clock', advance: 12 * 60 + 60 }); // 22:00 (+ el día)
  assert.equal(room.scene.globalLight, 0);
  assert.deepEqual(fx.chats!.map((c) => c.text), ['La antorcha de a se apaga']);
  assert.deepEqual(room.scene.lights.map((l) => l.id), ['fija']);
  assert.equal(H(dm, { t: 'clock', advance: -1440 }).state, true);
  assert.equal(room.clock, 0); // no baja de 0
});

test('rollTable', () => {
  const { room, dm, ana, H } = setup();
  const table = { dice: '1d6', rows: [{ min: 1, max: 3, text: 'Nada' }, { min: 4, max: 6, text: 'Un lobo' }] };
  H(dm, { t: 'journal', entry: { id: 'e', title: 'Encuentros', body: '', visibleTo: 'dm', table } });
  H(dm, { t: 'journal', entry: { id: 'p', title: 'Pública', body: '', visibleTo: 'all', table } });
  assert.equal(room.journal.length, 2);
  assert.equal(H(ana, { t: 'rollTable', entryId: 'e' }).error, 'no existe');
  const fx = H(ana, { t: 'rollTable', entryId: 'p', secret: true });
  assert.equal(fx.chat!.roll!.expr, 'Tabla Pública: Un lobo'); assert.equal(fx.chat!.roll!.secret, true);
  assert.equal(H(dm, { t: 'rollTable', entryId: 'e' }).chat!.roll!.secret, false);
  const m = new Map([[dm.id, 1]]);
  const bad = (t: unknown) => parseJournal({ id: 'x', title: 't', body: '', visibleTo: 'all', table: t }, m);
  assert.ok(bad(table));
  for (const t of [{ ...table, dice: 'zz' }, { ...table, rows: [] }, { ...table, rows: Array(101).fill({ min: 1, max: 1, text: 'a' }) },
    { ...table, rows: [{ min: 3, max: 1, text: 'a' }] }, { ...table, rows: [{ min: 1, max: 4, text: 'a' }, { min: 4, max: 6, text: 'b' }] },
    { ...table, rows: [{ min: 1, max: 6, text: 'a'.repeat(201) }] }, { ...table, rows: [{ min: 1.5, max: 6, text: 'a' }] }, 'x'])
    assert.equal(bad(t), null, JSON.stringify(t));
  // fuera de rango de la tabla
  H(dm, { t: 'journal', entry: { id: 'g', title: 'Huecos', body: '', visibleTo: 'all', table: { dice: '1d6', rows: [{ min: 1, max: 2, text: 'a' }] } } });
  assert.match(H(ana, { t: 'rollTable', entryId: 'g' }).error!, /sin resultado/);
});

test('tokenImage', () => {
  const { room, dm, ana, bo, H } = setup();
  assert.equal(H(ana, { t: 'tokenImage', tokenId: 'a', img: '/assets/' + 'a'.repeat(64) + '.png' }).state, true);
  assert.match(tk(room, 'a').img!, /^\/assets\//);
  assert.equal(H(bo, { t: 'tokenImage', tokenId: 'a', img: 'https://x.es/a.png' }).error, 'no permitido');
  assert.equal(H(dm, { t: 'tokenImage', tokenId: 'a', img: 'https://x.es/a.png' }).state, true);
  for (const img of ['http://x.es/a.png', 'javascript:alert(1)', '/etc/passwd', 5]) assert.ok(H(ana, { t: 'tokenImage', tokenId: 'a', img }).error);
});

test('moveMany: todo o nada y arrastra a los llevados', () => {
  const { room, dm, ana, H, put } = setup();
  put(tok('a2', 180, 240, { owners: [ana.id] }));
  const r = H(ana, { t: 'moveMany', moves: [{ id: 'a', x: 240, y: 120 }, { id: 'a2', x: 240, y: 240 }] });
  assert.equal(r.state, true); assert.deepEqual([tk(room, 'a').x, tk(room, 'a2').x], [240, 240]);
  const f = H(ana, { t: 'moveMany', moves: [{ id: 'a', x: 300, y: 120 }, { id: 'b', x: 1, y: 1 }] }); // b no es suyo
  assert.ok(f.error); assert.equal(tk(room, 'a').x, 240);
  assert.ok(H(ana, { t: 'moveMany', moves: [{ id: 'a', x: 300, y: 120 }, { id: 'a', x: 1, y: 1 }] }).error);
  assert.ok(H(ana, { t: 'moveMany', moves: [] }).error);
  assert.ok(H(dm, { t: 'moveMany', moves: Array.from({ length: 13 }, () => ({ id: 'a', x: 1, y: 1 })) }).error);
  // muro: el segundo paso falla y el primero se revierte
  room.scene.walls.push({ id: 'w', a: { x: 400, y: 0 }, b: { x: 400, y: 1000 }, kind: 'wall' });
  const g = H(ana, { t: 'moveMany', moves: [{ id: 'a', x: 270, y: 120 }, { id: 'a2', x: 500, y: 240 }] });
  assert.ok(g.error); assert.equal(tk(room, 'a').x, 240);
  // un solo undo deshace todo el grupo
  assert.equal(H(dm, { t: 'undo' }).state, true); assert.deepEqual([tk(room, 'a').x, tk(room, 'a2').x], [120, 180]);
});

test('carry: montura, agarre, cadena y ciclos', () => {
  const { room, dm, ana, bo, H, put } = setup();
  put(tok('gato', 180, 120)); // contiguo a `a`
  put(tok('rata', 240, 120));
  assert.equal(H(ana, { t: 'carry', tokenId: 'gato', by: 'a' }).state, true);
  assert.equal(tk(room, 'gato').carriedBy, 'a');
  assert.ok(H(ana, { t: 'carry', tokenId: 'ogro', by: 'a' }).error); // lejos
  assert.equal(H(ana, { t: 'carry', tokenId: 'rata', by: 'gato' }).error, 'no permitido'); // gato no es suyo
  assert.equal(H(bo, { t: 'carry', tokenId: 'a', by: 'b' }).error, 'demasiado lejos');
  H(dm, { t: 'carry', tokenId: 'rata', by: 'gato' }); // el DM sin restricción de distancia
  assert.equal(H(dm, { t: 'carry', tokenId: 'a', by: 'rata' }).error, 'no se permiten ciclos');
  assert.equal(H(dm, { t: 'carry', tokenId: 'a', by: 'a' }).error, 'token inexistente');
  H(ana, { t: 'moveToken', id: 'a', x: 120, y: 240 });
  assert.deepEqual([tk(room, 'gato').x, tk(room, 'gato').y, tk(room, 'rata').x, tk(room, 'rata').y], [180, 240, 240, 240]);
  H(ana, { t: 'moveMany', moves: [{ id: 'a', x: 120, y: 300 }] });
  assert.equal(tk(room, 'rata').y, 300);
  assert.equal(H(ana, { t: 'carry', tokenId: 'gato', by: null }).state, true);
  assert.equal(tk(room, 'gato').carriedBy, undefined);
  H(ana, { t: 'moveToken', id: 'a', x: 120, y: 360 });
  assert.equal(tk(room, 'gato').y, 300); // suelto: ya no se mueve
  assert.equal(H(ana, { t: 'carry', tokenId: 'gato', by: null }).error, 'no lo lleva nadie');
  // un enemigo contiguo solo se arrastra si está apresado
  put(tok('orco', 180, 360, { faction: 'enemy' }));
  assert.equal(H(ana, { t: 'carry', tokenId: 'orco', by: 'a' }).error, 'no permitido');
  tk(room, 'orco').conditions.push('grappled');
  assert.equal(H(ana, { t: 'carry', tokenId: 'orco', by: 'a' }).state, true);
});
