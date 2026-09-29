import type { ClientState, ChatMsg } from '@lantern/protocol';
import type { Table } from '../render/api.ts';
import { net } from '../net.ts';
import { t } from '../i18n.ts';
import './a11y.css';

export type DisplayMode = 'normal' | 'mesa' | 'espectador';

/** Lee ?vista= (mesa | espectador). */
export const displayModeFromUrl = (): DisplayMode => {
  const v = new URLSearchParams(location.search).get('vista');
  return v === 'mesa' || v === 'espectador' ? v : 'normal';
};

/**
 * Montaje en ui/table.ts (dentro de mountTable, tras crear `root` y la promesa del renderer):
 *   import { applyDisplayMode, displayModeFromUrl } from './display.ts';
 *   applyDisplayMode(displayModeFromUrl(), { table: tablePromise, root, state: w.state });
 * `table` es la Table (o su promesa). `state` es el estado del welcome (los siguientes los escucha solo, vía net.on).
 * No hace falta onTurn: el cambio de turno se detecta aquí desde state.combat.
 * Devuelve una función para desmontar. Los elementos que oculta son .lado .hud .ed-bar .ed-insp .tl #elegir (y .init en «espectador»).
 * Para obs=1 añade la clase `obs` en <html> (fondo transparente); si el canvas Pixi se crea con fondo opaco, hay que ponerlo alpha en render/.
 */
export function applyDisplayMode(
  mode: DisplayMode,
  ctx: { table: Promise<Table> | Table; root: HTMLElement; state?: ClientState },
) {
  if (mode === 'normal') return () => {};
  const { root } = ctx;
  root.classList.add('modo-' + mode);
  if (new URLSearchParams(location.search).get('obs') === '1') document.documentElement.classList.add('obs');

  const aviso = el('div', 'dm-aviso'); aviso.setAttribute('role', 'alert');
  root.append(aviso);
  let top: HTMLElement | undefined, log: HTMLElement | undefined;
  if (mode === 'espectador') {
    top = el('div', 'dm-top'); log = el('ul', 'dm-log'); log.setAttribute('aria-label', t('Últimas tiradas'));
    root.append(top, log);
  }

  let table: Table | undefined, state = ctx.state, turn = '';
  const fit = () => { table?.setDisplay('fixed'); table?.fitScene(); };
  Promise.resolve(ctx.table).then(t => { table = t; fit(); if (state) update(state, true); });
  addEventListener('resize', fit);

  function update(s: ClientState, first = false) {
    state = s;
    const c = s.combat, id = c?.order[c.turn]?.tokenId;
    if (top) top.innerHTML = `${esc(s.scene.name)}${c ? `<span>${t('Ronda {n}', { n: c.round })}</span>` : ''}`;
    const key = c && id ? `${id}:${c.round}` : '';
    if (key && key !== turn && !first) {
      const tk = s.scene.tokens.find(t => t.id === id);
      if (tk) {
        table?.focus(tk.x, tk.y);
        aviso.textContent = t('¡Turno de {n}!', { n: tk.name });
        aviso.classList.remove('show'); void aviso.offsetWidth; aviso.classList.add('show');
      }
    }
    turn = key;
  }
  if (state) update(state, true);

  const off = net.on(m => {
    if (m.t === 'state' || m.t === 'welcome') { update(m.state); if (m.t === 'welcome') fit(); }
    else if (m.t === 'chat' && log) addLog(m.msg);
  });

  function addLog(m: ChatMsg) {
    const who = state?.members.find(x => x.id === m.from)?.name ?? '';
    const txt = m.roll ? (m.roll.secret ? '' : `${who}: ${m.roll.expr} = ${m.roll.total}`)
      : m.card ? `${m.card.actorName}: ${m.card.actionName}` : '';
    if (!txt) return;
    const li = el('li', ''); li.textContent = txt;
    li.onanimationend = () => li.remove();
    log!.append(li);
    while (log!.children.length > 4) log!.firstElementChild!.remove();
  }

  return () => { off(); removeEventListener('resize', fit); aviso.remove(); top?.remove(); log?.remove(); root.classList.remove('modo-' + mode); };
}

const el = (tag: string, cls: string) => Object.assign(document.createElement(tag), { className: cls });
const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
