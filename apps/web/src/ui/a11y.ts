import './a11y.css';
import type { ClientState, ChatMsg } from '@lantern/protocol';
import { net } from '../net.ts';

// ---------- preferencias ----------
type Prefs = { paleta: string; escala: number; contraste: boolean; dislexia: boolean; movimiento: boolean; atajos: Record<string, string> };
const KEY = 'lantern:a11y';
const ACCIONES: [string, string, string][] = [
  ['voz', 'Pulsar para hablar', 'v'], ['ping', 'Ping', 'p'], ['fin', 'Fin de turno', 'f'], ['paleta', 'Paleta de comandos', 'ctrl+k'],
  ...Array.from({ length: 10 }, (_, i): [string, string, string] => [`accion${i + 1}`, `Acción ${i + 1}`, String((i + 1) % 10)]),
];
const DEF: Prefs = { paleta: 'ninguna', escala: 100, contraste: false, dislexia: false, movimiento: false, atajos: {} };
const load = (): Prefs => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEF }; } };
let P = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* sin storage */ } };

// [aliado, enemigo, éxito, peligro]: azul/naranja con luminosidad distinta
const PALETAS: Record<string, string[]> = {
  deuteranopia: ['#3B82F6', '#F5A524', '#5EA8FF', '#FFC266'],
  protanopia: ['#4C8DFF', '#FFB454', '#7DB4FF', '#FFD08A'],
  tritanopia: ['#2EC4B6', '#E0457B', '#6EE0D2', '#FF7AA6'],
};
const VARS = ['--aliado', '--enemigo', '--exito', '--peligro'];
const FONT_ID = 'lexend-font';

function apply() {
  const h = document.documentElement, pal = PALETAS[P.paleta];
  VARS.forEach((v, i) => pal ? h.style.setProperty(v, pal[i]) : h.style.removeProperty(v));
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
  const opt = (v: string, t: string) => `<option value="${v}"${P.paleta === v ? ' selected' : ''}>${t}</option>`;
  sec.innerHTML = `
    <h2 id="a11y-t">Accesibilidad</h2>
    <label>Paleta para daltonismo
      <select data-k="paleta">${opt('ninguna', 'Ninguna')}${opt('deuteranopia', 'Deuteranopía')}${opt('protanopia', 'Protanopía')}${opt('tritanopia', 'Tritanopía')}</select></label>
    <label>Escala de la interfaz <output>${P.escala}%</output>
      <input type="range" data-k="escala" min="90" max="150" step="5" value="${P.escala}"></label>
    <label>Alto contraste <input type="checkbox" data-k="contraste"${P.contraste ? ' checked' : ''}></label>
    <label>Tipografía para dislexia <input type="checkbox" data-k="dislexia"${P.dislexia ? ' checked' : ''}></label>
    <label>Movimiento reducido <input type="checkbox" data-k="movimiento"${P.movimiento ? ' checked' : ''}></label>
    <h3>Atajos de teclado</h3>
    <ul class="atajos"></ul>
    <button type="button" data-reset>Restablecer atajos</button>`;
  const ul = sec.querySelector('.atajos')!;
  const draw = () => {
    ul.replaceChildren(...ACCIONES.map(([id, nombre]) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.textContent = getShortcut(id) || '—';
      b.setAttribute('aria-label', `${nombre}: ${getShortcut(id)}. Pulsa para cambiar`);
      b.onclick = () => {
        b.textContent = 'Pulsa una tecla…';
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
const estado = (t: { hp?: { cur: number; max: number } }) => {
  if (!t.hp) return '';
  const { cur, max } = t.hp;
  return cur <= 0 ? 'caído' : cur <= max / 2 ? 'malherido' : cur < max ? 'herido' : 'ileso';
};
const fac = { ally: 'aliado', enemy: 'enemigo', neutral: 'neutral' } as const;

function cardText(m: ChatMsg): string {
  if (m.roll) return m.roll.secret ? '' : `Tirada ${m.roll.expr}: ${m.roll.total}`;
  const c = m.card;
  if (!c) return '';
  const t = c.targets.map(x => {
    const r = x.attack ? (x.attack.crit ? 'crítico' : x.attack.hit ? 'impacta' : 'falla') : x.save ? (x.save.success ? 'supera la salvación' : 'falla la salvación') : '';
    return `${x.name} ${r}${x.amount != null ? `, ${x.amount} ${c.kind === 'heal' ? 'de curación' : 'de daño'}` : ''}`;
  }).join('; ');
  return `${c.actorName} usa ${c.actionName}. ${t}`;
}

export function mountScreenReaderMirror(root: HTMLElement, getState: () => ClientState | undefined) {
  const live = document.createElement('div');
  live.className = 'sr-only'; live.setAttribute('aria-live', 'polite'); live.setAttribute('role', 'status');
  const list = document.createElement('ul');
  list.className = 'sr-only'; list.tabIndex = -1; list.setAttribute('aria-label', 'Tokens visibles en el mapa');
  root.append(live, list);
  let last = '';
  const say = (s: string) => { if (s) live.textContent = s; };

  const refresh = (s: ClientState) => {
    const g = s.scene.grid;
    list.replaceChildren(...s.scene.tokens.filter(t => !t.hidden).map(t => {
      const li = document.createElement('li');
      const col = Math.floor((t.x - g.offsetX) / g.size) + 1, fila = Math.floor((t.y - g.offsetY) / g.size) + 1;
      li.textContent = [t.name, fac[t.faction], `casilla ${col}-${fila}`, estado(t)].filter(Boolean).join(', ');
      return li;
    }));
    const c = s.combat, id = c?.order[c.turn]?.tokenId;
    const key = c && id ? `${id}:${c.round}` : '';
    if (key && key !== last) say(`Turno de ${s.scene.tokens.find(t => t.id === id)?.name ?? 'alguien'}, ronda ${c!.round}`);
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
