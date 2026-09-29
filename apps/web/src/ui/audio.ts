// Audio compartido: música sincronizada con el reloj del servidor, capas de ambiente y mezclador local.
import type { AudioState, C2S, Point, Wall } from '@lantern/protocol';
import { cover, sightSegments } from '@lantern/vision';

export type Chan = 'musica' | 'ambiente' | 'efectos' | 'voz';
export const CHANNELS: [Chan, string][] = [['musica', 'Música'], ['ambiente', 'Ambiente'], ['efectos', 'Efectos'], ['voz', 'Voz']];

const mem: Partial<Record<Chan, number>> = {}, muteMem: Partial<Record<Chan, boolean>> = {}; // por si localStorage no está disponible
export function isMuted(k: Chan): boolean {
  if (muteMem[k] != null) return muteMem[k]!;
  try { return localStorage.getItem('lantern:mute:' + k) === '1'; } catch { return false; }
}
export function setMuted(k: Chan, m: boolean) {
  muteMem[k] = m;
  try { localStorage.setItem('lantern:mute:' + k, m ? '1' : '0'); } catch { /* sin almacenamiento */ }
}
const rawVolume = (k: Chan): number => {
  if (mem[k] != null) return mem[k]!;
  try { const v = parseFloat(localStorage.getItem('lantern:vol:' + k) ?? ''); if (v >= 0 && v <= 1) return v; } catch { /* sin almacenamiento */ }
  return 0.8;
};
export const getVolume = (k: Chan): number => isMuted(k) ? 0 : rawVolume(k); // silenciado = 0 para todos los consumidores
export function setVolume(k: Chan, v: number) {
  mem[k] = v;
  try { localStorage.setItem('lantern:vol:' + k, String(v)); } catch { /* sin almacenamiento */ }
}

export function mountMixer(el: HTMLElement) {
  el.innerHTML = '<h2>Mezclador</h2>' + CHANNELS.map(([k, n]) =>
    `<label>${n} <output id="mx-o-${k}"></output><input type="range" min="0" max="100" step="1" data-k="${k}" value="${Math.round(rawVolume(k) * 100)}"><input type="checkbox" data-m="${k}" aria-label="Silenciar ${n}"${isMuted(k) ? ' checked' : ''}> Silencio</label>`).join('');
  const out = (k: string, v: number) => { el.querySelector('#mx-o-' + k)!.textContent = v + ' %'; };
  el.querySelectorAll<HTMLInputElement>('input[data-k]').forEach(i => out(i.dataset.k!, +i.value));
  el.addEventListener('input', e => {
    const i = e.target as HTMLInputElement;
    if (i.dataset.m) return setMuted(i.dataset.m as Chan, i.checked);
    setVolume(i.dataset.k as Chan, +i.value / 100); out(i.dataset.k!, +i.value);
  });
}

type Entry = { el: HTMLAudioElement; f: number; want: 0 | 1; url: string; lp?: BiquadFilterNode };
type Track = NonNullable<AudioState['track']>;
const FADE_MS = 1500, TICK_MS = 100;
const clamp = (v: number) => Math.max(0, Math.min(1, v));

export function mountAudio(root: HTMLElement, o: { own(): Point | undefined; walls(): Wall[]; send(m: C2S): void }) {
  let offset = 0, blocked = false, track: Track | undefined;
  const now = () => Date.now() + offset;
  let music: Entry[] = []; // la última es la actual; las anteriores se apagan
  const layers = new Map<string, Entry & { l: AudioState['layers'][number] }>();

  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'snd-on primary'; btn.textContent = 'Activar sonido'; btn.hidden = true;
  root.append(btn);
  const setBlocked = (b: boolean) => { blocked = b; btn.hidden = !b; };
  btn.onclick = () => setBlocked(false);
  document.addEventListener('pointerdown', () => { if (blocked) setBlocked(false); }, { capture: true });

  // Oclusión: el filtro paso bajo solo se monta con audio del mismo origen (con otro origen createMediaElementSource enmudece).
  let ctx: AudioContext | undefined;
  const lowpass = (e: Entry) => {
    if (e.lp) return e.lp;
    try {
      if (new URL(e.url, location.href).origin !== location.origin) return;
      ctx ??= new AudioContext();
      if (ctx.state !== 'running') { void ctx.resume(); return; }
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 20000;
      ctx.createMediaElementSource(e.el).connect(f).connect(ctx.destination);
      return e.lp = f;
    } catch { /* sin WebAudio */ }
  };

  const play = (el: HTMLAudioElement) => {
    el.play().catch((e: Error) => { if (e.name === 'NotAllowedError') setBlocked(true); });
  };
  const mk = (url: string, loop: boolean) => { const el = new Audio(url); el.preload = 'auto'; el.loop = loop; el.volume = 0; return el; };
  const drop = (e: Entry) => { e.el.pause(); e.el.removeAttribute('src'); e.el.load(); };

  function sync(e: Entry, t: Track) {
    const el = e.el, paused = t.pausedAt != null;
    if (el.readyState >= 1) {
      const d = el.duration;
      let p = Math.max(0, ((paused ? t.pausedAt! : now()) - t.startedAt) / 1000);
      const fin = Number.isFinite(d) && d > 0;
      if (fin && t.loop) p %= d;
      else if (fin && p >= d) { el.pause(); return; }
      let diff = Math.abs(el.currentTime - p);
      if (fin && t.loop) diff = Math.min(diff, d - diff); // cerca del empalme del bucle
      if (diff > 0.3) el.currentTime = p;
    }
    el.loop = t.loop;
    if (paused) el.pause(); else if (el.paused && !blocked) play(el);
  }

  function tick() {
    const step = TICK_MS / FADE_MS, vm = getVolume('musica');
    for (const e of music) {
      e.f = clamp(e.f + Math.max(-step, Math.min(step, e.want - e.f)));
      e.el.volume = e.f * vm;
      if (e.want && e === music[music.length - 1] && track) sync(e, track);
    }
    music.filter(e => !e.want && e.f === 0).forEach(drop);
    music = music.filter(e => e.want || e.f > 0);
    const own = o.own(), va = getVolume('ambiente');
    for (const e of layers.values()) {
      const { el, l } = e;
      // ponytail: atenuación lineal por distancia; oclusión = algún muro que bloquea la vista entre fuente y token (sin distinguir plantas)
      const pos = l.x != null && l.y != null && l.radius && own;
      const att = pos ? Math.max(0, 1 - Math.hypot(own.x - l.x!, own.y - l.y!) / l.radius!) : 1;
      const occ = pos && cover(own, { x: l.x!, y: l.y! }, 0, sightSegments(o.walls())) !== 0;
      const lp = occ || e.lp ? lowpass(e) : undefined;
      if (lp) lp.frequency.setTargetAtTime(occ ? 500 : 20000, lp.context.currentTime, 0.15);
      el.volume = clamp(l.volume * va * att * (occ && lp ? 0.6 : occ ? 0.35 : 1)); // sin filtro se compensa atenuando más
      if (el.paused && !blocked) play(el);
    }
  }
  setInterval(tick, TICK_MS);
  setInterval(() => o.send({ t: 'clockReq' } as unknown as C2S), 60_000); // fuera del contrato: el servidor puede ignorarlo

  return {
    clock(serverNow: number) { offset = serverNow - Date.now(); },
    update(a: AudioState) {
      track = a.track;
      const cur = music[music.length - 1];
      if (!a.track) music.forEach(e => { e.want = 0; });
      else if (!cur || !cur.want || cur.url !== a.track.url) {
        music.forEach(e => { e.want = 0; });
        music.push({ el: mk(a.track.url, a.track.loop), f: 0, want: 1, url: a.track.url });
      }
      const ids = new Set(a.layers.map(l => l.id));
      for (const [id, e] of layers) if (!ids.has(id)) { drop(e); layers.delete(id); }
      for (const l of a.layers) {
        const e = layers.get(l.id);
        if (e && e.url === l.url) e.l = l;
        else { if (e) drop(e); layers.set(l.id, { el: mk(l.url, true), f: 1, want: 1, url: l.url, l }); }
      }
    },
  };
}
