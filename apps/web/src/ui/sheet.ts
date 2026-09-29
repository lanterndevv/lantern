import type { Ability, C2S, Token } from '@lantern/protocol';
import { CONDITIONS, SKILLS } from '@lantern/rules';
import { openCreator } from './creator.ts';
import { tokenImagePicker } from './draw.ts';
import { mountSheetExtras } from './sheetx.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const AB: Record<Ability, string> = { str: 'FUE', dex: 'DES', con: 'CON', int: 'INT', wis: 'SAB', cha: 'CAR' };
const ABS = Object.keys(AB) as Ability[];
const DTYPES: Record<string, string> = {
  '': 'sin tipo', slashing: 'cortante', piercing: 'perforante', bludgeoning: 'contundente', fire: 'fuego', cold: 'frío',
  lightning: 'rayo', acid: 'ácido', poison: 'veneno', necrotic: 'necrótico', radiant: 'radiante', force: 'fuerza',
  psychic: 'psíquico', thunder: 'trueno',
};
const COND_ICON: Record<string, string> = { // patrón + icono: el estado no depende solo del color
  blinded: '◐', charmed: '♥', deafened: '≋', exhaustion: '☾', frightened: '!', grappled: '✋', incapacitated: '✖', invisible: '◌',
  paralyzed: '⌁', petrified: '▲', poisoned: '☠', prone: '⤓', restrained: '⛓', stunned: '✦', unconscious: 'z',
};
const sg = (n: number) => (n >= 0 ? '+' : '−') + Math.abs(n);
const mod = (score: number) => Math.floor((score - 10) / 2);

export const deathSavesHtml = (t: Token) => {
  const d = t.deathSaves ?? { successes: 0, failures: 0 };
  const boxes = (n: number, cls: string, label: string) => `<span class="dsr ${cls}" role="img" aria-label="${label}: ${n} de 3">` +
    [0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join('') + '</span>';
  return `<div class="muerte"><strong>Salvaciones de muerte</strong>
    <div>Éxitos ${boxes(d.successes, 'ok', 'Éxitos')}</div><div>Fallos ${boxes(d.failures, 'ko', 'Fallos')}</div>
    <button type="button" class="primary" data-ds="${esc(t.id)}">Tirar salvación de muerte</button></div>`;
};

type Ctx = { role: string; memberId: string; token: () => Token | undefined; send: (m: C2S) => void; code: string; key: () => string | null };

export function mountSheet(el: HTMLElement, cx: Ctx) {
  const dm = cx.role === 'dm';
  // Parte estática (formularios que no deben perder el foco al llegar estado) + parte dinámica
  el.innerHTML = `<div id="sh-vacio" class="det" hidden>No controlas ningún personaje. Selecciona un token.</div>
    <div id="sh-hp" class="sr" role="status" aria-live="polite"></div>
    <div id="sh-img"></div>
    <div id="sh-dyn"></div>
    <div id="sh-x"></div>
    <div id="sh-forms" hidden>
      <form id="sh-cond" class="fila"><label>Condición<select id="sh-cid">${Object.entries(CONDITIONS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <label>Rondas (opcional)<input id="sh-cr" type="number" min="1" inputmode="numeric"></label>
        <button type="submit">+ Condición</button></form>
      ${dm ? `<form id="sh-hpf" class="fila"><label>Cantidad<input id="sh-n" type="number" min="1" inputmode="numeric" required></label>
        <label>Tipo de daño<select id="sh-dt">${Object.entries(DTYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <div class="dmbtns3"><button type="button" data-hp="damage">Daño</button><button type="button" data-hp="heal">Curar</button><button type="button" data-hp="temp">Temp</button></div></form>` : ''}
      <button type="button" id="sh-crear" class="secondary">Crear personaje</button>
    </div>`;
  const q = <T extends HTMLElement>(id: string) => el.querySelector<T>('#' + id)!;
  const sx = mountSheetExtras(q('sh-x'), cx);
  let lastHp = '', lastId = '', imgId = '';
  const render = () => {
    const t = cx.token();
    q('sh-vacio').hidden = !!t; q('sh-forms').hidden = !t;
    if (!t) { q('sh-dyn').replaceChildren(); q('sh-img').replaceChildren(); imgId = ''; sx.render(); return; }
    if (t.id !== imgId) { // el selector de imagen es estático: solo se rehace al cambiar de token (si no, se pierde el estado de la subida)
      imgId = t.id;
      q('sh-img').replaceChildren(...(dm || t.owners.includes(cx.memberId) ? [tokenImagePicker(t, cx)] : []));
    }
    const ab = t.abilities, prof = t.prof ?? 0;
    const hp = t.hp;
    const hpTxt = hp ? `PG ${hp.cur} de ${hp.max}${hp.temp ? `, más ${hp.temp} temporales` : ''}` : '';
    if (t.id === lastId && hpTxt !== lastHp) q('sh-hp').textContent = `${t.name}: ${hpTxt}`;
    lastHp = hpTxt; lastId = t.id;
    const head = `<div class="cab-h"><strong class="nombre">${esc(t.name)}</strong>
      ${t.ddb ? `<span class="det">${esc(t.ddb.classes)} · nivel ${t.ddb.level}</span>` : ''}</div>
      ${hp ? `<div class="hpbar grande" role="progressbar" aria-label="Puntos de golpe" aria-valuemin="0" aria-valuemax="${hp.max}" aria-valuenow="${hp.cur}"><i style="width:${Math.max(0, Math.min(100, hp.cur / hp.max * 100))}%"></i></div>` : ''}
      <div class="stats">${hp ? `<span>PG <b>${hp.cur}/${hp.max}</b>${hp.temp ? ` <em>+${hp.temp} temp</em>` : ''}</span>` : ''}
        ${t.ac != null ? `<span>CA <b>${t.ac}</b></span>` : ''}${t.speed != null ? `<span>Vel. <b>${t.speed}</b> pies</span>` : ''}
        ${t.prof != null ? `<span>Comp. <b>${sg(prof)}</b></span>` : ''}</div>
      ${t.concentration ? `<div class="conc">Concentración: <strong>${esc(t.concentration)}</strong> <button type="button" data-conc="${esc(t.id)}">Terminar concentración</button></div>` : ''}`;
    const abl = ab ? `<h3>Características</h3><div class="abs">${ABS.map(a => `<button type="button" class="ab" data-c="ability" data-k="${a}" aria-label="${AB[a]} ${ab[a]}, modificador ${sg(mod(ab[a]))}: tirar"><span>${AB[a]}</span><b>${sg(mod(ab[a]))}</b><small>${ab[a]}</small></button>`).join('')}</div>` : '';
    const svs = ab ? `<h3>Salvaciones</h3><div class="sk">${ABS.map(a => {
      const m = mod(ab[a]), v = t.saves?.[a] ?? m, p = v > m;
      return `<button type="button" data-c="save" data-k="${a}"><i class="pt${p ? ' on' : ''}" aria-hidden="true"></i>${AB[a]}${p ? '<span class="sr"> (competente)</span>' : ''}<b>${sg(v)}</b></button>`;
    }).join('')}</div>` : '';
    const sks = ab ? `<h3>Habilidades <small class="det">Mayús + clic: tirada secreta</small></h3><div class="sk">${Object.entries(SKILLS).map(([k, s]) => {
      const base = mod(ab[s.ability]), v = t.skills?.[k] ?? base, p = v > base;
      return `<button type="button" data-c="skill" data-k="${k}"><i class="pt${p ? ' on' : ''}" aria-hidden="true"></i>${s.name} <small>${AB[s.ability]}</small>${p ? '<span class="sr"> (competente)</span>' : ''}<b>${sg(v)}</b></button>`;
    }).join('')}</div>` : '';
    const ex = t.exhaustion ?? 0;
    const exh = `<div class="fila-h"><span id="sh-ex-l">Agotamiento</span><button type="button" data-ex="-1" aria-label="Reducir agotamiento"${ex <= 0 ? ' disabled' : ''}>−</button>
      <b aria-labelledby="sh-ex-l">${ex}</b><button type="button" data-ex="1" aria-label="Aumentar agotamiento"${ex >= 6 ? ' disabled' : ''}>+</button></div>`;
    const conds = t.conditions.length ? `<ul class="chips condl">${t.conditions.map(c => {
      const r = t.condRounds?.[c];
      return `<li><span aria-hidden="true">${COND_ICON[c] ?? '•'}</span> ${esc(CONDITIONS[c] ?? c)}${r != null ? ` · ${r} ${r === 1 ? 'ronda' : 'rondas'}` : ''}
        <button type="button" class="x" data-rc="${esc(c)}" aria-label="Quitar ${esc(CONDITIONS[c] ?? c)}">×</button></li>`;
    }).join('')}</ul>` : '<p class="det">Sin condiciones.</p>';
    const ds = t.deathSaves && hp?.cur === 0 ? deathSavesHtml(t) : '';
    q('sh-dyn').innerHTML = head + abl + svs + sks + exh + '<h3>Condiciones</h3>' + conds + ds;
    sx.render();
  };
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button'); const t = cx.token();
    if (!b || !t) return;
    if (b.dataset.c) cx.send({ t: 'check', tokenId: t.id, kind: b.dataset.c as 'save' | 'skill' | 'ability', key: b.dataset.k!, ...(e.shiftKey ? { secret: true } : {}) });
    else if (b.dataset.conc) cx.send({ t: 'concentration', tokenId: t.id, spell: null });
    else if (b.dataset.rc) cx.send({ t: 'condition', tokenId: t.id, condition: b.dataset.rc, on: false });
    else if (b.dataset.ds) cx.send({ t: 'deathSave', tokenId: t.id });
    else if (b.dataset.ex) // ponytail: no hay mensaje propio de agotamiento; upsert (solo DM lo acepta, presumiblemente)
      cx.send({ t: 'condition', tokenId: t.id, condition: 'exhaustion', on: +b.dataset.ex! > 0 });
    else if (b.dataset.hp) {
      const n = q<HTMLInputElement>('sh-n');
      if (!n.reportValidity()) return;
      const dt = q<HTMLSelectElement>('sh-dt').value;
      cx.send({ t: 'hp', tokenId: t.id, delta: Math.abs(+n.value), kind: b.dataset.hp as 'damage' | 'heal' | 'temp', ...(b.dataset.hp === 'damage' && dt ? { damageType: dt } : {}) });
      n.value = '';
    }
  });
  q('sh-cond').onsubmit = e => {
    e.preventDefault();
    const t = cx.token(); if (!t) return;
    const r = +q<HTMLInputElement>('sh-cr').value;
    cx.send({ t: 'condition', tokenId: t.id, condition: q<HTMLSelectElement>('sh-cid').value, on: true, ...(r > 0 ? { rounds: r } : {}) });
    q<HTMLInputElement>('sh-cr').value = '';
  };
  q('sh-hpf')?.addEventListener('submit', e => e.preventDefault());
  q('sh-crear').onclick = () => openCreator(c => { const t = cx.token(); if (t) cx.send({ t: 'importCharacter', tokenId: t.id, data: c }); });
  render();
  return { render };
}
