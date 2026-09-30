// Fixtures reales de la API character-service v5 (personajes públicos, recortados de textos), obtenidos de:
//  - srsutherland/5ejson  test_json/dndb/  (rikka, kaitvian, cleo, hesdera, qivira, sharver)
//  - MaximeBonnin/dnd-characters-dataset-24  sample_reponse.json  (vladimir)
//  - TeaWithLucas/DNDBeyond-DM-Screen  sample-character.json  (willie);  hero-slate  fixtures/sunny.json  (sunny)
// Valores esperados: calculados a mano con las reglas 5e y contrastados con la lógica de MrPrimate/ddb-importer (no con la hoja web, que es JS y no se puede leer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mapCharacter } from './index.ts';

// Fixtures de repos sin licencia: solo en local (.gitignore); sin ellos, su test se salta.
const has = (n: string) => existsSync(new URL(`./fixtures/${n}.json`, import.meta.url));
const load = (n: string) => mapCharacter(JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8')));
const act = (c: ReturnType<typeof load>, id: string) => c.actions!.find(a => a.id === id)!;

test('brujo 7 (Rikka): magia de pacto, capa de protección, velocidad racial 35', { skip: !has('warlock7-rikka') && 'fixture local ausente' }, () => {
  const c = load('warlock7-rikka');
  assert.equal(c.classes, 'Brujo 7');
  assert.deepEqual(c.hp, { max: 45, cur: 45, temp: 0 });           // 38 base + 1 CON × 7
  assert.equal(c.ac, 15);                                           // cuero 11 + DES 3 + capa +1
  assert.equal(c.speed, 35); assert.equal(c.darkvision, 720);      // set innate-speed-walking, no weightSpeeds (30)
  assert.equal(c.abilities!.cha, 20);
  assert.deepEqual(c.saves, { str: 0, dex: 4, con: 2, int: 3, wis: 5, cha: 9 });   // +1 de la capa a todas; SAB y CAR competentes
  assert.deepEqual(c.slots, { 4: { max: 2, used: 0 } });           // pacto: 2 espacios de nivel 4 (spellSlots.available viene a 0)
  assert.equal(act(c, 'ddb-dagger').toHit, 6);                     // 3 prof + 3 DES (sutil)
});

test('mago 7 (Kaitvian): espacios calculados, usados y heridas', { skip: !has('wizard7-kaitvian') && 'fixture local ausente' }, () => {
  const c = load('wizard7-kaitvian');
  assert.deepEqual(c.hp, { max: 58, cur: 48, temp: 0 });           // 30 + 4 × 7, 10 de daño
  assert.equal(c.ac, 12);
  assert.deepEqual(c.slots, { 1: { max: 4, used: 4 }, 2: { max: 3, used: 1 }, 3: { max: 3, used: 0 }, 4: { max: 1, used: 0 } });
  assert.equal(act(c, 'fire-bolt').toHit, 8); assert.equal(act(c, 'fire-bolt').damage, '2d10');   // 3 + INT 5; truco a nivel 7
  assert.deepEqual(c.saves!.int, 8);
});

test('monje 10 (Cleo): defensa sin armadura, movimiento, inmunidad a veneno (no a enfermedad)', { skip: !has('monk10-cleo') && 'fixture local ausente' }, () => {
  const c = load('monk10-cleo');
  assert.equal(c.ac, 20);                                           // 10 + DES 5 + SAB 5
  assert.equal(c.speed, 50);                                        // 30 + 10 + 5 + 5
  assert.deepEqual(c.defenses, { immune: ['poison'] });
  assert.deepEqual(c.hp, { max: 83, cur: 83, temp: 0 });
  assert.deepEqual([c.saves!.str, c.saves!.dex, c.saves!.con], [6, 9, 3]);
  assert.equal(act(c, 'ddb-dart').toHit, 9);
  assert.equal(act(c, 'ddb-musket').toHit, 5);                      // arma de fuego: sin competencia
});

test('bárbaro 6 (Hesdera): defensa sin armadura con CON, movimiento rápido', { skip: !has('barbarian6-hesdera') && 'fixture local ausente' }, () => {
  const c = load('barbarian6-hesdera');
  assert.equal(c.ac, 15);                                           // 10 + DES 2 + CON 3
  assert.equal(c.speed, 40);
  assert.deepEqual(c.hp, { max: 55, cur: 55, temp: 0 });
  assert.equal(c.abilities!.str, 20);
  assert.equal(c.darkvision, 0);
  assert.deepEqual(act(c, 'ddb-greataxe').damage, '1d12+5');
});

test('paladín 10 (Qivira): aura de protección, armadura mágica, escudo, Duelo', { skip: !has('paladin10-qivira') && 'fixture local ausente' }, () => {
  const c = load('paladin10-qivira');
  assert.equal(c.ac, 18);                                           // cuero tachonado 12 + DES 3 + 1 mágico + escudo 2
  assert.deepEqual(c.saves, { str: 3, dex: 7, con: 6, int: 5, wis: 9, cha: 12 });   // aura: + CAR (4) a todas
  assert.deepEqual([act(c, 'ddb-rapier').toHit, act(c, 'ddb-rapier').damage], [7, '1d8+5']);   // Duelo +2 al daño
  assert.deepEqual(c.slots, { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } });
  assert.equal(act(c, 'fire-bolt').toHit, 8);                       // truco racial con CAR
});

test('guerrero 8 / explorador 3 (Vladimir): PG fijos, arco mágico, multiclase', { skip: !has('fighter8-ranger3-vladimir') && 'fixture local ausente' }, () => {
  const c = load('fighter8-ranger3-vladimir');
  assert.deepEqual(c.hp, { max: 73, cur: 73, temp: 0 });           // overrideHitPoints
  assert.equal(c.ac, 18);
  assert.equal(c.speed, 40);                                        // Móvil
  assert.deepEqual([c.saves!.str, c.saves!.dex, c.saves!.con], [4, 5, 5]);   // solo las salvaciones de la clase inicial (Guerrero)
  assert.deepEqual([act(c, 'ddb-longbow-1').toHit, act(c, 'ddb-longbow-1').damage], [12, '1d8+6']);   // 4 + 5 + 1 mágico + 2 Tiro con arco
  assert.deepEqual([act(c, 'ddb-longbow').toHit, act(c, 'ddb-longbow').damage], [11, '1d8+5']);
  assert.deepEqual(c.slots, { 1: { max: 2, used: 1 } });           // nivel de lanzador 1 (explorador 3 / 2)
});

test('brujo 5 / guerrero 2 / hechicero 3 (Sharver): pacto + espacios normales en el mismo nivel', { skip: !has('warlock5-fighter2-sorcerer3-sharver') && 'fixture local ausente' }, () => {
  const c = load('warlock5-fighter2-sorcerer3-sharver');
  assert.deepEqual(c.slots, { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 }, 3: { max: 2, used: 0 } });   // 4/2 de hechicero 3 + 2 de pacto (nivel 3)
  assert.deepEqual([c.saves!.wis, c.saves!.cha, c.saves!.str, c.saves!.con], [7, 8, 1, 3]);   // solo Brujo (inicial)
  assert.equal(c.ac, 16);                                           // cuero 11 + DES 4 + Defensa 1
  assert.equal(c.speed, 25);
  assert.deepEqual(c.hp, { max: 82, cur: 82, temp: 0 });
});

test('druida 6 (Sunny): elfo de los bosques, escudo, curación con SAB', { skip: !has('druid6-sunny') && 'fixture local ausente' }, () => {
  const c = load('druid6-sunny');
  assert.equal(c.ac, 15); assert.equal(c.speed, 35);
  assert.deepEqual(c.defenses, {});                                 // «inmune a sueño mágico» no es un tipo de daño
  assert.equal(act(c, 'cure-wounds').damage, '2d8+4');
  assert.deepEqual(c.slots, { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 } });
});

test('pícaro 1 (Willie): caso mínimo', { skip: !has('rogue1-willie') && 'fixture local ausente' }, () => {
  const c = load('rogue1-willie');
  assert.deepEqual(c.hp, { max: 9, cur: 9, temp: 0 });
  assert.equal(c.ac, 14); assert.equal(c.slots, undefined); assert.equal(c.prof, 2);
  assert.equal(act(c, 'ddb-shortsword').toHit, 5);
});

test('acepta la respuesta envuelta {success, data}', () => {
  const j = JSON.parse(readFileSync(new URL('./fixtures/rogue1-willie.json', import.meta.url), 'utf8'));
  assert.equal(mapCharacter(j).name, mapCharacter(j.data).name);
});

test('Defensa y movimiento sin armadura: el monje los pierde con escudo, el bárbaro no', () => {
  const shield = { equipped: true, definition: { id: 9, filterType: 'Armor', armorTypeId: 4, armorClass: 2 } };
  const pj = (statId: number, inventory: object[]) => mapCharacter({ name: 'x', classes: [{ level: 5, isStartingClass: true }], inventory,
    stats: [1, 2, 3, 4, 5, 6].map((id) => ({ id, value: 14 })), // +2 en todo
    modifiers: { class: [{ type: 'set', subType: 'unarmored-armor-class', statId }, { type: 'bonus', subType: 'unarmored-movement', value: 10 }] } });
  assert.deepEqual([pj(5, []).ac, pj(5, []).speed], [14, 40]);
  assert.deepEqual([pj(5, [shield]).ac, pj(5, [shield]).speed], [14, 30]); // 10 + DES + escudo
  assert.equal(pj(3, [shield]).ac, 16); // bárbaro: 10 + DES + CON + escudo
});

test('robustez', () => {
  for (const j of [undefined, null, {}, 'x', { classes: [], stats: [], name: 'a' }, { name: 'a', classes: [{}], stats: 5 }])
    assert.throws(() => mapCharacter(j), /no válido/);
});

// Fixture mínimo construido a mano con la estructura de monster-service (no hay JSON real con licencia que lo permita; AboveVTT es AGPL).
import { mapMonster } from './index.ts';
test('monstruo: estadísticas, defensas, cr, tamaño y ataques del HTML', () => {
  const m = mapMonster({ data: [{
    id: 17010, name: 'Goblin Boss', armorClass: 17, averageHitPoints: 21, hitPointDice: { diceString: '6d6' }, challengeRatingId: 3, sizeId: 5,
    stats: [{ statId: 1, value: 10 }, { statId: 2, value: 14 }, { statId: 3, value: 10 }, { statId: 4, value: 10 }, { statId: 5, value: 8 }, { statId: 6, value: 10 }],
    savingThrows: [{ statId: 2, bonusModifier: 1 }], movements: [{ movementId: 1, speed: 30 }, { movementId: 4, speed: 60 }],
    senses: [{ senseId: 2, notes: '60 ft.' }, { senseId: 1, notes: '10 ft.' }], damageAdjustments: [9, 28, 33, 47, 13, 57], conditionImmunities: [],
    actionsDescription: '<p><em><strong>Multiattack.</strong></em> Two attacks.</p>'
      + '<p><em><strong>Scimitar.</strong></em> <em>Melee Weapon Attack:</em> +4 to hit, reach 5 ft., one target. <em>Hit:</em> 5 (1d6 + 2) slashing damage.</p>'
      + '<p><strong>Javelin.</strong> <em>Melee or Ranged Weapon Attack:</em> +2 to hit, reach 5 ft. or range 30/120 ft., one target. Hit: 3 (1d6) piercing damage.</p>'
      + '<p><strong>Claw.</strong> Melee Weapon Attack: +1 to hit, reach 5 ft. Hit: 1 slashing damage.</p>',
  }] });
  assert.deepEqual([m.name, m.ac, m.hp!.max, m.speed, m.initMod, m.darkvision, m.cr, m.size], ['Goblin Boss', 17, 21, 30, 2, 720, '1/4', 2]);
  assert.deepEqual(m.saves, { dex: 5 });                            // 2 + 2 (CR<1) + 1
  assert.deepEqual(m.defenses, { resist: ['fire', 'force'], immune: ['psychic'], vuln: ['bludgeoning'] });   // 13 y 57 no son tipos puros
  assert.deepEqual(m.actions!.map(a => [a.name, a.toHit, a.damage, a.damageType, a.range]),
    [['Scimitar', 4, '1d6+2', 'slashing', 5], ['Javelin', 2, '1d6', 'piercing', 5], ['Claw', 1, '1', 'slashing', 5]]);
  assert.equal(mapMonster({ name: 'x', stats: [], challengeRatingId: 30, sizeId: 4 }).cr, '25');
  assert.throws(() => mapMonster({}));
});

test('conjuros sin automatizar al spellbook (solo nombre); armas no equipadas fuera', () => {
  const sp = (name: string, level: number, x: object = {}) => ({ prepared: true, definition: { name, level, ...x } });
  const w = (name: string, equipped: boolean) => ({ equipped, definition: { id: name, name, filterType: 'Weapon', attackType: 1, categoryId: 1, damage: { diceString: '1d6' }, damageType: 'Piercing' } });
  const c = mapCharacter({
    name: 'Prueba', id: 1, stats: [1, 2, 3, 4, 5, 6].map(id => ({ id, value: id === 4 ? 16 : 10 })),
    classes: [{ id: 9, level: 3, isStartingClass: true, definition: { name: 'Wizard', spellCastingAbilityId: 4 } }],
    inventory: [w('Dagger', true), w('Spear', false)],
    classSpells: [{ characterClassId: 9, spells: [sp('Fire Bolt', 0), sp('Mage Armor', 1, { description: '<p>texto</p>' }), sp('Hex Homebrew', 2, { concentration: true }),
      { prepared: false, definition: { name: 'Shield', level: 1 } }] }],
  });
  assert.deepEqual(c.actions!.map(a => a.id), ['ddb-dagger', 'fire-bolt']);
  assert.deepEqual(c.spellbook, [{ name: 'Mage Armor', level: 1, id: 'mage-armor' }, { name: 'Hex Homebrew', level: 2, conc: true }]);
});
