// Copiloto IA: sugiere, nunca actúa solo. Todo texto de la IA entra con textContent.
import type { C2S, ClientState, CopilotTurn, Id, Role, S2C } from '@lantern/protocol';
import type { Table } from '../render/api.ts';
import type { RadialItem } from './radial.ts';

type Ctx = { state(): ClientState; send(m: C2S): void; role: Role; memberId: Id; table: Promise<Table>; toast(msg: string): void };
type Msg = Extract<S2C, { t: 'copilot' }>;
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
const rid = () => crypto.randomUUID();

export function mountCopilot(root: HTMLElement, ctx: Ctx) {
  const dm = ctx.role === 'dm';
  const pending = new Map<string, (m: Msg) => void>();
  const busyEls = new Set<HTMLElement>();
  let card: HTMLElement | undefined;
  const enabled = () => ctx.state().copilot;

  // Envía con rid y espera la respuesta correlacionada.
  function ask(m: DistributiveOmit<Extract<C2S, { t: 'copilot' }>, 'rid'>, out: HTMLElement, done: (m: Msg & { ok: true }) => void, btn?: HTMLButtonElement) {
    const id = rid();
    out.setAttribute('aria-busy', 'true'); out.textContent = 'Pensando…';
    if (btn) btn.disabled = true;
    pending.set(id, r => {
      out.removeAttribute('aria-busy'); if (btn) btn.disabled = false;
      if (!r.ok) { out.textContent = ''; ctx.toast(`Copiloto: ${r.error}`); } else done(r);
    });
    ctx.send({ ...m, rid: id } as C2S);
    busyEls.add(out);
  }

  // ---- panel ----
  const panel = document.createElement('section');
  panel.setAttribute('aria-labelledby', 'cop-h');
  const h = document.createElement('h3'); h.id = 'cop-h'; h.textContent = 'Copiloto';
  panel.append(h);
  const nota = (t: string) => { const p = document.createElement('p'); p.className = 'det'; p.textContent = t; return p; };
  const out = () => { const o = document.createElement('div'); o.className = 'cop-out'; o.setAttribute('role', 'status'); return o; };
  const tarjeta = (o: HTMLElement, text: string, extra?: HTMLElement) => {
    o.replaceChildren();
    const p = document.createElement('p'); p.className = 'cop-txt'; p.textContent = text;
    o.append(p, nota('IA · puede equivocarse'));
    if (extra) o.append(extra);
  };
  const field = (label: string, rows: number, max: number) => {
    const l = document.createElement('label'); l.textContent = label;
    const t = document.createElement('textarea'); t.rows = rows; t.maxLength = max;
    l.append(t); return [l, t] as const;
  };
  const btn = (text: string, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; if (cls) b.className = cls; return b; };

  // Reglas (todos)
  {
    const [l, t] = field('Pregunta de reglas', 2, 500);
    const b = btn('Preguntar', 'primary'), o = out();
    b.onclick = () => {
      const q = t.value.trim(); if (!q) return ctx.toast('Escribe la pregunta');
      ask({ t: 'copilot', op: 'rules', question: q }, o, r => tarjeta(o, r.text ?? '(sin respuesta)'), b);
    };
    panel.append(l, b, o);
  }
  if (dm) {
    // PNJ
    const [l, t] = field('Generar PNJ (describe al personaje)', 2, 500);
    const b = btn('Generar PNJ', 'primary'), o = out();
    b.onclick = () => {
      const p = t.value.trim(); if (!p) return ctx.toast('Describe al PNJ');
      ask({ t: 'copilot', op: 'npc', prompt: p }, o, r => {
        const text = r.text ?? '';
        const use = btn('Usar como PNJ que habla');
        use.onclick = () => {
          const { name, line } = parseNpc(text);
          const nn = document.getElementById('e-nn') as HTMLInputElement | null, nt = document.getElementById('e-nt') as HTMLTextAreaElement | null;
          if (nn && nt) { nn.value = name; nt.value = line; ctx.toast('Rellenado en «PNJ habla»; revísalo y pulsa «Hacer hablar»'); }
          else ctx.send({ t: 'npcSay', name, text: line });
        };
        tarjeta(o, text, use);
      }, b);
    };
    panel.append(l, b, o);
    // Crónica
    const rb = btn('Crónica de la sesión'), ro = out();
    rb.onclick = () => {
      if (!confirm('¿Generar la crónica y añadirla al diario? Puede tardar un poco.')) return;
      ask({ t: 'copilot', op: 'recap' }, ro, r => { tarjeta(ro, r.text ?? ''); ctx.toast('Crónica enviada al diario'); }, rb);
    };
    panel.append(rb, ro);
  }
  const sync = () => { panel.hidden = !enabled(); };
  root.append(panel); sync();

  // ---- turno de monstruo ----
  function closeCard() { card?.remove(); card = undefined; void ctx.table.then(t => t.setMarks({ active: activeId(), targets: [] })); }
  const activeId = () => { const c = ctx.state().combat; return c?.order[c.turn]?.tokenId; };

  function showTurn(t: CopilotTurn) {
    const s = ctx.state(), tok = s.scene.tokens.find(x => x.id === t.tokenId);
    if (!tok) return ctx.toast('Copiloto: el token ya no existe');
    const act = tok.actions?.find(a => a.id === t.actionId);
    const names = t.targets.map(id => s.scene.tokens.find(x => x.id === id)?.name ?? '?');
    const desc = `${tok.name}: ${t.moveTo ? 'moverse aquí' + (act ? ' y ' : '') : ''}${act ? `atacar a ${names.join(', ') || 'nadie'} con ${act.name}` : t.moveTo ? '' : 'sin acción'} — ${t.rationale}`;
    void ctx.table.then(tb => tb.setMarks({ active: activeId(), targets: t.targets, ...(t.moveTo ? { area: { ...t.moveTo, radius: s.scene.grid.size / 2, color: '#E8A33D' } } : {}) }));
    card?.remove();
    card = document.createElement('div'); card.className = 'cop-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Turno sugerido por la IA');
    const p = document.createElement('p'); p.textContent = desc;
    const ok = btn('Aplicar', 'primary'), no = btn('Descartar');
    ok.onclick = () => {
      // El servidor procesa los mensajes en orden y valida cada uno; si rechaza el movimiento o la acción, sale su error.
      if (t.moveTo) ctx.send({ t: 'moveToken', id: t.tokenId, x: t.moveTo.x, y: t.moveTo.y });
      if (t.actionId) ctx.send({ t: 'act', tokenId: t.tokenId, actionId: t.actionId, targets: t.targets });
      closeCard();
    };
    no.onclick = closeCard;
    card.append(p, nota('IA · puede equivocarse'), ok, no);
    card.addEventListener('keydown', e => { if (e.key === 'Escape') { closeCard(); } });
    document.body.append(card); ok.focus();
  }

  return {
    update: sync, // opcional: llamar desde render(s) si `copilot` puede cambiar en caliente
    handle(m: Msg) {
      sync();
      const f = pending.get(m.rid); if (!f) return;
      pending.delete(m.rid);
      if (m.ok && m.turn) { showTurn(m.turn); busyEls.forEach(o => o.removeAttribute('aria-busy')); return; }
      f(m);
    },
    radialItems(tokenId: Id): RadialItem[] {
      const tok = ctx.state().scene.tokens.find(x => x.id === tokenId);
      if (!dm || !enabled() || tok?.faction !== 'enemy') return [];
      return [{ id: 'cop-turno', label: 'Sugerir turno (IA)', icon: 'spell', run() {
        const id = rid(); ctx.toast('Pensando…');
        pending.set(id, r => { if (!r.ok) ctx.toast(`Copiloto: ${r.error}`); });
        ctx.send({ t: 'copilot', op: 'monsterTurn', tokenId, rid: id });
      } }];
    },
  };
}

// Extrae nombre y frase de un texto libre: «Nombre: X», frase entre comillas, o la última línea.
function parseNpc(text: string): { name: string; line: string } {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const nm = /^\W*(?:nombre|name)\W*[:：]\s*(.+)$/i;
  const name = (lines.map(l => nm.exec(l)?.[1]).find(Boolean) ?? lines[0] ?? 'PNJ').replace(/[*_#"«»]/g, '').trim().slice(0, 60);
  const q = /[«"“]([^»"”]{3,})[»"”]/.exec(text);
  const line = (q?.[1] ?? lines[lines.length - 1] ?? text).replace(/^\W*(?:frase|voz|dice)\W*[:：]\s*/i, '').trim().slice(0, 500);
  return { name, line };
}
