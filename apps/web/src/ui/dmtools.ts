// Herramientas del DM (fase 11): vista «como jugador», descanso del grupo, botín, documentos PDF, marcadores, copias y fusión selectiva.
import type { C2S, ClientState, JournalEntry } from '@lantern/protocol';
import { net } from '../net.ts';
import { lang, t, tsrv } from '../i18n.ts';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
export type DmCtx = { send(m: C2S): void; state(): ClientState; code: string; key(): string | null; toast(m: string): void; viewAs(id: string | null): void; viewing(): string | null };

export function mountDmTools(el: HTMLElement, cx: DmCtx) {
  el.classList.add('dmt');
  el.innerHTML = `<details class="dmt-g" open><summary>${t('Durante la sesión')}</summary>
    <section aria-labelledby="dt-as"><h3 id="dt-as">${t('Ver como jugador')}</h3><p class="det">${t('Muestra lo que ve ese jugador (visión, niebla, ocultos). Mientras tanto no recibes los cambios propios de tu vista.')}</p>
      <div class="fila"><label>${t('Jugador')}<select data-as></select></label><button type="button" data-a="as">${t('Ver')}</button><button type="button" data-a="asoff" class="secondary">${t('Volver a mi vista')}</button></div></section>
    <section aria-labelledby="dt-rest"><h3 id="dt-rest">${t('Descanso del grupo')}</h3>
      <div class="dmbtns"><button type="button" data-a="rest-short">${t('Proponer descanso corto')}</button><button type="button" data-a="rest-long">${t('Proponer descanso largo')}</button></div></section>
    <section aria-labelledby="dt-loot"><h3 id="dt-loot">${t('Botín')}</h3>
      <form data-f="loot"><label>${t('Título')}<input name="title" maxlength="60" required placeholder="${t('Cofre del sótano')}"></label>
        <label>${t('Objetos (uno por línea; «objeto > destinatario»)')}<textarea name="lines" rows="4" required placeholder="${t('50 po > Kael')}&#10;${t('Poción de curación')}"></textarea></label>
        <button class="primary" type="submit">${t('Publicar reparto en el registro')}</button></form></section>
    <section aria-labelledby="dt-pdf"><h3 id="dt-pdf">${t('Documentos PDF')}</h3><p class="det">${t('Se guardan como entrada del diario con visor; muéstralos desde el Diario. Zoom sincronizado opcional.')}</p>
      <label>${t('Subir PDF')}<input type="file" accept="application/pdf" data-pdf></label><p class="det" role="status" data-pst></p></section>
    <section aria-labelledby="dt-pin"><h3 id="dt-pin">${t('Marcadores en el mapa')}</h3><p class="det">${t('Desde una entrada del Diario: «Fijar en el mapa». Los jugadores solo ven los de entradas que pueden leer.')}</p><ul class="cp-lista" data-pins></ul></section></details>
    <details class="dmt-g"><summary>${t('Administrar campaña')}</summary>
    <section aria-labelledby="dt-bk"><h3 id="dt-bk">${t('Copias de seguridad')}</h3><p class="det">${t('Automáticas cada pocos minutos y al cerrar la sesión (últimas 10, junto a la base de datos).')}</p>
      <div class="dmbtns"><button type="button" data-a="bk-now">${t('Copiar ahora')}</button><button type="button" data-a="bk-list">${t('Actualizar lista')}</button></div><ul class="cp-lista" data-bk></ul></section>
    <section aria-labelledby="dt-mg"><h3 id="dt-mg">${t('Importar con fusión')}</h3><p class="det">${t('Elige un archivo de campaña (.json exportado) y qué traer a esta mesa.')}</p>
      <input type="file" accept="application/json,.json" data-mg><div data-mgsel></div></section></details>`;
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const hdr = () => ({ 'x-lantern-code': cx.code, 'x-lantern-key': cx.key() ?? '' });

  // vista como jugador
  const asSel = q<HTMLSelectElement>('[data-as]');
  const drawAs = () => { const v = asSel.value; asSel.innerHTML = cx.state().members.filter(m => m.role !== 'dm').map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join(''); asSel.value = v; };

  // pins
  let sig = '';
  const drawPins = () => {
    const s = cx.state(), k = JSON.stringify([s.scene.pins, s.journal.map(e => e.title), s.members.map(m => m.id)]);
    if (k === sig) return; sig = k;
    drawAs();
    q('[data-pins]').innerHTML = (s.scene.pins ?? []).map(p => `<li>${esc(s.journal.find(e => e.id === p.entryId)?.title ?? t('(entrada borrada)'))} <button type="button" data-a="unpin" data-id="${esc(p.id)}">${t('Quitar')}</button></li>`).join('') || `<li class="det">${t('Ninguno en esta escena.')}</li>`;
  };

  // copias
  net.on(m => {
    if (m.t !== 'backups') return;
    q('[data-bk]').innerHTML = m.list.map(b => `<li>${esc(new Date(b.at).toLocaleString(lang === 'en' ? 'en-GB' : 'es-ES'))} <small class="det">${Math.max(1, Math.round(b.size / 1024))} kB</small> <button type="button" data-a="bk-restore" data-name="${esc(b.name)}">${t('Restaurar')}</button></li>`).join('') || `<li class="det">${t('Aún no hay copias.')}</li>`;
  });

  // PDF
  q<HTMLInputElement>('[data-pdf]').onchange = async e => {
    const inp = e.target as HTMLInputElement, f = inp.files?.[0], st = q('[data-pst]'); inp.value = '';
    if (!f) return;
    if (f.type !== 'application/pdf' || f.size > 25e6) { st.textContent = t('Debe ser un PDF de menos de 25 MB'); return; }
    st.textContent = t('Subiendo…');
    try {
      const r = await fetch('/api/assets', { method: 'POST', headers: { ...hdr(), 'content-type': 'application/pdf' }, body: f }), txt = await r.text();
      if (!r.ok) throw new Error(tsrv(txt) || t('Error {n}', { n: r.status }));
      const entry: JournalEntry = { id: crypto.randomUUID(), title: f.name.replace(/\.pdf$/i, '').slice(0, 100) || t('Documento'), body: '', visibleTo: 'dm', pdf: (JSON.parse(txt) as { url: string }).url, folder: 'Documentos' };
      cx.send({ t: 'journal', entry });
      st.textContent = t('«{title}» añadido al Diario (solo DM); muéstralo cuando quieras.', { title: entry.title });
    } catch (err) { st.textContent = (err as Error).message; }
  };

  // fusión
  let camp: { scenes?: { id: string; name: string; tokens?: { id: string; name: string; faction: string }[] }[]; journal?: { id: string; title: string }[]; assets?: Record<string, string> } | undefined;
  q<HTMLInputElement>('[data-mg]').onchange = async e => {
    const inp = e.target as HTMLInputElement, f = inp.files?.[0], box = q('[data-mgsel]'); inp.value = '';
    if (!f) return;
    try { camp = JSON.parse(await f.text()); } catch { box.textContent = t('El archivo no es JSON'); return; }
    if (!camp?.scenes) { box.textContent = t('No parece una campaña de Lantern'); camp = undefined; return; }
    const cb = (k: string, id: string, label: string) => `<label class="chk"><input type="checkbox" data-k="${k}" value="${esc(id)}"> ${esc(label)}</label>`;
    box.innerHTML = `<fieldset><legend>${t('Escenas')}</legend>${camp.scenes.map(s => cb('scenes', s.id, s.name)).join('')}</fieldset>
      <fieldset><legend>${t('Diario')}</legend>${(camp.journal ?? []).map(j => cb('journal', j.id, j.title)).join('') || `<span class="det">${t('Vacío')}</span>`}</fieldset>
      <fieldset><legend>${t('Personajes (aliados)')}</legend>${camp.scenes.flatMap(s => (s.tokens ?? []).filter(t => t.faction === 'ally').map(t => cb('characters', t.id, `${t.name} — ${s.name}`))).join('') || `<span class="det">${t('Ninguno')}</span>`}</fieldset>
      <button type="button" class="primary" data-a="merge">${t('Importar lo elegido')}</button>`;
  };

  el.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    if (f.dataset.f !== 'loot') return;
    const lines = (f.elements.namedItem('lines') as HTMLTextAreaElement).value.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 30).map(l => { const [item, to] = l.split('>').map(x => x.trim()); return { item: item.slice(0, 80), ...(to ? { to: to.slice(0, 40) } : {}) }; });
    cx.send({ t: 'loot', title: (f.elements.namedItem('title') as HTMLInputElement).value.trim(), lines });
    f.reset();
  });
  el.addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest('button'), a = b?.dataset.a;
    if (!b || !a) return;
    if (a === 'as') { if (asSel.value) cx.viewAs(asSel.value); }
    else if (a === 'asoff') cx.viewAs(null);
    else if (a === 'rest-short' || a === 'rest-long') cx.send({ t: 'requestRest', kind: a === 'rest-long' ? 'long' : 'short' });
    else if (a === 'unpin') cx.send({ t: 'pin', op: 'remove', id: b.dataset.id! });
    else if (a === 'bk-now') { cx.send({ t: 'backup', op: 'now' }); cx.toast(t('Copia solicitada')); }
    else if (a === 'bk-list') cx.send({ t: 'backup', op: 'list' });
    else if (a === 'bk-restore') { if (confirm(t('Se sustituirán escenas, diario y ajustes por los de esa copia. ¿Restaurar?'))) cx.send({ t: 'backup', op: 'restore', name: b.dataset.name! }); }
    else if (a === 'merge' && camp) {
      const pick = (k: string) => [...el.querySelectorAll<HTMLInputElement>(`[data-k=${k}]:checked`)].map(i => i.value);
      const select = { scenes: pick('scenes'), journal: pick('journal'), characters: pick('characters') };
      if (!select.scenes.length && !select.journal.length && !select.characters.length) return cx.toast(t('Elige algo que importar'));
      const keep = camp.scenes!.filter(s => select.scenes.includes(s.id) || (s.tokens ?? []).some(t => select.characters.includes(t.id)));
      if (!keep.length) keep.push(camp.scenes![0]); // la campaña necesita al menos una escena para validarse; no se fusiona si no está elegida
      const jr = (camp.journal ?? []).filter(j => select.journal.includes(j.id)), txt = JSON.stringify([keep, jr]);
      const assets = Object.fromEntries(Object.entries(camp.assets ?? {}).filter(([n]) => txt.includes(n)));
      b.disabled = true;
      try {
        const r = await fetch('/api/merge', { method: 'POST', headers: { ...hdr(), 'content-type': 'application/json' }, body: JSON.stringify({ ...camp, scenes: keep, journal: jr, assets, select }) });
        const j = await r.json() as { error?: string; scenes?: number; journal?: number; characters?: number };
        cx.toast(j.error ? t('No se pudo importar: {e}', { e: tsrv(j.error) }) : t('Importado: {s} escenas, {j} entradas, {c} personajes', { s: j.scenes ?? 0, j: j.journal ?? 0, c: j.characters ?? 0 }));
      } catch (err) { cx.toast((err as Error).message); } finally { b.disabled = false; }
    }
  });
  cx.send({ t: 'backup', op: 'list' });
  drawPins();
  return { update: drawPins };
}
