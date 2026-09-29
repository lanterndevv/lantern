import type { UiCtx } from './library.ts';

const KEY = 'lantern:tutorial:done';
// Selectores (el orquestador puede ajustar los ids). Se prueba cada alternativa; si ninguna existe, el paso sale sin anillo.
const STEPS: [string, string][] = [
  ['Esta es tu mesa: arrastra el mapa, rueda para zoom', '.mapa'],
  ['Mueve un token: la regla te dice los pies', '.mapa'],
  ['Pestaña Escena: clima, historia y música', '#t-esc'],
  ['Pestaña Biblioteca: tus escenas e importar mapas', '#tab-biblioteca, #t-biblioteca'],
  ['Encuentros: arrastra monstruos del SRD', '#tab-encuentros, #t-encuentros'],
  ['Invita: pulsa el código de arriba y compártelo', '#cod'],
];

export function maybeStartTutorial(ctx: UiCtx) {
  if (ctx.role !== 'dm') return;
  try { if (localStorage.getItem(KEY)) return; } catch { /* sin almacenamiento: se muestra igual */ }
  let i = 0, ring: HTMLElement | null = null;
  const pop = document.createElement('div');
  pop.className = 'tut panel';
  pop.setAttribute('role', 'region'); pop.setAttribute('aria-label', 'Guía de bienvenida'); // no modal
  document.body.append(pop);

  const end = () => {
    ring?.classList.remove('tut-anillo'); pop.remove();
    try { localStorage.setItem(KEY, '1'); } catch { /* nada */ }
  };
  function show() {
    ring?.classList.remove('tut-anillo');
    ring = document.querySelector<HTMLElement>(STEPS[i][1]);
    ring?.classList.add('tut-anillo');
    const last = i === STEPS.length - 1;
    pop.innerHTML = `<small class="det">Paso ${i + 1} de ${STEPS.length}</small>
      <p aria-live="polite">${STEPS[i][0]}</p>
      <div class="bib-acc"><button type="button" class="primary" id="tut-ok">${last ? 'Terminar' : 'Siguiente'}</button>
      ${last ? '' : '<button type="button" class="secondary" id="tut-skip">Saltar</button>'}</div>`;
    pop.querySelector('#tut-ok')!.addEventListener('click', () => { if (last) end(); else { i++; show(); } });
    pop.querySelector('#tut-skip')?.addEventListener('click', end);
    pop.querySelector<HTMLElement>('#tut-ok')!.focus();
  }
  show();
}
