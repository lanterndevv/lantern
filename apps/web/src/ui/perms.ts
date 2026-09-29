// Selector de miembros para permisos (§3.17): «quién controla este token» y «quién ve esta escena». Usa <dialog> y clases existentes.
import type { Id, Member } from '@lantern/protocol';

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** Muestra una lista de casillas con los miembros no-DM; al aceptar llama a `done` con los marcados. */
export function pickMembers(title: string, hint: string, members: Member[], current: Id[], done: (ids: Id[]) => void) {
  const dlg = document.createElement('dialog');
  dlg.setAttribute('aria-labelledby', 'perm-t');
  const list = members.filter(m => m.role !== 'dm' && m.role !== 'assistant' && m.role !== 'spectator');
  dlg.innerHTML = `<form method="dialog" style="display:grid;gap:12px"><h2 id="perm-t">${esc(title)}</h2><p class="sub">${esc(hint)}</p>`
    + (list.map(m => `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" value="${esc(m.id)}"${current.includes(m.id) ? ' checked' : ''}> ${esc(m.name)}</label>`).join('') || '<p class="sub">No hay jugadores en la mesa.</p>')
    + '<div style="display:flex;gap:8px"><button class="primary" value="ok">Guardar</button><button class="secondary" value="no">Cancelar</button></div></form>';
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok') done([...dlg.querySelectorAll<HTMLInputElement>('input:checked')].map(i => i.value));
    dlg.remove();
  });
  document.body.append(dlg);
  dlg.showModal();
}
