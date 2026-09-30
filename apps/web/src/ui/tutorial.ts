import type { UiCtx } from './library.ts';
import { t } from '../i18n.ts';

// Una guía por rol; la del DM conserva la clave antigua para no volver a mostrarla a quien ya la vio.
const KEY = { dm: 'lantern:tutorial:done', player: 'lantern:tutorial:player' };
// [texto, selector del elemento que se resalta (vacío = ninguno)]
const steps = (dm: boolean): [string, string][] => dm ? [
  [t('Esta es tu mesa: arrastra el mapa, rueda para zoom'), '#mapa'],
  [t('Mueve un token: la regla te dice los pies'), '#mapa'],
  [t('Pestaña Escena: clima, historia y música'), '#t-esc'],
  [t('Pestaña Biblioteca: tus escenas e importar mapas'), '#t-biblioteca'],
  [t('Encuentros: añade monstruos, mira la dificultad y pulsa «Colocar en el mapa»'), '#t-encuentros'],
  [t('Invita: pulsa el código de arriba y compártelo'), '#cod'],
  [t('Ctrl+K abre la paleta de órdenes; «Repetir la guía» vuelve a mostrar esto'), ''],
] : [
  [t('Esta es la mesa: arrastra el mapa y usa la rueda (o pellizca) para acercar'), '#mapa'],
  [t('Arrastra tu token para moverte; la regla te dice los pies que llevas'), '#mapa'],
  [t('En combate, tus acciones salen abajo: elige una y después el objetivo'), '#hud'],
  [t('Pestaña Hoja: tu personaje, tiradas y el creador rápido'), '#t-hoja'],
  [t('Diario: lo que el DM comparta contigo'), '#t-dia'],
  [t('Botón X: pide parar la escena sin tener que explicar nada'), '.tarjeta-x'],
  [t('Ctrl+K abre la paleta de órdenes; «Repetir la guía» vuelve a mostrar esto'), ''],
];

let open: HTMLElement | null = null;

/** Guía de bienvenida. Sin `force`, solo la primera vez (por rol); los espectadores no la ven. */
export function startTutorial(ctx: UiCtx, force = false) {
  if (ctx.role === 'spectator' || open) return;
  const dm = ctx.role === 'dm' || ctx.role === 'assistant', key = KEY[dm ? 'dm' : 'player'], list = steps(dm);
  if (!force) try { if (localStorage.getItem(key)) return; } catch { /* sin almacenamiento: se muestra igual */ }
  let i = 0, ring: HTMLElement | null = null;
  const pop = open = document.createElement('div');
  pop.className = 'tut panel';
  pop.setAttribute('role', 'region'); pop.setAttribute('aria-label', t('Guía de bienvenida')); // no modal
  document.body.append(pop);

  const end = () => {
    ring?.classList.remove('tut-anillo'); pop.remove(); open = null;
    try { localStorage.setItem(key, '1'); } catch { /* nada */ }
  };
  function show() {
    ring?.classList.remove('tut-anillo');
    ring = list[i][1] ? document.querySelector<HTMLElement>(list[i][1]) : null;
    ring?.classList.add('tut-anillo');
    const last = i === list.length - 1;
    pop.innerHTML = `<small class="det">${t('Paso {i} de {n}', { i: i + 1, n: list.length })}</small>
      <p aria-live="polite">${list[i][0]}</p>
      <div class="bib-acc"><button type="button" class="primary" id="tut-ok">${last ? t('Terminar') : t('Siguiente')}</button>
      ${last ? '' : '<button type="button" class="secondary" id="tut-skip">' + t('Saltar') + '</button>'}</div>`;
    pop.querySelector('#tut-ok')!.addEventListener('click', () => { if (last) end(); else { i++; show(); } });
    pop.querySelector('#tut-skip')?.addEventListener('click', end);
    pop.querySelector<HTMLElement>('#tut-ok')!.focus();
  }
  show();
}
