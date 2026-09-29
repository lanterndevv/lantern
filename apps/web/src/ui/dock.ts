// Paneles acoplables (plan §4.9): zonas izquierda / derecha / abajo con pestañas movibles, plegado, redimensión,
// distribución guardada por usuario y ventana aparte. Cada pestaña es #t-<id> y su panel #p-<id> (los crean table.ts y extras.ts).
const KEY = 'lantern:dock2';
const POP = ['reg', 'hoja', 'mesa', 'esc', 'aj', 'dia', 'biblioteca', 'encuentros', 'pantalla', 'cuenta', 'comp', 'dmx']; // comp/dmx los crea mountPopoutExtras (extras.ts)
type Zona = 'izq' | 'der' | 'aba';
const ZONAS: Zona[] = ['izq', 'der', 'aba'];
const NOM: Record<Zona, string> = { izq: 'Izquierda', der: 'Derecha', aba: 'Abajo' };
type Lay = Partial<Record<Zona, string[]>> & { s?: Partial<Record<Zona, number>> };

export function isPopout(): string | null {
  const p = new URLSearchParams(location.search).get('popout');
  return p && POP.includes(p) ? p : null;
}

/** Activa una pestaña y muestra su panel; solo afecta a las hermanas de su zona. */
export function selectTab(id: string) {
  const t = document.getElementById('t-' + id); if (!t) return;
  t.parentElement?.querySelectorAll<HTMLElement>('[role=tab]').forEach(b => {
    const on = b === t;
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    const p = document.getElementById(b.getAttribute('aria-controls') ?? ''); if (p) p.hidden = !on;
  });
}

const btn = (txt: string, label: string, cls = '') => {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.className = cls;
  b.setAttribute('aria-label', label); b.title = label; return b;
};

export function mountDock(root: HTMLElement) {
  const pop = isPopout();
  const tabName = (id: string) => root.querySelector('#t-' + id)?.textContent ?? id;
  if (pop) { // ventana aparte: solo esa pestaña, a pantalla completa (el resto se oculta por CSS)
    root.classList.add('popout');
    root.querySelector<HTMLElement>('#t-' + pop)?.click();
    document.title = `${tabName(pop)} · Lantern`;
    return;
  }
  const der = root.querySelector<HTMLElement>('#lado'); if (!der) return;
  const head = der.querySelector('header')!;
  type Z = { z: Zona; el: HTMLElement; list: HTMLElement; body: HTMLElement; mv: HTMLButtonElement; pop: HTMLButtonElement };
  const Zs = {} as Record<Zona, Z>;
  const mk = (z: Zona, el: HTMLElement, list: HTMLElement, body: HTMLElement, hd: HTMLElement, fold?: HTMLElement) => {
    el.dataset.z = z; list.setAttribute('aria-label', 'Panel ' + NOM[z].toLowerCase());
    const mv = btn('⋮', 'Mover la pestaña activa a otra zona'), pp = btn('⧉', 'Separar en ventana', 'dock-pop');
    mv.setAttribute('aria-haspopup', 'menu');
    const grp = document.createElement('div'); grp.className = 'dock-btns'; grp.append(mv, pp);
    hd.insertBefore(grp, fold ?? null);
    const r = document.createElement('div'); r.className = 'dock-res'; r.tabIndex = 0; r.setAttribute('role', 'separator');
    r.setAttribute('aria-label', 'Redimensionar zona ' + NOM[z].toLowerCase()); r.setAttribute('aria-orientation', z === 'aba' ? 'horizontal' : 'vertical');
    el.append(r);
    Zs[z] = { z, el, list, body, mv, pop: pp };
    return r;
  };
  const resH = { der: mk('der', der, der.querySelector('[role=tablist]')!, der.querySelector('#cuerpo')!, head as HTMLElement, head.querySelector('#plegar')!) } as unknown as Record<Zona, HTMLElement>;
  for (const z of ['izq', 'aba'] as const) {
    const el = document.createElement('aside'); el.className = 'panel lado vacia'; el.id = 'lado-' + z;
    el.innerHTML = '<header><div role="tablist"></div><button type="button" class="dock-fold" aria-expanded="true" aria-label="Plegar zona">▾</button></header><div class="cuerpo"></div>';
    const hd = el.querySelector('header')!, f = el.querySelector<HTMLButtonElement>('.dock-fold')!;
    f.onclick = () => f.setAttribute('aria-expanded', String(!el.classList.toggle('plegado')));
    resH[z] = mk(z, el, el.querySelector('[role=tablist]')!, el.querySelector('.cuerpo')!, hd, f);
    der.after(el); // detrás de #lado: extras.ts sigue encontrando primero su lista de pestañas
  }

  // ---- distribución ----
  const seen: string[] = []; // ids en orden canónico
  const ids = () => [...root.querySelectorAll('[role=tab][id^="t-"]')].map(t => t.id.slice(2));
  const narrowQ = matchMedia('(max-width: 699px), (min-width: 700px) and (max-width: 1100px) and (pointer: coarse)');
  let lay: Lay = {};
  try { lay = JSON.parse(localStorage.getItem(KEY) ?? '{}') || {}; } catch { /* sin almacenamiento */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(lay)); } catch { /* sin almacenamiento */ } };
  const read = (): Lay => ({ ...Object.fromEntries(ZONAS.map(z => [z, [...Zs[z].list.querySelectorAll('[role=tab]')].map(t => t.id.slice(2))])), s: lay.s });
  const place = (id: string, z: Zona, before?: Element | null) => {
    const t = root.querySelector('#t-' + id), p = root.querySelector('#p-' + id); if (!t || !p) return;
    Zs[z].list.insertBefore(t, before ?? null); Zs[z].body.append(p); // refresh() reelige la pestaña activa de la zona de origen
  };
  const size = () => {
    const s = (z: Zona) => (Zs[z].el.classList.contains('vacia') ? 0 : z === 'aba' ? Zs[z].el.offsetHeight : Zs[z].el.offsetWidth) + 24;
    const on = (z: Zona) => !Zs[z].el.classList.contains('vacia') && !narrowQ.matches;
    root.classList.toggle('dock-izq', on('izq')); root.classList.toggle('dock-aba', on('aba'));
    root.style.setProperty('--izq-w', on('izq') ? s('izq') + 'px' : '0px');
    root.style.setProperty('--ab-h', on('aba') ? s('aba') + 'px' : '0px');
  };
  const apply = () => {
    const narrow = narrowQ.matches; // en móvil/tablet estrecho todo va a una sola hoja inferior con pestañas
    root.classList.toggle('dock-narrow', narrow);
    const all = seen.length ? seen : ids();
    const L: Lay = narrow ? { der: all } : lay;
    for (const z of ZONAS) for (const id of L[z] ?? []) place(id, z);
    for (const id of all) if (!ZONAS.some(z => L[z]?.includes(id))) place(id, 'der'); // sin sitio guardado (pestaña nueva)
    for (const z of ZONAS) { const v = L.s?.[z]; if (v && !narrow) Zs[z].el.style.setProperty('--zs', v + 'px'); else Zs[z].el.style.removeProperty('--zs'); }
    refresh();
  };
  const commit = () => { if (!narrowQ.matches) { lay = read(); save(); } refresh(); };

  // ---- estado visible ----
  const cur = (z: Z) => z.list.querySelector<HTMLElement>('[role=tab][aria-selected=true]:not([hidden])')?.id.slice(2);
  let busy = false;
  const refresh = () => {
    if (busy) return; busy = true;
    for (const id of ids()) if (!seen.includes(id)) { // pestaña tardía (extras.ts): a su zona guardada
      seen.push(id); const z = ZONAS.find(z => lay[z]?.includes(id)); if (z && !narrowQ.matches) place(id, z);
    }
    for (const z of Object.values(Zs)) {
      const tabs = [...z.list.querySelectorAll<HTMLElement>('[role=tab]')], vis = tabs.filter(t => !t.hidden);
      if (vis.length && !cur(z)) selectTab(vis[0].id.slice(2));
      tabs.forEach(t => { t.style.touchAction = 'none'; t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1; });
      z.el.classList.toggle('vacia', !vis.length);
      const k = cur(z);
      z.pop.disabled = !k || !POP.includes(k);
      z.pop.title = k ? `Separar ${tabName(k)} en ventana` : 'Separar en ventana'; z.pop.setAttribute('aria-label', z.pop.title);
    }
    size(); busy = false;
  };
  const mo = new MutationObserver(refresh);
  for (const z of Object.values(Zs)) mo.observe(z.list, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-selected'] });
  const ro = new ResizeObserver(size);
  for (const z of Object.values(Zs)) ro.observe(z.el);
  narrowQ.addEventListener('change', apply);

  // ---- teclado: flechas entre pestañas ----
  for (const z of Object.values(Zs)) z.list.addEventListener('keydown', e => {
    const tabs = [...z.list.querySelectorAll<HTMLElement>('[role=tab]:not([hidden])')], i = tabs.indexOf(e.target as HTMLElement);
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const n = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (n === undefined) return;
    e.preventDefault(); const t = tabs[(n + tabs.length) % tabs.length]; t.focus(); t.click();
  });

  // ---- menú «Mover a…» (alternativa accesible al arrastre) ----
  const menu = document.createElement('div'); menu.className = 'panel dock-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
  root.append(menu);
  let from: HTMLElement | null = null;
  const close = (foco = true) => { menu.hidden = true; if (foco) from?.focus(); };
  const openPop = (id: string) => {
    const code = (root.querySelector('#cod')?.textContent ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    open(`/?popout=${id}&code=${code}`, `lantern-${id}`, 'popup,width=460,height=760');
  };
  const openMenu = (id: string, anchor: HTMLElement) => {
    from = anchor; menu.replaceChildren();
    const here = ZONAS.find(z => Zs[z].list.contains(root.querySelector('#t-' + id)));
    const items: [string, () => void][] = [];
    if (!narrowQ.matches) for (const z of ZONAS) if (z !== here) items.push([`Mover ${tabName(id)} a ${NOM[z].toLowerCase()}`, () => { place(id, z); selectTab(id); commit(); }]);
    if (POP.includes(id)) items.push([`Ventana aparte`, () => openPop(id)]);
    items.push(['Restablecer distribución', () => { lay = {}; save(); apply(); }]);
    for (const [txt, fn] of items) {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = txt;
      b.onclick = () => { close(false); fn(); const t = root.querySelector<HTMLElement>('#t-' + id); (t?.offsetParent ? t : anchor).focus(); };
      menu.append(b);
    }
    menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8)) + 'px';
    menu.querySelector<HTMLElement>('button')?.focus();
  };
  menu.onkeydown = e => {
    const bs = [...menu.querySelectorAll<HTMLElement>('button')], i = bs.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus(); }
    else if (e.key === 'Tab') close(false);
  };
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target as Node)) close(false); });
  for (const z of Object.values(Zs)) {
    z.mv.onclick = () => { const k = cur(z); if (k) openMenu(k, z.mv); };
    z.pop.onclick = () => { const k = cur(z); if (k) openPop(k); };
    z.list.addEventListener('contextmenu', e => { // clic derecho o tecla Menú / Mays+F10 sobre una pestaña
      const t = (e.target as HTMLElement).closest<HTMLElement>('[role=tab]'); if (!t) return;
      e.preventDefault(); openMenu(t.id.slice(2), t);
    });
  }

  // ---- arrastrar pestañas entre zonas o sobre otra pestaña (pointer events: sirve con ratón y con el dedo) ----
  let drag: string | null = null;
  root.addEventListener('pointerdown', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[role=tab]');
    if (!t || narrowQ.matches || e.button !== 0) return;
    const id = t.id.slice(2), x0 = e.clientX, y0 = e.clientY;
    const move = (ev: PointerEvent) => { if (!drag && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) { drag = id; root.classList.add('dock-drag'); } };
    const end = (ev: PointerEvent) => {
      for (const [n, f] of [['pointermove', move], ['pointerup', end], ['pointercancel', end]] as const) document.removeEventListener(n, f as EventListener);
      if (!drag) return;
      drag = null; root.classList.remove('dock-drag');
      const mute = (c: Event) => c.stopPropagation(); // el arrastre no cuenta como clic
      document.addEventListener('click', mute, true); setTimeout(() => document.removeEventListener('click', mute, true), 50);
      if (ev.type === 'pointercancel') return;
      const under = document.elementFromPoint(ev.clientX, ev.clientY), zEl = under?.closest<HTMLElement>('[data-z]'), z = zEl && Zs[zEl.dataset.z as Zona];
      const over = under?.closest<HTMLElement>('[role=tab]');
      if (!z || over?.id === 't-' + id) return;
      place(id, z.z, over && z.list.contains(over) ? over : null); selectTab(id); commit();
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
  });

  // ---- redimensionar: arrastrar el borde (o flechas con el foco en él) ----
  const setS = (z: Z, px: number) => {
    const max = z.z === 'aba' ? innerHeight * .6 : Math.min(720, innerWidth * .5);
    const v = Math.round(Math.max(z.z === 'aba' ? 120 : 220, Math.min(max, px)));
    z.el.style.setProperty('--zs', v + 'px'); (lay.s ??= {})[z.z] = v;
  };
  for (const z of Object.values(Zs)) {
    const h = resH[z.z];
    h.onpointerdown = e => { e.preventDefault(); h.setPointerCapture(e.pointerId); };
    h.onpointermove = e => {
      if (!h.hasPointerCapture(e.pointerId)) return;
      const r = z.el.getBoundingClientRect();
      setS(z, z.z === 'izq' ? e.clientX - r.left : z.z === 'der' ? r.right - e.clientX : r.bottom - e.clientY);
    };
    h.onpointerup = () => { save(); size(); };
    h.onkeydown = e => { // el borde crece hacia el centro: izq →, der ←, abajo ↑
      const g = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: 1, ArrowDown: -1 }[e.key]; if (!g) return;
      e.preventDefault();
      setS(z, (z.z === 'aba' ? z.el.offsetHeight : z.el.offsetWidth) + 24 * g * (z.z === 'der' ? -1 : 1));
      save(); size();
    };
  }
  for (const id of ids()) seen.push(id);
  apply();
}
