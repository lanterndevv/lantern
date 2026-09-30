import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMsg, Scene, Token } from '@lantern/protocol';
import { chatFor, createRoom, filterFor, handle, joinRoom, canSee, pathBlocked, type MemberRec, type Room } from './room.ts';

const tk = (id: string, x: number, y: number, o: Partial<Token> = {}): Token => ({ id, name: id, x, y, size: 1, faction: 'ally', hidden: false, owners: [], darkvision: 0, conditions: [], ...o });
const scene = (): Scene => ({ id: 's', name: 'S', width: 1000, height: 1000, grid: { size: 50, offsetX: 0, offsetY: 0, feet: 5 }, walls: [], lights: [], tokens: [], globalLight: 1 });
let seq = [] as number[]; // tiradas de d20/d6 predeterminadas (se consumen en orden; si se agotan, 10)
const roll = (e: string) => {
  const m = /^(\d*)d(\d+)/.exec(e);
  if (!m) return { total: Number(e), detail: e };
  const n = Number(m[1] || 1), v = Array.from({ length: n }, () => seq.shift() ?? 10);
  return { total: v.reduce((a, b) => a + b, 0), detail: `${e}=${v.join('+')}`, dice: v.map((value) => ({ sides: Number(m[2]), value, kept: true })) };
};
function setup(toks: Token[] = []) {
  const s = scene(); s.tokens = toks;
  const c = createRoom('DM', 'ABC234', s); if ('error' in c) throw new Error(c.error);
  const room = c.room, dm = c.member;
  const mk = (n: string) => (joinRoom(room, n, undefined) as { member: MemberRec }).member;
  let t = 1000;
  const H = (m: MemberRec, msg: unknown, at = t++) => handle(room, m, msg, roll, at);
  seq = [];
  return { room, dm, mk, H };
}
const texts = (r: Room, m: MemberRec) => chatFor(r, m);

test('plantas: alta, límites, validación de level y borrado en cascada', () => {
  const { room, dm, mk, H } = setup();
  const p = mk('Ana');
  assert.ok(H(p, { t: 'upsert', kind: 'level', item: { id: 'a', name: 'A' } }).error);
  assert.ok(H(dm, { t: 'upsert', kind: 'level', item: { id: 'x'.repeat(41), name: 'A' } }).error);
  assert.ok(H(dm, { t: 'upsert', kind: 'level', item: { id: 'a', name: 'x'.repeat(41) } }).error);
  for (let i = 0; i < 10; i++) assert.equal(H(dm, { t: 'upsert', kind: 'level', item: { id: 'p' + i, name: 'P' + i } }).state, true);
  assert.ok(H(dm, { t: 'upsert', kind: 'level', item: { id: 'extra', name: 'E' } }).error);
  assert.equal(H(dm, { t: 'upsert', kind: 'level', item: { id: 'p3', name: 'Renombrada' } }).state, true); // actualizar sí
  assert.equal(room.scene.levels!.length, 10);
  // level inexistente → error; existente → ok; sin level → ok
  const wall = (id: string, level?: string) => ({ t: 'upsert', kind: 'wall', item: { id, a: { x: 0, y: 0 }, b: { x: 10, y: 10 }, kind: 'wall', ...(level && { level }) } });
  assert.ok(H(dm, wall('w0', 'nada')).error);
  assert.equal(H(dm, wall('w1', 'p1')).state, true);
  assert.equal(H(dm, wall('w2')).state, true);
  assert.ok(H(dm, { t: 'upsert', kind: 'token', item: tk('t', 5, 5, { level: 'nada' }) }).error);
  assert.ok(H(dm, { t: 'upsert', kind: 'light', item: { id: 'l', x: 1, y: 1, bright: 1, dim: 2, color: '#fff', level: 'nada' } }).error);
  assert.ok(H(dm, { t: 'upsert', kind: 'region', item: { id: 'r', name: 'R', kind: 'message', hidden: false, text: 'x', points: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }], toLevel: 'nada' } }).error);
  // borrar p1 borra lo que hay en ella
  H(dm, { t: 'upsert', kind: 'token', item: tk('t1', 5, 5, { level: 'p1' }) });
  H(dm, { t: 'upsert', kind: 'light', item: { id: 'l1', x: 1, y: 1, bright: 1, dim: 2, color: '#fff', level: 'p1' } });
  H(dm, { t: 'upsert', kind: 'region', item: { id: 'r1', name: 'R', kind: 'message', hidden: false, text: 'x', level: 'p1', points: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }] } });
  H(dm, { t: 'upsert', kind: 'token', item: tk('t0', 5, 5) });
  assert.ok(H(p, { t: 'remove', kind: 'level', id: 'p1' }).error && H(dm, { t: 'remove', kind: 'level', id: 'nada' }).error);
  assert.equal(H(dm, { t: 'remove', kind: 'level', id: 'p1' }).state, true);
  const s = room.scene;
  assert.deepEqual([s.tokens.map((t) => t.id), s.walls.map((w) => w.id), s.lights.length, s.regions!.length, s.levels!.length], [['t0'], ['w2'], 0, 0, 9]);
});

test('plantas: visión, colisión y cobertura por planta; filtrado de jugador', () => {
  const { room, dm, mk, H } = setup();
  const p = mk('Ana');
  for (const id of ['up']) H(dm, { t: 'upsert', kind: 'level', item: { id, name: id } });
  room.scene.levels = [{ id: 'base', name: 'Base' }, { id: 'up', name: 'Arriba' }];
  room.scene.tokens.push(tk('hero', 100, 500, { owners: [p.id] }), tk('orcUp', 300, 500, { faction: 'enemy', level: 'up' }), tk('orc', 300, 500, { faction: 'enemy' }), tk('friendUp', 50, 500, { level: 'up', owners: ['otro'] }));
  room.scene.walls.push({ id: 'wUp', a: { x: 200, y: 400 }, b: { x: 200, y: 600 }, kind: 'wall', level: 'up' }, { id: 'wBase', a: { x: 700, y: 0 }, b: { x: 700, y: 1000 }, kind: 'wall' });
  room.scene.lights.push({ id: 'lUp', x: 150, y: 500, bright: 10, dim: 20, color: '#fff', level: 'up' }, { id: 'lB', x: 150, y: 500, bright: 10, dim: 20, color: '#fff' });
  const st = filterFor(room, p);
  // el muro de arriba no tapa la visión de la planta base
  assert.deepEqual(st.scene.tokens.map((t) => t.id).sort(), ['friendUp', 'hero', 'orc']);
  assert.deepEqual(st.scene.walls.map((w) => w.id), ['wBase']);
  assert.deepEqual(st.scene.lights.map((l) => l.id), ['lB']);
  // colisión y planta
  assert.equal(pathBlocked(room.scene, { x: 100, y: 500 }, { x: 300, y: 500 }), false);
  assert.equal(pathBlocked(room.scene, { x: 100, y: 500 }, { x: 300, y: 500 }, 'up'), true);
  assert.equal(H(p, { t: 'moveToken', id: 'hero', x: 300, y: 500 }).state, true);
  // el jugador sube: recibe la planta de arriba y la visión usa sus muros
  room.scene.tokens.find((t) => t.id === 'hero')!.level = 'up';
  room.scene.tokens.find((t) => t.id === 'hero')!.x = 100;
  const up = filterFor(room, p);
  assert.deepEqual(up.scene.tokens.map((t) => t.id).sort(), ['friendUp', 'hero']);
  assert.deepEqual(up.scene.walls.map((w) => w.id), ['wUp']);
  assert.deepEqual(up.scene.lights.map((l) => l.id), ['lUp']);
  // el DM lo recibe todo
  assert.equal(filterFor(room, dm).scene.walls.length, 2);
  // cobertura por planta: el muro de arriba no cubre a los de la base
  room.scene.tokens.find((t) => t.id === 'hero')!.actions = [{ id: 'a', name: 'A', cost: 'action', kind: 'attack', range: 60, toHit: 5, damage: '1d4' }];
  room.scene.tokens.find((t) => t.id === 'hero')!.level = undefined;
  room.scene.tokens.find((t) => t.id === 'hero')!.x = 100;
  const card = H(dm, { t: 'act', tokenId: 'hero', actionId: 'a', targets: ['orc'] }).chat!.card!;
  assert.equal(card.targets[0].cover, undefined);
});

test('regiones con toLevel: escalera y teleport cambian de planta', () => {
  const { room, dm, mk, H } = setup([tk('hero', 100, 100)]);
  const p = mk('Ana'); room.scene.tokens[0].owners = [p.id];
  room.scene.levels = [{ id: 'base', name: 'B' }, { id: 'up', name: 'U' }];
  const sq = (x: number, y: number) => [{ x, y }, { x: x + 40, y }, { x: x + 40, y: y + 40 }, { x, y: y + 40 }];
  H(dm, { t: 'upsert', kind: 'region', item: { id: 'st', name: 'Escalera', kind: 'message', text: 'Subes', hidden: false, points: sq(300, 300), toLevel: 'up' } });
  H(dm, { t: 'upsert', kind: 'region', item: { id: 'tp', name: 'Portal', kind: 'teleport', hidden: false, points: sq(500, 100), to: { x: 800, y: 800 }, toLevel: 'up', level: 'up' } });
  H(dm, { t: 'upsert', kind: 'region', item: { id: 'tp2', name: 'Bajada', kind: 'teleport', hidden: false, points: sq(600, 600), toLevel: 'base', level: 'up' } });
  const t = room.scene.tokens[0];
  H(p, { t: 'moveToken', id: 'hero', x: 320, y: 320 });
  assert.deepEqual([t.level, t.x, t.y], ['up', 320, 320]);
  H(p, { t: 'moveToken', id: 'hero', x: 620, y: 620 });
  assert.equal(t.level, undefined);
  // una región de otra planta no se dispara (tp está en 'up', el token en la base)
  H(p, { t: 'moveToken', id: 'hero', x: 520, y: 120 });
  assert.deepEqual([t.level, t.x], [undefined, 520]);
  // teleport sin toLevel ni to no vale
  assert.ok(H(dm, { t: 'upsert', kind: 'region', item: { id: 'bad', name: 'x', kind: 'teleport', hidden: false, points: sq(1, 1) } }).error);
  // teleport con to + toLevel
  t.level = 'up'; t.x = 0; t.y = 0; H(p, { t: 'moveToken', id: 'hero', x: 520, y: 120 });
  assert.deepEqual([t.level, t.x, t.y], ['up', 800, 800]);
});

test('puntos de héroe: activación, fijar, gastar', () => {
  const { room, dm, mk, H } = setup([tk('a', 10, 10, { ddb: { id: 1, level: 5, classes: 'x', syncedAt: 0 } }), tk('b', 20, 10), tk('npc', 30, 30, { faction: 'enemy' })]);
  const p = mk('Ana'), q = mk('Bob');
  room.scene.tokens[0].owners = [p.id]; room.scene.tokens[1].owners = [q.id];
  assert.ok(H(p, { t: 'heroPoint', tokenId: 'a' }).error); // desactivada
  assert.ok(H(dm, { t: 'heroPoints', tokenId: 'a', value: 3 }).error);
  H(dm, { t: 'settings', patch: { optional: { heroPoints: true } } });
  assert.deepEqual(room.scene.tokens.map((t) => t.heroPoints), [7, 5, undefined]);
  assert.ok(H(p, { t: 'heroPoints', tokenId: 'a', value: 3 }).error);
  assert.ok(H(dm, { t: 'heroPoints', tokenId: 'a', value: 21 }).error && H(dm, { t: 'heroPoints', tokenId: 'a', value: 1.5 }).error && H(dm, { t: 'heroPoints', tokenId: 'a', value: -1 }).error);
  assert.equal(H(dm, { t: 'heroPoints', tokenId: 'a', value: 1 }).state, true);
  H(p, { t: 'roll', expr: '1d20+3' });
  assert.ok(H(q, { t: 'heroPoint', tokenId: 'a' }).error); // no es el dueño
  seq = [4];
  const r = H(p, { t: 'heroPoint', tokenId: 'a' }).chat!;
  assert.equal(r.roll!.expr, 'Punto de héroe +4'); assert.equal(r.roll!.total, 4);
  assert.match(r.roll!.detail, /1d20\+3/); assert.equal(room.scene.tokens[0].heroPoints, 0);
  assert.ok(H(p, { t: 'heroPoint', tokenId: 'a' }).error); // sin puntos
});

test('iniciativa por bandos', () => {
  const { room, dm, H } = setup([tk('a1', 1, 1, { initMod: 1 }), tk('a2', 2, 2, { initMod: 4 }), tk('e1', 3, 3, { faction: 'enemy', initMod: 10 }), tk('e2', 4, 4, { faction: 'neutral', initMod: 2 })]);
  H(dm, { t: 'settings', patch: { optional: { sideInit: true } } });
  seq = [5, 15]; // aliados 5, resto 15 → el resto va primero
  H(dm, { t: 'combat', op: 'start' });
  assert.deepEqual(room.combat!.order.map((o) => o.tokenId), ['e1', 'e2', 'a2', 'a1']);
  seq = [18, 3];
  H(dm, { t: 'combat', op: 'start' });
  assert.deepEqual(room.combat!.order.map((o) => o.tokenId), ['a2', 'a1', 'e1', 'e2']);
});

test('seguridad: tarjeta X anónima con límite, líneas y velos', () => {
  const { room, dm, mk, H } = setup();
  const p = mk('Ana');
  const spec = (joinRoom(room, 'Esp', undefined, 'spectator') as { member: MemberRec }).member;
  const x = H(spec, { t: 'safety', op: 'x' }, 5000);
  assert.deepEqual(x.all, { t: 'safety', op: 'x' }); assert.equal(JSON.stringify(x).includes(spec.id), false);
  assert.ok(H(p, { t: 'safety', op: 'x' }, 9000).error); // menos de 10 s
  assert.deepEqual(H(p, { t: 'safety', op: 'x' }, 15001).all, { t: 'safety', op: 'x' });
  assert.equal(H(p, { t: 'safety', op: 'resume' }).error, 'no permitido'); // levantar la pausa es del DM
  assert.deepEqual(H(dm, { t: 'safety', op: 'resume' }).all, { t: 'safety', op: 'resume' });
  assert.equal(H(spec, { t: 'safety', op: 'add', list: 'lines', text: ' Arañas ' }).state, true);
  assert.ok(H(p, { t: 'safety', op: 'add', list: 'lines', text: 'arañas' }).error); // duplicado
  assert.ok(H(p, { t: 'safety', op: 'add', list: 'veils', text: '' }).error && H(p, { t: 'safety', op: 'add', list: 'veils', text: 'x'.repeat(61) }).error && H(p, { t: 'safety', op: 'add', list: 'otra', text: 'a' }).error);
  H(p, { t: 'safety', op: 'add', list: 'veils', text: 'Violencia' });
  for (let i = 1; i < 30; i++) H(p, { t: 'safety', op: 'add', list: 'lines', text: 'l' + i });
  assert.ok(H(p, { t: 'safety', op: 'add', list: 'lines', text: 'una más' }).error);
  assert.deepEqual([filterFor(room, p).safety.veils, filterFor(room, dm).safety.lines.length, filterFor(room, spec).safety.lines[0]], [['Violencia'], 30, 'Arañas']);
  assert.equal(H(p, { t: 'safety', op: 'remove', list: 'lines', text: 'arañas' }).state, true);
  assert.ok(H(p, { t: 'safety', op: 'remove', list: 'lines', text: 'arañas' }).error);
});

test('requestCheck / answerCheck: peticiones, ciegas y resumen', () => {
  const { room, dm, mk, H } = setup([tk('a', 1, 1, { saves: { dex: 2 } }), tk('b', 2, 2, { skills: { perception: 4 } }), tk('npc', 3, 3, { faction: 'enemy' })]);
  const p = mk('Ana'), q = mk('Bob');
  room.scene.tokens[0].owners = [p.id]; room.scene.tokens[1].owners = [q.id];
  const bad = (o: object) => H(dm, { t: 'requestCheck', tokenIds: ['a'], kind: 'save', key: 'dex', ...o }).error;
  assert.ok(H(p, { t: 'requestCheck', tokenIds: ['a'], kind: 'save', key: 'dex' }).error);
  for (const o of [{ tokenIds: [] }, { tokenIds: ['zzz'] }, { tokenIds: Array.from({ length: 13 }, (_, i) => 'a' + i) }, { kind: 'x' }, { key: 'nope' }, { dc: 0 }, { dc: 41 }, { dc: 1.5 }, { blind: 'si' }, { kind: 'skill', key: 'dex' }]) assert.ok(bad(o), JSON.stringify(o));
  const fx = H(dm, { t: 'requestCheck', tokenIds: ['a', 'b', 'npc'], kind: 'save', key: 'dex', dc: 15 });
  assert.equal(fx.sends!.length, 2);
  const msgs = fx.sends!.map((s) => ({ to: [p, q].find((m) => s.who(m))!, msg: s.msg as any }));
  assert.equal(fx.sends!.some((s) => s.who(dm)), false);
  assert.deepEqual(msgs.map((m) => [m.msg.label, m.msg.dc, m.msg.tokenIds]), [['Salvación de DES CD 15', 15, ['a']], ['Salvación de DES CD 15', 15, ['b']]]);
  const id = msgs[0].msg.id;
  assert.ok(H(p, { t: 'answerCheck', requestId: id, tokenId: 'b' }).error); // no es suyo
  assert.ok(H(p, { t: 'answerCheck', requestId: id, tokenId: 'npc' }).error); // DM-only
  seq = [12]; // 12+2 = 14 < 15
  const a = H(p, { t: 'answerCheck', requestId: id, tokenId: 'a' });
  assert.equal(a.chat!.roll!.total, 14); assert.equal(a.chats!.length, 0);
  assert.ok(H(p, { t: 'answerCheck', requestId: id, tokenId: 'a' }).error); // una sola vez
  seq = [18];
  const b = H(dm, { t: 'answerCheck', requestId: id, tokenId: 'npc' }); // el DM por el PNJ (sin bono → 18)
  assert.equal(b.chats!.length, 0);
  const done = H(dm, { t: 'answerCheck', requestId: id, tokenId: '*' }); // cierra con las que hay
  const card = done.chats![0].card!;
  assert.equal(card.kind, 'save'); assert.match(card.detail!, /Éxitos: 1, fallos: 1/);
  assert.ok(H(dm, { t: 'answerCheck', requestId: id, tokenId: '*' }).error);
  // cuando responden todos, se cierra sola; etiqueta de habilidad
  const f2 = H(dm, { t: 'requestCheck', tokenIds: ['b'], kind: 'skill', key: 'perception' });
  const m2 = f2.sends![0].msg as any; assert.equal(m2.label, 'Percepción (SAB)');
  seq = [10];
  const end = H(q, { t: 'answerCheck', requestId: m2.id, tokenId: 'b' });
  assert.equal(end.chats![0].card!.kind, 'save'); assert.doesNotMatch(end.chats![0].card!.detail!, /Éxitos/);
});

test('prueba a ciegas: el jugador no recibe su resultado', () => {
  const { room, dm, mk, H } = setup([tk('a', 1, 1)]);
  const p = mk('Ana'), q = mk('Bob'); room.scene.tokens[0].owners = [p.id];
  const fx = H(dm, { t: 'requestCheck', tokenIds: ['a'], kind: 'skill', key: 'stealth', dc: 12, blind: true });
  const req = fx.sends![0].msg as any;
  assert.equal(req.dc, undefined); assert.equal(req.label, 'Sigilo (DES)');
  seq = [17];
  const r = H(p, { t: 'answerCheck', requestId: req.id, tokenId: 'a' });
  assert.equal(r.chat!.roll!.blind, true);
  assert.deepEqual(r.to, { id: p.id, msg: { t: 'chat', msg: { ...(r.to!.msg as any).msg } } });
  assert.equal((r.to!.msg as any).msg.text, 'Has tirado: el DM verá el resultado');
  const summary = r.chats![0];
  for (const c of [r.chat!, summary]) { assert.equal(canSee(c, p), false); assert.equal(canSee(c, q), false); assert.equal(canSee(c, dm), true); }
  assert.equal(texts(room, p).length, 0); assert.equal(texts(room, q).length, 0); assert.equal(texts(room, dm).length, 2);
  assert.equal(summary.card!.kind, 'save');
});

test('sessionEnd: resumen, diario y reinicio', () => {
  const { room, dm, mk, H } = setup([tk('hero', 10, 10, { hp: { cur: 10, max: 10, temp: 0 }, actions: [{ id: 'a', name: 'Espada', cost: 'action', kind: 'attack', range: 5, toHit: 20, damage: '1d8' }] }),
    tk('gob', 40, 10, { faction: 'enemy', srd: 'goblin', hp: { cur: 3, max: 3, temp: 0 }, ac: 5 })]);
  const p = mk('Ana'); room.scene.tokens[0].owners = [p.id];
  if (!Object.hasOwn(room.scene, 'x')) assert.ok(room.sessionStart > 0);
  room.sessionStart = 0;
  H(dm, { t: 'automation', value: 'auto' });
  H(dm, { t: 'combat', op: 'start' }); H(dm, { t: 'combat', op: 'next' }); H(dm, { t: 'combat', op: 'next' }); H(dm, { t: 'combat', op: 'next' });
  // resolveAction usa su propio rng: se inyecta una tarjeta ya resuelta (crítico con 20 natural)
  room.chat.push({ id: 'c1', from: dm.id, at: 2000, card: { actorId: 'hero', actorName: 'hero', actionName: 'Espada', kind: 'attack', applied: true, dice: [{ sides: 20, value: 20, kept: true }],
    targets: [{ id: 'gob', name: 'gob', attack: { d20: 20, total: 25, mode: 'normal', hit: true, crit: true }, amount: 6 }] } });
  H(dm, { t: 'hp', tokenId: 'gob', delta: 6, kind: 'damage' }); // muere
  H(dm, { t: 'hp', tokenId: 'hero', delta: 10, kind: 'damage' }); // cae inconsciente
  assert.ok(H(p, { t: 'sessionEnd' }).error);
  const fx = H(dm, { t: 'sessionEnd' }, 9999);
  const s = (fx.all as any).summary;
  assert.equal(s.rounds >= 2, true); assert.equal(s.xp, 50); // goblin VD 1/4
  const kinds = s.highlights.map((h: any) => h.kind);
  for (const k of ['crit', 'kill', 'down', 'highest']) assert.ok(kinds.includes(k), k);
  assert.match(s.highlights.find((h: any) => h.kind === 'highest').text, /20/);
  const hero = s.perToken.find((t: any) => t.tokenId === 'hero'), gob = s.perToken.find((t: any) => t.tokenId === 'gob');
  assert.equal(hero.crits, 1); assert.equal(hero.damageDealt > 0, true); assert.equal(gob.damageTaken, hero.damageDealt);
  const j = room.journal.at(-1)!;
  assert.match(j.title, /^Sesión del /); assert.equal(j.visibleTo, 'all'); assert.match(j.body, /PX ganados: 50/);
  assert.deepEqual([room.sessionStart, room.maxRound], [9999, 0]);
  assert.equal(filterFor(room, p).sessionStart, 9999);
  // una segunda sesión vacía no hereda nada
  assert.equal((H(dm, { t: 'sessionEnd' }, 10000).all as any).summary.perToken.length, 0);
});

test('externalRoll: validación, coherencia y límite', () => {
  const { room, dm, mk, H } = setup();
  const p = mk('Ana');
  const spec = (joinRoom(room, 'Esp', undefined, 'spectator') as { member: MemberRec }).member;
  const d = (sides: number, value: number, kept = true) => ({ sides, value, kept });
  const ok = { t: 'externalRoll', source: 'beyond20', name: 'Espada larga', expr: '1d20+5', total: 17, dice: [d(20, 12)] };
  const r = H(p, ok).chat!;
  assert.deepEqual([r.roll!.external, r.roll!.total, r.roll!.secret, r.roll!.expr], ['beyond20', 17, false, 'Espada larga']);
  assert.ok(H(spec, ok).error);
  for (const o of [{ total: 18 }, { total: 17.5 }, { total: '17' }, { name: '' }, { name: 'x'.repeat(61) }, { source: 'otro' }, { expr: 'bola' }, { dice: [d(20, 21)] }, { dice: [d(20, 0)] }, { dice: [d(8, 12)] }, { dice: [] },
    { dice: Array.from({ length: 31 }, () => d(6, 1)), expr: '31d6', total: 31 }, { dice: [d(20, 12), d(20, 3)] }]) assert.ok(H(p, { ...ok, ...o }).error, JSON.stringify(o));
  // ventaja: 2d20kh1 con un dado descartado; y resta
  assert.ok(H(p, { ...ok, expr: '2d20kh1+5', dice: [d(20, 12), d(20, 3, false)] }).chat);
  assert.ok(H(p, { ...ok, expr: '2d20kh1+5', dice: [d(20, 12), d(20, 3)] }).error);
  assert.ok(H(p, { ...ok, expr: '1d8-2', total: 4, dice: [d(8, 6)] }).chat);
  // límite: 20 por minuto por miembro
  const q = mk('Bob'); let n = 0;
  for (; n < 25; n++) if (H(q, ok, 50_000 + n).error) break;
  assert.equal(n, 20);
  assert.ok(H(q, ok, 50_000 + 61_000).chat); // pasado un minuto
  assert.equal(H(dm, ok).chat !== undefined, true);
});
