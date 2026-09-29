// Plantillas de área (funciones puras). Coordenadas en px de mapa; tamaños en pies; grid = {size px por casilla, feet por casilla}.
export type AreaShape = 'sphere' | 'cone' | 'line' | 'cube';
type P = { x: number; y: number };

/**
 * ¿Está `point` dentro de la plantilla?
 * - sphere: radio `sizeFeet` alrededor de `origin` (`dir` se ignora).
 * - cube: lado `sizeFeet`, con `origin` en una esquina y extendiéndose hacia el cuadrante de `dir`.
 * - cone: 53°, longitud `sizeFeet`, desde `origin` hacia `dir`.
 * - line: 5 pies de ancho y `sizeFeet` de largo, desde `origin` hacia `dir`.
 * ponytail: distancias euclídeas (no la regla 5-5-5); el cubo va alineado a los ejes.
 */
export function inArea(shape: AreaShape, origin: P, dir: P, sizeFeet: number, grid: { size: number; feet: number }, point: P): boolean {
  const k = grid.feet / grid.size; // px → pies
  const px = (point.x - origin.x) * k, py = (point.y - origin.y) * k;
  const dx = (dir.x - origin.x) * k, dy = (dir.y - origin.y) * k;
  const eps = 1e-6;
  if (shape === 'sphere') return Math.hypot(px, py) <= sizeFeet + eps;
  if (shape === 'cube') {
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    return px * sx >= -eps && px * sx <= sizeFeet + eps && py * sy >= -eps && py * sy <= sizeFeet + eps;
  }
  const len = Math.hypot(dx, dy);
  if (len === 0) return false; // sin dirección no hay cono ni línea
  const along = (px * dx + py * dy) / len, across = Math.abs(px * dy - py * dx) / len;
  if (along < -eps || along > sizeFeet + eps) return false;
  if (shape === 'line') return across <= 2.5 + eps;
  return across <= along * Math.tan((53 / 2) * Math.PI / 180) + eps; // cone: semiángulo 26,5°
}
