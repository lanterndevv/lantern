// Dados 3D que ve toda la mesa. El resultado lo fija el servidor: se simula la tirada con físicas (cannon-es)
// fuera de pantalla, se mira qué cara quedó arriba y se reetiquetan las caras para que ahí esté `value`.
// Después se reproduce la simulación grabada. Cada cliente simula su propia trayectoria; el número es el mismo.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import type { Die, DiceTheme } from '@lantern/protocol';
import { DICE, type DiceLook } from './themes.ts';
import { PATTERNS, PAT } from './patterns.ts';
import { assignLabels, relabel } from './labels.ts';

type V3 = THREE.Vector3;
type Face = { c: V3; n: V3; up: V3; r: number; pts: V3[] };
type Shape = { faces: Face[]; geo: THREE.BufferGeometry; cols: number; rows: number; phys: CANNON.ConvexPolyhedron; px: (i: number, p: V3) => [number, number] };
export type Settled = { die: Die; shown: number }[];

const MAX = 12, HOLD = 1.8, FADE = 0.45, CELL = 192, FOV = 35, TILT = THREE.MathUtils.degToRad(25);
// Escala fija: 58 px por unidad de mundo en el centro del suelo ⇒ un dado (radio 1) mide ~115 px en cualquier monitor.
const PX_PER_UNIT = 58, HZ = 60, MAX_SIM = 6, BEVEL = 0.14;
// Física: unidades = radio del dado (~1 cm real). Ajustables a ojo.
const G = 170, SPEED: [number, number] = [22, 30], SPIN = 24;
const PHI = (1 + Math.sqrt(5)) / 2;
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const rr = (a: number, b: number) => a + Math.random() * (b - a);
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
  // Coordenadas en el atlas (px) de un punto proyectado sobre el plano de la cara i.
  const px = (i: number, p: V3): [number, number] => {
    const f = faces[i], d = p.clone().sub(f.c), right = f.up.clone().cross(f.n);
    return [(i % cols + 0.5 + d.dot(right) / (2 * f.r)) * CELL, (Math.floor(i / cols) + 0.5 - d.dot(f.up) / (2 * f.r)) * CELL];
  };

  // Bisel: cada cara se encoge hacia su centro y la envolvente convexa rellena aristas y vértices con chaflanes.
  // Las normales del chaflán son las de la cara de origen de cada vértice ⇒ se sombrean redondeados.
  const owner = new Map<V3, number>(), cloud: V3[] = [];
  faces.forEach((f, i) => f.pts.forEach(p => { const q = p.clone().sub(f.c).multiplyScalar(1 - BEVEL).add(f.c); owner.set(q, i); cloud.push(q); }));
  const hull = new ConvexHull().setFromPoints(cloud);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], W = cols * CELL, H = rows * CELL;
  for (const hf of hull.faces) {
    const e = hf.edge, tri: V3[] = [e.head().point, e.next.head().point, e.next.next.head().point];
    const hn = tri[1].clone().sub(tri[0]).cross(tri[2].clone().sub(tri[0])).normalize();
    if (hn.dot(tri[0]) < 0) { tri.reverse(); hn.negate(); }
    let k = 0;
    faces.forEach((f, i) => { if (f.n.dot(hn) > faces[k].n.dot(hn)) k = i; });
    const flat = faces[k].n.dot(hn) > 0.9999;
    for (const p of tri) {
      const n = flat ? faces[k].n : faces[owner.get(p)!].n, [x, y] = px(k, p);
      pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(x / W, 1 - y / H);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));

  // Cuerpo físico: el poliedro sin bisel (las caras están en los mismos planos, así que reposa igual).
  const verts: V3[] = [], idx = (p: V3) => { let j = verts.findIndex(q => q.distanceTo(p) < 1e-5); if (j < 0) j = verts.push(p) - 1; return j; };
  const phys = new CANNON.ConvexPolyhedron({ faces: faces.map(f => f.pts.map(idx)), vertices: verts.map(p => new CANNON.Vec3(p.x, p.y, p.z)) });
  return { faces, geo, cols, rows, phys, px };
}

// ---------- Texturas ----------

const FONT_SIZE: Record<number, number> = { 4: 0.26, 6: 0.5, 8: 0.42, 10: 0.36, 12: 0.46, 20: 0.42 };

// Patrón de cada set pintado una sola vez (color y, si tiene, capa que brilla).
const patCache = new Map<DiceTheme, { paint: HTMLCanvasElement; glow: HTMLCanvasElement | null }>();
function patterns(theme: DiceTheme, look: DiceLook) {
  let c = patCache.get(theme);
  if (c) return c;
  const mk = (bg: string | null, draw: (g: CanvasRenderingContext2D) => void) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = PAT;
    const g = cv.getContext('2d')!;
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, PAT, PAT); }
    draw(g); return cv;
  };
  const p = PATTERNS[theme];
  patCache.set(theme, c = { paint: mk(look.body, p.paint), glow: p.glow ? mk(null, p.glow) : null });
  return c;
}

function drawNumbers(g: CanvasRenderingContext2D, s: Shape, labels: string[], sides: number, ink: string) {
  const size = CELL * FONT_SIZE[sides];
  g.font = `700 ${size}px 'EB Garamond', Georgia, serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = ink;
  if (sides === 4) { // d4: cada vértice lleva el número de la cara opuesta; se lee el de arriba
    s.faces.forEach((f, i) => {
      const [cx, cy] = s.px(i, f.c);
      for (const p of f.pts) {
        const j = s.faces.findIndex(o => !o.pts.some(q => q.distanceTo(p) < 1e-5));
        const [x, y] = s.px(i, p), px = cx + (x - cx) * 0.55, py = cy + (y - cy) * 0.55;
        g.save(); g.translate(px, py); g.rotate(Math.atan2(x - cx, cy - y)); g.fillText(labels[j], 0, 0); g.restore();
      }
    });
    return;
  }
  labels.forEach((t, i) => {
    const [x, y] = s.px(i, s.faces[i].c);
    g.fillText(t, x, y);
    if (/^[69]0?$/.test(t)) g.fillRect(x - g.measureText(t).width / 2, y + size * 0.47, g.measureText(t).width, size * 0.07); // subraya 6 y 9
  });
}

// layer: color (patrón + números), glow (lo que brilla) o bump (números hundidos).
function atlas(s: Shape, labels: string[], sides: number, theme: DiceTheme, look: DiceLook, layer: 'color' | 'glow' | 'bump'): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = s.cols * CELL; cv.height = s.rows * CELL;
  const g = cv.getContext('2d')!, pat = patterns(theme, look);
  g.fillStyle = layer === 'bump' ? '#fff' : layer === 'glow' ? '#000' : look.body;
  g.fillRect(0, 0, cv.width, cv.height);
  if (layer === 'color') g.drawImage(pat.paint, 0, 0, cv.width, cv.height);
  if (layer === 'glow' && pat.glow) g.drawImage(pat.glow, 0, 0, cv.width, cv.height);
  if (layer !== 'glow' || look.numberGlow > 0) drawNumbers(g, s, labels, sides, layer === 'bump' ? '#000' : look.number);
  const tex = new THREE.CanvasTexture(cv);
  if (layer !== 'bump') tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------- Partículas ----------

type Burst = { pts: THREE.Points; vel: Float32Array; age: number; life: number; grav: number; drag: number };

function burst(pos: V3, color: string, kind: DiceLook['fx']['kind'], n: number, power: number, sprite: THREE.Texture): Burst {
  const p = new Float32Array(n * 3), vel = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rr(0.4, 1) * power;
    p.set([pos.x + Math.cos(a) * 0.6, pos.y + rr(0, 0.8), pos.z + Math.sin(a) * 0.6], i * 3);
    const up = kind === 'chispas' ? rr(4, 10) : kind === 'runas' ? rr(1, 3) : kind === 'copos' ? rr(1, 4) : rr(0, 1);
    const out = kind === 'chispas' ? rr(3, 8) : kind === 'polvo' ? rr(2, 6) : rr(0.5, 2.5);
    vel.set([Math.cos(a) * out * s, up * s, Math.sin(a) * out * s], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const mat = new THREE.PointsMaterial({
    color, map: sprite, size: kind === 'runas' ? 0.7 : kind === 'copos' ? 0.45 : 0.3, transparent: true,
    depthWrite: false, blending: kind === 'polvo' ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const g = { chispas: -18, copos: -1.5, runas: 2, polvo: 0 }[kind], drag = { chispas: 0.5, copos: 1.5, runas: 1, polvo: 3 }[kind];
  return { pts: new THREE.Points(geo, mat), vel, age: 0, life: kind === 'chispas' ? 0.9 : 1.4, grav: g, drag };
}

function stepBurst(b: Burst, dt: number) {
  b.age += dt;
  const a = b.pts.geometry.attributes.position as THREE.BufferAttribute, p = a.array as Float32Array, k = Math.exp(-b.drag * dt);
  for (let i = 0; i < p.length; i += 3) {
    b.vel[i + 1] += b.grav * dt;
    for (let j = 0; j < 3; j++) { b.vel[i + j] *= k; p[i + j] += b.vel[i + j] * dt; }
    if (p[i + 1] < 0) { p[i + 1] = 0; b.vel[i + 1] *= -0.3; }
  }
  a.needsUpdate = true;
  (b.pts.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - b.age / b.life);
}

// ---------- Bandeja ----------

type Body = {
  mesh: THREE.Mesh; die: number; sides: number; labels: string[]; faces: Face[];
  track: Float32Array; rest: number; kept: boolean; crit: 0 | 1 | -1; fired: boolean; dispose: () => void;
};

const TENS = ['00', '10', '20', '30', '40', '50', '60', '70', '80', '90'];
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const UP = v3(0, 1, 0);

// Cara que se lee: la de arriba (la de abajo en el d4, cuyo número está en el vértice superior).
function readFace(faces: Face[], q: THREE.Quaternion, sides: number) {
  let best = 0, bd = -2;
  faces.forEach((f, i) => { const d = f.n.clone().applyQuaternion(q).dot(UP) * (sides === 4 ? -1 : 1); if (d > bd) { bd = d; best = i; } });
  return best;
}

export function createDiceTray(parent: HTMLElement, onSettle?: (r: Settled) => void) {
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); }
  catch { return { roll: async (_d: Die[], _t: DiceTheme, _l: string, _n?: number) => {}, destroy() {} }; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'dados3d';
  const etq = document.createElement('div');
  etq.className = 'dados-etq';
  parent.append(canvas, etq);

  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
  const pm = new THREE.PMREMGenerator(renderer), envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex; scene.environmentIntensity = 0.45;
  const key = new THREE.DirectionalLight(0xffd8a8, 2.6); key.position.set(-8, 20, 6);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 4; key.shadow.bias = -0.0005;
  const fill = new THREE.DirectionalLight(0x7fa8ff, 0.6); fill.position.set(10, 6, -6);
  const critLight = new THREE.PointLight(0xffffff, 0, 10, 1.5); // siempre presente: añadir luces a mitad recompila shaders
  scene.add(key, fill, critLight, new THREE.AmbientLight(0x3a2c24, 1));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.45 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  const sc = document.createElement('canvas'); sc.width = sc.height = 64;
  const sg = sc.getContext('2d')!, gr = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  sg.fillStyle = gr; sg.fillRect(0, 0, 64, 64);
  const sprite = new THREE.CanvasTexture(sc);

  const shapes = new Map<number, Shape>();
  const shape = (n: number) => { let s = shapes.get(n); if (!s) shapes.set(n, s = buildShape(n)); return s; };

  const resize = () => {
    const w = parent.clientWidth || 1, h = parent.clientHeight || 1;
    renderer.setSize(w, h, false); cam.aspect = w / h;
    const d = h / PX_PER_UNIT / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    cam.position.set(0, d * Math.cos(TILT), d * Math.sin(TILT)); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
  };
  resize();
  // Rectángulo del suelo que se ve entero (el borde cercano de la pantalla es el más estrecho).
  const bounds = () => {
    const hit = (x: number, y: number) => {
      const d = v3(x, y, 0.5).unproject(cam).sub(cam.position);
      return cam.position.clone().addScaledVector(d, -cam.position.y / d.y);
    };
    const near = hit(1, -1), far = hit(0, 1);
    return { hw: Math.max(3, near.x - 1.5), zNear: near.z - 1.2, zFar: far.z + 2.2 }; // margen: el dado tiene altura y la perspectiva lo sube
  };

  let bodies: Body[] = [], bursts: Burst[] = [], active = false, dead = false, raf = 0;
  const onResize = () => { resize(); if (active) renderer.render(scene, cam); };
  addEventListener('resize', onResize);

  // Tirada física fuera de pantalla: devuelve la pista (pos + cuaternión por frame) y el frame de reposo de cada dado.
  const simulate = (sh: Shape[]) => {
    const { hw, zNear, zFar } = bounds();
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -G, 0), allowSleep: true });
    world.defaultContactMaterial.friction = 0.3; world.defaultContactMaterial.restitution = 0.35;
    const wall = (x: number, z: number, ry: number, rx = 0) => {
      const b = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
      b.position.set(x, 0, z); b.quaternion.setFromEuler(rx, ry, 0); world.addBody(b);
    };
    wall(0, 0, 0, -Math.PI / 2); // suelo
    wall(-hw, 0, Math.PI / 2); wall(hw, 0, -Math.PI / 2); wall(0, zFar, 0); wall(0, zNear, Math.PI);
    // Se lanzan agrupados desde una esquina de abajo hacia el centro, como una mano.
    const side = Math.random() < 0.5 ? -1 : 1, cols = Math.ceil(Math.sqrt(sh.length));
    const aim = v3(rr(-hw * 0.3, hw * 0.3), 0, rr(zFar * 0.4, zNear * 0.2));
    const bs = sh.map((s, i) => {
      const b = new CANNON.Body({ mass: 1, shape: s.phys, linearDamping: 0.1, angularDamping: 0.1, sleepSpeedLimit: 0.35, sleepTimeLimit: 0.25 });
      b.position.set(side * (hw - 1.5 - (i % cols) * 2.2), rr(3, 5), zNear - 1.5 - Math.floor(i / cols) * 2.2);
      const dir = aim.clone().sub(v3(b.position.x, 0, b.position.z)).normalize(), sp = rr(...SPEED);
      b.velocity.set(dir.x * sp + rr(-3, 3), rr(-2, 4), dir.z * sp + rr(-3, 3));
      b.angularVelocity.set(rr(-SPIN, SPIN), rr(-SPIN, SPIN), rr(-SPIN, SPIN));
      b.quaternion.setFromEuler(rr(0, 7), rr(0, 7), rr(0, 7));
      world.addBody(b); return b;
    });
    const frames: number[][] = bs.map(() => []), rest = bs.map(() => -1);
    for (let f = 0; f < MAX_SIM * HZ; f++) {
      world.step(1 / HZ);
      bs.forEach((b, i) => {
        frames[i].push(b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        rest[i] = b.sleepState === CANNON.Body.SLEEPING ? (rest[i] < 0 ? f : rest[i]) : -1;
      });
      if (f > HZ / 3 && rest.every(r => r >= 0)) break;
    }
    // ponytail: si a los 6 s alguno sigue rodando se corta ahí; subir MAX_SIM si pasa a menudo
    const last = frames[0].length / 7 - 1;
    return bs.map((_, i) => ({ track: Float32Array.from(frames[i]), rest: rest[i] < 0 ? last : rest[i] }));
  };

  const pose = (b: Body, f: number) => {
    const n = b.track.length / 7 - 1, i = Math.min(Math.floor(f), n), j = Math.min(i + 1, n), a = Math.min(1, f - i), T = b.track;
    b.mesh.position.set(T[i * 7] + (T[j * 7] - T[i * 7]) * a, T[i * 7 + 1] + (T[j * 7 + 1] - T[i * 7 + 1]) * a, T[i * 7 + 2] + (T[j * 7 + 2] - T[i * 7 + 2]) * a);
    const q = new THREE.Quaternion().fromArray(T, i * 7 + 3);
    b.mesh.quaternion.copy(q.slerp(new THREE.Quaternion().fromArray(T, j * 7 + 3), a));
  };

  const run = async (dice: Die[], theme: DiceTheme, label: string, total?: number) => {
    await document.fonts?.load("700 48px 'EB Garamond'").catch(() => {});
    if (dead) return;
    const look = DICE[theme] ?? DICE.linterna;
    const shown = dice.slice(0, MAX), extra = dice.length - shown.length;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Piezas: cada dado es una; el d100 son dos d10 (decenas y unidades).
    const specs: { die: number; key: number; L: string[]; target: string; kept: boolean; crit: 0 | 1 | -1 }[] = [];
    shown.forEach((d, i) => {
      if (d.sides === 100) {
        const v = d.value, t = v === 100 ? 0 : Math.floor(v / 10) * 10, u = v === 100 ? 0 : v % 10;
        specs.push({ die: i, key: 10, L: TENS, target: t ? String(t) : '00', kept: d.kept, crit: 0 }, { die: i, key: 10, L: DIGITS, target: String(u), kept: d.kept, crit: 0 });
      } else {
        // ponytail: caras que no son d4/6/8/10/12/20 usan un d20 con el valor en la cara superior
        const key = [4, 6, 8, 10, 12, 20].includes(d.sides) ? d.sides : 20;
        const crit = d.sides === 20 && d.kept ? (d.value === 20 ? 1 : d.value === 1 ? -1 : 0) : 0;
        specs.push({ die: i, key, L: Array.from({ length: key }, (_, m) => String(m + 1)), target: String(d.value), kept: d.kept, crit });
      }
    });

    const shs = specs.map(s => shape(s.key)), sim = simulate(shs);
    const { hw, zNear, zFar } = bounds();
    const ext = Math.max(hw, -zFar, zNear) + 6; // caja de sombra que cubre todo el suelo visible
    Object.assign(key.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 80 });
    key.shadow.camera.updateProjectionMatrix();

    bodies = specs.map((sp, i) => {
      const s = shs[i], { track, rest } = sim[i], n = track.length / 7 - 1;
      const qEnd = new THREE.Quaternion().fromArray(track, n * 7 + 3);
      const labels = relabel(assignLabels(s.faces.map(f => f.n), sp.L), s.faces.map(f => f.n), readFace(s.faces, qEnd, sp.key), sp.target);
      const map = atlas(s, labels, sp.key, theme, look, 'color'), bump = atlas(s, labels, sp.key, theme, look, 'bump');
      const glows = look.numberGlow > 0 || !!PATTERNS[theme].glow, glow = glows ? atlas(s, labels, sp.key, theme, look, 'glow') : null;
      const mat = new THREE.MeshPhysicalMaterial({
        map, bumpMap: bump, bumpScale: 3, color: 0xffffff, roughness: look.roughness, metalness: look.metalness,
        // ponytail: con fondo transparente la transmisión también resta alfa; se atenúa al 60 %
        transmission: look.transmission * 0.6, thickness: 1.2, attenuationColor: new THREE.Color(look.body), attenuationDistance: 3,
        clearcoat: 0.6, clearcoatRoughness: 0.15,
        ...(glow ? { emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: Math.max(look.numberGlow, 0.6) * 1.2 } : {}),
      });
      if (!sp.kept) { mat.color.setScalar(0.4); mat.emissiveIntensity *= 0.3; }
      const mesh = new THREE.Mesh(s.geo, mat);
      mesh.castShadow = true;
      scene.add(mesh);
      return {
        mesh, die: sp.die, sides: sp.key, labels, faces: s.faces, track, rest: reduced ? 0 : rest, kept: sp.kept, crit: sp.crit, fired: reduced,
        dispose: () => { scene.remove(mesh); map.dispose(); bump.dispose(); glow?.dispose(); mat.dispose(); },
      };
    });
    const end = reduced ? 0 : Math.max(...bodies.map(b => b.track.length / 7 - 1)) / HZ;

    // Etiqueta
    const b = document.createElement('b'), tot = document.createElement('span');
    b.textContent = label + (extra > 0 ? ` +${extra}` : '');
    tot.textContent = total === undefined ? '' : String(total);
    etq.replaceChildren(b, tot);
    etq.style.transition = canvas.style.transition = 'none';
    etq.style.opacity = '0';
    canvas.style.opacity = reduced ? '0' : '1';
    void canvas.offsetWidth;
    if (reduced) { canvas.style.transition = 'opacity .25s'; canvas.style.opacity = '1'; }

    // Bucle: replay de la física, partículas al asentarse cada dado, etiqueta cuando todos paran, fundido y fin.
    active = true;
    renderer.compile(scene, cam); // shaders antes del primer frame: si no, el tirón se come el lanzamiento
    let settled = false, prev = performance.now(), critT = -1, t = reduced ? end : 0;
    const stopAt = end + HOLD + FADE;
    const settle = () => {
      settled = true;
      const h = parent.clientHeight || 1;
      const sy = Math.max(...bodies.map(x => (1 - x.mesh.position.clone().project(cam).y) / 2 * h));
      etq.style.top = `${Math.min(h - 70, sy + 50)}px`;
      etq.style.transition = 'opacity .25s'; etq.style.opacity = '1';
      onSettle?.(shown.map((die, i) => {
        const seen = bodies.filter(x => x.die === i).map(x => x.labels[readFace(x.faces, x.mesh.quaternion, x.sides)]);
        return { die, shown: die.sides === 100 ? Number(seen[0]) + Number(seen[1]) || 100 : Number(seen[0]) };
      }));
    };
    await new Promise<void>(res => {
      const tick = (now: number) => {
        if (dead) return res();
        const dt = Math.max(0, Math.min(1 / 30, (now - prev) / 1000)); // tope: un frame lento ralentiza, no salta la tirada
        t += dt;
        prev = now;
        for (const x of bodies) {
          pose(x, t * HZ);
          if (!x.fired && t * HZ >= x.rest) {
            x.fired = true;
            const p = x.mesh.position;
            const add = (bu: Burst) => { bursts.push(bu); scene.add(bu.pts); };
            if (x.kept) add(burst(p, look.fx.color, look.fx.kind, 40, 1, sprite));
            if (x.crit) {
              add(burst(p, x.crit > 0 ? '#FFD34D' : '#C0182A', x.crit > 0 ? 'chispas' : 'polvo', 160, 1.5, sprite));
              critLight.color.set(x.crit > 0 ? 0xffc040 : 0xff2030); critLight.position.set(p.x, 2.5, p.z); critT = t;
            }
          }
        }
        if (!settled && t >= end) settle();
        critLight.intensity = critT < 0 ? 0 : 50 * Math.exp(-(t - critT) * 1.2) * (1 + 0.3 * Math.sin((t - critT) * 12));
        bursts = bursts.filter(bu => { stepBurst(bu, dt); if (bu.age < bu.life) return true; scene.remove(bu.pts); bu.pts.geometry.dispose(); (bu.pts.material as THREE.Material).dispose(); return false; });
        renderer.render(scene, cam);
        if (t >= end + HOLD && canvas.style.opacity !== '0') {
          canvas.style.transition = etq.style.transition = `opacity ${FADE}s`;
          canvas.style.opacity = etq.style.opacity = '0';
        }
        if (t < stopAt) raf = requestAnimationFrame(tick); else res();
      };
      raf = requestAnimationFrame(tick);
    });
    active = false; critLight.intensity = 0;
    bodies.forEach(x => x.dispose()); bodies = [];
    bursts.forEach(bu => { scene.remove(bu.pts); bu.pts.geometry.dispose(); (bu.pts.material as THREE.Material).dispose(); }); bursts = [];
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
      shapes.forEach(s => s.geo.dispose());
      sprite.dispose(); floor.geometry.dispose(); (floor.material as THREE.Material).dispose();
      envTex.dispose(); pm.dispose(); renderer.dispose();
      canvas.remove(); etq.remove();
    },
  };
}
