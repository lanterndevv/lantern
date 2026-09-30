import './a11y.css';
import type { ClientState, ChatMsg } from '@lantern/protocol';
import { net } from '../net.ts';
import { PORTATIL, setPortatil } from '../render/portatil.ts';
import { t, lang, setLang, type Lang } from '../i18n.ts';

// ---------- preferencias ----------
type Prefs = { paleta: string; escala: number; contraste: boolean; dislexia: boolean; movimiento: boolean; atajos: Record<string, string> };
const KEY = 'lantern:a11y';
const ACCIONES: [string, string, string][] = [
  ['voz', t('Pulsar para hablar'), 'v'], ['ping', 'Ping', 'p'], ['fin', t('Fin de turno'), 'f'], ['paleta', t('Paleta de comandos'), 'ctrl+k'],
  ...Array.from({ length: 10 }, (_, i): [string, string, string] => [`accion${i + 1}`, t('Acción {n}', { n: i + 1 }), String((i + 1) % 10)]),
];
const DEF: Prefs = { paleta: 'ninguna', escala: 100, contraste: false, dislexia: false, movimiento: false, atajos: {} };
const load = (): Prefs => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEF }; } };
let P = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* sin storage */ } };

// Paletas de daltonismo: los colores de cada tema (texto) y del mapa están en a11y.css bajo html[data-paleta=…].
const FONT_ID = 'lexend-font';

// ---------- tema: Día («Libro de horas») / Noche («Grimorio») / Automático (prefers-color-scheme). index.html lo fija antes de pintar. ----------
const TEMA = 'lantern:tema';
type Tema = 'auto' | 'dia' | 'noche';
const oscuro = matchMedia('(prefers-color-scheme: dark)');
let temaMem: Tema = 'auto'; // si no hay storage, vale para esta sesión
const getTema = (): Tema => { try { const t = localStorage.getItem(TEMA); return t === 'dia' || t === 'noche' ? t : 'auto'; } catch { return temaMem; } };
function applyTema() {
  const t = getTema();
  document.documentElement.dataset.theme = t === 'auto' ? (oscuro.matches ? 'noche' : 'dia') : t;
}
oscuro.addEventListener('change', applyTema);
applyTema();

function apply() {
  queueMicrotask(() => dispatchEvent(new Event('lantern:a11y'))); // el renderer relee los colores de facción/estado
  const h = document.documentElement;
  if (P.paleta === 'ninguna') delete h.dataset.paleta; else h.dataset.paleta = P.paleta;
  h.style.fontSize = P.escala === 100 ? '' : `${16 * P.escala / 100}px`;
  h.classList.toggle('alto-contraste', P.contraste);
  h.classList.toggle('dislexia', P.dislexia);
  h.classList.toggle('reduce-motion', P.movimiento);
  if (P.dislexia) {
    h.style.setProperty('--ui', "'Lexend', system-ui, sans-serif");
    if (!document.getElementById(FONT_ID)) {
      const l = document.createElement('link');
      l.id = FONT_ID; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Lexend:wght@400;700&display=swap';
      document.head.append(l);
    }
  } else h.style.removeProperty('--ui');
}
apply(); // al importar el módulo: las preferencias se aplican aunque no se monte el panel

/** ponytail: usar en render/ y dice/ antes de animar: `if (prefersReducedMotion()) …` (clase forzada + preferencia del SO). */
export const prefersReducedMotion = () =>
  document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- atajos ----------
export const getShortcut = (action: string): string => P.atajos[action] ?? ACCIONES.find(a => a[0] === action)?.[2] ?? '';
const combo = (e: KeyboardEvent) => [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && e.key.length > 1 && 'shift', e.key.toLowerCase()].filter(Boolean).join('+');
/** ¿este keydown es el atajo de la acción? (sin modificador extra: 'v' no salta con Ctrl+V) */
export const matchesShortcut = (e: KeyboardEvent, action: string) => combo(e) === getShortcut(action);

// ---------- panel ----------
export function mountA11y(panelEl: HTMLElement, _ctx?: unknown) {
  const sec = document.createElement('section');
  sec.className = 'a11y';
  sec.setAttribute('aria-labelledby', 'a11y-t');
  const opt = (v: string, txt: string) => `<option value="${v}"${P.paleta === v ? ' selected' : ''}>${txt}</option>`;
  sec.innerHTML = `
    <h2 id="a11y-t">${t('Accesibilidad')}</h2>
    <label>${t('Tema')}
      <select data-tema>${(['auto', 'dia', 'noche'] as const).map(v => `<option value="${v}"${getTema() === v ? ' selected' : ''}>${{ auto: t('Automático (según el sistema)'), dia: t('Día · Libro de horas'), noche: t('Noche · Grimorio') }[v]}</option>`).join('')}</select></label>
    <label>${t('Idioma')}
      <select data-lang>${(['es', 'en'] as const).map(v => `<option value="${v}"${lang === v ? ' selected' : ''}>${{ es: 'Español', en: 'English' }[v]}</option>`).join('')}</select></label>
    <label>${t('Paleta para daltonismo')}
      <select data-k="paleta">${opt('ninguna', t('Ninguna'))}${opt('deuteranopia', t('Deuteranopía'))}${opt('protanopia', t('Protanopía'))}${opt('tritanopia', t('Tritanopía'))}</select></label>
    <label>${t('Escala de la interfaz')} <output>${P.escala}%</output>
      <input type="range" data-k="escala" min="90" max="150" step="5" value="${P.escala}"></label>
    <label>${t('Alto contraste')} <input type="checkbox" data-k="contraste"${P.contraste ? ' checked' : ''}></label>
    <label>${t('Tipografía para dislexia')} <input type="checkbox" data-k="dislexia"${P.dislexia ? ' checked' : ''}></label>
    <label>${t('Movimiento reducido')} <input type="checkbox" data-k="movimiento"${P.movimiento ? ' checked' : ''}></label>
    <label>${t('Modo portátil (ahorra batería: 30 fps, sin postproceso ni efectos extra; recarga la página)')} <input type="checkbox" data-portatil${PORTATIL ? ' checked' : ''}></label>
    <h3>${t('Atajos de teclado')}</h3>
    <ul class="atajos"></ul>
    <button type="button" data-reset>${t('Restablecer atajos')}</button>`;
  const ul = sec.querySelector('.atajos')!;
  const draw = () => {
    ul.replaceChildren(...ACCIONES.map(([id, nombre]) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.textContent = getShortcut(id) || '—';
      b.setAttribute('aria-label', t('{name}: {key}. Pulsa para cambiar', { name: nombre, key: getShortcut(id) }));
      b.onclick = () => {
        b.textContent = t('Pulsa una tecla…');
        const on = (e: KeyboardEvent) => {
          if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return; // esperar a la tecla real
          e.preventDefault(); e.stopPropagation();
          removeEventListener('keydown', on, true);
          if (e.key !== 'Escape') { P.atajos[id] = combo(e); save(); }
          draw();
        };
        addEventListener('keydown', on, true);
      };
      li.append(Object.assign(document.createElement('span'), { textContent: nombre }), b);
      return li;
    }));
  };
  draw();
  sec.addEventListener('input', e => {
    const t = e.target as HTMLInputElement, k = t.dataset.k as keyof Prefs | undefined;
    if (t.dataset.lang != null) return setLang(t.value as Lang);
    if (t.dataset.portatil != null) return setPortatil(t.checked);
    if (t.dataset.tema != null) { temaMem = t.value as Tema; try { localStorage.setItem(TEMA, t.value); } catch { /* sin storage */ } applyTema(); return; }
    if (!k) return;
    (P as Record<string, unknown>)[k] = t.type === 'checkbox' ? t.checked : k === 'escala' ? +t.value : t.value;
    if (k === 'escala') sec.querySelector('output')!.textContent = `${P.escala}%`;
    save(); apply();
  });
  sec.querySelector<HTMLElement>('[data-reset]')!.onclick = () => { P.atajos = {}; save(); draw(); };
  panelEl.append(sec);
  return sec;
}

// ---------- lector de pantalla ----------
const estado = (k: { hp?: { cur: number; max: number } }) => {
  if (!k.hp) return '';
  const { cur, max } = k.hp;
  return t(cur <= 0 ? 'caído' : cur <= max / 2 ? 'malherido' : cur < max ? 'herido' : 'ileso');
};
const fac = { ally: t('aliado'), enemy: t('enemigo'), neutral: t('neutral') } as const;

function cardText(m: ChatMsg): string {
  if (m.roll) return m.roll.secret ? '' : t('Tirada {expr}: {total}', { expr: m.roll.label ? `${m.roll.label} (${m.roll.expr})` : m.roll.expr, total: m.roll.total });
  const c = m.card;
  if (!c) return '';
  const tg = c.targets.map(x => {
    const r = x.attack ? t(x.attack.crit ? 'crítico' : x.attack.hit ? 'impacta' : 'falla') : x.save ? t(x.save.success ? 'supera la salvación' : 'falla la salvación') : '';
    return `${x.name} ${r}${x.amount != null ? `, ${x.amount} ${t(c.kind === 'heal' ? 'de curación' : 'de daño')}` : ''}`;
  }).join('; ');
  return t('{actor} usa {action}. {targets}', { actor: c.actorName, action: c.actionName, targets: tg });
}

export function mountScreenReaderMirror(root: HTMLElement, getState: () => ClientState | undefined) {
  const live = document.createElement('div');
  live.className = 'sr-only'; live.setAttribute('aria-live', 'polite'); live.setAttribute('role', 'status');
  const list = document.createElement('ul');
  list.className = 'sr-only'; list.tabIndex = -1; list.setAttribute('aria-label', t('Tokens visibles en el mapa'));
  root.append(live, list);
  let last = '';
  const say = (s: string) => { if (s) live.textContent = s; };

  const refresh = (s: ClientState) => {
    const g = s.scene.grid;
    list.replaceChildren(...s.scene.tokens.filter(k => !k.hidden).map(k => {
      const li = document.createElement('li');
      const col = Math.floor((k.x - g.offsetX) / g.size) + 1, fila = Math.floor((k.y - g.offsetY) / g.size) + 1;
      li.textContent = [k.name, fac[k.faction], t('casilla {c}-{f}', { c: col, f: fila }), estado(k)].filter(Boolean).join(', ');
      return li;
    }));
    const c = s.combat, id = c?.order[c.turn]?.tokenId;
    const key = c && id ? `${id}:${c.round}` : '';
    if (key && key !== last) say(t('Turno de {name}, ronda {n}', { name: s.scene.tokens.find(k => k.id === id)?.name ?? t('alguien'), n: c!.round }));
    last = key;
  };
  const s0 = getState(); if (s0) refresh(s0);
  const off = net.on(m => {
    if (m.t === 'state' || m.t === 'welcome') refresh(m.state);
    else if (m.t === 'chat') say(cardText(m.msg));
  });
  const key = (e: KeyboardEvent) => { if (e.altKey && e.shiftKey && e.code === 'KeyL') { e.preventDefault(); list.focus(); } };
  addEventListener('keydown', key);
  return () => { off(); removeEventListener('keydown', key); live.remove(); list.remove(); };
}
