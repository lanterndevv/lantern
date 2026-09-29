// Reglas D&D 5e: tiradas de dados y núcleo de reglas (funciones puras).

// ---------- Dados ----------
import type { Die } from '@lantern/protocol';
const TERM = /^(\d*)d(\d+)(?:k([hl])(\d+))?$|^\d+$/;

export function roll(expr: string, rng: () => number = Math.random): { total: number; detail: string; dice: Die[] } {
  const src = String(expr).toLowerCase().replace(/\s+/g, '');
  if (!src || !/^[+-]?[^+-]+([+-][^+-]+)*$/.test(src)) throw new Error(`Expresión de dados no válida: "${expr}"`);
  const parts = src.match(/[+-]?[^+-]+/g)!;
  if (parts.length > 20) throw new Error('Demasiados términos (máximo 20)');
  let total = 0;
  let count = 0;
  const dice: Die[] = [];
  let detail = '';
  parts.forEach((p, i) => {
    const sign = p.startsWith('-') ? -1 : 1;
    const body = p.replace(/^[+-]/, '');
    const m = TERM.exec(body);
    if (!m) throw new Error(`Término no válido: "${body}"`);
    const op = sign < 0 ? '-' : i > 0 ? '+' : '';
    if (m[2] === undefined) {
      total += sign * Number(body);
      detail += op + body;
      return;
    }
    const n = m[1] === '' ? 1 : Number(m[1]);
    const faces = Number(m[2]);
    if (n < 1) throw new Error('Debe haber al menos un dado');
    if (faces < 2 || faces > 1000) throw new Error('Las caras del dado deben estar entre 2 y 1000');
    count += n;
    if (count > 100) throw new Error('Demasiados dados (máximo 100)');
    const rolls = Array.from({ length: n }, () => Math.floor(rng() * faces) + 1);
    const keep = new Array<boolean>(n).fill(true);
    if (m[3]) {
      const k = Number(m[4]);
      if (k < 1 || k > n) throw new Error(`Modificador kh/kl no válido: quedarse con ${k} de ${n} dados`);
      const order = rolls.map((_, j) => j).sort((a, b) => (m[3] === 'h' ? rolls[b] - rolls[a] : rolls[a] - rolls[b]));
      order.slice(k).forEach((j) => (keep[j] = false));
    }
    const sum = rolls.reduce((s, r, j) => s + (keep[j] ? r : 0), 0);
    total += sign * sum;
    rolls.forEach((value, j) => dice.push({ sides: faces, value, kept: keep[j] }));
    detail += op + '[' + rolls.map((r, j) => (keep[j] ? String(r) : `~~${r}~~`)).join(',') + ']';
  });
  return { total, detail: `${src} → ${detail} = ${total}`, dice };
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
