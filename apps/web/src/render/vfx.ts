// VFX procedurales (Graphics + partículas propias) y clima de pantalla. Sin texturas externas.
// El ticker propio solo corre mientras haya efectos vivos, clima o sacudida.
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Weather } from '@lantern/protocol';
import type { Effect } from './api.ts';

const TYPE: Record<string, number> = {
  fire: 0xf58a3c, cold: 0x8fd3f5, lightning: 0xf2e45a, acid: 0xa5d65a, poison: 0x6fcb7c, necrotic: 0x9dbb86,
  radiant: 0xffe08a, force: 0xc29cf5, psychic: 0xee8ccb, thunder: 0x8fa6f7,
};
const col = (t?: string) => TYPE[t ?? ''] ?? 0xe4dacb; // slashing/piercing/bludgeoning y desconocidos
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const ease = (t: number) => 1 - (1 - t) ** 3;
// ponytail: móvil/equipo modesto = mitad de partículas y mapas de luz/niebla a ⅓; umbrales fijos, sin medir FPS
export const LITE = (navigator.hardwareConcurrency || 8) <= 4 || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900);
const F = LITE ? 0.5 : 1;
const MAX_P = 600 * F, MAX_W = 400;

type P = { x: number; y: number; vx: number; vy: number; age: number; life: number; r: number; c: number; add: boolean; g: number; d: number; a: number; upd?: (p: P, dt: number) => void };
type Anim = (dt: number, add: Graphics, nrm: Graphics) => boolean; // false = terminada
type W = { x: number; y: number; gy: number; z: number; ph: number; s: number; rot: number };

function softTexture(): Texture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!, g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return Texture.from(c);
}

export function createVfx(app: Application, world: Container, fxL: Container, reduced: boolean) {
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

  // ---- efectos ----
  function impact(at: { x: number; y: number }, type?: string, crit = false) {
    const c = col(type), R = crit ? 60 : 34;
    if (reduced) return flash(at.x, at.y, R, c, 150);
    flash(at.x, at.y, R, c, 250);
    add(timed(500, (k, ad) => ad.circle(at.x, at.y, R * (0.3 + ease(k))).stroke({ width: crit ? 4 : 2, color: c, alpha: 0.8 * (1 - k) })));
    radial(at.x, at.y, crit ? 34 : 16, c, crit ? 260 : 170, 500, crit ? 3.5 : 2.5);
    if (crit) { radial(at.x, at.y, 10, 0xffffff, 200, 350, 2); shake(200, 6); }
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

  function effect(e: Effect) {
    if (!enabled) return;
    if (e.kind === 'projectile') projectile(e);
    else if (e.kind === 'impact') impact(e.at, e.damageType, e.crit);
    else if (e.kind === 'burst') burst(e);
    else if (e.kind === 'heal') heal(e.at);
    else miss(e.at);
  }

  // ---- clima ----
  let wx: Weather = { kind: 'none', intensity: 0, wind: 0 }, wKey = 'none', ws: W[] = [];
  const banks: { s: Sprite; v: number }[] = [];
  const splashes: { x: number; y: number; age: number }[] = [];
  let nextBolt = 0, boltT = 1e9;
  const N_MAX = { rain: 400, storm: 400, snow: 250, ash: 250, leaves: 60, embers: 150, fog: 0, none: 0 };
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
      (p.add ? addG : nrmG).circle(p.x, p.y, p.r * (1 - 0.5 * k)).fill({ color: p.c, alpha: p.a * (1 - k) });
    }
    if (shakeT > 0 || so.x || so.y) {
      shakeT = Math.max(0, shakeT - dt);
      const m = shakeAmp * (shakeT / 200), nx = shakeT ? rnd(-m, m) : 0, ny = shakeT ? rnd(-m, m) : 0;
      world.x += nx - so.x; world.y += ny - so.y; so = { x: nx, y: ny };
    }
    if (wx.kind !== 'none') frame(dt);
    else if (boltT < 400) frame(dt);
    if (!anims.length && !parts.length && !shakeT && wx.kind === 'none') stop();
  }
  function wake() { if (!running) { running = true; app.ticker.add(tick); } }
  function stop() { running = false; app.ticker.remove(tick); addG.clear(); nrmG.clear(); }

  function sync(on: boolean, w?: Weather) {
    enabled = on;
    if (!on) { anims.splice(0).forEach(() => 0); parts.length = 0; addG.clear(); nrmG.clear(); }
    setWeather(on ? w : undefined);
  }
  function destroy() {
    if (running) app.ticker.remove(tick);
    running = false;
    soft.destroy(true);
  }
  return { effect, sync, destroy };
}
