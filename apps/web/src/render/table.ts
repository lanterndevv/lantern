// Renderer Pixi v8: «mesa a la luz de una linterna». Implementa CreateTable (api.ts).
import {
  Application, Assets, BlurFilter, ColorMatrixFilter, Container, Circle, DisplacementFilter, Graphics, Polygon, Rectangle, RenderTexture, Sprite, Text, Texture, TilingSprite, VideoSource,
} from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { sightSegments, visibility } from '@lantern/vision';
import type { ClientState, Drawing, Id, Light, Point, Scene, Token, Wall } from '@lantern/protocol';
import type { CreateTable, Marks } from './api.ts';
import { createVfx, LITE } from './vfx.ts';
import { MAX_FPS_PORTATIL, PORTATIL } from './portatil.ts';
import { createEdit, dashed, REGION_COLOR, segDist, strokePath } from './edit.ts';
import { clipCone, gridCells, gridType, hexCenter, hexToPx, hueShift } from './geom.ts';
import { createPost } from './post.ts';
import { createMinimap } from './minimap.ts';

// Tintas del mapa (A4/A2): lapislázuli aliados, bermellón enemigos, verdín vida. Iguales en día y noche: el mapa siempre es oscuro.
const FACTION = { ally: '#6A9BEA', enemy: '#EE6448', neutral: '#BFAE86' };
const HP = { ok: '#86C28C', bad: '#EE6448' }; // PG alto / PG bajo
// Daltonismo: --mapa-aliado, --mapa-enemigo, --mapa-exito y --mapa-peligro del documento (a11y.css). Muta FACTION y HP.
function readPalette() {
  const cs = getComputedStyle(document.documentElement), v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  FACTION.ally = v('--mapa-aliado', '#6A9BEA'); FACTION.enemy = v('--mapa-enemigo', '#EE6448');
  HP.ok = v('--mapa-exito', '#86C28C'); HP.bad = v('--mapa-peligro', '#EE6448');
}
const paletteKey = () => FACTION.ally + FACTION.enemy + HP.ok + HP.bad;
// oro solo para lo activo: tu token, el turno, la regla de movimiento
const MINE = '#E8C766', AMBER = '#D4AD4A', TEXT = '#F0E2C0', SERIF = '"EB Garamond", Georgia, "Times New Roman", serif';
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

type LightObj = { x: number; y: number; color: string; key: string; lm: Container; lmMask: Graphics; gl: Container; glMask: Graphics; spr: Sprite[]; phase: number; base: number; anim?: Light['anim'] };

export const createTable: CreateTable = async (el, opts) => {
  readPalette();
  const app = new Application();
  if (import.meta.env.DEV) (globalThis as unknown as { __pixi: unknown }).__pixi = app; // pruebas E2E
  await app.init({ background: '#0C0A08', resizeTo: el, antialias: true, resolution: devicePixelRatio, autoDensity: true });
  if (PORTATIL) app.ticker.maxFPS = MAX_FPS_PORTATIL; // modo portátil: 30 fps
  el.appendChild(app.canvas);
  const stage = app.stage;
  stage.eventMode = 'static';
  stage.hitArea = new Rectangle(-1e7, -1e7, 2e7, 2e7);
  const world = new Container();
  stage.addChild(world);
  const routeG = new Graphics(), topL = new Container();
  const floorL = new Container(), gridG = new Graphics(), wallsG = new Graphics(), doorsL = new Container(),
    tokensL = new Container(), fxL = new Container(), glowL = new Container(), marksG = new Graphics(), uiL = new Container(),
    regionsL = new Container(), fogRegG = new Graphics(), editG = new Graphics(),
    fadeG = new Graphics(), drawG = new Graphics(), ephL = new Container();
  tokensL.sortableChildren = true; // los muertos (zIndex -1) quedan bajo los demás
  const lightSprite = new Sprite(), fogSprite = new Sprite();
  lightSprite.blendMode = 'multiply';
  glowL.blendMode = 'add';
  fogRegG.filters = [new BlurFilter({ strength: 6, quality: 2 })]; // fog de región: negro opaco con bordes suaves
  world.addChild(floorL, gridG, regionsL, wallsG, doorsL, fadeG, tokensL, routeG, drawG, ephL, fxL, lightSprite, glowL, topL, fogSprite, fogRegG, marksG, editG, uiL);
  // El stage es interactivo y Pixi hereda ese modo a todos sus hijos al buscar el objetivo: sin esto, las capas que cubren
  // el mapa por encima de los tokens (luz, niebla, efectos, marcas) «ganan» el hit test y ningún token recibe clics.
  for (const l of [routeG, topL, fadeG, drawG, ephL, fxL, lightSprite, glowL, fogSprite, fogRegG, marksG, editG, uiL]) l.eventMode = 'none';
  const stone = stoneTexture();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const vfx = createVfx(app, world, fxL, reduced, topL);
  const post = createPost(app, world, reduced);
  const edit = createEdit(world, editG, () => cur?.scene, () => (raw && level !== raw.scene.levels?.[0]?.id ? level : undefined),
    { me: opts.memberId, draw: (d, p) => opts.onDraw?.(d, p), erase: (id) => opts.onErase?.(id) });

  // ---- estado ----
  let cur: ClientState | undefined, raw: ClientState | undefined; // raw = estado del servidor; cur = filtrado a la planta visible
  let level: Id | undefined, ghost = false;
  const ghostG = new Graphics(); ghostG.eventMode = 'none'; world.addChildAt(ghostG, 2); // sobre suelo y cuadrícula, bajo regiones
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
  const zoomAt = (k: number, mx: number, my: number) => {
    const k0 = world.scale.x;
    world.position.set(mx - ((mx - world.x) / k0) * k, my - ((my - world.y) / k0) * k);
    world.scale.set(k);
  };
  // zoom suave al cursor: la rueda fija el objetivo y el ticker se acerca; con movimiento reducido es directo
  let zoomT: { k: number; mx: number; my: number } | undefined, follow: Id | undefined;
  let vel = { x: 0, y: 0 }, panLast: { t: number; x: number; y: number } | undefined; // inercia del pan (px/ms)
  const stopCam = () => { cam = undefined; zoomT = undefined; follow = undefined; vel = { x: 0, y: 0 }; };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (fixed) return;
    const t0 = zoomT?.k ?? world.scale.x;
    cam = undefined; follow = undefined; vel = { x: 0, y: 0 };
    const r = app.canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, k = clampK(t0 * Math.exp(-e.deltaY * 0.0015));
    if (reduced) zoomAt(k, mx, my); else zoomT = { k, mx, my };
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
    zoomT = undefined; follow = undefined; vel = { x: 0, y: 0 };
    if (reduced) { cam = undefined; world.scale.set(k); world.position.set(x, y); return; }
    cam = { t0: performance.now(), k0: world.scale.x, x0: world.x, y0: world.y, k1: k, x1: x, y1: y };
  };
  const focus = (x: number, y: number, zoom?: number) => {
    pan = undefined; // interrumpe el pan del usuario
    ping(x, y, MINE); // anillo en el destino
    const k = clampK(zoom ?? world.scale.x);
    camTo(k, app.screen.width / 2 - x * k, app.screen.height / 2 - y * k);
  };
  const fitScene = () => {
    const s = cur?.scene; if (!s) return;
    const k = clampK(Math.min(app.screen.width / s.width, app.screen.height / s.height) * 0.95);
    camTo(k, (app.screen.width - s.width * k) / 2, (app.screen.height - s.height * k) / 2);
  };
  const frameParty = () => {
    const s = cur?.scene; if (!s) return;
    const ps = s.tokens.filter((t) => (t.faction === 'ally' || t.owners.length) && !t.conditions.includes('dead'));
    if (!ps.length) return fitScene();
    const pad = s.grid.size * 2;
    const x0 = Math.min(...ps.map((t) => t.x)) - pad, x1 = Math.max(...ps.map((t) => t.x)) + pad, y0 = Math.min(...ps.map((t) => t.y)) - pad, y1 = Math.max(...ps.map((t) => t.y)) + pad;
    const k = clampK(Math.min(2, app.screen.width / (x1 - x0), app.screen.height / (y1 - y0)));
    camTo(k, app.screen.width / 2 - ((x0 + x1) / 2) * k, app.screen.height / 2 - ((y0 + y1) / 2) * k);
  };
  const followToken = (id?: Id) => { stopCam(); pan = undefined; follow = id; };
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
    pinching = true; stopCam(); pan = undefined; press = undefined; cancelLong();
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
  const ruler = new Graphics(), rulerTxt = new Text({ text: '', style: { fontFamily: SERIF, fontSize: 17, fontWeight: '600', fill: MINE, stroke: { color: '#0C0A08', width: 4 } } });
  rulerTxt.anchor.set(0.5, 1); ruler.visible = rulerTxt.visible = false;
  uiL.addChild(ruler, rulerTxt);

  // ---- marcas y texto flotante ----
  let marks: Marks = { targets: [] };
  const setMarks = (m: Marks) => { marks = m; };
  const tokR = (t: Token) => (t.size * (cur?.scene.grid.size ?? 70) * 0.84) / 2;
  const floats: { id: Id; t: Text; t0: number; y0: number }[] = [];
  function floatText(id: Id, text: string, color: string, iconSvg?: string) {
    const o = tokens.get(id);
    if (!o) return;
    const n = floats.filter((f) => f.id === id).length; // apila con desplazamiento
    const t = new Text({ text, style: { fontFamily: SERIF, fontSize: 30, fontWeight: 'bold', fill: color, stroke: { color: '#1a0f08', width: 6 } } });
    t.anchor.set(0.5, 1);
    const y0 = o.c.y - tokR(o.t) - n * 30;
    t.position.set(o.c.x + (n % 2 ? 14 : 0), y0);
    if (iconSvg) try { const ic = new Graphics().svg(iconSvg); ic.scale.set(1.2); ic.position.set(-t.width / 2 - 34, -t.height + 4); t.addChild(ic); } catch { /* sin icono: solo el número */ } // icono del tipo de daño a la izquierda
    uiL.addChild(t); floats.push({ id, t, t0: performance.now(), y0 });
  }
  // plantilla animada: origen, ángulo y tamaño se acercan al objetivo (salto directo con movimiento reducido)
  let tpl: { shape: string; x: number; y: number; a: number; z: number } | undefined;
  function drawTemplate(g: Graphics, t: NonNullable<Marks['template']>, now: number) {
    const a1 = Math.atan2(t.dir.y, t.dir.x) || 0;
    if (!tpl || tpl.shape !== t.shape) tpl = { shape: t.shape, x: t.origin.x, y: t.origin.y, a: a1, z: reduced ? t.sizePx : 0 };
    const f = reduced ? 1 : 0.25, da = ((a1 - tpl.a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    tpl.x += (t.origin.x - tpl.x) * f; tpl.y += (t.origin.y - tpl.y) * f; tpl.a += da * f; tpl.z += (t.sizePx - tpl.z) * f;
    const L = tpl.z, w = cur?.scene.grid.size ?? 70, co = Math.cos(tpl.a), si = Math.sin(tpl.a);
    const P = (u: number, v: number) => [tpl!.x + u * co - v * si, tpl!.y + u * si + v * co]; // u = a lo largo de dir, v = lateral
    if (t.shape === 'sphere' || t.shape === 'cylinder') g.circle(tpl.x, tpl.y, L);
    else if (t.shape === 'cone') g.poly([...P(0, 0), ...P(L, -L * Math.tan(0.4625)), ...P(L, L * Math.tan(0.4625))]); // 53°
    else { const h = (t.shape === 'line' ? w : L) / 2; g.poly([...P(0, -h), ...P(L, -h), ...P(L, h), ...P(0, h)]); }
    g.fill({ color: t.color, alpha: 0.18 }).stroke({ width: 2, color: t.color, alpha: reduced ? 0.9 : 0.7 + 0.2 * Math.sin(now / 300) });
  }
  function drawMarks(now: number) {
    const g = marksG.clear(), m = marks, s = now / 1000;
    if (m.area) g.circle(m.area.x, m.area.y, m.area.radius).fill({ color: m.area.color, alpha: 0.18 }).stroke({ width: 2, color: m.area.color });
    if (m.template) drawTemplate(g, m.template, now); else tpl = undefined;
    const at = (id?: Id) => { const o = id ? tokens.get(id) : undefined; return o && { x: o.c.x, y: o.c.y, r: tokR(o.t) }; };
    const a = at(m.active);
    if (a) g.circle(a.x, a.y, a.r + 8).stroke({ width: 6, color: AMBER, alpha: reduced ? 0.75 : 0.55 + 0.35 * Math.sin(s * 4) });
    const A = at(m.aim?.from), B = at(m.aim?.to);
    if (A && B) { // flecha atacante→objetivo (respira con la luz; fija con movimiento reducido)
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, ex = B.x - ux * (B.r + 12), ey = B.y - uy * (B.r + 12);
      const al = reduced ? 0.85 : 0.65 + 0.25 * Math.sin(s * 5);
      if (d > A.r + B.r + 24) {
        dashed(g, { x: A.x + ux * (A.r + 6), y: A.y + uy * (A.r + 6) }, { x: ex - ux * 8, y: ey - uy * 8 }, 12, 7);
        g.stroke({ width: 3, color: FACTION.enemy, alpha: al });
        g.poly([ex, ey, ex - ux * 16 - uy * 8, ey - uy * 16 + ux * 8, ex - ux * 16 + uy * 8, ey - uy * 16 - ux * 8]).fill({ color: FACTION.enemy, alpha: al });
      }
    }
    const sel = at(m.selected);
    if (sel) g.circle(sel.x, sel.y, sel.r + 4).stroke({ width: 2, color: MINE });
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
  let floorVid: HTMLVideoElement | undefined;
  const dropVideo = () => { if (floorVid) { floorVid.pause(); floorVid.removeAttribute('src'); floorVid.load(); floorVid = undefined; } };
  async function buildFloor(s: Scene) {
    const my = ++bgToken;
    floorL.removeChildren().forEach((c) => c.destroy());
    dropVideo();
    if (s.background) {
      try {
        if (/\.(webm|mp4)([?#]|$)/i.test(s.background)) { // mapa animado: textura de vídeo en bucle y sin sonido
          const v = document.createElement('video');
          v.loop = v.muted = v.playsInline = true; v.crossOrigin = 'anonymous'; v.src = s.background;
          await new Promise<void>((ok, ko) => { v.onloadeddata = () => ok(); v.onerror = () => ko(new Error('video')); });
          if (my !== bgToken) { v.removeAttribute('src'); return; }
          floorVid = v; // con movimiento reducido queda el primer fotograma
          const sp = new Sprite(new Texture({ source: new VideoSource({ resource: v, autoPlay: !reduced, loop: true, muted: true }) }));
          sp.width = s.width; sp.height = s.height; floorL.addChild(sp);
          return;
        }
        const tex = await Assets.load<Texture>(s.background);
        if (my !== bgToken) return;
        const sp = new Sprite(tex); sp.width = s.width; sp.height = s.height; floorL.addChild(sp);
        return;
      } catch { /* ponytail: si la imagen falla cae al suelo procedural */ }
    }
    if (my === bgToken) floorL.addChild(new TilingSprite({ texture: stone, width: s.width, height: s.height }));
  }
  function drawGrid(s: Scene) {
    const { size, offsetX, offsetY } = s.grid, ty = gridType(s.grid);
    gridG.clear();
    if (ty === 'none') return;
    if (ty === 'hex') { // filas (pointy-top): un hexágono por casilla
      const R = size / Math.sqrt(3);
      for (let r = -1; r <= s.height / (1.5 * R) + 1; r++) for (let q = Math.floor(-r / 2) - 1; q <= s.width / size - r / 2 + 1; q++) {
        const c = hexToPx(s.grid, q, r);
        for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i - Math.PI / 6, x = c.x + R * Math.cos(a), y = c.y + R * Math.sin(a); if (i) gridG.lineTo(x, y); else gridG.moveTo(x, y); }
        gridG.closePath();
      }
      gridG.stroke({ width: 1, color: 0x1e140a, alpha: 0.38 }); // tinta sepia
      return;
    }
    for (let x = offsetX % size; x <= s.width; x += size) gridG.moveTo(x, 0).lineTo(x, s.height);
    for (let y = offsetY % size; y <= s.height; y += size) gridG.moveTo(0, y).lineTo(s.width, y);
    gridG.stroke({ width: 1, color: 0x1e140a, alpha: 0.38 }); // tinta sepia
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
      if (!dm && r.kind === 'weather') continue; // la zona de clima no se dibuja a los jugadores
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
    vfx.setRegions(rs.filter((r) => dm || !r.hidden));
  }

  // ---- tokens ----
  const canDrag = (t: Token) => !fixed && (isDM() || (opts.role === 'trusted' && t.faction === 'ally') || (opts.role === 'player' && t.owners.includes(opts.memberId)));
  const snap = (t: Token, g: Scene['grid'], p: Point): Point => {
    if (gridType(g) === 'none') return { x: Math.round(p.x), y: Math.round(p.y) };
    if (gridType(g) === 'hex') return hexCenter(g, p);
    const f = (v: number, o: number) => (t.size % 2 ? o + (Math.floor((v - o) / g.size) + 0.5) * g.size : o + Math.round((v - o) / g.size) * g.size);
    return { x: f(p.x, g.offsetX), y: f(p.y, g.offsetY) };
  };
  type Fx = { main: Container; ring?: Graphics; wob?: boolean; phase: number; ticks: ((now: number) => void)[]; tint: number; hit: number; rot: number };
  const statusKey = (t: Token) =>
    `${t.conditions.join()}|${JSON.stringify(t.condRounds)}|${t.exhaustion}|${t.concentration}|${JSON.stringify(t.deathSaves)}`;
  function deadLabel(c: Container, t: Token, r: number, fx: Fx): Fx {
    const lab = new Text({ text: t.name, style: { fontFamily: SERIF, fontSize: 12, fill: TEXT, stroke: { color: '#000', width: 3 } } });
    lab.anchor.set(0.5, 0); lab.y = r * 0.35; lab.alpha = 0.7; c.addChild(lab); return fx;
  }
  function drawToken(c: Container, t: Token, g: Scene['grid'], rot0 = 0): Fx {
    c.removeChildren().forEach((x) => x.destroy({ children: true }));
    const r = (t.size * g.size * 0.84) / 2, mine = t.owners.includes(opts.memberId);
    const has = (id: string) => t.conditions.includes(id), dead = has('dead'), ko = has('unconscious') || !!t.deathSaves || (!!t.hp && t.hp.max > 0 && t.hp.cur <= 0);
    const main = new Container(), fx: Fx = { main, phase: Math.random() * 10, ticks: [], tint: has('poisoned') ? 0xb4e8b4 : 0xffffff, hit: 0, rot: ko && !dead ? 1.4 : 0 }; // a 0 PG el token cae inclinado (~80°)
    main.rotation = rot0;
    const free = t.shape === 'free' && !!t.img; // forma libre: la imagen va sin máscara circular
    let seed = [...t.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const rn = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    if (dead) { // marca en el suelo: X roja tenue y aplanada
      const x = new Graphics(), m = r * 0.5;
      x.moveTo(-m, -m).lineTo(m, m).moveTo(m, -m).lineTo(-m, m).stroke({ width: 5, color: 0xd9503a, cap: 'round' });
      x.scale.y = 0.55; x.alpha = 0.6; main.addChild(x); c.addChild(main); fx.main = main;
      return deadLabel(c, t, r, fx);
    }
    c.addChild(new Graphics().ellipse(0, r * 0.62, r * 0.85, r * 0.28).fill({ color: 0x000000, alpha: 0.32 })); // sombra de contacto
    if (free) c.addChild(new Graphics().ellipse(0, r * 0.62, r * 0.85, r * 0.28).stroke({ width: 2, color: mine ? MINE : FACTION[t.faction] })); // sin borde circular: la facción va en el anillo del suelo
    if (t.elevation) { // sombra desplazada + etiqueta
      c.addChild(new Graphics().ellipse(r * 0.25, r * 0.55, r * 0.9, r * 0.5).fill({ color: 0x000000, alpha: 0.35 }));
      const e = new Text({ text: `${t.elevation > 0 ? '↑' : '↓'}${Math.abs(t.elevation)}`, style: { fontFamily: SERIF, fontSize: 13, fontWeight: 'bold', fill: '#8FD3F5', stroke: { color: '#000', width: 3 } } });
      e.anchor.set(0, 0.5); e.position.set(r + 4, -r * 0.4); c.addChild(e);
    }
    const body = new Graphics();
    if (!free) {
    body.circle(0, 0, r).fill('#1a1410'); // ponytail: degradado = 3 discos concéntricos, no FillGradient
    body.circle(-r * 0.15, -r * 0.15, r * 0.75).fill({ color: '#3a2d22', alpha: 0.7 });
    body.circle(-r * 0.25, -r * 0.25, r * 0.4).fill({ color: '#5a4636', alpha: 0.5 });
    body.circle(0, 0, r).stroke({ width: 3, color: mine ? MINE : FACTION[t.faction], alignment: 1 });
    }
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
    if (t.img) {
      Assets.load<Texture>(t.img).then((tex) => {
        if (main.destroyed) return;
        const sp = new Sprite(tex);
        sp.anchor.set(0.5);
        if (free) { sp.scale.set((2.3 * r) / Math.max(tex.width, tex.height)); main.addChildAt(sp, 0); } // conserva la silueta
        else { const mk = new Graphics().circle(0, 0, r - 1.5).fill(0xffffff); sp.scale.set((2 * r) / Math.min(tex.width, tex.height)); sp.mask = mk; main.addChildAt(sp, 1); main.addChild(mk); }
        ini.visible = false;
      }).catch(() => { /* ponytail: sin imagen queda la inicial */ });
    }
    main.tint = fx.tint;
    if (has('petrified')) { // gris con grietas (posición fija por token)
      main.tint = fx.tint = 0xa8a8a8;
      const cr = new Graphics();
      for (let i = 0; i < 4; i++) {
        let a = rn() * 6.283, x = Math.cos(a) * r * rn() * 0.5, y = Math.sin(a) * r * rn() * 0.5;
        cr.moveTo(x, y);
        for (let j = 0; j < 3; j++) { a += (rn() - 0.5) * 1.6; x += Math.cos(a) * r * 0.28; y += Math.sin(a) * r * 0.28; cr.lineTo(x, y); }
      }
      cr.stroke({ width: 1.6, color: 0x1a1612, alpha: 0.85 }); main.addChild(cr);
    }
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
    if (fx.wob) fx.ticks.push((n) => { main.skew.x = 0.07 * Math.sin(n / 500 + fx.phase); main.alpha = 0.8 + 0.2 * Math.sin(n / 230 + fx.phase); }); // distorsión
    c.addChild(main);
    const orbit = (n: number, icon: (g: Graphics) => void, R: number, cy: number, sp: number, tilt: number) => {
      const it = Array.from({ length: n }, () => { const g = new Graphics(); icon(g); c.addChild(g); return g; });
      const place = (now: number) => it.forEach((g, i) => { const a = now * sp + (i * 6.283) / n + fx.phase; g.position.set(Math.cos(a) * R, cy + Math.sin(a) * R * tilt); g.scale.set(0.8 + 0.3 * Math.sin(a)); });
      place(0); fx.ticks.push(place);
    };
    if (has('stunned')) orbit(3, (g) => g.star(0, 0, 5, 6, 2.6).fill(0xf2e45a).stroke({ width: 1, color: 0x000000 }), r * 0.7, -r - 4, 0.004, 0.3);
    if (has('paralyzed')) orbit(3, (g) => g.poly([2, -7, -4, 1, 0, 1, -2, 8, 4, -1, 0, -1]).fill(0xf2e45a).stroke({ width: 1, color: 0x000000 }), r + 8, 0, 0.0016, 0.3); // rayo
    if (has('restrained') || has('grappled')) orbit(3, (g) => g.roundRect(-6, -3, 8, 6, 3).stroke({ width: 2, color: 0xd3c3a6 }).roundRect(-1, -3, 8, 6, 3).stroke({ width: 2, color: 0xd3c3a6 }), r + 8, 0, -0.0014, 0.3); // eslabones
    if (has('poisoned')) {
      const bs = Array.from({ length: 4 }, () => { const g = new Graphics().circle(0, 0, 2.6).fill({ color: 0x9ff0a8, alpha: 0.35 }).stroke({ width: 1, color: 0xc8ffd0 }); c.addChild(g); return g; });
      const up = (n: number) => bs.forEach((g, i) => { const p = (n / 1600 + i * 0.25 + fx.phase) % 1; g.position.set((i - 1.5) * r * 0.4 + Math.sin(p * 6 + i) * 4, r * 0.8 - p * r * 1.8); g.alpha = Math.sin(p * Math.PI); });
      up(0); fx.ticks.push(up);
    }
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
    if (t.carriedBy) { // cadena: dos eslabones entrelazados
      const ch = new Graphics().roundRect(-9, -4, 11, 8, 4).stroke({ width: 2, color: 0xd3c3a6 }).roundRect(-2, -4, 11, 8, 4).stroke({ width: 2, color: 0xd3c3a6 });
      ch.position.set(-r * 0.75, -r * 0.75); ch.rotation = -0.6; c.addChild(ch);
    }
    if (t.legendary && t.legendary.max > 0) { // pips bajo el nombre (o bajo las salvaciones)
      const lg = new Graphics(), y3 = r + (t.deathSaves ? 46 : 32);
      for (let i = 0; i < t.legendary.max; i++) {
        const x = (i - (t.legendary.max - 1) / 2) * 11, on = i < t.legendary.max - t.legendary.used;
        lg.circle(x, y3, 3.5).fill({ color: 0xc29cf5, alpha: on ? 1 : 0.15 }).stroke({ width: 1, color: 0xc29cf5 });
      }
      c.addChild(lg);
    }
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
  let drag: { id: Id; c: Container; from: Point; off: Point; to: Point; wp: Point[] } | undefined;
  const dragPts = () => drag ? [drag.from, ...drag.wp, drag.to] : [];
  // Punto de paso: clic derecho o W durante el arrastre (en captura, para que no abra el menú radial).
  const addWp = () => { if (drag && (drag.to.x !== (drag.wp.at(-1) ?? drag.from).x || drag.to.y !== (drag.wp.at(-1) ?? drag.from).y) && drag.wp.length < 16) { drag.wp.push({ ...drag.to }); opts.onDrag?.(drag.id, dragPts()); } };
  const wpDown = (e: PointerEvent) => { if (drag && e.button === 2) { e.stopImmediatePropagation(); addWp(); } };
  const wpKey = (e: KeyboardEvent) => { if (drag && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); addWp(); } };
  app.canvas.addEventListener('pointerdown', wpDown, true); window.addEventListener('keydown', wpKey);
  let fadeOn = false;
  const tweens = new Map<Id, { x0: number; y0: number; x1: number; y1: number; t0: number; dur: number; last: number }>();
  const dots: { x: number; y: number; t0: number; r: number; color: string }[] = [];
  const fades: { pts: Point[]; t0: number; life: number; color: string; wp?: boolean }[] = [];
  function syncTokens(s: Scene) {
    const ids = new Set(s.tokens.map((t) => t.id));
    for (const [id, o] of tokens) if (!ids.has(id)) { tweens.delete(id); o.c.destroy({ children: true }); tokens.delete(id); if (drag?.id === id) endDrag(false); }
    for (const t of s.tokens) {
      let o = tokens.get(t.id);
      const fresh = !o;
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
          drag = { id: t.id, c, from: { x: t2.x, y: t2.y }, off: { x: t2.x - p.x, y: t2.y - p.y }, to: { x: t2.x, y: t2.y }, wp: [] };
          c.zIndex = 1e6; tweens.delete(t.id);
        });
        tokensL.addChild(c);
        o = { c, key: '', t };
        tokens.set(t.id, o);
      }
      const prevHp = o.t.hp?.cur;
      o.t = t;
      const k = `${t.name}|${t.faction}|${t.size}|${t.owners.includes(opts.memberId)}|${t.hp?.cur}/${t.hp?.max}|${s.grid.size}|${statusKey(t)}|${paletteKey()}|${t.elevation}|${t.carriedBy}|${t.img}|${JSON.stringify(t.legendary)}|${t.shape}`;
      const hit = !fresh && prevHp !== undefined && !!t.hp && t.hp.cur < prevHp ? performance.now() : 0; // recibe daño: parpadeo
      if (k !== o.key) { o.key = k; o.fx = drawToken(o.c, t, s.grid, o.fx?.main.rotation); }
      if (hit && o.fx) o.fx.hit = hit;
      o.c.eventMode = 'static'; // también los no movibles: reciben clic
      o.c.cursor = canDrag(t) ? 'grab' : 'pointer';
      o.c.alpha = t.conditions.includes('dead') ? 0.8 : t.conditions.includes('invisible') ? 0.45 : t.hidden ? 0.55 : 1;
      if (drag?.id !== t.id) {
        o.c.zIndex = t.conditions.includes('dead') ? -1 : 0;
        const tw = tweens.get(t.id);
        if (fresh || reduced || (!tw && o.c.x === t.x && o.c.y === t.y)) { tweens.delete(t.id); o.c.position.set(t.x, t.y); }
        else if (!tw || tw.x1 !== t.x || tw.y1 !== t.y) { // movimiento ajeno o corrección del servidor: tween ~250 ms/casilla (máx. 900) + ruta que se desvanece
          const cells = Math.max(Math.abs(t.x - o.c.x), Math.abs(t.y - o.c.y)) / s.grid.size, now = performance.now();
          tweens.set(t.id, { x0: o.c.x, y0: o.c.y, x1: t.x, y1: t.y, t0: now, dur: Math.min(900, Math.max(120, 250 * cells)), last: 0 });
          fades.push({ pts: [{ x: o.c.x, y: o.c.y }, { x: t.x, y: t.y }], t0: now, life: 1000, color: FACTION[t.faction] });
        }
      }
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
    if (d.to.x !== d.from.x || d.to.y !== d.from.y) opts.onMoveToken(d.id, d.to.x, d.to.y, d.wp.length ? d.wp : undefined);
  }

  // ---- pointer global: pan, arrastre, alt+clic ----
  stage.on('pointerdown', (e: FederatedPointerEvent) => {
    if (!cur) return;
    press = undefined;
    if (e.altKey && e.button === 0) { const p = world.toLocal(e.global); opts.onPing(p.x, p.y); return; }
    if (e.button === 0 && !space && edit.down(e)) return;
    if (e.button === 0 && !space && e.target === stage) { const p = world.toLocal(e.global); press = { x: e.global.x, y: e.global.y, wx: p.x, wy: p.y }; }
    if (!fixed && !pinching && (e.button === 1 || (e.button === 0 && (space || e.target === stage)))) (stopCam(), panLast = undefined, pan = { x: e.global.x - world.x, y: e.global.y - world.y });
  });
  let ptr: Point | undefined; // último puntero pendiente de avisar (1 vez por frame, en el ticker)
  stage.on('globalpointermove', (e: FederatedPointerEvent) => {
    edit.move(e);
    if (opts.onPointer) ptr = world.toLocal(e.global);
    if (lp && Math.hypot(e.global.x - lp.x, e.global.y - lp.y) > 8) cancelLong();
    if (pinching) return;
    if (pan) {
      world.position.set(e.global.x - pan.x, e.global.y - pan.y);
      const t = performance.now();
      if (panLast && t > panLast.t) { const f = 0.5, dt = t - panLast.t; vel = { x: vel.x * (1 - f) + ((world.x - panLast.x) / dt) * f, y: vel.y * (1 - f) + ((world.y - panLast.y) / dt) * f }; }
      panLast = { t, x: world.x, y: world.y };
      return;
    }
    if (!drag || !cur) return;
    const p = world.toLocal(e.global), t = tokens.get(drag.id)!.t, g = cur.scene.grid;
    drag.to = snap(t, g, { x: p.x + drag.off.x, y: p.y + drag.off.y });
    drag.c.position.set(drag.to.x, drag.to.y);
    const pts = dragPts();
    opts.onDrag?.(drag.id, pts);
    let cells = 0; // 5-5-5 en cuadrícula, distancia hex en hex
    ruler.clear();
    for (let i = 1; i < pts.length; i++) { cells += gridCells(g, pts[i - 1], pts[i]); dashed(ruler, pts[i - 1], pts[i], 10, 7); }
    ruler.stroke({ width: 3, color: AMBER });
    ruler.visible = rulerTxt.visible = drag.to.x !== drag.from.x || drag.to.y !== drag.from.y;
    rulerTxt.text = `${Math.round(cells * g.feet)} pies`;
    rulerTxt.position.set(drag.to.x, drag.to.y - t.size * g.size * 0.5 - 14);
  });
  const up = (e: FederatedPointerEvent) => {
    cancelLong(); endDrag(true); edit.up();
    if (pan && !reduced && !fixed && panLast && performance.now() - panLast.t < 80 && Math.hypot(vel.x, vel.y) > 0.05) { /* inercia: sigue en el ticker */ } else vel = { x: 0, y: 0 };
    pan = undefined; panLast = undefined;
    const p = press; press = undefined;
    if (!p || Math.hypot(e.global.x - p.x, e.global.y - p.y) >= 4) return;
    if (p.id) opts.onTokenClick?.(p.id, e.shiftKey); else opts.onMapClick?.(p.wx, p.wy);
  };
  stage.on('pointerup', up); stage.on('pointerupoutside', (e) => { press = undefined; up(e); });
  stage.on('pointercancel', () => { cancelLong(); pan = undefined; vel = { x: 0, y: 0 }; press = undefined; endDrag(false); });

  // ---- luz: mapa de luz en RenderTexture (multiply) + resplandor aditivo ----
  const LS = () => Math.min(LITE ? 1 / 3 : 0.5, 2048 / Math.max(cur!.scene.width, cur!.scene.height)); // escala de las RT
  const lmRoot = new Container(), lmBg = new Graphics(), lmDv = new Graphics(), lmLights = new Container(), lmDark = new Graphics();
  lmRoot.addChild(lmBg, lmDv, lmLights, lmDark);
  let lmRT: RenderTexture | undefined, lmDirty = true, lastLm = 0, glCur: number | undefined; // glCur: luz global mostrada (tween hacia scene.globalLight)
  // penumbra: desenfoque del mapa de luz (sombras suaves); en equipos modestos (LITE) se omite
  if (!LITE) { lmLights.filters = [new BlurFilter({ strength: 3, quality: 2 })]; lmDark.filters = [new BlurFilter({ strength: 2, quality: 2 })]; }
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
      const key = `${wallsKey}|${l.x},${l.y},${l.bright},${l.dim},${l.color},${l.anim},${JSON.stringify(l.cone)}`;
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
        o = { x: l.x, y: l.y, color: l.color, key, lm: a.c, lmMask: a.m, gl: b.c, glMask: b.m, spr: [a.sp, b.sp], phase: Math.random() * 100, base: 0, anim: l.anim };
        lights.set(l.id, o);
      }
      o.key = key; o.anim = l.anim; o.x = l.x; o.y = l.y; o.color = l.color;
      const tex = gradTexture(l.bright / l.dim), polys = l.cone ? clipCone(pc.poly, l, l.cone.dir, l.cone.angle) : [pc.poly]; // cono: recorta el polígono de visión
      for (const m of [o.lmMask, o.glMask]) { m.clear(); for (const p of polys) m.poly(flat(p)).fill(0xffffff); }
      o.spr.forEach((sp, i) => {
        sp.texture = tex; sp.tint = l.color; sp.position.set(l.x, l.y); sp.width = sp.height = l.dim * 2;
        sp.alpha = i ? 0.22 : 1; o!.base = l.dim * 2;
      });
      lmDirty = true;
    }
  }
  function renderLightmap() {
    if (!lmRT || !cur) return;
    const s = cur.scene, v = 1 - (1 - (glCur ?? s.globalLight)) * (isDM() ? 0.35 : 0.8), k = LS();
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
  const fogRoot = new Container(), fogBg = new Graphics(), fogMem = new Sprite(), fogTint = new Sprite(), fogVisRoot = new Container(), fogVis = new Graphics();
  fogVis.blendMode = fogMem.blendMode = 'erase';
  fogTint.tint = 0x2c2e36; fogTint.alpha = 0.55; // lo explorado queda gris azulado (desaturado y oscuro), no solo más transparente
  fogVisRoot.addChild(fogVis); fogRoot.addChild(fogBg, fogMem, fogTint, fogVisRoot);
  let fogRT: RenderTexture | undefined;
  const fogBlur = new BlurFilter({ strength: 6, quality: 2 }); // bordes suaves
  fogSprite.filters = [fogBlur];
  // bruma: el borde de la niebla ondula con un mapa de ruido que se desplaza despacio (no con movimiento reducido ni LITE)
  const noiseTex = (() => {
    const lo = document.createElement('canvas'); lo.width = lo.height = 16;
    const x = lo.getContext('2d')!, d = x.createImageData(16, 16);
    for (let i = 0; i < d.data.length; i += 4) { d.data[i] = 64 + Math.random() * 128; d.data[i + 1] = 64 + Math.random() * 128; d.data[i + 2] = 128; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0);
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const y = c.getContext('2d')!; y.imageSmoothingQuality = 'high'; y.drawImage(lo, 0, 0, 256, 256);
    return Texture.from(c);
  })();
  const noiseS = new Sprite(noiseTex); noiseS.alpha = 0.001; noiseS.eventMode = 'none'; world.addChild(noiseS);
  if (!reduced && !LITE) fogSprite.filters = [new DisplacementFilter({ sprite: noiseS, scale: 22 }), fogBlur];
  const memKey = (s: Scene) => `${s.id}|${level ?? ''}`; // la memoria de niebla es por planta
  function renderFog(s: Scene, visible: Point[][]) {
    const k = LS();
    let mem = memories.get(memKey(s));
    if (!mem) memories.set(memKey(s), mem = RenderTexture.create({ width: Math.ceil(s.width * k), height: Math.ceil(s.height * k) }));
    const pf = visible.map(flat);
    memG.clear(); fogVis.clear();
    for (const p of pf) { memG.poly(p).fill(0xffffff); fogVis.poly(p).fill(0xffffff); }
    memRoot.scale.set(k); fogVisRoot.scale.set(k);
    app.renderer.render({ container: memRoot, target: mem, clear: false }); // acumula lo explorado
    fogBg.clear().rect(0, 0, fogRT!.width, fogRT!.height).fill({ color: 0x050302, alpha: 0.97 });
    fogMem.texture = fogTint.texture = mem; fogMem.alpha = 0.8;
    app.renderer.render({ container: fogRoot, target: fogRT!, clear: true, clearColor: [0, 0, 0, 0] });
  }

  // ---- dibujos, cursores ----
  let drawKey = '';
  const paintStroke = (g: Graphics, d: Drawing) => { strokePath(g, d.points); g.stroke({ width: d.width, color: d.color, cap: 'round', join: 'round', alpha: 0.9 }); };
  const ephs: { g: Graphics; t0: number }[] = [];
  function drawEphemeral(d: Drawing) {
    const g = new Graphics(); paintStroke(g, d); ephL.addChild(g); ephs.push({ g, t0: performance.now() });
  }
  function showGhost(id: Id, path: Point[]) {
    const o = tokens.get(id);
    if (path.length > 1) fades.push({ pts: path, t0: performance.now(), life: 1500, color: o ? FACTION[o.t.faction] : AMBER, wp: true }); // con puntos de paso
  }
  // ruta propia con puntos de paso: tramos en terreno difícil de otro color y, pasados los pies restantes, en rojo
  const routeTxt = new Text({ text: '', style: { fontFamily: SERIF, fontSize: 17, fontWeight: '600', fill: MINE, stroke: { color: '#0C0A08', width: 4 } } });
  routeTxt.anchor.set(0.5, 1); routeTxt.visible = false; routeTxt.eventMode = 'none'; uiL.addChild(routeTxt);
  function setRoute(pts: Point[] | null, o?: { difficult?: Point[][]; remaining?: number }) {
    routeG.clear(); routeTxt.visible = false;
    const g = cur?.scene.grid;
    if (!pts || pts.length < 2 || !g) return;
    const diff = o?.difficult ?? [], rem = o?.remaining ?? Infinity;
    let spent = 0;
    routeG.circle(pts[0].x, pts[0].y, 5).stroke({ width: 2, color: AMBER });
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const hard = diff.some((pl) => pl.some((_, j) => j && segDist(mid, pl[j - 1], pl[j]) < 3));
      spent += gridCells(g, a, b) * g.feet * (hard ? 2 : 1);
      const c = spent > rem ? FACTION.enemy : hard ? '#E8834D' : AMBER; // rojo = no llega; naranja = terreno difícil
      dashed(routeG, a, b, 10, 6); routeG.stroke({ width: 3, color: c, alpha: 0.9 });
      routeG.circle(b.x, b.y, 4.5).fill(c).stroke({ width: 1.5, color: 0x000000, alpha: 0.6 });
    }
    const e = pts[pts.length - 1];
    routeTxt.text = `${Math.round(spent)} pies`; routeTxt.position.set(e.x, e.y - 14); routeTxt.visible = true;
  }
  type Cur = { c: Container; tx: number; ty: number; t: number; key: string };
  const cursors = new Map<Id, Cur>();
  function setCursors(list: { id: Id; name: string; color: string; x: number; y: number }[]) {
    const now = performance.now(), ids = new Set(list.map((l) => l.id));
    for (const [id, q] of cursors) if (!ids.has(id)) { q.c.destroy({ children: true }); cursors.delete(id); }
    for (const l of list) {
      let q = cursors.get(l.id);
      if (q && q.key !== l.name + l.color) { q.c.destroy({ children: true }); cursors.delete(l.id); q = undefined; }
      if (!q) {
        const c = new Container(), arrow = new Graphics().poly([0, 0, 0, 16, 4, 12.5, 7, 19, 9.5, 18, 6.5, 11.5, 12, 11.5]).fill(l.color).stroke({ width: 1, color: 0x000000 });
        const n = new Text({ text: l.name, style: { fontFamily: SERIF, fontSize: 11, fill: TEXT, stroke: { color: '#000', width: 3 } } });
        n.position.set(13, 15); c.addChild(arrow, n); c.position.set(l.x, l.y); uiL.addChild(c);
        cursors.set(l.id, q = { c, tx: l.x, ty: l.y, t: now, key: l.name + l.color });
      }
      if (q.tx !== l.x || q.ty !== l.y) { q.tx = l.x; q.ty = l.y; q.t = now; }
    }
  }

  // ---- setState ----
  function setState(st0: ClientState) {
    raw = st0;
    const os = st0.scene, base = os.levels?.[0]?.id, here = level ?? base, on1 = (x?: Id) => (x ?? base) === here;
    const st: ClientState = { ...st0, scene: { ...os, walls: os.walls.filter((w) => on1(w.level)), lights: os.lights.filter((l) => on1(l.level)),
      tokens: os.tokens.filter((t) => on1(t.level)), regions: os.regions?.filter((r) => on1(r.level)), drawings: os.drawings?.filter((d) => on1(d.level)) } };
    cur = st;
    ghostG.clear(); // ponytail: la planta inferior es solo muros y fichas en gris; sin suelo ni luces
    const i = ghost ? (os.levels ?? []).findIndex((l) => l.id === here) : -1;
    if (i > 0) {
      const b = os.levels![i - 1].id;
      for (const w of os.walls) if (w.level === b || (i === 1 && !w.level)) ghostG.moveTo(w.a.x, w.a.y).lineTo(w.b.x, w.b.y);
      ghostG.stroke({ width: 6, color: 0x9a9a9a, alpha: 0.25, cap: 'round' });
      for (const t of os.tokens) if (t.level === b || (i === 1 && !t.level)) ghostG.circle(t.x, t.y, tokR(t)).fill({ color: 0x9a9a9a, alpha: 0.25 });
    }
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
      void buildFloor(s); fit(s); stopCam();
      noiseS.width = s.width + 400; noiseS.height = s.height + 400;
    }
    const gk = `${s.width},${s.height},${gridType(s.grid)},${s.grid.size},${s.grid.offsetX},${s.grid.offsetY}`;
    if (gk !== gridKey) { gridKey = gk; drawGrid(s); }
    const wk = s.walls.map((w) => `${w.id}${w.a.x},${w.a.y},${w.b.x},${w.b.y}${w.kind}${w.open ? 1 : 0}${w.secret ? 1 : 0}`).join(';');
    const wallsChanged = wk !== wallsKey;
    if (wallsChanged) { wallsKey = wk; drawWalls(s.walls); }
    const rk = isDM() + JSON.stringify(s.regions ?? []);
    if (rk !== regKey || changed) { regKey = rk; drawRegions(s); lmDirty = true; }
    syncDoors(s.walls);
    syncTokens(s);
    const dk = (s.drawings ?? []).map((d) => `${d.id}${d.points.length}${d.color}${d.width}`).join();
    if (dk !== drawKey) { drawKey = dk; drawG.clear(); for (const d of s.drawings ?? []) paintStroke(drawG, d); }
    // la clave de caché de luces incluye los muros que bloquean vista (wallsKey); se recalcula solo si cambia algo
    syncLights(s);
    if (glCur === undefined || changed || reduced) glCur = s.globalLight;
    const lk = s.globalLight + '|' + isDM();
    if (lk !== lightsKey) { lightsKey = lk; lmDirty = true; }
    fogSprite.visible = lit && !!st.visible;
    if (lit && st.visible) {
      const vk = JSON.stringify(st.visible, (_, v) => (typeof v === 'number' ? Math.round(v) : v));
      if (vk !== visKey || changed) { visKey = vk; renderFog(s, st.visible); lmDirty = true; }
    }
    if (lmDirty && lit) renderLightmap();
    vfx.sync(st.settings.layers.effects !== false && st.settings.mode !== 'simple', os.levels?.find((l) => l.id === here)?.weather ?? s.weather, (s.regions ?? []).filter((r) => r.kind === 'weather')); // clima: región > planta > escena
  }

  // ---- ticker: solo animaciones ----
  // minimapa (oculto en ?vista=): lo que ve el jugador, sin fichas del mundo (van como puntos)
  const mm = new URLSearchParams(location.search).has('vista') ? undefined : createMinimap(el, {
    app, world, hide: [tokensL, uiL, marksG, editG, routeG, ephL, ghostG], lite: LITE, scene: () => cur?.scene,
    level: () => raw?.scene.levels?.find((l) => l.id === (level ?? raw!.scene.levels![0].id))?.name ?? '',
    color: (t) => (t.owners.length ? MINE : FACTION[t.faction]),
    moveTo: (x, y) => { if (fixed) return; stopCam(); pan = undefined; world.position.set(app.screen.width / 2 - x * world.scale.x, app.screen.height / 2 - y * world.scale.x); },
  });
  app.ticker.add(() => {
    const now = performance.now(), dt = Math.min(50, app.ticker.deltaMS);
    vfx.zonePick(); // clima por zona: sigue a la cámara
    mm?.frame();
    if (cam) {
      const k = Math.min(1, (now - cam.t0) / 450), e = 1 - (1 - k) ** 3, m = (a: number, b: number) => a + (b - a) * e;
      world.scale.set(m(cam.k0, cam.k1)); world.position.set(m(cam.x0, cam.x1), m(cam.y0, cam.y1));
      if (k >= 1) cam = undefined;
    }
    if (zoomT) { // zoom suave hacia el objetivo, anclado al cursor
      const k0 = world.scale.x, done = Math.abs(zoomT.k - k0) < 0.002, k = done ? zoomT.k : k0 + (zoomT.k - k0) * (1 - Math.exp(-dt / 90));
      zoomAt(k, zoomT.mx, zoomT.my); if (done) zoomT = undefined;
    }
    if (!pan && (vel.x || vel.y)) { // inercia al soltar el pan
      world.position.set(world.x + vel.x * dt, world.y + vel.y * dt);
      const d = Math.exp(-dt / 260); vel = { x: vel.x * d, y: vel.y * d };
      if (Math.hypot(vel.x, vel.y) < 0.02) vel = { x: 0, y: 0 };
    }
    const fo = follow ? tokens.get(follow) : undefined;
    if (follow && !fo) follow = undefined;
    if (fo) { // cámara que sigue a un token
      const k = world.scale.x, f = reduced ? 1 : 1 - Math.exp(-dt / 220);
      world.position.set(world.x + (app.screen.width / 2 - fo.c.x * k - world.x) * f, world.y + (app.screen.height / 2 - fo.c.y * k - world.y) * f);
    }
    if (!reduced) noiseS.position.set(-200 + 90 * Math.sin(now / 5000), -200 + 90 * Math.cos(now / 6500));
    gridG.alpha = Math.min(1, Math.max(0.12, (world.scale.x - 0.2) / 0.6)); // la cuadrícula se atenúa al alejar
    post.tick(dt);
    if (world.scale.x !== hitK) retarget();
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i], k = (now - p.t0) / 1200;
      if (k >= 1) { p.g.destroy(); pings.splice(i, 1); continue; }
      p.g.clear().circle(0, 0, 10 + 60 * k).stroke({ width: 4 / world.scale.x, color: 0xffffff });
      p.g.alpha = 1 - k;
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i], k = (now - f.t0) / 1200;
      if (k >= 1) { f.t.destroy({ children: true }); floats.splice(i, 1); continue; }
      f.t.y = f.y0 - (reduced ? 0 : 40 * k); f.t.alpha = k < 0.6 ? 1 : (1 - k) / 0.4;
    }
    drawMarks(now); edit.draw();
    for (const [id, w] of tweens) {
      const o = tokens.get(id), k = Math.min(1, (now - w.t0) / w.dur);
      if (!o) { tweens.delete(id); continue; }
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in-out
      o.c.position.set(w.x0 + (w.x1 - w.x0) * e, w.y0 + (w.y1 - w.y0) * e);
      if (now - w.last > 40) { w.last = now; dots.push({ x: o.c.x, y: o.c.y, t0: now, r: tokR(o.t) * 0.6, color: FACTION[o.t.faction] }); }
      if (k >= 1) tweens.delete(id);
    }
    if (dots.length || fades.length || fadeOn) { // estela y rutas
      fadeOn = dots.length + fades.length > 0; fadeG.clear();
      for (let i = dots.length - 1; i >= 0; i--) {
        const d = dots[i], k = (now - d.t0) / 450;
        if (k >= 1) { dots.splice(i, 1); continue; }
        fadeG.circle(d.x, d.y, d.r * (1 - 0.5 * k)).fill({ color: d.color, alpha: 0.3 * (1 - k) });
      }
      for (let i = fades.length - 1; i >= 0; i--) {
        const f = fades[i], k = (now - f.t0) / f.life;
        if (k >= 1) { fades.splice(i, 1); continue; }
        for (let j = 1; j < f.pts.length; j++) dashed(fadeG, f.pts[j - 1], f.pts[j], 10, 7);
        fadeG.stroke({ width: 3, color: f.color, alpha: 0.6 * (1 - k) });
        if (f.wp) for (const p of f.pts) fadeG.circle(p.x, p.y, 5).fill({ color: f.color, alpha: 0.7 * (1 - k) }).stroke({ width: 1.5, color: 0x000000, alpha: 0.5 * (1 - k) });
      }
    }
    for (let i = ephs.length - 1; i >= 0; i--) {
      const k = (now - ephs[i].t0) / 5000;
      if (k >= 1) { ephs[i].g.destroy(); ephs.splice(i, 1); continue; }
      ephs[i].g.alpha = k < 0.8 ? 1 : (1 - k) / 0.2;
    }
    for (const q of cursors.values()) {
      const f = reduced ? 1 : 0.3;
      q.c.x += (q.tx - q.c.x) * f; q.c.y += (q.ty - q.c.y) * f; q.c.scale.set(1 / world.scale.x);
      const idle = now - q.t - 3000; q.c.alpha = idle < 0 ? 1 : Math.max(0, 1 - idle / 500); // se desvanece tras 3 s quieto
    }
    for (const [id, o] of tokens) if (o.fx) {
      const f = o.fx;
      if (!reduced && post.cfg.breathing) f.main.scale.set(tweens.has(id) || drag?.id === id ? 1 : 1 + 0.015 * Math.sin(now / 900 + f.phase)); // respiración en reposo
      if (f.main.rotation !== f.rot) { const d = f.rot - f.main.rotation; f.main.rotation = reduced || Math.abs(d) < 0.01 ? f.rot : f.main.rotation + d * Math.min(1, dt / 140); }
      if (f.hit) { // parpadeo rojo al recibir daño (~450 ms; un solo tinte con movimiento reducido)
        const e = now - f.hit;
        if (e > 450) { f.hit = 0; f.main.tint = f.tint; } else f.main.tint = reduced || Math.floor(e / 70) % 2 === 0 ? 0xff5a5a : f.tint;
      }
      if (reduced) continue;
      if (f.ring) f.ring.rotation = now / 4000;
      if (f.wob) f.main.x = 2.5 * Math.sin(now / 350 + f.phase);
      for (const tk of f.ticks) tk(now);
    }
    if (ptr) { opts.onPointer?.(ptr.x, ptr.y); ptr = undefined; }
    if (cur && glCur !== undefined && glCur !== cur.scene.globalLight) { // transición animada de la luz global
      const g = cur.scene.globalLight;
      glCur = reduced || Math.abs(g - glCur) < 0.004 ? g : glCur + (g - glCur) * (1 - Math.exp(-dt / 350));
      lmDirty = true;
    }
    if (!reduced && lit && lights.size) {
      const t = now / 1000, wind = vfx.wind();
      for (const o of lights.values()) {
        if (!o.anim || o.anim === 'none') continue;
        const p = o.phase;
        let f = 1, al = 1, tint: number | undefined;
        if (o.anim === 'torch') { f = 1 + 0.03 * Math.sin(t * 9 + p) + 0.02 * Math.sin(t * 23 + p * 2); al = 0.93 + 0.07 * Math.sin(t * 17 + p); }
        else if (o.anim === 'pulse') f = al = 1 + 0.05 * Math.sin(t * 2 + p);
        else if (o.anim === 'candle') { const n = 0.5 * Math.sin(t * 5 + p) + 0.3 * Math.sin(t * 13.3 + p * 1.7) + 0.2 * Math.sin(t * 31 + p * 0.3); f = 1 + 0.035 * n; al = 0.85 + 0.15 * n; }
        else if (o.anim === 'magic') { f = 1 + 0.03 * Math.sin(t * 1.5 + p); tint = hueShift(o.color, 45 * Math.sin(t * 0.8 + p)); }
        else { const k = Math.max(0, Math.sin(t * 3.1 + p) * Math.sin(t * 7.7 + p * 2)) ** 3; f = 1 + 0.2 * k; al = 0.3 + 0.7 * k; } // lightning: destellos
        const lean = o.anim === 'torch' || o.anim === 'candle' ? wind * o.base * 0.03 * (1 + 0.5 * Math.sin(t * 3 + p)) : 0; // el viento inclina la llama
        o.spr.forEach((sp, i) => {
          sp.width = sp.height = o.base * f; sp.x = o.x + lean;
          sp.alpha = (i ? 0.22 : 1) * al;
          if (tint !== undefined) sp.tint = tint;
        });
        lmDirty = true;
      }
    }
    if (lmDirty && lit && now - lastLm > 33) { lastLm = now; renderLightmap(); } // ponytail: parpadeo a ~30 fps
  });

  // Extra de Table (no está en api.ts): vista previa de muros propuestos (autodetección); null la quita.
  const previewG = new Graphics(); previewG.eventMode = 'none'; world.addChild(previewG);
  function previewWalls(ws: Wall[] | null) {
    previewG.clear();
    for (const w of ws ?? []) previewG.moveTo(w.a.x, w.a.y).lineTo(w.b.x, w.b.y);
    previewG.stroke({ width: 5, color: AMBER, alpha: 0.85, cap: 'round' });
  }

  function destroy() {
    app.canvas.removeEventListener('wheel', onWheel);
    cancelLong();
    app.canvas.removeEventListener('pointerdown', wpDown, true); window.removeEventListener('keydown', wpKey);
    for (const [n, f] of [['pointerdown', tDown], ['pointermove', tMove], ['pointerup', tUp], ['pointercancel', tUp]] as const) app.canvas.removeEventListener(n, f);
    removeEventListener('keydown', kd); removeEventListener('keydown', ek); removeEventListener('keyup', ku); removeEventListener('lantern:a11y', onA11y);
    for (const m of memories.values()) m.destroy(true);
    mm?.destroy(); vfx.destroy(); post.destroy(); dropVideo(); noiseTex.destroy(true);
    lmRT?.destroy(true); fogRT?.destroy(true);
    for (const t of grads.values()) t.destroy(true);
    grads.clear();
    stone.destroy(true);
    lmRoot.destroy({ children: true }); memRoot.destroy({ children: true }); fogRoot.destroy({ children: true });
    app.destroy(true, { children: true });
  }

  function setLevel(id: Id | undefined, o?: { ghostBelow?: boolean }) {
    const g = !!o?.ghostBelow;
    if (id === level && g === ghost) return;
    level = id; ghost = g;
    if (!raw) return;
    wallsKey = '\0'; regKey = ''; visKey = ''; lmDirty = true; // fuerza redibujar muros, regiones y niebla
    setState(raw);
  }

  return {
    setLevel, focus, fitScene, worldToClient, frameParty, followToken, setRoute,
    cinematic: post.cinematic, getPost: post.get, setPost: post.set,
    measure: (a, b) => { const g = cur?.scene.grid; const cells = g ? gridCells(g, a, b) : 0; return { cells, feet: g ? cells * g.feet : 0 }; },
    setDisplay: (m) => { fixed = m === 'fixed'; pan = undefined; if (fixed) { endDrag(false); cam = undefined; } if (cur) syncTokens(cur.scene); },
    previewWalls, setState, setMarks, ping, floatText, effect: vfx.effect, destroy,
    setTool: (t) => edit.setTool(isDM() || t.tool === 'draw' || t.tool === 'erase' ? t : { tool: 'none' }), onEdit: edit.onEdit,
    drawEphemeral, showGhost, setCursors,
  };
};
