// Fase 9 B: selección múltiple con lazo (Mayús + arrastre en el suelo) y mover grupo en formación.
import type { C2S, ClientState, Id, Role } from '@lantern/protocol';
import type { Table } from '../render/api.ts';
import { t } from '../i18n.ts';

export type SelectCtx = {
  table: Pick<Table, 'worldToClient'>; state(): ClientState; role: Role; memberId: Id;
  send(m: C2S): void; toast(msg: string): void;
  onMapClick(cb: ((x: number, y: number) => void) | null): void; // el mismo one-shot que UiCtx
};

export function mountLasso(host: HTMLElement, c: SelectCtx) {
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const dm = c.role === 'dm';
  const selectable = () => c.state().scene.tokens.filter(t => dm || t.owners.includes(c.memberId));
  let sel = new Set<Id>();
  const rings = new Map<Id, HTMLElement>();

  const box = document.createElement('div'); box.className = 'sel-lazo'; box.hidden = true; box.setAttribute('aria-hidden', 'true');
  const bar = document.createElement('div'); bar.className = 'sel-bar panel'; bar.hidden = true;
  bar.innerHTML = `<span role="status" aria-live="polite"></span>
    <button type="button" data-go>${t('Mover grupo aquí')}</button> <button type="button" data-x>${t('Limpiar')}</button>`;
  host.append(box, bar);
  const status = bar.querySelector('span')!;

  const px = (t: { x: number; y: number; size: number }) => {
    const a = c.table.worldToClient(t.x, t.y), b = c.table.worldToClient(t.x + c.state().scene.grid.size, t.y);
    return { ...a, r: Math.abs(b.x - a.x) * t.size / 2 };
  };
  const rect = () => host.getBoundingClientRect();

  let raf = 0;
  const paint = () => {
    const r = rect();
    for (const [id, el] of rings) if (!sel.has(id)) { el.remove(); rings.delete(id); }
    for (const t of c.state().scene.tokens) {
      if (!sel.has(t.id)) continue;
      const p = px(t);
      let el = rings.get(t.id);
      if (!el) { el = document.createElement('div'); el.className = 'sel-aro'; el.setAttribute('aria-hidden', 'true'); host.append(el); rings.set(t.id, el); }
      el.style.cssText = `left:${p.x - r.left}px;top:${p.y - r.top}px;width:${p.r * 2}px;height:${p.r * 2}px`;
    }
    raf = sel.size ? requestAnimationFrame(paint) : 0; // solo corre mientras hay selección (sigue a la cámara)
  };
  const set = (ids: Iterable<Id>) => {
    sel = new Set(ids);
    bar.hidden = !sel.size;
    status.textContent = sel.size ? t('{n} seleccionado|{n} seleccionados', { n: sel.size }) : '';
    if (sel.size && !raf) raf = requestAnimationFrame(paint); else if (!sel.size) paint();
  };

  // Lazo. Captura para adelantarse al renderer solo cuando Mayús + suelo (no sobre un token).
  let from: { x: number; y: number } | undefined;
  host.addEventListener('pointerdown', e => {
    if (!e.shiftKey || e.button !== 0 || (e.target as HTMLElement).closest('.sel-bar')) return;
    if (c.state().scene.tokens.some(t => { const p = px(t); return Math.hypot(e.clientX - p.x, e.clientY - p.y) <= p.r; })) return;
    e.stopPropagation(); e.preventDefault();
    host.setPointerCapture(e.pointerId);
    from = { x: e.clientX, y: e.clientY };
    box.hidden = false; draw(e);
  }, true);
  const draw = (e: PointerEvent) => {
    if (!from) return;
    const r = rect(), x = Math.min(from.x, e.clientX), y = Math.min(from.y, e.clientY);
    box.style.cssText = `left:${x - r.left}px;top:${y - r.top}px;width:${Math.abs(e.clientX - from.x)}px;height:${Math.abs(e.clientY - from.y)}px`;
  };
  host.addEventListener('pointermove', e => { if (from) { e.stopPropagation(); draw(e); } }, true);
  const end = (e: PointerEvent) => {
    if (!from) return;
    e.stopPropagation();
    const x0 = Math.min(from.x, e.clientX), x1 = Math.max(from.x, e.clientX), y0 = Math.min(from.y, e.clientY), y1 = Math.max(from.y, e.clientY);
    from = undefined; box.hidden = true;
    const hit = selectable().filter(t => { const p = px(t); return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1; }).map(t => t.id);
    set(hit);
    if (!hit.length) c.toast(t('Ningún token en el recuadro'));
  };
  host.addEventListener('pointerup', end, true);
  host.addEventListener('pointercancel', e => { if (from) { from = undefined; box.hidden = true; e.stopPropagation(); } }, true);

  // Mover grupo: siguiente clic en el mapa = nuevo centro del grupo, se conserva la formación.
  // ponytail: el renderer arrastra un solo token, así que no hay Alt+arrastrar de grupo; este botón lo sustituye.
  (bar.querySelector('[data-go]') as HTMLElement).onclick = () => {
    c.toast(t('Haz clic en el destino del grupo'));
    c.onMapClick((x, y) => {
      const s = c.state(), ts = s.scene.tokens.filter(t => sel.has(t.id));
      if (!ts.length) return;
      const cx = ts.reduce((a, t) => a + t.x, 0) / ts.length, cy = ts.reduce((a, t) => a + t.y, 0) / ts.length;
      const dx = x - cx, dy = y - cy;
      c.send({ t: 'moveMany', moves: ts.map(t => ({ id: t.id, x: Math.max(0, Math.min(s.scene.width, t.x + dx)), y: Math.max(0, Math.min(s.scene.height, t.y + dy)) })) });
    });
  };
  (bar.querySelector('[data-x]') as HTMLElement).onclick = () => set([]);
  // Teclado: Mayús+A selecciona todos los tuyos (alternativa al lazo), Esc limpia.
  addEventListener('keydown', e => {
    if ((e.target as HTMLElement)?.closest?.('input,textarea,select,dialog,[contenteditable]')) return;
    if (e.key === 'Escape' && sel.size) set([]);
    else if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'a') { set(selectable().map(t => t.id)); }
  });

  return {
    ids: () => [...sel],
    clear: () => set([]),
    /** Llamar en cada estado: descarta tokens que ya no existen. */
    update() { const live = new Set(c.state().scene.tokens.map(t => t.id)); if ([...sel].some(i => !live.has(i))) set([...sel].filter(i => live.has(i))); },
  };
}
