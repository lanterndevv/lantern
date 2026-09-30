// Transiciones de escena (fundido, tinta, pergamino, corte a título) y precarga de la escena siguiente.
import './transiciones.css';
import type { TransitionKind } from '@lantern/protocol';
import { t } from '../i18n.ts';

const NAMES: [TransitionKind | '', string][] = [['', t('Sin transición')], ['fade', t('Fundido')], ['ink', t('Barrido de tinta')], ['scroll', t('Pergamino que pasa')], ['title', t('Corte a título')]];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion');
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

let el: HTMLElement | undefined, timer = 0;

/** Reproduce la transición sobre toda la pantalla; `ms` = duración total (cubre hasta la mitad y descubre). */
export function playTransition(m: { title: string; subtitle?: string; kind: TransitionKind; ms?: number }) {
  if (!el) { el = document.createElement('div'); el.setAttribute('aria-hidden', 'true'); el.hidden = true; document.body.append(el); }
  const ms = reduced() ? Math.min(m.ms ?? 2000, 1000) : m.ms ?? 2000;
  clearTimeout(timer); el.hidden = true;
  el.className = `tx tx-${m.kind}`; el.style.setProperty('--tx-ms', `${ms}ms`);
  el.innerHTML = `<div class="tx-fondo"></div><div class="tx-txt"><h2>${esc(m.title)}</h2>${m.subtitle ? `<p>${esc(m.subtitle)}</p>` : ''}</div>`;
  void el.offsetWidth; el.hidden = false; // reinicia las animaciones
  timer = window.setTimeout(() => { el!.hidden = true; }, ms);
}

const held: HTMLImageElement[] = []; // se retienen para que el navegador no cancele la descarga
/** Precarga las imágenes de la escena que el DM va a activar; resuelve cuando todas han cargado (o fallado). */
export function preload(urls: string[]) {
  held.length = 0;
  for (const u of urls.slice(0, 20)) { const i = new Image(); i.src = u; held.push(i); }
  return Promise.allSettled(held.map(i => i.decode()));
}

/** Selector «Transición al activar» (tipo y duración); `get()` devuelve lo elegido o undefined si no hay transición. */
export function transitionPicker() {
  const box = document.createElement('div');
  box.className = 'tx-pick';
  box.innerHTML = `<label>${t('Transición al activar')}<select>${NAMES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label><label>${t('Duración (s)')}<input type="number" min="0.5" max="8" step="0.5" value="2"></label>`;
  const sel = box.querySelector('select')!, dur = box.querySelector('input')!;
  return {
    el: box,
    get(): { kind: TransitionKind; ms: number } | undefined {
      return sel.value ? { kind: sel.value as TransitionKind, ms: Math.round(Math.min(8, Math.max(0.5, +dur.value || 2)) * 1000) } : undefined;
    },
  };
}
