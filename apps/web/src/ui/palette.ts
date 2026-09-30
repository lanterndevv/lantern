import type { C2S, ClientState, Point, Token, Weather } from '@lantern/protocol';
import { MONSTERS } from '@lantern/srd';
import { SKILLS } from '@lantern/rules';
import './mobile.css';
import { t, lang } from '../i18n.ts';
import { activateScene } from './library.ts';

/** Nombre de monstruo para mostrar: en inglés, el id SRD en Title Case (los nombres del paquete están en español). */
export const monName = (id: string, es: string) => lang === 'en' ? id.replace(/(^|-)(\w)/g, (_, s, c) => (s && ' ') + c.toUpperCase()) : es;

export type Cmd = { id: string; label: string; hint?: string; group: string; run(arg?: string): void };

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Subsecuencia con puntos: letras seguidas y comienzos de palabra puntúan más. null = no coincide.
export function fuzzy(q: string, text: string): number | null {
  const a = fold(q), b = fold(text);
  let j = 0, score = 0, run = 0;
  for (let i = 0; i < b.length && j < a.length; i++) {
    if (b[i] !== a[j]) { run = 0; continue; }
    run++; j++;
    score += 1 + run * 2 + (i === 0 || b[i - 1] === ' ' ? 5 : 0);
  }
  return j < a.length ? null : score - b.length * .05;
}

export function mountPalette(c: { commands(q?: string): Cmd[] }) {
  const d = document.createElement('dialog');
  d.className = 'pal';
  d.setAttribute('aria-label', t('Paleta de comandos'));
  d.innerHTML = `<input type="text" role="combobox" aria-expanded="true" aria-controls="pal-l" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="${t('Escribe un comando…')}" aria-label="${t('Buscar comando')}">
    <ul id="pal-l" role="listbox" aria-label="${t('Comandos')}"></ul><p class="sr" role="status"></p>`;
  const inp = d.querySelector('input')!, ul = d.querySelector('ul')!, st = d.querySelector('p')!;
  let shown: Cmd[] = [], sel = 0;

  const esc = (s: string) => s.replace(/[&<>"]/g, ch => `&#${ch.charCodeAt(0)};`);
  const render = () => {
    const q = inp.value.trim();
    const all = c.commands(q);
    shown = (q ? all.map(m => [m, fuzzy(q, m.label + ' ' + m.group)] as const).filter((x): x is [Cmd, number] => x[1] != null)
      .sort((x, y) => y[1] - x[1]).map(x => x[0]) : all).slice(0, 50);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    ul.innerHTML = shown.map((m, i) => `<li role="option" id="pal-${i}" data-i="${i}" aria-selected="${i === sel}"><span>${esc(m.label)}</span><small>${esc(m.hint ?? m.group)}</small></li>`).join('')
      || `<li class="vacio" role="presentation">${t('Sin resultados')}</li>`;
    inp.setAttribute('aria-activedescendant', shown.length ? `pal-${sel}` : '');
    st.textContent = t('{n} comando|{n} comandos', { n: shown.length });
  };
  const move = (i: number) => {
    if (!shown.length) return;
    sel = (i + shown.length) % shown.length;
    ul.querySelectorAll('[aria-selected=true]').forEach(e => e.setAttribute('aria-selected', 'false'));
    const li = ul.children[sel] as HTMLElement;
    li.setAttribute('aria-selected', 'true'); li.scrollIntoView({ block: 'nearest' });
    inp.setAttribute('aria-activedescendant', li.id);
  };
  const exec = (i: number) => { const m = shown[i], q = inp.value.trim(); if (!m) return; d.close(); m.run(q); };

  inp.oninput = () => { sel = 0; render(); };
  inp.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(sel - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); exec(sel); }
  };
  ul.onclick = e => { const li = (e.target as HTMLElement).closest<HTMLElement>('[data-i]'); if (li) exec(+li.dataset.i!); };
  d.addEventListener('click', e => { if (e.target === d) d.close(); }); // clic en el fondo
  const open = () => { if (d.open) return; inp.value = ''; sel = 0; render(); d.showModal(); inp.focus(); };
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); d.open ? d.close() : open(); }
  };
  document.addEventListener('keydown', onKey);
  document.body.append(d);
  return { open, destroy() { document.removeEventListener('keydown', onKey); d.remove(); } };
}

export type PaletteCtx = {
  role: string; memberId: string;
  send(m: C2S): void;
  state(): ClientState;
  center(): Point;                       // centro de la vista en coords de mundo (para spawn)
  mine(): Token | undefined;             // token propio (o el seleccionado si eres DM)
  tab(id: 'reg' | 'hoja' | 'mesa' | 'esc' | 'aj' | 'dia' | 'biblioteca' | 'encuentros'): void;
  focus(x: number, y: number): void;
  tutorial?(): void;                     // vuelve a abrir la guía de bienvenida
};

const DICE = /^\s*\d*d\d+(\s*[+-]\s*\d+)?(\s*[+-]\s*\d*d\d+)*\s*$/i;
const CLIMA: [Weather['kind'], string][] = [['none', t('despejado')], ['rain', t('lluvia')], ['storm', t('tormenta')], ['snow', t('nieve')], ['fog', t('niebla')], ['ash', t('ceniza')], ['leaves', t('hojas')], ['embers', t('brasas')]];
const TABS: [PaletteCtx['tab'] extends (id: infer I) => void ? I : never, string, 'all' | 'trusted' | 'staff'][] = [
  ['reg', t('Registro'), 'all'], ['hoja', t('Hoja'), 'all'], ['mesa', t('Mesa'), 'all'], ['dia', t('Diario'), 'all'],
  ['esc', t('Escena'), 'trusted'], ['aj', t('Ajustes'), 'staff'], ['biblioteca', t('Biblioteca'), 'staff'], ['encuentros', t('Encuentros'), 'staff'],
];

export function defaultCommands(x: PaletteCtx, q = ''): Cmd[] {
  const dm = x.role === 'dm', staff = dm || x.role === 'assistant', s = x.state(), out: Cmd[] = [];
  const add = (group: string, label: string, run: Cmd['run'], hint?: string) => out.push({ id: `${group}:${label}`, label, group: t(group), hint, run });

  if (DICE.test(q)) add('Dados', t('Tirar {expr}', { expr: q.replace(/\s+/g, '') }), () => x.send({ t: 'roll', expr: q.replace(/\s+/g, '') }));
  add('Dados', t('Tirar d20'), () => x.send({ t: 'roll', expr: 'd20' }));
  if (x.tutorial) add('Ayuda', t('Repetir la guía'), x.tutorial);
  const me = x.mine();
  if (me) for (const [id, sk] of Object.entries(SKILLS))
    add('Tiradas', t('Tirar {name}', { name: t(sk.name) }), () => x.send({ t: 'check', tokenId: me.id, kind: 'skill', key: id }), me.skills?.[id] != null ? `${me.skills[id] >= 0 ? '+' : ''}${me.skills[id]}` : undefined);
  if (me) add('Mesa', t('Centrar en mi personaje'), () => x.focus(me.x, me.y), me.name);

  if (dm) {
    const at = x.center();
    for (const [id, m] of Object.entries(MONSTERS)) add('Monstruos', t('Añadir {name}', { name: monName(id, m.name) }), () => x.send({ t: 'spawn', srd: id, x: at.x, y: at.y }), `${t('VD')} ${m.cr}`);
    for (const l of s.library ?? []) if (!l.active) add('Escenas', t('Ir a escena {name}', { name: l.name }), () => activateScene(x, l.id), l.folder);
    for (const [k, n] of CLIMA) add('Clima', t('Clima: {n}', { n }), () => x.send({ t: 'scene', patch: { weather: { kind: k, intensity: .6, wind: 0 } } }));
    add('Vista', t('Modo Historia'), () => x.send({ t: 'view', value: 'story' }));
    add('Vista', t('Modo Táctico'), () => x.send({ t: 'view', value: 'tactical' }));
    if (s.combat) {
      add('Combate', t('Siguiente turno'), () => x.send({ t: 'combat', op: 'next' }));
      add('Combate', t('Terminar combate'), () => x.send({ t: 'combat', op: 'end' }));
    } else add('Combate', t('Empezar combate'), () => x.send({ t: 'combat', op: 'start' }));
  }
  for (const [id, n, who] of TABS)
    if (who === 'all' || (who === 'trusted' && (staff || x.role === 'trusted')) || staff) add('Panel', t('Abrir pestaña {n}', { n }), () => x.tab(id));
  return out;
}
