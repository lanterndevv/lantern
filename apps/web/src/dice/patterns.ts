// Superficie procedural de cada set, pintada en canvas (sin imágenes). `paint` es el color del cuerpo y
// `glow`, si existe, lo que brilla por sí mismo (grietas, runas). Se pinta una vez por set y se reescala al atlas.
import type { DiceTheme } from '@lantern/protocol';

type G = CanvasRenderingContext2D;
export const PAT = 512;
const R = Math.random, rr = (a: number, b: number) => a + R() * (b - a);

function blob(g: G, x: number, y: number, r: number, color: string) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
}
function specks(g: G, n: number, color: string, r0: number, r1: number) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) { g.beginPath(); g.arc(R() * PAT, R() * PAT, rr(r0, r1), 0, 7); g.fill(); }
}
// Camino aleatorio con ramas: grietas, vetas y escarcha.
function crack(g: G, x: number, y: number, a: number, len: number, w: number, depth: number) {
  g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
  for (let i = 0; i < len; i++) {
    a += rr(-0.5, 0.5); x += Math.cos(a) * 8; y += Math.sin(a) * 8; g.lineTo(x, y);
    if (depth > 0 && R() < 0.08) { g.stroke(); crack(g, x, y, a + rr(-1.2, 1.2), len / 2, w * 0.6, depth - 1); g.lineWidth = w; g.beginPath(); g.moveTo(x, y); }
  }
  g.stroke();
}
function swirls(g: G, n: number, color: string, w: number) {
  g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = R() * PAT, y = R() * PAT;
    g.beginPath(); g.moveTo(x, y);
    g.bezierCurveTo(x + rr(-150, 150), y + rr(-150, 150), x + rr(-150, 150), y + rr(-150, 150), x + rr(-200, 200), y + rr(-200, 200));
    g.stroke();
  }
}
const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';

export const PATTERNS: Record<DiceTheme, { paint: (g: G) => void; glow?: (g: G) => void }> = {
  linterna: { paint: g => { // resina con remolinos y burbujas
    for (let i = 0; i < 14; i++) blob(g, R() * PAT, R() * PAT, rr(60, 160), i & 1 ? 'rgba(255,225,150,.5)' : 'rgba(110,40,0,.5)');
    swirls(g, 22, 'rgba(255,240,190,.35)', 7); swirls(g, 14, 'rgba(80,30,0,.4)', 5);
    for (let i = 0; i < 40; i++) { const x = R() * PAT, y = R() * PAT, r = rr(1.5, 5); g.strokeStyle = 'rgba(255,245,210,.55)'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); }
  } },
  obsidiana: {
    paint: g => { for (let i = 0; i < 10; i++) blob(g, R() * PAT, R() * PAT, rr(80, 200), 'rgba(70,60,80,.25)'); g.strokeStyle = 'rgba(120,110,130,.18)'; for (let i = 0; i < 8; i++) crack(g, R() * PAT, R() * PAT, R() * 7, 40, 1.5, 1); },
    glow: g => { g.strokeStyle = 'rgba(255,110,20,.9)'; g.shadowColor = '#ff6a00'; g.shadowBlur = 8; for (let i = 0; i < 7; i++) crack(g, R() * PAT, R() * PAT, R() * 7, 30, 2.2, 2); g.shadowBlur = 0; },
  },
  hueso: { paint: g => { // grano, poros y vetas del marfil
    for (let i = 0; i < 12; i++) blob(g, R() * PAT, R() * PAT, rr(60, 180), i & 1 ? 'rgba(150,120,80,.18)' : 'rgba(255,250,235,.3)');
    g.strokeStyle = 'rgba(140,110,70,.12)'; g.lineWidth = 1.5;
    for (let y = 0; y < PAT; y += rr(4, 12)) { g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= PAT; x += 32) g.lineTo(x, y + Math.sin(x / 60 + y) * 4); g.stroke(); }
    specks(g, 400, 'rgba(90,60,30,.25)', 0.5, 1.6);
  } },
  escarcha: {
    paint: g => { for (let i = 0; i < 12; i++) blob(g, R() * PAT, R() * PAT, rr(60, 160), 'rgba(255,255,255,.25)'); g.strokeStyle = 'rgba(255,255,255,.45)'; for (let i = 0; i < 16; i++) crack(g, R() * PAT, R() * PAT, R() * 7, 14, 1.4, 3); specks(g, 150, 'rgba(255,255,255,.7)', 0.5, 1.5); },
    glow: g => { g.strokeStyle = 'rgba(190,235,255,.35)'; for (let i = 0; i < 8; i++) crack(g, R() * PAT, R() * PAT, R() * 7, 12, 1.2, 3); },
  },
  bronce: { paint: g => { // metal rayado con pátina verde
    for (let i = 0; i < 900; i++) { const y = R() * PAT, x = R() * PAT; g.strokeStyle = R() < 0.5 ? 'rgba(255,220,170,.12)' : 'rgba(40,20,0,.12)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + rr(20, 90), y + rr(-2, 2)); g.stroke(); }
    for (let i = 0; i < 10; i++) blob(g, R() * PAT, R() * PAT, rr(30, 110), 'rgba(80,150,125,.45)');
    specks(g, 120, 'rgba(110,180,150,.4)', 1, 3);
  } },
  esmeralda: { paint: g => { // jaspe con motas doradas
    for (let i = 0; i < 26; i++) blob(g, R() * PAT, R() * PAT, rr(30, 130), i % 3 ? 'rgba(0,40,20,.35)' : 'rgba(140,240,170,.3)');
    swirls(g, 12, 'rgba(10,50,30,.35)', 3);
    specks(g, 90, 'rgba(245,200,119,.85)', 0.8, 2.2);
  } },
  arcano: {
    paint: g => { // nebulosa con estrellas
      const c = ['rgba(255,90,200,.3)', 'rgba(80,120,255,.3)', 'rgba(40,0,90,.45)'];
      for (let i = 0; i < 18; i++) blob(g, R() * PAT, R() * PAT, rr(50, 170), c[i % 3]);
      specks(g, 160, 'rgba(255,255,255,.8)', 0.4, 1.4);
    },
    glow: g => { g.fillStyle = 'rgba(255,224,138,.35)'; g.font = '28px serif'; for (let i = 0; i < 40; i++) g.fillText(RUNES[Math.floor(R() * RUNES.length)], R() * PAT, R() * PAT); },
  },
  dragon: { paint: g => { // escamas superpuestas
    const s = 36;
    for (let row = -1; row * s * 0.55 < PAT + s; row++) for (let col = -1; col * s < PAT + s; col++) {
      const x = col * s + (row & 1 ? s / 2 : 0), y = row * s * 0.55;
      const gr = g.createRadialGradient(x, y - s * 0.2, 2, x, y, s * 0.6);
      gr.addColorStop(0, 'rgba(255,120,100,.25)'); gr.addColorStop(1, 'rgba(30,0,5,.35)');
      g.fillStyle = gr; g.strokeStyle = 'rgba(20,0,0,.55)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, s * 0.55, 0, Math.PI); g.closePath(); g.fill(); g.stroke();
    }
  } },
};
