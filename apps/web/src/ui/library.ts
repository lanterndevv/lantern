import type { C2S, ClientState, LibraryItem, Role } from '@lantern/protocol';
import { lang, t, tsrv } from '../i18n.ts';
import { pickMembers } from './perms.ts';
import { transitionPicker } from './transiciones.ts';

/**
 * Contexto común de los módulos de UI (library, encounter, tutorial).
 * setTool es opcional: si el renderer lo ofrece, «Calibrar cuadrícula» llama a ctx.setTool('grid').
 */
export type UiCtx = {
  send(m: C2S): void; state(): ClientState; code: string; key(): string | null; role: Role;
  toast(msg: string): void; onMapClick(cb: ((x: number, y: number) => void) | null): void;
  setTool?(tool: 'grid'): void;
};

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const NOFOLDER = t('Sin carpeta');

/** Cambiar de escena termina el combate en el servidor (y descarta tiradas pendientes): se pide confirmación si hay uno. */
const leaveOk = (c: { state(): ClientState }) => !c.state().combat || confirm(t('Hay un combate en curso. Cambiar de escena lo termina y descarta las tiradas pendientes. ¿Continuar?'));
export function activateScene(c: { send(m: C2S): void; state(): ClientState }, id: string, transition?: Extract<C2S, { t: 'sceneActivate' }>['transition']): boolean {
  if (!leaveOk(c)) return false;
  c.send({ t: 'sceneActivate', id, ...(transition && { transition }) });
  return true;
}

export function mountLibrary(el: HTMLElement, ctx: UiCtx) {
  const staff = ctx.role === 'dm' || ctx.role === 'assistant';
  if (!staff) { el.textContent = t('Solo el DM y los asistentes ven la biblioteca.'); return { update() {}, prepared() {} }; }
  let items: LibraryItem[] = ctx.state().library ?? [];
  let watch: { ids: Set<string>; cb(it: LibraryItem): void } | null = null;
  const ready = new Map<string, Set<string>>(); // escena → miembros que ya la precargaron (ponytail: solo en esta pestaña; se pierde al recargar)
  const players = () => ctx.state().members.filter(m => m.online && m.role !== 'dm' && m.role !== 'assistant').map(m => m.id);

  el.classList.add('bib');
  el.innerHTML = `
    <div class="bib-barra">
      <input type="search" id="bib-q" placeholder="${t('Buscar escena')}" aria-label="${t('Buscar escena')}">
      <button type="button" class="primary" id="bib-nueva">${t('Nueva escena')}</button>
    </div>
    <div class="bib-barra">
      <details class="bib-menu"><summary>${t('Importar')}</summary>
        <div class="bib-opts">
          <label class="bib-op">${t('Universal VTT (.dd2vtt / .uvtt)')}<input type="file" id="bib-uvtt" accept=".dd2vtt,.uvtt,.json"></label>
          <label class="bib-op">${t('Imagen o vídeo')}<input type="file" id="bib-img" accept="image/*,video/*"></label>
          <label class="bib-op">${t('Campaña de Lantern (.json)')}<input type="file" id="bib-camp" accept=".json,application/json"></label>
        </div>
      </details>
      <button type="button" id="bib-exp">${t('Exportar campaña')}</button>
    </div>
    <div id="bib-tx"></div>
    <p class="det" id="bib-msg" role="status"></p>
    <div id="bib-lista"></div>`;
  const q = <T extends HTMLElement>(id: string) => el.querySelector<T>('#' + id)!;
  const tx = transitionPicker();
  q('bib-tx').append(tx.el);
  const msg = (h: string) => { q('bib-msg').innerHTML = h; };

  const hdr = (extra: Record<string, string> = {}) => ({ 'x-lantern-code': ctx.code, 'x-lantern-key': ctx.key() ?? '', ...extra });
  async function api(url: string, init: RequestInit): Promise<Response> {
    const r = await fetch(url, init);
    if (!r.ok) { ctx.toast(t('Error {n}: {e}', { n: r.status, e: tsrv((await r.text().catch(() => '')).slice(0, 120)) || r.statusText })); throw new Error(String(r.status)); }
    return r;
  }
  // Ejecuta cb con la primera escena de la biblioteca que aún no existía.
  const whenNew = (cb: (it: LibraryItem) => void) => { watch = { ids: new Set(items.map(i => i.id)), cb }; };

  function render() {
    const f = q<HTMLInputElement>('bib-q').value.trim().toLowerCase();
    const groups = new Map<string, LibraryItem[]>();
    for (const it of items) {
      if (f && !it.name.toLowerCase().includes(f) && !(it.folder ?? '').toLowerCase().includes(f)) continue;
      const k = it.folder || NOFOLDER;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
    }
    q('bib-lista').innerHTML = [...groups].sort(([a], [b]) => a === NOFOLDER ? -1 : b === NOFOLDER ? 1 : a.localeCompare(b, lang)).map(([k, list], n) => `
      <section aria-labelledby="bib-f${n}"><h3 id="bib-f${n}">${esc(k)}</h3><ul class="bib-ul">${list.map(it => `
        <li class="${it.active ? 'activa' : ''}" data-id="${esc(it.id)}">
          ${it.background && !/\.(webm|mp4)(\?|$)/i.test(it.background) ? `<img class="bib-min" loading="lazy" alt="" src="${esc(it.background)}">` : ''}
          <div class="bib-cab"><strong>${esc(it.name)}</strong>${it.active ? `<span class="chip en-juego">${t('EN JUEGO')}</span>` : ''}</div>
          <div class="det">${t('{a} tokens · {b} muros', { a: it.tokens, b: it.walls })}${!it.active && ready.has(it.id) ? ` · <span role="status">${t('Precargada en {a}/{b}', { a: players().filter(id => ready.get(it.id)!.has(id)).length, b: players().length })}</span>` : ''}</div>
          <div class="bib-acc">
            ${it.active ? '' : `<button type="button" class="primary" data-a="act" aria-label="${t('Activar {n}', { n: esc(it.name) })}">${t('Activar')}</button><button type="button" data-a="prep" aria-label="${t('Preparar {n}', { n: esc(it.name) })}" title="${t('Descarga el mapa en todos los clientes para que el cambio sea instantáneo')}">${t('Preparar')}</button>`}
            <button type="button" data-a="dup" aria-label="${t('Duplicar {n}', { n: esc(it.name) })}">${t('Duplicar')}</button>
            <button type="button" data-a="ren" aria-label="${t('Renombrar {n}', { n: esc(it.name) })}">${t('Renombrar')}</button>
            <button type="button" data-a="mov" aria-label="${t('Mover {n} a carpeta', { n: esc(it.name) })}">${t('Mover a carpeta')}</button>
            <button type="button" data-a="vis" aria-label="${t('Quién ve {n}', { n: esc(it.name) })}">${t('Visible: {v}', { v: it.visibleTo ? t('{n} jugador(es)', { n: it.visibleTo.length }) : t('todos') })}</button>
            ${it.active ? '' : `<button type="button" class="secondary" data-a="del" aria-label="${t('Borrar {n}', { n: esc(it.name) })}">${t('Borrar')}</button>`}
          </div></li>`).join('')}</ul></section>`).join('') || `<p class="det">${t('No hay escenas.')}</p>`;
  }

  q('bib-q').addEventListener('input', render);
  q('bib-lista').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-a]');
    const it = items.find(i => i.id === b?.closest('li')?.getAttribute('data-id'));
    if (!b || !it) return;
    const a = b.dataset.a;
    if (a === 'act') activateScene(ctx, it.id, tx.get());
    else if (a === 'prep') { ready.set(it.id, new Set()); ctx.send({ t: 'scenePrepare', id: it.id }); ctx.toast(t('Precargando la escena en todos los clientes')); render(); }
    else if (a === 'dup') ctx.send({ t: 'sceneNew', name: t('{n} (copia)', { n: it.name }), from: it.id });
    else if (a === 'ren') { const n = prompt(t('Nuevo nombre'), it.name)?.trim(); if (n) ctx.send({ t: 'sceneUpdate', id: it.id, name: n }); }
    else if (a === 'mov') { const n = prompt(t('Carpeta (vacía = sin carpeta)'), it.folder ?? ''); if (n !== null) ctx.send({ t: 'sceneUpdate', id: it.id, folder: n.trim() }); }
    else if (a === 'vis') pickMembers(t('Quién ve «{n}»', { n: it.name }), t('Sin marcar a nadie la ven todos. Los demás verán un mapa en blanco cuando esté activa.'), ctx.state().members, it.visibleTo ?? [], ids => ctx.send({ t: 'sceneUpdate', id: it.id, visibleTo: ids.length ? ids : null }));
    else if (a === 'del' && confirm(t('¿Borrar la escena «{n}»? No se puede deshacer.', { n: it.name }))) ctx.send({ t: 'sceneDelete', id: it.id });
  });
  q('bib-nueva').addEventListener('click', () => {
    const n = prompt(t('Nombre de la escena'), t('Escena nueva'))?.trim();
    if (!n) return;
    whenNew(it => { if (confirm(t('Escena creada: «{n}». ¿Abrirla ahora?', { n: it.name }))) activateScene(ctx, it.id); });
    ctx.send({ t: 'sceneNew', name: n });
  });

  // Reinicia el input para poder elegir el mismo archivo otra vez y cierra el menú.
  const pick = (id: string, fn: (f: File) => Promise<void>) => q<HTMLInputElement>(id).addEventListener('change', async ev => {
    const inp = ev.target as HTMLInputElement, f = inp.files?.[0];
    inp.value = ''; el.querySelector<HTMLDetailsElement>('.bib-menu')!.open = false;
    if (f) try { await fn(f); } catch (err) { if (!/^\d+$/.test((err as Error).message)) ctx.toast((err as Error).message); }
  });

  pick('bib-uvtt', async f => {
    await api('/api/uvtt', { method: 'POST', headers: hdr({ 'content-type': 'application/json' }), body: await f.text() });
    ctx.toast(t('Escena importada'));
    whenNew(it => { if (confirm(t('Escena importada: «{n}». ¿Activarla ahora?', { n: it.name }))) activateScene(ctx, it.id); });
  });

  pick('bib-img', async f => {
    if (!leaveOk(ctx)) return; // la escena importada se activa sola
    const type = f.type || 'application/octet-stream';
    const r = await api('/api/assets', { method: 'POST', headers: hdr({ 'content-type': type }), body: f });
    const txt = await r.text();
    let url = txt.trim();
    try { url = (JSON.parse(txt) as { url: string }).url; } catch { /* texto plano */ }
    if (!url) throw new Error(t('El servidor no devolvió una URL'));
    const dim = await new Promise<{ w: number; h: number } | null>(res => {
      const local = URL.createObjectURL(f);
      const done = (v: { w: number; h: number } | null) => { URL.revokeObjectURL(local); res(v); };
      if (type.startsWith('video/')) {
        const v = document.createElement('video'); v.preload = 'metadata';
        v.onloadedmetadata = () => done({ w: v.videoWidth, h: v.videoHeight }); v.onerror = () => done(null); v.src = local;
      } else {
        const i = new Image(); i.onload = () => done({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => done(null); i.src = local;
      }
    });
    const name = f.name.replace(/\.[^.]+$/, '').slice(0, 60) || t('Mapa');
    whenNew(it => {
      ctx.send({ t: 'sceneActivate', id: it.id });
      ctx.send({ t: 'scene', patch: { background: url, ...(dim && dim.w > 0 ? { width: dim.w, height: dim.h } : {}) } });
      if (ctx.setTool) {
        msg(`<button type="button" id="bib-cal" class="primary">${t('Calibrar cuadrícula')}</button>`);
        q('bib-cal').addEventListener('click', () => { ctx.setTool!('grid'); msg(''); });
      }
    });
    ctx.send({ t: 'sceneNew', name });
  });

  pick('bib-camp', async f => {
    const r = await api('/api/import', { method: 'POST', headers: hdr({ 'content-type': 'application/json' }), body: await f.text() });
    const j = await r.json() as { code: string; key?: string };
    msg(`${t('Campaña importada. Código de la mesa nueva:')} <strong class="mono">${esc(j.code)}</strong> <button type="button" id="bib-ir" class="primary">${t('Ir a la mesa')}</button>`);
    q('bib-ir').addEventListener('click', () => {
      if (j.key) try { localStorage.setItem(`lantern:key:${j.code}`, j.key); } catch { /* sin almacenamiento */ }
      location.href = `?code=${encodeURIComponent(j.code)}`;
    });
  });

  q('bib-exp').addEventListener('click', async () => {
    try {
      const r = await api('/api/export', { headers: hdr() });
      const a = document.createElement('a'), u = URL.createObjectURL(await r.blob());
      a.href = u; a.download = `lantern-${ctx.code}-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(u), 1e4);
    } catch (err) { if (!/^\d+$/.test((err as Error).message)) ctx.toast((err as Error).message); }
  });

  render();
  return {
    update(state: ClientState) {
      items = state.library ?? [];
      for (const it of items) if (it.active) ready.delete(it.id); // al activarla deja de importar
      if (watch) { const n = items.find(i => !watch!.ids.has(i.id)); if (n) { const w = watch; watch = null; w.cb(n); } }
      render();
    },
    /** Acuse de precarga de un jugador (S2C prepared). */
    prepared(id: string, memberId: string) { if (!ready.has(id)) return; ready.get(id)!.add(memberId); render(); },
  };
}
