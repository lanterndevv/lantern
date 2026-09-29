// Efectos de sonido sintetizados con WebAudio: sin archivos.
import { getVolume } from './audio.ts';

type X = { c: AudioContext; out: GainNode };
type Fn = (x: X, t: number) => void;

let ac: AudioContext | undefined, nb: AudioBuffer | undefined;
const wake = () => { try { ac ??= new AudioContext(); void ac.resume(); } catch { /* sin WebAudio */ } };
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, wake, { capture: true });

const noiseBuf = (c: AudioContext) => {
  if (!nb) { nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  return nb;
};
const envG = (x: X, t: number, dur: number, vol: number, atk: number) => {
  const g = x.c.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return g;
};
const osc = (x: X, t: number, dur: number, vol: number, type: OscillatorType, f0: number, f1 = f0, atk = 0.005) => {
  const o = x.c.createOscillator();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  o.connect(envG(x, t, dur, vol, atk)).connect(x.out); o.start(t); o.stop(t + dur + 0.05);
  return o;
};
const noise = (x: X, t: number, dur: number, vol: number, ft: BiquadFilterType, f0: number, f1 = f0, q = 1, atk = 0.005) => {
  const s = x.c.createBufferSource(), f = x.c.createBiquadFilter();
  s.buffer = noiseBuf(x.c); s.loop = true; f.type = ft; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  s.connect(f).connect(envG(x, t, dur, vol, atk)).connect(x.out); s.start(t, Math.random()); s.stop(t + dur + 0.05);
};
const semis = (base: number, n: number) => base * 2 ** (n / 12);

const hit: Fn = (x, t) => { noise(x, t, 0.18, 0.7, 'lowpass', 1600, 200); osc(x, t, 0.2, 0.6, 'sine', 170, 50); };
const bell: Fn = (x, t) => [1, 2.76, 5.4, 8.9].forEach((m, i) => osc(x, t, 2.6 / (i + 1), 0.22 / (i + 1), 'sine', 520 * m));
const thunder: Fn = (x, t) => {
  noise(x, t, 0.25, 0.5, 'highpass', 1800);
  noise(x, t, 3.8, 0.9, 'lowpass', 700, 60, 1, 0.08);
  osc(x, t, 3, 0.5, 'sine', 55, 28, 0.1);
};

export const SFX_LIST: [string, string, Fn][] = [
  ['door', 'Puerta', (x, t) => {
    osc(x, t, 0.9, 0.06, 'sawtooth', 190, 110); osc(x, t, 0.9, 0.06, 'sawtooth', 195, 115);
    noise(x, t, 0.9, 0.05, 'bandpass', 900, 500, 4, 0.2);
    osc(x, t + 0.9, 0.25, 0.5, 'sine', 95, 40); noise(x, t + 0.9, 0.12, 0.4, 'lowpass', 500, 150);
  }],
  ['thunder', 'Trueno', thunder],
  ['roar', 'Rugido', (x, t) => {
    const o = osc(x, t, 1.5, 0.3, 'sawtooth', 120, 65, 0.1), l = x.c.createOscillator(), lg = x.c.createGain();
    l.frequency.value = 28; lg.gain.value = 25; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + 1.6);
    osc(x, t, 1.5, 0.25, 'square', 60, 40, 0.1); noise(x, t, 1.5, 0.35, 'bandpass', 400, 200, 2, 0.1);
  }],
  ['collapse', 'Derrumbe', (x, t) => {
    noise(x, t, 2.2, 0.7, 'lowpass', 1200, 90, 1, 0.05); osc(x, t, 2, 0.4, 'sine', 60, 30);
    for (let i = 0; i < 9; i++) noise(x, t + 0.1 + Math.random() * 1.6, 0.25, 0.5, 'lowpass', 350 + Math.random() * 300, 100);
  }],
  ['bell', 'Campana', bell],
  ['scream', 'Grito', (x, t) => {
    const o = osc(x, t, 1.3, 0.2, 'sawtooth', 650, 1150, 0.08), l = x.c.createOscillator(), lg = x.c.createGain();
    l.frequency.value = 7; lg.gain.value = 45; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + 1.4);
    noise(x, t, 1.3, 0.1, 'bandpass', 1800, 1200, 3, 0.08);
  }],
  ['magic', 'Magia', (x, t) => {
    [0, 4, 7, 12, 16, 19, 24, 28].forEach((n, i) => osc(x, t + i * 0.07, 0.6, 0.13, 'triangle', semis(523, n)));
    noise(x, t, 0.8, 0.08, 'highpass', 6000, 9000, 1, 0.3);
  }],
  ['coins', 'Monedas', (x, t) => {
    for (let i = 0; i < 6; i++) { const s = t + i * 0.06 + Math.random() * 0.05; osc(x, s, 0.25, 0.12, 'square', 2600 + Math.random() * 900); osc(x, s, 0.3, 0.08, 'sine', 3900); }
  }],
  ['trap', 'Trampa', (x, t) => {
    noise(x, t, 0.04, 0.7, 'highpass', 2500); osc(x, t, 0.09, 0.3, 'square', 1900, 400);
    noise(x, t + 0.12, 0.05, 0.8, 'highpass', 2000); osc(x, t + 0.12, 0.15, 0.3, 'square', 900, 200);
  }],
  ['hit', 'Golpe', hit],
  ['crit', 'Crítico', (x, t) => {
    hit(x, t); noise(x, t, 0.3, 0.3, 'highpass', 5000, 8000); osc(x, t, 0.35, 0.18, 'triangle', 1200, 2400);
    osc(x, t + 0.03, 1.2, 0.1, 'sine', 1560);
  }],
  ['heal', 'Curación', (x, t) => [0, 4, 7, 12].forEach((n, i) => osc(x, t + i * 0.05, 1.3, 0.1, 'sine', semis(523, n), semis(523, n), 0.15))],
  ['miss', 'Fallo', (x, t) => noise(x, t, 0.3, 0.25, 'bandpass', 800, 2500, 2, 0.08)],
];
const BY_NAME = new Map(SFX_LIST.map(([n, , f]) => [n, f]));

export function sfx(name: string, delay = 0) {
  const fn = BY_NAME.get(name), v = getVolume('efectos');
  if (!fn || !ac || ac.state !== 'running' || v <= 0) return; // sin gesto previo el navegador no deja sonar
  const out = ac.createGain(); out.gain.value = v; out.connect(ac.destination);
  fn({ c: ac, out }, ac.currentTime + delay);
}

// El renderer avisa del rayo; el trueno llega un instante después.
window.addEventListener('lantern:thunder', () => sfx('thunder', 0.3 + Math.random() * 0.9));
