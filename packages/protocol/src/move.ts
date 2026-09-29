// Cálculo puro del movimiento (cliente y servidor comparten la misma regla): coste por tramo y ataques de oportunidad.
import type { Id, MoveMode, Point, Scene, Token } from './index.ts';

export type Diagonal = 'chebyshev' | 'alt' | 'euclid';
export type Leg = { from: Point; to: Point; feet: number; difficult: boolean };

const inPoly = (p: Point, poly: Point[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    if ((poly[i].y > p.y) !== (poly[j].y > p.y) && p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
  return c;
};
const flr = (s: Scene, l?: Id) => l === s.levels?.[0]?.id ? undefined : l;

/** Velocidad (pies) del token en ese modo; null = no puede moverse así. Nadar/trepar sin velocidad propia usan la de andar (cuesta el doble). */
export function speedFor(t: Token, mode: MoveMode): number | null {
  const walk = t.speed ?? 30;
  if (mode === 'walk') return walk;
  return t.speeds?.[mode] ?? (mode === 'fly' ? null : walk);
}
/** Coste extra por modo: nadar/trepar sin velocidad propia = ×2. */
const modeMul = (t: Token, mode: MoveMode) => (mode === 'swim' || mode === 'climb') && !t.speeds?.[mode] ? 2 : 1;

/**
 * Coste en pies de una ruta (inicio + puntos). El terreno difícil se evalúa casilla a casilla en cada tramo, no solo en el destino.
 * ponytail: los pasos se muestrean sobre la línea recta del tramo; volar ignora el terreno difícil.
 */
export function routeCost(s: Scene, t: Token, pts: Point[], o: { diagonal?: Diagonal; mode?: MoveMode } = {}): { feet: number; legs: Leg[] } {
  const g = s.grid, mode = o.mode ?? 'walk', mul = modeMul(t, mode), lvl = flr(s, t.level);
  const hard = mode === 'fly' ? [] : (s.regions ?? []).filter((r) => r.kind === 'difficult' && flr(s, r.level) === lvl);
  let alt = 0;
  const legs: Leg[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = Math.abs(b.x - a.x) / g.size, dy = Math.abs(b.y - a.y) / g.size;
    const k = Math.ceil(Math.max(dx, dy) - 1e-6), diag = Math.round(Math.min(dx, dy));
    const w = k ? Math.max(dx, dy) / k : 0; // la última casilla puede ser fraccionaria
    let feet = 0, difficult = false;
    for (let j = 0; j < k; j++) {
      const m = { x: a.x + (b.x - a.x) * (j + .5) / k, y: a.y + (b.y - a.y) * (j + .5) / k };
      const isDiag = j < diag;
      const base = o.diagonal === 'euclid' ? Math.hypot(dx, dy) / k * g.feet : isDiag && o.diagonal === 'alt' ? (alt++ % 2 ? 2 : 1) * g.feet : g.feet;
      const h = hard.some((r) => inPoly(m, r.points));
      if (h) difficult = true;
      feet += base * w * (h ? 2 : 1) * mul;
    }
    legs.push({ from: a, to: b, feet, difficult });
  }
  return { feet: legs.reduce((n, l) => n + l.feet, 0), legs };
}

const DOWN = ['unconscious', 'dead', 'incapacitated', 'paralyzed', 'stunned', 'petrified'];
/** Alcance cuerpo a cuerpo en pies: la mayor `range` ≤ 10 de sus ataques (mínimo 5). */
export const reachOf = (f: Token) => Math.max(5, ...(f.actions ?? []).filter((a) => a.kind === 'attack' && a.range <= 10).map((a) => a.range));
const inReach = (s: Scene, f: Token, p: Point, size: number) =>
  Math.max(Math.abs(f.x - p.x), Math.abs(f.y - p.y)) / s.grid.size <= (f.size + size) / 2 - 1 + reachOf(f) / s.grid.feet + 1e-6;
export const hostile = (a: Token, b: Token) => (a.faction === 'ally' && b.faction === 'enemy') || (a.faction === 'enemy' && b.faction === 'ally');

/** Enemigos (de `foes`) cuyo alcance abandona la ruta, con el índice del tramo donde ocurre. Sin comprobar reacciones ni visibilidad: eso lo decide quien llama. */
export function opportunities(s: Scene, mover: Token, pts: Point[], foes: Token[]): { foe: Token; leg: number }[] {
  const out: { foe: Token; leg: number }[] = [];
  for (const f of foes) {
    if (f.id === mover.id || !hostile(mover, f) || f.conditions.some((c) => DOWN.includes(c))) continue;
    let was = inReach(s, f, pts[0], mover.size);
    let hit = -1;
    for (let i = 1; i < pts.length && hit < 0; i++) {
      const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (s.grid.size / 2)));
      for (let j = 1; j <= n; j++) {
        const now = inReach(s, f, { x: a.x + (b.x - a.x) * j / n, y: a.y + (b.y - a.y) * j / n }, mover.size);
        if (was && !now) { hit = i - 1; break; }
        was = now;
      }
    }
    if (hit >= 0) out.push({ foe: f, leg: hit });
  }
  return out;
}
