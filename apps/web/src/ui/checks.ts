import { SKILLS, ABILITY_ES } from '@lantern/rules';
import { t, tsrv } from '../i18n.ts';
import type { C2S, ChatMsg, ClientState, Id, Token } from '@lantern/protocol';

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const ABS = Object.entries(ABILITY_ES).map(([k, v]) => [k, t(v)] as [string, string]);
const KEYS = { save: ABS, ability: ABS, skill: Object.entries(SKILLS).map(([k, v]) => [k, `${t(v.name)} (${t(ABILITY_ES[v.ability])})`] as [string, string]) };

/** Insignias HTML para el registro: `addMsg` las añade tras la tirada. */
export const rollBadges = (roll?: ChatMsg['roll']) =>
  roll ? `${roll.blind ? `<em class="secreta">${t('a ciegas')}</em>` : ''}${roll.external ? `<em class="secreta">${t('externa (Beyond20)')}</em>` : ''}` : '';

/** Punto de héroe: botón solo si la regla está activa y el token tiene puntos. */
export function heroButton(token: Token, ctx: { send(m: C2S): void; state(): ClientState }) {
  const n = token.heroPoints ?? 0;
  if (!ctx.state().settings.optional.heroPoints || n <= 0) return null;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'hero'; b.textContent = t('Punto de héroe ({n})', { n });
  b.onclick = () => ctx.send({ t: 'heroPoint', tokenId: token.id });
  return b;
}

/** DM: formulario para pedir pruebas. `render()` refresca la lista de tokens al llegar un state. */
export function mountCheckRequester(el: HTMLElement, ctx: { send(m: C2S): void; state(): ClientState; selected?(): Id[] }) {
  el.innerHTML = `<form class="pedir" aria-label="${t('Pedir una prueba')}">
    <fieldset><legend>${t('Quién tira')}</legend>
      <div class="chips-btn"><button type="button" data-q="pj">${t('Todos los personajes')}</button><button type="button" data-q="sel">${t('Seleccionados')}</button></div>
      <div class="pd-toks"></div></fieldset>
    <label>${t('Tipo')}<select name="kind"><option value="save">${t('Salvación')}</option><option value="skill">${t('Habilidad')}</option><option value="ability">${t('Característica')}</option></select></label>
    <label>${t('Prueba')}<select name="key"></select></label>
    <label>${t('CD (opcional)')}<input name="dc" type="number" min="1" max="40" inputmode="numeric"></label>
    <label class="fila"><input name="blind" type="checkbox"> ${t('A ciegas')}</label>
    <button type="submit" class="primary">${t('Pedir tirada')}</button><p class="det" role="status"></p></form>`;
  const f = el.querySelector('form')!, toks = f.querySelector<HTMLElement>('.pd-toks')!;
  const kind = f.elements.namedItem('kind') as HTMLSelectElement, key = f.elements.namedItem('key') as HTMLSelectElement;
  const boxes = () => [...toks.querySelectorAll<HTMLInputElement>('input')];
  const fillKeys = () => { key.innerHTML = KEYS[kind.value as keyof typeof KEYS].map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join(''); };
  const render = () => {
    const on = new Set(boxes().filter(b => b.checked).map(b => b.value));
    toks.innerHTML = ctx.state().scene.tokens.map(k =>
      `<label class="fila"><input type="checkbox" value="${esc(k.id)}"${on.has(k.id) ? ' checked' : ''}> ${esc(k.name)}</label>`).join('') || `<p class="det">${t('No hay tokens en el mapa.')}</p>`;
  };
  const pick = (ids: (k: Token) => boolean) => { const s = ctx.state().scene.tokens; boxes().forEach(b => { b.checked = ids(s.find(k => k.id === b.value)!); }); };
  kind.onchange = fillKeys;
  f.addEventListener('click', e => {
    const q = (e.target as HTMLElement).closest<HTMLElement>('[data-q]')?.dataset.q;
    if (q === 'pj') pick(k => k.owners.length > 0);
    else if (q === 'sel') { const s = new Set(ctx.selected?.() ?? []); pick(k => s.has(k.id)); }
  });
  f.onsubmit = e => {
    e.preventDefault();
    const tokenIds = boxes().filter(b => b.checked).map(b => b.value), st = f.querySelector('[role=status]')!;
    if (!tokenIds.length) { st.textContent = t('Elige al menos un token.'); return; }
    const dc = (f.elements.namedItem('dc') as HTMLInputElement).valueAsNumber;
    ctx.send({ t: 'requestCheck', tokenIds, kind: kind.value as 'save' | 'skill' | 'ability', key: key.value,
      ...(Number.isFinite(dc) ? { dc } : {}), ...((f.elements.namedItem('blind') as HTMLInputElement).checked ? { blind: true } : {}) });
    st.textContent = t('Prueba pedida a {n} token(s).', { n: tokenIds.length });
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
  for (const k of ctx.state().scene.tokens) {
    if (!msg.tokenIds.includes(k.id) || !k.owners.includes(ctx.me)) continue;
    const row = document.createElement('div');
    row.className = 'pedido panel';
    row.innerHTML = `<span>${t('El DM pide:')} ${esc(tsrv(msg.label))}${msg.dc != null ? ` (${t('CD')} ${msg.dc})` : ''} · ${esc(k.name)}</span><button type="button" class="primary">${t('Tirar')}</button>`;
    row.querySelector('button')!.onclick = () => { ctx.send({ t: 'answerCheck', requestId: msg.id, tokenId: k.id }); row.remove(); };
    box.append(row);
  }
}

/** Jugador: petición de tirar su propia salvación (opción de mesa); si no la tira a tiempo, el servidor usa la que ya tenía. */
export function handleSaveRequest(msg: Extract<import('@lantern/protocol').S2C, { t: 'saveRequest' }>, ctx: { send(m: C2S): void }) {
  let box = document.getElementById('pedidos');
  if (!box) {
    box = document.createElement('div'); box.id = 'pedidos'; box.className = 'pedidos';
    box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const row = document.createElement('div');
  row.className = 'pedido panel';
  row.innerHTML = `<span>${esc(tsrv(msg.text))} · ${t('CD')} ${msg.dc} <span class="c2-cuenta" aria-hidden="true"></span></span><button type="button" class="primary">${t('Tirar salvación')}</button>`;
  const cuenta = row.querySelector('.c2-cuenta')!;
  let left = 20; // el servidor da 20 s; la cuenta es orientativa (no depende del reloj del servidor)
  cuenta.textContent = String(left);
  const iv = setInterval(() => { left--; if (left <= 0) { clearInterval(iv); row.remove(); } else cuenta.textContent = String(left); }, 1000);
  row.querySelector('button')!.onclick = () => { ctx.send({ t: 'answerSave', pending: msg.pending, tokenId: msg.tokenId }); clearInterval(iv); row.remove(); };
  box.append(row);
}
