// Voces de PNJ con speechSynthesis nativo (sin IA, sin coste). Desactivado por defecto.
import { getVolume } from './audio.ts';

const KEY = 'lantern:npcvoz';
const synth: SpeechSynthesis | undefined = typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis;
const on = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
let stopBtn: HTMLButtonElement | undefined;

export function stopSpeaking() { synth?.cancel(); }

/** Lee `text` con una voz estable para `name`. No hace nada si el interruptor está apagado. */
export function speakNpc(name: string, text: string): void {
  if (!synth || !on() || !text.trim()) return;
  const h = hash(name.trim().toLowerCase());
  const all = synth.getVoices();
  const es = all.filter(v => /^es(-|_|$)/i.test(v.lang));
  const pool = es.filter(v => /^es[-_]ES/i.test(v.lang));
  const list = pool.length ? pool : es;
  const u = new SpeechSynthesisUtterance(text);
  if (list.length) { u.voice = list[h % list.length]; u.lang = u.voice.lang; } else u.lang = 'es-ES';
  u.pitch = 0.8 + (h % 41) / 100;              // 0,8–1,2
  u.rate = 0.9 + ((h >>> 8) % 16) / 100;       // 0,9–1,05
  u.volume = getVolume('voz');
  const fin = () => { if (stopBtn) stopBtn.hidden = !synth.speaking; };
  u.onstart = () => { if (stopBtn) stopBtn.hidden = false; };
  u.onend = u.onerror = fin;
  synth.cancel();
  synth.speak(u);
}

export function mountVoicesToggle(el: HTMLElement): void {
  if (!synth) return; // navegador sin síntesis: no se ofrece
  el.classList.add('voces');
  const lbl = document.createElement('label');
  lbl.className = 'chk';
  const chk = document.createElement('input');
  chk.type = 'checkbox'; chk.checked = on();
  chk.onchange = () => { try { localStorage.setItem(KEY, chk.checked ? '1' : '0'); } catch { /* sin almacenamiento */ } if (!chk.checked) stopSpeaking(); };
  lbl.append(chk, ' Leer en voz alta a los PNJ');
  const hint = document.createElement('p');
  hint.className = 'det';
  hint.textContent = 'Usa el volumen del canal «Voz» del mezclador. Esc detiene la lectura.';
  stopBtn = document.createElement('button');
  stopBtn.type = 'button'; stopBtn.hidden = true; stopBtn.textContent = 'Silenciar';
  stopBtn.onclick = () => { stopSpeaking(); stopBtn!.hidden = true; };
  el.append(lbl, hint, stopBtn);
  addEventListener('keydown', e => { if (e.key === 'Escape' && synth.speaking) { stopSpeaking(); stopBtn!.hidden = true; } });
}
