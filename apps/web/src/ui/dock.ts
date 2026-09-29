// Fase 9 B: panel lateral acoplable (izq/der) y pestañas Registro/Hoja/Diario en ventana aparte.
const KEY = 'lantern:dock';
const POP = ['reg', 'hoja', 'dia'] as const;
const NOMBRE: Record<string, string> = { reg: 'Registro', hoja: 'Hoja', dia: 'Diario' };

export function isPopout(): string | null {
  const p = new URLSearchParams(location.search).get('popout');
  return p && (POP as readonly string[]).includes(p) ? p : null;
}
const load = () => { try { return localStorage.getItem(KEY) === 'izq'; } catch { return false; } };

export function mountDock(root: HTMLElement) {
  const pop = isPopout();
  if (pop) { // ventana aparte: solo esa pestaña, a pantalla completa (el resto se oculta por CSS)
    root.classList.add('popout');
    root.querySelector<HTMLElement>('#t-' + pop)?.click();
    document.title = `${NOMBRE[pop]} · Lantern`;
    return;
  }
  const head = root.querySelector<HTMLElement>('#lado header'); if (!head) return;
  let izq = load();
  const a = document.createElement('button');
  a.type = 'button'; a.id = 'dock-lado';
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'dock-pop'; b.textContent = '⧉';
  const grp = document.createElement('div'); grp.className = 'dock-btns'; grp.append(a, b);
  head.insertBefore(grp, head.querySelector('#plegar'));

  const paint = () => {
    root.classList.toggle('dock-izq', izq);
    a.textContent = izq ? '⇥' : '⇤';
    a.setAttribute('aria-label', izq ? 'Acoplar el panel a la derecha' : 'Acoplar el panel a la izquierda');
    a.title = a.getAttribute('aria-label')!;
  };
  a.onclick = () => { izq = !izq; try { localStorage.setItem(KEY, izq ? 'izq' : 'der'); } catch { /* sin almacenamiento */ } paint(); };
  paint();

  const cur = () => (POP as readonly string[]).find(k => root.querySelector('#t-' + k)?.getAttribute('aria-selected') === 'true');
  const sync = () => {
    const k = cur();
    b.disabled = !k;
    b.setAttribute('aria-label', k ? `Separar ${NOMBRE[k]} en ventana` : 'Separar en ventana (elige Registro, Hoja o Diario)');
    b.title = b.getAttribute('aria-label')!;
  };
  new MutationObserver(sync).observe(head, { attributes: true, subtree: true, attributeFilter: ['aria-selected'] });
  sync();
  b.onclick = () => {
    const k = cur(); if (!k) return;
    const code = (root.querySelector('#cod')?.textContent ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    open(`/?popout=${k}&code=${code}`, `lantern-${k}`, 'popup,width=460,height=760');
  };
}
