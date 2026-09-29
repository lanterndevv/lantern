// Minimapa: re-renderiza el mundo (con su luz y niebla, o sea solo lo que el jugador ya ve) a una RT pequeña cada ~500 ms
// y lo vuelca a un canvas 2D con puntos de fichas y el rectángulo de la vista. Clic/arrastre mueve la cámara.
import { Matrix, RenderTexture } from 'pixi.js';
import type { Application, Container } from 'pixi.js';
import type { Scene, Token } from '@lantern/protocol';

const W = 200;
export function createMinimap(host: HTMLElement, o: {
  app: Application; world: Container; hide: Container[]; lite: boolean;
  scene(): Scene | undefined; level(): string; color(t: Token): string; moveTo(x: number, y: number): void;
}) {
  const box = document.createElement('div'); box.className = 'minimapa';
  const tog = document.createElement('button'); tog.type = 'button'; tog.className = 'mm-tog'; tog.setAttribute('aria-expanded', 'true'); tog.setAttribute('aria-label', 'Plegar minimapa');
  const cv = document.createElement('canvas'), cap = document.createElement('small');
  cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Minimapa: clic o arrastre para mover la cámara');
  box.append(tog, cv, cap); host.append(box);
  const x = cv.getContext('2d')!;
  let rt: RenderTexture | undefined, base: CanvasImageSource | undefined, last = 0, key = '', open = true, drag = false;
  const k = () => W / o.scene()!.width;

  function paint(s: Scene) {
    const kk = k(), h = Math.round(s.height * kk);
    if (cv.width !== W || cv.height !== h) { cv.width = W; cv.height = h; key = ''; }
    x.clearRect(0, 0, W, h);
    if (base) x.drawImage(base, 0, 0, W, h);
    for (const t of s.tokens) {
      x.globalAlpha = t.hidden ? 0.5 : 1; x.fillStyle = o.color(t);
      const mine = t.owners.length > 0;
      x.beginPath(); x.arc(t.x * kk, t.y * kk, mine ? 4 : 3, 0, 7); x.fill();
      if (mine) { x.strokeStyle = '#F5C877'; x.lineWidth = 1.5; x.stroke(); }
    }
    x.globalAlpha = 1; x.strokeStyle = '#fff'; x.lineWidth = 1.5;
    const w = o.world, sc = w.scale.x;
    x.strokeRect(-w.x / sc * kk, -w.y / sc * kk, (o.app.screen.width / sc) * kk, (o.app.screen.height / sc) * kk);
    cap.textContent = o.level();
  }

  function frame() {
    const s = o.scene(); if (!s || !open) return;
    const now = performance.now();
    if (now - last > (o.lite ? 1500 : 500)) {
      last = now;
      const kk = k(), h = Math.max(1, Math.round(s.height * kk));
      if (!rt || rt.width !== W || rt.height !== h) { rt?.destroy(true); rt = RenderTexture.create({ width: W, height: h }); }
      const vis = o.hide.map((c) => c.visible); o.hide.forEach((c) => { c.visible = false; });
      o.app.renderer.render({ container: o.world, target: rt, clear: true, transform: new Matrix().scale(kk, kk) });
      o.hide.forEach((c, i) => { c.visible = vis[i]; });
      base = o.app.renderer.extract.canvas(rt) as CanvasImageSource;
      key = '';
    }
    const w = o.world, kx = `${w.x | 0},${w.y | 0},${w.scale.x},${o.app.screen.width}`;
    if (kx !== key) { key = kx; paint(s); }
  }

  const go = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect(), s = o.scene(); if (!s) return;
    o.moveTo(((e.clientX - r.left) / r.width) * s.width, ((e.clientY - r.top) / r.height) * s.height);
  };
  cv.onpointerdown = (e) => { drag = true; cv.setPointerCapture(e.pointerId); go(e); };
  cv.onpointermove = (e) => { if (drag) go(e); };
  cv.onpointerup = cv.onpointercancel = () => { drag = false; };
  tog.onclick = () => {
    open = !open; box.classList.toggle('plegado', !open);
    tog.setAttribute('aria-expanded', String(open)); tog.setAttribute('aria-label', open ? 'Plegar minimapa' : 'Desplegar minimapa');
    last = 0;
  };
  return { frame, destroy() { rt?.destroy(true); box.remove(); } };
}
