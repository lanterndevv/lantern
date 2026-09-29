import { SKILLS, ABILITY_ES } from '@lantern/rules';
import type { C2S, ChatMsg, ClientState, Id, Token } from '@lantern/protocol';

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const ABS = Object.entries(ABILITY_ES) as [string, string][];
const KEYS = { save: ABS, ability: ABS, skill: Object.entries(SKILLS).map(([k, v]) => [k, `${v.name} (${ABILITY_ES[v.ability]})`] as [string, string]) };

/** Insignias HTML para el registro: `addMsg` las añade tras la tirada. */
export const rollBadges = (roll?: ChatMsg['roll']) =>
  roll ? `${roll.blind ? '<em class="secreta">a ciegas</em>' : ''}${roll.external ? '<em class="secreta">externa (Beyond20)</em>' : ''}` : '';

/** Punto de héroe: botón solo si la regla está activa y el token tiene puntos. */
export function heroButton(token: Token, ctx: { send(m: C2S): void; state(): ClientState }) {
  const n = token.heroPoints ?? 0;
  if (!ctx.state().settings.optional.heroPoints || n <= 0) return null;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'hero'; b.textContent = `Punto de héroe (${n})`;
  b.onclick = () => ctx.send({ t: 'heroPoint', tokenId: token.id });
  return b;
}

/** DM: formulario para pedir pruebas. `render()` refresca la lista de tokens al llegar un state. */
export function mountCheckRequester(el: HTMLElement, ctx: { send(m: C2S): void; state(): ClientState; selected?(): Id[] }) {
  el.innerHTML = `<form class="pedir" aria-label="Pedir una prueba">
    <fieldset><legend>Quién tira</legend>
      <div class="chips-btn"><button type="button" data-q="pj">Todos los personajes</button><button type="button" data-q="sel">Seleccionados</button></div>
      <div class="pd-toks"></div></fieldset>
    <label>Tipo<select name="kind"><option value="save">Salvación</option><option value="skill">Habilidad</option><option value="ability">Característica</option></select></label>
    <label>Prueba<select name="key"></select></label>
    <label>CD (opcional)<input name="dc" type="number" min="1" max="40" inputmode="numeric"></label>
    <label class="fila"><input name="blind" type="checkbox"> A ciegas</label>
    <button type="submit" class="primary">Pedir tirada</button><p class="det" role="status"></p></form>`;
  const f = el.querySelector('form')!, toks = f.querySelector<HTMLElement>('.pd-toks')!;
  const kind = f.elements.namedItem('kind') as HTMLSelectElement, key = f.elements.namedItem('key') as HTMLSelectElement;
  const boxes = () => [...toks.querySelectorAll<HTMLInputElement>('input')];
  const fillKeys = () => { key.innerHTML = KEYS[kind.value as keyof typeof KEYS].map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join(''); };
  const render = () => {
    const on = new Set(boxes().filter(b => b.checked).map(b => b.value));
    toks.innerHTML = ctx.state().scene.tokens.map(t =>
      `<label class="fila"><input type="checkbox" value="${esc(t.id)}"${on.has(t.id) ? ' checked' : ''}> ${esc(t.name)}</label>`).join('') || '<p class="det">No hay tokens en el mapa.</p>';
  };
  const pick = (ids: (t: Token) => boolean) => { const s = ctx.state().scene.tokens; boxes().forEach(b => { b.checked = ids(s.find(t => t.id === b.value)!); }); };
  kind.onchange = fillKeys;
  f.addEventListener('click', e => {
    const q = (e.target as HTMLElement).closest<HTMLElement>('[data-q]')?.dataset.q;
    if (q === 'pj') pick(t => t.owners.length > 0);
    else if (q === 'sel') { const s = new Set(ctx.selected?.() ?? []); pick(t => s.has(t.id)); }
  });
  f.onsubmit = e => {
    e.preventDefault();
    const tokenIds = boxes().filter(b => b.checked).map(b => b.value), st = f.querySelector('[role=status]')!;
    if (!tokenIds.length) { st.textContent = 'Elige al menos un token.'; return; }
    const dc = (f.elements.namedItem('dc') as HTMLInputElement).valueAsNumber;
    ctx.send({ t: 'requestCheck', tokenIds, kind: kind.value as 'save' | 'skill' | 'ability', key: key.value,
      ...(Number.isFinite(dc) ? { dc } : {}), ...((f.elements.namedItem('blind') as HTMLInputElement).checked ? { blind: true } : {}) });
    st.textContent = `Prueba pedida a ${tokenIds.length} token(s).`;
  };
  fillKeys(); render();
  return { render };
}

/** Jugador: aviso no modal por cada token propio al que se le pide una prueba. */
export function handleCheckRequest(msg: Extract<import('@lantern/protocol').S2C, { t: 'checkRequest' }>, ctx: { send(m: C2S): void; state(): ClientState; me: string }) {
  let box = document.getElementById('pedidos');
  if (!box) {
    box = document.createElement('div'); box.id = 'pedidos'; box.className = 'pedidos';
    box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  for (const t of ctx.state().scene.tokens) {
    if (!msg.tokenIds.includes(t.id) || !t.owners.includes(ctx.me)) continue;
    const row = document.createElement('div');
    row.className = 'pedido panel';
    row.innerHTML = `<span>El DM pide: ${esc(msg.label)}${msg.dc != null ? ` (CD ${msg.dc})` : ''} · ${esc(t.name)}</span><button type="button" class="primary">Tirar</button>`;
    row.querySelector('button')!.onclick = () => { ctx.send({ t: 'answerCheck', requestId: msg.id, tokenId: t.id }); row.remove(); };
    box.append(row);
  }
}
