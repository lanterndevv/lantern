// Tablas aleatorias del diario (JournalEntry.table).
import { t } from '../i18n.ts';
import type { C2S, ClientState, Id, JournalEntry } from '@lantern/protocol';

type Table = NonNullable<JournalEntry['table']>;
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

/** Importa «1-2 | Nada» o «3 | Algo», una por línea. Líneas inválidas se ignoran. */
export function parseTable(src: string): Table['rows'] {
  const rows: Table['rows'] = [];
  for (const l of src.split('\n')) {
    const m = /^\s*(\d+)(?:\s*[-–—]\s*(\d+))?\s*[|:\t]\s*(.+?)\s*$/.exec(l);
    if (m) rows.push({ min: +m[1], max: +(m[2] ?? m[1]), text: m[3] });
  }
  return rows;
}

/** Editor para el DM. Devuelve el elemento y get(): la tabla o un error de validación. */
export function tableEditor(entry: JournalEntry) {
  const tb = entry.table, el = document.createElement('fieldset');
  el.className = 'tb-ed';
  el.innerHTML = `<legend>${t('Tabla aleatoria (opcional)')}</legend>
    <label>${t('Dados')}<input class="tb-d" placeholder="1d6" maxlength="20" value="${esc(tb?.dice ?? '')}"></label>
    <label>${t('Filas, una por línea: «1-2 | Texto»')}<textarea class="tb-r" rows="6">${esc((tb?.rows ?? []).map(r => `${r.min}${r.max !== r.min ? '-' + r.max : ''} | ${r.text}`).join('\n'))}</textarea></label>
    <p class="det tb-st" role="status"></p>`;
  const st = el.querySelector('.tb-st')!;
  return {
    el,
    get(): { table?: Table; error?: string } {
      const dice = el.querySelector<HTMLInputElement>('.tb-d')!.value.trim(), src = el.querySelector<HTMLTextAreaElement>('.tb-r')!.value.trim();
      if (!dice && !src) return {}; // sin tabla
      const rows = parseTable(src), bad = (e: string) => { st.textContent = e; return { error: e }; };
      if (!/^\d*d\d+([+-]\d+)?$/i.test(dice)) return bad(t('Dados no válidos (ejemplo: 1d6, 1d100)'));
      if (!rows.length) return bad(t('Ninguna fila reconocida. Formato: «1-2 | Texto»'));
      st.textContent = t('{n} fila|{n} filas', { n: rows.length });
      return { table: { dice, rows } };
    },
  };
}

/** Vista de lectura con botón «Tirar». secret solo para el DM. */
export function tableView(entry: JournalEntry, c: { send(m: C2S): void; state(): ClientState; role: string }) {
  const tb = entry.table, el = document.createElement('div');
  if (!tb) return el;
  el.className = 'tb-view';
  el.innerHTML = `<table><caption>${t('Tabla')} ${esc(tb.dice)}</caption><thead><tr><th scope="col">${t('Resultado')}</th><th scope="col">${t('Texto')}</th></tr></thead><tbody>${tb.rows.map(r =>
    `<tr><th scope="row">${r.min === r.max ? r.min : `${r.min}–${r.max}`}</th><td>${esc(r.text)}</td></tr>`).join('')}</tbody></table>
    <div class="ed-btns"><button type="button" class="primary" data-r="0">${t('Tirar')} ${esc(tb.dice)}</button>${c.role === 'dm' ? `<button type="button" data-r="1">${t('Tirar en secreto')}</button>` : ''}</div>`;
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-r]');
    if (b) c.send({ t: 'rollTable', entryId: entry.id as Id, ...(b.dataset.r === '1' ? { secret: true } : {}) });
  });
  return el;
}
