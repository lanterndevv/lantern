// Compendio: conjuros (SPELL_INDEX) y monstruos del SRD con búsqueda, pestaña de Assets (Openverse + iconos game-icons.net) y nombres.
// Contenido del SRD 5.2.1 © Wizards of the Coast, CC-BY-4.0.
import type { C2S, ClientState, Point } from '@lantern/protocol';
import { MONSTERS, SPELL_INDEX } from '@lantern/srd';
import type { Table } from '../render/api.ts';
import { NAME_TABLES, genName } from './names.ts';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const SCHOOL: Record<string, string> = { abjuration: 'abjuración', conjuration: 'conjuración', divination: 'adivinación', enchantment: 'encantamiento', evocation: 'evocación', illusion: 'ilusión', necromancy: 'nigromancia', transmutation: 'transmutación' };
const CLASS: Record<string, string> = { bard: 'bardo', cleric: 'clérigo', druid: 'druida', paladin: 'paladín', ranger: 'explorador', sorcerer: 'hechicero', warlock: 'brujo', wizard: 'mago' };
const crNum = (cr: string) => cr.includes('/') ? Number(cr.split('/')[0]) / Number(cr.split('/')[1]) : Number(cr);
const debounce = (f: () => void) => { let t = 0; return () => { clearTimeout(t); t = window.setTimeout(f, 120); }; };

/** Búsqueda de conjuros (todos los roles). */
export function spellSearch(el: HTMLElement) {
  const levels = ['Todos los niveles', 'Trucos', ...Array.from({ length: 9 }, (_, i) => `Nivel ${i + 1}`)];
  const classes = [...new Set(Object.values(SPELL_INDEX).flatMap(s => s.classes))].sort();
  el.innerHTML = `<div class="fila"><label>Conjuro<input type="search" data-q autocomplete="off" placeholder="Fireball, cura…"></label>
    <label>Nivel<select data-l>${levels.map((n, i) => `<option value="${i - 1}">${n}</option>`).join('')}</select></label>
    <label>Clase<select data-c><option value="">Todas</option>${classes.map(c => `<option value="${c}">${esc(CLASS[c] ?? c)}</option>`).join('')}</select></label></div>
    <p class="det" role="status" data-n></p><ul class="cp-lista" data-out></ul>`;
  const q = el.querySelector<HTMLInputElement>('[data-q]')!, l = el.querySelector<HTMLSelectElement>('[data-l]')!, c = el.querySelector<HTMLSelectElement>('[data-c]')!;
  const out = el.querySelector<HTMLElement>('[data-out]')!, n = el.querySelector('[data-n]')!;
  const draw = () => {
    const k = q.value.trim().toLowerCase(), lv = +l.value;
    const all = Object.entries(SPELL_INDEX).filter(([id, s]) => (!k || id.includes(k.replace(/\s+/g, '-')) || s.name.toLowerCase().includes(k)) && (lv === -1 || s.level === lv) && (!c.value || s.classes.includes(c.value)))
      .sort((a, b) => a[1].level - b[1].level || a[1].name.localeCompare(b[1].name));
    n.textContent = `${all.length} conjuros${all.length > 40 ? ' (se muestran 40: afina la búsqueda)' : ''}`;
    out.innerHTML = all.slice(0, 40).map(([, s]) => `<li><details><summary>${esc(s.name)} <small class="det">${s.level ? 'nivel ' + s.level : 'truco'} · ${esc(SCHOOL[s.school] ?? s.school)}${s.concentration ? ' · concentración' : ''}${s.ritual ? ' · ritual' : ''}</small></summary>
      <dl><dt>Clases</dt><dd>${esc(s.classes.map(x => CLASS[x] ?? x).join(', '))}</dd><dt>Lanzamiento</dt><dd>${esc(s.time)}</dd><dt>Alcance</dt><dd>${esc(s.range)}</dd>
      <dt>Componentes</dt><dd>${esc(s.components)}</dd><dt>Duración</dt><dd>${esc(s.duration)}</dd></dl></details></li>`).join('');
  };
  el.addEventListener('input', debounce(draw)); el.addEventListener('change', draw);
  draw();
}

/** Búsqueda de monstruos del SRD; con `onAdd` cada resultado tiene botón para añadirlo a la escena. */
export function monsterSearch(el: HTMLElement, onAdd?: (id: string, hidden: boolean) => void) {
  el.innerHTML = `<div class="fila"><label>Monstruo<input type="search" data-q autocomplete="off" placeholder="Trasgo, dragon…"></label>
    <label>VD máx.<select data-cr><option value="">Cualquiera</option>${['0', '1/8', '1/4', '1/2', '1', '2', '3', '4', '5', '8', '10', '15', '20', '25'].map(c => `<option>${c}</option>`).join('')}</select></label>
    ${onAdd ? '<label class="chk"><input type="checkbox" data-h> Añadir oculto</label>' : ''}</div><p class="det" role="status" data-n></p><ul class="cp-lista" data-out></ul>`;
  const q = el.querySelector<HTMLInputElement>('[data-q]')!, cr = el.querySelector<HTMLSelectElement>('[data-cr]')!, out = el.querySelector<HTMLElement>('[data-out]')!, n = el.querySelector('[data-n]')!;
  const draw = () => {
    const k = q.value.trim().toLowerCase();
    const all = Object.entries(MONSTERS).filter(([id, m]) => (!k || id.includes(k) || m.name.toLowerCase().includes(k) || m.type.toLowerCase().includes(k)) && (!cr.value || crNum(m.cr) <= crNum(cr.value)))
      .sort((a, b) => crNum(a[1].cr) - crNum(b[1].cr) || a[1].name.localeCompare(b[1].name));
    n.textContent = `${all.length} monstruos${all.length > 40 ? ' (se muestran 40: afina la búsqueda)' : ''}`;
    out.innerHTML = all.slice(0, 40).map(([id, m]) => `<li><details><summary>${esc(m.name)} <small class="det">VD ${esc(m.cr)} · ${esc(m.type)}</small></summary>
      <dl><dt>PG / CA</dt><dd>${m.hp?.max ?? '—'} / ${m.ac ?? '—'}</dd><dt>Velocidad</dt><dd>${m.speed ?? 30} pies</dd>
      <dt>Acciones</dt><dd>${esc((m.actions ?? []).map(a => `${a.name}${a.toHit != null ? ' +' + a.toHit : ''}${a.damage ? ' (' + a.damage + ')' : ''}`).join(' · ') || '—')}</dd></dl>
      ${onAdd ? `<button type="button" data-add="${esc(id)}">Añadir a la escena</button>` : ''}</details></li>`).join('');
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
  return new Promise((ok, ko) => cv.toBlob(b => b ? ok(b) : ko(new Error('No se pudo procesar la imagen')), 'image/png'));
}
async function rasterize(svg: string): Promise<Blob> {
  const img = new Image();
  img.src = svgUrl(svg);
  await img.decode();
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  cv.getContext('2d')!.drawImage(img, 0, 0, 256, 256);
  return new Promise((ok, ko) => cv.toBlob(b => b ? ok(b) : ko(new Error('No se pudo procesar el icono')), 'image/png'));
}

export type CompCtx = { send(m: C2S): void; state(): ClientState; role: string; code: string; key(): string | null; toast(m: string): void; table: Promise<Table>; mapEl: HTMLElement };

/** Panel «Compendio». Jugadores: solo conjuros. DM/asistente: monstruos, Assets y nombres. */
export function mountCompendium(el: HTMLElement, cx: CompCtx) {
  const staff = cx.role === 'dm' || cx.role === 'assistant';
  const secs = [['spells', 'Conjuros'], ...(staff ? [['mon', 'Monstruos'], ['assets', 'Assets'], ['names', 'Nombres']] : [])] as [string, string][];
  el.classList.add('cp');
  el.innerHTML = `<div class="chips-btn" role="group" aria-label="Secciones del compendio">${secs.map(([k, n], i) => `<button type="button" data-s="${k}" aria-pressed="${i === 0}">${n}</button>`).join('')}</div>
    ${secs.map(([k], i) => `<section data-sec="${k}"${i ? ' hidden' : ''}></section>`).join('')}
    <p class="det">Conjuros y monstruos: SRD 5.2.1 de Wizards of the Coast, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC-BY-4.0</a>.</p>`;
  const sec = (k: string) => el.querySelector<HTMLElement>(`[data-sec=${k}]`)!;
  el.querySelector('.chips-btn')!.addEventListener('click', e => {
    const k = (e.target as HTMLElement).closest('button')?.dataset.s; if (!k) return;
    el.querySelectorAll<HTMLElement>('[data-s]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.s === k)));
    el.querySelectorAll<HTMLElement>('[data-sec]').forEach(s => { s.hidden = s.dataset.sec !== k; });
  });
  spellSearch(sec('spells'));
  if (!staff) return;
  const center = (): Point => ({ x: cx.state().scene.width / 2, y: cx.state().scene.height / 2 });
  monsterSearch(sec('mon'), (srd, hidden) => { const c = center(); cx.send({ t: 'spawn', srd, x: c.x, y: c.y, ...(hidden ? { hidden: true } : {}) }); cx.toast('Añadido al centro de la escena'); });

  // nombres
  sec('names').innerHTML = `<div class="fila"><label>Especie<select data-sp>${Object.entries(NAME_TABLES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select></label>
    <button type="button" data-gen class="primary">Generar</button></div><ul class="cp-lista" data-out></ul><p class="det">Pulsa un nombre para copiarlo.</p>`;
  const gen = () => { sec('names').querySelector('[data-out]')!.innerHTML = Array.from({ length: 8 }, () => `<li><button type="button" data-nm>${esc(genName(sec('names').querySelector<HTMLSelectElement>('[data-sp]')!.value))}</button></li>`).join(''); };
  sec('names').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.dataset.gen != null) gen();
    else if (b.dataset.nm != null) void navigator.clipboard?.writeText(b.textContent ?? '').then(() => cx.toast('Nombre copiado'), () => cx.toast(b.textContent ?? ''));
  });
  gen();

  // assets
  const as = sec('assets'), pool = new Map<string, Asset>();
  const card = (a: Asset, id: string, thumb: string) => { pool.set(id, a); return `<li class="cp-img"><img src="${esc(thumb)}" alt="${esc(a.title)}" draggable="true" data-id="${esc(id)}" loading="lazy">
    <span class="det">${esc(a.title.slice(0, 40))} · ${esc(a.license)}</span><span class="dmbtns"><button type="button" data-p="token" data-id="${esc(id)}">Token</button><button type="button" data-p="bg" data-id="${esc(id)}">Fondo</button></span></li>`; };
  as.innerHTML = `<form data-f class="fila"><label>Buscar imágenes libres (Openverse, CC0 y CC BY)<input type="search" data-q required></label><button class="primary" type="submit">Buscar</button></form>
    <p class="det" role="status" data-st>Arrastra una imagen al mapa (token o fondo) o usa los botones. La atribución se guarda con el archivo.</p><ul class="cp-grid" data-res></ul>
    <h3>Iconos (game-icons.net, CC BY 3.0)</h3><ul class="cp-grid cp-iconos">${iconAssets.map((a, i) => card(a, 'i' + i, svgUrl(a.svg!))).join('')}</ul>
    <details><summary>Créditos de los recursos de esta mesa</summary><ul data-cred class="cp-lista"></ul></details>`;
  const st = as.querySelector('[data-st]')!, res = as.querySelector<HTMLElement>('[data-res]')!;
  as.querySelector<HTMLFormElement>('[data-f]')!.onsubmit = async e => {
    e.preventDefault();
    const term = as.querySelector<HTMLInputElement>('[data-q]')!.value.trim(); if (!term) return;
    st.textContent = 'Buscando…';
    try {
      const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}&license=cc0,by&page_size=20&mature=false`);
      if (!r.ok) throw new Error(`Openverse respondió ${r.status}`);
      const list = ((await r.json()) as { results: OvImage[] }).results;
      res.innerHTML = list.map(o => card({ kind: 'photo', src: o.thumbnail, full: o.url, title: o.title || 'Imagen', creator: o.creator ?? 'desconocido', license: `${o.license.toUpperCase()}${o.license_version ? ' ' + o.license_version : ''}`, url: o.foreign_landing_url, source: o.source ?? 'openverse' }, 'o' + o.id, o.thumbnail)).join('');
      st.textContent = list.length ? `${list.length} resultados` : 'Sin resultados';
    } catch (err) { st.textContent = `No se pudo buscar: ${(err as Error).message}`; }
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
      ul.innerHTML = list.length ? list.map(c => `<li>«${esc(c.title)}» — ${esc(c.creator)}, ${esc(c.license)} (${esc(c.source)})${c.url && /^https:/.test(c.url) ? ` <a href="${esc(c.url)}" target="_blank" rel="noopener">origen</a>` : ''}</li>`).join('') : '<li class="det">Ningún recurso con atribución en uso.</li>';
    } catch { ul.innerHTML = '<li class="det">No se pudieron cargar los créditos.</li>'; }
  });

  const toWorld = async (px: number, py: number): Promise<Point> => {
    const t = await cx.table, a = t.worldToClient(0, 0), b = t.worldToClient(1000, 1000);
    return { x: (px - a.x) / ((b.x - a.x) / 1000), y: (py - a.y) / ((b.y - a.y) / 1000) };
  };
  const upload = async (blob: Blob, a: Asset) => {
    const r = await fetch('/api/assets', { method: 'POST', headers: { 'content-type': blob.type, 'x-lantern-code': cx.code, 'x-lantern-key': cx.key() ?? '',
      'x-lantern-attr': encodeURIComponent(JSON.stringify({ title: a.title, creator: a.creator, license: a.license, url: a.url, source: a.source })) }, body: blob });
    const t = await r.text();
    if (!r.ok) throw new Error(t || `Error ${r.status}`);
    return (JSON.parse(t) as { url: string }).url;
  };
  const fetchBlob = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`No se pudo descargar (${r.status})`); return r.blob(); };
  async function place(a: Asset, mode: 'token' | 'bg', at: Point) {
    cx.toast('Preparando imagen…');
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
      cx.toast('Añadido con su atribución');
    } catch (err) { cx.toast(`No se pudo usar la imagen: ${(err as Error).message}`); }
  }
  cx.mapEl.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('application/x-lantern-asset')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  cx.mapEl.addEventListener('drop', async e => {
    const a = pool.get(e.dataTransfer?.getData('application/x-lantern-asset') ?? '');
    if (!a) return;
    e.preventDefault();
    const at = await toWorld(e.clientX, e.clientY), m = document.createElement('div');
    m.className = 'panel cp-menu'; m.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:50;display:flex;gap:6px;padding:6px`;
    m.innerHTML = '<button type="button" data-p="token">Como token</button><button type="button" data-p="bg">Como fondo</button><button type="button" data-p="">×</button>';
    m.onclick = ev => { const p = (ev.target as HTMLElement).closest('button')?.dataset.p; m.remove(); if (p) void place(a, p as 'token' | 'bg', at); };
    document.body.append(m); m.querySelector('button')!.focus();
    setTimeout(() => document.addEventListener('pointerdown', ev => { if (!m.contains(ev.target as Node)) m.remove(); }, { once: true }), 0);
  });
}
