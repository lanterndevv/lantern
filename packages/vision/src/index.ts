import { blocksSight, type Point, type Wall } from '@lantern/protocol';

export type Seg = [Point, Point];

// Rayo origen→dir contra segmento; devuelve t (distancia en unidades de dir) o Infinity.
function hit(o: Point, dx: number, dy: number, [a, b]: Seg): number {
  const sx = b.x - a.x, sy = b.y - a.y;
  const den = dx * sy - dy * sx;
  if (Math.abs(den) < 1e-12) return Infinity;
  const t = ((a.x - o.x) * sy - (a.y - o.y) * sx) / den;
  const u = ((a.x - o.x) * dy - (a.y - o.y) * dx) / den;
  return t >= 0 && u >= 0 && u <= 1 ? t : Infinity;
}

// Polígono de visibilidad desde `origin` dentro de un rectángulo w×h.
// ponytail: O(n²) (rayos × segmentos); basta para cientos de muros, barrido angular si hace falta más.
export function visibility(origin: Point, segs: Seg[], w: number, h: number): Point[] {
  const box: Seg[] = [
    [{ x: 0, y: 0 }, { x: w, y: 0 }], [{ x: w, y: 0 }, { x: w, y: h }],
    [{ x: w, y: h }, { x: 0, y: h }], [{ x: 0, y: h }, { x: 0, y: 0 }],
  ];
  const all = segs.concat(box);
  const angles: number[] = [];
  for (const [a, b] of all) for (const p of [a, b]) {
    const ang = Math.atan2(p.y - origin.y, p.x - origin.x);
    angles.push(ang - 1e-4, ang, ang + 1e-4);
  }
  angles.sort((p, q) => p - q);
  const poly: Point[] = [];
  for (const ang of angles) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let t = Infinity;
    for (const s of all) t = Math.min(t, hit(origin, dx, dy, s));
    if (t !== Infinity) poly.push({ x: origin.x + dx * t, y: origin.y + dy * t });
  }
  return poly;
}

export const sightSegments = (walls: Wall[]): Seg[] =>
  walls.filter(blocksSight).map((w) => [w.a, w.b]);

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Cobertura del objetivo (círculo de radio targetRadius) vista desde `from`: líneas al centro y a 4 esquinas.
// 0 libres → 0; 1–2 bloqueadas → 2 (media); 3–4 → 5 (tres cuartos); 5 → 'total'.
export function cover(from: Point, to: Point, targetRadius: number, segs: Seg[]): 0 | 2 | 5 | 'total' {
  const o = (a: Point, b: Point, c: Point) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const blocked = (p: Point) => segs.some(([a, b]) => o(from, p, a) * o(from, p, b) < 0 && o(a, b, from) * o(a, b, p) < 0);
  const r = targetRadius;
  const n = [{ x: to.x, y: to.y }, { x: to.x - r, y: to.y - r }, { x: to.x + r, y: to.y - r }, { x: to.x - r, y: to.y + r }, { x: to.x + r, y: to.y + r }].filter(blocked).length;
  return n === 0 ? 0 : n <= 2 ? 2 : n <= 4 ? 5 : 'total';
}
