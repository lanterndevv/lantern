// Diario: lista por carpetas, lector y (DM/asistente) editor + «Mostrar a jugadores».
//
// Montaje (pestaña «Diario» en table.ts):
//   import { mountJournal, showHandout, showRegionMsg } from './journal.ts';
//   const jr = mountJournal(panelEl, { send, state: () => cur, role, memberId, toast });
//   // en cada estado: jr.update(state);
//   // S2C 'handout':   showHandout(m.entry);      S2C 'regionMsg':   showRegionMsg(m.text);
import type { C2S, ClientState, JournalEntry, Role } from '@lantern/protocol';
import { tableEditor, tableView } from './tables.ts';

export type JrCtx = { send(m: C2S): void; state(): ClientState; role: Role; memberId: string; toast(msg: string): void };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const isUrl = (s: string) => /^(https?:\/\/|\/)\S+$/.test(s);
const rid = () => Math.random().toString(36).slice(2, 10);
const MAX_UPLOAD = 30e6;
// Cuerpo con enlaces [[Título]] a otras entradas; sin innerHTML (el texto nunca se interpreta como HTML).
function linkify(el: HTMLElement, text: string, open: (title: string) => boolean) {
  el.replaceChildren();
  text.split(/(\[\[[^\]\n]{1,120}\]\])/).forEach(part => {
    const m = /^\[\[(.+)\]\]$/.exec(part);
    if (!m) return void el.append(part);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'dj-enlace'; b.textContent = m[1];
    b.onclick = () => { if (!open(m[1])) { b.disabled = true; b.title = 'No existe o no puedes leerla'; } };
    el.append(b);
  });
}

// Visor de PDF: el fragmento #zoom=…&page=… lo entienden los visores de los navegadores.
const pdfFrame = (url: string, zoom: number, page = 1) => Object.assign(document.createElement('iframe'), { src: `${url}#zoom=${zoom}&page=${page}`, className: 'dj-pdf', title: 'Documento PDF' });

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

async function upload(code: string, f: File): Promise<string> {
  const key = localStorage.getItem(`lantern:key:${code}`) ?? '';
  const r = await fetch('/api/assets', { method: 'POST', headers: { 'content-type': f.type, 'x-lantern-code': code, 'x-lantern-key': key }, body: f });
  const t = await r.text();
  if (!r.ok) throw new Error(t || `Error ${r.status}`);
  let url = t.trim();
  try { url = (JSON.parse(t) as { url: string }).url; } catch { /* texto plano */ }
  if (!isUrl(url)) throw new Error('El servidor no devolvió una URL');
  return url;
}

export function mountJournal(el: HTMLElement, ctx: JrCtx) {
  const staff = ctx.role === 'dm' || ctx.role === 'assistant';
  let selId: string | undefined, editing: JournalEntry | null = null, q = '', sig = '';
  let tb: ReturnType<typeof tableEditor> | undefined;
  el.classList.add('dj');
  el.innerHTML = `<div class="dj-top"><label>Buscar<input type="search" id="dj-q" autocomplete="off"></label>${staff ? '<button type="button" class="primary" data-a="new">Nueva entrada</button>' : ''}</div>
    <nav aria-label="Entradas del diario" id="dj-list"></nav><section id="dj-main" class="dj-lector" aria-live="polite"></section>`;
  const list = el.querySelector<HTMLElement>('#dj-list')!, main = el.querySelector<HTMLElement>('#dj-main')!;
  const entries = () => ctx.state().journal;
  const label = (v: JournalEntry['visibleTo']) => v === 'dm' ? 'Solo DM' : v === 'all' ? 'Todos' : `${v.length} miembro(s)`;

  function renderList() {
    const f = q.toLowerCase(), by = new Map<string, JournalEntry[]>();
    for (const e of entries()) {
      if (f && !(e.title + ' ' + e.body).toLowerCase().includes(f)) continue;
      const k = e.folder?.trim() || 'Sin carpeta';
      by.set(k, [...(by.get(k) ?? []), e]);
    }
    list.innerHTML = by.size ? [...by].sort(([a], [b]) => a.localeCompare(b, 'es')).map(([k, es]) =>
      `<h3 class="dj-carp">${esc(k)}</h3><ul>${es.map(e => `<li><button type="button" data-id="${esc(e.id)}"${e.id === selId && !editing ? ' aria-current="true"' : ''}>${esc(e.title || 'Sin título')}${staff ? ` <small class="det">· ${label(e.visibleTo)}</small>` : ''}</button></li>`).join('')}</ul>`).join('')
      : '<p class="det">No hay entradas.</p>';
  }

  function renderMain() {
    if (editing) return renderEditor(editing);
    const e = entries().find(x => x.id === selId);
    if (!e) { main.innerHTML = '<p class="det">Elige una entrada.</p>'; return; }
    main.innerHTML = `<h3></h3>${e.image ? '<img alt="">' : ''}<p class="dj-cuerpo"></p>` +
      (staff ? '<div class="ed-btns"><button type="button" data-a="edit">Editar</button><button type="button" class="primary" data-a="show">Mostrar a jugadores</button><button type="button" data-a="pin">Fijar en el mapa</button><button type="button" data-a="del">Borrar</button></div>' : '');
    main.querySelector('h3')!.textContent = e.title;
    linkify(main.querySelector('.dj-cuerpo')!, e.body, title => { // nunca innerHTML con el cuerpo
      const t = entries().find(x => x.title.toLowerCase() === title.toLowerCase());
      if (!t) return false;
      selId = t.id; renderList(); renderMain(); return true;
    });
    if (e.pdf) {
      const box = document.createElement('div'); box.className = 'dj-pdfbox';
      const draw = () => { box.querySelector('iframe')?.remove(); box.append(pdfFrame(e.pdf!, +box.querySelector<HTMLInputElement>('[name=z]')!.value, +box.querySelector<HTMLInputElement>('[name=p]')!.value || 1)); };
      box.innerHTML = staff ? `<div class="fila"><label>Zoom %<input name="z" type="number" min="25" max="500" step="25" value="100"></label><label>Página<input name="p" type="number" min="1" value="1"></label>
        <label class="chk"><input name="s" type="checkbox"> Sincronizar con los jugadores</label></div>` : '<input name="z" type="hidden" value="100"><input name="p" type="hidden" value="1">';
      box.addEventListener('change', () => { draw(); if (box.querySelector<HTMLInputElement>('[name=s]')?.checked) ctx.send({ t: 'docView', entryId: e.id, zoom: +box.querySelector<HTMLInputElement>('[name=z]')!.value, page: +box.querySelector<HTMLInputElement>('[name=p]')!.value || 1 }); });
      draw();
      main.querySelector('.dj-cuerpo')!.after(box);
    }
    if (e.table) main.querySelector('.dj-cuerpo')!.after(tableView(e, ctx));
    if (e.image) { const i = main.querySelector('img')!; i.src = e.image; i.className = 'dj-img'; }
  }

  function renderEditor(e: JournalEntry) {
    const vis = e.visibleTo, others = ctx.state().members.filter(m => m.role !== 'dm');
    main.innerHTML = `<h3>${entries().some(x => x.id === e.id) ? 'Editar entrada' : 'Nueva entrada'}</h3>
      <label>Título<input id="dj-t" maxlength="100" value="${esc(e.title)}"></label>
      <label>Carpeta<input id="dj-f" maxlength="60" value="${esc(e.folder)}" list="dj-folders"></label>
      <datalist id="dj-folders">${[...new Set(entries().map(x => x.folder).filter(Boolean))].map(f => `<option value="${esc(f)}">`).join('')}</datalist>
      <label>Cuerpo<textarea id="dj-b" rows="8">${esc(e.body)}</textarea></label>
      <label>Imagen (URL)<input id="dj-iu" type="url" placeholder="https://…" value="${esc(e.image)}"></label>
      <label>o subir imagen<input id="dj-if" type="file" accept="image/*"></label>
      <label>Documento PDF${e.pdf ? ' (ya tiene uno; sube otro para cambiarlo)' : ''}<input id="dj-pf" type="file" accept="application/pdf"></label>
      <fieldset><legend>Visible para</legend>
        <label class="chk"><input type="radio" name="dj-v" value="dm"${vis === 'dm' ? ' checked' : ''}> Solo DM</label>
        <label class="chk"><input type="radio" name="dj-v" value="all"${vis === 'all' ? ' checked' : ''}> Todos</label>
        <label class="chk"><input type="radio" name="dj-v" value="some"${Array.isArray(vis) ? ' checked' : ''}> Miembros concretos</label>
        ${others.map(m => `<label class="chk"><input type="checkbox" data-m="${esc(m.id)}"${Array.isArray(vis) && vis.includes(m.id) ? ' checked' : ''}> ${esc(m.name)}</label>`).join('')}</fieldset>
      <p class="det" id="dj-st" role="status"></p>
      <div class="ed-btns"><button type="button" class="primary" data-a="save">Guardar</button><button type="button" data-a="cancel">Cancelar</button></div>`;
    tb = tableEditor(e);
    main.querySelector('#dj-st')!.before(tb.el);
    main.querySelector<HTMLElement>('#dj-t')!.focus();
  }

  async function save() {
    if (!editing) return;
    const v = <T extends HTMLElement>(id: string) => main.querySelector<T>('#' + id) as unknown as HTMLInputElement;
    const st = (m: string) => { main.querySelector('#dj-st')!.textContent = m; };
    const title = v('dj-t').value.trim();
    if (!title) return st('Escribe un título');
    const r = tb?.get();
    if (r?.error) return st(r.error);
    let image = v('dj-iu').value.trim() || undefined;
    const f = v('dj-if').files?.[0];
    if (f) {
      if (!f.type.startsWith('image/')) return st(`Tipo de archivo no válido: ${f.type || 'desconocido'}`);
      if (f.size > MAX_UPLOAD) return st('El archivo pesa más de 30 MB');
      st('Subiendo…');
      try { image = await upload(ctx.state().code, f); } catch (e) { return st((e as Error).message); }
    } else if (image && !isUrl(image)) return st('La URL debe empezar por http:// o https://');
    let pdf = editing.pdf;
    const pf = v('dj-pf').files?.[0];
    if (pf) {
      if (pf.type !== 'application/pdf') return st('Eso no es un PDF');
      if (pf.size > MAX_UPLOAD) return st('El archivo pesa más de 30 MB');
      st('Subiendo PDF…');
      try { pdf = await upload(ctx.state().code, pf); } catch (e) { return st((e as Error).message); }
    }
    const mode = main.querySelector<HTMLInputElement>('input[name=dj-v]:checked')?.value;
    const visibleTo: JournalEntry['visibleTo'] = mode === 'all' ? 'all' : mode === 'some'
      ? [...main.querySelectorAll<HTMLInputElement>('[data-m]:checked')].map(c => c.dataset.m!) : 'dm';
    const entry: JournalEntry = { id: editing.id, title, body: v('dj-b').value, visibleTo, ...(v('dj-f').value.trim() ? { folder: v('dj-f').value.trim() } : {}), ...(image ? { image } : {}), ...(pdf ? { pdf } : {}), ...(r?.table ? { table: r.table } : {}) };
    ctx.send({ t: 'journal', entry });
    selId = entry.id; editing = null; sig = ''; renderList(); renderMain();
  }

  el.addEventListener('input', e => { if ((e.target as HTMLElement).id === 'dj-q') { q = (e.target as HTMLInputElement).value; renderList(); } });
  list.addEventListener('click', e => {
    const id = (e.target as HTMLElement).closest('button')?.dataset.id; if (!id) return;
    selId = id; editing = null; renderList(); renderMain();
  });
  main.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a, cur = entries().find(x => x.id === selId);
    if (a === 'edit' && cur) { editing = cur; renderList(); renderMain(); }
    else if (a === 'save') void save();
    else if (a === 'cancel') { editing = null; renderList(); renderMain(); }
    else if (a === 'pin' && cur) document.dispatchEvent(new CustomEvent('lantern:pin', { detail: { entryId: cur.id } }));
    else if (a === 'show' && cur) { ctx.send({ t: 'handout', entryId: cur.id }); ctx.toast('Mostrado a los jugadores'); }
    else if (a === 'del' && cur && confirm(`¿Borrar «${cur.title}»?`)) { ctx.send({ t: 'journalDelete', id: cur.id }); selId = undefined; }
  });
  el.querySelector('[data-a=new]')?.addEventListener('click', () => {
    editing = { id: rid(), title: '', body: '', visibleTo: 'dm' }; renderList(); renderMain();
  });

  renderList(); renderMain();
  return {
    update(_s: ClientState) {
      const k = JSON.stringify(entries());
      if (k === sig) return;
      sig = k; renderList();
      if (!editing) renderMain(); // ponytail: no se pisa el borrador mientras se edita
    },
  };
}

let hand: HTMLDialogElement | undefined, handId = '', handUrl = '';
/** S2C docView: el DM ajusta el zoom del PDF que estás viendo. */
export function syncDoc(m: { entryId: string; zoom: number; page?: number }) {
  if (!hand?.open || handId !== m.entryId) return;
  hand.querySelector('iframe')?.replaceWith(pdfFrame(handUrl, m.zoom, m.page));
}
/** S2C handout: diálogo modal con imagen (clic = zoom) y texto. */
export function showHandout(e: JournalEntry) {
  hand ??= Object.assign(document.createElement('dialog'), { className: 'dj-hand' });
  hand.setAttribute('aria-labelledby', 'dj-ht');
  hand.innerHTML = `<h2 id="dj-ht" style="margin-top:0;font-family:var(--serif)"></h2>${e.image ? '<div class="dj-z"><img alt="" tabindex="0" role="button" aria-label="Ampliar imagen"></div>' : ''}<p class="dj-cuerpo"></p><form method="dialog"><button class="primary" autofocus>Cerrar</button></form>`;
  hand.querySelector('h2')!.textContent = e.title;
  hand.querySelector('.dj-cuerpo')!.textContent = e.body;
  handId = e.id; hand.classList.toggle('pdf', !!e.pdf);
  if (e.pdf) { handUrl = e.pdf; hand.querySelector('.dj-cuerpo')!.after(pdfFrame(e.pdf, 100)); }
  const img = hand.querySelector('img');
  if (img) {
    img.src = e.image!; img.alt = e.title;
    const z = () => img.classList.toggle('zoom');
    img.onclick = z; img.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); z(); } };
  }
  document.body.append(hand);
  if (!hand.open) hand.showModal();
}

let msgT = 0;
/** S2C regionMsg: aviso largo (aria-live) que se cierra solo o con clic. */
export function showRegionMsg(text: string) {
  let m = document.getElementById('dj-msg');
  if (!m) { m = document.createElement('div'); m.id = 'dj-msg'; m.className = 'dj-msg'; m.setAttribute('role', 'status'); m.onclick = () => { m!.hidden = true; }; document.body.append(m); }
  m.textContent = text; m.hidden = false;
  clearTimeout(msgT); msgT = window.setTimeout(() => { m!.hidden = true; }, Math.max(reduced() ? 6000 : 5000, text.length * 70));
}
