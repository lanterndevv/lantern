// Validación de un personaje importado de D&D Beyond. Viene de una extensión del cliente: nada es de fiar.
import type { Ability, Action, ImportedCharacter } from '@lantern/protocol';
import { SKILLS, roll } from '@lantern/rules';

const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length >= 1 && v.length <= max;
const keysIn = (o: Record<string, unknown>, allowed: readonly string[]) => Object.keys(o).every((k) => allowed.includes(k));
const HOSTS = /(^|\.)dndbeyond\.com$|^media-waterdeep\.cursecdn\.com$/;

function avatar(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 512) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && HOSTS.test(u.hostname) ? u.href : undefined;
  } catch { return undefined; }
}

function parseAction(v: unknown): Action | null {
  if (!obj(v) || !keysIn(v, ['id', 'name', 'cost', 'kind', 'range', 'toHit', 'save', 'damage', 'damageType', 'area', 'slot'])) return null;
  if (!str(v.id, 40) || !str(v.name, 60) || !['action', 'bonus', 'reaction'].includes(v.cost as string) || !['attack', 'save', 'heal'].includes(v.kind as string) || !int(v.range, 0, 1000)) return null;
  const a: Action = { id: v.id, name: v.name, cost: v.cost as Action['cost'], kind: v.kind as Action['kind'], range: v.range };
  if (v.toHit !== undefined) { if (!int(v.toHit, -10, 30)) return null; a.toHit = v.toHit; }
  if (v.damage !== undefined) {
    if (!str(v.damage, 100)) return null;
    try { roll(v.damage, () => 0.5); } catch { return null; }
    a.damage = v.damage;
  }
  if (v.damageType !== undefined) { if (typeof v.damageType !== 'string' || !/^[a-z]{1,30}$/.test(v.damageType)) return null; a.damageType = v.damageType; }
  if (v.save !== undefined) {
    const s = v.save;
    if (!obj(s) || !keysIn(s, ['ability', 'dc', 'half']) || !ABILITIES.includes(s.ability as Ability) || !int(s.dc, 1, 40) || typeof s.half !== 'boolean') return null;
    a.save = { ability: s.ability as Ability, dc: s.dc, half: s.half };
  }
  if (a.kind === 'save' && !a.save) return null; // resolveAction lo necesita
  if (v.area !== undefined) {
    const r = v.area;
    if (!obj(r) || !keysIn(r, ['shape', 'size']) || !['sphere', 'cone', 'line', 'cube'].includes(r.shape as string) || !int(r.size, 0, 500)) return null;
    a.area = { shape: r.shape as 'sphere', size: r.size };
  }
  if (v.slot !== undefined) { if (!int(v.slot, 0, 9)) return null; a.slot = v.slot; }
  return a;
}

export function parseCharacter(v: unknown): ImportedCharacter | null {
  if (!obj(v) || !str(v.name, 40) || !int(v.ddbId, 0, Number.MAX_SAFE_INTEGER) || !int(v.level, 1, 20) || !int(v.darkvision, 0, 2400) || typeof v.classes !== 'string' || v.classes.length > 60) return null;
  const c: ImportedCharacter = { name: v.name.trim(), ddbId: v.ddbId, level: v.level, classes: v.classes, darkvision: v.darkvision };
  if (!c.name) return null;
  if (v.hp !== undefined) {
    const h = v.hp;
    if (!obj(h) || !keysIn(h, ['cur', 'max', 'temp']) || !int(h.cur, 0, 999) || !int(h.max, 0, 999) || !int(h.temp, 0, 999) || h.cur > h.max) return null;
    c.hp = { cur: h.cur, max: h.max, temp: h.temp };
  }
  if (v.ac !== undefined) { if (!int(v.ac, 1, 40)) return null; c.ac = v.ac; }
  if (v.speed !== undefined) { if (!int(v.speed, 0, 200)) return null; c.speed = v.speed; }
  if (v.initMod !== undefined) { if (!int(v.initMod, -10, 20)) return null; c.initMod = v.initMod; }
  if (v.saves !== undefined) {
    if (!obj(v.saves) || !keysIn(v.saves, ABILITIES)) return null;
    c.saves = {};
    for (const [k, n] of Object.entries(v.saves)) { if (!int(n, -10, 20)) return null; c.saves[k as Ability] = n; }
  }
  if (v.abilities !== undefined) {
    if (!obj(v.abilities) || !keysIn(v.abilities, ABILITIES) || !ABILITIES.every((k) => int((v.abilities as Record<string, unknown>)[k], 1, 30))) return null;
    c.abilities = Object.fromEntries(ABILITIES.map((k) => [k, (v.abilities as Record<string, number>)[k]])) as Record<Ability, number>;
  }
  if (v.skills !== undefined) {
    if (!obj(v.skills) || Object.keys(v.skills).length > 30 || !keysIn(v.skills, Object.keys(SKILLS))) return null;
    c.skills = {};
    for (const [k, n] of Object.entries(v.skills)) { if (!int(n, -10, 20)) return null; c.skills[k] = n; }
  }
  if (v.prof !== undefined) { if (!int(v.prof, 2, 6)) return null; c.prof = v.prof; }
  if (v.defenses !== undefined) {
    const d = v.defenses;
    if (!obj(d) || !keysIn(d, ['resist', 'immune', 'vuln'])) return null;
    c.defenses = {};
    for (const k of ['resist', 'immune', 'vuln'] as const) {
      if (d[k] === undefined) continue;
      if (!Array.isArray(d[k]) || d[k].length > 20 || !d[k].every((x) => str(x, 40))) return null;
      c.defenses[k] = [...d[k] as string[]];
    }
  }
  if (v.actions !== undefined) {
    if (!Array.isArray(v.actions) || v.actions.length > 40) return null;
    const acts = v.actions.map(parseAction);
    if (acts.some((a) => !a) || new Set(acts.map((a) => a!.id)).size !== acts.length) return null;
    c.actions = acts as Action[];
  }
  if (v.slots !== undefined) {
    if (!obj(v.slots)) return null;
    c.slots = {};
    for (const [k, s] of Object.entries(v.slots)) {
      if (!/^[1-9]$/.test(k) || !obj(s) || !keysIn(s, ['max', 'used']) || !int(s.max, 0, 9) || !int(s.used, 0, 9) || s.used > s.max) return null;
      c.slots[Number(k)] = { max: s.max, used: s.used };
    }
  }
  const img = avatar(v.avatar);
  if (img) c.avatar = img;
  return c;
}
