// Postproceso ligero en capa de pantalla: viñeta, grano, bloom de baja resolución y franjas cinematográficas.
// Cada uno es un ajuste local del cliente (localStorage) que la UI lee/escribe vía Table.getPost/setPost.
import { BlurFilter, ColorMatrixFilter, Container, Graphics, Matrix, RenderTexture, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { Application } from 'pixi.js';
import { PORTATIL } from './portatil.ts';

export type PostFx = { bloom: boolean; vignette: boolean; grain: boolean; breathing: boolean };
const KEY = 'lantern:post';
const DEF: PostFx = { bloom: false, vignette: true, grain: true, breathing: true }; // ponytail: bloom apagado por defecto (iGPU)
export function loadPost(): PostFx {
  if (PORTATIL) return { bloom: false, vignette: false, grain: false, breathing: false }; // modo portátil: sin postproceso
  try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEF }; }
}
const canvasTex = (w: number, h: number, f: (x: CanvasRenderingContext2D) => void) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d')!); return Texture.from(c);
};

export function createPost(app: Application, world: Container, reduced: boolean) {
  const post = loadPost(), layer = new Container();
  layer.eventMode = 'none'; // toda capa que cubre el mapa debe ser inerte o los tokens no reciben clics
  app.stage.addChild(layer);
  const vigT = canvasTex(256, 256, (x) => {
    const g = x.createRadialGradient(128, 128, 60, 128, 128, 182);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  });
  const grainT = canvasTex(128, 128, (x) => {
    const d = x.createImageData(128, 128);
    for (let i = 0; i < d.data.length; i += 4) { d.data[i] = d.data[i + 1] = d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0);
  });
  const bloom = new Sprite(), vig = new Sprite(vigT), grain = new TilingSprite({ texture: grainT, width: 1, height: 1 }), bars = new Graphics();
  bloom.blendMode = 'add'; grain.alpha = 0.05;
  const cm = new ColorMatrixFilter(); // umbral: solo pasan las zonas brillantes
  cm.matrix = [1.8, 0, 0, 0, -0.9, 0, 1.8, 0, 0, -0.9, 0, 0, 1.8, 0, -0.9, 0, 0, 0, 1, 0];
  bloom.filters = [cm, new BlurFilter({ strength: 6, quality: 2 })];
  layer.addChild(bloom, vig, grain, bars);
  let rt: RenderTexture | undefined, frame = 0, bar = 0, barT = 0;
  const K = 0.25;

  function apply() {
    vig.visible = post.vignette; grain.visible = post.grain; bloom.visible = post.bloom;
    if (!post.bloom) { rt?.destroy(true); rt = undefined; }
  }
  apply();
  return {
    cfg: post, // referencia viva (lectura barata en el ticker)
    get: () => ({ ...post }),
    set(p: Partial<PostFx>) {
      Object.assign(post, p); apply();
      try { localStorage.setItem(KEY, JSON.stringify(post)); } catch { /* sin almacenamiento */ }
    },
    cinematic(on: boolean) { barT = on ? 0.11 : 0; if (reduced) bar = barT; },
    tick(dtMs: number) {
      const { width: W, height: H } = app.screen;
      vig.width = grain.width = W; vig.height = grain.height = H;
      frame++;
      if (post.grain && !reduced && frame % 3 === 0) grain.tilePosition.set(Math.random() * 128, Math.random() * 128);
      if (bar !== barT) {
        bar += (barT - bar) * Math.min(1, dtMs / 250); if (Math.abs(bar - barT) < 0.001) bar = barT;
        bars.clear();
        if (bar > 0) bars.rect(0, 0, W, H * bar).rect(0, H * (1 - bar), W, H * bar).fill(0x000000);
      } else if (bar > 0 && bars.width !== W) bars.clear().rect(0, 0, W, H * bar).rect(0, H * (1 - bar), W, H * bar).fill(0x000000);
      if (post.bloom && frame % 3 === 0) { // el mundo entero a ¼ de resolución, cada 3 fotogramas
        const w = Math.ceil(W * K), h = Math.ceil(H * K);
        if (!rt || rt.width !== w || rt.height !== h) { rt?.destroy(true); bloom.texture = rt = RenderTexture.create({ width: w, height: h }); bloom.scale.set(1 / K); }
        app.renderer.render({ container: world, target: rt, clear: true, transform: new Matrix().scale(K, K) });
        bloom.alpha = 0.4;
      }
    },
    destroy() { rt?.destroy(true); vigT.destroy(true); grainT.destroy(true); layer.destroy({ children: true }); },
  };
}
