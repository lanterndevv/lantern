// Fase 10: movimiento, iniciativa, efectos de turno, concentración, manual, contraconjuro, plantillas y salvaciones de jugador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Effect, Room } from './room.ts';
import { createRoom, filterFor, handle, joinRoom } from './room.ts';

const roll = (e: string) => ({ total: 7, detail: e });
function setup() {
  const c = createRoom('Master', 'ABC234');
  if ('error' in c) throw new Error(c.error);
  const p = joinRoom(c.room, 'Ana', undefined), q = joinRoom(c.room, 'Bob', undefined);
  if ('error' in p || 'error' in q) throw new Error('join');
  const { room, member: dm } = c, player = p.member, bob = q.member;
  const H = (m: typeof dm, msg: unknown, r: (e: string) => { total: number; detail: string } = roll, now = 1000): Effect => handle(room, m, msg, r, now);
  return { room, dm, player, bob, H };
}
const tok = (room: Room, id: string) => room.scene.tokens.find((t) => t.id === id)!;
const combat = (room: Room, ids: string[], turn = 0) => { room.combat = { round: 1, turn, order: ids.map((tokenId, i) => ({ tokenId, init: 30 - i * 5 })), used: {} }; };
const texts = (fx: Effect) => [fx.chat, ...(fx.chats ?? [])].filter((c) => c).map((c) => c!.text ?? c!.roll?.detail ?? '');
const withRandom = <T>(seq: number[], f: () => T) => { const r = Math.random; let i = 0; Math.random = () => seq[Math.min(i++, seq.length - 1)]; try { return f(); } finally { Math.random = r; } };
const p = (x: number, y: number) => ({ x, y });

test('Escudo: shielded es un campo del token, no muta la CA y se limpia al acabar el combate', () => {
  const { room, dm, player, H } = setup();
  tok(room, 'kael').actions!.push({ id: 'shield', name: 'Escudo', cost: 'reaction', kind: 'heal', range: 0, slot: 1 });
  tok(room, 'trasgo-a').actions = [{ id: 'lanza', name: 'Lanza', cost: 'action', kind: 'attack', range: 30, toHit: 5, damage: '1d6' }];
  combat(room, ['trasgo-a', 'kael']);
  withRandom([0.5], () => H(dm, { t: 'act', tokenId: 'trasgo-a', actionId: 'lanza', targets: ['kael'] }));
  H(player, { t: 'react', pending: room.pending[0].pending!, tokenId: 'kael', actionId: 'shield' }, roll, 2000);
  assert.equal(tok(room, 'kael').shielded, true);
  assert.equal(tok(room, 'kael').ac, 15);
  // el campo sobrevive a una edición del DM (parseToken lo conserva) y se limpia al terminar el combate
  H(dm, { t: 'upsert', kind: 'token', item: structuredClone(tok(room, 'kael')) });
  assert.equal(tok(room, 'kael').shielded, true);
  H(dm, { t: 'combat', op: 'end' });
  assert.equal(tok(room, 'kael').shielded, undefined);
});

test('movimiento: puntos de paso, Correr, modos y aviso de ataque de oportunidad', () => {
  const { room, dm, player, H } = setup();
  const kael = tok(room, 'kael');
  combat(room, ['kael', 'trasgo-a']);
  const far = { t: 'moveToken', id: 'kael', x: 150, y: 270, path: [p(150, 570)] }; // 6 + 5 casillas = 55 pies
  assert.match(H(player, far).error!, /sin movimiento/);
  assert.equal(H(player, { t: 'turnAction', tokenId: 'kael', op: 'dash' }).state, true);
  assert.equal(room.combat!.used.kael.dash, 30);
  const fx = H(player, far);
  assert.equal(fx.error, undefined);
  assert.equal(room.combat!.used.kael.moved, 55);
  assert.deepEqual([kael.x, kael.y], [150, 270]);
  // volar sin velocidad de vuelo: no; con ella, sí
  room.combat!.used = {};
  assert.match(H(player, { t: 'moveToken', id: 'kael', x: 150, y: 330, mode: 'fly' }).error!, /no puede moverse así/);
  kael.speeds = { fly: 40 };
  assert.equal(H(player, { t: 'moveToken', id: 'kael', x: 150, y: 330, mode: 'fly' }).error, undefined);
  assert.ok(H(player, { t: 'moveToken', id: 'kael', x: 150, y: 330, mode: 'nadando' }).error);
  assert.ok(H(player, { t: 'moveToken', id: 'kael', x: 150, y: 330, path: 'x' }).error);
  // ataque de oportunidad: sale del alcance de Trasgo A (adyacente) y avisa; Destrabarse lo evita
  kael.x = 510; kael.y = 570; room.combat!.used = {};
  const opp = H(player, { t: 'moveToken', id: 'kael', x: 390, y: 570 });
  assert.ok(texts(opp).includes('Kael provoca un ataque de oportunidad de Trasgo A'));
  kael.x = 510; kael.y = 570; room.combat!.used = {};
  H(player, { t: 'turnAction', tokenId: 'kael', op: 'disengage' });
  assert.ok(!texts(H(player, { t: 'moveToken', id: 'kael', x: 390, y: 570 })).some((x) => /oportunidad/.test(x)));
  // enemigo oculto: el aviso es solo para el DM
  kael.x = 510; kael.y = 570; room.combat!.used = {}; tok(room, 'trasgo-a').hidden = true;
  const hid = H(player, { t: 'moveToken', id: 'kael', x: 390, y: 570 });
  assert.ok(hid.chats!.every((c) => c.roll?.blind) && hid.chats!.length === 1);
  void dm;
});

test('opciones de mesa: diagonal 5/10/5 y euclídea en el coste de la ruta', () => {
  const { room, dm, player, H } = setup();
  combat(room, ['kael']);
  H(dm, { t: 'settings', patch: { diagonal: 'alt' } });
  assert.equal(H(player, { t: 'moveToken', id: 'kael', x: 330, y: 390 }).error, undefined); // 3 diagonales: 5 + 10 + 5
  assert.equal(room.combat!.used.kael.moved, 20);
  H(dm, { t: 'settings', patch: { diagonal: 'euclid' } });
  room.combat!.used = {}; tok(room, 'kael').x = 510; tok(room, 'kael').y = 570;
  H(player, { t: 'moveToken', id: 'kael', x: 330, y: 390 });
  assert.ok(Math.abs(room.combat!.used.kael.moved - 3 * Math.SQRT2 * 5) < 1e-9);
  assert.ok(H(dm, { t: 'settings', patch: { diagonal: 'rara' } }).error);
  assert.ok(H(dm, { t: 'settings', patch: { hpView: 'todo' } }).error);
  assert.equal(H(dm, { t: 'settings', patch: { optional: { playerInit: true, ghostRoutes: true } } }).state, true);
  assert.ok(H(dm, { t: 'settings', patch: { optional: { inventada: true } } }).error);
});

test('ruta fantasma: solo con la opción y solo a quien ve el token', () => {
  const { room, dm, player, bob, H } = setup();
  assert.deepEqual(H(player, { t: 'route', tokenId: 'kael', points: [p(300, 500)] }), {}); // opción apagada
  H(dm, { t: 'settings', patch: { optional: { ghostRoutes: true } } });
  const fx = H(player, { t: 'route', tokenId: 'kael', points: [p(300, 500), p(320, 520)] });
  assert.equal(fx.sends!.length, 1);
  assert.equal(fx.sends![0].who(dm), true);
  assert.equal(fx.sends![0].who(player), false); // quien arrastra no se recibe a sí mismo
  assert.equal(fx.sends![0].who(bob), true); // los aliados se ven siempre
  tok(room, 'kael').hidden = true;
  assert.equal(H(player, { t: 'route', tokenId: 'kael', points: [p(300, 500)] }).sends![0].who(bob), false);
  assert.ok(H(bob, { t: 'route', tokenId: 'kael', points: [p(1, 1)] }).error); // no es suyo
  assert.ok(H(player, { t: 'route', tokenId: 'kael', points: [p(-5, 1)] }).error);
});

test('PG de enemigos para los jugadores: nada, por estado o exactos', () => {
  const { room, dm, player, H } = setup();
  const view = () => filterFor(room, player).scene.tokens.find((t) => t.id === 'trasgo-a')!;
  assert.equal(view().hp, undefined); assert.equal(view().hpState, undefined);
  H(dm, { t: 'settings', patch: { hpView: 'status' } });
  assert.equal(view().hp, undefined); assert.equal(view().hpState, 'critical'); // 2 de 7-10 PG
  assert.equal(view().ac, undefined);
  H(dm, { t: 'settings', patch: { hpView: 'exact' } });
  assert.deepEqual(view().hp, { cur: 2, max: tok(room, 'trasgo-a').hp!.max, temp: 0 }); assert.equal(view().ac, undefined);
  tok(room, 'trasgo-a').shielded = true; tok(room, 'trasgo-a').initAdv = true; tok(room, 'trasgo-a').effects = [{ id: 'e', name: 'Secreto', when: 'end' }];
  assert.ok(!/Secreto|initAdv|shielded/.test(JSON.stringify(filterFor(room, player))));
});

test('iniciativa: ventaja (initAdv), por grupos y tirada de los jugadores', () => {
  const { room, dm, player, bob, H } = setup();
  const exprs: string[] = [];
  let n = 0;
  const r = (e: string) => { exprs.push(e); return { total: 10 + n++, detail: e }; };
  tok(room, 'nix').initAdv = true;
  H(dm, { t: 'settings', patch: { optional: { groupInit: true } } });
  H(dm, { t: 'combat', op: 'start' }, r);
  assert.equal(exprs.filter((e) => e === '2d20kh1').length, 1);
  const ini = (id: string) => room.combat!.order.find((o) => o.tokenId === id)!.init;
  assert.equal(exprs.length, 7); // 4 aliados + 1 tirada por tipo de monstruo (trasgos, hobgoblins) + osgo
  const gob = ['trasgo-a', 'trasgo-b', 'trasgo-c'].map(ini);
  assert.equal(gob[0], gob[1]); assert.equal(gob[1], gob[2]);
  assert.equal(ini('hobgoblin'), ini('hobgoblin-2'));
  // los jugadores tiran la suya
  H(dm, { t: 'combat', op: 'end' });
  H(dm, { t: 'settings', patch: { optional: { groupInit: false, playerInit: true } } });
  const fx = H(dm, { t: 'combat', op: 'start' }, r);
  assert.deepEqual(room.combat!.awaiting, ['kael', 'ysolde']); // Ana y Bob
  assert.ok(!room.combat!.order.some((o) => o.tokenId === 'kael'));
  assert.deepEqual(filterFor(room, player).combat!.awaiting, ['kael', 'ysolde']); // los jugadores lo ven para poder tirar
  assert.equal(fx.chats!.length, 2);
  assert.ok(H(dm, { t: 'combat', op: 'next' }).error); // nadie avanza hasta que tiren
  assert.ok(H(bob, { t: 'rollInit', tokenId: 'kael' }).error); // no es suyo
  assert.equal(H(player, { t: 'rollInit', tokenId: 'kael' }).error, undefined);
  assert.deepEqual(room.combat!.awaiting, ['ysolde']);
  assert.equal(room.combat!.turn, 0);
  assert.equal(H(bob, { t: 'rollInit', tokenId: 'ysolde' }).error, undefined);
  assert.equal(room.combat!.awaiting, undefined);
  assert.ok(room.combat!.order.some((o) => o.tokenId === 'kael'));
  assert.equal(room.combat!.turn, 0);
  // el DM puede forzar
  H(dm, { t: 'combat', op: 'end' });
  H(dm, { t: 'combat', op: 'start' }, r);
  assert.equal(H(dm, { t: 'combat', op: 'forceInit' }).state, true);
  assert.equal(room.combat!.awaiting, undefined);
  assert.ok(H(dm, { t: 'combat', op: 'forceInit' }).error);
  void player;
});

test('tracker: agrupar, separar, reordenar y deshacer el último turno', () => {
  const { room, dm, player, H } = setup();
  combat(room, ['kael', 'trasgo-a', 'ysolde', 'trasgo-b', 'nix'], 2);
  const ids = () => room.combat!.order.map((o) => o.tokenId);
  assert.ok(H(player, { t: 'combat', op: 'group', tokenId: 'trasgo-a' }).error);
  assert.equal(H(dm, { t: 'combat', op: 'group', tokenId: 'trasgo-a' }).state, true);
  assert.deepEqual(ids(), ['kael', 'trasgo-a', 'trasgo-b', 'ysolde', 'nix']);
  assert.equal(room.combat!.order[2].init, room.combat!.order[1].init);
  assert.equal(ids()[room.combat!.turn], 'ysolde'); // el turno sigue en quien jugaba
  assert.ok(H(dm, { t: 'combat', op: 'group', tokenId: 'osgo' }).error);
  H(dm, { t: 'combat', op: 'split', tokenId: 'trasgo-b' }, (e) => ({ total: 20, detail: e }));
  assert.ok(room.combat!.order.every((o, i, a) => i === 0 || a[i - 1].init >= o.init));
  assert.equal(ids()[room.combat!.turn], 'ysolde');
  H(dm, { t: 'combat', op: 'move', tokenId: 'nix', to: 0 });
  assert.equal(ids()[0], 'nix'); assert.equal(ids()[room.combat!.turn], 'ysolde');
  assert.ok(room.combat!.order.every((o, i, a) => i === 0 || a[i - 1].init >= o.init));
  assert.ok(H(dm, { t: 'combat', op: 'move', tokenId: 'nix', to: 99 }).error);
  // deshacer turno
  combat(room, ['kael', 'ysolde']);
  assert.ok(H(dm, { t: 'combat', op: 'undoTurn' }).error);
  const hp = tok(room, 'ysolde').hp!.cur;
  H(dm, { t: 'combat', op: 'next' });
  H(dm, { t: 'hp', tokenId: 'ysolde', delta: 5, kind: 'damage' });
  assert.equal(room.combat!.turn, 1);
  assert.ok(H(player, { t: 'combat', op: 'undoTurn' }).error);
  assert.equal(H(dm, { t: 'combat', op: 'undoTurn' }).state, true);
  assert.equal(room.combat!.turn, 0); assert.equal(tok(room, 'ysolde').hp!.cur, hp);
});

test('presupuesto: Esquivar, Correr, objeto gratuito y corrección manual', () => {
  const { room, dm, player, bob, H } = setup();
  combat(room, ['kael', 'trasgo-a']);
  H(player, { t: 'turnAction', tokenId: 'kael', op: 'dodge' });
  assert.deepEqual([room.combat!.used.kael.action, room.combat!.used.kael.dodge], [true, true]);
  assert.match(H(player, { t: 'turnAction', tokenId: 'kael', op: 'hide' }).error!, /ya usada/);
  H(player, { t: 'budget', tokenId: 'kael', slot: 'action', used: false });
  assert.equal(room.combat!.used.kael.action, false);
  assert.ok(H(bob, { t: 'budget', tokenId: 'kael', slot: 'action', used: true }).error);
  assert.ok(H(player, { t: 'budget', tokenId: 'kael', slot: 'mana', used: true }).error);
  // objeto gratuito: el primero no gasta acción, el segundo sí
  room.combat!.used = {};
  H(player, { t: 'turnAction', tokenId: 'kael', op: 'useObject' });
  assert.deepEqual([room.combat!.used.kael.object, room.combat!.used.kael.action], [true, false]);
  H(player, { t: 'turnAction', tokenId: 'kael', op: 'useObject' });
  assert.equal(room.combat!.used.kael.action, true);
  // Esconderse tira Sigilo en secreto
  room.combat!.used = {};
  const h = H(player, { t: 'turnAction', tokenId: 'kael', op: 'hide' });
  assert.equal(h.chats![0].roll!.secret, true);
  // no es su turno
  assert.match(H(player, { t: 'turnAction', tokenId: 'kael', op: 'dash' }, roll).error ?? 'ok', /ya usada|ok/);
  room.combat!.turn = 1;
  assert.match(H(player, { t: 'turnAction', tokenId: 'kael', op: 'dodge' }).error!, /no es su turno/);
  // atacar a un token que esquiva: desventaja
  room.combat!.turn = 0; room.combat!.used = {};
  tok(room, 'trasgo-a').actions = [{ id: 'lanza', name: 'Lanza', cost: 'action', kind: 'attack', range: 30, toHit: 5, damage: '1d6' }];
  room.combat!.order = [{ tokenId: 'trasgo-a', init: 20 }, { tokenId: 'kael', init: 10 }];
  room.combat!.used.kael = { action: false, bonus: false, reaction: false, moved: 0, dodge: true };
  H(dm, { t: 'act', tokenId: 'trasgo-a', actionId: 'lanza', targets: ['kael'] });
  const dodged = withRandom([0.9, 0.1, 0.5], () => { room.combat!.used.trasgo_a = undefined as never; delete room.combat!.used['trasgo-a']; return H(dm, { t: 'act', tokenId: 'trasgo-a', actionId: 'lanza', targets: ['kael'] }); });
  assert.equal(dodged.chat!.card!.targets[0].attack!.mode, 'dis');
});

test('efectos de turno: recordatorio al dueño y al DM, salvación repetida, daño y regeneración', () => {
  const { room, dm, player, bob, H } = setup();
  const kael = tok(room, 'kael');
  assert.ok(H(player, { t: 'effect', op: 'add', tokenId: 'kael', effect: { name: 'X', when: 'end' } }).error); // solo DM
  assert.ok(H(dm, { t: 'effect', op: 'add', tokenId: 'kael', effect: { name: 'X', when: 'nunca' } }).error);
  // condición con salvación para terminarla → crea el efecto
  H(dm, { t: 'condition', tokenId: 'kael', condition: 'paralyzed', on: true, saveEnd: { ability: 'wis', dc: 14 }, sourceId: 'conc:trasgo-a' });
  assert.equal(kael.effects!.length, 1);
  assert.deepEqual([kael.effects![0].endsCondition, kael.effects![0].save], ['paralyzed', { ability: 'wis', dc: 14 }]);
  assert.ok(H(player, { t: 'condition', tokenId: 'kael', condition: 'poisoned', on: true, saveEnd: { ability: 'wis', dc: 14 } }).error);
  // aparece al terminar el turno
  combat(room, ['kael', 'ysolde']);
  const next = H(dm, { t: 'combat', op: 'next' });
  const rem = next.sends!.filter((s) => s.msg.t === 'turnReminder');
  assert.equal(rem.length, 1);
  assert.deepEqual([rem[0].who(player), rem[0].who(dm), rem[0].who(bob)], [true, true, false]);
  const id = kael.effects![0].id;
  // falla: sigue; supera: termina y quita la condición
  const fail = H(player, { t: 'effect', op: 'apply', tokenId: 'kael', effectId: id }, (e) => ({ total: 1, detail: e }));
  assert.ok(texts(fail)[0].includes('falla')); assert.equal(kael.effects!.length, 1); assert.ok(kael.conditions.includes('paralyzed'));
  const ok = H(player, { t: 'effect', op: 'apply', tokenId: 'kael', effectId: id }, (e) => ({ total: 20, detail: e }));
  assert.ok(texts(ok).some((t) => t.includes('supera')));
  assert.equal(kael.effects!.length, 0); assert.ok(!kael.conditions.includes('paralyzed')); assert.equal(kael.condSource?.paralyzed, undefined);
  // daño continuo (temporales primero) y regeneración; el efecto sigue hasta descartarlo
  H(dm, { t: 'effect', op: 'add', tokenId: 'kael', effect: { name: 'Ácido', when: 'start', damage: '1d6', damageType: 'acid' } });
  H(dm, { t: 'effect', op: 'add', tokenId: 'kael', effect: { name: 'Regeneración', when: 'start', heal: '1d6' } });
  const [dmg, reg] = kael.effects!;
  H(dm, { t: 'effect', op: 'apply', tokenId: 'kael', effectId: dmg.id });
  assert.deepEqual([kael.hp!.cur, kael.hp!.temp], [17, 0]);
  H(dm, { t: 'effect', op: 'apply', tokenId: 'kael', effectId: reg.id });
  assert.equal(kael.hp!.cur, 24);
  assert.equal(kael.effects!.length, 2);
  assert.ok(H(bob, { t: 'effect', op: 'dismiss', tokenId: 'kael', effectId: dmg.id }).error);
  H(player, { t: 'effect', op: 'dismiss', tokenId: 'kael', effectId: dmg.id });
  assert.equal(kael.effects!.length, 1);
  // inicio de turno del dueño
  combat(room, ['ysolde', 'kael']);
  const st = H(dm, { t: 'combat', op: 'next' });
  assert.equal(st.sends!.filter((s) => s.msg.t === 'turnReminder' && s.msg.phase === 'start').length, 1);
});

test('concentración: al romperse desaparecen regiones y condiciones ligadas por sourceId', () => {
  const { room, dm, H } = setup();
  const kael = tok(room, 'kael');
  const setupSpell = () => {
    kael.concentration = 'Telaraña';
    room.scene.regions = [
      { id: 'web', name: 'Telaraña', kind: 'difficult', hidden: false, points: [p(100, 100), p(200, 100), p(200, 200)], sourceId: 'conc:kael' },
      { id: 'otra', name: 'Otra', kind: 'difficult', hidden: false, points: [p(100, 100), p(200, 100), p(200, 200)] },
    ];
    H(dm, { t: 'condition', tokenId: 'trasgo-a', condition: 'restrained', on: true, sourceId: 'conc:kael' });
    H(dm, { t: 'condition', tokenId: 'trasgo-b', condition: 'poisoned', on: true });
  };
  setupSpell();
  const fx = H(dm, { t: 'hp', tokenId: 'kael', delta: 6, kind: 'damage' }, (e) => ({ total: 1, detail: e })); // CON falla
  assert.equal(kael.concentration, undefined);
  assert.deepEqual(room.scene.regions!.map((r) => r.id), ['otra']);
  assert.ok(!tok(room, 'trasgo-a').conditions.includes('restrained'));
  assert.ok(tok(room, 'trasgo-b').conditions.includes('poisoned')); // lo que no viene del conjuro se queda
  assert.ok(texts(fx).some((t) => /se disipan/.test(t)));
  // soltarla a mano, cambiar de conjuro o quedar inconsciente también
  setupSpell();
  H(dm, { t: 'concentration', tokenId: 'kael', spell: null });
  assert.deepEqual(room.scene.regions!.map((r) => r.id), ['otra']);
  setupSpell();
  H(dm, { t: 'condition', tokenId: 'kael', condition: 'stunned', on: true });
  assert.ok(!tok(room, 'trasgo-a').conditions.includes('restrained'));
  // superar la salvación la mantiene
  setupSpell();
  H(dm, { t: 'condition', tokenId: 'kael', condition: 'stunned', on: false });
  kael.concentration = 'Telaraña';
  H(dm, { t: 'hp', tokenId: 'kael', delta: 6, kind: 'damage' }, (e) => ({ total: 20, detail: e }));
  assert.equal(kael.concentration, 'Telaraña');
  assert.ok(room.scene.regions!.some((r) => r.id === 'web'));
});

test('conjuro con condición: la crea ligada a la concentración del lanzador', () => {
  const { room, dm, player, H } = setup();
  const kael = tok(room, 'kael');
  kael.actions!.push({ id: 'retener', name: 'Retener persona', cost: 'action', kind: 'save', range: 60, save: { ability: 'wis', dc: 30, half: false }, damage: '0', slot: 2, condition: 'paralyzed' });
  H(dm, { t: 'automation', value: 'auto' });
  H(player, { t: 'act', tokenId: 'kael', actionId: 'retener', targets: ['trasgo-a'] });
  assert.equal(kael.concentration, 'Retener persona');
  assert.ok(tok(room, 'trasgo-a').conditions.includes('paralyzed'));
  assert.equal(tok(room, 'trasgo-a').condSource!.paralyzed, 'conc:kael');
  H(dm, { t: 'concentration', tokenId: 'kael', spell: null });
  assert.ok(!tok(room, 'trasgo-a').conditions.includes('paralyzed'));
});

test('automatización manual: sin comparar CA, con Aplicar/Mitad/Curar', () => {
  const { room, dm, player, H } = setup();
  assert.ok(H(player, { t: 'automation', value: 'manual' }).error);
  assert.equal(H(dm, { t: 'automation', value: 'manual' }).state, true);
  tok(room, 'trasgo-b').x = 570; tok(room, 'trasgo-b').y = 570;
  const fx = withRandom([0.05, 0.5, 0.5], () => H(dm, { t: 'act', tokenId: 'kael', actionId: 'rayo-escarcha', targets: ['trasgo-b'] })); // d20 = 2: contra CA 15 fallaría
  const card = fx.chat!.card!;
  assert.equal(card.manual, true);
  assert.ok(card.pending);
  assert.equal(card.targets[0].attack!.hit, true);
  assert.equal(card.targets[0].attack!.total, 2 + 7); // el total real, sin verdicto
  const hp = tok(room, 'trasgo-b').hp!.cur;
  assert.equal(tok(room, 'trasgo-b').hp!.cur, hp); // nada se aplica solo
  assert.ok(H(player, { t: 'confirm', pending: card.pending!, mode: 'full' }).error); // solo el DM
  H(dm, { t: 'confirm', pending: card.pending!, mode: 'half' });
  const half = tok(room, 'trasgo-b').hp!.cur;
  assert.ok(half < hp);
  // Curar: los importes se aplican como curación
  const c2 = withRandom([0.5], () => H(dm, { t: 'act', tokenId: 'kael', actionId: 'proyectil-magico', targets: ['trasgo-b'] })).chat!.card!;
  H(dm, { t: 'confirm', pending: c2.pending!, mode: 'heal' });
  assert.ok(tok(room, 'trasgo-b').hp!.cur > half);
  // salvaciones: fallan por defecto (daño completo) pero el total mostrado es el real
  const c3 = withRandom([0.5], () => H(dm, { t: 'act', tokenId: 'kael', actionId: 'bola-fuego', targets: ['trasgo-b'] })).chat!.card!;
  assert.equal(c3.targets[0].save!.total, 11 + (tok(room, 'trasgo-b').saves?.dex ?? 0));
  H(dm, { t: 'automation', value: 'assisted' });
  const c4 = withRandom([0.5], () => H(dm, { t: 'act', tokenId: 'kael', actionId: 'rayo-escarcha', targets: ['trasgo-b'] })).chat!.card!;
  assert.ok(H(dm, { t: 'confirm', pending: c4.pending!, mode: 'heal' }).error); // Curar solo en manuales
  assert.equal(c4.manual, undefined);
  void room;
});

test('Contraconjuro: aviso de 5 s al dueño con un conjuro visible a 60 pies', () => {
  const { room, dm, player, H } = setup();
  const goblin = tok(room, 'trasgo-b'), kael = tok(room, 'kael');
  goblin.x = 700; goblin.y = 480;
  goblin.actions = [{ id: 'chispa', name: 'Chispa', cost: 'action', kind: 'save', range: 60, save: { ability: 'dex', dc: 12, half: true }, damage: '2d6', slot: 1, school: 'evocación' }];
  goblin.slots = { 1: { max: 2, used: 0 } };
  kael.actions!.push({ id: 'counterspell', name: 'Contraconjuro', cost: 'reaction', kind: 'heal', range: 0, slot: 3 });
  combat(room, ['trasgo-b', 'kael']);
  const cast = () => { for (const sl of Object.values(goblin.slots!)) sl.used = 0; return withRandom([0.5], () => H(dm, { t: 'act', tokenId: 'trasgo-b', actionId: 'chispa', targets: ['kael'] }, roll, 1000)); };
  const fx = cast();
  const pr = fx.sends!.filter((s) => s.msg.t === 'reactionPrompt');
  assert.equal(pr.length, 1);
  assert.deepEqual([pr[0].who(player), pr[0].who(dm)], [true, false]);
  const msg = pr[0].msg as Extract<typeof pr[0]['msg'], { t: 'reactionPrompt' }>;
  assert.equal(msg.expires, 6000); assert.equal(msg.actionId, 'counterspell');
  // el rótulo del conjuro lo ve quien ve al lanzador
  const banner = fx.sends!.find((s) => s.msg.t === 'spellBanner')!;
  assert.deepEqual(banner.msg, { t: 'spellBanner', name: 'Chispa', school: 'evocación', level: 1, caster: 'Trasgo B' });
  assert.equal(banner.who(dm), true);
  const pending = room.pending[0].pending!, used = kael.slots![3].used;
  const ok = H(player, { t: 'react', pending, tokenId: 'kael', actionId: 'counterspell' }, roll, 5000);
  assert.equal(ok.error, undefined, String(ok.error));
  assert.equal(room.pending.length, 0);
  assert.equal(kael.slots![3].used, used + 1);
  assert.equal(room.combat!.used.kael.reaction, true);
  const card = ok.chats!.at(-1)!.card!;
  assert.equal(card.applied, true); assert.equal(card.targets[0].amount, 0); assert.match(card.detail!, /Contrarrestado/);
  // sin línea de visión, lejos (>60 pies) u oculto: no hay aviso
  kael.slots![3].used = used; room.combat!.used = {};
  kael.elevation = 100; goblin.actions![0].range = 400; // lejos (>60 pies)
  assert.equal(cast().sends!.filter((s) => s.msg.t === 'reactionPrompt').length, 0);
  kael.elevation = 0; goblin.actions![0].range = 60; goblin.hidden = true; room.combat!.used = {}; room.pending.length = 0;
  const hx = cast(); assert.equal(hx.error, undefined, String(hx.error)); assert.equal(hx.sends!.filter((s) => s.msg.t === 'reactionPrompt').length, 0);
  // espacio de nivel inferior: prueba de característica
  goblin.hidden = false; room.combat!.used = {}; room.pending.length = 0;
  goblin.actions![0].slot = 5; goblin.slots = { 5: { max: 1, used: 0 } };
  cast();
  const pend2 = room.pending[0].pending!;
  const lose = H(player, { t: 'react', pending: pend2, tokenId: 'kael', actionId: 'counterspell' }, (e) => ({ total: 1, detail: e }), 5000);
  assert.ok(texts(lose).some((t) => /falla/.test(t)));
  assert.equal(room.pending.length, 1);
  // caducado a los 5 s
  room.combat!.used = {}; room.pending.length = 0; kael.slots![3].used = used;
  cast();
  assert.match(H(player, { t: 'react', pending: room.pending[0].pending!, tokenId: 'kael', actionId: 'counterspell' }, roll, 7001).error!, /caducado/);
});

test('plantilla colocada: el servidor elige los objetivos dentro del área respetando muros', () => {
  const { room, dm, player, H } = setup();
  const kael = tok(room, 'kael');
  kael.x = 930; kael.y = 450; // sala del osgo; radio 20 pies = 240 px
  const cast = (extra: object = {}) => withRandom([0.5], () => H(player, { t: 'act', tokenId: 'kael', actionId: 'bola-fuego', targets: [], at: p(930, 510), ...extra }));
  const ids = (fx: Effect) => fx.chat!.card!.targets.map((t) => t.id).sort();
  const fx = cast();
  assert.equal(fx.error, undefined);
  const base = ids(fx);
  assert.ok(base.includes('trasgo-b') && base.includes('osgo') && base.includes('hobgoblin'));
  assert.ok(!base.includes('trasgo-c')); // a más de 20 pies
  // un muro entre el centro y el hobgoblin lo deja fuera
  room.scene.walls.push({ id: 'muro', a: p(980, 250), b: p(980, 480), kind: 'wall' });
  kael.slots![3].used = 0;
  const behind = ids(cast());
  assert.ok(!behind.includes('hobgoblin')); assert.ok(behind.includes('osgo'));
  // los objetivos que envía el cliente se ignoran; fuera de alcance / inválido
  kael.slots![3].used = 0;
  assert.ok(!ids(cast({ targets: ['trasgo-c'] })).includes('trasgo-c'));
  kael.actions!.find((a) => a.id === 'bola-fuego')!.range = 30;
  assert.match(cast({ at: p(1400, 100) }).error!, /alcance/);
  kael.actions!.find((a) => a.id === 'bola-fuego')!.range = 150;
  assert.ok(cast({ at: p(-5, 1) }).error);
  // cilindro = esfera en 2D
  kael.actions!.push({ id: 'col', name: 'Columna', cost: 'action', kind: 'save', range: 150, save: { ability: 'dex', dc: 15, half: true }, damage: '2d6', area: { shape: 'cylinder', size: 10 } });
  const cyl = withRandom([0.5], () => H(player, { t: 'act', tokenId: 'kael', actionId: 'col', targets: [], at: p(930, 510) }));
  assert.deepEqual(ids(cyl), ['kael', 'trasgo-b']); // el lanzador queda dentro de una esfera centrada a 1 casilla
  // sin punto: sigue valiendo la lista del cliente
  assert.equal(H(dm, { t: 'act', tokenId: 'kael', actionId: 'col', targets: ['trasgo-b'] }).error, undefined);
});

test('salvaciones de jugador en su cliente: petición, respuesta y caducidad', () => {
  const { room, dm, player, bob, H } = setup();
  const goblin = tok(room, 'trasgo-b');
  goblin.x = 700; goblin.y = 480;
  goblin.actions = [{ id: 'chispa', name: 'Chispa', cost: 'action', kind: 'save', range: 60, save: { ability: 'dex', dc: 12, half: true }, damage: '2d6' }];
  const cast = (now: number) => withRandom([0.5], () => H(dm, { t: 'act', tokenId: 'trasgo-b', actionId: 'chispa', targets: ['kael', 'brida'] }, roll, now));
  // apagado: todo sale ya resuelto
  assert.ok(cast(1000).chat!.card!.targets.every((t) => t.save));
  room.pending.length = 0;
  H(dm, { t: 'settings', patch: { optional: { playerSaves: true } } });
  const fx = cast(1000);
  const card = room.pending[0];
  assert.deepEqual(card.awaiting, ['kael']);
  const shown = fx.chat!.card!.targets;
  assert.equal(shown.find((t) => t.id === 'kael')!.save, undefined); // aún oculto
  assert.ok(shown.find((t) => t.id === 'brida')!.save); // el monstruo/PNJ sin dueño ya está tirado
  const rq = fx.sends!.filter((s) => s.msg.t === 'saveRequest');
  assert.equal(rq.length, 1); assert.deepEqual([rq[0].who(player), rq[0].who(bob)], [true, false]);
  assert.match(H(bob, { t: 'answerSave', pending: card.pending!, tokenId: 'kael' }).error!, /no permitido/);
  const ans = H(player, { t: 'answerSave', pending: card.pending!, tokenId: 'kael' }, roll, 5000);
  assert.equal(ans.error, undefined);
  assert.equal(card.awaiting, undefined);
  assert.ok(card.targets.find((t) => t.id === 'kael')!.save);
  assert.ok(ans.chats![0].roll!.dice?.length);
  assert.ok(card.pending); // en asistido sigue pendiente de confirmar
  assert.match(H(player, { t: 'answerSave', pending: card.pending!, tokenId: 'kael' }).error!, /hay salvación|ya has/);
  // caducidad: cualquier mensaje posterior revela lo tirado
  room.pending.length = 0;
  cast(10_000);
  const c2 = room.pending[0];
  const sw = H(dm, { t: 'ping', x: 10, y: 10 }, roll, 31_000);
  assert.equal(sw.state, true);
  assert.equal(c2.awaiting, undefined);
  assert.ok(c2.targets.every((t) => t.save));
  // en automático, al llegar la última respuesta se aplica
  room.pending.length = 0;
  H(dm, { t: 'automation', value: 'auto' });
  cast(40_000);
  const hp = tok(room, 'kael').hp!.cur + tok(room, 'kael').hp!.temp;
  H(player, { t: 'answerSave', pending: room.pending[0].pending!, tokenId: 'kael' }, roll, 41_000);
  assert.equal(room.pending.length, 0);
  assert.ok(tok(room, 'kael').hp!.cur + tok(room, 'kael').hp!.temp < hp);
  // el DM confirma sin esperar
  H(dm, { t: 'automation', value: 'assisted' });
  cast(50_000);
  const pid = room.pending[0].pending!;
  H(dm, { t: 'confirm', pending: pid, mode: 'full' }, roll, 51_000);
  assert.equal(room.pending.length, 0);
});

test('salvaciones de jugador: el temporizador del servidor las revela y sobreviven a un reinicio', async () => {
  const { openDb } = await import('./db.ts');
  const { sweepHolds } = await import('./room.ts');
  const { room, dm, H } = setup();
  tok(room, 'trasgo-b').actions = [{ id: 'chispa', name: 'Chispa', cost: 'action', kind: 'save', range: 60, save: { ability: 'dex', dc: 12, half: true }, damage: '2d6' }];
  H(dm, { t: 'settings', patch: { optional: { playerSaves: true } } });
  withRandom([0.5], () => H(dm, { t: 'act', tokenId: 'trasgo-b', actionId: 'chispa', targets: ['kael'] }, roll, 1000));
  const pid = room.pending[0].pending!;
  assert.equal(sweepHolds(room, roll, 5000), null); // aún no caduca
  const db = openDb(':memory:'); // reinicio: se guarda y se carga
  db.save(room);
  const r2 = db.load(room.code)!;
  assert.deepEqual(r2.pending[0].awaiting, ['kael']);
  assert.ok(r2.holds![pid]);
  const fx = sweepHolds(r2, roll, 22_000)!; // sin ningún mensaje de por medio
  assert.equal(fx.state, true);
  assert.equal(r2.pending[0].awaiting, undefined);
  assert.ok(r2.pending[0].targets.every((t) => t.save));
  assert.equal(r2.holds?.[pid], undefined);
  db.close();
});

test('Multiataque: encadena los ataques con los mismos objetivos y gasta la acción una sola vez', () => {
  const { room, dm, H } = setup();
  const g = tok(room, 'trasgo-a');
  g.actions = [{ id: 'lanza', name: 'Lanza', cost: 'action', kind: 'attack', range: 30, toHit: 5, damage: '1d6', damageType: 'piercing' },
    { id: 'multiattack', name: 'Multiataque', cost: 'action', kind: 'attack', range: 30, multi: [{ id: 'lanza', n: 2 }] }];
  combat(room, ['trasgo-a', 'kael']);
  const fx = withRandom([0.5], () => H(dm, { t: 'act', tokenId: 'trasgo-a', actionId: 'multiattack', targets: ['kael'] }));
  assert.equal(fx.error, undefined);
  assert.equal(fx.chats!.filter((c) => c.card).length, 2);
  assert.equal(room.combat!.used['trasgo-a'].action, true);
  assert.equal(H(dm, { t: 'act', tokenId: 'trasgo-a', actionId: 'multiattack', targets: ['kael'] }).error, 'ya usada');
});
