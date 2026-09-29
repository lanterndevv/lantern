// Reglas D&D 5e: tiradas de dados y núcleo de reglas (funciones puras).

// ---------- Dados ----------
// Sintaxis: [N#]expr · término NdX[khN|klN|!|rN|minN|maxN]* · constantes · @var (contexto: @str, @prof, @lvl…).
// ! explota en el máximo · rN repite una vez los dados ≤ N · minN/maxN acotan cada dado · N# repite la expresión N veces.
import type { Die, Token } from '@lantern/protocol';
const DICE = /^(\d*)d(\d+)((?:k[hl]\d+|!|r\d+|min\d+|max\d+)*)$/;
const MOD = /k[hl]\d+|!|r\d+|min\d+|max\d+/g;
const MAX_DICE = 100;

export type DiceContext = Record<string, number>;
const ABILITY_IDS: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
/** Variables de dados de una ficha: @str… = modificadores, @prof y @lvl. */
export function diceContext(t: { abilities?: Token['abilities']; prof?: number; lvl?: number }): DiceContext {
  const c: DiceContext = { prof: t.prof ?? 0, lvl: t.lvl ?? 0 };
  for (const a of ABILITY_IDS) c[a] = t.abilities ? Math.floor((t.abilities[a] - 10) / 2) : 0;
  return c;
}

function once(src: string, rng: () => number, budget: { count: number }): { total: number; body: string; dice: Die[] } {
  if (!src || !/^[+-]?[^+-]+([+-][^+-]+)*$/.test(src)) throw new Error(`Expresión de dados no válida: "${src}"`);
  const parts = src.match(/[+-]?[^+-]+/g)!;
  if (parts.length > 20) throw new Error('Demasiados términos (máximo 20)');
  let total = 0;
  const dice: Die[] = [];
  let body = '';
  parts.forEach((p, i) => {
    const sign = p.startsWith('-') ? -1 : 1;
    const t = p.replace(/^[+-]/, '');
    const op = sign < 0 ? '-' : i > 0 ? '+' : '';
    if (/^\d+$/.test(t)) {
      total += sign * Number(t);
      body += op + t;
      return;
    }
    const m = DICE.exec(t);
    if (!m) throw new Error(`Término no válido: "${t}"`);
    const n = m[1] === '' ? 1 : Number(m[1]);
    const faces = Number(m[2]);
    if (n < 1) throw new Error('Debe haber al menos un dado');
    if (faces < 2 || faces > 1000) throw new Error('Las caras del dado deben estar entre 2 y 1000');
    budget.count += n;
    if (budget.count > MAX_DICE) throw new Error(`Demasiados dados (máximo ${MAX_DICE})`);
    let keep: string | undefined, k = 0, explode = false, rr = 0, lo = -Infinity, hi = Infinity;
    for (const x of m[3].match(MOD) ?? []) {
      if (x === '!') explode = true;
      else if (x.startsWith('min')) lo = Number(x.slice(3));
      else if (x.startsWith('max')) hi = Number(x.slice(3));
      else if (x[0] === 'r') rr = Number(x.slice(1));
      else { keep = x[1]; k = Number(x.slice(2)); }
    }
    if (keep && (k < 1 || k > n)) throw new Error(`Modificador kh/kl no válido: quedarse con ${k} de ${n} dados`);
    const list: { value: number; kept: boolean }[] = [];
    const live: number[] = []; // índices de list que cuentan para kh/kl
    const draw = () => {
      let v = Math.floor(rng() * faces) + 1;
      if (v <= rr) { list.push({ value: v, kept: false }); v = Math.floor(rng() * faces) + 1; }
      const raw = v;
      live.push(list.push({ value: Math.min(hi, Math.max(lo, v)), kept: true }) - 1);
      return raw;
    };
    for (let j = 0; j < n; j++) {
      let raw = draw();
      while (explode && raw === faces && budget.count < MAX_DICE) { budget.count++; raw = draw(); }
    }
    if (keep) live.sort((a, b) => (keep === 'h' ? list[b].value - list[a].value : list[a].value - list[b].value)).slice(k).forEach((j) => (list[j].kept = false));
    total += sign * list.reduce((s, d) => s + (d.kept ? d.value : 0), 0);
    list.forEach((d) => dice.push({ sides: faces, value: d.value, kept: d.kept }));
    body += op + '[' + list.map((d) => (d.kept ? String(d.value) : `~~${d.value}~~`)).join(',') + ']';
  });
  return { total, body, dice };
}

export function roll(expr: string, rng: () => number = Math.random, ctx: DiceContext = {}): { total: number; detail: string; dice: Die[]; totals?: number[] } {
  let src = String(expr).toLowerCase().replace(/\s+/g, '');
  const rep = /^(\d+)#/.exec(src);
  if (rep) src = src.slice(rep[0].length);
  const expanded = src
    .replace(/@([a-z]+)/g, (_, k: string) => {
      const key = Object.keys(ctx).filter((c) => k.startsWith(c)).sort((x, y) => y.length - x.length)[0]; // '@lvld6' = @lvl + 'd6'
      if (!key) throw new Error(`Variable no definida: @${k}`);
      return String(Math.trunc(ctx[key])) + k.slice(key.length);
    })
    .replace(/\+-/g, '-').replace(/--/g, '+');
  const times = rep ? Number(rep[1]) : 1;
  if (times < 1 || times > 20) throw new Error('Las repeticiones deben estar entre 1 y 20');
  const budget = { count: 0 };
  const rs = Array.from({ length: times }, () => once(expanded, rng, budget));
  const total = rs.reduce((s, r) => s + r.total, 0);
  const dice = rs.flatMap((r) => r.dice);
  if (!rep) return { total, detail: `${src} → ${rs[0].body} = ${total}`, dice };
  return { total, detail: `${rep[0]}${src} → ${rs.map((r) => `${r.body} = ${r.total}`).join(' | ')}`, dice, totals: rs.map((r) => r.total) };
}

// ---------- Condiciones ----------
export const CONDITIONS: Record<string, string> = {
  blinded: 'Cegado', charmed: 'Hechizado', deafened: 'Ensordecido', exhaustion: 'Agotamiento',
  frightened: 'Asustado', grappled: 'Apresado', incapacitated: 'Incapacitado', invisible: 'Invisible',
  paralyzed: 'Paralizado', petrified: 'Petrificado', poisoned: 'Envenenado', prone: 'Derribado',
  restrained: 'Restringido', stunned: 'Aturdido', unconscious: 'Inconsciente', dead: 'Muerto',
};

const has = (list: string[], ...ids: string[]) => ids.some((id) => list.includes(id));

export function attackMode(
  attacker: string[], target: string[], o: { ranged: boolean; within5ft: boolean; adv?: boolean; dis?: boolean }, // adv/dis: fuentes extra (flanqueo, agotamiento)
): 'adv' | 'dis' | 'normal' {
  let adv = has(target, 'blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious') || has(attacker, 'invisible') || !!o.adv;
  let dis = has(attacker, 'blinded', 'poisoned', 'prone', 'restrained', 'frightened') || has(target, 'invisible') || !!o.dis;
  if (target.includes('prone')) {
    if (o.within5ft && !o.ranged) adv = true;
    else dis = true;
  }
  return adv === dis ? 'normal' : adv ? 'adv' : 'dis';
}

type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export const ABILITY_ES: Record<Ability, string> = { str: 'FUE', dex: 'DES', con: 'CON', int: 'INT', wis: 'SAB', cha: 'CAR' };
export const SKILLS: Record<string, { ability: Ability; name: string }> = {
  acrobatics: { ability: 'dex', name: 'Acrobacias' }, animalHandling: { ability: 'wis', name: 'Trato con animales' },
  arcana: { ability: 'int', name: 'Arcanos' }, athletics: { ability: 'str', name: 'Atletismo' },
  deception: { ability: 'cha', name: 'Engaño' }, history: { ability: 'int', name: 'Historia' },
  insight: { ability: 'wis', name: 'Perspicacia' }, intimidation: { ability: 'cha', name: 'Intimidación' },
  investigation: { ability: 'int', name: 'Investigación' }, medicine: { ability: 'wis', name: 'Medicina' },
  nature: { ability: 'int', name: 'Naturaleza' }, perception: { ability: 'wis', name: 'Percepción' },
  performance: { ability: 'cha', name: 'Interpretación' }, persuasion: { ability: 'cha', name: 'Persuasión' },
  religion: { ability: 'int', name: 'Religión' }, sleightOfHand: { ability: 'dex', name: 'Juego de manos' },
  stealth: { ability: 'dex', name: 'Sigilo' }, survival: { ability: 'wis', name: 'Supervivencia' },
};

export function autoFailSave(conditions: string[], ability: Ability): boolean {
  return (ability === 'str' || ability === 'dex') && has(conditions, 'paralyzed', 'stunned', 'unconscious', 'petrified');
}

export function autoCrit(target: string[], within5ft: boolean): boolean {
  return within5ft && has(target, 'paralyzed', 'unconscious');
}

// ---------- Vida y daño ----------
export type HP = { cur: number; max: number; temp: number };
export type DamageDef = { resist?: string[]; immune?: string[]; vuln?: string[] };

export function applyDamage(hp: HP, amount: number, type: string, def: DamageDef = {}): { hp: HP; taken: number } {
  let dmg = Math.max(0, Math.floor(amount));
  if (def.immune?.includes(type)) dmg = 0;
  else {
    if (def.resist?.includes(type)) dmg = Math.floor(dmg / 2);
    if (def.vuln?.includes(type)) dmg *= 2;
  }
  const absorbed = Math.min(hp.temp, dmg);
  return {
    hp: { ...hp, temp: hp.temp - absorbed, cur: Math.max(0, hp.cur - (dmg - absorbed)) },
    taken: dmg,
  };
}

export function heal(hp: HP, amount: number): HP {
  return { ...hp, cur: Math.min(hp.max, hp.cur + Math.max(0, amount)) };
}

export function grantTemp(hp: HP, n: number): HP {
  return { ...hp, temp: Math.max(hp.temp, n) };
}

export function saveDamage(dmg: number, success: boolean, half = true): number {
  return !success ? dmg : half ? Math.floor(dmg / 2) : 0;
}

export function concentrationDC(damage: number): number {
  return Math.min(30, Math.max(10, Math.floor(damage / 2)));
}

export type DeathState = { successes: number; failures: number };

export function deathSave(
  state: DeathState, d20: number,
): { state: DeathState; stable: boolean; dead: boolean; revived?: true; hp?: number } {
  if (d20 === 20) return { state: { successes: 0, failures: 0 }, stable: false, dead: false, revived: true, hp: 1 };
  const failures = Math.min(3, state.failures + (d20 === 1 ? 2 : d20 < 10 ? 1 : 0));
  const successes = Math.min(3, state.successes + (d20 >= 10 ? 1 : 0));
  return { state: { successes, failures }, stable: failures < 3 && successes >= 3, dead: failures >= 3 };
}

// ---------- Características ----------
export const abilityMod = (score: number): number => Math.floor((score - 10) / 2);

export const proficiencyBonus = (level: number): number => 2 + Math.floor((level - 1) / 4);

export function d20Penalty(exhaustion: number, edition: '2014' | '2024'): number {
  return edition === '2024' ? -2 * exhaustion : 0;
}

const EX2014 = [
  'Desventaja en pruebas de característica',
  'Velocidad reducida a la mitad',
  'Desventaja en tiradas de ataque y salvaciones',
  'Máximo de PG reducido a la mitad',
  'Velocidad reducida a 0',
  'Muerte',
];

// Efectos acumulados del agotamiento 2014 hasta ese nivel.
export const exhaustion2014Effects = (level: number): string[] => EX2014.slice(0, Math.max(0, Math.min(6, level)));
export * from './combat.ts';
export * from './encounter.ts';
export * from './area.ts';
export * from './rest.ts';
