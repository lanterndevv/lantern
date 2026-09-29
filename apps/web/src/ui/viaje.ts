// Viaje por mapas del mundo (solo DM): escala en millas, ritmo de marcha y ruta medida con clics en el mapa.
// El servidor calcula el tiempo, avanza el reloj del mundo y tira los encuentros; aquí solo se previsualiza.
import type { C2S, ClientState, Point, TravelPace } from '@lantern/protocol';
import { PACE, pathLength, travelPlan } from '@lantern/protocol/travel';

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
type Ctx = { send(m: C2S): void; state(): ClientState; toast(m: string): void; onMapClick(cb: ((x: number, y: number) => void) | null): void; route?(pts: Point[]): void };
const NAMES: [TravelPace, string][] = [['slow', 'Lento (2 mi/h)'], ['normal', 'Normal (3 mi/h)'], ['fast', 'Rápido (4 mi/h)']];

export function mountTravel(el: HTMLElement, c: Ctx) {
  const sec = document.createElement('section');
  sec.setAttribute('aria-labelledby', 'vj-h'); sec.className = 'viaje';
  sec.innerHTML = `<h3 id="vj-h">Viaje</h3>
    <label>Millas por casilla<input type="number" min="0.1" max="1000" step="any" data-mi></label>
    <label>Ritmo<select data-pace>${NAMES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
    <label>Tabla de encuentros<select data-tab></select></label>
    <label>Encuentro con 1d20 ≥<input type="number" min="2" max="20" value="18" data-dc></label>
    <div class="dmbtns"><button type="button" data-a="mark" aria-pressed="false">Marcar ruta en el mapa</button><button type="button" data-a="undo">Quitar último punto</button><button type="button" class="primary" data-a="go">Viajar</button></div>
    <p class="det" role="status" data-out></p>`;
  el.append(sec);
  const q = <T extends HTMLElement>(s: string) => sec.querySelector<T>(s)!;
  let pts: Point[] = [], armed = false, sig = '';

  const out = () => {
    const s = c.state(), mi = s.scene.miles, pace = q<HTMLSelectElement>('[data-pace]').value as TravelPace;
    if (pts.length < 2) { q('[data-out]').textContent = `${pts.length} punto${pts.length === 1 ? '' : 's'}: marca al menos 2 en el mapa.`; return; }
    if (!mi) { q('[data-out]').textContent = 'Indica las millas por casilla de este mapa.'; return; }
    const miles = Math.round(pathLength(pts) / s.scene.grid.size * mi * 10) / 10, p = travelPlan(miles, pace);
    q('[data-out]').textContent = `${miles} mi · ${Math.floor(p.hours)} h ${Math.round(p.hours % 1 * 60)} min de marcha · ${p.days} jornada${p.days > 1 ? 's' : ''}${PACE[pace].note ? ` · ${PACE[pace].note}` : ''}`;
  };
  const click = (x: number, y: number) => { pts.push({ x, y }); c.route?.(pts); out(); if (armed) c.onMapClick(click); };
  const disarm = () => { armed = false; c.onMapClick(null); q('[data-a=mark]').setAttribute('aria-pressed', 'false'); };

  q<HTMLInputElement>('[data-mi]').onchange = e => { const v = +(e.target as HTMLInputElement).value; if (v > 0) c.send({ t: 'scene', patch: { miles: v } }); out(); };
  q('[data-pace]').onchange = out;
  sec.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a === 'mark') { armed = !armed; q('[data-a=mark]').setAttribute('aria-pressed', String(armed)); if (armed) c.onMapClick(click); else c.onMapClick(null); }
    else if (a === 'undo') { pts.pop(); c.route?.(pts); out(); }
    else if (a === 'go') {
      if (pts.length < 2) return c.toast('Marca la ruta en el mapa (2 puntos como mínimo)');
      const tableId = q<HTMLSelectElement>('[data-tab]').value;
      c.send({ t: 'travel', points: pts, pace: q<HTMLSelectElement>('[data-pace]').value as TravelPace, dc: +q<HTMLInputElement>('[data-dc]').value || 18, ...(tableId && { tableId }) });
      disarm(); pts = []; c.route?.([]); out();
    }
  });
  return {
    update(s: ClientState) {
      const mi = q<HTMLInputElement>('[data-mi]'); if (document.activeElement !== mi) mi.value = s.scene.miles ? String(s.scene.miles) : '';
      const tabs = s.journal.filter(e => e.table), k = JSON.stringify(tabs.map(e => [e.id, e.title]));
      if (k === sig) return; sig = k;
      const sel = q<HTMLSelectElement>('[data-tab]'), v = sel.value;
      sel.innerHTML = `<option value="">Sin tabla (solo el chequeo)</option>` + tabs.map(e => `<option value="${esc(e.id)}">${esc(e.title)}</option>`).join('');
      sel.value = tabs.some(e => e.id === v) ? v : '';
    },
  };
}
