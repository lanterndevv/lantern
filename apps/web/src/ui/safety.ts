import { PROTOCOL_VERSION } from '@lantern/protocol';
import type { C2S, ClientState } from '@lantern/protocol';
import { t } from '../i18n.ts';

type SafetyCtx = { send(m: C2S): void; state(): ClientState; staff: boolean };
const esc = (x: string) => x.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
/** Líneas y velos de la mesa (solo lectura; se editan en la antesala). */
const limits = (s: ClientState) => (['lines', 'veils'] as const).map(l => `<h3>${l === 'lines' ? t('Líneas (no aparecen)') : t('Velos (pasan fuera de plano)')}</h3>
  <ul class="chips">${s.safety[l].map(x => `<li>${esc(x)}</li>`).join('') || `<li class="det">${t('Nada por ahora')}</li>`}</ul>`).join('');

/**
 * Tarjeta X. Atajo: Alt+X (sin Alt chocaría con escribir una «x» en el chat).
 * Botón flotante abajo a la izquierda y, a su lado, «Líneas y velos» para consultarlos durante la partida. Devuelve la función de desmontaje.
 */
export function mountSafety(ctx: SafetyCtx) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'tarjeta-x'; b.textContent = 'X';
  b.setAttribute('aria-label', t('Tarjeta X: pausar sin dar explicaciones'));
  b.title = t('Tarjeta X (Alt+X)');
  const fire = () => ctx.send({ t: 'safety', op: 'x' });
  b.onclick = fire;
  const lv = document.createElement('button');
  lv.type = 'button'; lv.className = 'lineas-velos'; lv.textContent = '≡';
  lv.setAttribute('aria-label', t('Líneas y velos')); lv.title = t('Líneas y velos');
  lv.onclick = () => {
    const d = document.createElement('dialog');
    d.className = 'lv-dlg'; d.setAttribute('aria-labelledby', 'lv-t');
    d.innerHTML = `<h2 id="lv-t">${t('Líneas y velos')}</h2>${limits(ctx.state())}<p class="det">${t('Se añaden y quitan en la antesala, de forma anónima.')}</p><button type="button" class="primary">${t('Cerrar')}</button>`;
    d.querySelector('button')!.onclick = () => d.close();
    d.addEventListener('close', () => d.remove());
    document.body.append(d); d.showModal();
  };
  const key = (e: KeyboardEvent) => { if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyX') { e.preventDefault(); fire(); } };
  document.addEventListener('keydown', key);
  document.body.append(b, lv);
  return () => { document.removeEventListener('keydown', key); b.remove(); lv.remove(); };
}

/**
 * Manejador de S2C `safety`: la X abre una pausa a pantalla completa, sin autor, con las líneas y velos a la vista.
 * El DM (o asistente) la levanta para todos con «Reanudar» (op resume); cada jugador puede cerrar solo la suya.
 */
export function handleSafety(msg: { t: 'safety'; op: 'x' | 'resume' }, ctx: SafetyCtx) {
  const cur = document.getElementById('pausa-x') as HTMLDialogElement | null;
  if (msg.op === 'resume') { cur?.close(); cur?.remove(); return; }
  if (msg.op !== 'x' || cur) return;
  const d = document.createElement('dialog');
  d.id = 'pausa-x'; d.className = 'pausa-x'; d.setAttribute('role', 'alertdialog'); d.setAttribute('aria-labelledby', 'pausa-t');
  d.innerHTML = `<div aria-live="assertive"><h2 id="pausa-t">${t('Pausa')}</h2><p>${t('Alguien ha usado la tarjeta X. Seguimos cuando estemos listos.')}</p></div>
    <div class="pausa-lv">${limits(ctx.state())}</div>
    ${ctx.staff ? `<button type="button" class="primary" data-r>${t('Reanudar para todos')}</button>` : `<p class="det">${t('El DM reanudará la partida para todos.')}</p>`}
    <button type="button"${ctx.staff ? ' class="secondary"' : ' class="primary"'} data-c>${t('Cerrar solo para mí')}</button>`;
  const end = () => { d.close(); d.remove(); };
  d.querySelector<HTMLElement>('[data-c]')!.onclick = end;
  const r = d.querySelector<HTMLElement>('[data-r]'); if (r) r.onclick = () => ctx.send({ t: 'safety', op: 'resume' });
  d.addEventListener('cancel', end);
  document.body.append(d); d.showModal(); d.querySelector('button')!.focus();
}

/** Comprueba welcome.v; si difiere, barra fija con «Recargar». */
export function checkProtocol(v: number) {
  if (v === PROTOCOL_VERSION || document.getElementById('barra-version')) return;
  const bar = document.createElement('div');
  bar.id = 'barra-version'; bar.className = 'barra-version'; bar.setAttribute('role', 'alert');
  bar.innerHTML = `<span>${t('Hay una versión nueva de Lantern. Recarga para continuar.')}</span><button type="button" class="primary">${t('Recargar')}</button>`;
  bar.querySelector('button')!.onclick = () => location.reload();
  document.body.prepend(bar);
}
