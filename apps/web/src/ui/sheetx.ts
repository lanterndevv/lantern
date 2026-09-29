// Ampliaciones de la hoja (fase 11): descansos, subida de nivel, mejoras de característica, pregenerados y hoja en JSON.
import type { Ability, C2S, ImportedCharacter, Token } from '@lantern/protocol';
import { CHAR_FORMAT, CLASSES, PREGENS, pregenToImported, tokenToExport } from '@lantern/srd';
import { mapCharacter } from '@lantern/ddb';

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const AB: Record<Ability, string> = { str: 'FUE', dex: 'DES', con: 'CON', int: 'INT', wis: 'SAB', cha: 'CAR' };
const levelOf = (t: Token) => t.hitDice?.max ?? t.ddb?.level ?? 1;

/** Texto de un JSON de hoja → personaje: formato propio de Lantern o JSON de D&D Beyond. */
export function parseSheetJson(text: string): ImportedCharacter {
  let v: unknown;
  try { v = JSON.parse(text); } catch { throw new Error('El archivo no es JSON'); }
  const o = v as { format?: string; data?: ImportedCharacter };
  if (o?.format === CHAR_FORMAT && o.data) return o.data;
  return mapCharacter(v);
}

/** Diálogo de descanso: corto (dados de golpe por personaje) o largo (confirmar). */
export function openRest(kind: 'short' | 'long', toks: Token[], send: (m: C2S) => void, why = '') {
  if (!toks.length) return;
  const dlg = document.createElement('dialog');
  dlg.setAttribute('aria-labelledby', 'rs-t');
  dlg.innerHTML = `<form method="dialog"><h2 id="rs-t">Descanso ${kind === 'long' ? 'largo' : 'corto'}</h2>${why ? `<p class="sub">${esc(why)}</p>` : ''}
    ${toks.map(t => {
      const hd = t.hitDice ?? { die: 8, max: levelOf(t), used: 0 }, left = hd.max - hd.used;
      return kind === 'long' ? `<p><strong>${esc(t.name)}</strong>: PG al máximo, espacios de conjuro y la mitad de los dados de golpe.</p>`
        : `<label>${esc(t.name)} — dados de golpe d${hd.die} (quedan ${left})<input type="number" min="0" max="${left}" value="0" data-t="${esc(t.id)}" inputmode="numeric"></label>`;
    }).join('')}
    <div class="dmbtns"><button class="primary" value="ok">Descansar</button><button class="secondary" value="no">Ahora no</button></div></form>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => { if (dlg.returnValue === 'ok') for (const t of toks) send({ t: 'rest', tokenId: t.id, kind, ...(kind === 'short' ? { spend: +(dlg.querySelector<HTMLInputElement>(`[data-t="${CSS.escape(t.id)}"]`)?.value ?? 0) } : {}) }); dlg.remove(); });
  dlg.showModal();
}

type Ctx = { role: string; token: () => Token | undefined; send: (m: C2S) => void; toast?: (m: string) => void };

/** Monta el bloque en `el`; devuelve render(): se llama con cada cambio de la hoja. */
export function mountSheetExtras(el: HTMLElement, cx: Ctx) {
  el.className = 'sx';
  let sig = '';
  const classOpts = (sel: string) => Object.entries(CLASSES).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v.name)}</option>`).join('');
  const guess = (t: Token) => Object.entries(CLASSES).find(([, v]) => (t.ddb?.classes ?? '').toLowerCase().includes(v.name.toLowerCase()))?.[0] ?? 'fighter';
  const render = () => {
    const t = cx.token();
    if (!t) { el.hidden = true; sig = ''; return; }
    el.hidden = false;
    const hd = t.hitDice, k = JSON.stringify([t.id, t.hp, hd, t.asi, t.abilities, t.lucky, t.inspiration, t.ddb?.id, t.ddb?.level]);
    if (k === sig) return;
    sig = k;
    const linked = !!t.ddb && t.ddb.id > 0, lv = levelOf(t);
    el.innerHTML = `<h3>Descansos y nivel</h3>
      <div class="stats"><span>Nivel <b>${lv}</b></span>${hd ? `<span>Dados de golpe <b>d${hd.die}</b> ${hd.max - hd.used}/${hd.max}</span>` : '<span class="det">Sin dados de golpe definidos (se asume d8)</span>'}
        ${t.lucky ? '<span class="chip">Suerte</span>' : ''}${t.inspiration ? '<span class="chip">Inspiración heroica</span>' : ''}</div>
      <div class="dmbtns"><button type="button" data-a="short">Descanso corto…</button><button type="button" data-a="long">Descanso largo…</button></div>
      ${t.asi ? `<form class="fila" data-f="asi"><strong>Mejora de característica pendiente (${t.asi})</strong>
        <label>+2 a<select name="a">${(Object.keys(AB) as Ability[]).map(a => `<option value="${a}">${AB[a]}</option>`).join('')}</select></label>
        <label>o +1 a esta y a<select name="b"><option value="">—</option>${(Object.keys(AB) as Ability[]).map(a => `<option value="${a}">${AB[a]}</option>`).join('')}</select></label>
        <button class="primary" type="submit">Aplicar</button></form>` : ''}
      ${linked ? '<p class="det">Vinculado con D&amp;D Beyond: sube de nivel allí y pulsa Resincronizar.</p>'
        : lv >= 20 ? '' : `<form class="fila" data-f="lvl"><label>Clase<select name="cls">${classOpts(guess(t))}</select></label>
        <label>PG<select name="hp"><option value="average">Media fija</option><option value="roll">Tirada</option></select></label>
        <button type="submit">Subir a nivel ${lv + 1}</button></form>`}
      <h3>Hoja en archivo</h3>
      <div class="dmbtns"><button type="button" data-a="export">Exportar JSON</button><button type="button" data-a="import">Importar JSON…</button>
        <button type="button" data-a="pregen">Pregenerado SRD…</button></div>
      <input type="file" accept="application/json,.json" hidden data-i="file"><p class="det" role="status" data-i="st"></p>`;
  };
  const st = (m: string) => { const p = el.querySelector('[data-i=st]'); if (p) p.textContent = m; cx.toast?.(m); };
  el.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a, t = cx.token();
    if (!a || !t) return;
    if (a === 'short' || a === 'long') openRest(a, [t], cx.send);
    else if (a === 'export') {
      const url = URL.createObjectURL(new Blob([JSON.stringify(tokenToExport(t), null, 2)], { type: 'application/json' }));
      Object.assign(document.createElement('a'), { href: url, download: `${t.name.replace(/[^\w-]+/g, '_')}.json` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else if (a === 'import') el.querySelector<HTMLInputElement>('[data-i=file]')!.click();
    else if (a === 'pregen') pickPregen(c => { cx.send({ t: 'importCharacter', tokenId: t.id, data: c }); });
  });
  el.addEventListener('change', async e => {
    const inp = e.target as HTMLInputElement, f = inp.files?.[0], t = cx.token();
    if (inp.dataset.i !== 'file' || !f || !t) return;
    inp.value = '';
    try { cx.send({ t: 'importCharacter', tokenId: t.id, data: parseSheetJson(await f.text()) }); st('Hoja importada'); } catch (err) { st((err as Error).message); }
  });
  el.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target as HTMLFormElement, t = cx.token(); if (!t) return;
    const v = (n: string) => (f.elements.namedItem(n) as HTMLSelectElement).value;
    if (f.dataset.f === 'lvl') cx.send({ t: 'levelUp', tokenId: t.id, cls: v('cls'), hp: v('hp') as 'average' | 'roll' });
    else if (f.dataset.f === 'asi') cx.send({ t: 'abilityUp', tokenId: t.id, a: v('a') as Ability, ...(v('b') ? { b: v('b') as Ability } : {}) });
  });
  render();
  return { render };
}

/** Selector de pregenerados SRD (diálogo). */
export function pickPregen(onPick: (c: ImportedCharacter) => void) {
  const dlg = document.createElement('dialog');
  dlg.setAttribute('aria-labelledby', 'pg-t');
  dlg.innerHTML = `<h2 id="pg-t">Personaje pregenerado</h2><ul class="libres">${Object.entries(PREGENS).map(([id, p]) =>
    `<li><button type="button" data-id="${id}"><strong>${esc(p.name)}</strong> — ${esc(CLASSES[p.class]?.name ?? p.class)} (nivel ${p.level})</button></li>`).join('')}</ul>
    <p class="det">Personajes de ejemplo del SRD 5.2.1 (CC-BY-4.0), Wizards of the Coast.</p><form method="dialog"><button class="secondary">Cancelar</button></form>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('ul')!.addEventListener('click', e => {
    const id = (e.target as HTMLElement).closest('button')?.dataset.id;
    if (id) { onPick(pregenToImported(PREGENS[id])); dlg.close(); }
  });
  dlg.showModal();
}
