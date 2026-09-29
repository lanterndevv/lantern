// Chat fase 9 A: susurros, en personaje (IC) y emotes.
import type { C2S, ChatMsg, ClientState, Id } from '@lantern/protocol';

export type ChatCtx = { send(m: C2S): void; state(): ClientState; me: Id; toast(msg: string): void };

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const sel: { as?: Id; to?: Id } = {}; // estado de los selectores (módulo único: un chat por página)
const mine = (c: ChatCtx) => c.state().scene.tokens.filter(t => t.owners.includes(c.me));

/** Miembro cuyo nombre abre `rest` (el más largo gana, para nombres con espacios). */
function memberAt(rest: string, c: ChatCtx) {
  const r = rest.toLowerCase();
  return c.state().members.filter(m => m.id !== c.me && (r === m.name.toLowerCase() || r.startsWith(m.name.toLowerCase() + ' ')))
    .sort((a, b) => b.name.length - a.name.length)[0];
}

/** Decide el C2S según comando y selectores. Devuelve false si no había nada que enviar. */
export function chatSendFromInput(text: string, c: ChatCtx): boolean {
  const v = text.trim(); if (!v) return false;
  const roll = /^\/(rs|r|tirar)\s+(.+)$/i.exec(v);
  if (roll) {
    const own = roll[2].includes('@') ? (mine(c).find(t => t.id === sel.as) ?? mine(c)[0]) : undefined; // @str, @prof… salen de este personaje
    c.send({ t: 'roll', expr: roll[2], ...(roll[1].toLowerCase() === 'rs' ? { secret: true } : {}), ...(own ? { as: own.id } : {}) }); return true;
  }
  const cmd = /^\/(w|me|ic)\s+(.+)$/is.exec(v);
  if (/^\/(w|me|ic)\b/i.test(v) && !cmd) { c.toast('Falta el texto del comando'); return false; }
  if (cmd) {
    const k = cmd[1].toLowerCase(), rest = cmd[2].trim();
    if (k === 'w') {
      const m = memberAt(rest, c);
      if (!m) { c.toast('Uso: /w nombre texto. No conozco a ese miembro'); return false; }
      const body = rest.slice(m.name.length).trim();
      if (!body) { c.toast('Escribe el texto del susurro'); return false; }
      c.send({ t: 'chat', text: body, to: [m.id] }); return true;
    }
    if (k === 'me') { c.send({ t: 'chat', text: rest, emote: true, ...(sel.as ? { as: sel.as } : {}), ...(sel.to ? { to: [sel.to] } : {}) }); return true; }
    const own = mine(c).find(t => t.id === sel.as) ?? mine(c)[0]; // /ic: token elegido o el principal (el primero)
    if (!own) { c.toast('No controlas ningún token'); return false; }
    c.send({ t: 'chat', text: rest, as: own.id, ...(sel.to ? { to: [sel.to] } : {}) }); return true;
  }
  c.send({ t: 'chat', text: v, ...(sel.as ? { as: sel.as } : {}), ...(sel.to ? { to: [sel.to] } : {}) });
  return true;
}

/**
 * Formato de un mensaje de texto. null = mensaje normal (usa el formato de siempre).
 * html ya va escapado; sustituye al contenido del div.msg.
 */
export function renderChatExtras(m: ChatMsg, name: (id: Id) => string): { cls: string; html: string } | null {
  if (m.loot) return { cls: 'msg botin', html: `<strong>${esc(m.loot.title)}</strong> <span class="det">botín</span><ul class="filas">${m.loot.lines.map(l => `<li><span class="obj">${esc(l.item)}</span>${l.to ? `<em class="res ok">→ ${esc(l.to)}</em>` : ''}</li>`).join('')}</ul>` };
  if (m.text == null || (!m.to?.length && !m.as && !m.emote)) return null;
  const from = esc(m.as ?? name(m.from)), text = esc(m.text);
  const whisper = m.to?.length ? `<em class="cx-susurro">susurro a ${esc(m.to.map(name).join(', '))}</em> ` : '';
  const cls = ['msg', m.to?.length ? 'susurro' : '', m.emote ? 'emote' : '', m.as && !m.emote ? 'ic' : ''].filter(Boolean).join(' ');
  if (m.emote) return { cls, html: `${whisper}<em class="cx-emote">* ${from} ${text} *</em>` };
  return { cls, html: `<span class="quien${m.as ? ' cx-ic' : ''}">${from}</span> ${whisper}${m.to?.length ? `<em>${text}</em>` : text}` };
}

/** Añade los selectores «Hablar como» y «Susurrar a» dentro del form del chat, antes del input. */
export function mountChat2(form: HTMLElement, c: ChatCtx) {
  const box = document.createElement('div');
  box.className = 'cx-sel';
  box.innerHTML = `<label>Hablar como<select id="cx-as"></select></label><label>Susurrar a<select id="cx-to"></select></label>`;
  form.prepend(box);
  const as = box.querySelector<HTMLSelectElement>('#cx-as')!, to = box.querySelector<HTMLSelectElement>('#cx-to')!;
  as.onchange = () => { sel.as = as.value || undefined; };
  to.onchange = () => { sel.to = to.value || undefined; };
  let sig = '';
  return {
    update(s: ClientState) {
      const toks = s.scene.tokens.filter(t => t.owners.includes(c.me)), others = s.members.filter(m => m.id !== c.me);
      const k = JSON.stringify([toks.map(t => [t.id, t.name]), others.map(m => [m.id, m.name]), sel]);
      if (k === sig) return; sig = k;
      if (sel.as && !toks.some(t => t.id === sel.as)) sel.as = undefined;
      if (sel.to && !others.some(m => m.id === sel.to)) sel.to = undefined;
      as.innerHTML = `<option value="">Tú (OOC)</option>` + toks.map(t => `<option value="${esc(t.id)}">${esc(t.name)} (IC)</option>`).join('');
      to.innerHTML = `<option value="">Todos</option>` + others.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
      as.value = sel.as ?? ''; to.value = sel.to ?? '';
    },
  };
}
