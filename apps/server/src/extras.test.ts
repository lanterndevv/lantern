import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Die, Region, Token } from '@lantern/protocol';
import { PREGENS, pregenToImported, tokenToExport } from '@lantern/srd';
import { parseCharacter } from './import.ts';
import { createRoom, filterFor, handle, joinRoom, type Room } from './room.ts';
import { asPlayer, finishState } from './extras.ts';
import { createBackups, mergeInto, restoreInto } from './backup.ts';
import { exportCampaign, importCampaign } from './campaign.ts';

const fixed = (n: number, log: string[] = []) => (e: string) => { log.push(e); return { total: n, detail: e, dice: [{ sides: 20, value: n, kept: true }] as Die[] }; };
function setup() {
  const c = createRoom('Master', 'ABC234');
  if ('error' in c) throw new Error(c.error);
  const p = joinRoom(c.room, 'Ana', undefined);
  if ('error' in p) throw new Error(p.error);
  return { room: c.room, dm: c.member, player: p.member };
}
const tok = (room: Room, id: string) => room.scene.tokens.find((t) => t.id === id)!;
const reg = (o: Partial<Region>): Region => ({ id: 'r1', name: 'R', kind: 'message', hidden: true, points: [{ x: 450, y: 520 }, { x: 550, y: 520 }, { x: 550, y: 620 }, { x: 450, y: 620 }], ...o });

test('las @variables salen del personaje', () => {
  const { room, player } = setup(), log: string[] = [];
  handle(room, player, { t: 'roll', expr: '1d20+@dex+@prof' }, fixed(10, log));
  assert.equal(log[0], '1d20+2+3'); // Kael: DES 14, competencia 3
  assert.equal(room.chat.at(-1)!.roll!.expr, '1d20+@dex+@prof');
});

test('inspiración heroica y suerte repiten el d20 una vez', () => {
  const { room, player } = setup();
  const k = tok(room, 'kael');
  handle(room, player, { t: 'check', tokenId: 'kael', kind: 'ability', key: 'dex' }, fixed(1));
  const id = room.chat.at(-1)!.id;
  assert.ok(handle(room, player, { t: 'reroll', msgId: id, kind: 'inspiration', tokenId: 'kael' }, fixed(20)).error); // sin inspiración
  assert.ok(handle(room, player, { t: 'reroll', msgId: id, kind: 'lucky', tokenId: 'kael' }, fixed(20)).error);       // sin rasgo
  k.lucky = true;
  const fx = handle(room, player, { t: 'reroll', msgId: id, kind: 'lucky', tokenId: 'kael' }, fixed(17));
  assert.equal(fx.error, undefined);
  assert.equal(fx.chat!.roll!.total, 17 + 2); // 1 → 17, +2 de DES
  assert.ok(handle(room, player, { t: 'reroll', msgId: id, kind: 'lucky', tokenId: 'kael' }, fixed(17)).error); // solo una vez
  handle(room, player, { t: 'check', tokenId: 'kael', kind: 'ability', key: 'dex' }, fixed(12));
  k.inspiration = true;
  const id2 = room.chat.at(-1)!.id;
  assert.equal(handle(room, player, { t: 'reroll', msgId: id2, kind: 'inspiration', tokenId: 'kael' }, fixed(5)).error, undefined);
  assert.equal(k.inspiration, undefined);
});

test('descansos corto y largo', () => {
  const { room, player, dm } = setup();
  const k = tok(room, 'kael');
  k.hitDice = { die: 8, max: 3, used: 0 }; k.hp!.cur = 5;
  const hp0 = k.hp!.cur;
  const fx = handle(room, player, { t: 'rest', tokenId: 'kael', kind: 'short', spend: 2 }, (e) => ({ total: 4, detail: e }));
  assert.equal(fx.error, undefined);
  assert.equal(k.hitDice.used, 2);
  assert.equal(k.hp!.cur, hp0 + 2 * (4 + 2)); // 1d8=4 + CON 14 (+2) por dado
  assert.equal(handle(room, player, { t: 'rest', tokenId: 'kael', kind: 'short', spend: 5 }, fixed(4)).error, undefined); // se limita a los que quedan
  assert.equal(k.hitDice!.used, 3);
  assert.ok(handle(room, player, { t: 'rest', tokenId: 'kael', kind: 'short', spend: 1 }, fixed(4)).error); // sin dados
  handle(room, player, { t: 'rest', tokenId: 'kael', kind: 'long' }, fixed(1));
  assert.equal(k.hp!.cur, k.hp!.max);
  assert.equal(k.slots![3].used, 0);
  assert.equal(k.hitDice.used, 2); // recupera la mitad (mín. 1)
  assert.ok(handle(room, player, { t: 'rest', tokenId: 'ysolde', kind: 'long' }, fixed(1)).error); // no es suyo
  const rq = handle(room, dm, { t: 'requestRest', kind: 'long' }, fixed(1));
  assert.equal(rq.sends!.filter((s) => s.who(player)).length, 1);
  assert.ok(handle(room, player, { t: 'requestRest', kind: 'long' }, fixed(1)).error);
});

test('subida de nivel asistida y mejora de característica', () => {
  const { room, player } = setup();
  const k = tok(room, 'kael');
  k.hitDice = { die: 6, max: 3, used: 0 }; k.prof = 2;
  const cur = k.hp!.max;
  let fx = handle(room, player, { t: 'levelUp', tokenId: 'kael', cls: 'wizard', hp: 'average' }, fixed(1));
  assert.equal(fx.error, undefined);
  assert.equal(k.hitDice!.max, 4);
  assert.equal(k.hp!.max, cur + 4 + 2); // media d6 = 4, +2 CON
  assert.equal(k.asi, 1); // nivel 4
  assert.ok(handle(room, player, { t: 'abilityUp', tokenId: 'kael', a: 'int', b: 'int' }, fixed(1)).error);
  fx = handle(room, player, { t: 'abilityUp', tokenId: 'kael', a: 'int' }, fixed(1));
  assert.equal(fx.error, undefined);
  assert.equal(k.abilities!.int, 20); assert.equal(k.asi, undefined);
  assert.ok(handle(room, player, { t: 'abilityUp', tokenId: 'kael', a: 'int' }, fixed(1)).error);
  assert.ok(handle(room, player, { t: 'levelUp', tokenId: 'kael', cls: 'nope', hp: 'average' }, fixed(1)).error);
  k.ddb = { id: 5, level: 4, classes: 'x', syncedAt: 0 };
  assert.match(handle(room, player, { t: 'levelUp', tokenId: 'kael', cls: 'wizard', hp: 'average' }, fixed(1)).error!, /Beyond/);
});

test('pregenerado: toma el token propio o crea uno nuevo', () => {
  const { room, player, dm } = setup();
  const data = { name: 'Bruna', ddbId: 0, level: 1, classes: 'Guerrero 1', darkvision: 0, hp: { cur: 12, max: 12, temp: 0 }, hitDice: { die: 10, max: 1, used: 0 }, lucky: true };
  assert.equal(handle(room, player, { t: 'myChar', data }, fixed(1)).error, undefined);
  assert.equal(tok(room, 'kael').name, 'Bruna');
  assert.equal(tok(room, 'kael').lucky, true);
  const p2 = joinRoom(room, 'Bea', undefined);
  if ('error' in p2) throw new Error(p2.error);
  for (const t of room.scene.tokens) if (t.faction === 'ally' && !t.owners.length) t.owners.push('otro');
  handle(room, p2.member, { t: 'myChar', data: { ...data, name: 'Nueva' } }, fixed(1));
  const n = room.scene.tokens.find((t) => t.name === 'Nueva')!;
  assert.deepEqual(n.owners, [p2.member.id]);
  assert.ok(handle(room, dm, { t: 'myChar', data }, fixed(1)).error);
  assert.ok(handle(room, player, { t: 'myChar', data: { name: 'x' } }, fixed(1)).error);
});

test('cerradura con prueba', () => {
  const { room, player, dm } = setup();
  const d = room.scene.walls.find((w) => w.id === 'd1')!;
  d.locked = true; d.lock = { dc: 12 };
  const k = tok(room, 'kael');
  assert.equal(handle(room, player, { t: 'unlock', wallId: 'd1', tokenId: 'kael', tool: 'thieves' }, fixed(20)).error, 'demasiado lejos');
  k.x = 330; k.y = 280;
  handle(room, player, { t: 'unlock', wallId: 'd1', tokenId: 'kael', tool: 'athletics' }, fixed(10)); // 10 − 1 < 12
  assert.equal(d.locked, true);
  const fx = handle(room, player, { t: 'unlock', wallId: 'd1', tokenId: 'kael', tool: 'thieves' }, fixed(11)); // 11 + 2 ≥ 12
  assert.equal(d.locked, false);
  assert.ok(!/CD|dc/i.test(fx.chat!.roll!.detail));
  assert.ok(handle(room, player, { t: 'unlock', wallId: 'd1', tokenId: 'kael', tool: 'thieves' }, fixed(11)).error);
  assert.equal(handle(room, dm, { t: 'upsert', kind: 'wall', item: { ...d, locked: true, lock: { dc: 99 } } }, fixed(1)).error, 'mensaje inválido');
});

test('regiones: salir, interactuar, documento, encuentro, escena y silencio', () => {
  const { room, player, dm } = setup();
  const k = tok(room, 'kael');
  k.x = 510; k.y = 570;
  room.journal.push({ id: 'j1', title: 'Carta', body: 'hola', visibleTo: 'dm' });
  room.scene.regions = [
    reg({ id: 'ex', trigger: 'exit', action: 'doc', docId: 'j1' }),
    reg({ id: 'in', trigger: 'interact', action: 'encounter', encounter: 'emb' }),
  ];
  tok(room, 'trasgo-c').encounter = 'emb'; // oculto
  const fx = handle(room, player, { t: 'interact', tokenId: 'kael' }, fixed(1));
  assert.equal(tok(room, 'trasgo-c').hidden, false);
  assert.ok(fx.sends!.some((s) => s.msg.t === 'sfx'));
  assert.ok(handle(room, player, { t: 'interact', tokenId: 'kael' }, fixed(1)).error === undefined); // sin once, se puede repetir
  const out = handle(room, player, { t: 'moveToken', id: 'kael', x: 400, y: 600 }, fixed(1));
  assert.equal(out.error, undefined);
  assert.ok(out.sends!.some((s) => s.msg.t === 'handout' && s.who(player)));
  assert.deepEqual(room.journal[0].visibleTo, [player.id]);
  // escena
  room.scenes.b = { ...structuredClone(room.scene), id: 'b', name: 'Sótano' };
  room.scene.regions = [reg({ id: 'sc', trigger: 'enter', action: 'scene', sceneId: 'b', once: true })];
  handle(room, player, { t: 'moveToken', id: 'kael', x: 500, y: 570 }, fixed(1));
  assert.equal(room.activeId, 'b');
  // silencio
  room.activeId = 'cueva-osgo';
  room.scene.regions = [reg({ id: 'si', action: 'silence', trigger: 'interact' })];
  k.x = 500; k.y = 570;
  const sp = handle(room, player, { t: 'act', tokenId: 'kael', actionId: 'bola-fuego', targets: ['trasgo-a'] }, fixed(10));
  assert.match(sp.chat!.text!, /silencio/);
  assert.equal(k.slots![3].used, 1);
  void dm;
});

test('el jugador no recibe CD de cerraduras, etiquetas de encuentro ni pins de entradas ocultas', () => {
  const { room, player, dm } = setup();
  room.scene.walls.find((w) => w.id === 'd1')!.lock = { dc: 17 };
  tok(room, 'ysolde').encounter = 'secreto';
  room.journal.push({ id: 'a', title: 'A', body: '', visibleTo: 'all' }, { id: 'b', title: 'B secreta', body: '', visibleTo: 'dm' });
  handle(room, dm, { t: 'pin', op: 'add', x: 100, y: 100, entryId: 'a' }, fixed(1));
  handle(room, dm, { t: 'pin', op: 'add', x: 200, y: 200, entryId: 'b' }, fixed(1));
  assert.equal(room.scene.pins!.length, 2);
  const st = finishState(room, player, filterFor(room, player)), j = JSON.stringify(st);
  assert.ok(!j.includes('"dc":17') && !j.includes('secreto') && !j.includes('B secreta'));
  assert.deepEqual(st.scene.pins!.map((p) => p.entryId), ['a']);
  assert.equal(finishState(room, dm, filterFor(room, dm)).scene.pins!.length, 2);
  assert.ok(handle(room, player, { t: 'pin', op: 'add', x: 1, y: 1, entryId: 'a' }, fixed(1)).error);
});

test('vista «como jugador»: solo DM y sin fugas', () => {
  const { room, player, dm } = setup();
  const r = asPlayer(room, dm, { t: 'asPlayer', memberId: player.id }, new Set());
  assert.ok('state' in r);
  if ('state' in r) {
    const j = JSON.stringify(r.state);
    assert.ok(!j.includes('Hobgoblin 2') && !j.includes('Trasgo C') && r.state.visible!.length > 0);
  }
  assert.ok('error' in asPlayer(room, player, { t: 'asPlayer', memberId: dm.id }, new Set()));
  assert.ok('error' in asPlayer(room, dm, { t: 'asPlayer', memberId: 'nadie' }, new Set()));
});

test('botín y zoom de documento', () => {
  const { room, player, dm } = setup();
  const fx = handle(room, dm, { t: 'loot', title: 'Cofre', lines: [{ item: '50 po', to: 'Kael' }, { item: 'Poción' }] }, fixed(1));
  assert.equal(fx.chat!.loot!.lines.length, 2);
  assert.ok(handle(room, player, { t: 'loot', title: 'x', lines: [{ item: 'y' }] }, fixed(1)).error);
  assert.ok(handle(room, dm, { t: 'loot', title: 'x', lines: [] }, fixed(1)).error);
  room.journal.push({ id: 'pdf', title: 'Manual', body: '', visibleTo: 'all', pdf: '/assets/' + 'a'.repeat(64) + '.pdf' });
  const z = handle(room, dm, { t: 'docView', entryId: 'pdf', zoom: 150, page: 3 }, fixed(1));
  assert.equal(z.sends!.filter((s) => s.who(player)).length, 1);
  assert.ok(handle(room, dm, { t: 'docView', entryId: 'pdf', zoom: 5 }, fixed(1)).error);
});

test('copias: rotan a 10, no repiten sin cambios y se restauran; fusión selectiva', async () => {
  const { room, player } = setup();
  const dir = mkdtempSync(join(tmpdir(), 'lantern-bk-')), bk = createBackups(dir);
  room.journal.push({ id: 'n1', title: 'Nota', body: '1', visibleTo: [player.id] });
  const first = await bk.save(room, 1_000_000);
  assert.ok(first);
  assert.equal(await bk.save(room, 1_000_001), null); // sin cambios
  for (let i = 0; i < 12; i++) { room.journal[0].body = String(i + 2); await bk.save(room, 2_000_000 + i); }
  assert.equal(bk.list(room.code).length, 10);
  assert.equal(readdirSync(join(dir, room.code)).length, 10);
  assert.equal(bk.read(room.code, '../x'), undefined);
  const newest = bk.list(room.code)[0].name;
  tok(room, 'kael').hp!.cur = 1; room.journal[0].body = 'roto';
  assert.equal(restoreInto(room, bk.read(room.code, newest)), null);
  assert.equal(room.journal[0].body, '13');
  assert.deepEqual(room.journal[0].visibleTo, [player.id]); // conserva la visibilidad
  assert.deepEqual(tok(room, 'kael').owners, [player.id]);
  assert.equal(tok(room, 'kael').hp!.cur, 19);
  // fusión: solo lo elegido
  const camp = await exportCampaign(room, async () => null) as object;
  const imp = importCampaign(camp);
  if ('error' in imp) throw new Error(imp.error);
  const other = createRoom('X', 'ZZZ234');
  if ('error' in other) throw new Error(other.error);
  const before = other.room.journal.length, tokens0 = other.room.scene.tokens.length;
  const n = mergeInto(other.room, imp, { scenes: [], journal: ['n1'], characters: ['nix', 'osgo'] });
  assert.deepEqual(n, { scenes: 0, journal: 1, characters: 1 }); // el osgo es enemigo: no entra como personaje
  assert.equal(other.room.journal.length, before + 1);
  assert.equal(other.room.scene.tokens.length, tokens0 + 1);
  assert.equal(other.room.scene.tokens.at(-1)!.id !== 'nix', true); // id nuevo por choque
  assert.deepEqual(other.room.scene.tokens.at(-1)!.owners, []);
});

test('pregenerados y hoja exportada pasan la validación del servidor', () => {
  for (const [id, p] of Object.entries(PREGENS)) assert.ok(parseCharacter(pregenToImported(p)), id);
  assert.equal(pregenToImported(PREGENS.rogue).lucky, true); // mediano
  const { room } = setup();
  const k = structuredClone(tok(room, 'kael'));
  for (const a of k.actions!) if (a.toHit! > 30) a.toHit = 9; // el 99 de la demo (impacto automático) no es válido en una hoja de fuera
  const ex = tokenToExport(k);
  assert.equal(ex.format, 'lantern-character');
  assert.ok(parseCharacter(JSON.parse(JSON.stringify(ex)).data));
});
