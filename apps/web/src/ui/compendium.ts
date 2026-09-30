// Compendio: conjuros (SPELL_INDEX) y monstruos del SRD con búsqueda, pestaña de Assets (Openverse + iconos game-icons.net) y nombres.
// Contenido del SRD 5.2.1 © Wizards of the Coast, CC-BY-4.0.
import type { C2S, ClientState, Point } from '@lantern/protocol';
import { CONDITIONS } from '@lantern/rules';
import { DAMAGE_ES, MONSTERS, SCHOOL_ES as SCHOOL, SIZE_ES, SPELL_INDEX, TYPE_ES } from '@lantern/srd';
import { lang, t, tsrv } from '../i18n.ts';
import type { Table } from '../render/api.ts';
import { monName as monNameId } from './palette.ts';
import { NAME_TABLES, genName } from './names.ts';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const CLASS: Record<string, string> = { bard: 'bardo', cleric: 'clérigo', druid: 'druida', paladin: 'paladín', ranger: 'explorador', sorcerer: 'hechicero', warlock: 'brujo', wizard: 'mago' };
// En inglés los campos fijos del SRD (ya traducidos en packages/srd) se devuelven a su clave original; el nombre sale del id.
const rev = (m: Record<string, string>, v: string) => lang === 'en' ? Object.keys(m).find(k => m[k] === v) ?? v : v;
const ALIGN_EN: Record<string, string> = { legal: 'lawful', caótico: 'chaotic', bueno: 'good', malvado: 'evil', 'sin alineamiento': 'unaligned' };
const alignT = (a: string) => lang === 'en' ? ALIGN_EN[a] ?? a.split(' ').map(w => ALIGN_EN[w] ?? w).join(' ') : a;
const monName = (id: string, m: { name: string }) => monNameId(id, m.name);
const cls = (c: string) => lang === 'en' ? c : CLASS[c] ?? c;
const crNum = (cr: string) => cr.includes('/') ? Number(cr.split('/')[0]) / Number(cr.split('/')[1]) : Number(cr);
const debounce = (f: () => void) => { let t = 0; return () => { clearTimeout(t); t = window.setTimeout(f, 120); }; };

// Texto de los conjuros (~250 kB): se carga al abrir el compendio, no con la mesa
// ponytail: el SRD 5.2.1 solo está en inglés en formato importable; sin traducción automática
let spellText: Record<string, { d: string; h?: string }> | undefined;
const para = (s: string) => s.split(/\n+/).map(x => `<p>${esc(x.trim())}</p>`).join('');

/** Búsqueda de conjuros (todos los roles). */
export function spellSearch(el: HTMLElement) {
  const levels = [t('Todos los niveles'), t('Trucos'), ...Array.from({ length: 9 }, (_, i) => t('Nivel {n}', { n: i + 1 }))];
  const classes = [...new Set(Object.values(SPELL_INDEX).flatMap(s => s.classes))].sort();
  el.innerHTML = `<div class="fila"><label>${t('Conjuro')}<input type="search" data-q autocomplete="off" placeholder="${t('Fireball, cura…')}"></label>
    <label>${t('Nivel')}<select data-l>${levels.map((n, i) => `<option value="${i - 1}">${n}</option>`).join('')}</select></label>
    <label>${t('Clase')}<select data-c><option value="">${t('Todas')}</option>${classes.map(c => `<option value="${c}">${esc(cls(c))}</option>`).join('')}</select></label></div>
    <p class="det" role="status" data-n></p><ul class="cp-lista" data-out></ul>`;
  const q = el.querySelector<HTMLInputElement>('[data-q]')!, l = el.querySelector<HTMLSelectElement>('[data-l]')!, c = el.querySelector<HTMLSelectElement>('[data-c]')!;
  const out = el.querySelector<HTMLElement>('[data-out]')!, n = el.querySelector('[data-n]')!;
  const draw = () => {
    const k = q.value.trim().toLowerCase(), lv = +l.value;
    const inText = (id: string) => k.length >= 3 && !!spellText?.[id] && (spellText[id].d + (spellText[id].h ?? '')).toLowerCase().includes(k);
    const all = Object.entries(SPELL_INDEX).filter(([id, s]) => (!k || id.includes(k.replace(/\s+/g, '-')) || s.name.toLowerCase().includes(k) || inText(id)) && (lv === -1 || s.level === lv) && (!c.value || s.classes.includes(c.value)))
      .sort((a, b) => a[1].level - b[1].level || a[1].name.localeCompare(b[1].name));
    n.textContent = t('{n} conjuros', { n: all.length }) + (all.length > 40 ? t(' (se muestran 40: afina la búsqueda)') : '');
    out.innerHTML = all.slice(0, 40).map(([id, s]) => `<li><details><summary>${esc(s.name)} <small class="det">${s.level ? t('nivel {n}', { n: s.level }) : t('truco')} · ${esc(lang === 'en' ? s.school : SCHOOL[s.school] ?? s.school)}${s.concentration ? t(' · concentración') : ''}${s.ritual ? t(' · ritual') : ''}</small></summary>
      <dl><dt>${t('Clases')}</dt><dd>${esc(s.classes.map(cls).join(', '))}</dd><dt>${t('Lanzamiento')}</dt><dd>${esc(s.time)}</dd><dt>${t('Alcance')}</dt><dd>${esc(s.range)}</dd>
      <dt>${t('Componentes')}</dt><dd>${esc(s.components)}</dd><dt>${t('Duración')}</dt><dd>${esc(s.duration)}</dd></dl>
      ${spellText?.[id] ? `<div class="cp-txt" lang="en">${lang === 'en' ? '' : `<p class="det" lang="${lang}">${t('Texto oficial del SRD (en inglés)')}</p>`}${para(spellText[id].d)}${spellText[id].h ? `<p><b><i>${t('A niveles superiores.')}</i></b> ${esc(spellText[id].h)}</p>` : ''}</div>` : `<p class="det">${t('Cargando descripción…')}</p>`}</details></li>`).join('');
  };
  if (!spellText) void import('@lantern/srd/spelltext').then(m => { spellText = m.SPELL_TEXT; draw(); }, () => {});
  el.addEventListener('input', debounce(draw)); el.addEventListener('change', draw);
  draw();
}

const dmg = (l?: string[]) => (l ?? []).map(d => lang === 'en' ? d : DAMAGE_ES[d] ?? d).join(', ');
/** Filas extra de la ficha: tamaño/alineamiento, defensas, inmunidades a condiciones, rasgos y legendarias (los textos del SRD siguen en inglés). */
const AB6 = [['str', t('FUE')], ['dex', t('DES')], ['con', t('CON')], ['int', t('INT')], ['wis', t('SAB')], ['cha', t('CAR')]] as const;
const sg = (n: number) => (n >= 0 ? '+' : '−') + Math.abs(n);
/** Bloque de estadísticas clásico (barras, nombre en versalitas, separadores en triángulo, FUE…CAR, Acciones). Estilos: .sb en styles.css. */
function statBlock(m: (typeof MONSTERS)[string], name: string) {
  const row = (k: string, v?: string) => v ? `<p><b>${k}</b> ${esc(v)}</p>` : '';
  const text = (k: string, l?: { name: string; text: string }[]) => l?.length ? `${k ? `<h5 class="sb-sec">${k}</h5>` : ''}${l.map(x => `<p><b><i>${esc(x.name)}.</i></b> ${esc(x.text)}</p>`).join('')}` : '';
  const ab = m.abilities, sv = m.saves;
  const car = ab || sv ? `<table class="sb-car"><caption class="sr">${ab ? t('Características') : t('Tiradas de salvación')}</caption><tr>${AB6.map(([, n]) => `<th scope="col">${n}</th>`).join('')}</tr>
    <tr>${AB6.map(([k]) => `<td>${ab ? `${ab[k]} (${sg(Math.floor((ab[k] - 10) / 2))})` : sg(sv?.[k] ?? 0)}</td>`).join('')}</tr></table><hr class="sb-taper">` : '';
  const line = (a: NonNullable<typeof m.actions>[number]) => `<p><b><i>${esc(a.name)}.</i></b> ${a.save ? `<i>${t('Salvación de {a}:', { a: AB6.find(([k]) => k === a.save!.ability)?.[1] ?? a.save.ability })}</i> ${t('CD')} ${a.save.dc}.` : a.toHit != null ? `<i>${t('Ataque:')}</i> ${sg(a.toHit)}, ${t('alcance {n} pies', { n: a.range ?? 5 })}.` : ''}${a.damage ? ` <i>${t('Impacto:')}</i> ${esc(a.damage)} ${esc(lang === 'en' ? a.damageType ?? '' : DAMAGE_ES[a.damageType ?? ''] ?? a.damageType ?? '')}` : ''}</p>`;
  const acc = ([['action', t('Acciones')], ['bonus', t('Acciones adicionales')], ['reaction', t('Reacciones')]] as const).map(([c, h]) => {
    const l = (m.actions ?? []).filter(a => (a.cost === 'bonus' || a.cost === 'reaction' ? a.cost : 'action') === c);
    return l.length ? `<h5 class="sb-sec">${h}</h5>${l.map(line).join('')}` : '';
  }).join('');
  return `<article class="sb" aria-label="${t('Bloque de estadísticas: {n}', { n: esc(name) })}"><p class="sb-nombre">${esc(name)}</p>
    <p class="sb-tipo">${esc([m.sizeName && rev(SIZE_ES, m.sizeName), rev(TYPE_ES, m.type)].filter(Boolean).join(' '))}${m.align ? `, ${esc(alignT(m.align))}` : ''}</p><hr class="sb-taper">
    <p><b>${t('CA')}</b> ${m.ac ?? '—'} &#160; <b>${t('Iniciativa')}</b> ${sg(m.initMod ?? 0)}</p><p><b>${t('PG')}</b> ${m.hp?.max ?? '—'} &#160; <b>${t('Velocidad')}</b> ${t('{n} pies', { n: m.speed ?? 30 })}</p><hr class="sb-taper">${car}
    ${row(t('Resistencias'), dmg(m.defenses?.resist))}${row(t('Inmunidades'), dmg(m.defenses?.immune))}${row(t('Vulnerabilidades'), dmg(m.defenses?.vuln))}${row(t('Inmune a condiciones'), (m.condImm ?? []).map(c => t(CONDITIONS[c] ?? c)).join(', '))}
    <p><b>${t('Desafío')}</b> ${esc(m.cr)}</p>${(m.traits?.length || m.legend?.length) && lang !== 'en' ? `<p class="det">${t('Rasgos y acciones legendarias: texto oficial del SRD (en inglés)')}</p>` : ''}<div lang="en">${text('', m.traits)}</div>${acc}${m.legend?.length ? `<h5 class="sb-sec">${t('Acciones legendarias')}</h5>` : ''}<div lang="en">${text('', m.legend)}</div></article>`;
}

/** Búsqueda de monstruos del SRD; con `onAdd` cada resultado tiene botón para añadirlo a la escena. */
export function monsterSearch(el: HTMLElement, onAdd?: (id: string, hidden: boolean) => void) {
  el.innerHTML = `<div class="fila"><label>${t('Monstruo')}<input type="search" data-q autocomplete="off" placeholder="${t('Trasgo, dragon…')}"></label>
    <label>${t('VD máx.')}<select data-cr><option value="">${t('Cualquiera')}</option>${['0', '1/8', '1/4', '1/2', '1', '2', '3', '4', '5', '8', '10', '15', '20', '25'].map(c => `<option>${c}</option>`).join('')}</select></label>
    ${onAdd ? `<label class="chk"><input type="checkbox" data-h> ${t('Añadir oculto')}</label>` : ''}</div><p class="det" role="status" data-n></p><ul class="cp-lista" data-out></ul>`;
  const q = el.querySelector<HTMLInputElement>('[data-q]')!, cr = el.querySelector<HTMLSelectElement>('[data-cr]')!, out = el.querySelector<HTMLElement>('[data-out]')!, n = el.querySelector('[data-n]')!;
  const draw = () => {
    const k = q.value.trim().toLowerCase();
    const all = Object.entries(MONSTERS).filter(([id, m]) => (!k || id.includes(k) || m.name.toLowerCase().includes(k) || m.type.toLowerCase().includes(k)) && (!cr.value || crNum(m.cr) <= crNum(cr.value)))
      .sort((a, b) => crNum(a[1].cr) - crNum(b[1].cr) || a[1].name.localeCompare(b[1].name));
    n.textContent = t('{n} monstruos', { n: all.length }) + (all.length > 40 ? t(' (se muestran 40: afina la búsqueda)') : '');
    out.innerHTML = all.slice(0, 40).map(([id, m]) => `<li><details><summary>${esc(monName(id, m))} <small class="det">${t('VD')} ${esc(m.cr)} · ${esc(rev(TYPE_ES, m.type))}</small></summary>
      ${statBlock(m, monName(id, m))}
      ${onAdd ? `<button type="button" data-add="${esc(id)}">${t('Añadir a la escena')}</button>` : ''}</details></li>`).join('');
  };
  el.addEventListener('input', debounce(draw)); el.addEventListener('change', draw);
  el.addEventListener('click', e => { const id = (e.target as HTMLElement).closest('button')?.dataset.add; if (id) onAdd?.(id, !!el.querySelector<HTMLInputElement>('[data-h]')?.checked); });
  draw();
}

// ---- Assets ----
type Asset = { kind: 'photo' | 'icon'; src?: string; full?: string; svg?: string; title: string; creator: string; license: string; url: string; source: string };
type OvImage = { id: string; title: string; creator?: string; license: string; license_version?: string; foreign_landing_url: string; thumbnail: string; url: string; source?: string };
const ICONS = import.meta.glob('../assets/icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const AUTHORS: Record<string, [string, string]> = { lorc: ['Lorc', 'https://lorcblog.blogspot.com'], delapouite: ['Delapouite', 'https://delapouite.com'] };
const iconAssets = Object.entries(ICONS).map(([path, svg]): Asset => {
  const [author, name] = (path.split('/').pop() ?? '').replace('.svg', '').split('--');
  return { kind: 'icon', svg, title: name.replace(/-/g, ' '), creator: AUTHORS[author]?.[0] ?? author, license: 'CC BY 3.0', url: `https://game-icons.net/1x1/${author}/${name}.html`, source: 'game-icons.net' };
});
const svgUrl = (svg: string) => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);

async function squarePng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob), s = Math.min(bmp.width, bmp.height), cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  cv.getContext('2d')!.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 256, 256);
  bmp.close();
  return new Promise((ok, ko) => cv.toBlob(b => b ? ok(b) : ko(new Error(t('No se pudo procesar la imagen'))), 'image/png'));
}
async function rasterize(svg: string): Promise<Blob> {
  const img = new Image();
  img.src = svgUrl(svg);
  await img.decode();
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  cv.getContext('2d')!.drawImage(img, 0, 0, 256, 256);
  return new Promise((ok, ko) => cv.toBlob(b => b ? ok(b) : ko(new Error(t('No se pudo procesar el icono'))), 'image/png'));
}

export type CompCtx = { send(m: C2S): void; state(): ClientState; role: string; code: string; key(): string | null; toast(m: string): void; table: Promise<Table>; mapEl: HTMLElement };

/** Panel «Compendio». Jugadores: solo conjuros. DM/asistente: monstruos, Assets y nombres. */
export function mountCompendium(el: HTMLElement, cx: CompCtx) {
  const staff = cx.role === 'dm' || cx.role === 'assistant';
  const secs = [['spells', t('Conjuros')], ...(staff ? [['mon', t('Monstruos')], ['assets', 'Assets'], ['names', t('Nombres')]] : [])] as [string, string][];
  el.classList.add('cp');
  el.innerHTML = `<div class="chips-btn" role="group" aria-label="${t('Secciones del compendio')}">${secs.map(([k, n], i) => `<button type="button" data-s="${k}" aria-pressed="${i === 0}">${n}</button>`).join('')}</div>
    ${secs.map(([k], i) => `<section data-sec="${k}"${i ? ' hidden' : ''}></section>`).join('')}
    <p class="det">${t('Conjuros y monstruos: SRD 5.2.1 de Wizards of the Coast, {lic}.', { lic: '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC-BY-4.0</a>' })}</p>`;
  const sec = (k: string) => el.querySelector<HTMLElement>(`[data-sec=${k}]`)!;
  el.querySelector('.chips-btn')!.addEventListener('click', e => {
    const k = (e.target as HTMLElement).closest('button')?.dataset.s; if (!k) return;
    el.querySelectorAll<HTMLElement>('[data-s]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.s === k)));
    el.querySelectorAll<HTMLElement>('[data-sec]').forEach(s => { s.hidden = s.dataset.sec !== k; });
  });
  spellSearch(sec('spells'));
  if (!staff) return;
  const center = (): Point => ({ x: cx.state().scene.width / 2, y: cx.state().scene.height / 2 });
  monsterSearch(sec('mon'), (srd, hidden) => { const c = center(); cx.send({ t: 'spawn', srd, x: c.x, y: c.y, ...(hidden ? { hidden: true } : {}) }); cx.toast(t('Añadido al centro de la escena')); });

  // nombres
  sec('names').innerHTML = `<div class="fila"><label>${t('Especie')}<select data-sp>${Object.entries(NAME_TABLES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select></label>
    <button type="button" data-gen class="primary">${t('Generar')}</button></div><ul class="cp-lista" data-out></ul><p class="det">${t('Pulsa un nombre para copiarlo.')}</p>`;
  const gen = () => { sec('names').querySelector('[data-out]')!.innerHTML = Array.from({ length: 8 }, () => `<li><button type="button" data-nm>${esc(genName(sec('names').querySelector<HTMLSelectElement>('[data-sp]')!.value))}</button></li>`).join(''); };
  sec('names').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.dataset.gen != null) gen();
    else if (b.dataset.nm != null) void navigator.clipboard?.writeText(b.textContent ?? '').then(() => cx.toast(t('Nombre copiado')), () => cx.toast(b.textContent ?? ''));
  });
  gen();

  // assets
  const as = sec('assets'), pool = new Map<string, Asset>();
  const card = (a: Asset, id: string, thumb: string) => { pool.set(id, a); return `<li class="cp-img"><img src="${esc(thumb)}" alt="${esc(a.title)}" draggable="true" data-id="${esc(id)}" loading="lazy">
    <span class="det">${esc(a.title.slice(0, 40))} · ${esc(a.license)}</span><span class="dmbtns"><button type="button" data-p="token" data-id="${esc(id)}">Token</button><button type="button" data-p="bg" data-id="${esc(id)}">${t('Fondo')}</button></span></li>`; };
  as.innerHTML = `<form data-f class="fila"><label>${t('Buscar imágenes libres (Openverse, CC0 y CC BY)')}<input type="search" data-q required></label><button class="primary" type="submit">${t('Buscar')}</button></form>
    <p class="det" role="status" data-st>${t('Arrastra una imagen al mapa (token o fondo) o usa los botones. La atribución se guarda con el archivo.')}</p><ul class="cp-grid" data-res></ul>
    <h3>${t('Iconos (game-icons.net, CC BY 3.0)')}</h3><ul class="cp-grid cp-iconos">${iconAssets.map((a, i) => card(a, 'i' + i, svgUrl(a.svg!))).join('')}</ul>
    <details><summary>${t('Créditos de los recursos de esta mesa')}</summary><ul data-cred class="cp-lista"></ul></details>`;
  const st = as.querySelector('[data-st]')!, res = as.querySelector<HTMLElement>('[data-res]')!;
  as.querySelector<HTMLFormElement>('[data-f]')!.onsubmit = async e => {
    e.preventDefault();
    const term = as.querySelector<HTMLInputElement>('[data-q]')!.value.trim(); if (!term) return;
    st.textContent = t('Buscando…');
    try {
      const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}&license=cc0,by&page_size=20&mature=false`);
      if (!r.ok) throw new Error(t('Openverse respondió {n}', { n: r.status }));
      const list = ((await r.json()) as { results: OvImage[] }).results;
      res.innerHTML = list.map(o => card({ kind: 'photo', src: o.thumbnail, full: o.url, title: o.title || t('Imagen'), creator: o.creator ?? t('desconocido'), license: `${o.license.toUpperCase()}${o.license_version ? ' ' + o.license_version : ''}`, url: o.foreign_landing_url, source: o.source ?? 'openverse' }, 'o' + o.id, o.thumbnail)).join('');
      st.textContent = list.length ? t('{n} resultados', { n: list.length }) : t('Sin resultados');
    } catch (err) { st.textContent = t('No se pudo buscar: {e}', { e: (err as Error).message }); }
  };
  as.addEventListener('dragstart', e => { const id = (e.target as HTMLElement).dataset?.id; if (id && e.dataTransfer) { e.dataTransfer.setData('application/x-lantern-asset', id); e.dataTransfer.effectAllowed = 'copy'; } });
  as.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button'), a = b && pool.get(b.dataset.id ?? '');
    if (b?.dataset.p && a) void place(a, b.dataset.p as 'token' | 'bg', center());
  });
  as.querySelector('details')!.addEventListener('toggle', async e => {
    if (!(e.target as HTMLDetailsElement).open) return;
    const ul = as.querySelector('[data-cred]')!;
    try {
      const r = await fetch('/api/credits', { headers: { 'x-lantern-code': cx.code, 'x-lantern-key': cx.key() ?? '' } });
      const list = (await r.json()) as { title?: string; creator?: string; license?: string; url?: string; source?: string }[];
      ul.innerHTML = list.length ? list.map(c => `<li>«${esc(c.title)}» — ${esc(c.creator)}, ${esc(c.license)} (${esc(c.source)})${c.url && /^https:/.test(c.url) ? ` <a href="${esc(c.url)}" target="_blank" rel="noopener">${t('origen')}</a>` : ''}</li>`).join('') : `<li class="det">${t('Ningún recurso con atribución en uso.')}</li>`;
    } catch { ul.innerHTML = `<li class="det">${t('No se pudieron cargar los créditos.')}</li>`; }
  });

  const toWorld = async (px: number, py: number): Promise<Point> => {
    const t = await cx.table, a = t.worldToClient(0, 0), b = t.worldToClient(1000, 1000);
    return { x: (px - a.x) / ((b.x - a.x) / 1000), y: (py - a.y) / ((b.y - a.y) / 1000) };
  };
  const upload = async (blob: Blob, a: Asset) => {
    const r = await fetch('/api/assets', { method: 'POST', headers: { 'content-type': blob.type, 'x-lantern-code': cx.code, 'x-lantern-key': cx.key() ?? '',
      'x-lantern-attr': encodeURIComponent(JSON.stringify({ title: a.title, creator: a.creator, license: a.license, url: a.url, source: a.source })) }, body: blob });
    const txt = await r.text();
    if (!r.ok) throw new Error(txt ? tsrv(txt) : t('Error {n}', { n: r.status }));
    return (JSON.parse(txt) as { url: string }).url;
  };
  const fetchBlob = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(t('No se pudo descargar ({n})', { n: r.status })); return r.blob(); };
  async function place(a: Asset, mode: 'token' | 'bg', at: Point) {
    cx.toast(t('Preparando imagen…'));
    try {
      if (mode === 'token') {
        const url = await upload(await squarePng(a.kind === 'icon' ? await rasterize(a.svg!) : await fetchBlob(a.src!)), a);
        cx.send({ t: 'upsert', kind: 'token', item: { id: crypto.randomUUID(), name: a.title.slice(0, 40) || 'Token', x: Math.round(at.x), y: Math.round(at.y), size: 1, faction: 'neutral', hidden: false, owners: [], darkvision: 0, conditions: [], img: url } });
      } else {
        let blob = a.kind === 'icon' ? await rasterize(a.svg!) : await fetchBlob(a.src!);
        if (a.full) try { blob = await fetchBlob(a.full); } catch { /* sin CORS: se queda la miniatura */ }
        let url: string;
        try { url = await upload(blob, a); } catch { url = await upload(a.kind === 'icon' ? blob : await fetchBlob(a.src!), a); } // formato no admitido: miniatura
        cx.send({ t: 'scene', patch: { background: url } });
      }
      cx.toast(t('Añadido con su atribución'));
    } catch (err) { cx.toast(t('No se pudo usar la imagen: {e}', { e: (err as Error).message })); }
  }
  cx.mapEl.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('application/x-lantern-asset')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  cx.mapEl.addEventListener('drop', async e => {
    const a = pool.get(e.dataTransfer?.getData('application/x-lantern-asset') ?? '');
    if (!a) return;
    e.preventDefault();
    const at = await toWorld(e.clientX, e.clientY), m = document.createElement('div');
    m.className = 'panel cp-menu'; m.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:50;display:flex;gap:6px;padding:6px`;
    m.innerHTML = `<button type="button" data-p="token">${t('Como token')}</button><button type="button" data-p="bg">${t('Como fondo')}</button><button type="button" data-p="">×</button>`;
    m.onclick = ev => { const p = (ev.target as HTMLElement).closest('button')?.dataset.p; m.remove(); if (p) void place(a, p as 'token' | 'bg', at); };
    document.body.append(m); m.querySelector('button')!.focus();
    setTimeout(() => document.addEventListener('pointerdown', ev => { if (!m.contains(ev.target as Node)) m.remove(); }, { once: true }), 0);
  });
}
