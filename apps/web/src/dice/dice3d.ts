// Dados 3D que ve toda la mesa. El resultado lo fija el servidor: la animación es solo teatro
// y siempre termina con la cara `value` mirando a la cámara. Sin físicas.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Die, DiceTheme } from '@lantern/protocol';
import { DICE } from './themes.ts';

type V3 = THREE.Vector3;
type Face = { c: V3; n: V3; up: V3; r: number; pts: V3[] };
type Shape = { faces: Face[]; geo: THREE.BufferGeometry; edges: THREE.BufferGeometry; cols: number; rows: number };
export type Settled = { die: Die; shown: number }[];

const MAX = 12, DUR = 1.5, HOLD = 2.5, FADE = 0.45, CELL = 160, FOV = 30;
// Tamaño en pantalla fijo: 130 px por unidad de mundo ⇒ un dado mide ~50–65 px en cualquier monitor (antes crecía con la altura de la ventana).
const PX_PER_UNIT = 100, GAP = 1.15; // GAP: separación entre dados en unidades
const PHI = (1 + Math.sqrt(5)) / 2;
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ---------- Geometrías ----------

// Todas las permutaciones cíclicas y cambios de signo de cada semilla, sin duplicados.
function sym(seeds: number[][]): V3[] {
  const out = new Map<string, V3>();
  for (const [a, b, c] of seeds) for (const p of [[a, b, c], [b, c, a], [c, a, b]])
    for (let s = 0; s < 8; s++) {
      const v = p.map((x, i) => (s >> i) & 1 ? -x : x);
      out.set(v.map(x => x.toFixed(4)).join(), v3(v[0], v[1], v[2]));
    }
  return [...out.values()];
}

// Caras triangulares: todas las ternas cuyas tres aristas miden lo mismo que la arista mínima.
function tris(vs: V3[]): V3[][] {
  let e = Infinity;
  vs.forEach((a, i) => vs.slice(i + 1).forEach(b => { e = Math.min(e, a.distanceTo(b)); }));
  const ok = (a: V3, b: V3) => Math.abs(a.distanceTo(b) - e) < 1e-3;
  const out: V3[][] = [];
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) for (let k = j + 1; k < vs.length; k++)
    if (ok(vs[i], vs[j]) && ok(vs[j], vs[k]) && ok(vs[i], vs[k])) out.push([vs[i], vs[j], vs[k]]);
  return out;
}

function polyhedron(sides: number): V3[][] {
  const ICO = sym([[0, 1, PHI]]);
  switch (sides) {
    case 4: return tris([v3(1, 1, 1), v3(1, -1, -1), v3(-1, 1, -1), v3(-1, -1, 1)]);
    case 6: { const cube = sym([[1, 1, 1]]); return [0, 1, 2].flatMap(a => [-1, 1].map(s => cube.filter(v => v.getComponent(a) === s))); }
    case 8: return tris(sym([[1, 0, 0]]));
    case 12: { // dual del icosaedro: los centros de sus caras son los vértices
      const T = tris(ICO), cen = T.map(t => t[0].clone().add(t[1]).add(t[2]).normalize());
      return ICO.map(v => cen.filter((_, i) => T[i].includes(v)));
    }
    case 10: { // trapezoedro pentagonal; h sale de exigir que las cometas sean planas
      const a = 0.12, c = Math.cos(Math.PI / 5), h = a * (1 + c) / (1 - c);
      const ring = (i: number) => v3(Math.cos(i * Math.PI / 5), Math.sin(i * Math.PI / 5), i & 1 ? -a : a);
      const T = v3(0, 0, h), B = v3(0, 0, -h), f: V3[][] = [];
      for (let i = 0; i < 5; i++) f.push([T, ring(2 * i), ring(2 * i + 1), ring(2 * i + 2)], [B, ring(2 * i + 1), ring(2 * i + 2), ring(2 * i + 3)]);
      return f;
    }
    default: return tris(ICO); // d20
  }
}

function mkFace(p: V3[], edgeUp: boolean): Face {
  const c = new THREE.Vector3();
  p.forEach(x => c.add(x));
  c.divideScalar(p.length);
  const n = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).normalize();
  if (n.dot(c) < 0) n.negate();
  const u0 = p[0].clone().sub(c).normalize(), v0 = n.clone().cross(u0), T = Math.PI * 2;
  const ang = (x: V3) => { const d = x.clone().sub(c); return (Math.atan2(d.dot(v0), d.dot(u0)) + T + 1e-6) % T; };
  const pts = [...p].sort((a, b) => ang(a) - ang(b)); // antihorario visto desde fuera; pts[0] queda primero
  const up = edgeUp ? pts[0].clone().add(pts[1]).multiplyScalar(0.5).sub(c).normalize() : u0; // «arriba» del número
  return { c, n, up, r: Math.max(...pts.map(x => x.distanceTo(c))), pts };
}

function buildShape(sides: number): Shape {
  const raw = polyhedron(sides);
  const R = Math.max(...raw.flat().map(p => p.length()));
  const faces = raw.map(f => mkFace(f.map(p => p.clone().divideScalar(R)), sides === 6));
  const cols = Math.ceil(Math.sqrt(faces.length)), rows = Math.ceil(faces.length / cols);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  faces.forEach((f, i) => {
    const right = f.up.clone().cross(f.n), col = i % cols, row = Math.floor(i / cols);
    const put = (p: V3) => {
      const d = p.clone().sub(f.c);
      pos.push(p.x, p.y, p.z); nor.push(f.n.x, f.n.y, f.n.z);
      uv.push((col + 0.5 + d.dot(right) / (2 * f.r)) / cols, 1 - (row + 0.5 - d.dot(f.up) / (2 * f.r)) / rows);
    };
    for (let k = 1; k < f.pts.length - 1; k++) { put(f.pts[0]); put(f.pts[k]); put(f.pts[k + 1]); }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // ponytail: sin bisel real (ni en el d6): solo aristas en color `edge`. Bisel geométrico si se quiere más realismo.
  return { faces, geo, edges: new THREE.EdgesGeometry(geo, 1), cols, rows };
}

// Etiqueta de cada cara: caras opuestas suman N+1 (con L[k] + L[N-1-k]). El d4 no tiene opuestas.
function assignLabels(faces: Face[], L: string[]): string[] {
  const out: string[] = [], N = faces.length;
  let k = 0;
  faces.forEach((f, i) => {
    if (out[i] !== undefined) return;
    const j = faces.findIndex((g, m) => m !== i && out[m] === undefined && g.n.dot(f.n) < -0.99);
    out[i] = L[k];
    if (j >= 0) out[j] = L[N - 1 - k];
    k++;
  });
  return out;
}

// ---------- Texturas ----------

function atlas(s: Shape, labels: string[], body: string | null, ink: string, fs: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = s.cols * CELL; cv.height = s.rows * CELL;
  const g = cv.getContext('2d')!;
  g.fillStyle = body ?? '#000'; g.fillRect(0, 0, cv.width, cv.height);
  const size = CELL * fs;
  g.font = `700 ${size}px 'EB Garamond', Georgia, serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = ink;
  labels.forEach((t, i) => {
    const x = (i % s.cols + 0.5) * CELL, y = (Math.floor(i / s.cols) + 0.5) * CELL;
    g.fillText(t, x, y);
    if (/^[69]0?$/.test(t)) g.fillRect(x - g.measureText(t).width / 2, y + size * 0.47, g.measureText(t).width, size * 0.07); // subraya 6 y 9
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const FONT_SIZE: Record<number, number> = { 4: 0.3, 6: 0.42, 8: 0.3, 10: 0.26, 12: 0.4, 20: 0.3 };

// ---------- Bandeja ----------

type Body = {
  mesh: THREE.Mesh; shadow: THREE.Mesh; die: number; labels: string[]; faces: Face[]; kept: boolean; k: number;
  start: V3; pos: V3; delay: number; axis: V3; A: number; q0: THREE.Quaternion; qf: THREE.Quaternion; dispose: () => void;
};

const TENS = ['00', '10', '20', '30', '40', '50', '60', '70', '80', '90'];
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const BOUNCES: [number, number, number][] = [[0, 0.4, 1.6], [0.4, 0.68, 0.7], [0.68, 0.86, 0.28]]; // [desde, hasta, altura]

export function createDiceTray(parent: HTMLElement, onSettle?: (r: Settled) => void) {
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); }
  catch { return { roll: async (_d: Die[], _t: DiceTheme, _l: string, _n?: number) => {}, destroy() {} }; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const canvas = renderer.domElement;
  canvas.className = 'dados3d';
  const etq = document.createElement('div');
  etq.className = 'dados-etq';
  parent.append(canvas, etq);

  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  let worldH = 1;
  const pm = new THREE.PMREMGenerator(renderer), envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex; scene.environmentIntensity = 0.35;
  const amber = new THREE.DirectionalLight(0xffb060, 2.6); amber.position.set(-4, 5, 8);
  const fill = new THREE.DirectionalLight(0x7fa8ff, 0.5); fill.position.set(5, -3, 4);
  scene.add(amber, fill, new THREE.AmbientLight(0x3a2c24, 1));

  const sc = document.createElement('canvas'); sc.width = sc.height = 64;
  const sg = sc.getContext('2d')!, gr = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = gr; sg.fillRect(0, 0, 64, 64);
  const shadowTex = new THREE.CanvasTexture(sc), shadowGeo = new THREE.PlaneGeometry(1, 1);

  const shapes = new Map<number, Shape>();
  const shape = (n: number) => { let s = shapes.get(n); if (!s) shapes.set(n, s = buildShape(n)); return s; };

  const resize = () => {
    const w = parent.clientWidth || 1, h = parent.clientHeight || 1;
    renderer.setSize(w, h, false); cam.aspect = w / h;
    worldH = h / PX_PER_UNIT;
    cam.position.set(0, 0, worldH / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2))));
    cam.updateProjectionMatrix();
  };
  resize();
  let bodies: Body[] = [], active = false, dead = false, raf = 0;
  const onResize = () => { resize(); if (active) renderer.render(scene, cam); };
  addEventListener('resize', onResize);

  const finalQ = (f: Face, dir: V3) => {
    const q = new THREE.Quaternion().setFromUnitVectors(f.n, dir);
    const up = f.up.clone().applyQuaternion(q), want = v3(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
    const a = Math.atan2(up.clone().cross(want).dot(dir), up.dot(want));
    return new THREE.Quaternion().setFromAxisAngle(dir, a).multiply(q); // cara a cámara y número derecho
  };

  const update = (t: number, reduced: boolean) => {
    const tmp = new THREE.Quaternion();
    for (const b of bodies) {
      const u = reduced ? 1 : clamp01((t - b.delay) / DUR), e = 1 - (1 - u) ** 2.2;
      const seg = BOUNCES.find(([a, c]) => u >= a && u < c);
      const w = seg ? (u - seg[0]) / (seg[1] - seg[0]) : 0, z = seg ? seg[2] * 4 * w * (1 - w) * b.k : 0;
      b.mesh.position.set(b.start.x + (b.pos.x - b.start.x) * e, b.start.y + (b.pos.y - b.start.y) * e, z);
      const s = clamp01((u - 0.72) / 0.28), blend = s * s * (3 - 2 * s);
      tmp.setFromAxisAngle(b.axis, b.A * (1 - (1 - u) ** 2)).multiply(b.q0).slerp(b.qf, blend); // giro decreciente → cara final
      b.mesh.quaternion.copy(tmp);
      b.shadow.position.set(b.mesh.position.x + 0.12, b.mesh.position.y - 0.12, -0.4);
      b.shadow.scale.setScalar(1.5 * b.k * (1 + z * 0.25));
      (b.shadow.material as THREE.MeshBasicMaterial).opacity = (b.kept ? 1 : 0.5) / (1 + z * 1.5);
    }
  };

  // Qué cara mira realmente a la cámara (recalculado desde la orientación del mesh).
  const facing = (b: Body) => {
    const dir = cam.position.clone().sub(b.mesh.position).normalize();
    let best = 0, bd = -2;
    b.faces.forEach((f, i) => { const d = f.n.clone().applyQuaternion(b.mesh.quaternion).dot(dir); if (d > bd) { bd = d; best = i; } });
    return best;
  };

  const run = async (dice: Die[], theme: DiceTheme, label: string, total?: number) => {
    await document.fonts?.load("700 48px 'EB Garamond'").catch(() => {});
    if (dead) return;
    const look = DICE[theme] ?? DICE.linterna;
    const shown = dice.slice(0, MAX), extra = dice.length - shown.length;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Piezas: cada dado es una; el d100 son dos d10 (decenas y unidades).
    const specs: { die: number; key: number; L: string[]; target: string; kept: boolean }[] = [];
    shown.forEach((d, i) => {
      if (d.sides === 100) {
        const v = d.value, t = v === 100 ? 0 : Math.floor(v / 10) * 10, u = v === 100 ? 0 : v % 10;
        specs.push({ die: i, key: 10, L: TENS, target: t ? String(t) : '00', kept: d.kept }, { die: i, key: 10, L: DIGITS, target: String(u), kept: d.kept });
      } else {
        // ponytail: caras que no son d4/6/8/10/12/20 usan un d20 con el valor en la cara superior
        const key = [4, 6, 8, 10, 12, 20].includes(d.sides) ? d.sides : 20;
        specs.push({ die: i, key, L: Array.from({ length: key }, (_, m) => String(m + 1)), target: String(d.value), kept: d.kept });
      }
    });

    // Reparto en rejilla centrada, sin solapes.
    const aspect = cam.aspect, halfW = worldH * aspect / 2, n = specs.length;
    const cols = Math.min(n, 6), rows = Math.ceil(n / cols);
    const k = Math.min(1, (2 * halfW * 0.9) / (cols * GAP), 4.2 / (rows * GAP)), sp = GAP * k, yc = 0.5;
    const wSrc = Math.random;
    bodies = specs.map((sp_, i) => {
      const s = shape(sp_.key), labels = assignLabels(s.faces, sp_.L);
      let fi = labels.indexOf(sp_.target);
      if (fi < 0) { labels[0] = sp_.target; fi = 0; } // valor fuera de rango: se escribe igualmente en una cara
      const row = Math.floor(i / cols), inRow = Math.min(cols, n - row * cols);
      const pos = v3(((i % cols) - (inRow - 1) / 2) * sp, yc + ((rows - 1) / 2 - row) * sp, 0);
      const side = wSrc() < 0.5 ? -1 : 1;
      const start = v3(side * (halfW + 1.2), pos.y + (wSrc() - 0.5) * 3, 0);
      // La cara final mira a la cámara con ~20° de inclinación aleatoria: se ven los laterales (aspecto 3D) y el número sigue legible.
      const dir = cam.position.clone().sub(pos).normalize().add(v3((Math.random() - 0.5) * 0.5, -0.2 - Math.random() * 0.15, 0)).normalize();

      const map = atlas(s, labels, look.body, look.number, FONT_SIZE[sp_.key]);
      const glow = look.numberGlow > 0 ? atlas(s, labels, null, look.number, FONT_SIZE[sp_.key]) : null;
      const mat = new THREE.MeshPhysicalMaterial({
        map, color: 0xffffff, roughness: look.roughness, metalness: look.metalness,
        // ponytail: con fondo transparente la transmisión también resta alfa; se atenúa al 60 %
        transmission: look.transmission * 0.6, thickness: 0.6, attenuationColor: new THREE.Color(look.body), attenuationDistance: 1.5,
        clearcoat: 0.3, clearcoatRoughness: 0.25,
        ...(glow ? { emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: look.numberGlow * 1.2 } : {}),
      });
      const lmat = new THREE.LineBasicMaterial({ color: look.edge, transparent: true, opacity: 0.9 });
      if (!sp_.kept) { mat.color.setScalar(0.4); mat.emissiveIntensity *= 0.3; lmat.opacity = 0.35; }
      const mesh = new THREE.Mesh(s.geo, mat);
      const lines = new THREE.LineSegments(s.edges, lmat); lines.scale.setScalar(1.002);
      mesh.add(lines); mesh.scale.setScalar(0.5 * k);
      const smat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
      const shadow = new THREE.Mesh(shadowGeo, smat);
      scene.add(shadow, mesh);
      return {
        mesh, shadow, die: sp_.die, labels, faces: s.faces, kept: sp_.kept, k, start, pos,
        delay: Math.min(i * 0.03, 0.1), axis: v3(wSrc() - 0.5, wSrc() - 0.5, wSrc() - 0.5).normalize(), A: 8 + wSrc() * 6,
        q0: new THREE.Quaternion().random(), qf: finalQ(s.faces[fi], dir),
        dispose: () => { scene.remove(shadow, mesh); map.dispose(); glow?.dispose(); mat.dispose(); lmat.dispose(); smat.dispose(); },
      };
    });

    // Etiqueta bajo los dados
    const b = document.createElement('b'), tot = document.createElement('span');
    b.textContent = label + (extra > 0 ? ` +${extra}` : '');
    tot.textContent = total === undefined ? '' : String(total);
    etq.replaceChildren(b, tot);
    etq.style.transition = canvas.style.transition = 'none';
    etq.style.opacity = '0';
    etq.style.top = `${(0.5 - (yc - ((rows - 1) / 2) * sp - 0.5 * k - 0.55) / worldH) * (parent.clientHeight || 1)}px`;
    canvas.style.opacity = reduced ? '0' : '1';
    void canvas.offsetWidth;
    if (reduced) { canvas.style.transition = 'opacity .25s'; canvas.style.opacity = '1'; }

    active = true;
    const t0 = performance.now(), settleAt = reduced ? 0 : DUR + 0.1;
    await new Promise<void>(res => {
      const tick = (now: number) => {
        if (dead) return res();
        const t = (now - t0) / 1000;
        update(Math.min(t, settleAt), reduced);
        renderer.render(scene, cam);
        if (t < settleAt) raf = requestAnimationFrame(tick); else res(); // el bucle se para: dados quietos = sin render
      };
      raf = requestAnimationFrame(tick);
    });
    if (dead) return;
    etq.style.transition = 'opacity .25s'; etq.style.opacity = '1';
    onSettle?.(shown.map((die, i) => {
      const seen = bodies.filter(x => x.die === i).map(x => x.labels[facing(x)]);
      return { die, shown: die.sides === 100 ? Number(seen[0]) + Number(seen[1]) || 100 : Number(seen[0]) };
    }));

    await sleep(Math.max(0, HOLD * 1000 - (performance.now() - t0)));
    canvas.style.transition = etq.style.transition = `opacity ${FADE}s`;
    canvas.style.opacity = etq.style.opacity = '0';
    await sleep(FADE * 1000 + 50);
    active = false;
    bodies.forEach(x => x.dispose());
    bodies = [];
    if (!dead) renderer.clear();
  };

  let chain: Promise<void> = Promise.resolve();
  return {
    roll(dice: Die[], theme: DiceTheme, label: string, total?: number): Promise<void> {
      if (!dice.length || dead) return Promise.resolve();
      chain = chain.then(() => run(dice, theme, label, total)).catch(e => { console.error('dados 3d', e); });
      return chain;
    },
    destroy() {
      dead = true; cancelAnimationFrame(raf);
      removeEventListener('resize', onResize);
      bodies.forEach(x => x.dispose());
      shapes.forEach(s => { s.geo.dispose(); s.edges.dispose(); });
      shadowTex.dispose(); shadowGeo.dispose(); envTex.dispose(); pm.dispose(); renderer.dispose();
      canvas.remove(); etq.remove();
    },
  };
}
