// Renderer Pixi v8: «mesa a la luz de una linterna». Implementa CreateTable (api.ts).
import {
  Application, Assets, BlurFilter, ColorMatrixFilter, Container, Circle, Graphics, Polygon, Rectangle, RenderTexture, Sprite, Text, Texture, TilingSprite,
} from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { sightSegments, visibility } from '@lantern/vision';
import type { ClientState, Id, Light, Point, Scene, Token, Wall } from '@lantern/protocol';
import type { CreateTable, Marks } from './api.ts';
import { createVfx, LITE } from './vfx.ts';
import { createEdit, dashed, REGION_COLOR } from './edit.ts';

const FACTION = { ally: '#5B9BE0', enemy: '#E0643A', neutral: '#BFAE86' };
const HP = { ok: '#7cc47f', bad: '#d9503a' }; // PG alto / PG bajo
// Daltonismo: --aliado, --enemigo, --exito y --peligro del documento (con fallback a los actuales). Muta FACTION y HP.
function readPalette() {
  const cs = getComputedStyle(document.documentElement), v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  FACTION.ally = v('--aliado', '#5B9BE0'); FACTION.enemy = v('--enemigo', '#E0643A');
  HP.ok = v('--exito', '#7cc47f'); HP.bad = v('--peligro', '#d9503a');
}
const paletteKey = () => FACTION.ally + FACTION.enemy + HP.ok + HP.bad;
const MINE = '#F5C877', AMBER = '#E8A33D', TEXT = '#F2E8DA', SERIF = 'Georgia, "Times New Roman", serif';
// Condición -> [letra(s), color]: el color nunca es la única pista, cada una lleva su letra.
const COND: Record<string, [string, string]> = {
  poisoned: ['Ev', '#6FCB7C'], prone: ['D', '#B8AEA2'], frightened: ['As', '#C29CF5'], stunned: ['At', '#F2E45A'],
  invisible: ['I', '#8FD3F5'], grappled: ['Ag', '#D3C3A6'], charmed: ['H', '#EE8CCB'], paralyzed: ['Pa', '#F2E45A'],
  restrained: ['Ap', '#D3C3A6'], blinded: ['C', '#9A8A74'], deafened: ['Se', '#9A8A74'], incapacitated: ['In', '#F08A64'],
  petrified: ['Pe', '#B8AEA2'], unconscious: ['Z', '#6f6353'],
};
const flat = (p: Point[]) => p.flatMap((q) => [q.x, q.y]);

// Suelo de losas: se genera UNA vez a un canvas y se repite.
function stoneTexture(): Texture {
  const N = 4, T = 64, c = document.createElement('canvas');
  c.width = c.height = N * T;
  const x = c.getContext('2d')!;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const k = Math.random(), lo = [0x4a, 0x3c, 0x2f], hi = [0x70, 0x5c, 0x49];
    x.fillStyle = `rgb(${lo.map((v, n) => Math.round(v + (hi[n] - v) * k)).join(',')})`;
    x.fillRect(i * T, j * T, T, T);
    x.fillStyle = 'rgba(0,0,0,0.08)'; // veteado barato
    for (let n = 0; n < 6; n++) x.fillRect(i * T + Math.random() * T, j * T + Math.random() * T, 10 + Math.random() * 20, 2);
  }
  x.strokeStyle = 'rgba(12,8,5,0.85)'; x.lineWidth = 3;
  for (let i = 0; i <= N; i++) {
    x.beginPath(); x.moveTo(i * T, 0); x.lineTo(i * T, N * T); x.moveTo(0, i * T); x.lineTo(N * T, i * T); x.stroke();
  }
  return Texture.from(c);
}

// Degradado radial blanco: pleno hasta `r` (= bright/dim) y se desvanece hasta 1.
const grads = new Map<number, Texture>();
function gradTexture(r: number): Texture {
  r = Math.round(Math.min(0.95, Math.max(0, r)) * 20) / 20;
  let t = grads.get(r);
  if (!t) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d')!, g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(r, 'rgba(255,255,255,1)');
    g.addColorStop(r + (1 - r) * 0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    grads.set(r, t = Texture.from(c));
  }
  return t;
}

type LightObj = { key: string; lm: Container; lmMask: Graphics; gl: Container; glMask: Graphics; spr: Sprite[]; phase: number; base: number; anim?: Light['anim'] };

export const createTable: CreateTable = async (el, opts) => {
  readPalette();
  const app = new Application();
  if (import.meta.env.DEV) (globalThis as unknown as { __pixi: unknown }).__pixi = app; // pruebas E2E
  await app.init({ background: '#070504', resizeTo: el, antialias: true, resolution: devicePixelRatio, autoDensity: true });
  el.appendChild(app.canvas);
  const stage = app.stage;
  stage.eventMode = 'static';
  stage.hitArea = new Rectangle(-1e7, -1e7, 2e7, 2e7);
  const world = new Container();
  stage.addChild(world);
  const floorL = new Container(), gridG = new Graphics(), wallsG = new Graphics(), doorsL = new Container(),
    tokensL = new Container(), fxL = new Container(), glowL = new Container(), marksG = new Graphics(), uiL = new Container(),
    regionsL = new Container(), fogRegG = new Graphics(), editG = new Graphics();
  const lightSprite = new Sprite(), fogSprite = new Sprite();
  lightSprite.blendMode = 'multiply';
  glowL.blendMode = 'add';
  fogRegG.filters = [new BlurFilter({ strength: 6, quality: 2 })]; // fog de región: negro opaco con bordes suaves
  world.addChild(floorL, gridG, regionsL, wallsG, doorsL, tokensL, fxL, lightSprite, glowL, fogSprite, fogRegG, marksG, editG, uiL);
  // El stage es interactivo y Pixi hereda ese modo a todos sus hijos al buscar el objetivo: sin esto, las capas que cubren
  // el mapa por encima de los tokens (luz, niebla, efectos, marcas) «ganan» el hit test y ningún token recibe clics.
  for (const l of [fxL, lightSprite, glowL, fogSprite, fogRegG, marksG, editG, uiL]) l.eventMode = 'none';
  const stone = stoneTexture();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const vfx = createVfx(app, world, fxL, reduced);
  const edit = createEdit(world, editG, () => cur?.scene);

  // ---- estado ----
  let cur: ClientState | undefined;
  let sceneId = '', bgToken = 0;
  let lit = true, gridKey = '', wallsKey = '', lightsKey = '', visKey = '';
  const isDM = () => opts.role === 'dm' || opts.role === 'assistant';
  const tokens = new Map<Id, { c: Container; key: string; t: Token; fx?: Fx }>();
  const doors = new Map<Id, { g: Graphics; key: string; hover: boolean }>();
  const lights = new Map<Id, LightObj>();
  const polyCache = new Map<Id, { key: string; poly: Point[] }>();

  // ---- pan / zoom ----
  let space = false, pan: { x: number; y: number } | undefined;
  const fit = (s: Scene) => {
    const k = Math.min(4, Math.max(0.25, Math.min(app.screen.width / s.width, app.screen.height / s.height) * 0.95));
    world.scale.set(k);
    world.position.set((app.screen.width - s.width * k) / 2, (app.screen.height - s.height * k) / 2);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (fixed) return;
    cam = undefined;
    const r = app.canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const k0 = world.scale.x, k = Math.min(4, Math.max(0.25, k0 * Math.exp(-e.deltaY * 0.0015)));
    world.position.set(mx - ((mx - world.x) / k0) * k, my - ((my - world.y) / k0) * k);
    world.scale.set(k);
  };
  const key = (down: boolean) => (e: KeyboardEvent) => {
    if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
      space = down; if (down) e.preventDefault();
    }
  };
  const kd = key(true), ku = key(false);
  // ---- táctil / cámara animada / modo fijo ----
  let fixed = false, cam: { t0: number; k0: number; x0: number; y0: number; k1: number; x1: number; y1: number } | undefined;
  const coarse = matchMedia('(pointer: coarse)').matches;
  let touchy = coarse; // se activa también con el primer toque real
  const MIN_HIT = 22; // px de pantalla: 44 de diámetro
  const clampK = (k: number) => Math.min(4, Math.max(0.25, k));
  const camTo = (k: number, x: number, y: number) => {
    if (reduced) { cam = undefined; world.scale.set(k); world.position.set(x, y); return; }
    cam = { t0: performance.now(), k0: world.scale.x, x0: world.x, y0: world.y, k1: k, x1: x, y1: y };
  };
  const focus = (x: number, y: number, zoom?: number) => {
    const k = clampK(zoom ?? world.scale.x);
    camTo(k, app.screen.width / 2 - x * k, app.screen.height / 2 - y * k);
  };
  const fitScene = () => {
    const s = cur?.scene; if (!s) return;
    const k = clampK(Math.min(app.screen.width / s.width, app.screen.height / s.height) * 0.95);
    camTo(k, (app.screen.width - s.width * k) / 2, (app.screen.height - s.height * k) / 2);
  };
  const worldToClient = (x: number, y: number) => {
    const r = app.canvas.getBoundingClientRect(), k = world.scale.x;
    return { x: r.left + world.x + x * k, y: r.top + world.y + y * k };
  };
  app.canvas.style.touchAction = 'none';
  app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const touches = new Map<number, Point>(); // pointerId -> posición local al canvas
  let pinching = false, pv = { cx: 0, cy: 0, d: 1 };
  const pinchNow = () => {
    const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d };
  };
  const loc = (e: PointerEvent): Point => { const r = app.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const tDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touchy = true; touches.set(e.pointerId, loc(e));
    if (touches.size < 2) return;
    pinching = true; cam = undefined; pan = undefined; press = undefined; cancelLong();
    if (drag) { drag.c.position.set(drag.from.x, drag.from.y); endDrag(false); }
    pv = pinchNow();
  };
  const tMove = (e: PointerEvent) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, loc(e));
    if (!pinching || touches.size < 2 || fixed) return;
    const n = pinchNow(), k0 = world.scale.x, k = clampK(k0 * n.d / pv.d);
    world.position.set(n.cx - ((pv.cx - world.x) / k0) * k, n.cy - ((pv.cy - world.y) / k0) * k);
    world.scale.set(k); pv = n;
  };
  const tUp = (e: PointerEvent) => {
    if (!touches.delete(e.pointerId)) return;
    if (touches.size >= 2) pv = pinchNow();
    if (!touches.size) pinching = false; // el dedo que queda no hace pan hasta levantar todos
  };
  // pulsación larga sobre token (táctil)
  let lp: { timer: number; x: number; y: number } | undefined;
  const cancelLong = () => { if (lp) clearTimeout(lp.timer); lp = undefined; };
  app.canvas.addEventListener('pointerdown', tDown); app.canvas.addEventListener('pointermove', tMove);
  app.canvas.addEventListener('pointerup', tUp); app.canvas.addEventListener('pointercancel', tUp);
  app.canvas.addEventListener('wheel', onWheel, { passive: false });
  const ek = (e: KeyboardEvent) => edit.key(e);
  addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('keydown', ek);
  const onA11y = () => { readPalette(); if (cur) syncTokens(cur.scene); };
  addEventListener('lantern:a11y', onA11y);

  // ---- ping / regla ----
  const pings: { g: Graphics; t0: number }[] = [];
  const ping = (x: number, y: number, color: string) => {
    const g = new Graphics(); g.position.set(x, y); uiL.addChild(g);
    pings.push({ g, t0: performance.now() });
    g.tint = color; // el anillo se dibuja en blanco y se tiñe
  };
  const ruler = new Graphics(), rulerTxt = new Text({ text: '', style: { fontFamily: SERIF, fontSize: 16, fill: AMBER, stroke: { color: '#000', width: 4 } } });
  rulerTxt.anchor.set(0.5, 1); ruler.visible = rulerTxt.visible = false;
  uiL.addChild(ruler, rulerTxt);

  // ---- marcas y texto flotante ----
  let marks: Marks = { targets: [] };
  const setMarks = (m: Marks) => { marks = m; };
  const tokR = (t: Token) => (t.size * (cur?.scene.grid.size ?? 70) * 0.84) / 2;
  const floats: { id: Id; t: Text; t0: number; y0: number }[] = [];
  function floatText(id: Id, text: string, color: string) {
    const o = tokens.get(id);
    if (!o) return;
    const n = floats.filter((f) => f.id === id).length; // apila con desplazamiento
    const t = new Text({ text, style: { fontFamily: SERIF, fontSize: 30, fontWeight: 'bold', fill: color, stroke: { color: '#1a0f08', width: 6 } } });
    t.anchor.set(0.5, 1);
    const y0 = o.c.y - tokR(o.t) - n * 30;
    t.position.set(o.c.x + (n % 2 ? 14 : 0), y0);
    uiL.addChild(t); floats.push({ id, t, t0: performance.now(), y0 });
  }
  function drawMarks(now: number) {
    const g = marksG.clear(), m = marks, s = now / 1000;
    if (m.area) g.circle(m.area.x, m.area.y, m.area.radius).fill({ color: m.area.color, alpha: 0.18 }).stroke({ width: 2, color: m.area.color });
    const at = (id?: Id) => { const o = id ? tokens.get(id) : undefined; return o && { x: o.c.x, y: o.c.y, r: tokR(o.t) }; };
    const a = at(m.active);
    if (a) g.circle(a.x, a.y, a.r + 8).stroke({ width: 6, color: AMBER, alpha: reduced ? 0.75 : 0.55 + 0.35 * Math.sin(s * 4) });
    const sel = at(m.selected);
    if (sel) g.circle(sel.x, sel.y, sel.r + 4).stroke({ width: 2, color: 0xffd27a });
    for (const id of m.targets) {
      const q = at(id); if (!q) continue;
      const R = q.r + 14, a0 = reduced ? 0 : s * 0.6; // cuatro arcos que giran despacio
      for (let i = 0; i < 4; i++) {
        const b = a0 + (i * Math.PI) / 2;
        g.moveTo(q.x + R * Math.cos(b), q.y + R * Math.sin(b)).arc(q.x, q.y, R, b, b + 0.7);
      }
      g.stroke({ width: 3, color: FACTION.enemy });
    }
  }

  // ---- suelo / cuadrícula ----
  async function buildFloor(s: Scene) {
    const my = ++bgToken;
    floorL.removeChildren().forEach((c) => c.destroy());
    if (s.background) {
      try {
        const tex = await Assets.load<Texture>(s.background);
        if (my !== bgToken) return;
        const sp = new Sprite(tex); sp.width = s.width; sp.height = s.height; floorL.addChild(sp);
        return;
      } catch { /* ponytail: si la imagen falla cae al suelo procedural */ }
    }
    if (my === bgToken) floorL.addChild(new TilingSprite({ texture: stone, width: s.width, height: s.height }));
  }
  function drawGrid(s: Scene) {
    const { size, offsetX, offsetY } = s.grid;
    gridG.clear();
    for (let x = offsetX % size; x <= s.width; x += size) gridG.moveTo(x, 0).lineTo(x, s.height);
    for (let y = offsetY % size; y <= s.height; y += size) gridG.moveTo(0, y).lineTo(s.width, y);
    gridG.stroke({ width: 1, color: 0x000000, alpha: 0.3 });
  }

  // ---- muros / puertas ----
  function drawWalls(walls: Wall[]) {
    wallsG.clear();
    const solid = walls.filter((w) => w.kind === 'wall' || w.kind === 'terrain');
    for (const w of solid) wallsG.moveTo(w.a.x, w.a.y).lineTo(w.b.x, w.b.y);
    wallsG.stroke({ width: 10, color: 0x9a8670, alpha: 0.35, cap: 'round' }); // borde claro sutil
    for (const w of solid) wallsG.moveTo(w.a.x, w.a.y).lineTo(w.b.x, w.b.y);
    wallsG.stroke({ width: 8, color: 0x0b0806, cap: 'round' });
    if (isDM()) {
      for (const w of walls) if (w.kind === 'window') dashed(wallsG, w.a, w.b, 10, 6);
      wallsG.stroke({ width: 3, color: 0x8fd3f5 });
    }
  }
  const doorHw = () => (touchy ? Math.max(12, MIN_HIT / world.scale.x) : 12);
  function drawDoor(g: Graphics, w: Wall, hover: boolean) {
    g.clear();
    const col = hover ? 0xa87445 : 0x7a5230;
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
    // abierta: girada 80° alrededor de `a` y más fina
    const b = w.open ? { x: w.a.x - dy * 0.98 + dx * 0.17, y: w.a.y + dx * 0.98 + dy * 0.17 } : w.b;
    g.moveTo(w.a.x, w.a.y).lineTo(b.x, b.y).stroke({ width: (w.open ? 4 : 8) + 3, color: 0x0b0806, cap: 'round' });
    g.moveTo(w.a.x, w.a.y).lineTo(b.x, b.y).stroke({ width: w.open ? 4 : 8, color: col, cap: 'round', alpha: w.open ? 0.85 : 1 });
    const L = Math.hypot(dx, dy) || 1, hw = doorHw(), nx = (-dy / L) * hw, ny = (dx / L) * hw; // zona pulsable siempre sobre a-b
    g.hitArea = new Polygon([w.a.x + nx, w.a.y + ny, w.b.x + nx, w.b.y + ny, w.b.x - nx, w.b.y - ny, w.a.x - nx, w.a.y - ny]);
  }
  function syncDoors(walls: Wall[]) {
    const ds = walls.filter((w) => w.kind === 'door' && (isDM() || !w.secret));
    const ids = new Set(ds.map((w) => w.id));
    for (const [id, d] of doors) if (!ids.has(id)) { d.g.destroy(); doors.delete(id); }
    for (const w of ds) {
      let d = doors.get(w.id);
      if (!d) {
        const g = new Graphics(); g.eventMode = 'static'; g.cursor = 'pointer';
        d = { g, key: '', hover: false };
        const dd = d;
        g.on('pointerover', () => { dd.hover = true; dd.key = ''; if (cur) syncDoors(cur.scene.walls); });
        g.on('pointerout', () => { dd.hover = false; dd.key = ''; if (cur) syncDoors(cur.scene.walls); });
        g.on('pointerdown', (e) => {
          if (e.button !== 0 || e.altKey || space || edit.tool() !== 'none') return; // en edición el clic llega al stage
          e.stopPropagation();
          const cw = cur?.scene.walls.find((x) => x.id === w.id);
          if (cw) opts.onDoor(w.id, !cw.open);
        });
        doorsL.addChild(g); doors.set(w.id, d);
      }
      const k = `${w.a.x},${w.a.y},${w.b.x},${w.b.y},${w.open},${d.hover},${doorHw()}`;
      if (k !== d.key) { d.key = k; drawDoor(d.g, w, d.hover); }
    }
  }

  // ---- regiones ----
  let regKey = '';
  function drawRegions(s: Scene) {
    regionsL.removeChildren().forEach((c) => c.destroy({ children: true }));
    fogRegG.clear();
    const dm = isDM(), rs = (s.regions ?? []).filter((r) => r.points.length > 2);
    fogRegG.visible = false;
    for (const r of rs) {
      const col = REGION_COLOR[r.kind], pf = flat(r.points), c = new Container();
      if (!dm && r.kind === 'fog') { fogRegG.poly(pf).fill(0x000000); fogRegG.visible = true; continue; }
      const border = new Graphics();
      r.points.forEach((p, i) => dashed(border, p, r.points[(i + 1) % r.points.length], 10, 6));
      border.stroke({ width: dm ? 2 : 1.5, color: col === '#000000' ? '#888888' : col, alpha: dm ? 0.9 : 0.35 });
      if (dm) {
        const xs = r.points.map((p) => p.x), ys = r.points.map((p) => p.y);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const fill = new Graphics().poly(pf).fill({ color: col, alpha: 0.16 });
        const hatch = new Graphics(), mask = new Graphics().poly(pf).fill(0xffffff);
        for (let x = x0 - (y1 - y0); x < x1; x += 14) hatch.moveTo(x, y1).lineTo(x + (y1 - y0), y0);
        hatch.stroke({ width: 2, color: col === '#000000' ? '#888888' : col, alpha: 0.35 });
        hatch.mask = mask;
        const lab = new Text({ text: r.name, style: { fontFamily: SERIF, fontSize: 14, fill: TEXT, stroke: { color: '#000', width: 3 } } });
        lab.anchor.set(0.5); lab.position.set((x0 + x1) / 2, (y0 + y1) / 2);
        c.addChild(fill, hatch, mask, lab);
      }
      c.addChild(border); regionsL.addChild(c);
    }
  }

  // ---- tokens ----
  const canDrag = (t: Token) => !fixed && (isDM() || (opts.role === 'trusted' && t.faction === 'ally') || (opts.role === 'player' && t.owners.includes(opts.memberId)));
  const snap = (t: Token, g: Scene['grid'], p: Point): Point => {
    const f = (v: number, o: number) => (t.size % 2 ? o + (Math.floor((v - o) / g.size) + 0.5) * g.size : o + Math.round((v - o) / g.size) * g.size);
    return { x: f(p.x, g.offsetX), y: f(p.y, g.offsetY) };
  };
  type Fx = { main: Container; ring?: Graphics; wob?: boolean; phase: number };
  const statusKey = (t: Token) =>
    `${t.conditions.join()}|${JSON.stringify(t.condRounds)}|${t.exhaustion}|${t.concentration}|${JSON.stringify(t.deathSaves)}`;
  function drawToken(c: Container, t: Token, g: Scene['grid']): Fx {
    c.removeChildren().forEach((x) => x.destroy({ children: true }));
    const r = (t.size * g.size * 0.84) / 2, mine = t.owners.includes(opts.memberId);
    const has = (id: string) => t.conditions.includes(id), dead = has('dead'), ko = has('unconscious') || !!t.deathSaves;
    const main = new Container(), fx: Fx = { main, phase: Math.random() * 10 };
    const body = new Graphics();
    body.circle(0, 0, r).fill('#1a1410'); // ponytail: degradado = 3 discos concéntricos, no FillGradient
    body.circle(-r * 0.15, -r * 0.15, r * 0.75).fill({ color: '#3a2d22', alpha: 0.7 });
    body.circle(-r * 0.25, -r * 0.25, r * 0.4).fill({ color: '#5a4636', alpha: 0.5 });
    body.circle(0, 0, r).stroke({ width: 3, color: mine ? MINE : FACTION[t.faction], alignment: 1 });
    main.addChild(body);
    if (t.hp && t.hp.max > 0) {
      const k = Math.max(0, Math.min(1, t.hp.cur / t.hp.max)), a0 = -Math.PI / 2;
      const arc = new Graphics();
      arc.circle(0, 0, r + 6).stroke({ width: 3, color: 0x000000, alpha: 0.5 });
      if (k > 0) arc.arc(0, 0, r + 6, a0, a0 + Math.PI * 2 * k).stroke({ width: 3, color: k > 0.5 ? HP.ok : k > 0.25 ? AMBER : HP.bad });
      main.addChild(arc);
    }
    const ini = new Text({ text: [...t.name][0]?.toUpperCase() ?? '?', style: { fontFamily: SERIF, fontSize: r * 1.1, fontWeight: 'bold', fill: TEXT } });
    ini.anchor.set(0.5); main.addChild(ini);
    if (has('poisoned')) main.tint = 0xb4e8b4;
    if (has('petrified') || dead) main.filters = [new ColorMatrixFilter()], (main.filters[0] as ColorMatrixFilter).desaturate();
    else if (ko) (main.filters = [new ColorMatrixFilter()], (main.filters[0] as ColorMatrixFilter).saturate(-0.75));
    // cruz (inconsciente) o X (muerto), dibujadas
    if (dead || ko) {
      const m = dead ? r * 0.6 : r * 0.35, x = new Graphics();
      if (dead) x.moveTo(-m, -m).lineTo(m, m).moveTo(m, -m).lineTo(-m, m).stroke({ width: 5, color: 0xd9503a, cap: 'round' });
      else x.moveTo(0, -m).lineTo(0, m).moveTo(-m * 0.7, -m * 0.3).lineTo(m * 0.7, -m * 0.3).stroke({ width: 4, color: 0xe6dccb, cap: 'round' });
      main.addChild(x);
    }
    if (t.concentration) {
      const ring = new Graphics(); // arcos ámbar sobre el borde; gira en el ticker
      for (let i = 0; i < 6; i++) ring.moveTo((r + 11) * Math.cos(i * 1.047), (r + 11) * Math.sin(i * 1.047)).arc(0, 0, r + 11, i * 1.047, i * 1.047 + 0.75);
      ring.stroke({ width: 1.5, color: AMBER });
      c.addChild(ring); fx.ring = ring;
    }
    fx.wob = has('invisible');
    c.addChild(main);
    // iconos: hasta 4 y «+N», en fila sobre el token
    const conds = t.conditions.filter((id) => COND[id]);
    const shown = conds.slice(0, 4), n = shown.length + (conds.length > 4 ? 1 : 0), y = -r - 20;
    const small = (s: string, fill: string, size = 9) => {
      const x = new Text({ text: s, style: { fontFamily: SERIF, fontSize: size, fontWeight: 'bold', fill, stroke: size < 9 ? { color: '#000', width: 2 } : undefined } });
      x.anchor.set(0.5); return x;
    };
    for (let i = 0; i < n; i++) {
      const cx = (i - (n - 1) / 2) * 17, id = shown[i], d = new Graphics();
      d.circle(cx, y, 7.5).fill(id ? COND[id][1] : '#3a2d22').stroke({ width: 1, color: 0x000000 });
      const l = small(id ? COND[id][0] : `+${conds.length - 4}`, id ? '#141008' : TEXT);
      l.position.set(cx, y); c.addChild(d, l);
      const rd = id && t.condRounds?.[id];
      if (rd) { const q = small(String(rd), '#fff', 8); q.position.set(cx + 7, y + 7); c.addChild(q); }
    }
    if (t.exhaustion) {
      const e = small(`A${t.exhaustion}`, '#141008'), bx = -r * 0.7, by = r * 0.7;
      c.addChild(new Graphics().roundRect(bx - 10, by - 7, 20, 14, 4).fill(AMBER).stroke({ width: 1, color: 0x000000 }));
      e.position.set(bx, by); c.addChild(e);
    }
    const lab = new Text({ text: t.name, style: { fontFamily: SERIF, fontSize: 13, fill: TEXT, stroke: { color: '#000', width: 3 } } });
    lab.anchor.set(0.5, 0); lab.y = r + 10; c.addChild(lab);
    if (t.deathSaves) { // 3 éxitos (verdes) + 3 fallos (rojos) bajo el nombre
      const ds = new Graphics(), y2 = r + 32;
      for (let i = 0; i < 6; i++) {
        const ok = i < 3, on = ok ? i < t.deathSaves.successes : i - 3 < t.deathSaves.failures, x = (i - 2.5) * 11 + (ok ? -3 : 3);
        ds.circle(x, y2, 4).fill({ color: ok ? 0x6fcb7c : 0xd9503a, alpha: on ? 1 : 0.15 }).stroke({ width: 1, color: ok ? 0x6fcb7c : 0xd9503a });
      }
      c.addChild(ds);
    }
    return fx;
  }

  let press: { id?: Id; x: number; y: number; wx: number; wy: number } | undefined; // pulsación candidata a clic
  let drag: { id: Id; c: Container; from: Point; off: Point; to: Point } | undefined;
  function syncTokens(s: Scene) {
    const ids = new Set(s.tokens.map((t) => t.id));
    for (const [id, o] of tokens) if (!ids.has(id)) { o.c.destroy({ children: true }); tokens.delete(id); if (drag?.id === id) endDrag(false); }
    for (const t of s.tokens) {
      let o = tokens.get(t.id);
      if (!o) {
        const c = new Container();
        c.on('pointerdown', (e) => {
          if (e.button === 2 && cur) { e.stopPropagation(); opts.onTokenContext?.(t.id, e.clientX, e.clientY); return; }
          if (e.button !== 0 || e.altKey || space || !cur) return;
          const et = edit.tool();
          if (et !== 'none' && et !== 'select') return; // wall/light/region/grid: el token no se arrastra, el clic llega al stage
          if (et === 'select') edit.pick('token', t.id);
          e.stopPropagation();
          const t2 = tokens.get(t.id)!.t, p = world.toLocal(e.global);
          press = { id: t.id, x: e.global.x, y: e.global.y, wx: p.x, wy: p.y };
          cancelLong();
          if (e.pointerType === 'touch' && !pinching && opts.onTokenContext) {
            const cx = e.clientX, cy = e.clientY;
            lp = { x: e.global.x, y: e.global.y, timer: window.setTimeout(() => {
              lp = undefined; press = undefined;
              if (drag) { drag.c.position.set(drag.from.x, drag.from.y); endDrag(false); }
              navigator.vibrate?.(30);
              opts.onTokenContext?.(t.id, cx, cy);
            }, 500) };
          }
          if (!canDrag(t2)) return;
          drag = { id: t.id, c, from: { x: t2.x, y: t2.y }, off: { x: t2.x - p.x, y: t2.y - p.y }, to: { x: t2.x, y: t2.y } };
          c.zIndex = 1e6; tokensL.sortableChildren = true;
        });
        tokensL.addChild(c);
        o = { c, key: '', t };
        tokens.set(t.id, o);
      }
      o.t = t;
      const k = `${t.name}|${t.faction}|${t.size}|${t.owners.includes(opts.memberId)}|${t.hp?.cur}/${t.hp?.max}|${s.grid.size}|${statusKey(t)}|${paletteKey()}`;
      if (k !== o.key) { o.key = k; o.fx = drawToken(o.c, t, s.grid); }
      o.c.eventMode = 'static'; // también los no movibles: reciben clic
      o.c.cursor = canDrag(t) ? 'grab' : 'pointer';
      o.c.alpha = t.conditions.includes('dead') ? 0.5 : t.conditions.includes('invisible') ? 0.45 : t.hidden ? 0.55 : 1;
      if (drag?.id !== t.id) o.c.position.set(t.x, t.y);
    }
    retarget();
  }
  // zonas pulsables: círculo del token (mínimo 44 px de pantalla en táctil) y puertas
  let hitK = 0;
  function retarget() {
    hitK = world.scale.x;
    for (const o of tokens.values()) o.c.hitArea = new Circle(0, 0, Math.max(tokR(o.t), touchy ? MIN_HIT / hitK : 0));
    if (cur) syncDoors(cur.scene.walls);
  }
  function endDrag(commit: boolean) {
    const d = drag; drag = undefined; ruler.visible = rulerTxt.visible = false;
    if (!d) return;
    d.c.zIndex = 0;
    if (!commit || !cur) return;
    const o = tokens.get(d.id);
    if (o) { o.t.x = d.to.x; o.t.y = d.to.y; } // optimista; el siguiente estado del servidor manda
    d.c.position.set(d.to.x, d.to.y);
    if (d.to.x !== d.from.x || d.to.y !== d.from.y) opts.onMoveToken(d.id, d.to.x, d.to.y);
  }

  // ---- pointer global: pan, arrastre, alt+clic ----
  stage.on('pointerdown', (e: FederatedPointerEvent) => {
    if (!cur) return;
    press = undefined;
    if (e.altKey && e.button === 0) { const p = world.toLocal(e.global); opts.onPing(p.x, p.y); return; }
    if (e.button === 0 && !space && edit.down(e)) return;
    if (e.button === 0 && !space && e.target === stage) { const p = world.toLocal(e.global); press = { x: e.global.x, y: e.global.y, wx: p.x, wy: p.y }; }
    if (!fixed && !pinching && (e.button === 1 || (e.button === 0 && (space || e.target === stage)))) cam = undefined, pan = { x: e.global.x - world.x, y: e.global.y - world.y };
  });
  let ptr: Point | undefined; // último puntero pendiente de avisar (1 vez por frame, en el ticker)
  stage.on('globalpointermove', (e: FederatedPointerEvent) => {
    edit.move(e);
    if (opts.onPointer) ptr = world.toLocal(e.global);
    if (lp && Math.hypot(e.global.x - lp.x, e.global.y - lp.y) > 8) cancelLong();
    if (pinching) return;
    if (pan) { world.position.set(e.global.x - pan.x, e.global.y - pan.y); return; }
    if (!drag || !cur) return;
    const p = world.toLocal(e.global), t = tokens.get(drag.id)!.t, g = cur.scene.grid;
    drag.to = snap(t, g, { x: p.x + drag.off.x, y: p.y + drag.off.y });
    drag.c.position.set(drag.to.x, drag.to.y);
    const cells = Math.round(Math.max(Math.abs(drag.to.x - drag.from.x), Math.abs(drag.to.y - drag.from.y)) / g.size); // regla 5-5-5
    ruler.clear(); dashed(ruler, drag.from, drag.to, 10, 7);
    ruler.stroke({ width: 3, color: AMBER });
    ruler.visible = rulerTxt.visible = drag.to.x !== drag.from.x || drag.to.y !== drag.from.y;
    rulerTxt.text = `${cells * g.feet} pies`;
    rulerTxt.position.set(drag.to.x, drag.to.y - t.size * g.size * 0.5 - 14);
  });
  const up = (e: FederatedPointerEvent) => {
    cancelLong(); pan = undefined; endDrag(true); edit.up();
    const p = press; press = undefined;
    if (!p || Math.hypot(e.global.x - p.x, e.global.y - p.y) >= 4) return;
    if (p.id) opts.onTokenClick?.(p.id, e.shiftKey); else opts.onMapClick?.(p.wx, p.wy);
  };
  stage.on('pointerup', up); stage.on('pointerupoutside', (e) => { press = undefined; up(e); });
  stage.on('pointercancel', () => { cancelLong(); pan = undefined; press = undefined; endDrag(false); });

  // ---- luz: mapa de luz en RenderTexture (multiply) + resplandor aditivo ----
  const LS = () => Math.min(LITE ? 1 / 3 : 0.5, 2048 / Math.max(cur!.scene.width, cur!.scene.height)); // escala de las RT
  const lmRoot = new Container(), lmBg = new Graphics(), lmDv = new Graphics(), lmLights = new Container(), lmDark = new Graphics();
  lmRoot.addChild(lmBg, lmDv, lmLights, lmDark);
  let lmRT: RenderTexture | undefined, lmDirty = true, lastLm = 0;
  function makeRT(old: RenderTexture | undefined, s: Scene) {
    old?.destroy(true);
    const k = LS();
    return RenderTexture.create({ width: Math.ceil(s.width * k), height: Math.ceil(s.height * k) });
  }
  function syncLights(s: Scene) {
    const segs = sightSegments(s.walls);
    const ids = new Set(s.lights.map((l) => l.id));
    for (const [id, o] of lights) if (!ids.has(id)) {
      o.lm.destroy({ children: true }); o.gl.destroy({ children: true }); lights.delete(id); polyCache.delete(id);
    }
    for (const l of s.lights) {
      const key = `${wallsKey}|${l.x},${l.y},${l.bright},${l.dim},${l.color},${l.anim}`;
      let o = lights.get(l.id);
      if (o?.key === key) continue;
      const pk = `${wallsKey}|${l.x},${l.y}`;
      let pc = polyCache.get(l.id);
      if (pc?.key !== pk) polyCache.set(l.id, pc = { key: pk, poly: visibility({ x: l.x, y: l.y }, segs, s.width, s.height) });
      if (!o) {
        const mk = () => {
          const c = new Container(), m = new Graphics(), sp = new Sprite();
          sp.anchor.set(0.5); c.addChild(sp, m); c.mask = m; return { c, m, sp };
        };
        const a = mk(), b = mk();
        lmLights.addChild(a.c); glowL.addChild(b.c);
        o = { key, lm: a.c, lmMask: a.m, gl: b.c, glMask: b.m, spr: [a.sp, b.sp], phase: Math.random() * 100, base: 0, anim: l.anim };
        lights.set(l.id, o);
      }
      o.key = key; o.anim = l.anim;
      const tex = gradTexture(l.bright / l.dim), pf = flat(pc.poly);
      for (const m of [o.lmMask, o.glMask]) m.clear().poly(pf).fill(0xffffff);
      o.spr.forEach((sp, i) => {
        sp.texture = tex; sp.tint = l.color; sp.position.set(l.x, l.y); sp.width = sp.height = l.dim * 2;
        sp.alpha = i ? 0.22 : 1; o!.base = l.dim * 2;
      });
      lmDirty = true;
    }
  }
  function renderLightmap() {
    if (!lmRT || !cur) return;
    const s = cur.scene, v = 1 - (1 - s.globalLight) * (isDM() ? 0.35 : 0.8), k = LS();
    lmRoot.scale.set(k);
    const c = Math.round(v * 255);
    lmBg.clear().rect(0, 0, s.width, s.height).fill((c << 16) | (c << 8) | c);
    // Visión en la oscuridad: lo que ve el grupo queda en penumbra gris en vez de negro.
    // ponytail: usa el polígono de visión sin límite de alcance; recortar por radio de darkvision cuando importe.
    lmDv.clear();
    if (!isDM() && cur.visible && s.tokens.some((t) => t.faction === 'ally' && t.owners.length && t.darkvision > 0))
      for (const p of cur.visible) lmDv.poly(flat(p)).fill(0x5a5a5a);
    lmDark.clear(); // darkness: región en negro sobre la luz
    for (const r of s.regions ?? []) if (r.kind === 'darkness' && r.points.length > 2) lmDark.poly(flat(r.points)).fill(0x000000);
    app.renderer.render({ container: lmRoot, target: lmRT, clear: true, clearColor: [0, 0, 0, 0] });
    lmDirty = false;
  }

  // ---- niebla (solo jugadores): memoria por escena + RT compuesta con desenfoque ----
  const memories = new Map<Id, RenderTexture>();
  const memRoot = new Container(), memG = new Graphics(); memRoot.addChild(memG);
  const fogRoot = new Container(), fogBg = new Graphics(), fogMem = new Sprite(), fogVisRoot = new Container(), fogVis = new Graphics();
  fogVis.blendMode = fogMem.blendMode = 'erase';
  fogVisRoot.addChild(fogVis); fogRoot.addChild(fogBg, fogMem, fogVisRoot);
  let fogRT: RenderTexture | undefined;
  fogSprite.filters = [new BlurFilter({ strength: 6, quality: 2 })]; // bordes suaves
  function renderFog(s: Scene, visible: Point[][]) {
    const k = LS();
    let mem = memories.get(s.id);
    if (!mem) memories.set(s.id, mem = RenderTexture.create({ width: Math.ceil(s.width * k), height: Math.ceil(s.height * k) }));
    const pf = visible.map(flat);
    memG.clear(); fogVis.clear();
    for (const p of pf) { memG.poly(p).fill(0xffffff); fogVis.poly(p).fill(0xffffff); }
    memRoot.scale.set(k); fogVisRoot.scale.set(k);
    app.renderer.render({ container: memRoot, target: mem, clear: false }); // acumula lo explorado
    fogBg.clear().rect(0, 0, fogRT!.width, fogRT!.height).fill({ color: 0x050302, alpha: 0.97 });
    // ponytail: explorado-no-visible = alpha 0,6 sobre negro cálido; sin ColorMatrixFilter de desaturado
    fogMem.texture = mem; fogMem.alpha = 0.38;
    app.renderer.render({ container: fogRoot, target: fogRT!, clear: true, clearColor: [0, 0, 0, 0] });
  }

  // ---- setState ----
  function setState(st: ClientState) {
    cur = st;
    const on = st.settings.layers.lighting && st.settings.mode !== 'simple';
    if (on !== lit) { lit = on; visKey = ''; lmDirty = true; }
    lightSprite.visible = glowL.visible = lit;
    const s = st.scene, changed = s.id !== sceneId;
    if (changed) {
      sceneId = s.id; gridKey = wallsKey = visKey = '';
      for (const o of lights.values()) { o.lm.destroy({ children: true }); o.gl.destroy({ children: true }); }
      lights.clear(); polyCache.clear();
      lmRT = makeRT(lmRT, s); fogRT = makeRT(fogRT, s);
      lightSprite.texture = lmRT; lightSprite.scale.set(1 / LS());
      fogSprite.texture = fogRT; fogSprite.scale.set(1 / LS());
      void buildFloor(s); fit(s);
    }
    const gk = `${s.width},${s.height},${s.grid.size},${s.grid.offsetX},${s.grid.offsetY}`;
    if (gk !== gridKey) { gridKey = gk; drawGrid(s); }
    const wk = s.walls.map((w) => `${w.id}${w.a.x},${w.a.y},${w.b.x},${w.b.y}${w.kind}${w.open ? 1 : 0}${w.secret ? 1 : 0}`).join(';');
    const wallsChanged = wk !== wallsKey;
    if (wallsChanged) { wallsKey = wk; drawWalls(s.walls); }
    const rk = isDM() + JSON.stringify(s.regions ?? []);
    if (rk !== regKey || changed) { regKey = rk; drawRegions(s); lmDirty = true; }
    syncDoors(s.walls);
    syncTokens(s);
    // la clave de caché de luces incluye los muros que bloquean vista (wallsKey); se recalcula solo si cambia algo
    syncLights(s);
    const lk = s.globalLight + '|' + isDM();
    if (lk !== lightsKey) { lightsKey = lk; lmDirty = true; }
    fogSprite.visible = lit && !!st.visible;
    if (lit && st.visible) {
      const vk = JSON.stringify(st.visible, (_, v) => (typeof v === 'number' ? Math.round(v) : v));
      if (vk !== visKey || changed) { visKey = vk; renderFog(s, st.visible); lmDirty = true; }
    }
    if (lmDirty && lit) renderLightmap();
    vfx.sync(st.settings.layers.effects !== false && st.settings.mode !== 'simple', s.weather);
  }

  // ---- ticker: solo animaciones ----
  app.ticker.add(() => {
    const now = performance.now();
    if (cam) {
      const k = Math.min(1, (now - cam.t0) / 450), e = 1 - (1 - k) ** 3, m = (a: number, b: number) => a + (b - a) * e;
      world.scale.set(m(cam.k0, cam.k1)); world.position.set(m(cam.x0, cam.x1), m(cam.y0, cam.y1));
      if (k >= 1) cam = undefined;
    }
    if (world.scale.x !== hitK) retarget();
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i], k = (now - p.t0) / 1200;
      if (k >= 1) { p.g.destroy(); pings.splice(i, 1); continue; }
      p.g.clear().circle(0, 0, 10 + 60 * k).stroke({ width: 4 / world.scale.x, color: 0xffffff });
      p.g.alpha = 1 - k;
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i], k = (now - f.t0) / 1200;
      if (k >= 1) { f.t.destroy(); floats.splice(i, 1); continue; }
      f.t.y = f.y0 - (reduced ? 0 : 40 * k); f.t.alpha = k < 0.6 ? 1 : (1 - k) / 0.4;
    }
    drawMarks(now); edit.draw();
    for (const o of tokens.values()) if (o.fx && !reduced) {
      if (o.fx.ring) o.fx.ring.rotation = now / 4000;
      if (o.fx.wob) o.fx.main.x = 2.5 * Math.sin(now / 350 + o.fx.phase);
    }
    if (ptr) { opts.onPointer?.(ptr.x, ptr.y); ptr = undefined; }
    if (reduced || !lit || !lights.size) return;
    const t = now / 1000;
    for (const o of lights.values()) {
      if (o.anim !== 'torch' && o.anim !== 'pulse') continue;
      const f = o.anim === 'torch' ? 1 + 0.03 * Math.sin(t * 9 + o.phase) + 0.02 * Math.sin(t * 23 + o.phase * 2) : 1 + 0.05 * Math.sin(t * 2 + o.phase);
      o.spr.forEach((sp, i) => {
        sp.width = sp.height = o.base * f;
        sp.alpha = (i ? 0.22 : 1) * (o.anim === 'torch' ? 0.93 + 0.07 * Math.sin(t * 17 + o.phase) : f);
      });
      lmDirty = true;
    }
    if (lmDirty && now - lastLm > 33) { lastLm = now; renderLightmap(); } // ponytail: parpadeo a ~30 fps
  });

  // Extra de Table (no está en api.ts): vista previa de muros propuestos (autodetección); null la quita.
  const previewG = new Graphics(); previewG.eventMode = 'none'; world.addChild(previewG);
  function previewWalls(ws: Wall[] | null) {
    previewG.clear();
    for (const w of ws ?? []) previewG.moveTo(w.a.x, w.a.y).lineTo(w.b.x, w.b.y);
    previewG.stroke({ width: 5, color: 0xe8a33d, alpha: 0.85, cap: 'round' });
  }

  function destroy() {
    app.canvas.removeEventListener('wheel', onWheel);
    cancelLong();
    for (const [n, f] of [['pointerdown', tDown], ['pointermove', tMove], ['pointerup', tUp], ['pointercancel', tUp]] as const) app.canvas.removeEventListener(n, f);
    removeEventListener('keydown', kd); removeEventListener('keydown', ek); removeEventListener('keyup', ku); removeEventListener('lantern:a11y', onA11y);
    for (const m of memories.values()) m.destroy(true);
    vfx.destroy();
    lmRT?.destroy(true); fogRT?.destroy(true);
    for (const t of grads.values()) t.destroy(true);
    grads.clear();
    stone.destroy(true);
    lmRoot.destroy({ children: true }); memRoot.destroy({ children: true }); fogRoot.destroy({ children: true });
    app.destroy(true, { children: true });
  }

  return {
    focus, fitScene, worldToClient,
    setDisplay: (m) => { fixed = m === 'fixed'; pan = undefined; if (fixed) { endDrag(false); cam = undefined; } if (cur) syncTokens(cur.scene); },
    previewWalls, setState, setMarks, ping, floatText, effect: vfx.effect, destroy,
    setTool: (t) => edit.setTool(isDM() ? t : { tool: 'none' }), onEdit: edit.onEdit,
  };
};
