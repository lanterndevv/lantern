import type { C2S, ClientState, LibraryItem, Role } from '@lantern/protocol';
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
const NOFOLDER = 'Sin carpeta';

export function mountLibrary(el: HTMLElement, ctx: UiCtx) {
  const staff = ctx.role === 'dm' || ctx.role === 'assistant';
  if (!staff) { el.textContent = 'Solo el DM y los asistentes ven la biblioteca.'; return { update() {} }; }
  let items: LibraryItem[] = ctx.state().library ?? [];
  let watch: { ids: Set<string>; cb(it: LibraryItem): void } | null = null;

  el.classList.add('bib');
  el.innerHTML = `
    <div class="bib-barra">
      <input type="search" id="bib-q" placeholder="Buscar escena" aria-label="Buscar escena">
      <button type="button" class="primary" id="bib-nueva">Nueva escena</button>
    </div>
    <div class="bib-barra">
      <details class="bib-menu"><summary>Importar</summary>
        <div class="bib-opts">
          <label class="bib-op">Universal VTT (.dd2vtt / .uvtt)<input type="file" id="bib-uvtt" accept=".dd2vtt,.uvtt,.json"></label>
          <label class="bib-op">Imagen o vídeo<input type="file" id="bib-img" accept="image/*,video/*"></label>
          <label class="bib-op">Campaña de Lantern (.json)<input type="file" id="bib-camp" accept=".json,application/json"></label>
        </div>
      </details>
      <button type="button" id="bib-exp">Exportar campaña</button>
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
    if (!r.ok) { ctx.toast(`Error ${r.status}: ${(await r.text().catch(() => '')).slice(0, 120) || r.statusText}`); throw new Error(String(r.status)); }
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
    q('bib-lista').innerHTML = [...groups].sort(([a], [b]) => a === NOFOLDER ? -1 : b === NOFOLDER ? 1 : a.localeCompare(b, 'es')).map(([k, list], n) => `
      <section aria-labelledby="bib-f${n}"><h3 id="bib-f${n}">${esc(k)}</h3><ul class="bib-ul">${list.map(it => `
        <li class="${it.active ? 'activa' : ''}" data-id="${esc(it.id)}">
          <div class="bib-cab"><strong>${esc(it.name)}</strong>${it.active ? '<span class="chip en-juego">EN JUEGO</span>' : ''}</div>
          <div class="det">${it.tokens} tokens · ${it.walls} muros</div>
          <div class="bib-acc">
            ${it.active ? '' : `<button type="button" class="primary" data-a="act" aria-label="Activar ${esc(it.name)}">Activar</button><button type="button" data-a="prep" aria-label="Preparar ${esc(it.name)}" title="Descarga el mapa en todos los clientes para que el cambio sea instantáneo">Preparar</button>`}
            <button type="button" data-a="dup" aria-label="Duplicar ${esc(it.name)}">Duplicar</button>
            <button type="button" data-a="ren" aria-label="Renombrar ${esc(it.name)}">Renombrar</button>
            <button type="button" data-a="mov" aria-label="Mover ${esc(it.name)} a carpeta">Mover a carpeta</button>
            <button type="button" data-a="vis" aria-label="Quién ve ${esc(it.name)}">Visible: ${it.visibleTo ? `${it.visibleTo.length} jugador(es)` : 'todos'}</button>
            ${it.active ? '' : `<button type="button" class="secondary" data-a="del" aria-label="Borrar ${esc(it.name)}">Borrar</button>`}
          </div></li>`).join('')}</ul></section>`).join('') || '<p class="det">No hay escenas.</p>';
  }

  q('bib-q').addEventListener('input', render);
  q('bib-lista').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-a]');
    const it = items.find(i => i.id === b?.closest('li')?.getAttribute('data-id'));
    if (!b || !it) return;
    const a = b.dataset.a;
    if (a === 'act') { const transition = tx.get(); ctx.send({ t: 'sceneActivate', id: it.id, ...(transition && { transition }) }); }
    else if (a === 'prep') { ctx.send({ t: 'scenePrepare', id: it.id }); ctx.toast('Precargando la escena en todos los clientes'); }
    else if (a === 'dup') ctx.send({ t: 'sceneNew', name: `${it.name} (copia)`, from: it.id });
    else if (a === 'ren') { const n = prompt('Nuevo nombre', it.name)?.trim(); if (n) ctx.send({ t: 'sceneUpdate', id: it.id, name: n }); }
    else if (a === 'mov') { const n = prompt('Carpeta (vacía = sin carpeta)', it.folder ?? ''); if (n !== null) ctx.send({ t: 'sceneUpdate', id: it.id, folder: n.trim() }); }
    else if (a === 'vis') pickMembers(`Quién ve «${it.name}»`, 'Sin marcar a nadie la ven todos. Los demás verán un mapa en blanco cuando esté activa.', ctx.state().members, it.visibleTo ?? [], ids => ctx.send({ t: 'sceneUpdate', id: it.id, visibleTo: ids.length ? ids : null }));
    else if (a === 'del' && confirm(`¿Borrar la escena «${it.name}»? No se puede deshacer.`)) ctx.send({ t: 'sceneDelete', id: it.id });
  });
  q('bib-nueva').addEventListener('click', () => {
    const n = prompt('Nombre de la escena', 'Escena nueva')?.trim();
    if (n) ctx.send({ t: 'sceneNew', name: n });
  });

  // Reinicia el input para poder elegir el mismo archivo otra vez y cierra el menú.
  const pick = (id: string, fn: (f: File) => Promise<void>) => q<HTMLInputElement>(id).addEventListener('change', async ev => {
    const inp = ev.target as HTMLInputElement, f = inp.files?.[0];
    inp.value = ''; el.querySelector<HTMLDetailsElement>('.bib-menu')!.open = false;
    if (f) try { await fn(f); } catch (err) { if (!/^\d+$/.test((err as Error).message)) ctx.toast((err as Error).message); }
  });

  pick('bib-uvtt', async f => {
    await api('/api/uvtt', { method: 'POST', headers: hdr({ 'content-type': 'application/json' }), body: await f.text() });
    ctx.toast('Escena importada');
    whenNew(it => { if (confirm(`Escena importada: «${it.name}». ¿Activarla ahora?`)) ctx.send({ t: 'sceneActivate', id: it.id }); });
  });

  pick('bib-img', async f => {
    const type = f.type || 'application/octet-stream';
    const r = await api('/api/assets', { method: 'POST', headers: hdr({ 'content-type': type }), body: f });
    const t = await r.text();
    let url = t.trim();
    try { url = (JSON.parse(t) as { url: string }).url; } catch { /* texto plano */ }
    if (!url) throw new Error('El servidor no devolvió una URL');
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
    const name = f.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Mapa';
    whenNew(it => {
      ctx.send({ t: 'sceneActivate', id: it.id });
      ctx.send({ t: 'scene', patch: { background: url, ...(dim && dim.w > 0 ? { width: dim.w, height: dim.h } : {}) } });
      if (ctx.setTool) {
        msg('<button type="button" id="bib-cal" class="primary">Calibrar cuadrícula</button>');
        q('bib-cal').addEventListener('click', () => { ctx.setTool!('grid'); msg(''); });
      }
    });
    ctx.send({ t: 'sceneNew', name });
  });

  pick('bib-camp', async f => {
    const r = await api('/api/import', { method: 'POST', headers: hdr({ 'content-type': 'application/json' }), body: await f.text() });
    const j = await r.json() as { code: string; key?: string };
    msg(`Campaña importada. Código de la mesa nueva: <strong class="mono">${esc(j.code)}</strong> <button type="button" id="bib-ir" class="primary">Ir a la mesa</button>`);
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
      if (watch) { const n = items.find(i => !watch!.ids.has(i.id)); if (n) { const w = watch; watch = null; w.cb(n); } }
      render();
    },
  };
}
