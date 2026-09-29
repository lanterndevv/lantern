// Fase 9 B: combate 2 (legendarias, retrasar, reacciones, plantillas con forma, elevación, monturas).
import type { Action, C2S, ClientState, Id, MoveMode, Point, Role, S2C, Token, TurnEffect } from '@lantern/protocol';
import { opportunities, routeCost, speedFor } from '@lantern/protocol/move';
import { ABILITY_ES, CONDITIONS, inArea } from '@lantern/rules';
import { cover, sightSegments } from '@lantern/vision';
import type { Marks, Table } from '../render/api.ts';
import type { RadialItem } from './radial.ts';

export type C2Ctx = {
  send(m: C2S): void; state(): ClientState; role: Role; memberId: Id; toast(msg: string): void;
};
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const isDm = (c: C2Ctx) => c.role === 'dm';
const staff = (c: C2Ctx) => c.role === 'dm' || c.role === 'assistant';

// Estilos propios de este módulo (barra de token, regla, avisos): se inyectan una vez para no tocar las hojas compartidas.
const CSS = `
.c2-tbar{position:fixed;z-index:8;transform:translate(-50%,-100%);pointer-events:none;display:grid;gap:3px;justify-items:center;padding:5px 9px;min-width:110px;max-width:240px;font-size:.78rem;border-radius:10px}
.c2-tbar b{font-family:var(--serif);font-size:.85rem}
.c2-tbar .hp{position:relative;width:100%;height:7px;border-radius:4px;background:rgba(255,255,255,.14);overflow:hidden}
.c2-tbar .hp i{position:absolute;inset:0 auto 0 0;background:var(--exito)}.c2-tbar .hp u{position:absolute;inset:0 auto 0 0;background:var(--aliado);opacity:.85}
.c2-tbar .fila{display:flex;flex-wrap:wrap;gap:4px;justify-content:center;color:var(--txt2)}
.c2-tbar .cond{border:1px solid var(--borde);border-radius:99px;padding:0 6px;background:var(--relieve);color:var(--txt)}
.c2-tbar .conc{color:var(--ambar-claro)}.c2-tbar .rx{display:inline-block;width:9px;height:9px;background:var(--aliado);clip-path:polygon(50% 0,100% 100%,0 100%)}.c2-tbar .rx.off{opacity:.3}
.c2-regla{position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:44;padding:6px 14px;font-family:var(--mono);font-size:.85rem;pointer-events:none}
.c2-regla.mal{border-color:var(--peligro);color:var(--peligro)}
.c2-banner{position:fixed;z-index:75;left:50%;top:16%;transform:translateX(-50%);padding:10px 26px;text-align:center;pointer-events:none;border-color:var(--ambar);animation:c2b 2.6s ease-out forwards}
.c2-banner b{display:block;font-family:var(--serif);font-size:1.5rem;color:var(--ambar-claro)}.c2-banner span{color:var(--txt2);font-size:.85rem}
@keyframes c2b{0%{opacity:0;transform:translate(-50%,-8px)}12%,80%{opacity:1;transform:translate(-50%,0)}100%{opacity:0}}
.c2-recs{position:fixed;left:50%;bottom:132px;transform:translateX(-50%);z-index:46;display:grid;gap:8px;width:min(460px,calc(100% - 24px))}
.c2-rec{display:grid;gap:6px;padding:8px 12px}.c2-rec .det{color:var(--txt2);font-size:.85rem}.c2-rec div{display:flex;gap:8px}
.c2-sig{font-size:.8rem;color:var(--txt2);white-space:nowrap}
.c2-st{font-size:.65rem;line-height:1;color:var(--txt2)}.c2-st.critical,.c2-st.down{color:var(--peligro)}.c2-st.bloodied{color:var(--ambar-claro)}
.init li[draggable=true]{cursor:grab}.init li.arrastra{opacity:.4}.init li.sobre{outline:2px dashed var(--foco);outline-offset:2px}
.pill[data-b]{cursor:pointer;min-height:0}
.c2-opts{border:1px solid var(--borde);border-radius:var(--r-card);display:grid;gap:6px;padding:8px}.c2-opts select{min-height:44px;background:var(--sombra);color:inherit;border:1px solid var(--borde);border-radius:var(--r-btn);padding:0 8px}
.c2-opts .chk{display:flex;align-items:center;gap:8px}.c2-opts .chk input{width:auto;min-height:0}
.c2-extras{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
@media (prefers-reduced-motion:reduce){.c2-banner{animation:none}}
`;
let cssIn = false;
const injectCss = () => {
  if (cssIn) return; cssIn = true;
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
};
const HP_ES: Record<string, string> = { ok: 'ileso', hurt: 'herido', bloodied: 'malherido', critical: 'crítico', down: 'caído' };
/** CA efectiva: base + 5 de Escudo. */
export const acOf = (t: Token) => t.ac == null ? undefined : t.ac + (t.shielded ? 5 : 0);
/** Texto de PG de un enemigo según lo que la mesa deje ver (exactos, por estado o nada). */
export const hpText = (t: Token) => t.hp ? `${t.hp.cur}/${t.hp.max}` : t.hpState ? HP_ES[t.hpState] : '';

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

// ---- Retrasar turno e iniciativa de los jugadores ----
export function combatExtras(c: C2Ctx) {
  injectCss();
  const el = document.createElement('div');
  el.className = 'c2-extras'; el.hidden = true;
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = 'Retrasar turno';
  const ini = document.createElement('span');
  el.append(b, ini);
  let id: Id | undefined;
  b.onclick = () => id && c.send({ t: 'combat', op: 'delay', tokenId: id });
  ini.onclick = e => {
    const x = (e.target as HTMLElement).closest('button'); if (!x) return;
    if (x.dataset.force) c.send({ t: 'combat', op: 'forceInit' });
    else if (x.dataset.roll) c.send({ t: 'rollInit', tokenId: x.dataset.roll });
  };
  return {
    el,
    /** Llamar en cada estado. */
    update() {
      const cb = c.state().combat, s = c.state().scene.tokens;
      id = cb?.order[cb.turn]?.tokenId;
      const t = s.find(x => x.id === id), wait = cb?.awaiting ?? [];
      // iniciativa pedida: cada dueño tira la suya; el DM puede forzar
      ini.innerHTML = wait.map(w => s.find(x => x.id === w)).filter((x): x is Token => !!x && (x.owners.includes(c.memberId) || isDm(c)))
        .map(x => `<button type="button" class="primary" data-roll="${esc(x.id)}">Tirar iniciativa: ${esc(x.name)}</button>`).join('')
        + (wait.length && staff(c) ? '<button type="button" data-force="1">Forzar iniciativa</button>' : '');
      b.hidden = !!wait.length || !cb || !t || !(isDm(c) || t.owners.includes(c.memberId));
      el.hidden = b.hidden && !ini.innerHTML;
    },
  };
}

/** Reordenar el tracker arrastrando (solo DM): los <li> llevan data-tid y data-i. Delegación sobre #init (sobrevive a innerHTML). */
export function bindReorder(el: HTMLElement, c: C2Ctx) {
  if (!isDm(c)) return;
  let from: string | undefined;
  const li = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>('li[data-tid]');
  el.addEventListener('dragstart', e => { const x = li(e); if (!x) return; from = x.dataset.tid; x.classList.add('arrastra'); e.dataTransfer?.setData('text/plain', from ?? ''); });
  el.addEventListener('dragover', e => { const x = li(e); if (!x || !from) return; e.preventDefault(); el.querySelectorAll('.sobre').forEach(y => y.classList.remove('sobre')); x.classList.add('sobre'); });
  el.addEventListener('dragend', () => { from = undefined; el.querySelectorAll('.arrastra,.sobre').forEach(y => y.classList.remove('arrastra', 'sobre')); });
  el.addEventListener('drop', e => {
    const x = li(e); if (!x || !from) return;
    e.preventDefault();
    if (x.dataset.tid !== from) c.send({ t: 'combat', op: 'move', tokenId: from, to: +x.dataset.i! });
    from = undefined;
  });
}

// ---- Reacciones (Escudo, Contraconjuro): aviso con cuenta atrás ----
const shown = new Set<Id>();
export function reactionPrompt(msg: Extract<S2C, { t: 'reactionPrompt' }>, c: C2Ctx) {
  injectCss();
  const key = `${msg.pending}|${msg.actionId}`;
  if (shown.has(key)) return;
  shown.add(key);
  const secs = /counterspell/i.test(msg.actionId) ? 5 : 10; // el servidor da 5 s al Contraconjuro y 10 s al resto
  const el = document.createElement('div');
  el.className = 'c2-react panel'; el.setAttribute('role', 'alert'); el.setAttribute('aria-live', 'assertive');
  el.innerHTML = `<p>${esc(msg.text || 'Te atacan: ¿usas una reacción?')}</p>
    <div><button type="button" class="primary" data-u>Usar <span class="sr">reacción</span></button> <button type="button" data-i>Ignorar</button>
    <span class="c2-cuenta" aria-hidden="true">${secs}</span></div>
    <p class="sr">Alt+R para usar la reacción. Tienes ${secs} segundos.</p>`;
  const end = () => { clearInterval(iv); removeEventListener('keydown', kd); el.remove(); setTimeout(() => shown.delete(key), 15000); };
  const use = () => { c.send({ t: 'react', pending: msg.pending, tokenId: msg.tokenId, actionId: msg.actionId }); end(); };
  const kd = (e: KeyboardEvent) => { if (e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); use(); } };
  let left = secs;
  const iv = setInterval(() => { left--; if (left <= 0) return end(); el.querySelector('.c2-cuenta')!.textContent = String(left); }, 1000);
  (el.querySelector('[data-u]') as HTMLElement).onclick = use;
  (el.querySelector('[data-i]') as HTMLElement).onclick = end;
  addEventListener('keydown', kd);
  (document.querySelector('.mesa') ?? document.body).append(el);
}

/** Rótulo breve del conjuro: nombre, escuela y nivel. */
export function spellBanner(msg: Extract<S2C, { t: 'spellBanner' }>) {
  injectCss();
  const el = document.createElement('div');
  el.className = 'c2-banner panel'; el.setAttribute('role', 'status');
  el.innerHTML = `<b>${esc(msg.name)}</b><span>${esc(msg.caster)}${msg.school ? ' · ' + esc(msg.school) : ''} · ${msg.level ? 'nivel ' + msg.level : 'truco'}</span>`;
  document.body.append(el);
  setTimeout(() => el.remove(), 2700);
}

// ---- Recordatorios de inicio/fin de turno: salvación repetida, daño continuo, regeneración ----
const effText = (e: TurnEffect) => [e.save && `salvación de ${ABILITY_ES[e.save.ability]} CD ${e.save.dc}`, e.damage && `${e.damage}${e.damageType ? ' ' + e.damageType : ''}`,
  e.heal && `cura ${e.heal}`, e.endsCondition && `termina ${CONDITIONS[e.endsCondition] ?? e.endsCondition}`].filter(Boolean).join(' · ');
export function turnReminder(msg: Extract<S2C, { t: 'turnReminder' }>, c: C2Ctx) {
  injectCss();
  let box = document.getElementById('c2-recs');
  if (!box) { box = document.createElement('div'); box.id = 'c2-recs'; box.className = 'c2-recs'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const t = c.state().scene.tokens.find(x => x.id === msg.tokenId);
  for (const e of msg.effects) {
    if (box.querySelector(`[data-e="${CSS_ESC(e.id)}"]`)) continue;
    const row = document.createElement('div');
    row.className = 'c2-rec panel'; row.dataset.e = e.id;
    row.innerHTML = `<span><b>${esc(t?.name ?? '?')}</b>: ${esc(e.name)} <em class="det">(${msg.phase === 'start' ? 'inicio' : 'fin'} de turno)</em></span><span class="det">${esc(effText(e))}</span>
      <div><button type="button" class="primary" data-a>Aplicar</button><button type="button" data-d>Descartar</button></div>`;
    (row.querySelector('[data-a]') as HTMLElement).onclick = () => { c.send({ t: 'effect', op: 'apply', tokenId: msg.tokenId, effectId: e.id }); row.remove(); };
    (row.querySelector('[data-d]') as HTMLElement).onclick = () => { c.send({ t: 'effect', op: 'dismiss', tokenId: msg.tokenId, effectId: e.id }); row.remove(); };
    box.append(row);
    setTimeout(() => row.remove(), 60000);
  }
}
const CSS_ESC = (v: string) => v.replace(/["\\]/g, '');

// ---- Plantillas con forma ----
export type TemplateCtx = {
  caster: Id; state(): ClientState;
  table: Pick<Table, 'setMarks'>; baseMarks(): Marks;      // marks() del shell sin plantilla
  fire(tokenId: Id, actionId: Id, targets: Id[], extra?: { at: Point; dir?: Point }): void;    // el fire del shell
};
/**
 * Controlador para el HUD: pointer(x,y) en onPointer; click(x,y) en onMapClick/onTokenClick; cancel() al desarmar;
 * rotate(dir) con Shift+rueda (±15° en cono y línea, ±90° en el cubo).
 */
export function templateTargeting(a: Action, c: TemplateCtx) {
  const area = a.area!, shape = area.shape === 'cylinder' ? 'sphere' : area.shape; // el cilindro es una esfera en 2D
  const fromCaster = shape === 'cone' || shape === 'line';
  const caster = () => c.state().scene.tokens.find(t => t.id === c.caster);
  let at: Point | undefined, rot = 0; // rot: radianes (cono/línea) o cuartos de vuelta (cubo)
  /**
   * Una sola geometría para dibujar y para calcular (inArea de @lantern/rules: `dir` es un PUNTO); el servidor calcula lo mismo desde `at`/`dir`.
   * cono/línea: origen = lanzador, hacia el puntero girado. cubo: esquina en el puntero, cuadrante hacia fuera del lanzador girado en cuartos. esfera/cilindro: centrada en el puntero.
   */
  const geom = (p: Point) => {
    const o = caster(), g = c.state().scene.grid, L = area.size / g.feet * g.size;
    if (fromCaster && o) {
      const dx = p.x - o.x, dy = p.y - o.y, cs = Math.cos(rot), sn = Math.sin(rot), vx = dx * cs - dy * sn, vy = dx * sn + dy * cs;
      return { origin: { x: o.x, y: o.y }, dir: { x: o.x + vx, y: o.y + vy }, vec: { x: vx, y: vy }, from: { x: o.x, y: o.y } };
    }
    if (shape === 'cube') {
      let sx = o && p.x < o.x ? -1 : 1, sy = o && p.y < o.y ? -1 : 1;
      for (let k = 0; k < ((rot % 4) + 4) % 4; k++) [sx, sy] = [-sy, sx];
      // el renderer dibuja el cubo con el origen en el centro de un lado: se desplaza medio lado para cubrir justo el cuadrante de inArea
      return { origin: p, dir: { x: p.x + sx, y: p.y + sy }, vec: { x: sx, y: 0 }, from: { x: p.x, y: p.y + sy * L / 2 } };
    }
    return { origin: p, dir: p, vec: { x: 1, y: 0 }, from: p };
  };
  /** Quién queda dentro: en el área y sin cobertura total por muros desde el origen (contorno al pasar el ratón). */
  const inside = (p: Point) => {
    const s = c.state(), { origin, dir } = geom(p), o = caster(), g = s.scene.grid;
    const lv = (l?: Id) => l === s.scene.levels?.[0]?.id ? undefined : l;
    const segs = sightSegments(s.scene.walls.filter(w => lv(w.level) === lv(o?.level)), origin);
    return s.scene.tokens.filter(t => (!fromCaster || t.id !== c.caster) && lv(t.level) === lv(o?.level) && inArea(shape, origin, dir, area.size, g, t)
      && cover(origin, t, t.size * g.size / 2, segs) !== 'total');
  };
  const paint = () => {
    const m = c.baseMarks(), col = '#E8A33D', g = c.state().scene.grid;
    if (!at) return c.table.setMarks(m);
    const { vec, from } = geom(at), radius = area.size / g.feet * g.size, targets = inside(at).map(t => t.id);
    c.table.setMarks(area.shape === 'sphere'
      ? { ...m, targets: [...new Set([...m.targets, ...targets])], area: { x: at.x, y: at.y, radius, color: col } }
      : { ...m, targets: [...new Set([...m.targets, ...targets])], template: { shape: area.shape === 'cylinder' ? 'cylinder' : shape, origin: from, dir: vec, sizePx: radius, color: col } });
  };
  return {
    pointer(x: number, y: number) { at = { x, y }; paint(); },
    rotate(dir: number) { if (shape === 'sphere') return; rot += shape === 'cube' ? dir : dir * Math.PI / 12; paint(); },
    click(x: number, y: number) {
      const p = { x, y }, { dir } = geom(p);
      at = undefined;
      c.fire(c.caster, a.id, inside(p).map(t => t.id), { at: p, ...(shape === 'sphere' ? {} : { dir }) }); // el shell desarma y repinta
    },
    cancel() { at = undefined; rot = 0; c.table.setMarks(c.baseMarks()); },
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
  if (dm && inCombat && t.srd && s.combat!.order.filter(o => s.scene.tokens.find(x => x.id === o.tokenId)?.srd === t.srd).length > 1) out.push(
    { id: 'c-group', label: 'Agrupar iniciativa', icon: 'ping', run: () => c.send({ t: 'combat', op: 'group', tokenId: t.id }) },
    { id: 'c-split', label: 'Separar iniciativa', icon: 'ping', run: () => c.send({ t: 'combat', op: 'split', tokenId: t.id }) },
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

// ---- Regla viva del arrastre: distancia, velocidad restante, modo (Tab), terreno difícil, ataque de oportunidad, ruta fantasma ----
const MODE_ES: Record<MoveMode, string> = { walk: 'Andar', fly: 'Volar', swim: 'Nadar', climb: 'Trepar' };
/**
 * El renderer llama a `drag(id, puntos)` en cada movimiento del arrastre (puntos = inicio + puntos de paso + posición actual) y a `end()` al soltar.
 * `route(id)` da los puntos de paso y el modo para el `moveToken`. Tab (shell) llama a `cycle()`.
 */
export function moveRuler(c: C2Ctx, table: () => Promise<Table>) {
  injectCss();
  const tag = document.createElement('div');
  tag.className = 'c2-regla panel'; tag.hidden = true; tag.setAttribute('aria-live', 'off');
  document.body.append(tag);
  let mode: MoveMode = 'walk', id: Id | undefined, pts: Point[] = [], seen = new Set<Id>(), sentAt = 0, lastAt = 0;
  const tb = () => table();
  const paint = () => {
    const s = c.state(), t = s.scene.tokens.find(x => x.id === id);
    if (!t || pts.length < 2) return;
    const sp = speedFor(t, mode), u = s.combat?.used[t.id], cb = !!s.combat && s.combat.order[s.combat.turn]?.tokenId === t.id;
    const { feet, legs } = routeCost(s.scene, t, pts, { diagonal: s.settings.diagonal, mode });
    const left = sp == null ? undefined : sp + (u?.dash ?? 0) - (u?.moved ?? 0); // pies que quedaban antes de este arrastre
    const foes = s.scene.tokens.filter(f => !f.hidden && f.id !== t.id && !s.combat?.used[f.id]?.reaction);
    const opp = u?.disengage ? [] : opportunities(s.scene, t, pts, foes);
    void tb().then(x => {
      x.setRoute(pts, { difficult: legs.filter(l => l.difficult).map(l => [l.from, l.to]), ...(cb && left != null && { remaining: left }) });
      for (const o of opp) if (!seen.has(o.foe.id)) { seen.add(o.foe.id); x.floatText(o.foe.id, '⚠ ataque de oportunidad', '#F08A64'); }
    });
    const over = cb && left != null && feet > left + 1e-6;
    tag.classList.toggle('mal', over || sp == null || opp.length > 0);
    tag.textContent = `${Math.round(feet * 10) / 10} pies${cb && left != null ? ` · quedan ${Math.max(0, Math.round((left - feet) * 10) / 10)}` : ''} · ${MODE_ES[mode]}${sp == null ? ' (sin velocidad)' : ''} · Tab cambia`
      + (opp.length ? ` · ⚠ oportunidad: ${opp.map(o => o.foe.name).join(', ')}` : '');
    tag.hidden = false;
    lastAt = Date.now();
    if (s.settings.optional.ghostRoutes && lastAt - sentAt > 150) { sentAt = lastAt; c.send({ t: 'route', tokenId: t.id, points: pts.slice(0, 20) }); }
  };
  return {
    drag(tokenId: Id, points: Point[]) { if (tokenId !== id) { seen = new Set(); mode = 'walk'; } id = tokenId; pts = points; paint(); },
    /** ¿Hay un arrastre en curso? (para que Tab cambie de modo) */
    get active() { return !!id && Date.now() - lastAt < 3000; },
    cycle() {
      const t = c.state().scene.tokens.find(x => x.id === id); if (!t) return;
      const all: MoveMode[] = ['walk', 'fly', 'swim', 'climb'], ok = all.filter(m => m === 'walk' || speedFor(t, m) != null);
      mode = ok[(ok.indexOf(mode) + 1) % ok.length]; paint();
    },
    /** Al soltar: devuelve el path y el modo para el moveToken y limpia la regla. */
    end(tokenId: Id): { path?: Point[]; mode?: MoveMode } {
      const r = tokenId === id && pts.length > 2 ? { path: pts.slice(1, -1).slice(0, 16) } : {};
      const m = tokenId === id && mode !== 'walk' ? { mode } : {};
      id = undefined; pts = []; mode = 'walk'; tag.hidden = true;
      void tb().then(x => x.setRoute(null));
      return { ...r, ...m };
    },
  };
}

// ---- Barra flotante sobre el token seleccionado ----
export function tokenBar(c: C2Ctx, table: () => Promise<Table>, selected: () => Id | undefined) {
  injectCss();
  const el = document.createElement('div');
  el.className = 'c2-tbar panel'; el.hidden = true;
  document.body.append(el);
  let tb: Table | undefined, raf = 0, key = '';
  void table().then(t => { tb = t; });
  const place = () => {
    raf = 0;
    const s = c.state(), t = s.scene.tokens.find(x => x.id === selected());
    if (!t || !tb || el.hidden) return;
    const p = tb.worldToClient(t.x, t.y - t.size * s.scene.grid.size / 2 - 6);
    el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
    raf = requestAnimationFrame(place); // sigue a la cámara (pan/zoom) y al token en movimiento
  };
  return {
    update() {
      const s = c.state(), t = s.scene.tokens.find(x => x.id === selected());
      el.hidden = !t;
      if (!t || el.hidden) return;
      const hp = t.hp, u = s.combat?.used[t.id], ac = acOf(t);
      const html = `<b>${esc(t.name)}</b>
        ${hp ? `<span class="hp" role="img" aria-label="PG ${hp.cur} de ${hp.max}${hp.temp ? `, ${hp.temp} temporales` : ''}"><i style="width:${Math.max(0, Math.min(100, hp.cur / hp.max * 100))}%"></i>${hp.temp ? `<u style="width:${Math.min(100, hp.temp / hp.max * 100)}%"></u>` : ''}</span>` : ''}
        <span class="fila">${hp ? `<span>PG ${hp.cur}/${hp.max}${hp.temp ? ` (+${hp.temp})` : ''}</span>` : t.hpState ? `<span>${HP_ES[t.hpState]}</span>` : ''}${ac != null ? `<span>CA ${ac}${t.shielded ? ' 🛡' : ''}</span>` : ''}
        ${s.combat && s.combat.order.some(o => o.tokenId === t.id) ? `<span class="rx${u?.reaction ? ' off' : ''}" role="img" aria-label="Reacción ${u?.reaction ? 'gastada' : 'disponible'}"></span>` : ''}</span>
        ${t.concentration ? `<span class="conc">⟡ ${esc(t.concentration)}</span>` : ''}
        ${t.conditions.length ? `<span class="fila">${t.conditions.map(k => `<span class="cond">${esc(CONDITIONS[k] ?? k)}${t.condRounds?.[k] ? ` ${t.condRounds[k]}` : ''}</span>`).join('')}</span>` : ''}`;
      if (html !== key) { key = html; el.innerHTML = html; }
      if (!raf) raf = requestAnimationFrame(place);
    },
  };
}

// ---- Ajustes de combate del DM (PG de enemigos, diagonales, opciones de mesa) ----
export function combatOptions(c: C2Ctx) {
  injectCss();
  const el = document.createElement('fieldset');
  el.className = 'c2-opts';
  const OPT: [string, string][] = [['playerInit', 'Los jugadores tiran su iniciativa'], ['groupInit', 'Iniciativa agrupada de monstruos idénticos'], ['playerSaves', 'Los jugadores tiran sus salvaciones'], ['ghostRoutes', 'Ruta fantasma visible para todos']];
  el.innerHTML = `<legend>Combate</legend>
    <label>PG de enemigos en el carrusel<select data-k="hpView"><option value="none">Ocultos</option><option value="status">Estado (herido, crítico…)</option><option value="exact">Exactos</option></select></label>
    <label>Diagonales<select data-k="diagonal"><option value="chebyshev">5-5-5</option><option value="alt">5/10/5</option><option value="euclid">Euclídea</option></select></label>
    ${OPT.map(([k, n]) => `<label class="chk"><input type="checkbox" data-o="${k}"> ${n}</label>`).join('')}`;
  el.addEventListener('change', e => {
    const x = e.target as HTMLInputElement | HTMLSelectElement;
    if (x.dataset.k) c.send({ t: 'settings', patch: { [x.dataset.k]: x.value } as never });
    else if (x.dataset.o) c.send({ t: 'settings', patch: { optional: { [x.dataset.o]: (x as HTMLInputElement).checked } } });
  });
  return {
    el,
    update(s: ClientState) {
      (el.querySelector('[data-k=hpView]') as HTMLSelectElement).value = s.settings.hpView ?? 'none';
      (el.querySelector('[data-k=diagonal]') as HTMLSelectElement).value = s.settings.diagonal ?? 'chebyshev';
      for (const [k] of OPT) (el.querySelector(`[data-o=${k}]`) as HTMLInputElement).checked = !!(s.settings.optional as Record<string, boolean | undefined>)[k];
    },
  };
}
