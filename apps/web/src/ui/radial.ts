import type { C2S, Member, Token } from '@lantern/protocol';
import { CONDITIONS } from '@lantern/rules';
import { pickMembers } from './perms.ts';
import './mobile.css';

export type RadialItem = { id: string; label: string; icon: string; disabled?: boolean; run(): void };

// Iconos en trazo (interior de un svg 24×24). `icon` de RadialItem puede ser una clave de aquí o markup propio.
export const ICONS: Record<string, string> = {
  attack: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/>',
  spell: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7L19 21l-.7-1.6-2-.7 2-.7z"/>',
  dodge: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  help: '<path d="M7 11V6a1.5 1.5 0 013 0v4m0-1V4.5a1.5 1.5 0 013 0V10m0-4a1.5 1.5 0 013 0v6m0-3a1.5 1.5 0 013 0v5a7 7 0 01-7 7h-1a6 6 0 01-5-3l-3-5a1.5 1.5 0 012.5-1.5L7 14"/>',
  disengage: '<path d="M5 12h12m-4-5 5 5-5 5M3 5v14"/>',
  status: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.5"/>',
  light: '<path d="M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  ping: '<circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="10"/>',
  hide: '<path d="M3 3l18 18M10.6 6.1A9 9 0 0121 12a13 13 0 01-3 3.9M6.6 6.6A13 13 0 003 12s3.5 6 9 6a8 8 0 003.4-.8"/>',
  show: '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="3"/>',
  notes: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
};

let last = { x: 0, y: 0 };
let close: (() => void) | undefined;

export function openRadial(clientX: number, clientY: number, items: RadialItem[], title?: string): void {
  close?.();
  last = { x: clientX, y: clientY };
  const opener = document.activeElement as HTMLElement | null;
  const n = items.length, B = 56;
  const R = Math.max(100, Math.ceil(n * (B + 10) / (2 * Math.PI)));
  const M = R + B / 2 + 8;
  const cx = Math.max(M, Math.min(innerWidth - M, clientX)); // reposiciona para no salirse
  const cy = Math.max(M, Math.min(innerHeight - M, clientY));

  const back = document.createElement('div');
  back.className = 'rad-fondo';
  const menu = document.createElement('div');
  menu.className = 'rad'; menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', title ? `Acciones de ${title}` : 'Acciones');
  menu.style.cssText = `left:${cx}px;top:${cy}px`;
  const centro = document.createElement('div');
  centro.className = 'rad-centro'; centro.setAttribute('aria-hidden', 'true');
  const idle = title ?? '';
  centro.textContent = idle;
  menu.append(centro);

  const btns = items.map((it, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'rad-item'; b.setAttribute('role', 'menuitem');
    b.disabled = !!it.disabled;
    b.style.cssText = `left:${Math.cos(a) * R}px;top:${Math.sin(a) * R}px`;
    b.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[it.icon] ?? it.icon}</svg><span>${it.label.replace(/[&<>]/g, c => `&#${c.charCodeAt(0)};`)}</span>`;
    const show = () => { centro.textContent = it.label; };
    b.onfocus = b.onmouseenter = show;
    b.onblur = b.onmouseleave = () => { centro.textContent = idle; };
    b.onclick = () => { done(false); it.run(); };
    menu.append(b);
    return b;
  });
  const live = () => btns.filter(b => !b.disabled);

  // Selección por gesto: con el botón (o el dedo) aún pulsado, arrastrar hacia un sector y soltar lo ejecuta.
  let hot = -1;
  const drag = (e: PointerEvent) => {
    if (!e.buttons) return;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    let h = -1;
    if (Math.hypot(dx, dy) > 36) {
      const a = (Math.atan2(dy, dx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI); // 0 = arriba, en sentido horario
      h = Math.round(a / (2 * Math.PI / n)) % n;
      if (btns[h].disabled) h = -1;
    }
    if (h === hot) return;
    hot = h;
    btns.forEach((b, i) => { b.style.filter = i === h ? 'brightness(1.5)' : ''; b.style.boxShadow = i === h ? '0 0 0 3px var(--ambar)' : ''; });
    centro.textContent = h >= 0 ? items[h].label : idle;
  };
  const release = () => { if (hot >= 0) { const it = items[hot]; done(false); it.run(); } };
  addEventListener('pointermove', drag);
  addEventListener('pointerup', release);

  const done = (restore = true) => {
    close = undefined;
    removeEventListener('pointermove', drag); removeEventListener('pointerup', release);
    removeEventListener('keydown', key, true);
    back.remove(); menu.remove();
    if (restore) opener?.isConnected && opener.focus?.();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return done(); }
    const l = live(); if (!l.length) return;
    const i = l.indexOf(document.activeElement as HTMLButtonElement);
    const to = (j: number) => { e.preventDefault(); l[(j + l.length) % l.length].focus(); };
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to(i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to(i < 0 ? 0 : i - 1);
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(-1);
    else if (e.key === 'Tab') to(i + (e.shiftKey ? -1 : 1)); // el foco no sale del menú
  };
  back.addEventListener('pointerdown', e => { e.preventDefault(); done(); });
  // El clic derecho que abre el menú dispara después su propio `contextmenu` sobre este fondo: ignorarlo (si no, se cierra al abrirse).
  const t0 = performance.now();
  back.addEventListener('contextmenu', e => { e.preventDefault(); if (performance.now() - t0 > 400) done(); });
  addEventListener('keydown', key, true);
  close = done;
  document.body.append(back, menu);
  live()[0]?.focus();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
    menu.animate([{ transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }], { duration: 120, easing: 'ease-out' });
}

export type RadialCtx = {
  role: string; memberId: string;
  send(m: C2S): void;
  arm(tokenId: string, actionId: string): void;   // deja el modo de apuntar, como pulsar la acción en el HUD
  openSheet(tokenId: string): void;               // hoja del token, en Condiciones
  ping(x: number, y: number): void;
  lit?(tokenId: string): boolean;                 // ¿ya tiene luz de antorcha? (por defecto: no)
  members?(): Member[];                           // miembros de la mesa (para conceder control de un token)
  grid?: number;                                  // px por casilla (por defecto 70), para el radio de la luz
};

export function tokenRadialItems(t: Token, c: RadialCtx): RadialItem[] {
  const dm = c.role === 'dm', own = t.owners.includes(c.memberId);
  const acts = t.actions ?? [];
  const atk = acts.find(a => a.kind === 'attack');
  // ponytail: «conjuro» = acción con slot definido (0 = truco) o que no es ataque; sin campo explícito de conjuro en Action
  const spells = acts.filter(a => a.slot != null || a.kind !== 'attack');
  const say = (verb: string) => () => c.send({ t: 'chat', text: `${t.name} ${verb}.` });
  const turn = (op: 'dodge' | 'dash' | 'disengage' | 'hide' | 'useObject') => c.send({ t: 'turnAction', tokenId: t.id, op });
  const luz = `luz-${t.id}`, lit = c.lit?.(t.id) ?? false, g = c.grid ?? 70;
  const it: RadialItem[] = [
    { id: 'attack', label: 'Atacar', icon: 'attack', disabled: !atk, run: () => atk && c.arm(t.id, atk.id) },
    { id: 'spell', label: 'Conjuro', icon: 'spell', disabled: !spells.length,
      run: () => openRadial(last.x, last.y, spells.map(a => ({
        id: a.id, label: a.name, icon: 'spell', run: () => c.arm(t.id, a.id),
      })), t.name) },
    { id: 'actions', label: 'Acción…', icon: 'dodge', disabled: !(dm || own), run: () => openRadial(last.x, last.y, [
      { id: 'dodge', label: 'Esquivar', icon: 'dodge', run: () => turn('dodge') },
      { id: 'dash', label: 'Correr', icon: 'disengage', run: () => turn('dash') },
      { id: 'disengage', label: 'Destrabarse', icon: 'disengage', run: () => turn('disengage') },
      { id: 'hide', label: 'Esconderse', icon: 'hide', run: () => turn('hide') },
      { id: 'object', label: 'Usar objeto', icon: 'notes', run: () => turn('useObject') },
      { id: 'help', label: 'Ayudar', icon: 'help', run: say('ayuda (Ayudar)') },
    ], t.name) },
    { id: 'conds', label: 'Condiciones…', icon: 'status', disabled: !(dm || own), run: () => openRadial(last.x, last.y, Object.entries(CONDITIONS).filter(([k]) => k !== 'dead').map(([k, n]) => {
      const on = t.conditions.includes(k);
      return { id: k, label: `${on ? '✓ ' : ''}${n}`, icon: on ? 'trash' : 'status', run: () => c.send({ t: 'condition', tokenId: t.id, condition: k, on: !on }) };
    }), t.name) },
    { id: 'status', label: 'Estado', icon: 'status', run: () => c.openSheet(t.id) },
  ];
  if (own || dm) it.push({ id: 'light', label: lit ? 'Apagar luz' : 'Luz', icon: 'light', run: () => lit
    ? c.send({ t: 'remove', kind: 'light', id: luz })
    // ponytail: una luz fija en su posición actual, no sigue al token
    : c.send({ t: 'upsert', kind: 'light', item: { id: luz, x: t.x, y: t.y, bright: 4 * g, dim: 8 * g, color: '#ffb85c', anim: 'torch' } }) });
  it.push({ id: 'ping', label: 'Ping', icon: 'ping', run: () => c.ping(t.x, t.y) });
  if (dm) it.push(
    { id: 'hide', label: t.hidden ? 'Mostrar' : 'Ocultar', icon: t.hidden ? 'show' : 'hide', run: () => c.send({ t: 'upsert', kind: 'token', item: { ...t, hidden: !t.hidden } }) },
    { id: 'owners', label: 'Controlan…', icon: 'status', run: () => pickMembers(`Quién controla a ${t.name}`, 'Pueden moverlo y actuar con él.', c.members?.() ?? [], t.owners, ids => c.send({ t: 'tokenOwners', tokenId: t.id, owners: ids })) },
    { id: 'notes', label: 'Notas', icon: 'notes', run: () => {
      const v = prompt(`Notas de ${t.name} (solo DM)`, t.notes ?? ''); // nativo y accesible
      if (v != null) c.send({ t: 'upsert', kind: 'token', item: { ...t, notes: v } });
    } },
    { id: 'del', label: 'Borrar', icon: 'trash', run: () => { if (confirm(`¿Borrar a ${t.name}?`)) c.send({ t: 'remove', kind: 'token', id: t.id }); } },
  );
  return it;
}
