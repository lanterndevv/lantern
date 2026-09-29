// Reloj del mundo junto al nombre de la escena + escena al aire libre + antorcha.
import { t } from '../i18n.ts';
import type { C2S, ClientState, Id, Token } from '@lantern/protocol';

type Ctx = { send(m: C2S): void; state(): ClientState; role: string };
const TORCH = { bright: 20, dim: 40 }; // pies (SRD: antorcha 20/20; aquí luz brillante 20 y tenue 40 como Luz de la vela)

export const clockText = (m: number) => {
  const d = Math.floor(m / 1440) + 1, h = Math.floor(m % 1440 / 60), mi = Math.floor(m % 60);
  return { day: d, time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, sun: h >= 6 && h < 20 };
};

export function mountClock(el: HTMLElement, c: Ctx) {
  const dm = c.role === 'dm';
  el.classList.add('rl');
  el.innerHTML = `<span class="rl-t" role="timer" aria-label="${t('Reloj del mundo')}"><span class="rl-i" aria-hidden="true"></span> <span class="rl-x"></span></span>` + (dm ? `
    <span class="rl-b"><button type="button" data-m="10">${t('+10 min')}</button><button type="button" data-m="60">${t('+1 h')}</button><button type="button" data-m="480" title="${t('Descanso largo')}">${t('+8 h')}<span class="sr"> (${t('descanso largo')})</span></button>
    <button type="button" data-m="?" aria-expanded="false">${t('Avanzar…')}</button>
    <form class="rl-f" hidden><label>${t('Minutos')}<input type="number" step="1" inputmode="numeric" required aria-describedby="rl-h"></label><small id="rl-h" class="det">${t('Negativo = retroceder')}</small><button type="submit">${t('Avanzar')}</button></form>
    <label class="chk"><input type="checkbox" class="rl-o" role="switch"> ${t('Escena al aire libre')}</label></span>` : '');
  const x = el.querySelector('.rl-x')!, ic = el.querySelector('.rl-i')!;
  if (dm) {
    const form = el.querySelector<HTMLFormElement>('.rl-f')!, more = el.querySelector<HTMLElement>('[data-m="?"]')!;
    el.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-m]'); if (!b) return;
      if (b.dataset.m === '?') { form.hidden = !form.hidden; more.setAttribute('aria-expanded', String(!form.hidden)); if (!form.hidden) form.querySelector('input')!.focus(); }
      else c.send({ t: 'clock', advance: +b.dataset.m! });
    });
    form.onsubmit = e => { e.preventDefault(); const n = Math.trunc(+form.querySelector('input')!.value); if (n) c.send({ t: 'clock', advance: n }); form.reset(); form.hidden = true; more.setAttribute('aria-expanded', 'false'); };
    // ponytail: patchScene del servidor puede no aceptar `outdoor` aún; si falla llega S2C error (toast de la mesa) y el interruptor vuelve solo con el siguiente estado.
    el.querySelector<HTMLInputElement>('.rl-o')!.onchange = e => c.send({ t: 'scene', patch: { outdoor: (e.target as HTMLInputElement).checked } as Extract<C2S, { t: 'scene' }>['patch'] });
  }
  return {
    update(s: ClientState) {
      const ck = clockText(s.clock);
      x.textContent = t('Día {d} · {h}', { d: ck.day, h: ck.time }); ic.textContent = ck.sun ? '☀' : '☾';
      ic.setAttribute('data-sun', String(ck.sun));
      const o = el.querySelector<HTMLInputElement>('.rl-o'); if (o) o.checked = !!s.scene.outdoor;
    },
  };
}

/**
 * «Encender antorcha (1 h)». Solo DM: upsert light es del DM en el servidor.
 * Para jugadores haría falta un C2S propio (p. ej. { t: 'torch'; tokenId }) validado por dueño.
 */
export function torchButton(tk: Token, c: Ctx): HTMLButtonElement | null {
  if (c.role !== 'dm') return null;
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = t('Encender antorcha (1 h)');
  b.onclick = () => {
    const s = c.state(), g = s.scene.grid, px = (ft: number) => ft / g.feet * g.size;
    c.send({ t: 'upsert', kind: 'light', item: { id: `luz-${tk.id}` as Id, x: tk.x, y: tk.y, bright: px(TORCH.bright), dim: px(TORCH.dim), color: '#ffb85c', anim: 'torch', follow: tk.id, burnUntil: s.clock + 60, ...(tk.level ? { level: tk.level } : {}) } });
  };
  return b;
}
