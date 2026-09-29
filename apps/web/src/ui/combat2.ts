// Fase 9 B: combate 2 (legendarias, retrasar, reacciones, plantillas con forma, elevación, monturas).
import type { Action, C2S, ClientState, Id, Point, Role, S2C, Token } from '@lantern/protocol';
import { inArea } from '@lantern/rules';
import type { Marks, Table } from '../render/api.ts';
import type { RadialItem } from './radial.ts';

export type C2Ctx = {
  send(m: C2S): void; state(): ClientState; role: Role; memberId: Id; toast(msg: string): void;
};
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const isDm = (c: C2Ctx) => c.role === 'dm';

// ---- Acciones legendarias: ◆ = disponible, ◇ = gastada ----
export function legendaryPips(t: Token, dm: boolean): string {
  const l = t.legendary; if (!l || l.max <= 0) return '';
  const left = Math.max(0, l.max - l.used);
  const pips = '◆'.repeat(left) + '◇'.repeat(l.max - left);
  const label = `Acciones legendarias de ${t.name}: quedan ${left} de ${l.max}`;
  return dm
    ? `<button type="button" class="c2-pips" data-leg="${esc(t.id)}" aria-label="${esc(label)}. Clic gasta una, Mayús más clic reinicia" title="Clic: gastar · Mayús+clic: reiniciar">${pips}</button>`
    : `<span class="c2-pips" role="img" aria-label="${esc(label)}">${pips}</span>`;
}
/** Delegación de clics: se llama una vez sobre #init (sobrevive a los innerHTML). Solo DM. */
export function bindLegendary(el: HTMLElement, c: C2Ctx) {
  if (!isDm(c)) return;
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-leg]'); if (!b) return;
    const t = c.state().scene.tokens.find(x => x.id === b.dataset.leg);
    if (!t?.legendary) return;
    if (!e.shiftKey && t.legendary.used >= t.legendary.max) return c.toast(`${t.name} no tiene acciones legendarias disponibles`);
    c.send({ t: 'legendary', tokenId: t.id, op: e.shiftKey ? 'reset' : 'use' });
  });
}

// ---- Retrasar turno: DM, o dueño en su turno ----
export function combatExtras(c: C2Ctx) {
  const el = document.createElement('div');
  el.className = 'c2-extras'; el.hidden = true;
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = 'Retrasar turno';
  el.append(b);
  let id: Id | undefined;
  b.onclick = () => id && c.send({ t: 'combat', op: 'delay', tokenId: id });
  return {
    el,
    /** Llamar en cada estado. */
    update() {
      const cb = c.state().combat;
      id = cb?.order[cb.turn]?.tokenId;
      const t = c.state().scene.tokens.find(x => x.id === id);
      el.hidden = !cb || !t || !(isDm(c) || t.owners.includes(c.memberId));
    },
  };
}

// ---- Reacción (Escudo): aviso de 10 s ----
const shown = new Set<Id>();
export function reactionPrompt(msg: Extract<S2C, { t: 'reactionPrompt' }>, c: C2Ctx) {
  if (shown.has(msg.pending)) return;
  shown.add(msg.pending);
  const el = document.createElement('div');
  el.className = 'c2-react panel'; el.setAttribute('role', 'alert'); el.setAttribute('aria-live', 'assertive');
  el.innerHTML = `<p>${esc(msg.text || 'Te atacan: ¿usas Escudo? (+5 CA)')}</p>
    <div><button type="button" class="primary" data-u>Usar <span class="sr">reacción</span></button> <button type="button" data-i>Ignorar</button>
    <span class="c2-cuenta" aria-hidden="true">10</span></div>
    <p class="sr">Alt+R para usar la reacción. Tienes 10 segundos.</p>`;
  const end = () => { clearInterval(iv); removeEventListener('keydown', key); el.remove(); setTimeout(() => shown.delete(msg.pending), 15000); };
  const use = () => { c.send({ t: 'react', pending: msg.pending, tokenId: msg.tokenId, actionId: msg.actionId }); end(); };
  const key = (e: KeyboardEvent) => { if (e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); use(); } };
  let left = 10;
  const iv = setInterval(() => { left--; if (left <= 0) return end(); el.querySelector('.c2-cuenta')!.textContent = String(left); }, 1000);
  (el.querySelector('[data-u]') as HTMLElement).onclick = use;
  (el.querySelector('[data-i]') as HTMLElement).onclick = end;
  addEventListener('keydown', key);
  (document.querySelector('.mesa') ?? document.body).append(el);
}

// ---- Plantillas con forma ----
export type TemplateCtx = {
  caster: Id; state(): ClientState;
  table: Pick<Table, 'setMarks'>; baseMarks(): Marks;      // marks() del shell sin plantilla
  fire(tokenId: Id, actionId: Id, targets: Id[]): void;    // el fire del shell
};
/** Controlador para el HUD: pointer(x,y) en onPointer; click(x,y) en onMapClick/onTokenClick; cancel() al desarmar. */
export function templateTargeting(a: Action, c: TemplateCtx) {
  const area = a.area!;
  const fromCaster = area.shape === 'cone' || area.shape === 'line';
  const caster = () => c.state().scene.tokens.find(t => t.id === c.caster);
  let at: Point | undefined;
  /**
   * Una sola geometría para dibujar y para calcular (inArea de @lantern/rules: `dir` es un PUNTO).
   * cono/línea: origen = lanzador, hacia el puntero. cubo: esquina en el puntero, hacia fuera del lanzador (cuadrante).
   * esfera: centrada en el puntero.
   */
  const geom = (p: Point) => {
    const o = caster(), g = c.state().scene.grid, L = area.size / g.feet * g.size;
    if (fromCaster && o) return { origin: { x: o.x, y: o.y }, dir: p, vec: { x: p.x - o.x, y: p.y - o.y }, from: { x: o.x, y: o.y } };
    if (area.shape === 'cube') {
      const sx = o && p.x < o.x ? -1 : 1, sy = o && p.y < o.y ? -1 : 1;
      // el renderer dibuja el cubo con el origen en el centro de un lado: se desplaza medio lado para cubrir justo el cuadrante de inArea
      return { origin: p, dir: { x: p.x + sx, y: p.y + sy }, vec: { x: sx, y: 0 }, from: { x: p.x, y: p.y + sy * L / 2 } };
    }
    return { origin: p, dir: p, vec: { x: 1, y: 0 }, from: p };
  };
  const paint = () => {
    const m = c.baseMarks(), col = '#E8A33D', g = c.state().scene.grid;
    if (!at) return c.table.setMarks(m);
    const { vec, from } = geom(at), radius = area.size / g.feet * g.size;
    c.table.setMarks(area.shape === 'sphere'
      ? { ...m, area: { x: at.x, y: at.y, radius, color: col } }
      : { ...m, template: { shape: area.shape, origin: from, dir: vec, sizePx: radius, color: col } });
  };
  return {
    pointer(x: number, y: number) { at = { x, y }; paint(); },
    click(x: number, y: number) {
      const s = c.state(), { origin, dir } = geom({ x, y });
      const ids = s.scene.tokens.filter(t => (!fromCaster || t.id !== c.caster) && inArea(area.shape, origin, dir, area.size, s.scene.grid, t)).map(t => t.id);
      at = undefined;
      c.fire(c.caster, a.id, ids); // el shell desarma y repinta
    },
    cancel() { at = undefined; c.table.setMarks(c.baseMarks()); },
  };
}

// ---- Menú radial: combate, elevación, monturas ----
let pickMode: ((id: Id) => void) | undefined;
/** Llamar al principio de onTokenClick del shell: si devuelve true, el clic ya está consumido. */
export function pickToken(id: Id): boolean {
  if (!pickMode) return false;
  const f = pickMode; pickMode = undefined; f(id); return true;
}
export function cancelPick() { pickMode = undefined; }

export function combat2RadialItems(t: Token, c: C2Ctx): RadialItem[] {
  const dm = isDm(c), own = t.owners.includes(c.memberId), s = c.state(), g = s.scene.grid.size;
  const inCombat = !!s.combat?.order.some(o => o.tokenId === t.id);
  const out: RadialItem[] = [];
  if (dm && s.combat) out.push(
    { id: 'c-add', label: 'Añadir al combate', icon: 'ping', disabled: inCombat, run: () => c.send({ t: 'combat', op: 'add', tokenId: t.id }) },
    { id: 'c-rem', label: 'Quitar del combate', icon: 'trash', disabled: !inCombat, run: () => c.send({ t: 'combat', op: 'remove', tokenId: t.id }) },
  );
  if (dm || own) out.push({
    // ponytail: el protocolo no tiene C2S de elevación para jugadores; solo el DM la fija (upsert). Añadir uno si hace falta.
    id: 'elev', label: dm ? 'Elevación…' : 'Elevación (solo DM)', icon: 'disengage', disabled: !dm,
    run: () => {
      const v = prompt(`Elevación de ${t.name} en pies (0 = suelo)`, String(t.elevation ?? 0));
      const n = v == null ? NaN : Number(v.replace(',', '.'));
      if (v == null) return;
      if (!Number.isFinite(n)) return c.toast('Escribe un número de pies');
      c.send({ t: 'upsert', kind: 'token', item: { ...t, elevation: Math.round(n) } });
    },
  });
  if (dm || own) {
    const near = (o: Token) => Math.max(Math.abs(o.x - t.x), Math.abs(o.y - t.y)) <= (o.size + t.size) / 2 * g + 2;
    const pick = (verb: string, go: (o: Token) => C2S) => () => {
      c.toast(`${verb}: haz clic en un token contiguo (Esc cancela)`);
      pickMode = id => {
        const o = c.state().scene.tokens.find(x => x.id === id);
        if (!o || o.id === t.id) return c.toast('Elige otro token');
        if (!near(o)) return c.toast(`${o.name} no está contiguo a ${t.name}`);
        c.send(go(o));
      };
      addEventListener('keydown', e => { if (e.key === 'Escape') cancelPick(); }, { once: true });
    };
    out.push(
      { id: 'mount', label: 'Montar en…', icon: 'help', run: pick('Montar', o => ({ t: 'carry', tokenId: t.id, by: o.id })) },
      { id: 'grab', label: 'Agarrar a…', icon: 'help', run: pick('Agarrar', o => ({ t: 'carry', tokenId: o.id, by: t.id })) },
    );
    const carried = t.carriedBy != null, carrying = s.scene.tokens.filter(o => o.carriedBy === t.id);
    if (carried || carrying.length) out.push({ id: 'drop', label: 'Soltar', icon: 'disengage', run: () => {
      if (carried) c.send({ t: 'carry', tokenId: t.id, by: null });
      for (const o of carrying) c.send({ t: 'carry', tokenId: o.id, by: null });
    } });
  }
  return out;
}
