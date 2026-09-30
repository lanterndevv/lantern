import { encounterDifficulty, encounterXP } from '@lantern/rules';
import type { ClientState } from '@lantern/protocol';
import { MONSTERS } from '@lantern/srd';
import type { UiCtx } from './library.ts';
import { t } from '../i18n.ts';
import { monName } from './palette.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const xpOf = (cr: string) => { try { return encounterXP([cr]); } catch { return 0; } };

// Dificultad: única fuente de verdad en @lantern/rules; aquí solo se traduce la etiqueta.
export const RATINGS = ['Trivial', 'Fácil', 'Media', 'Difícil', 'Mortal'];
const ES: Record<string, string> = { trivial: 'Trivial', easy: 'Fácil', low: 'Fácil', medium: 'Media', moderate: 'Media', hard: 'Difícil', high: 'Difícil', deadly: 'Mortal' };
function difficulty(levels: number[], crs: string[], ed: '2014' | '2024'): { xp: number; adjusted?: number; rating: string } {
  const d = encounterDifficulty(levels, crs, ed);
  return { ...d, rating: ES[d.rating] ?? d.rating };
}
const STYLE: Record<string, [string, string]> = { Trivial: ['○', 'var(--txt3)'], Fácil: ['●', 'var(--exito)'], Media: ['◆', 'var(--ambar-claro)'], Difícil: ['▲', 'var(--peligro)'], Mortal: ['✖', 'var(--enemigo)'] }; // tokens del tema: legibles en día y en noche

export function mountEncounter(el: HTMLElement, ctx: UiCtx) {
  const list = Object.entries(MONSTERS).map(([id, m]) => ({ id, name: m.name, cr: m.cr, size: m.size }));
  const qty = new Map<string, number>();
  let levels: number[] | null = null; // null = automático
  let hidden = false, placing = false, loaded: { id: string; name: string } | undefined, gsig = ''; // loaded: el guardado que se está editando
  const auto = (s: ClientState) => {
    const l = s.scene.tokens.filter(k => k.faction === 'ally' && k.owners.length).map(k => k.ddb?.level ?? 5);
    return l.length ? l : [5];
  };

  el.classList.add('enc');
  el.innerHTML = `
    <label>${t('Niveles del grupo (separados por comas)')}<input id="en-niv" inputmode="numeric" autocomplete="off"></label>
    <label>${t('Buscar monstruo')}<input id="en-q" type="search" autocomplete="off"></label>
    <ul class="enc-res" id="en-res" aria-label="${t('Resultados')}"></ul>
    <div class="bib-acc enc-guard"><select id="en-gs" aria-label="${t('Encuentros guardados')}"></select>
      <button type="button" id="en-load">${t('Cargar')}</button><button type="button" id="en-save">${t('Guardar')}</button><button type="button" class="secondary" id="en-del">${t('Borrar')}</button></div>
    <h3>${t('Encuentro')}</h3>
    <ul class="enc-sel" id="en-sel" aria-label="${t('Monstruos del encuentro')}"></ul>
    <div id="en-dif" class="enc-dif" role="status" aria-live="polite"></div>
    <label class="enc-ck"><input type="checkbox" id="en-hid"> ${t('Ocultos')}</label>
    <div class="bib-acc"><button type="button" class="primary" id="en-col"></button><button type="button" class="secondary" id="en-lim">${t('Vaciar')}</button></div>`;
  const q = <T extends HTMLElement>(id: string) => el.querySelector<T>('#' + id)!;
  const cur = () => levels ?? auto(ctx.state());

  function renderRes() {
    const f = q<HTMLInputElement>('en-q').value.trim().toLowerCase();
    q('en-res').innerHTML = list.filter(m => !f || m.name.toLowerCase().includes(f)).map(m =>
      `<li><span>${esc(monName(m.id, m.name))} <span class="det">${t('VD')} ${m.cr} · ${xpOf(m.cr)} ${t('PX')}</span></span><button type="button" data-add="${m.id}" aria-label="${esc(t('Añadir {name}', { name: monName(m.id, m.name) }))}">${t('Añadir')}</button></li>`).join('');
  }
  function renderSel() {
    const rows = [...qty].filter(([, n]) => n > 0);
    q('en-sel').innerHTML = rows.map(([id, n]) => { const m = MONSTERS[id];
      return `<li><span>${esc(monName(id, m.name))} <span class="det">${t('VD')} ${m.cr} · ${xpOf(m.cr) * n} ${t('PX')}</span></span>
        <span class="enc-n"><button type="button" data-d="-1" data-id="${id}" aria-label="${esc(t('Quitar un {name}', { name: monName(id, m.name) }))}">−</button><output aria-label="${esc(t('Cantidad de {name}', { name: monName(id, m.name) }))}">${n}</output><button type="button" data-d="1" data-id="${id}" aria-label="${esc(t('Añadir otro {name}', { name: monName(id, m.name) }))}">+</button></span></li>`; }).join('') || `<li class="det">${t('Añade monstruos de la lista.')}</li>`;
    const crs = rows.flatMap(([id, n]) => Array<string>(n).fill(MONSTERS[id].cr));
    const d = difficulty(cur(), crs, ctx.state().settings.edition);
    const [icon, color] = STYLE[d.rating] ?? STYLE.Media;
    const pct = (RATINGS.indexOf(d.rating) + 1) * 20;
    q('en-dif').innerHTML = crs.length ? `<div class="enc-barra" aria-hidden="true"><i style="width:${pct}%;background:${color}"></i></div>
      <strong style="color:${color}"><span aria-hidden="true">${icon}</span> ${t(d.rating)}</strong>
      <span class="det">${d.xp} ${t('PX')}${d.adjusted != null && d.adjusted !== d.xp ? ` (${t('ajustados {n}', { n: Math.round(d.adjusted) })})` : ''}</span>` : `<span class="det">${t('Sin monstruos.')}</span>`;
    q('en-col').textContent = placing ? t('Cancelar colocación') : t('Colocar en el mapa');
    q<HTMLButtonElement>('en-col').disabled = !crs.length && !placing;
  }
  const stop = () => { placing = false; ctx.onMapClick(null); renderSel(); };
  const saved = () => ctx.state().encounters ?? [];
  function renderSaved() {
    const list = saved(), k = JSON.stringify(list.map(e => [e.id, e.name]));
    if (k === gsig) return; gsig = k;
    const gs = q<HTMLSelectElement>('en-gs'), v = gs.value;
    gs.innerHTML = list.length ? list.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('') : `<option value="">${t('Sin encuentros guardados')}</option>`;
    gs.value = list.some(e => e.id === v) ? v : list[0]?.id ?? '';
    q<HTMLButtonElement>('en-load').disabled = q<HTMLButtonElement>('en-del').disabled = !list.length;
  }

  q('en-q').addEventListener('input', renderRes);
  q('en-res').addEventListener('click', e => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-add]')?.dataset.add;
    if (id) { qty.set(id, (qty.get(id) ?? 0) + 1); renderSel(); }
  });
  q('en-sel').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-d]');
    if (b) { const id = b.dataset.id!, n = Math.max(0, (qty.get(id) ?? 0) + Number(b.dataset.d)); if (n) qty.set(id, n); else qty.delete(id); renderSel(); }
  });
  q('en-niv').addEventListener('input', () => {
    const v = q<HTMLInputElement>('en-niv').value.split(/[\s,]+/).map(Number).filter(n => n >= 1 && n <= 20);
    levels = v.length ? v : null; renderSel();
  });
  q('en-hid').addEventListener('change', () => { hidden = q<HTMLInputElement>('en-hid').checked; });
  q('en-lim').addEventListener('click', () => { qty.clear(); loaded = undefined; stop(); });
  const cur2 = () => saved().find(e => e.id === q<HTMLSelectElement>('en-gs').value);
  q('en-load').addEventListener('click', () => {
    const e = cur2(); if (!e) return;
    qty.clear(); for (const r of e.monsters) if (MONSTERS[r.srd]) qty.set(r.srd, r.n);
    loaded = { id: e.id, name: e.name }; renderSel();
  });
  q('en-save').addEventListener('click', () => {
    const monsters = [...qty].filter(([, n]) => n > 0).map(([srd, n]) => ({ srd, n }));
    if (!monsters.length) return ctx.toast(t('Añade monstruos antes de guardar'));
    const name = prompt(t('Nombre del encuentro'), loaded?.name ?? '')?.trim().slice(0, 60);
    if (!name) return;
    const id = loaded?.name === name ? loaded.id : crypto.randomUUID(); // mismo nombre que el cargado: se sobrescribe
    ctx.send({ t: 'encounter', entry: { id, name, monsters } });
    loaded = { id, name }; ctx.toast(t('Encuentro «{n}» guardado', { n: name }));
  });
  q('en-del').addEventListener('click', () => {
    const e = cur2();
    if (e && confirm(t('¿Borrar el encuentro guardado «{n}»?', { n: e.name }))) { ctx.send({ t: 'encounterDelete', id: e.id }); if (loaded?.id === e.id) loaded = undefined; }
  });
  q('en-col').addEventListener('click', () => {
    if (placing) return stop();
    placing = true; renderSel();
    ctx.toast(t('Haz clic en el mapa para colocar el grupo'));
    ctx.onMapClick((x, y) => {
      const ids = [...qty].flatMap(([id, n]) => Array<string>(n).fill(id)).sort((a, b) => (MONSTERS[b].size ?? 1) - (MONSTERS[a].size ?? 1));
      if (ids.length) {
        // rejilla compacta centrada en el punto; paso = tamaño de casilla × la criatura más grande (huecos de 1 casilla)
        const g = ctx.state().scene.grid.size, step = g * Math.max(...ids.map(id => MONSTERS[id].size ?? 1));
        const cols = Math.ceil(Math.sqrt(ids.length)), rows = Math.ceil(ids.length / cols);
        ctx.send({ t: 'spawnMany', hidden, items: ids.map((srd, i) => ({
          srd, x: Math.round(x + ((i % cols) - (cols - 1) / 2) * step), y: Math.round(y + (Math.floor(i / cols) - (rows - 1) / 2) * step) })) });
        ctx.toast((hidden ? t('{n} criaturas colocadas (ocultas)', { n: ids.length }) : t('{n} criatura colocada|{n} criaturas colocadas', { n: ids.length })) + ' ' + t('La lista se conserva; «Vaciar» para empezar otra.'));
      }
      stop();
    });
  });

  renderRes(); renderSel(); renderSaved();
  q<HTMLInputElement>('en-niv').placeholder = auto(ctx.state()).join(', ');
  return {
    update(s: ClientState) { q<HTMLInputElement>('en-niv').placeholder = auto(s).join(', '); renderSel(); renderSaved(); },
  };
}
