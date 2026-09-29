// Capa de edición (fase 5): herramientas del DM. Dibuja en `layer` y emite EditOp; no toca el estado del servidor.
import type { Container, FederatedPointerEvent, Graphics } from 'pixi.js';
import type { Id, Light, Point, Region, Scene, Wall } from '@lantern/protocol';
import type { EditOp, EditTool } from './api.ts';

export const REGION_COLOR: Record<Region['kind'], string> = {
  trap: '#F08A64', difficult: '#D3C3A6', teleport: '#C29CF5', fog: '#3a3129', darkness: '#000000', sound: '#8FD3F5', message: '#F5C877',
};
const WALL_COLOR: Record<Wall['kind'], string> = { wall: '#F5C877', door: '#5B9BE0', window: '#8FD3F5', terrain: '#7FCB8A' };

export function dashed(g: Graphics, a: Point, b: Point, dash: number, gap: number) {
  const len = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(d + dash, len);
    g.moveTo(a.x + ux * d, a.y + uy * d).lineTo(a.x + ux * e, a.y + uy * e);
  }
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function segDist(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}
function inside(p: Point, poly: Point[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    if ((poly[i].y > p.y) !== (poly[j].y > p.y) && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
  return c;
}
const mod = (v: number, m: number) => ((v % m) + m) % m;

type Kind = 'wall' | 'light' | 'region' | 'token';
type Drag =
  | { k: 'wall'; w: Wall; end: 'a' | 'b' } | { k: 'light'; l: Light } | { k: 'vert'; r: Region; i: number }
  | { k: 'newLight'; at: Point; r: number } | { k: 'grid'; a: Point; b: Point };

export function createEdit(world: Container, g: Graphics, scene: () => Scene | undefined, level: () => Id | undefined = () => undefined) {
  let tool: EditTool = { tool: 'none' }, cb: (op: EditOp) => void = () => {};
  let sel: { kind: Kind; id: string } | undefined, drag: Drag | undefined, moved = false;
  let last: Point | undefined, pts: Point[] = [], hover: Point | undefined, shift = false;
  const k = () => world.scale.x;
  const snap = (p: Point, on: boolean): Point => {
    const s = scene(); if (!on || !s) return p;
    const { size, offsetX, offsetY } = s.grid;
    return { x: offsetX + Math.round((p.x - offsetX) / size) * size, y: offsetY + Math.round((p.y - offsetY) / size) * size };
  };
  const select = (kind: Kind | null, id?: string) => {
    sel = kind && id ? { kind, id } : undefined;
    cb(kind ? { op: 'select', kind, id } : { op: 'select', kind: null });
  };
  const closeRegion = () => {
    if (tool.tool === 'region' && pts.length >= 3)
      cb({ op: 'upsert', kind: 'region', item: { id: crypto.randomUUID(), name: 'Región', points: pts, kind: tool.kind, hidden: tool.kind === 'trap', level: level() } });
    pts = [];
  };

  function down(e: FederatedPointerEvent): boolean {
    const s = scene(); if (!s || tool.tool === 'none') return false;
    const p = world.toLocal(e.global), tol = 10 / k(); moved = false; shift = e.shiftKey;
    switch (tool.tool) {
      case 'select': {
        for (const l of s.lights) if (dist(p, l) < tol * 1.4) { select('light', l.id); drag = { k: 'light', l }; return true; }
        for (const w of s.walls) for (const end of ['a', 'b'] as const)
          if (dist(p, w[end]) < tol) { select('wall', w.id); drag = { k: 'wall', w, end }; return true; }
        for (const r of s.regions ?? []) for (let i = 0; i < r.points.length; i++)
          if (dist(p, r.points[i]) < tol) { select('region', r.id); drag = { k: 'vert', r, i }; return true; }
        const w = s.walls.find((w) => segDist(p, w.a, w.b) < tol);
        if (w) { select('wall', w.id); return true; }
        const r = [...(s.regions ?? [])].reverse().find((r) => inside(p, r.points));
        if (r) { select('region', r.id); return true; }
        if (sel) select(null);
        return false; // suelo vacío: pan / clic normal
      }
      case 'wall': {
        const q = snap(p, !e.shiftKey);
        if (last && dist(last, q) < tol / 2) last = undefined; // clic sobre el último vértice = doble clic
        else {
          if (last) cb({ op: 'upsert', kind: 'wall', item: { id: crypto.randomUUID(), a: last, b: q, kind: tool.kind, level: level() } });
          last = q;
        }
        return true;
      }
      case 'light': drag = { k: 'newLight', at: p, r: 0 }; return true;
      case 'region': {
        const q = snap(p, e.shiftKey);
        if (pts.length && dist(pts[pts.length - 1], q) < tol / 2) closeRegion(); else pts.push(q);
        return true;
      }
      case 'grid': drag = { k: 'grid', a: p, b: p }; return true;
    }
  }
  function move(e: FederatedPointerEvent) {
    if (tool.tool === 'none') return;
    const p = world.toLocal(e.global); hover = p; shift = e.shiftKey;
    if (!drag) return;
    moved = true;
    if (drag.k === 'light') { drag.l.x = p.x; drag.l.y = p.y; }
    else if (drag.k === 'wall') drag.w[drag.end] = snap(p, !shift);
    else if (drag.k === 'vert') drag.r.points[drag.i] = snap(p, shift);
    else if (drag.k === 'newLight') drag.r = dist(drag.at, p);
    else drag.b = p;
  }
  function up() {
    const d = drag; drag = undefined;
    if (!d) return;
    if (d.k === 'light' && moved) cb({ op: 'upsert', kind: 'light', item: { ...d.l } });
    else if (d.k === 'wall' && moved) cb({ op: 'upsert', kind: 'wall', item: { ...d.w } });
    else if (d.k === 'vert' && moved) cb({ op: 'upsert', kind: 'region', item: { ...d.r, points: [...d.r.points] } });
    else if (d.k === 'newLight' && tool.tool === 'light') {
      const drew = d.r >= 8;
      cb({ op: 'upsert', kind: 'light', item: { id: crypto.randomUUID(), x: d.at.x, y: d.at.y, bright: drew ? d.r / 2 : tool.bright, dim: drew ? d.r : tool.dim, color: tool.color, level: level() } });
    } else if (d.k === 'grid') {
      const size = (Math.abs(d.b.x - d.a.x) + Math.abs(d.b.y - d.a.y)) / 4;
      if (size >= 8) cb({ op: 'grid', size, offsetX: mod(Math.min(d.a.x, d.b.x), size), offsetY: mod(Math.min(d.a.y, d.b.y), size) });
    }
  }
  function key(e: KeyboardEvent) {
    if (tool.tool === 'none' || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Escape') { last = undefined; pts = []; drag = undefined; }
    else if (e.key === 'Enter') closeRegion();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && tool.tool === 'select' && sel) {
      e.preventDefault(); cb({ op: 'remove', kind: sel.kind, id: sel.id }); sel = undefined;
    }
  }

  function draw() {
    g.clear();
    const s = scene(); if (!s || tool.tool === 'none') return;
    const u = 1 / k(), hl = (c: string) => ({ width: 8 * u, color: c, alpha: 0.5 });
    if (sel) {
      if (sel.kind === 'wall') { const w = s.walls.find((w) => w.id === sel!.id); if (w) g.moveTo(w.a.x, w.a.y).lineTo(w.b.x, w.b.y).stroke({ ...hl('#ffffff'), cap: 'round' }); }
      else if (sel.kind === 'light') { const l = s.lights.find((l) => l.id === sel!.id); if (l) g.circle(l.x, l.y, 12 * u).stroke(hl('#ffffff')); }
      else if (sel.kind === 'region') { const r = s.regions?.find((r) => r.id === sel!.id); if (r) g.poly(r.points.flatMap((q) => [q.x, q.y])).stroke(hl('#ffffff')); }
      else { const t = s.tokens.find((t) => t.id === sel!.id); if (t) g.circle(t.x, t.y, t.size * s.grid.size * 0.42 + 8).stroke(hl('#ffffff')); }
    }
    for (const r of s.regions ?? []) {
      const c = r.kind === 'darkness' ? '#888888' : REGION_COLOR[r.kind];
      for (const q of r.points) g.circle(q.x, q.y, 5 * u).fill(c).stroke({ width: u, color: 0x000000 });
    }
    for (const l of s.lights) {
      g.circle(l.x, l.y, l.dim).stroke({ width: 1.5 * u, color: l.color, alpha: 0.5 });
      g.circle(l.x, l.y, l.bright).stroke({ width: 1.5 * u, color: l.color, alpha: 0.9 });
      g.circle(l.x, l.y, 6 * u).fill(l.color).stroke({ width: u, color: 0x000000 });
    }
    const wallLine = (a: Point, b: Point, kind: Wall['kind']) => {
      const c = WALL_COLOR[kind];
      if (kind === 'window' || kind === 'terrain') dashed(g, a, b, 10 * u, 6 * u); else g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      g.stroke({ width: (kind === 'door' ? 6 : 3) * u, color: c, cap: 'round' });
    };
    for (const w of s.walls) {
      wallLine(w.a, w.b, w.kind);
      for (const q of [w.a, w.b]) g.circle(q.x, q.y, 5 * u).fill(WALL_COLOR[w.kind]).stroke({ width: u, color: 0x000000 });
    }
    // vistas previas
    if (tool.tool === 'wall' && last && hover) {
      const q = snap(hover, !shift);
      dashed(g, last, q, 8 * u, 6 * u); g.stroke({ width: 2 * u, color: WALL_COLOR[tool.kind] });
      g.circle(q.x, q.y, 4 * u).fill(WALL_COLOR[tool.kind]);
    } else if (tool.tool === 'region' && pts.length) {
      const q = hover ? snap(hover, shift) : pts[pts.length - 1];
      g.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.stroke({ width: 2 * u, color: REGION_COLOR[tool.kind] === '#000000' ? '#888888' : REGION_COLOR[tool.kind] });
      dashed(g, pts[pts.length - 1], q, 8 * u, 6 * u); g.stroke({ width: 2 * u, color: '#ffffff', alpha: 0.7 });
      for (const p of pts) g.circle(p.x, p.y, 4 * u).fill('#ffffff');
    } else if (drag?.k === 'newLight' && tool.tool === 'light') {
      g.circle(drag.at.x, drag.at.y, drag.r).stroke({ width: 2 * u, color: tool.color });
      g.circle(drag.at.x, drag.at.y, drag.r / 2).stroke({ width: 2 * u, color: tool.color, alpha: 0.7 });
    } else if (drag?.k === 'grid') {
      const size = (Math.abs(drag.b.x - drag.a.x) + Math.abs(drag.b.y - drag.a.y)) / 4;
      g.rect(Math.min(drag.a.x, drag.b.x), Math.min(drag.a.y, drag.b.y), Math.abs(drag.b.x - drag.a.x), Math.abs(drag.b.y - drag.a.y)).stroke({ width: 2 * u, color: '#E8A33D' });
      if (size >= 8) {
        const ox = mod(Math.min(drag.a.x, drag.b.x), size), oy = mod(Math.min(drag.a.y, drag.b.y), size);
        for (let x = ox; x <= s.width; x += size) g.moveTo(x, 0).lineTo(x, s.height);
        for (let y = oy; y <= s.height; y += size) g.moveTo(0, y).lineTo(s.width, y);
        g.stroke({ width: u, color: '#E8A33D', alpha: 0.6 });
      }
    }
  }

  return {
    down, move, up, key, draw,
    tool: () => tool.tool,
    pick: (kind: Kind, id: string) => select(kind, id),
    setTool(t: EditTool) { tool = t; last = undefined; pts = []; drag = undefined; sel = undefined; },
    onEdit(f: (op: EditOp) => void) { cb = f; },
  };
}
