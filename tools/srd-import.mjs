// Convierte el SRD 5.2.1 (CC-BY-4.0) de 5e-bits/5e-database (código MIT) al esquema de packages/srd.
// Uso: node tools/srd-import.mjs   (descarga de GitHub; SRD_DIR=/ruta usa copias locales de los JSON)
import { readFile, writeFile } from 'node:fs/promises';
import { MONSTER_ES, SIZE_ES, TYPE_ES, alignES } from '../packages/srd/src/es.ts';

const BASE = 'https://raw.githubusercontent.com/5e-bits/5e-database/main/src/2024/en/';
const OUT = new URL('../packages/srd/src/', import.meta.url);
const load = async (f) => JSON.parse(process.env.SRD_DIR ? await readFile(`${process.env.SRD_DIR}/${f}`, 'utf8') : await (await fetch(BASE + f)).text());
const HEAD = '// GENERADO por tools/srd-import.mjs. No editar a mano.\n// This work includes material from the System Reference Document 5.2.1 by Wizards of the Coast LLC, licensed under CC BY 4.0\n';
const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ft = (s) => { const m = /(\d+)/.exec(s ?? ''); return m ? Number(m[1]) : 0; };
const DMG = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
const AB = ['str', 'dex', 'con', 'int', 'wis', 'cha'], AB_FULL = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const CR = { 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' };
const SIZE = { Tiny: 1, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4 };
const modOf = (n) => Math.floor((n - 10) / 2);
// Se suman los daños extra salvo los condicionales («… if the attack roll had Advantage»).
const cond = (a, dice) => new RegExp(`\\(${dice.replace(/\+/g, ' \\+ ')}\\)[^.]*\\bif\\b`).test(a.desc);
const dmgOf = (a) => a.damage?.length ? { damage: a.damage.filter((d, i) => !i || !cond(a, d.damage_dice)).map((d) => d.damage_dice).join('+'), damageType: a.damage[0].damage_type.index } : null;

function monster(m) {
  const score = { str: m.strength, dex: m.dexterity, con: m.constitution, int: m.intelligence, wis: m.wisdom, cha: m.charisma };
  const saves = Object.fromEntries(AB.map((a) => [a, modOf(score[a])]));
  for (const p of m.proficiencies ?? []) if (p.proficiency.index.startsWith('saving-throw-')) saves[p.proficiency.index.slice(13)] = p.value;
  const speeds = Object.values(m.speed ?? {}).map(ft);
  const seen = new Set(), actions = [];
  for (const a of m.actions ?? []) {
    const d = dmgOf(a);
    if (!d) continue; // Multiataque y rasgos se tratan aparte
    let id = kebab(a.name);
    while (seen.has(id)) id += '-2';
    seen.add(id);
    const reach = /reach (\d+) ft/.exec(a.desc), rng = /range (\d+)(?:\/\d+)? ft/.exec(a.desc), range = Math.max(Number(reach?.[1] ?? 5), Number(rng?.[1] ?? 0));
    if (a.attack_bonus !== undefined) actions.push({ id, name: a.name, cost: 'action', kind: 'attack', range, toHit: a.attack_bonus, ...d });
    else if (a.dc) actions.push({ id, name: a.name, cost: 'action', kind: 'save', range, save: { ability: a.dc.dc_type.index, dc: a.dc.dc_value, half: a.dc.success_type === 'half' }, ...d });
  }
  // Multiataque: «makes two Claw attacks and one Bite attack» → encadena esas acciones (solo la primera alternativa; lo que no ataca queda fuera)
  const ma = (m.actions ?? []).find((a) => /^Multiattack/.test(a.name));
  if (ma) {
    const N = { one: 1, two: 2, three: 3, four: 4, five: 5 }, first = ma.desc.split(/, or | or it /)[0], multi = [];
    const byName = (n) => actions.find((a) => a.name.toLowerCase() === n.trim().toLowerCase());
    for (const [, n, name] of first.matchAll(/\b(one|two|three|four|five) ([A-Z][\w' -]*?) attacks?\b/g)) { const a = byName(name); if (a) multi.push({ id: a.id, n: N[n] }); }
    const any = /makes (one|two|three|four|five) attacks?, using ([A-Z][\w' -]*?)(?: or |,| in )/.exec(first), a0 = any && byName(any[2]);
    if (!multi.length && a0) multi.push({ id: a0.id, n: N[any[1]] });
    if (multi.length) actions.unshift({ id: 'multiattack', name: 'Multiataque', cost: 'action', kind: 'attack', range: Math.max(...multi.map((e) => actions.find((a) => a.id === e.id).range)), multi });
  }
  const text = (l) => (l ?? []).map((x) => ({ name: x.name, text: x.desc }));
  const list = (k) => (m[k] ?? []).filter((x) => DMG.includes(x));
  const defenses = { resist: list('damage_resistances'), immune: list('damage_immunities'), vuln: list('damage_vulnerabilities') };
  for (const k of Object.keys(defenses)) if (!defenses[k].length) delete defenses[k];
  return {
    name: MONSTER_ES[m.index] ?? m.name, faction: 'enemy', size: SIZE[m.size] ?? 1, darkvision: ft(m.senses?.darkvision) * 12, hp: { cur: m.hit_points, max: m.hit_points, temp: 0 },
    ac: m.armor_class[0].value, speed: Math.max(ft(m.speed?.walk), ...speeds, 0), initMod: modOf(score.dex), saves, ...(Object.keys(defenses).length && { defenses }),
    actions, cr: CR[m.challenge_rating] ?? String(m.challenge_rating), type: TYPE_ES[m.type] ?? m.type, conditions: [],
    sizeName: SIZE_ES[m.size] ?? m.size, align: alignES(m.alignment), ...(m.special_abilities?.length && { traits: text(m.special_abilities) }),
    ...(m.legendary_actions?.length && { legend: text(m.legendary_actions), legendary: { max: 3, used: 0 } }),
    ...(m.condition_immunities?.length && { condImm: m.condition_immunities.map((c) => c.index) }),
  };
}

// Heurística sobre el texto: el JSON no trae CD, área ni curación.
function spell(s) {
  const cost = s.casting_time.startsWith('Action') ? 'action' : s.casting_time.startsWith('Bonus') ? 'bonus' : s.casting_time.startsWith('Reaction') ? 'reaction' : null;
  if (!cost) return null;
  const area = /(\d+)-foot(?:-radius)? (Sphere|Cone|Cube)/.exec(s.description), cyl = /(\d+)-foot-radius, \d+-foot-high Cylinder/.exec(s.description);
  const areaOf = area ? { shape: area[2].toLowerCase(), size: Number(area[1]) } : cyl ? { shape: 'sphere', size: Number(cyl[1]) } : undefined;
  const range = /^Touch/.test(s.range) ? 5 : /^Self/.test(s.range) ? (areaOf?.size ?? 0) : /mile/.test(s.range) ? 1000 : Math.min(1000, ft(s.range));
  const base = { id: s.index, name: s.name, cost, range, ...(s.level && { slot: s.level }) };
  const heal = /regains? (?:a number of )?Hit Points equal to (\d+d\d+)( plus your spellcasting)?/i.exec(s.description);
  if (!s.damage && heal) return { ...base, kind: 'heal', damage: heal[1] + (heal[2] ? '+3' : '') }; // +3: marcador del modificador, como en los conjuros a mano
  const at = s.damage?.damage_at_slot_level ?? s.damage?.damage_at_character_level;
  if (!at) return null;
  const damage = at[Object.keys(at).sort((a, b) => a - b)[0]], damageType = s.damage.damage_type.index;
  const sv = new RegExp(`(${AB_FULL.join('|')}) saving throw`, 'i').exec(s.description);
  const extra = { damage, damageType, ...(areaOf && { area: areaOf }) };
  if (s.attack_type) return { ...base, kind: 'attack', toHit: 5, ...extra };
  if (sv) return { ...base, kind: 'save', save: { ability: AB[AB_FULL.indexOf(sv[1].toLowerCase())], dc: 13, half: /half as much damage/i.test(s.description) }, ...extra };
  return null;
}

const mons = await load('5e-SRD-Monsters.json'), spells = await load('5e-SRD-Spells.json');
const M = Object.fromEntries(mons.map((m) => [m.index, monster(m)]));
const idx = Object.fromEntries(spells.map((s) => [s.index, { name: s.name, level: s.level, school: s.school.index, classes: s.classes.map((c) => c.index),
  time: s.casting_time, range: s.range, components: s.components.join(''), duration: s.duration, concentration: s.concentration, ritual: s.ritual }]));
const A = Object.fromEntries(spells.map((s) => [s.index, spell(s)]).filter(([, a]) => a));
// Subir de nivel: solo el patrón regular «The damage/healing increases by XdY for each spell slot level above N» (dardos, rayos… quedan fuera)
const UP_RE = /The (?:base )?(?:damage|healing)(?: \([^)]*\))? increases by (\d+d\d+) for each spell slot level above \d/;
const UP = Object.fromEntries(spells.filter((s) => A[s.index] && s.level).map((s) => [s.index, UP_RE.exec(s.higher_level ?? s.description)?.[1]]).filter(([, d]) => d));
const rows = (o) => '{\n' + Object.entries(o).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n') + '\n}';
await writeFile(new URL('monsters.gen.ts', OUT), `${HEAD}import type { SrdMonster } from './compendium.ts';\n\nexport const GEN_MONSTERS: Record<string, SrdMonster> = ${rows(M)};\n`);
await writeFile(new URL('spells.gen.ts', OUT), `${HEAD}import type { Action } from '@lantern/protocol';\n\nexport type SpellInfo = { name: string; level: number; school: string; classes: string[]; time: string; range: string; components: string; duration: string; concentration: boolean; ritual: boolean };\n\n/** Catálogo completo (metadatos; el texto de los conjuros no se incluye). */\nexport const SPELL_INDEX: Record<string, SpellInfo> = ${rows(idx)};\n\n/** Conjuros con daño o curación automatizables. */\nexport const GEN_SPELLS: Record<string, Action> = ${rows(A)};\n\n/** Dados que se suman por cada nivel de espacio por encima del base. */\nexport const SPELL_UP: Record<string, string> = ${rows(UP)};\n`);
console.log(`${Object.keys(M).length} monstruos, ${Object.keys(idx).length} conjuros (${Object.keys(A).length} automatizables)`);
