// Niebla a mano alzada: un trazo del ratón pasa a polígono simplificado.
import type { Point } from '@lantern/protocol';

const dseg = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

/** Douglas-Peucker: quita puntos que se desvían menos de `eps` de la recta entre sus vecinos. */
export function simplify(pts: Point[], eps: number): Point[] {
  if (pts.length < 3) return pts;
  let far = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = dseg(pts[i], pts[0], pts[pts.length - 1]); if (d > far) { far = d; at = i; } }
  if (far <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, at + 1), eps).slice(0, -1), ...simplify(pts.slice(at), eps)];
}

/**
 * Trazo → polígono de a lo sumo `max` vértices. Un lazo (extremos cerca) se rellena tal cual;
 * un trazo abierto se engrosa `half` px a cada lado. null si no llega a 3 vértices.
 */
export function brushPolygon(stroke: Point[], half: number, max = 60): Point[] | null {
  if (stroke.length < 2) return null;
  const first = stroke[0], last = stroke[stroke.length - 1];
  let eps = Math.max(1, half / 4), poly: Point[];
  const build = (e: number) => {
    const s = simplify(stroke, e);
    if (Math.hypot(first.x - last.x, first.y - last.y) <= half * 2) return s.length > 3 ? s.slice(0, -1) : s;
    const left: Point[] = [], right: Point[] = [];
    s.forEach((p, i) => { // normal media de los tramos vecinos
      const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / l * half, ny = (b.x - a.x) / l * half;
      left.push({ x: p.x + nx, y: p.y + ny }); right.push({ x: p.x - nx, y: p.y - ny });
    });
    return [...left, ...right.reverse()];
  };
  poly = build(eps);
  while (poly.length > max) { eps *= 1.5; poly = build(eps); }
  return poly.length >= 3 ? poly.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) : null;
}
