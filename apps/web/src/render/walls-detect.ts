// Autodetección de muros (beta) sobre la imagen del mapa. Lógica pura sin DOM ni pixi (testeable en Node).
import type { Grid, Wall } from '@lantern/protocol';

export type DetectOpts = {
  samples?: number;    // puntos por arista (12)
  band?: number;       // semiancho de la franja transversal en px (3)
  ratio?: number;      // fracción mínima de muestras oscuras (0.7)
  pct?: number;        // percentil de luminancia para el umbral adaptativo (0.15)
  contrast?: number;   // diferencia mínima de luminancia (0-255) entre el interior vecino y la arista (24)
  width?: number; height?: number; // solo detectWalls: tamaño de mundo al que se reescala la imagen (por defecto el natural)
};

export function detectFromLuma(luma: Float32Array, w: number, h: number, grid: Grid, o: DetectOpts = {}): Wall[] {
  const N = o.samples ?? 12, B = o.band ?? 3, R = o.ratio ?? 0.7, C = o.contrast ?? 24, S = grid.size;
  // umbral adaptativo: percentil de una submuestra (≤ ~65k valores)
  const step = Math.max(1, Math.floor(luma.length / 65536));
  const sub: number[] = [];
  for (let i = 0; i < luma.length; i += step) sub.push(luma[i]);
  sub.sort((a, b) => a - b);
  const thr = sub[Math.floor((sub.length - 1) * (o.pct ?? 0.15))];
  const at = (x: number, y: number) => luma[Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))];
  const off = Math.max(B + 1, S / 4);
  // Arista de (x0,y0) a lo largo de (dx,dy) con longitud S; la normal es (-dy,dx).
  const isWall = (x0: number, y0: number, dx: number, dy: number) => {
    let dark = 0, edge = 0, sa = 0, sb = 0;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N * S, x = x0 + dx * t, y = y0 + dy * t;
      let m = 0;
      for (let k = -B; k <= B; k++) m += at(x - dy * k, y + dx * k);
      m /= 2 * B + 1; edge += m; if (m <= thr) dark++;
      sa += at(x - dy * off, y + dx * off); sb += at(x + dy * off, y - dx * off);
    }
    // ponytail: basta que UN lado sea claro (borde del mapa incluido); no distingue muro de simple sombra
    return dark / N >= R && Math.max(sa, sb) / N - edge / N >= C;
  };
  const walls: Wall[] = [];
  const x0 = grid.offsetX % S, y0 = grid.offsetY % S; // primera línea visible (puede haber media casilla a la izquierda/arriba)
  const gx = (i: number) => x0 + i * S, gy = (j: number) => y0 + j * S;
  const nx = Math.floor((w - x0) / S), ny = Math.floor((h - y0) / S);
  // horizontales: línea j, casillas i contiguas -> un segmento
  for (let j = 0; j <= ny; j++) for (let i = 0; i < nx;) {
    if (!isWall(gx(i), gy(j), 1, 0)) { i++; continue; }
    let e = i + 1; while (e < nx && isWall(gx(e), gy(j), 1, 0)) e++;
    walls.push({ id: `auto-${walls.length}`, a: { x: gx(i), y: gy(j) }, b: { x: gx(e), y: gy(j) }, kind: 'wall' }); i = e;
  }
  for (let i = 0; i <= nx; i++) for (let j = 0; j < ny;) {
    if (!isWall(gx(i), gy(j), 0, 1)) { j++; continue; }
    let e = j + 1; while (e < ny && isWall(gx(i), gy(e), 0, 1)) e++;
    walls.push({ id: `auto-${walls.length}`, a: { x: gx(i), y: gy(j) }, b: { x: gx(i), y: gy(e) }, kind: 'wall' }); j = e;
  }
  return walls;
}

export function detectWalls(img: HTMLImageElement | ImageBitmap, grid: Grid, o: DetectOpts = {}): Wall[] {
  const nat = img instanceof HTMLImageElement ? [img.naturalWidth, img.naturalHeight] : [img.width, img.height];
  const w = Math.round(o.width ?? nat[0]), h = Math.round(o.height ?? nat[1]);
  const cv = new OffscreenCanvas(w, h), cx = cv.getContext('2d', { willReadFrequently: true })!;
  cx.drawImage(img, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data, luma = new Float32Array(w * h);
  for (let i = 0; i < luma.length; i++) luma[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
  return detectFromLuma(luma, w, h, grid, o);
}
