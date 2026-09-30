import type { Ability, C2S, Token } from '@lantern/protocol';
import { CONDITIONS, SKILLS } from '@lantern/rules';
import { acOf } from './combat2.ts';
import { openCreator } from './creator.ts';
import { tokenImagePicker } from './draw.ts';
import { mountSheetExtras } from './sheetx.ts';
import { t } from '../i18n.ts';

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

export const deathSavesHtml = (tk: Token) => {
  const d = tk.deathSaves ?? { successes: 0, failures: 0 };
  const boxes = (n: number, cls: string, label: string) => `<span class="dsr ${cls}" role="img" aria-label="${t('{label}: {n} de 3', { label, n })}">` +
    [0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join('') + '</span>';
  return `<div class="muerte"><strong>${t('Salvaciones de muerte')}</strong>
    <div>${t('Éxitos')} ${boxes(d.successes, 'ok', t('Éxitos'))}</div><div>${t('Fallos')} ${boxes(d.failures, 'ko', t('Fallos'))}</div>
    <button type="button" class="primary" data-ds="${esc(tk.id)}">${t('Tirar salvación de muerte')}</button></div>`;
};

type Ctx = { role: string; memberId: string; token: () => Token | undefined; send: (m: C2S) => void; code: string; key: () => string | null };

export function mountSheet(el: HTMLElement, cx: Ctx) {
  const dm = cx.role === 'dm';
  // Parte estática (formularios que no deben perder el foco al llegar estado) + parte dinámica
  el.innerHTML = `<div id="sh-vacio" class="det" hidden>${t('No controlas ningún personaje. Selecciona un token.')}</div>
    <div id="sh-hp" class="sr" role="status" aria-live="polite"></div>
    <div id="sh-img"></div>
    <div id="sh-dyn" class="sb"></div>
    <div id="sh-x"></div>
    <div id="sh-forms" hidden>
      <form id="sh-cond" class="fila"><label>${t('Condición')}<select id="sh-cid">${Object.entries(CONDITIONS).map(([k, v]) => `<option value="${k}">${esc(t(v))}</option>`).join('')}</select></label>
        <label>${t('Rondas (opcional)')}<input id="sh-cr" type="number" min="1" inputmode="numeric"></label>
        <button type="submit">+ ${t('Condición')}</button></form>
      ${dm ? `<form id="sh-hpf" class="fila"><label>${t('Cantidad')}<input id="sh-n" type="number" min="1" inputmode="numeric" required></label>
        <label>${t('Tipo de daño')}<select id="sh-dt">${Object.entries(DTYPES).map(([k, v]) => `<option value="${k}">${t(v)}</option>`).join('')}</select></label>
        <div class="dmbtns3"><button type="button" data-hp="damage">${t('Daño')}</button><button type="button" data-hp="heal">${t('Curar')}</button><button type="button" data-hp="temp">${t('Temp')}</button></div></form>` : ''}
      <button type="button" id="sh-crear" class="secondary">${t('Crear personaje')}</button>
    </div>`;
  const q = <T extends HTMLElement>(id: string) => el.querySelector<T>('#' + id)!;
  const sx = mountSheetExtras(q('sh-x'), cx);
  let lastHp = '', lastId = '', imgId = '';
  const render = () => {
    const tk = cx.token();
    q('sh-vacio').hidden = !!tk; q('sh-forms').hidden = !tk;
    if (!tk) { q('sh-dyn').replaceChildren(); q('sh-img').replaceChildren(); imgId = ''; sx.render(); return; }
    if (tk.id !== imgId) { // el selector de imagen es estático: solo se rehace al cambiar de token (si no, se pierde el estado de la subida)
      imgId = tk.id;
      q('sh-img').replaceChildren(...(dm || tk.owners.includes(cx.memberId) ? [tokenImagePicker(tk, cx)] : []));
    }
    const ab = tk.abilities, prof = tk.prof ?? 0;
    const hp = tk.hp;
    const hpTxt = hp ? t('PG {cur} de {max}', { cur: hp.cur, max: hp.max }) + (hp.temp ? t(', más {n} temporales', { n: hp.temp }) : '') : '';
    if (tk.id === lastId && hpTxt !== lastHp) q('sh-hp').textContent = `${tk.name}: ${hpTxt}`;
    lastHp = hpTxt; lastId = tk.id;
    const head = `<div class="cab-h"><strong class="nombre">${esc(tk.name)}</strong>
      ${tk.ddb ? `<span class="det">${esc(tk.ddb.classes)} · ${t('nivel')} ${tk.ddb.level}</span>` : ''}</div>
      ${hp ? `<div class="hpbar grande" role="progressbar" aria-label="${t('Puntos de golpe')}" aria-valuemin="0" aria-valuemax="${hp.max}" aria-valuenow="${hp.cur}"><i style="width:${Math.max(0, Math.min(100, hp.cur / hp.max * 100))}%"></i></div>` : ''}
      <div class="stats">${hp ? `<span>${t('PG')} <b>${hp.cur}/${hp.max}</b>${hp.temp ? ` <em>+${hp.temp} ${t('temp')}</em>` : ''}</span>` : ''}
        ${tk.ac != null ? `<span>${t('CA')} <b>${acOf(tk)}</b>${tk.shielded ? ` (${t('Escudo')})` : ''}</span>` : ''}${tk.speed != null ? `<span>${t('Vel.')} <b>${tk.speed}</b> ${t('pies')}</span>` : ''}
        ${tk.prof != null ? `<span>${t('Comp.')} <b>${sg(prof)}</b></span>` : ''}</div>
      ${tk.concentration ? `<div class="conc">${t('Concentración:')} <strong>${esc(tk.concentration)}</strong> <button type="button" data-conc="${esc(tk.id)}">${t('Terminar concentración')}</button></div>` : ''}`;
    const abl = ab ? `<h3>${t('Características')}</h3><div class="abs">${ABS.map(a => `<button type="button" class="ab" data-c="ability" data-k="${a}" aria-label="${esc(t('{ab} {v}, modificador {m}: tirar', { ab: t(AB[a]), v: ab[a], m: sg(mod(ab[a])) }))}"><span>${t(AB[a])}</span><b>${sg(mod(ab[a]))}</b><small>${ab[a]}</small></button>`).join('')}</div>` : '';
    const svs = ab ? `<h3>${t('Salvaciones')}</h3><div class="sk">${ABS.map(a => {
      const m = mod(ab[a]), v = tk.saves?.[a] ?? m, p = v > m;
      return `<button type="button" data-c="save" data-k="${a}"><i class="pt${p ? ' on' : ''}" aria-hidden="true"></i>${t(AB[a])}${p ? `<span class="sr"> (${t('competente')})</span>` : ''}<b>${sg(v)}</b></button>`;
    }).join('')}</div>` : '';
    const sks = ab ? `<h3>${t('Habilidades')} <small class="det">${t('Mayús + clic: tirada secreta')}</small></h3><div class="sk">${Object.entries(SKILLS).map(([k, s]) => {
      const base = mod(ab[s.ability]), v = tk.skills?.[k] ?? base, p = v > base;
      return `<button type="button" data-c="skill" data-k="${k}"><i class="pt${p ? ' on' : ''}" aria-hidden="true"></i>${t(s.name)} <small>${t(AB[s.ability])}</small>${p ? `<span class="sr"> (${t('competente')})</span>` : ''}<b>${sg(v)}</b></button>`;
    }).join('')}</div>` : '';
    const ex = tk.exhaustion ?? 0;
    const exh = `<div class="fila-h"><span id="sh-ex-l">${t('Agotamiento')}</span><button type="button" data-ex="-1" aria-label="${t('Reducir agotamiento')}"${ex <= 0 ? ' disabled' : ''}>−</button>
      <b aria-labelledby="sh-ex-l">${ex}</b><button type="button" data-ex="1" aria-label="${t('Aumentar agotamiento')}"${ex >= 6 ? ' disabled' : ''}>+</button></div>`;
    const conds = tk.conditions.length ? `<ul class="chips condl">${tk.conditions.map(c => {
      const r = tk.condRounds?.[c];
      return `<li><span aria-hidden="true">${COND_ICON[c] ?? '•'}</span> ${esc(t(CONDITIONS[c] ?? c))}${r != null ? ` · ${t('{n} ronda|{n} rondas', { n: r })}` : ''}
        <button type="button" class="x" data-rc="${esc(c)}" aria-label="${esc(t('Quitar {name}', { name: t(CONDITIONS[c] ?? c) }))}">×</button></li>`;
    }).join('')}</ul>` : `<p class="det">${t('Sin condiciones.')}</p>`;
    const ds = tk.deathSaves && hp?.cur === 0 ? deathSavesHtml(tk) : '';
    q('sh-dyn').innerHTML = head + (abl && '<hr class="sb-taper">') + abl + svs + sks + '<hr class="sb-taper">' + exh + `<h3>${t('Condiciones')}</h3>` + conds + ds;
    sx.render();
  };
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button'); const tk = cx.token();
    if (!b || !tk) return;
    if (b.dataset.c) cx.send({ t: 'check', tokenId: tk.id, kind: b.dataset.c as 'save' | 'skill' | 'ability', key: b.dataset.k!, ...(e.shiftKey ? { secret: true } : {}) });
    else if (b.dataset.conc) cx.send({ t: 'concentration', tokenId: tk.id, spell: null });
    else if (b.dataset.rc) cx.send({ t: 'condition', tokenId: tk.id, condition: b.dataset.rc, on: false });
    else if (b.dataset.ds) cx.send({ t: 'deathSave', tokenId: tk.id });
    else if (b.dataset.ex) // ponytail: no hay mensaje propio de agotamiento; upsert (solo DM lo acepta, presumiblemente)
      cx.send({ t: 'condition', tokenId: tk.id, condition: 'exhaustion', on: +b.dataset.ex! > 0 });
    else if (b.dataset.hp) {
      const n = q<HTMLInputElement>('sh-n');
      if (!n.reportValidity()) return;
      const dt = q<HTMLSelectElement>('sh-dt').value;
      cx.send({ t: 'hp', tokenId: tk.id, delta: Math.abs(+n.value), kind: b.dataset.hp as 'damage' | 'heal' | 'temp', ...(b.dataset.hp === 'damage' && dt ? { damageType: dt } : {}) });
      n.value = '';
    }
  });
  q('sh-cond').onsubmit = e => {
    e.preventDefault();
    const tk = cx.token(); if (!tk) return;
    const r = +q<HTMLInputElement>('sh-cr').value;
    cx.send({ t: 'condition', tokenId: tk.id, condition: q<HTMLSelectElement>('sh-cid').value, on: true, ...(r > 0 ? { rounds: r } : {}) });
    q<HTMLInputElement>('sh-cr').value = '';
  };
  q('sh-hpf')?.addEventListener('submit', e => e.preventDefault());
  q('sh-crear').onclick = () => openCreator(c => { const tk = cx.token(); if (tk) cx.send({ t: 'importCharacter', tokenId: tk.id, data: c }); });
  render();
  return { render };
}
