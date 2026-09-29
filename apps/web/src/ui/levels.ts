// Selector de planta (DM/assistant) o etiqueta de planta (jugadores).
//
// Montaje (en ui/table.ts, tras crear `table` y con un contenedor bajo la cabecera de escena; CSS: position:absolute; top-left):
//   import { mountLevels } from './levels.ts';
//   const lv = mountLevels($('levels'), { state: () => state, send: m => net.send(m), role: w.role, setLevel: (id, o) => table.setLevel(id, o), ownLevel: () => state.scene.tokens.find(t => t.owners.includes(w.memberId))?.level });
//   // en cada estado recibido, después de table.setState(state):   lv.update(state);
import type { C2S, ClientState, Role, Weather } from '@lantern/protocol';
import { WEATHER } from './story.ts';

export type LevelsCtx = {
  state(): ClientState; send(m: C2S): void; role: Role;
  setLevel(id?: string, o?: { ghostBelow?: boolean }): void; ownLevel(): string | undefined;
};
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function mountLevels(el: HTMLElement, ctx: LevelsCtx) {
  const staff = ctx.role === 'dm' || ctx.role === 'assistant';
  let cur: string | undefined, ghost = false, sig = '', sceneId = '';
  const list = (s: ClientState) => s.scene.levels ?? [];
  const nameAt = (s: ClientState, i: number) => list(s)[i]?.name || (i ? `Planta ${i}` : 'Base');
  const apply = (id?: string) => { cur = id; ctx.setLevel(id, { ghostBelow: ghost }); };

  el.classList.add('lv-bar');
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    const s = ctx.state(), ls = list(s), i = Math.max(0, ls.findIndex(l => l.id === cur)), a = b.dataset.a;
    if (b.dataset.lv != null) apply(ls[+b.dataset.lv]?.id);
    else if (a === 'add') {
      const first = ls.length ? [] : [{ id: crypto.randomUUID(), name: 'Base' }]; // la base implícita pasa a ser explícita; sus elementos sin `level` siguen en ella
      const nu = { id: crypto.randomUUID(), name: `Planta ${ls.length || 1}` };
      for (const l of [...first, nu]) ctx.send({ t: 'upsert', kind: 'level', item: l });
      apply(nu.id);
    } else if (a === 'ren' && ls[i]) {
      const n = prompt('Nombre de la planta', nameAt(s, i))?.trim();
      if (n) ctx.send({ t: 'upsert', kind: 'level', item: { id: ls[i].id, name: n.slice(0, 40) } });
    } else if (a === 'del' && ls.length > 1 && i > 0 && confirm(`¿Borrar «${nameAt(s, i)}»? Se borrará también todo lo que contiene (muros, luces, regiones y tokens).`)) {
      ctx.send({ t: 'remove', kind: 'level', id: ls[i].id }); apply(ls[i - 1].id);
    }
  });
  el.addEventListener('change', e => {
    const t = e.target as HTMLInputElement, s = ctx.state(), l = list(s).find(x => x.id === cur) ?? list(s)[0];
    if (t.id === 'lv-ghost') { ghost = t.checked; apply(cur); }
    else if (t.id === 'lv-w' && l) ctx.send({ t: 'upsert', kind: 'level', item: { id: l.id, name: l.name, weather: t.value ? { kind: t.value as Weather['kind'], intensity: l.weather?.intensity ?? 0.6, wind: l.weather?.wind ?? 0 } : null } }); // clima propio de la planta (vacío = el de la escena)
  });

  return {
    update(s: ClientState) {
      if (s.scene.id !== sceneId) { sceneId = s.scene.id; cur = undefined; ghost = false; sig = ''; } // escena nueva: planta base
      const ls = list(s);
      if (!staff) { // jugador: sigue a su token
        const own = ctx.ownLevel();
        if (own !== cur || sig === '') apply(own);
        const i = ls.findIndex(l => l.id === (own ?? ls[0]?.id));
        const k = ls.length > 1 ? nameAt(s, Math.max(0, i)) : '';
        if (k !== sig) { sig = k || ' '; el.textContent = k; el.hidden = !k; }
        return;
      }
      if (cur && !ls.some(l => l.id === cur)) apply(ls[0]?.id); // la planta actual ya no existe
      const i = Math.max(0, ls.findIndex(l => l.id === cur)), k = JSON.stringify([ls, i, ghost]);
      if (k === sig) return; sig = k;
      const n = Math.max(1, ls.length);
      el.hidden = false;
      el.innerHTML = `<div role="group" aria-label="Plantas">${Array.from({ length: n }, (_, j) => `<button type="button" data-lv="${j}" aria-pressed="${j === i}">${esc(nameAt(s, j))}</button>`).join('')}
        <button type="button" data-a="add" title="Añadir planta">+ Planta</button>
        ${ls.length ? `<button type="button" data-a="ren" title="Renombrar">Renombrar</button>` : ''}${i > 0 ? '<button type="button" data-a="del" title="Borrar planta">Borrar</button>' : ''}</div>
        <label class="chk"><input type="checkbox" id="lv-ghost"${ghost ? ' checked' : ''}> Ver planta inferior</label>
        ${ls.length ? `<label>Clima de la planta<select id="lv-w"><option value="">Como la escena</option>${WEATHER.map(([k, n]) => `<option value="${k}"${ls[i]?.weather?.kind === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}`;
    },
  };
}
