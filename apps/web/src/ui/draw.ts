// Dibujo para todos, cursores, «Mostrar a todos aquí», deshacer e imagen de token propio.
import type { C2S, ClientState, Drawing, Id, Role, S2C, Token } from '@lantern/protocol';
import { brushPolygon } from '@lantern/vision';

// ponytail: los nombres siguen el contrato de api.ts pedido a otro agente (EditTool 'draw', drawEphemeral, setCursors).
// Si aún no existen en render/api.ts, este tipo local los cubre; el orquestador pasa el Table real (cast en el montaje).
export type Cursor = { id: Id; x: number; y: number; color: string; name: string };
export type DrawTable = {
  setTool(t: { tool: 'draw'; color: string; width: number; persist: boolean } | { tool: 'none' }): void;
  drawEphemeral(d: Drawing): void;
  setCursors(l: Cursor[]): void;
  focus(x: number, y: number, zoom?: number): void;
  ping(x: number, y: number, color: string): void;
};
export type DrawCtx = {
  send(m: C2S): void; state(): ClientState; me: Id; role: Role; toast(msg: string): void;
  table(): Promise<DrawTable>;
  onMapClick(cb: ((x: number, y: number) => void) | null): void; // el de UiCtx
};

const COLORS: [string, string][] = [['#ff5c5c', 'Rojo'], ['#ffb85c', 'Ámbar'], ['#f2e35c', 'Amarillo'], ['#5cd67a', 'Verde'], ['#5cb8ff', 'Azul'], ['#c78cff', 'Violeta']];
const WIDTHS: [number, string][] = [[3, 'Fino'], [6, 'Medio'], [12, 'Grueso']];
const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input,textarea,select,dialog');
const rid = () => Math.random().toString(36).slice(2, 10);
const colorOfMember = (s: ClientState, id: Id) => COLORS[Math.max(0, s.members.findIndex(m => m.id === id)) % COLORS.length][0];

export function mountDraw(bar: HTMLElement, c: DrawCtx) {
  const staff = c.role === 'dm' || c.role === 'assistant', dm = c.role === 'dm';
  if (c.role === 'spectator') return { onDraw() {}, onErase() {}, pointer() {}, handle() {}, update() {} };
  const box = document.createElement('div');
  box.className = 'dr-box';
  box.innerHTML = `<button type="button" id="dr-on" aria-pressed="false" aria-keyshortcuts="D" title="Dibujar (D)">✎<span class="sr"> Dibujar</span></button>
    <div id="dr-panel" class="dr-panel panel" hidden role="group" aria-label="Opciones de dibujo">
      <div role="radiogroup" aria-label="Color" class="dr-cols">${COLORS.map(([h, n], i) =>
        `<label class="dr-col" style="--c:${h}"><input type="radio" name="dr-c" value="${h}"${i === 1 ? ' checked' : ''}><span class="sr">${n}</span></label>`).join('')}</div>
      <label>Grosor<select id="dr-w">${WIDTHS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
      <label class="chk" id="dr-pl"><input type="checkbox" id="dr-p"> Persistente</label>
      ${staff ? '<label class="chk"><input type="checkbox" id="dr-fog"> Niebla (pincel): cada trazo crea una región de niebla</label>' : ''}
      <button type="button" id="dr-me">Borrar mío</button>
      ${dm ? '<button type="button" id="dr-all">Borrar todo</button><button type="button" id="dr-focus">Mostrar a todos aquí</button>' : ''}
    </div>
    <label class="chk dr-cur"><input type="checkbox" id="dr-cur" role="switch"> Ver cursores</label>`;
  bar.append(box);
  const q = <T extends HTMLElement>(id: string) => box.querySelector<T>('#' + id)!;
  const on = q('dr-on'), panel = q('dr-panel'), persist = q<HTMLInputElement>('dr-p'), cur = q<HTMLInputElement>('dr-cur');
  // «Persistente»: DM/asistente siempre; jugador solo si el DM activó settings.drawing = 'all'.
  const canPersist = () => staff || c.state().settings.drawing === 'all';
  const opts = () => ({ tool: 'draw' as const, color: box.querySelector<HTMLInputElement>('input[name=dr-c]:checked')!.value, width: +q<HTMLSelectElement>('dr-w').value, persist: persist.checked && canPersist() });
  const apply = () => { void c.table().then(t => t.setTool(active ? opts() : { tool: 'none' })); };
  let active = false;
  const set = (v: boolean) => { active = v; on.setAttribute('aria-pressed', String(v)); panel.hidden = !v; apply(); };
  on.onclick = () => set(!active);
  panel.addEventListener('change', apply);
  q('dr-me').onclick = () => c.send({ t: 'erase', id: 'mine' });
  if (dm) {
    q('dr-all').onclick = () => { if (confirm('¿Borrar todos los dibujos de la escena?')) c.send({ t: 'erase', id: 'all' }); };
    q('dr-focus').onclick = () => {
      set(false); c.toast('Haz clic en el mapa: todos verán ese punto');
      c.onMapClick((x, y) => c.send({ t: 'focusAll', x, y }));
    };
  }
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey || typing(e.target)) return;
    if (e.key.toLowerCase() === 'd') { e.preventDefault(); set(!active); }
    else if (e.key === 'Escape' && active) set(false);
  });

  // cursores
  const KEY = 'lantern:cursors';
  try { cur.checked = localStorage.getItem(KEY) === '1'; } catch { /* sin storage */ }
  const cursors = new Map<Id, Cursor & { at: number }>();
  const push = () => { const now = Date.now(); for (const [k, v] of cursors) if (now - v.at > 3000) cursors.delete(k); void c.table().then(t => t.setCursors(cur.checked ? [...cursors.values()] : [])); };
  cur.onchange = () => { try { localStorage.setItem(KEY, cur.checked ? '1' : '0'); } catch { /* sin storage */ } if (!cur.checked) cursors.clear(); push(); };
  let last = 0;
  setInterval(() => { if (cursors.size) push(); }, 1000); // caduca los cursores quietos

  return {
    /** TableOptions.onDraw(d, persist) */
    onDraw(d: Drawing, persist: boolean) {
      if (staff && q<HTMLInputElement>('dr-fog').checked) { // niebla a mano alzada: el trazo pasa a región 'fog' simplificada (el grosor es el del pincel)
        const sc = c.state().scene, poly = brushPolygon(d.points, +q<HTMLSelectElement>('dr-w').value * 5)?.map(p => ({ x: Math.min(sc.width, Math.max(0, p.x)), y: Math.min(sc.height, Math.max(0, p.y)) }));
        if (!poly) return c.toast('Trazo demasiado corto para crear niebla');
        c.send({ t: 'upsert', kind: 'region', item: { id: rid(), name: 'Niebla', kind: 'fog', hidden: false, points: poly, ...(d.level && { level: d.level }) } });
        return;
      }
      c.send({ t: 'draw', item: { ...d, id: d.id || rid(), by: d.by || c.me }, persist: persist && canPersist() }); },
    /** TableOptions.onErase(id) */
    onErase(id: Id) { c.send({ t: 'erase', id }); },
    /** TableOptions.onPointer(x, y): a lo sumo 10 Hz y solo con el interruptor activo */
    pointer(x: number, y: number) {
      const n = performance.now();
      if (cur.checked && n - last >= 100) { last = n; c.send({ t: 'cursor', x, y }); }
    },
    /** Llamar desde handle(m: S2C) para 'draw', 'cursor' y 'focus' */
    handle(m: S2C) {
      if (m.t === 'draw') void c.table().then(t => t.drawEphemeral(m.item));
      else if (m.t === 'cursor') {
        if (m.from === c.me || !cur.checked) return;
        const s = c.state();
        cursors.set(m.from, { id: m.from, x: m.x, y: m.y, color: colorOfMember(s, m.from), name: s.members.find(x => x.id === m.from)?.name ?? '', at: Date.now() });
        push();
      } else if (m.t === 'focus') void c.table().then(t => { t.focus(m.x, m.y); t.ping(m.x, m.y, '#ffb85c'); });
    },
    update(_s: ClientState) { q('dr-pl').hidden = !canPersist(); },
  };
}

/** Ctrl+Z fuera de inputs → undo si hay algo que deshacer. */
export function bindUndo(c: { send(m: C2S): void; state(): ClientState; toast(msg: string): void }) {
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z' || typing(e.target)) return;
    e.preventDefault();
    if (c.state().canUndo) c.send({ t: 'undo' }); else c.toast('No hay nada que deshacer');
  });
}

// ---- Imagen del token propio ----
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

async function square256(f: File): Promise<Blob> {
  const bmp = await createImageBitmap(f), s = Math.min(bmp.width, bmp.height);
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  cv.getContext('2d')!.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 256, 256); // recorte central
  bmp.close();
  return new Promise((ok, ko) => cv.toBlob(b => b ? ok(b) : ko(new Error('No se pudo procesar la imagen')), 'image/webp', 0.9));
}

/** Botón «Cambiar imagen» (para la hoja). Devuelve el elemento a insertar. */
export function tokenImagePicker(token: Token, c: { send(m: C2S): void; code: string; key(): string | null }) {
  const el = document.createElement('div'); el.className = 'ti-pick';
  el.innerHTML = `<button type="button" class="secondary">Cambiar imagen</button><input type="file" accept="image/png,image/jpeg,image/webp" hidden><p class="det" role="status"></p>`;
  const [btn, inp, st] = [el.children[0] as HTMLButtonElement, el.children[1] as HTMLInputElement, el.children[2]];
  btn.onclick = () => inp.click();
  inp.onchange = async () => {
    const f = inp.files?.[0]; inp.value = ''; if (!f) return;
    if (!IMG_TYPES.includes(f.type)) { st.textContent = 'Usa un png, jpg o webp'; return; }
    if (f.size > 5e6) { st.textContent = 'La imagen pesa más de 5 MB'; return; }
    st.textContent = 'Subiendo…'; btn.disabled = true;
    try {
      const b = await square256(f);
      const r = await fetch('/api/assets', { method: 'POST', headers: { 'content-type': b.type, 'x-lantern-code': c.code, 'x-lantern-key': c.key() ?? '' }, body: b });
      const t = await r.text();
      if (!r.ok) throw new Error(t || `Error ${r.status}`);
      let url = t.trim(); try { url = (JSON.parse(t) as { url: string }).url; } catch { /* texto plano */ }
      if (!/^(https?:\/\/|\/)\S+$/.test(url)) throw new Error('El servidor no devolvió una URL');
      c.send({ t: 'tokenImage', tokenId: token.id, img: url }); st.textContent = 'Imagen cambiada';
    } catch (e) { st.textContent = (e as Error).message; } finally { btn.disabled = false; }
  };
  return el;
}
