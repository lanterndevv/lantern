import { PROTOCOL_VERSION } from '@lantern/protocol';
import type { C2S } from '@lantern/protocol';

/**
 * Tarjeta X. Atajo: Alt+X (sin Alt chocaría con escribir una «x» en el chat).
 * Botón flotante abajo a la izquierda. Devuelve la función de desmontaje.
 */
export function mountSafety(ctx: { send(m: C2S): void }) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'tarjeta-x'; b.textContent = 'X';
  b.setAttribute('aria-label', 'Tarjeta X: pausar sin dar explicaciones');
  b.title = 'Tarjeta X (Alt+X)';
  const fire = () => ctx.send({ t: 'safety', op: 'x' });
  b.onclick = fire;
  const key = (e: KeyboardEvent) => { if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyX') { e.preventDefault(); fire(); } };
  document.addEventListener('keydown', key);
  document.body.append(b);
  return () => { document.removeEventListener('keydown', key); b.remove(); };
}

/** Manejador de S2C `safety`: pausa a pantalla completa, sin autor. */
export function handleSafety(msg: { t: 'safety'; op: 'x' }) {
  if (msg.op !== 'x' || document.getElementById('pausa-x')) return;
  const d = document.createElement('dialog');
  d.id = 'pausa-x'; d.className = 'pausa-x'; d.setAttribute('role', 'alertdialog'); d.setAttribute('aria-labelledby', 'pausa-t');
  d.innerHTML = `<div aria-live="assertive"><h2 id="pausa-t">Pausa</h2><p>Alguien ha usado la tarjeta X. Seguimos cuando estemos listos.</p></div><button type="button" class="primary">Continuar</button>`;
  const end = () => { d.close(); d.remove(); };
  d.querySelector('button')!.onclick = end;
  d.addEventListener('cancel', end);
  document.body.append(d); d.showModal(); d.querySelector('button')!.focus();
}

/** Comprueba welcome.v; si difiere, barra fija con «Recargar». */
export function checkProtocol(v: number) {
  if (v === PROTOCOL_VERSION || document.getElementById('barra-version')) return;
  const bar = document.createElement('div');
  bar.id = 'barra-version'; bar.className = 'barra-version'; bar.setAttribute('role', 'alert');
  bar.innerHTML = `<span>Hay una versión nueva de Lantern. Recarga para continuar.</span><button type="button" class="primary">Recargar</button>`;
  bar.querySelector('button')!.onclick = () => location.reload();
  document.body.prepend(bar);
}
