// VFX procedurales (Graphics + partículas propias) y clima de pantalla. Sin texturas externas.
// El ticker propio solo corre mientras haya efectos vivos, clima o sacudida.
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Point, Region, Weather } from '@lantern/protocol';
import type { Effect } from './api.ts';

const TYPE: Record<string, number> = {
  fire: 0xf58a3c, cold: 0x8fd3f5, lightning: 0xf2e45a, acid: 0xa5d65a, poison: 0x6fcb7c, necrotic: 0x9dbb86,
  radiant: 0xffe08a, force: 0xc29cf5, psychic: 0xee8ccb, thunder: 0x8fa6f7,
};
// ---- recetas: efectos data-driven que las extensiones registran y reproducen con playRecipe / effect({recipe}) ----
// color: un valor o una lista (se reparte entre partículas). trail = partículas de estela por fotograma; speed en px/ms.
type RC = number | number[];
export type VfxRecipe = {
  id: string; name: string;
  projectile?: { color: RC; size: number; trail: number; speed: number };
  impact?: { color: RC; particles: number; radius: number; ring: boolean };
  burst?: { color: RC; particles: number; radius: number; ring?: boolean };
};
export type RecipeEffect = Effect & { recipe?: string }; // effect() de Table acepta esto (api.ts no lo declara)
const recipes = new Map<string, VfxRecipe>();
export const registerRecipe = (r: VfxRecipe) => { recipes.set(r.id, r); };
const pick = (c: RC, i: number) => (Array.isArray(c) ? c[i % c.length] : c);
let playFn: ((id: string, from: { x: number; y: number }, to: { x: number; y: number }) => void) | undefined;
/** Reproduce una receta registrada de `from` a `to` (proyectil si lo tiene, luego impacto y ráfaga en `to`). Sin mesa creada no hace nada. */
export const playRecipe = (id: string, from: { x: number; y: number }, to: { x: number; y: number }) => playFn?.(id, from, to);

[
  { id: 'arcoiris-feerico', name: 'Arcoíris feérico',
    projectile: { color: [0xff5d5d, 0xffb84d, 0xfff35c, 0x6fdc6f, 0x5cb8ff, 0xb06cff], size: 6, trail: 3, speed: 1.1 },
    impact: { color: [0xff8ad8, 0xfff35c, 0x8fd3f5, 0x9dffb0], particles: 26, radius: 40, ring: true } },
  { id: 'rayo-sombrio', name: 'Rayo sombrío',
    projectile: { color: [0x6a2a9a, 0x2a1040], size: 5, trail: 4, speed: 1.6 },
    impact: { color: [0x8a3cc8, 0x1a0a28], particles: 20, radius: 44, ring: true },
    burst: { color: [0x2a1040, 0x6a2a9a], particles: 30, radius: 70 } },
  { id: 'enjambre', name: 'Enjambre de insectos',
    projectile: { color: [0x3a2a14, 0x5a4a22, 0x1c1a0e], size: 2, trail: 6, speed: 0.5 },
    impact: { color: [0x3a2a14, 0x6b5b2a], particles: 36, radius: 50, ring: false },
    burst: { color: [0x3a2a14, 0x1c1a0e], particles: 60, radius: 90, ring: false } },
  // escuelas de magia (efecto genérico): clave = 4 primeras letras del nombre, es o en
  ...Object.entries({ abju: 0x6fa8ff, conj: 0xc29cf5, divi: 0xffe08a, ench: 0xee8ccb, evoc: 0xf58a3c, illu: 0xa78bfa, necr: 0x9dbb86, tran: 0xe8a33d }).map(([k, c]): VfxRecipe => ({
    id: 'school-' + k, name: k,
    projectile: { color: [c, 0xffffff], size: 5, trail: 2, speed: 1 },
    impact: { color: [c, 0xffffff], particles: 22, radius: 40, ring: true },
    burst: { color: [c], particles: 34, radius: 80 } })),
].forEach(registerRecipe);
const SCHOOL_ALIAS: Record<string, string> = { enca: 'ench', ilus: 'illu', nigr: 'necr' };
const SPELL_ALIAS: Record<string, string> = {
  'bola de fuego': 'fireball', fireball: 'fireball', 'proyectil magico': 'missile', 'magic missile': 'missile', rayo: 'bolt', 'lightning bolt': 'bolt',
  'curar heridas': 'heal', 'cure wounds': 'heal', 'rayo abrasador': 'scorch', 'scorching ray': 'scorch', 'palabra sanadora': 'word', 'healing word': 'word',
  'toque helado': 'chill', 'chill touch': 'chill', 'descarga sobrenatural': 'eldritch', 'eldritch blast': 'eldritch',
  'llamarada sagrada': 'flame', 'sacred flame': 'flame', 'tormenta de hielo': 'icestorm', 'ice storm': 'icestorm',
};
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const col = (t?: string) => TYPE[t ?? ''] ?? 0xe4dacb; // slashing/piercing/bludgeoning y desconocidos
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const ease = (t: number) => 1 - (1 - t) ** 3;
// ponytail: móvil/equipo modesto = mitad de partículas y mapas de luz/niebla a ⅓; umbrales fijos, sin medir FPS
export const LITE = (navigator.hardwareConcurrency || 8) <= 4 || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900);
const F = LITE ? 0.5 : 1;
const MAX_P = 600 * F, MAX_W = 400;

type P = { top?: boolean; x: number; y: number; vx: number; vy: number; age: number; life: number; r: number; c: number; add: boolean; g: number; d: number; a: number; upd?: (p: P, dt: number) => void };
type Anim = (dt: number, add: Graphics, nrm: Graphics) => boolean; // false = terminada
type W = { x: number; y: number; gy: number; z: number; ph: number; s: number; rot: number };

function softTexture(): Texture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!, g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return Texture.from(c);
}

// topL: capa sobre la luz y bajo la niebla (efectos persistentes de región: llamas, humo de oscuridad…)
export function createVfx(app: Application, world: Container, fxL: Container, reduced: boolean, topL: Container) {
  const nrmG = new Graphics(), addG = new Graphics();
  addG.blendMode = 'add';
  fxL.addChild(nrmG, addG);
  // capa de pantalla (fuera del mundo, por encima de la niebla)
  const screenL = new Container(), fogL = new Container(), wG = new Graphics(), wA = new Graphics(), flashG = new Graphics();
  wA.blendMode = 'add';
  screenL.eventMode = 'none';
  screenL.addChild(fogL, wG, wA, flashG);
  app.stage.addChild(screenL);
  const soft = softTexture();
  const regG = new Graphics(), tN = new Graphics(), tA = new Graphics();
  tA.blendMode = 'add';
  topL.addChild(regG, tN, tA);

  let enabled = true, running = false;
  const parts: P[] = [], anims: Anim[] = [];

  // ---- partículas ----
  const emit = (p: Partial<P> & { x: number; y: number; life: number; c: number }) => {
    if (parts.length >= MAX_P) return;
    parts.push({ vx: 0, vy: 0, age: 0, r: 2, add: true, g: 0, d: 0, a: 1, ...p });
    wake();
  };
  const radial = (x: number, y: number, n: number, c: number, sp: number, life: number, r = 2, extra: Partial<P> = {}) => {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), v = sp * rnd(0.3, 1);
      emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * rnd(0.6, 1), c, r: r * rnd(0.6, 1.3), d: 2.5, ...extra });
    }
  };
  const add = (a: Anim) => { anims.push(a); wake(); };
  const timed = (ms: number, f: (k: number, add: Graphics, nrm: Graphics) => void): Anim => {
    let t = 0;
    return (dt, ad, nr) => { t += dt; if (t >= ms) return false; f(t / ms, ad, nr); return true; };
  };
  const flash = (x: number, y: number, r: number, c: number, ms: number) =>
    add(timed(ms, (k, ad) => { ad.circle(x, y, r * (0.6 + 0.4 * k)).fill({ color: c, alpha: 0.7 * (1 - k) }); ad.circle(x, y, r * 0.4).fill({ color: 0xffffff, alpha: 0.6 * (1 - k) }); }));

  // ---- sacudida ----
  let shakeT = 0, shakeAmp = 0, so = { x: 0, y: 0 };
  const shake = (ms: number, px: number) => { if (!reduced) { shakeT = ms; shakeAmp = px; wake(); } };
  // zoom breve hacia el centro de pantalla (crítico): se aplica como delta multiplicativo, como la sacudida
  let zT = 0, zD = 1, zAmp = 0, zf = 1;
  const punch = (amp: number, ms: number) => { if (!reduced) { zT = zD = ms; zAmp = amp; wake(); } };
  const later = (ms: number, f: () => void) => { let t = 0; add((dt) => { t += dt; if (t < ms) return true; f(); return false; }); };

  // ---- efectos ----
  function impact(at: { x: number; y: number }, type?: string, crit = false) {
    const c = col(type), R = crit ? 60 : 34;
    if (reduced) return flash(at.x, at.y, R, c, 150);
    flash(at.x, at.y, R, c, 250);
    add(timed(500, (k, ad) => ad.circle(at.x, at.y, R * (0.3 + ease(k))).stroke({ width: crit ? 4 : 2, color: c, alpha: 0.8 * (1 - k) })));
    radial(at.x, at.y, crit ? 34 : 16, c, crit ? 260 : 170, 500, crit ? 3.5 : 2.5);
    if (crit) { radial(at.x, at.y, 10, 0xffffff, 200, 350, 2); shake(200, 6); punch(0.05, 300); }
  }

  function projectile(e: Extract<Effect, { kind: 'projectile' }>) {
    const { from: a, to: b } = e, c = col(e.damageType), type = e.damageType ?? '';
    const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
    if (type === 'lightning') { // rayo quebrado instantáneo que parpadea
      let pts: number[] = [], last = -99, t = 0;
      const gen = () => {
        pts = [a.x, a.y];
        const n = Math.max(3, Math.round(dist / 18));
        for (let i = 1; i < n; i++) { const j = rnd(-16, 16); pts.push(a.x + dx * i / n - uy * j, a.y + dy * i / n + ux * j); }
        pts.push(b.x, b.y);
      };
      impact(b, type);
      return add((dt, ad) => {
        t += dt; if (t > 260) return false;
        if (t - last > 45) { last = t; gen(); }
        const al = reduced ? 0.6 : Math.random() < 0.25 ? 0.25 : 1;
        ad.poly(pts, false).stroke({ width: 9, color: c, alpha: 0.25 * al }).poly(pts, false).stroke({ width: 2, color: 0xffffff, alpha: al });
        return true;
      });
    }
    const ms = Math.min(700, Math.max(150, dist / 0.9)); // ~350 ms a 315 px; velocidad fija
    const phys = !(type in TYPE);
    let t = 0;
    add((dt, ad) => {
      t += dt;
      const k = Math.min(1, t / ms), x = a.x + dx * k, y = a.y + dy * k;
      if (type === 'radiant') { // haz que barre
        const x0 = a.x + dx * Math.max(0, k - 0.35), y0 = a.y + dy * Math.max(0, k - 0.35);
        ad.moveTo(x0, y0).lineTo(x, y).stroke({ width: 12, color: c, alpha: 0.3 }).moveTo(x0, y0).lineTo(x, y).stroke({ width: 4, color: 0xfff4d0 });
      } else if (phys) { // flecha / virote
        const tx = x - ux * 26, ty = y - uy * 26;
        ad.moveTo(tx, ty).lineTo(x, y).stroke({ width: 2, color: c });
        ad.poly([x + ux * 5, y + uy * 5, x - ux * 3 - uy * 3, y - uy * 3 + ux * 3, x - ux * 3 + uy * 3, y - uy * 3 - ux * 3]).fill(c);
      } else if (type === 'force') { // dardo violeta
        ad.moveTo(x - ux * 22, y - uy * 22).lineTo(x, y).stroke({ width: 7, color: c, alpha: 0.35 }).moveTo(x - ux * 22, y - uy * 22).lineTo(x, y).stroke({ width: 2.5, color: 0xf0e4ff });
      } else if (type === 'cold') { // esquirla
        ad.poly([x + ux * 12, y + uy * 12, x - uy * 4, y + ux * 4, x - ux * 9, y - uy * 9, x + uy * 4, y - ux * 4]).fill(0xe8f8ff).stroke({ width: 1.5, color: c });
        if (!reduced) emit({ x, y, vx: rnd(-20, 20), vy: rnd(-20, 20), life: 350, c: 0xdff4ff, r: 1.6 });
      } else { // bola (fuego y el resto de elementos)
        ad.circle(x, y, 16).fill({ color: c, alpha: 0.25 }).circle(x, y, 8).fill(c).circle(x, y, 4).fill(type === 'fire' ? 0xfff2b0 : 0xffffff);
        if (!reduced) for (let i = 0; i < 2; i++) emit({ x, y, vx: rnd(-40, 40) - ux * 60, vy: rnd(-40, 40) - uy * 60, life: rnd(250, 450), c, r: rnd(1.5, 3.5), d: 1 });
      }
      if (k < 1) return true;
      impact(b, type);
      return false;
    });
  }

  function burst(e: Extract<Effect, { kind: 'burst' }>) {
    const { at, radius: R } = e, c = col(e.damageType), fire = e.damageType === 'fire';
    if (reduced) return flash(at.x, at.y, R * 0.6, c, 150);
    add(timed(900, (k, ad, nr) => {
      const grow = ease(Math.min(1, k * 900 / 300)), r = R * grow, fade = k < 0.33 ? 1 : 1 - (k - 0.33) / 0.67;
      if (fire) {
        ad.circle(at.x, at.y, r).fill({ color: c, alpha: 0.35 * fade });
        ad.circle(at.x, at.y, r * 0.65).fill({ color: 0xffb040, alpha: 0.4 * fade });
        ad.circle(at.x, at.y, r * 0.35 * (1 - k * 0.5)).fill({ color: 0xfff2b0, alpha: 0.85 * fade });
        ad.circle(at.x, at.y, r * 0.15).fill({ color: 0xffffff, alpha: fade });
      } else ad.circle(at.x, at.y, r).fill({ color: c, alpha: 0.25 * fade });
      ad.circle(at.x, at.y, r).stroke({ width: 5, color: c, alpha: 0.9 * fade });
      if (fire) nr.circle(at.x, at.y, r).fill({ color: 0x1a1008, alpha: 0.18 * fade });
    }));
    for (let i = 0; i < 40; i++) {
      const a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * R * 0.9;
      emit({ x: at.x + Math.cos(a) * d * 0.3, y: at.y + Math.sin(a) * d * 0.3, vx: Math.cos(a) * d * 2.5, vy: Math.sin(a) * d * 2.5, life: rnd(500, 900), c: fire ? (Math.random() < 0.5 ? 0xffd070 : c) : c, r: rnd(2, 4), d: 3 });
    }
    if (fire) for (let i = 0; i < 18; i++) {
      const a = rnd(0, 6.283), d = rnd(0.2, 0.8) * R;
      emit({ x: at.x + Math.cos(a) * d, y: at.y + Math.sin(a) * d, vy: -rnd(15, 40), vx: rnd(-10, 10), life: rnd(700, 1100), c: 0x3a322c, r: rnd(8, 16), add: false, a: 0.35, d: 0.5, upd: (p) => { p.r += 0.15; } });
    }
  }

  function heal(at: { x: number; y: number }) {
    if (reduced) return flash(at.x, at.y, 30, 0x6fcb7c, 150);
    flash(at.x, at.y, 34, 0xf5c877, 300);
    for (let i = 0; i < 28; i++) {
      const a0 = rnd(0, 6.283), rad = rnd(10, 30), sp = rnd(3, 5), rise = rnd(40, 80), life = rnd(900, 1300);
      emit({ x: at.x, y: at.y, life, c: i % 2 ? 0x6fcb7c : 0xf5c877, r: rnd(1.8, 3.2), upd: (p) => {
        const k = p.age / life;
        p.x = at.x + Math.cos(a0 + k * sp) * rad * (1 - 0.3 * k); p.y = at.y + 10 - rise * k + Math.sin(a0 + k * sp) * rad * 0.3;
      } });
    }
  }

  function miss(at: { x: number; y: number }) {
    if (reduced) return flash(at.x, at.y, 24, 0x9a9a9a, 150);
    const t = new Text({ text: '¡Falla!', style: { fontFamily: 'Georgia, serif', fontSize: 22, fontStyle: 'italic', fill: '#cfc6b8', stroke: { color: '#1a0f08', width: 4 } } });
    t.anchor.set(0.5); fxL.addChild(t);
    radial(at.x, at.y, 8, 0x8a8580, 70, 600, 5, { add: false, a: 0.4 });
    let n = 0;
    add((dt) => {
      n += dt;
      if (n > 900) { t.destroy(); return false; }
      t.position.set(at.x, at.y - 24 - 22 * ease(n / 900)); t.alpha = 0.7 * (1 - n / 900);
      return true;
    });
  }

  function fumble(at: { x: number; y: number }) {
    if (reduced) return flash(at.x, at.y, 24, 0x9a9a9a, 150);
    const t = new Text({ text: '¡Tropiezo!', style: { fontFamily: 'Georgia, serif', fontSize: 22, fontStyle: 'italic', fill: '#e6c48a', stroke: { color: '#1a0f08', width: 4 } } });
    t.anchor.set(0.5); fxL.addChild(t);
    for (let i = 0; i < 10; i++) emit({ x: at.x + rnd(-14, 14), y: at.y + 14, vx: rnd(-90, 90), vy: -rnd(10, 50), g: 60, life: rnd(400, 700), c: 0x8a7a64, r: rnd(3, 6), add: false, a: 0.5, d: 1 });
    let n = 0;
    add((dt, ad) => {
      n += dt;
      if (n > 1100) { t.destroy(); return false; }
      const k = n / 1100;
      t.position.set(at.x, at.y - 26 - 10 * ease(k)); t.rotation = 0.35 * Math.sin(k * 18) * (1 - k); t.alpha = k < 0.7 ? 1 : (1 - k) / 0.3;
      for (let i = 0; i < 3; i++) { const a = k * 9 + (i * 6.283) / 3; ad.star(at.x + Math.cos(a) * 20, at.y - 20 + Math.sin(a) * 6, 4, 3, 1.4).fill({ color: 0xffe08a, alpha: 1 - k }); }
      return true;
    });
  }

  // haz breve entre dos puntos
  const beam = (a: Point, b: Point, c: number, w: number, ms: number) =>
    add(timed(ms, (k, ad) => { const f = 1 - k; ad.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: w * (0.5 + f), color: c, alpha: 0.35 * f }).moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: Math.max(1.5, w * 0.3 * f), color: 0xffffff, alpha: f }); }));
  const travel = (a: Point, b: Point) => Math.min(700, Math.max(150, Math.hypot(b.x - a.x, b.y - a.y) / 0.9));
  const SPELLS: Record<string, (a: Point, b: Point, R: number) => void> = {
    fireball(a, b, R) { projectile({ kind: 'projectile', from: a, to: b, damageType: 'fire' }); later(travel(a, b), () => { burst({ kind: 'burst', at: b, radius: R, damageType: 'fire' }); shake(250, 4); }); },
    missile(a, b) { for (let i = 0; i < 3; i++) later(i * 130, () => projectile({ kind: 'projectile', from: a, to: { x: b.x + rnd(-14, 14), y: b.y + rnd(-14, 14) }, damageType: 'force' })); },
    bolt(a, b) { projectile({ kind: 'projectile', from: a, to: b, damageType: 'lightning' }); flash(b.x, b.y, 70, 0xf2e45a, 320); shake(220, 5); later(120, () => beam(a, b, 0x8fa6f7, 14, 200)); },
    heal(_, b) { heal(b); later(250, () => radial(b.x, b.y, 10, 0xfff4d0, 60, 700, 2.4, { vy: -50 })); },
    word(a, b) {
      for (let i = 0; i < 14; i++) { const k = i / 14; emit({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, life: 500 + i * 30, c: i % 2 ? 0xfff4d0 : 0xf5c877, r: 2.4, vy: -30, d: 1 }); }
      later(300, () => heal(b));
    },
    scorch(a, b) { for (let i = 0; i < 3; i++) later(i * 120, () => { const j = { x: b.x + rnd(-18, 18), y: b.y + rnd(-18, 18) }; beam(a, j, 0xf58a3c, 10, 220); impact(j, 'fire'); }); },
    chill(a, b) { projectile({ kind: 'projectile', from: a, to: b, damageType: 'necrotic' }); later(travel(a, b), () => { impact(b, 'cold'); radial(b.x, b.y, 14, 0xdff4ff, 90, 900, 2.4, { g: -20 }); }); },
    eldritch(a, b) {
      beam(a, b, 0xc29cf5, 16, 380); impact(b, 'force');
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
      for (let i = 0; i < 24 * F; i++) { const k = Math.random(), o = Math.sin(k * 40) * 8; emit({ x: a.x + (b.x - a.x) * k - uy * o, y: a.y + (b.y - a.y) * k + ux * o, life: rnd(300, 500), c: 0xe4d0ff, r: 2, d: 2 }); }
    },
    flame(_, b) {
      add(timed(650, (k, ad) => { const f = 1 - k, w = 26 * (0.4 + f); ad.rect(b.x - w / 2, b.y - 420, w, 420).fill({ color: 0xffe08a, alpha: 0.3 * f }).rect(b.x - w / 5, b.y - 420, w / 2.5, 420).fill({ color: 0xffffff, alpha: 0.8 * f }); }));
      flash(b.x, b.y, 44, 0xffe08a, 500); impact(b, 'radiant');
      radial(b.x, b.y, 16, 0xfff4d0, 80, 800, 2.4, { vy: -70, d: 1 });
    },
    icestorm(_, b, R) {
      let t = 0;
      add(timed(1600, (k, ad) => ad.circle(b.x, b.y, R).fill({ color: 0x8fd3f5, alpha: 0.14 * (1 - k) }).stroke({ width: 3, color: 0xdff4ff, alpha: 0.7 * (1 - k) })));
      add((dt) => {
        t += dt; if (t > 1500) return false;
        for (let i = 0; i < 3 * F; i++) { const a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * R; emit({ x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d - 90, vy: 380, life: 240, c: 0xe8f8ff, r: rnd(1.5, 3) }); }
        return true;
      });
      later(1300, () => impact(b, 'cold'));
    },
  };
  function spell(e: Extract<Effect, { kind: 'spell' }>) {
    const f = SPELLS[SPELL_ALIAS[norm(e.spell)]], R = e.radius ?? 100;
    if (f && !reduced) return f(e.from, e.to, R);
    const sk = norm(e.school ?? '').slice(0, 4), r = recipes.get('school-' + (SCHOOL_ALIAS[sk] ?? sk));
    if (r) return R > 100 ? (recipeProjectile(r, e.from, e.to), later(travel(e.from, e.to), () => recipeBurst(r, e.to, R))) : recipeProjectile(r, e.from, e.to);
    projectile({ kind: 'projectile', from: e.from, to: e.to });
  }

  // ---- efectos persistentes en bucle dentro de regiones (fx de la región; darkness = humo) ----
  type RF = { poly: Point[]; fx: string; x0: number; y0: number; x1: number; y1: number; area: number; acc: number };
  let rfx: RF[] = [], regList: Region[] = [];
  const inPoly = (p: Point, poly: Point[]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
      if ((poly[i].y > p.y) !== (poly[j].y > p.y) && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
    return c;
  };
  const inside = (r: RF): Point => {
    for (let i = 0; i < 8; i++) { const p = { x: rnd(r.x0, r.x1), y: rnd(r.y0, r.y1) }; if (inPoly(p, r.poly)) return p; }
    return r.poly[0];
  };
  const edgePt = (r: RF): Point => { const i = Math.floor(Math.random() * r.poly.length), a = r.poly[i], b = r.poly[(i + 1) % r.poly.length], k = Math.random(); return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }; };
  function buildRegions() {
    regG.clear(); rfx = [];
    if (!enabled) return;
    for (const r of regList) {
      const fx = r.fx ?? (r.kind === 'darkness' ? 'smoke' : ''); if (!fx || r.points.length < 3) continue;
      const xs = r.points.map((p) => p.x), ys = r.points.map((p) => p.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const q: RF = { poly: r.points, fx, x0, y0, x1, y1, area: (x1 - x0) * (y1 - y0), acc: 0 };
      rfx.push(q);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, pf = r.points.flatMap((p) => [p.x, p.y]);
      if (fx === 'web') { // telaraña: radios y anillos concéntricos
        for (const k of [1, 0.65, 0.35]) regG.poly(r.points.flatMap((p) => [cx + (p.x - cx) * k, cy + (p.y - cy) * k])).stroke({ width: 1, color: 0xf0f0f0, alpha: 0.4 });
        for (const p of r.points) regG.moveTo(cx, cy).lineTo(p.x, p.y);
        regG.stroke({ width: 1, color: 0xf0f0f0, alpha: 0.4 });
      } else if (fx === 'brambles') { // zarzas: bordes con espinas
        r.points.forEach((a, i) => {
          const b = r.points[(i + 1) % r.points.length], L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.round(L / 10);
          for (let j = 0; j < n; j++) { const k = j / n, x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, s = j % 2 ? 1 : -1; regG.moveTo(x, y).lineTo(x + s * 7 * ((b.y - a.y) / L), y - s * 7 * ((b.x - a.x) / L)); }
        });
        regG.stroke({ width: 1.5, color: 0x4f7a34, alpha: 0.9 });
        regG.poly(pf).fill({ color: 0x2f4a20, alpha: 0.22 }).stroke({ width: 3, color: 0x3d5a2a, alpha: 0.8 });
      } else if (fx === 'ice') {
        regG.poly(pf).fill({ color: 0x8fd3f5, alpha: 0.16 });
        for (let i = 0; i < Math.min(30, q.area / 3000 + 4); i++) { const c = inside(q), s = rnd(6, 14); regG.poly([c.x, c.y - s, c.x + s * 0.5, c.y, c.x, c.y + s, c.x - s * 0.5, c.y]).fill({ color: 0xdff4ff, alpha: 0.35 }).stroke({ width: 1, color: 0xffffff, alpha: 0.6 }); }
      } else if (fx === 'fire') regG.poly(pf).fill({ color: 0xf58a3c, alpha: 0.1 });
      else if (fx === 'fog' && reduced) for (let i = 0; i < 6; i++) { const c = inside(q); regG.circle(c.x, c.y, 26).fill({ color: 0xd8dde2, alpha: 0.1 }); }
    }
    if (rfx.length && !reduced) wake();
  }
  function tickRegions(dt: number) {
    tN.clear(); tA.clear();
    if (reduced || !rfx.length) return;
    const wind = wx.wind;
    for (const r of rfx) {
      const rate = Math.min(60, Math.max(4, r.area / 3500)) * F * (r.fx === 'smoke' || r.fx === 'fog' ? 0.25 : r.fx === 'ice' ? 0.4 : r.fx === 'fire' ? 1.5 : 0);
      r.acc += (rate * dt) / 1000;
      for (; r.acc >= 1; r.acc--) {
        if (parts.length > MAX_P * 0.6) break;
        if (r.fx === 'fire') { const p = inside(r); emit({ top: true, x: p.x, y: p.y, vx: wind * 50 + rnd(-8, 8), vy: -rnd(30, 70), life: rnd(500, 900), c: [0xff7a20, 0xffc060, 0xffe0a0][Math.floor(rnd(0, 3))], r: rnd(2, 5), d: 0.5 }); }
        else if (r.fx === 'ice') { const p = inside(r); emit({ top: true, x: p.x, y: p.y, life: rnd(600, 1000), c: 0xe8f8ff, r: rnd(1, 2.2) }); }
        else if (r.fx === 'fog') { const p = inside(r); emit({ top: true, x: p.x, y: p.y, vx: rnd(-8, 8) + wind * 15, vy: rnd(-5, 5), life: rnd(3000, 5000), c: 0xd8dde2, r: rnd(14, 26), add: false, a: 0.1, d: 0.2, upd: (q) => { q.r += 0.05; } }); }
        else { const p = edgePt(r), cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, a = Math.atan2(p.y - cy, p.x - cx); emit({ top: true, x: p.x, y: p.y, vx: Math.cos(a) * 6 + rnd(-5, 5), vy: Math.sin(a) * 6 + rnd(-5, 5), life: rnd(3000, 4500), c: 0x120a1a, r: rnd(18, 30), add: false, a: 0.5, d: 0.2, upd: (q) => { q.r += 0.04; } }); }
      }
    }
  }

  function recipeImpact(r: VfxRecipe, at: { x: number; y: number }) {
    const i = r.impact, b = r.burst;
    if (i) {
      if (reduced) flash(at.x, at.y, i.radius, pick(i.color, 0), 150);
      else {
        flash(at.x, at.y, i.radius, pick(i.color, 0), 250);
        if (i.ring) add(timed(500, (k, ad) => ad.circle(at.x, at.y, i.radius * (0.3 + ease(k))).stroke({ width: 2, color: pick(i.color, 1), alpha: 0.8 * (1 - k) })));
        for (let n = 0; n < i.particles * F; n++) radial(at.x, at.y, 1, pick(i.color, n), i.radius * 4, 500, 2.5);
      }
    }
    if (b) recipeBurst(r, at, b.radius);
  }
  function recipeBurst(r: VfxRecipe, at: { x: number; y: number }, R: number) {
    const b = r.burst ?? r.impact; if (!b) return;
    const c0 = pick(b.color, 0);
    if (reduced) return flash(at.x, at.y, R * 0.6, c0, 150);
    add(timed(800, (k, ad) => { const g = R * ease(Math.min(1, k * 2.5)), f = 1 - k; ad.circle(at.x, at.y, g).fill({ color: c0, alpha: 0.25 * f }); if ('ring' in b && b.ring !== false) ad.circle(at.x, at.y, g).stroke({ width: 4, color: pick(b.color, 1), alpha: 0.9 * f }); }));
    for (let n = 0; n < b.particles * F; n++) {
      const a = rnd(0, 6.283), d = Math.sqrt(Math.random()) * R;
      emit({ x: at.x, y: at.y, vx: Math.cos(a) * d * 2.5, vy: Math.sin(a) * d * 2.5, life: rnd(500, 900), c: pick(b.color, n), r: rnd(2, 4), d: 3 });
    }
  }
  function recipeProjectile(r: VfxRecipe, a: { x: number; y: number }, b: { x: number; y: number }) {
    const p = r.projectile;
    if (!p) return recipeImpact(r, b);
    const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 1, ms = Math.min(900, Math.max(120, dist / p.speed));
    let t = 0;
    add((dt, ad) => {
      t += dt;
      const k = Math.min(1, t / ms), x = a.x + dx * k, y = a.y + dy * k;
      ad.circle(x, y, p.size * 2).fill({ color: pick(p.color, 0), alpha: 0.25 }).circle(x, y, p.size).fill(pick(p.color, Math.floor(t / 60)));
      if (!reduced) for (let i = 0; i < p.trail; i++) emit({ x, y, vx: rnd(-50, 50), vy: rnd(-50, 50), life: rnd(250, 450), c: pick(p.color, i + Math.floor(t / 40)), r: rnd(1, p.size * 0.6 + 1), d: 1 });
      if (k < 1) return true;
      recipeImpact(r, b);
      return false;
    });
  }
  playFn = (id, from, to) => { const r = recipes.get(id); if (enabled && r) recipeProjectile(r, from, to); };

  function effect(e: RecipeEffect) {
    if (!enabled) return;
    const r = e.recipe ? recipes.get(e.recipe) : undefined;
    if (r) {
      if (e.kind === 'projectile') return recipeProjectile(r, e.from, e.to);
      if (e.kind === 'burst') return recipeBurst(r, e.at, e.radius);
      if (e.kind === 'impact') return recipeImpact(r, e.at);
    }
    if (e.kind === 'projectile') projectile(e);
    else if (e.kind === 'impact') impact(e.at, e.damageType, e.crit);
    else if (e.kind === 'burst') burst(e);
    else if (e.kind === 'heal') heal(e.at);
    else if (e.kind === 'fumble') fumble(e.at);
    else if (e.kind === 'spell') spell(e);
    else miss(e.at);
  }

  // ---- clima ----
  let wx: Weather = { kind: 'none', intensity: 0, wind: 0 }, wKey = 'none', ws: W[] = [];
  const banks: { s: Sprite; v: number }[] = [];
  const splashes: { x: number; y: number; age: number }[] = [];
  let nextBolt = 0, boltT = 1e9;
  const N_MAX = { rain: 400, storm: 400, snow: 250, ash: 250, leaves: 60, embers: 150, fireflies: 60, sand: 300, dust: 120, fog: 0, none: 0 };
  const scr = () => app.screen;

  function clearWeather() {
    ws = []; splashes.length = 0; fogL.removeChildren().forEach((c) => c.destroy()); banks.length = 0;
    wG.clear(); wA.clear(); flashG.clear(); boltT = 1e9;
  }
  function setWeather(w?: Weather) {
    const k = w && enabled && w.kind !== 'none' ? `${w.kind}|${w.intensity.toFixed(2)}|${w.wind.toFixed(2)}` : 'none';
    if (k === wKey) return;
    const kindChanged = k.split('|')[0] !== wKey.split('|')[0];
    wKey = k;
    if (k === 'none') { clearWeather(); wx = { kind: 'none', intensity: 0, wind: 0 }; return; }
    wx = w!;
    const I = Math.min(1, Math.max(0.05, wx.intensity)), n = Math.round(N_MAX[wx.kind] * I * F), { width: W0, height: H0 } = scr();
    if (kindChanged || ws.length === 0 && wx.kind !== 'fog') {
      clearWeather();
      nextBolt = rnd(6000, 14000);
    }
    if (wx.kind === 'fog') {
      if (!banks.length) for (let i = 0; i < 4; i++) {
        const s = new Sprite(soft); s.anchor.set(0.5); s.tint = 0xc9d0d6;
        s.position.set(rnd(0, W0), rnd(H0 * 0.15, H0 * 0.85)); s.width = W0 * rnd(0.8, 1.3); s.height = H0 * rnd(0.4, 0.7);
        fogL.addChild(s); banks.push({ s, v: rnd(0.6, 1.4) });
      }
      banks.forEach((b) => { b.s.alpha = 0.12 + 0.4 * I; });
    } else {
      while (ws.length < n) ws.push({ x: rnd(0, W0), y: rnd(0, H0), gy: rnd(H0 * 0.3, H0), z: Math.random(), ph: rnd(0, 6.283), s: rnd(0.6, 1.4), rot: rnd(0, 6.283) });
      ws.length = n;
    }
    wake();
    if (reduced) frame(0); // estático: un fotograma
  }

  function frame(dtMs: number) {
    const { width: W0, height: H0 } = scr(), sp = reduced ? 0.03 : 1, dt = (dtMs / 1000) * sp, now = performance.now() / 1000;
    const k = wx.kind, wind = wx.wind, I = Math.min(1, Math.max(0.05, wx.intensity));
    wG.clear(); wA.clear(); flashG.clear();
    if (k === 'fog') {
      for (const b of banks) {
        b.s.x += (wind < 0 ? -1 : 1) * (8 + 30 * Math.abs(wind)) * b.v * dt;
        const hw = b.s.width / 2;
        if (b.s.x - hw > W0) b.s.x = -hw; else if (b.s.x + hw < 0) b.s.x = W0 + hw;
      }
    } else if (k === 'rain' || k === 'storm') {
      const st = k === 'storm', vy0 = st ? 1400 : 1000, vx0 = (st ? 200 : 100) + wind * (st ? 600 : 350);
      for (const p of ws) {
        const vy = vy0 * (0.75 + 0.5 * p.z), vx = vx0 * (0.75 + 0.5 * p.z);
        p.x += vx * dt; p.y += vy * dt;
        if (p.y > p.gy) {
          if (!reduced && splashes.length < 40 && Math.random() < 0.4) splashes.push({ x: p.x, y: p.gy, age: 0 });
          p.y = -rnd(0, 80); p.gy = rnd(H0 * 0.3, H0); p.x = rnd(-100, W0 + 100);
        }
        if (p.x > W0 + 100) p.x -= W0 + 200; else if (p.x < -100) p.x += W0 + 200;
        wG.moveTo(p.x, p.y).lineTo(p.x - vx * 0.03, p.y - vy * 0.03);
      }
      wG.stroke({ width: st ? 1.4 : 1, color: 0xb8cbe0, alpha: 0.28 + 0.2 * I });
      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i]; s.age += dtMs;
        if (s.age > 300) { splashes.splice(i, 1); continue; }
        const q = s.age / 300;
        wG.ellipse(s.x, s.y, 2 + 6 * q, 1 + 2.5 * q).stroke({ width: 1, color: 0xcfe0f0, alpha: 0.35 * (1 - q) });
      }
      if (st) {
        nextBolt -= dtMs;
        if (nextBolt <= 0) {
          nextBolt = rnd(6000, 14000); boltT = 0;
          window.dispatchEvent(new CustomEvent('lantern:thunder', { detail: { intensity: I } }));
        }
      }
    } else if (k === 'snow' || k === 'ash') {
      const snow = k === 'snow';
      for (const p of ws) {
        p.y += (snow ? 30 + 50 * p.z : 40 + 50 * p.z) * dt;
        p.x += (wind * (snow ? 60 : 90) + Math.sin(now * (snow ? 1 : 0.6) + p.ph) * (snow ? 22 : 8)) * dt;
        if (p.y > H0 + 6) { p.y = -6; p.x = rnd(0, W0); }
        if (p.x > W0 + 6) p.x = -6; else if (p.x < -6) p.x = W0 + 6;
        if (snow) wG.circle(p.x, p.y, 1.2 + 2.2 * p.z * p.s).fill({ color: 0xf4f8ff, alpha: 0.55 + 0.35 * p.z });
        else wG.circle(p.x, p.y, 0.9 + 1.2 * p.s).fill({ color: 0x9a9690, alpha: 0.35 + 0.35 * p.z });
      }
    } else if (k === 'leaves') {
      for (const p of ws) {
        p.y += (50 + 60 * p.z) * dt; p.rot += (1 + p.s) * dt * 2;
        p.x += (wind * 120 + Math.sin(now * 0.8 + p.ph) * 40) * dt;
        if (p.y > H0 + 10) { p.y = -10; p.x = rnd(0, W0); }
        if (p.x > W0 + 10) p.x = -10; else if (p.x < -10) p.x = W0 + 10;
        const L = 5 + 3 * p.s, c = Math.cos(p.rot), s = Math.sin(p.rot), w = Math.abs(Math.cos(p.rot * 0.7)) * 0.6 + 0.3;
        wG.poly([p.x + c * L, p.y + s * L, p.x - s * L * w, p.y + c * L * w, p.x - c * L, p.y - s * L, p.x + s * L * w, p.y - c * L * w])
          .fill({ color: p.z < 0.5 ? 0xb8792e : 0x9c5f22, alpha: 0.85 });
      }
    } else if (k === 'fireflies') {
      for (const p of ws) {
        p.rot += Math.sin(now * 0.7 + p.ph) * dt * 2.5;
        p.x += (Math.cos(p.rot) * 22 + wind * 20) * dt; p.y += Math.sin(p.rot) * 16 * dt;
        if (p.x > W0 + 8) p.x = -8; else if (p.x < -8) p.x = W0 + 8;
        if (p.y > H0 + 8) p.y = -8; else if (p.y < -8) p.y = H0 + 8;
        const fl = Math.max(0, Math.sin(now * 1.6 + p.ph * 3)) ** 2;
        wA.circle(p.x, p.y, 8 * p.s).fill({ color: 0xd8ff6a, alpha: 0.14 * fl }).circle(p.x, p.y, 1.8 * p.s).fill({ color: 0xf4ffb0, alpha: 0.9 * fl });
      }
    } else if (k === 'sand') {
      const dir = wind < 0 ? -1 : 1;
      wG.rect(0, 0, W0, H0).fill({ color: 0xc9a566, alpha: 0.04 + 0.1 * I });
      for (const p of ws) {
        p.x += dir * (220 + 280 * p.z + 400 * Math.abs(wind)) * dt; p.y += Math.sin(now + p.ph) * 18 * dt;
        if (p.x > W0 + 30) { p.x = -30; p.y = rnd(0, H0); } else if (p.x < -30) { p.x = W0 + 30; p.y = rnd(0, H0); }
        wG.moveTo(p.x, p.y).lineTo(p.x - dir * (10 + 14 * p.z), p.y + 1);
      }
      wG.stroke({ width: 1.2, color: 0xdcbc82, alpha: 0.25 + 0.25 * I });
    } else if (k === 'dust') { // motas y haces de luz oblicuos: las motas dentro de un haz brillan
      const xs = [0.2, 0.5, 0.78].map((f, i) => W0 * f + 40 * Math.sin(now * 0.1 + i * 2)), sl = H0 * 0.5;
      xs.forEach((x0, i) => wA.poly([x0, 0, x0 + 90 + 30 * i, 0, x0 + 90 + 30 * i + sl, H0, x0 + sl, H0]).fill({ color: 0xfff0c8, alpha: 0.015 + 0.025 * I }));
      for (const p of ws) {
        p.x += (wind * 30 + Math.sin(now * 0.4 + p.ph) * 8) * dt; p.y += (Math.cos(now * 0.3 + p.ph) * 6 - 3) * dt;
        if (p.x > W0 + 4) p.x = -4; else if (p.x < -4) p.x = W0 + 4;
        if (p.y > H0 + 4) p.y = -4; else if (p.y < -4) p.y = H0 + 4;
        const lit = xs.some((x0, i) => { const l = x0 + (p.y / H0) * sl; return p.x > l && p.x < l + 90 + 30 * i; });
        wA.circle(p.x, p.y, (lit ? 1.6 : 1) * p.s).fill({ color: 0xfff4d8, alpha: lit ? 0.45 + 0.4 * Math.abs(Math.sin(now + p.ph)) : 0.12 });
      }
    } else if (k === 'embers') {
      for (const p of ws) {
        p.y -= (40 + 70 * p.z) * dt;
        p.x += (wind * 60 + Math.sin(now * 1.5 + p.ph) * 18) * dt;
        if (p.y < -6) { p.y = H0 + 6; p.x = rnd(0, W0); }
        if (p.x > W0 + 6) p.x = -6; else if (p.x < -6) p.x = W0 + 6;
        const fl = 0.6 + 0.4 * Math.sin(now * 7 + p.ph * 3);
        wA.circle(p.x, p.y, 3.5 * p.s).fill({ color: 0xf58a3c, alpha: 0.2 * fl }).circle(p.x, p.y, 1.3 * p.s).fill({ color: 0xffc070, alpha: 0.9 * fl });
      }
    }
    if (boltT < 400) { // relámpago: destello de pantalla completa (25 %, 5 % con reduced motion)
      boltT += dtMs;
      const q = Math.max(0, 1 - boltT / 400), v = q * q * (0.75 + 0.25 * Math.sin(boltT / 22));
      flashG.rect(0, 0, W0, H0).fill({ color: 0xdfe8ff, alpha: (reduced ? 0.05 : 0.25) * v });
    }
  }

  // ---- ticker ----
  function tick() {
    const dt = Math.min(50, app.ticker.deltaMS);
    addG.clear(); nrmG.clear();
    tickRegions(dt);
    for (let i = anims.length - 1; i >= 0; i--) if (!anims[i](dt, addG, nrmG)) anims.splice(i, 1);
    const s = dt / 1000;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      p.upd?.(p, dt);
      const damp = Math.max(0, 1 - p.d * s);
      p.vx *= damp; p.vy = p.vy * damp + p.g * s;
      p.x += p.vx * s; p.y += p.vy * s;
      const k = p.age / p.life;
      (p.top ? (p.add ? tA : tN) : p.add ? addG : nrmG).circle(p.x, p.y, p.r * (1 - 0.5 * k)).fill({ color: p.c, alpha: p.a * (1 - k) });
    }
    if (shakeT > 0 || so.x || so.y) {
      shakeT = Math.max(0, shakeT - dt);
      const m = shakeAmp * (shakeT / 200), nx = shakeT ? rnd(-m, m) : 0, ny = shakeT ? rnd(-m, m) : 0;
      world.x += nx - so.x; world.y += ny - so.y; so = { x: nx, y: ny };
    }
    if (zT > 0 || zf !== 1) {
      zT = Math.max(0, zT - dt);
      const nf = zT ? 1 + zAmp * Math.sin(Math.PI * (1 - zT / zD)) : 1, r = nf / zf, c = scr();
      world.position.set(c.width / 2 - (c.width / 2 - world.x) * r, c.height / 2 - (c.height / 2 - world.y) * r); world.scale.set(world.scale.x * r); zf = nf;
    }
    if (wx.kind !== 'none') frame(dt);
    else if (boltT < 400) frame(dt);
    if (!anims.length && !parts.length && !shakeT && !zT && zf === 1 && wx.kind === 'none' && !(rfx.length && !reduced)) stop();
  }
  function wake() { if (!running) { running = true; app.ticker.add(tick); } }
  function stop() { running = false; app.ticker.remove(tick); addG.clear(); nrmG.clear(); tN.clear(); tA.clear(); }

  function sync(on: boolean, w?: Weather) {
    if (on !== enabled) { enabled = on; buildRegions(); }
    if (!on) { anims.splice(0).forEach(() => 0); parts.length = 0; addG.clear(); nrmG.clear(); }
    setWeather(on ? w : undefined);
  }
  function setRegions(rs: Region[]) {
    const k = JSON.stringify(rs.map((r) => [r.id, r.kind, r.fx, r.points]));
    if (k === regKey) return;
    regKey = k; regList = rs; buildRegions();
  }
  let regKey = '';
  function destroy() {
    playFn = undefined;
    if (running) app.ticker.remove(tick);
    running = false;
    soft.destroy(true);
  }
  return { effect, sync, setRegions, wind: () => wx.wind, destroy };
}
