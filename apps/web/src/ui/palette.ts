import type { C2S, ClientState, Point, Token, Weather } from '@lantern/protocol';
import { MONSTERS } from '@lantern/srd';
import { SKILLS } from '@lantern/rules';
import './mobile.css';

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
  d.setAttribute('aria-label', 'Paleta de comandos');
  d.innerHTML = `<input type="text" role="combobox" aria-expanded="true" aria-controls="pal-l" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Escribe un comando…" aria-label="Buscar comando">
    <ul id="pal-l" role="listbox" aria-label="Comandos"></ul><p class="sr" role="status"></p>`;
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
      || '<li class="vacio" role="presentation">Sin resultados</li>';
    inp.setAttribute('aria-activedescendant', shown.length ? `pal-${sel}` : '');
    st.textContent = `${shown.length} comandos`;
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
};

const DICE = /^\s*\d*d\d+(\s*[+-]\s*\d+)?(\s*[+-]\s*\d*d\d+)*\s*$/i;
const CLIMA: [Weather['kind'], string][] = [['none', 'despejado'], ['rain', 'lluvia'], ['storm', 'tormenta'], ['snow', 'nieve'], ['fog', 'niebla'], ['ash', 'ceniza'], ['leaves', 'hojas'], ['embers', 'brasas']];
const TABS: [PaletteCtx['tab'] extends (id: infer I) => void ? I : never, string, 'all' | 'trusted' | 'staff'][] = [
  ['reg', 'Registro', 'all'], ['hoja', 'Hoja', 'all'], ['mesa', 'Mesa', 'all'], ['dia', 'Diario', 'all'],
  ['esc', 'Escena', 'trusted'], ['aj', 'Ajustes', 'staff'], ['biblioteca', 'Biblioteca', 'staff'], ['encuentros', 'Encuentros', 'staff'],
];

export function defaultCommands(x: PaletteCtx, q = ''): Cmd[] {
  const dm = x.role === 'dm', staff = dm || x.role === 'assistant', s = x.state(), out: Cmd[] = [];
  const add = (group: string, label: string, run: Cmd['run'], hint?: string) => out.push({ id: `${group}:${label}`, label, group, hint, run });

  if (DICE.test(q)) add('Dados', `Tirar ${q.replace(/\s+/g, '')}`, () => x.send({ t: 'roll', expr: q.replace(/\s+/g, '') }));
  add('Dados', 'Tirar d20', () => x.send({ t: 'roll', expr: 'd20' }));
  const me = x.mine();
  if (me) for (const [id, sk] of Object.entries(SKILLS))
    add('Tiradas', `Tirar ${sk.name}`, () => x.send({ t: 'check', tokenId: me.id, kind: 'skill', key: id }), me.skills?.[id] != null ? `${me.skills[id] >= 0 ? '+' : ''}${me.skills[id]}` : undefined);
  if (me) add('Mesa', 'Centrar en mi personaje', () => x.focus(me.x, me.y), me.name);

  if (dm) {
    const at = x.center();
    for (const [id, m] of Object.entries(MONSTERS)) add('Monstruos', `Añadir ${m.name}`, () => x.send({ t: 'spawn', srd: id, x: at.x, y: at.y }), `VD ${m.cr}`);
    for (const l of s.library ?? []) if (!l.active) add('Escenas', `Ir a escena ${l.name}`, () => x.send({ t: 'sceneActivate', id: l.id }), l.folder);
    for (const [k, n] of CLIMA) add('Clima', `Clima: ${n}`, () => x.send({ t: 'scene', patch: { weather: { kind: k, intensity: .6, wind: 0 } } }));
    add('Vista', 'Modo Historia', () => x.send({ t: 'view', value: 'story' }));
    add('Vista', 'Modo Táctico', () => x.send({ t: 'view', value: 'tactical' }));
    if (s.combat) {
      add('Combate', 'Siguiente turno', () => x.send({ t: 'combat', op: 'next' }));
      add('Combate', 'Terminar combate', () => x.send({ t: 'combat', op: 'end' }));
    } else add('Combate', 'Empezar combate', () => x.send({ t: 'combat', op: 'start' }));
  }
  for (const [id, n, who] of TABS)
    if (who === 'all' || (who === 'trusted' && (staff || x.role === 'trusted')) || staff) add('Panel', `Abrir pestaña ${n}`, () => x.tab(id));
  return out;
}
