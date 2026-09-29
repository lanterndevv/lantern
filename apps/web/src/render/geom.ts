// Geometría pura del renderer: cuadrícula hex (filas, pointy-top), distancias y recorte de luces en cono.
import type { Grid, Point } from '@lantern/protocol';

const S3 = Math.sqrt(3);
export const gridType = (g: Grid) => g.type ?? 'square';
// Hex 0,0 centrado en (offsetX + size/2, offsetY + R); R = radio circunscrito. Ancho de casilla = size.
const hexR = (g: Grid) => g.size / S3;
const origin = (g: Grid): Point => ({ x: g.offsetX + g.size / 2, y: g.offsetY + hexR(g) });
export const hexToPx = (g: Grid, q: number, r: number): Point => {
  const o = origin(g), R = hexR(g);
  return { x: o.x + R * S3 * (q + r / 2), y: o.y + R * 1.5 * r };
};
export function pxToHex(g: Grid, p: Point) {
  const o = origin(g), R = hexR(g), x = (p.x - o.x) / R, y = (p.y - o.y) / R;
  const fq = (S3 / 3) * x - y / 3, fr = (2 / 3) * y, fs = -fq - fr;
  let q = Math.round(fq), r = Math.round(fr), s = Math.round(fs);
  const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
  return { q, r };
}
export const hexCenter = (g: Grid, p: Point): Point => { const h = pxToHex(g, p); return hexToPx(g, h.q, h.r); };
/** Vértices (6) de la casilla hex de centro `c`. */
export const hexCorners = (g: Grid, c: Point): Point[] =>
  Array.from({ length: 6 }, (_, i) => ({ x: c.x + hexR(g) * Math.cos((Math.PI / 180) * (30 + 60 * i)), y: c.y + hexR(g) * Math.sin((Math.PI / 180) * (30 + 60 * i)) }));
/** Imán de muros/regiones: al vértice de casilla más cercano (cuadrada: intersección; hex: esquina del hexágono). Sin cuadrícula no ajusta. */
export function snapPoint(g: Grid, p: Point): Point {
  const t = gridType(g);
  if (t === 'none') return p;
  if (t === 'square') return { x: g.offsetX + Math.round((p.x - g.offsetX) / g.size) * g.size, y: g.offsetY + Math.round((p.y - g.offsetY) / g.size) * g.size };
  return hexCorners(g, hexCenter(g, p)).reduce((b, q) => (Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? q : b));
}
/**
 * Calibrado con un rectángulo arrastrado que abarca 2×2 casillas (cuadrada) o 2 casillas de ancho y 2 filas de alto (hex).
 * ponytail: en hex se asume que la esquina superior izquierda es la de una casilla; una fila impar desplaza el origen media casilla.
 */
export function calibrate(g: Grid, a: Point, b: Point): { size: number; offsetX: number; offsetY: number } {
  const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y), x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), mod = (v: number, m: number) => ((v % m) + m) % m;
  if (gridType(g) !== 'hex') { const size = (w + h) / 4; return { size, offsetX: mod(x0, size), offsetY: mod(y0, size) }; }
  const size = (w + h / (S3 / 2)) / 4, row = size * S3 / 2, oy = mod(y0, row), odd = Math.round((y0 - oy) / row) % 2 !== 0;
  return { size, offsetX: mod(x0 - (odd ? size / 2 : 0), size), offsetY: oy };
}

/** Distancia en casillas entre dos puntos: hex = distancia hex; cuadrada = 5-5-5 (Chebyshev); sin cuadrícula = euclídea. */
export function gridCells(g: Grid, a: Point, b: Point): number {
  const t = gridType(g);
  if (t === 'hex') {
    const A = pxToHex(g, a), B = pxToHex(g, b);
    return (Math.abs(A.q - B.q) + Math.abs(A.r - B.r) + Math.abs(A.q + A.r - B.q - B.r)) / 2;
  }
  if (t === 'none') return Math.hypot(a.x - b.x, a.y - b.y) / g.size;
  return Math.round(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / g.size);
}

// Recorta un polígono por el semiplano cross(u, p - o) * sgn >= 0 (Sutherland–Hodgman).
function clipHalf(poly: Point[], o: Point, u: Point, sgn: 1 | -1): Point[] {
  const f = (p: Point) => sgn * (u.x * (p.y - o.y) - u.y * (p.x - o.x));
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
  }
  return out;
}
/** Recorta un polígono de visión al cono (dir y apertura en grados). <180°: una pieza; ≥180°: unión de dos semiplanos. */
export function clipCone(poly: Point[], o: Point, dir: number, angle: number): Point[][] {
  if (angle >= 360) return [poly];
  const a1 = ((dir - angle / 2) * Math.PI) / 180, a2 = ((dir + angle / 2) * Math.PI) / 180;
  const u1 = { x: Math.cos(a1), y: Math.sin(a1) }, u2 = { x: Math.cos(a2), y: Math.sin(a2) };
  const h1 = clipHalf(poly, o, u1, 1), h2 = clipHalf(poly, o, u2, -1);
  const r = angle < 180 ? [clipHalf(h1, o, u2, -1)] : [h1, h2];
  return r.filter((p) => p.length > 2);
}

/** Rota el tono de un color '#rrggbb' (grados). */
export function hueShift(hex: string, deg: number): number {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const a = (deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  const m = [
    0.213 + co * 0.787 - si * 0.213, 0.715 - co * 0.715 - si * 0.715, 0.072 - co * 0.072 + si * 0.928,
    0.213 - co * 0.213 + si * 0.143, 0.715 + co * 0.285 + si * 0.140, 0.072 - co * 0.072 - si * 0.283,
    0.213 - co * 0.213 - si * 0.787, 0.715 - co * 0.715 + si * 0.715, 0.072 + co * 0.928 + si * 0.072,
  ];
  const ch = (i: number) => Math.max(0, Math.min(255, Math.round(m[i * 3] * c[0] + m[i * 3 + 1] * c[1] + m[i * 3 + 2] * c[2])));
  return (ch(0) << 16) | (ch(1) << 8) | ch(2);
}
