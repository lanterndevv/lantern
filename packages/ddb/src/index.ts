// Traduce el JSON de character-service de D&D Beyond (v5, el objeto `data`) a ImportedCharacter.
// Solo estadísticas de juego: nada de texto de reglas ni descripciones.
import type { Ability, Action, ImportedCharacter } from '@lantern/protocol';
import { SPELLS } from '@lantern/srd';

type J = Record<string, any>;
const ABIL: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];       // statId 1..6
const FULL = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const CLASES: Record<string, string> = {
  Barbarian: 'Bárbaro', Bard: 'Bardo', Cleric: 'Clérigo', Druid: 'Druida', Fighter: 'Guerrero', Monk: 'Monje', Paladin: 'Paladín',
  Ranger: 'Explorador', Rogue: 'Pícaro', Sorcerer: 'Hechicero', Warlock: 'Brujo', Wizard: 'Mago', Artificer: 'Artífice',
};
const mod = (n: number) => Math.floor((n - 10) / 2);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const val = (m: J) => m.value ?? m.fixedValue ?? 0;

// ids de habilidad canónicos = camelCase de @lantern/rules (DDB usa kebab: 'sleight-of-hand' → 'sleightOfHand')
const camel = (k: string) => k.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const SKILLS: Record<string, number> = {
  acrobatics: 1, 'animal-handling': 4, arcana: 3, athletics: 0, deception: 5, history: 3, insight: 4, intimidation: 5, investigation: 3,
  medicine: 4, nature: 3, perception: 4, performance: 5, persuasion: 5, religion: 3, 'sleight-of-hand': 1, stealth: 1, survival: 4,
};
const DMG = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
// Niveles de lanzador (mapa por nivel de clase completo) y magia de pacto: [nº de espacios, nivel del espacio]
const FULL_SLOTS = [[2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]];
const PACT = [[1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5]];
const KNOWN_CASTERS = ['Warlock', 'Sorcerer', 'Bard', 'Ranger'];   // conocen sus conjuros: no hay lista de «preparados»

export function mapCharacter(json: unknown): ImportedCharacter {
  let c = json as J;
  if (c?.data?.classes) c = c.data;   // la respuesta del servicio viene envuelta en { success, data }
  if (!c || typeof c !== 'object' || !Array.isArray(c.classes) || !c.classes.length || !Array.isArray(c.stats) || typeof c.name !== 'string')
    throw new Error('JSON de D&D Beyond no válido: faltan name, classes o stats');
  const inv: J[] = c.inventory ?? [];
  const cv: J[] = c.characterValues ?? [];

  // Modificadores activos. Los de objeto solo cuentan si está equipado (y sintonizado si lo requiere).
  // ponytail: sin filtrar `restriction` salvo donde se indica; cuenta todo lo equipado.
  const on = (it: J) => it.equipped && (!it.definition?.canAttune || it.isAttuned);
  const active = new Set(inv.filter(on).map(i => i.definition?.id));
  const mods: J[] = [];
  // En multiclase, los rasgos de las clases no iniciales solo aportan lo que marcan `availableToMulticlass` (p. ej. no dan competencia en salvaciones).
  const notStarting = new Set(c.classes.filter((k: J) => !k.isStartingClass).flatMap((k: J) => (k.classFeatures ?? []).map((f: J) => f.definition?.id)));
  for (const k of ['race', 'class', 'background', 'feat', 'item', 'condition'])
    for (const m of c.modifiers?.[k] ?? [])
      if (k === 'item' ? active.has(m.componentId) : k !== 'class' || m.availableToMulticlass !== false || !notStarting.has(m.componentId)) mods.push(m);
  const of = (type: string, sub: string) => mods.filter(m => m.type === type && m.subType === sub);
  const sum = (type: string, sub: string) => of(type, sub).reduce((a, m) => a + val(m), 0);

  const level = c.classes.reduce((a: number, k: J) => a + (k.level ?? 0), 0);
  const prof = Math.ceil(level / 4) + 1;

  // Puntuación = base + bonusStats + mods sin restricción, con tope 20 salvo el bonus manual; los `set` (cinturones) son un suelo; override manda.
  const score = ABIL.map((_, i) => {
    const o = c.overrideStats?.find((s: J) => s.id === i + 1)?.value;
    if (o) return o as number;
    const g = (arr: J[] | undefined) => arr?.find(s => s.id === i + 1)?.value ?? 0;
    const plain = (t: string) => of(t, FULL[i] + '-score').filter(m => !m.restriction || m.restriction === 'if not already higher');
    const bonus = plain('bonus').filter(m => !m.restriction).reduce((a, m) => a + val(m), 0);
    return Math.max(Math.min(20, g(c.stats) + bonus) + g(c.bonusStats), ...plain('set').map(val));
  });
  const md = score.map(mod);
  const [dex, con] = [md[1], md[2]];
  // Bonus con `statId` (Aura de protección…) valen el modificador de esa característica (mín. 1)
  const bv = (m: J) => (m.statId ? Math.max(1, md[m.statId - 1]) : val(m));

  // PG (misma fórmula que ddb-importer): override || base + CON*nivel + bonus por nivel + bonus fijos (los «dados» son curación, no máximo); + bonusHitPoints - heridas
  // ponytail: el bonus por nivel se multiplica por el nivel total (Resiliencia dracónica en multiclase debería usar solo el de su clase).
  const fixedHp = of('bonus', 'hit-points').filter(m => !(m.dice && m.value == null)).reduce((a, m) => a + val(m), 0);
  const hp = (c.overrideHitPoints || (c.baseHitPoints ?? 0) + con * level + sum('bonus', 'hit-points-per-level') * level + fixedHp) + (c.bonusHitPoints ?? 0);

  const gear = inv.filter(on);
  const armor = gear.find(i => i.definition?.filterType === 'Armor' && [1, 2, 3].includes(i.definition.armorTypeId));
  const shield = gear.find(i => i.definition?.armorTypeId === 4);
  let ac: number;
  const acOverride = cv.find(v => v.typeId === 1)?.value;
  if (acOverride != null) ac = Number(acOverride);
  else {
    if (armor) {
      const t = armor.definition.armorTypeId;
      ac = (armor.definition.armorClass ?? 10) + (t === 1 ? dex : t === 2 ? Math.min(dex, 2) : 0) + sum('bonus', 'armored-armor-class');
    } else {
      // Defensa sin armadura (bárbaro CON, monje SAB…): 'set' unarmored-armor-class con statId; ponytail: se coge la mejor
      ac = Math.max(10 + dex, ...of('set', 'unarmored-armor-class').map(m => 10 + dex + (m.statId ? md[m.statId - 1] : 0))) + sum('bonus', 'unarmored-armor-class');
    }
    if (shield) ac += shield.definition.armorClass ?? 2;
    ac += sum('bonus', 'armor-class');   // incluye bonus mágicos de armadura/escudo (grantedModifiers) y anillos/capas
    for (const v of cv) if ((v.typeId === 2 || v.typeId === 3) && Number.isInteger(v.value)) ac += v.value;
  }

  const saves: ImportedCharacter['saves'] = {};
  ABIL.forEach((a, i) => {
    const s = FULL[i] + '-saving-throws';
    saves[a] = md[i] + (of('proficiency', s).length ? prof : 0) + of('bonus', s).concat(of('bonus', 'saving-throws')).reduce((t, m) => t + bv(m), 0);
  });

  // Velocidad (como ddb-importer): la mayor entre weightSpeeds y `set innate-speed-walking`, + bonus (Movimiento rápido solo sin armadura pesada),
  // + movimiento sin armadura (monje) si no lleva armadura; customSpeeds (movementId 1 = caminar) manda.
  const heavy = inv.some(i => i.equipped && i.definition?.type === 'Heavy Armor');
  let speed = Math.max(c.race?.weightSpeeds?.normal?.walk ?? 30, ...of('set', 'innate-speed-walking').map(val));
  speed += of('bonus', 'speed').filter(m => !m.restriction || (!heavy && /heavy armor/i.test(m.restriction))).reduce((a, m) => a + val(m), 0);
  if (!armor) speed += sum('bonus', 'unarmored-movement');
  speed = c.customSpeeds?.find((s: J) => s.movementId === 1 && s.distance)?.distance ?? speed;

  const feet = Math.max(0, ...of('set-base', 'darkvision').map(val), ...of('sense', 'darkvision').map(val),
    ...(c.customSenses ?? []).filter((s: J) => s.senseId === 2).map((s: J) => s.distance ?? 0));
  const defenses: NonNullable<ImportedCharacter['defenses']> = {};
  for (const [t, key] of [['resistance', 'resist'], ['immunity', 'immune'], ['vulnerability', 'vuln']] as const) {
    // solo tipos de daño (los inmunes a «enfermedad» o «asustado» son condiciones) y sin restricción («de ataques no mágicos»…)
    const l = [...new Set(mods.filter(m => m.type === t && !m.restriction).map(m => slug(String(m.subType).replace(/-damage$/, ''))).filter(x => DMG.includes(x)))];
    if (l.length) defenses[key] = l;
  }

  const has = (sub: string) => mods.some(m => m.type === 'proficiency' && m.subType === sub);
  const skills: Record<string, number> = {};
  for (const [k, st] of Object.entries(SKILLS))
    skills[camel(k)] = md[st] + (of('expertise', k).length ? 2 * prof : has(k) ? prof : 0);

  const actions: Action[] = [];
  const isMonk = c.classes.some((k: J) => k.definition?.name === 'Monk');
  for (const it of gear) {
    const d = it.definition;
    if (d?.filterType !== 'Weapon' || !d.damage?.diceString || actions.some(a => a.id === 'ddb-' + slug(d.name))) continue;
    const props = (d.properties ?? []).map((p: J) => p.name);
    const ranged = d.attackType === 2;
    const best = Math.max(md[0], dex);
    const m = ranged ? dex : (props.includes('Finesse') || (isMonk && d.isMonkWeapon)) ? best : md[0];
    const magic = (d.grantedModifiers ?? []).filter((g: J) => g.type === 'bonus' && g.subType === 'magic').reduce((a: number, g: J) => a + val(g), 0);
    // categoryId: 1 simple, 2 marcial, 3 otras (armas de fuego…); también competencia por arma concreta
    const skilled = has(d.categoryId === 1 ? 'simple-weapons' : d.categoryId === 2 ? 'martial-weapons' : '-') || has(slug(d.type ?? d.name));
    // estilos de combate: Tiro con arco (+ataque a distancia), Duelo (+daño con arma a una mano)
    const hit = m + magic + (skilled ? prof : 0) + sum('bonus', ranged ? 'ranged-weapon-attacks' : 'melee-weapon-attacks');
    const dmg = m + magic + (ranged ? sum('damage', 'ranged-weapon-attacks') : props.includes('Two-Handed') ? 0 : sum('damage', 'one-handed-melee-attacks'));
    actions.push({
      id: 'ddb-' + slug(d.name), name: d.name, cost: 'action', kind: 'attack',
      range: ranged ? d.range || 80 : props.includes('Reach') ? 10 : 5,
      toHit: hit, damage: d.damage.diceString + (dmg ? (dmg > 0 ? '+' : '') + dmg : ''),
      damageType: slug(String(d.damageType ?? '')) || undefined,
    });
  }

  // Conjuros: los que existen en SPELLS del SRD. Listas de «conocidos» (brujo, hechicero, bardo, explorador): todos; el resto, preparados/siempre preparados; trucos siempre.
  const abilOf = (k: J) => k?.definition?.spellCastingAbilityId || k?.subclassDefinition?.spellCastingAbilityId;
  const mainAbil = c.classes.map(abilOf).find((x: number) => x);
  const all: { s: J; abil?: number; known: boolean }[] = [
    ...(c.classSpells ?? []).flatMap((cs: J) => {
      const k = c.classes.find((x: J) => x.id === cs.characterClassId);
      return (cs.spells ?? []).map((s: J) => ({ s, abil: abilOf(k), known: KNOWN_CASTERS.includes(k?.definition?.name) }));
    }),
    ...['race', 'class', 'item', 'feat', 'background'].flatMap(k => (c.spells?.[k] ?? []).map((s: J) => ({ s, abil: s.spellCastingAbilityId, known: false }))),
  ];
  for (const { s, abil, known } of all) {
    const d = s.definition;
    const base = d && SPELLS[slug(d.name)];
    const a0 = abil || mainAbil;
    if (!base || !a0 || !(d.level === 0 || known || s.prepared || s.alwaysPrepared) || actions.some(a => a.id === base.id)) continue;
    const cm = md[a0 - 1];
    const a: Action = { ...base };
    if (a.toHit != null) a.toHit = prof + cm;
    if (a.save) a.save = { ...a.save, dc: 8 + prof + cm };
    if (a.kind === 'heal' && a.damage) a.damage = a.damage.replace(/[+-]\d+$/, '') + (cm < 0 ? '' : '+') + cm;   // la mod. de lanzamiento va en la curación
    if (d.level === 0 && a.damage && a.kind !== 'heal') a.damage = a.damage.replace(/^\d+/, String([5, 11, 17].filter(n => level >= n).length + 1));   // ponytail: solo trucos de «NdX» simple
    actions.push(a);
  }

  // Espacios: `spellSlots[].available` viene siempre a 0 en el JSON real (solo `used` es fiable), así que el máximo sale de las tablas de clase.
  // Multiclase: nivel de lanzador = completo + ½ (paladín/explorador, ⌈½⌉ artífice) + ⅓ (Caballero místico/Embaucador arcano). Pacto aparte, se suma al nivel de su espacio.
  const slots: NonNullable<ImportedCharacter['slots']> = {};
  const FULL_C = ['Bard', 'Cleric', 'Druid', 'Sorcerer', 'Wizard'];
  let cl = 0, pact = 0;
  for (const k of c.classes) {
    const n = k.definition?.name, l = k.level ?? 0, sub = k.subclassDefinition?.name;
    if (FULL_C.includes(n)) cl += l;
    else if (n === 'Paladin' || n === 'Ranger') cl += Math.floor(l / 2);
    else if (n === 'Artificer') cl += Math.ceil(l / 2);
    else if (sub === 'Eldritch Knight' || sub === 'Arcane Trickster') cl += Math.floor(l / 3);
    else if (n === 'Warlock') pact += l;
  }
  const usedOf = (arr: J[] | undefined, lv: number) => arr?.find(s => s.level === lv)?.used ?? 0;
  (FULL_SLOTS[Math.min(cl, 20) - 1] ?? []).forEach((max, i) => { slots[i + 1] = { max, used: usedOf(c.spellSlots, i + 1) }; });
  if (pact) {
    const [n, lv] = PACT[Math.min(pact, 20) - 1];
    slots[lv] = { max: (slots[lv]?.max ?? 0) + n, used: (slots[lv]?.used ?? 0) + usedOf(c.pactMagic, lv) };
  }

  return {
    name: c.name, ddbId: c.id, avatar: c.decorations?.avatarUrl || undefined,
    level, classes: c.classes.map((k: J) => `${CLASES[k.definition?.name] ?? k.definition?.name} ${k.level}`).join(' / '),
    hp: { max: hp, cur: Math.max(0, hp - (c.removedHitPoints ?? 0)), temp: c.temporaryHitPoints ?? 0 },
    ac, speed, initMod: dex + sum('bonus', 'initiative'), saves, darkvision: feet * 12, defenses,
    abilities: Object.fromEntries(ABIL.map((a, i) => [a, score[i]])) as Record<Ability, number>, skills, prof,
    actions, slots: Object.keys(slots).length ? slots : undefined,
  };
}

// ---- Monstruos (monster-service: /v1/Monster?ids=…). Solo estadísticas; `actionsDescription` se lee y se descarta. ----
const cr = (id: number) => id <= 1 ? '0' : id <= 4 ? ['1/8', '1/4', '1/2'][id - 2] : String(id > 28 ? id - 5 : id - 4);   // ids de challengeRatings (el 28 no existe)
const SIZE: Record<number, number> = { 5: 2, 6: 3, 7: 4 };                                                             // creatureSizes: Tiny/Small/Medium/«Medium or Small» = 1
// damageAdjustments: pureza de tipo solamente (los «no mágico», «de armas de plata»… no son tipos de daño y se omiten)
const ADJ: Record<number, ['resist' | 'immune' | 'vuln', string]> = {};
['bludgeoning', 'piercing', 'slashing', 'lightning', 'thunder', 'poison', 'cold', 'radiant', 'fire', 'necrotic', 'acid', 'psychic', 'force'].forEach((t, i) => {
  ADJ[i < 12 ? i + 1 : 47] = ['resist', t]; ADJ[i < 12 ? i + 17 : 48] = ['immune', t]; ADJ[i < 12 ? i + 33 : 49] = ['vuln', t];
});
const ATTACK = /^([^.]+?)\.\s*(?:Melee|Ranged)(?: or (?:Melee|Ranged))? (?:Weapon|Spell) Attack:\s*([+-]\s*\d+) to hit,\s*(?:reach (\d+)|range (\d+))[^]*?Hit:\s*(\d+)(?: \(([^)]+)\))? (\w+) damage/i;

export function mapMonster(json: unknown): ImportedCharacter & { cr: string; size: number } {
  let m = json as J;
  if (Array.isArray(m?.data)) m = m.data[0]; else if (m?.data?.stats) m = m.data;
  if (!m || typeof m.name !== 'string' || !Array.isArray(m.stats)) throw new Error('JSON de monstruo no válido: faltan name o stats');
  const score = (i: number): number => m.stats.find((s: J) => s.statId === i + 1)?.value ?? 10;
  const md = ABIL.map((_, i) => mod(score(i)));
  const c = cr(m.challengeRatingId);
  const crn = c.includes('/') ? 0 : Number(c);
  const prof = crn >= 1 ? 2 + Math.floor((crn - 1) / 4) : 2;
  const saves: ImportedCharacter['saves'] = {};
  for (const s of m.savingThrows ?? []) if (s.statId >= 1 && s.statId <= 6) saves[ABIL[s.statId - 1]] = md[s.statId - 1] + prof + (s.bonusModifier ?? 0);
  const moves: J[] = m.movements ?? [];
  const speed = moves.find(v => v.movementId === 1)?.speed ?? Math.max(30, ...moves.map(v => v.speed ?? 0));
  const feet = Math.max(0, ...(m.senses ?? []).filter((s: J) => s.senseId === 2).map((s: J) => parseInt(s.notes) || 0));
  const defenses: NonNullable<ImportedCharacter['defenses']> = {};
  for (const id of m.damageAdjustments ?? []) if (ADJ[id]) (defenses[ADJ[id][0]] ??= []).push(ADJ[id][1]);
  const actions: Action[] = [];
  for (const p of String(m.actionsDescription ?? '').split(/<\/p>|<br\s*\/?>/i)) {
    const t = p.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const a = t.match(ATTACK);
    if (!a || actions.some(x => x.id === 'ddb-' + slug(a[1]))) continue;
    actions.push({
      id: 'ddb-' + slug(a[1]), name: a[1], cost: 'action', kind: 'attack', range: Number(a[3] ?? a[4]),
      toHit: Number(a[2].replace(/\s/g, '')), damage: (a[6] ?? a[5]).replace(/\s/g, ''), damageType: a[7].toLowerCase(),
    });
  }
  const hp = m.averageHitPoints ?? 1;
  return {
    name: m.name, ddbId: m.id, avatar: m.avatarUrl || undefined, level: 1, classes: '',
    hp: { max: hp, cur: hp, temp: 0 }, ac: m.armorClass ?? 10, speed, initMod: md[1], saves, darkvision: feet * 12, defenses,
    abilities: Object.fromEntries(ABIL.map((a, i) => [a, score(i)])) as Record<Ability, number>, prof, actions, cr: c, size: SIZE[m.sizeId] ?? 1,
  };
}
