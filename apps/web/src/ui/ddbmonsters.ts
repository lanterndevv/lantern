import type { C2S } from '@lantern/protocol';
import type { LinkMonsterHit } from '@lantern/protocol/link';
import { getMonster, linkAvailable, searchMonsters } from '../link.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

/** Pestaña «Tu cuenta» del compendio (solo DM): monstruos de tu cuenta de D&D Beyond vía Lantern Link. Al servidor solo llegan estadísticas (spawnCustom). */
export function mountDdbMonsters(el: HTMLElement, ctx: { send(m: C2S): void; onMapClick(cb: ((x: number, y: number) => void) | null): void; toast(msg: string): void }) {
  el.innerHTML = `
    <input type="search" class="dm-q" placeholder="Buscar en tu cuenta de D&D Beyond" aria-label="Buscar monstruo de D&D Beyond">
    <label><input type="checkbox" class="dm-oculto"> Oculto</label>
    <p class="det dm-msg" role="status"></p>
    <ul class="dm-lista"></ul>`;
  const q = el.querySelector<HTMLInputElement>('.dm-q')!, msg = el.querySelector<HTMLElement>('.dm-msg')!, ul = el.querySelector<HTMLElement>('.dm-lista')!;
  const hidden = el.querySelector<HTMLInputElement>('.dm-oculto')!;
  let hits: LinkMonsterHit[] = [], n = 0, timer = 0;

  async function search() {
    const my = ++n, text = q.value.trim();
    if (text.length < 2) { hits = []; ul.innerHTML = ''; msg.textContent = ''; return; }
    const link = await linkAvailable();
    if (!link.ok) { msg.textContent = 'Falta la extensión Lantern Link (o esta página no está permitida).'; return; }
    if (!link.loggedIn) { msg.textContent = 'Inicia sesión en dndbeyond.com en este navegador.'; return; }
    try { const r = await searchMonsters(text); if (my !== n) return; hits = r; msg.textContent = r.length ? '' : 'Sin resultados en tu cuenta.'; }
    catch (e) { if (my === n) { hits = []; msg.textContent = (e as Error).message; } }
    if (my === n) ul.innerHTML = hits.map((h, i) => `<li>${esc(h.name)} <small>VD ${esc(h.cr)} · ${esc(h.type)}</small> <button type="button" data-i="${i}">Colocar</button></li>`).join('');
  }
  q.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(search, 350); });

  ul.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
    const h = b && hits[Number(b.dataset.i)];
    if (!h) return;
    try {
      const monster = await getMonster(h.id);
      ctx.toast(`Haz clic en el mapa para colocar a ${monster.name}.`);
      ctx.onMapClick((x, y) => { ctx.onMapClick(null); ctx.send({ t: 'spawnCustom', monster, x, y, hidden: hidden.checked }); });
    } catch (err) { ctx.toast((err as Error).message); }
  });
  return { update() {} };
}
