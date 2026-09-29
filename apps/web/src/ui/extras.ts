// Fase 11: todo lo que cuelga de la mesa sin tocar table.ts (que solo llama a mountExtras): dados 2D, repetir tiradas,
// emotes e «Interactuar», pestañas Compendio y Herramientas del DM, descansos pedidos, cerraduras, marcadores del diario,
// vista «como jugador» y resincronización automática con D&D Beyond.
import './extras.css';
import type { C2S, ChatMsg, ClientState, Die, Id, S2C, Token } from '@lantern/protocol';
import { net } from '../net.ts';
import type { Table } from '../render/api.ts';
import { getCharacter, linkAvailable } from '../link.ts';
import { prefersReducedMotion } from './a11y.ts';
import { mountCompendium } from './compendium.ts';
import { mountDmTools } from './dmtools.ts';
import { PENDING_CHAR } from './join.ts';
import { showHandout, syncDoc } from './journal.ts';
import { openRest } from './sheetx.ts';
import { selectTab } from './dock.ts';

type Welcome = Extract<S2C, { t: 'welcome' }>;
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input,textarea,select,dialog');
const DDB_POLL = 30_000;

export function mountExtras(root: HTMLElement, w: Welcome, table: Promise<Table>) {
  const me = w.memberId, staff = w.role === 'dm' || w.role === 'assistant', send = (m: C2S) => net.send(m);
  let state: ClientState = w.state, viewing: string | null = null, tableRef: Table | undefined;
  void table.then(t => { tableRef = t; });
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const mapa = $('#mapa'), key = () => localStorage.getItem(`lantern:key:${w.state.code}`);
  const toast = (m: string, ms = 3500) => { const t = $('#toast'); t.textContent = m; t.classList.remove('sel'); t.classList.add('show'); setTimeout(() => t.classList.remove('show'), ms); };
  const mine = () => state.scene.tokens.filter(t => t.owners.includes(me));

  // ---- pestañas ----
  const tablist = $('[role=tablist]'), body = $('#cuerpo');
  const addTab = (id: string, label: string) => {
    const tab = Object.assign(document.createElement('button'), { id: 't-' + id, textContent: label }), panel = Object.assign(document.createElement('div'), { id: 'p-' + id, className: 'ajustes' });
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', 'false'); tab.setAttribute('aria-controls', panel.id);
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); panel.hidden = true;
    tablist.append(tab); body.append(panel);
    tab.onclick = () => selectTab(id); // la zona (izq/der/abajo) donde esté la pestaña la gestiona dock.ts
    return panel;
  };
  mountCompendium(addTab('comp', 'Compendio'), { send, state: () => state, role: w.role, code: w.state.code, key, toast, table, mapEl: mapa });
  const tools = staff && w.role === 'dm' ? mountDmTools(addTab('dmx', 'Herramientas'), { send, state: () => state, code: w.state.code, key, toast, viewAs: id => viewAs(id), viewing: () => viewing }) : undefined;

  // ---- dados: 3D / 2D / ninguno ----
  type Mode = '3d' | '2d' | 'off';
  const d3 = $<HTMLButtonElement>('#d3d');
  let mode: Mode = d3.getAttribute('aria-checked') === 'false' ? 'off' : '3d';
  try { const v = localStorage.getItem('lantern.dados'); if (v === '3d' || v === '2d' || v === 'off') mode = v; } catch { /* sin almacenamiento */ }
  const sel = Object.assign(document.createElement('label'), { className: 'xd-mode', innerHTML: 'Dados <select><option value="3d">3D</option><option value="2d">2D (ligero)</option><option value="off">Ninguno</option></select>' });
  const modeSel = sel.querySelector('select')!;
  d3.after(sel); d3.hidden = true;
  const applyMode = () => {
    modeSel.value = mode;
    if ((d3.getAttribute('aria-checked') === 'true') !== (mode === '3d')) d3.click(); // el interruptor de table.ts gobierna el 3D
    try { localStorage.setItem('lantern.dados', mode); } catch { /* sin almacenamiento */ }
  };
  modeSel.onchange = () => { mode = modeSel.value as Mode; applyMode(); };
  applyMode();
  const dice2d = (dice: Die[], total?: number) => {
    const tray = Object.assign(document.createElement('div'), { className: 'xd-tray panel', role: 'status' });
    tray.innerHTML = dice.slice(0, 12).map(d => `<span class="xd${d.kept ? '' : ' xd-off'}" data-v="${d.value}" data-s="${d.sides}"><b>${d.sides}</b></span>`).join('') + (total !== undefined ? `<strong class="xd-tot">${total}</strong>` : '');
    root.append(tray);
    const faces = [...tray.querySelectorAll<HTMLElement>('.xd')];
    if (prefersReducedMotion()) faces.forEach(f => { f.textContent = f.dataset.v!; f.classList.add('fin'); });
    else {
      let n = 0;
      const iv = setInterval(() => {
        faces.forEach(f => { f.textContent = String(1 + Math.floor(Math.random() * +f.dataset.s!)); });
        if (++n >= 7) { clearInterval(iv); faces.forEach(f => { f.textContent = f.dataset.v!; f.classList.add('fin'); }); }
      }, 70);
    }
    setTimeout(() => tray.remove(), 2600);
  };

  // ---- tarjetas de tirada: repetir con Inspiración heroica / Suerte ----
  const log = $('#log');
  const onChat = (msg: ChatMsg) => {
    const el = log.lastElementChild as HTMLElement | null; // table.ts acaba de añadir este mensaje
    const r = msg.roll;
    if (r?.dice?.length && mode === '2d') dice2d(r.dice, r.total);
    if (msg.card?.dice?.length && mode === '2d') dice2d(msg.card.dice);
    if (!r || !el || msg.from !== me || r.external || r.blind || r.rerolled || !el.classList.contains('tirada')) return;
    const t = mine()[0], d20 = r.dice?.find(d => d.sides === 20 && d.kept);
    if (!t || !d20) return;
    const btns: [string, string, string][] = [];
    if (t.inspiration) btns.push(['inspiration', 'Inspiración heroica: repetir', 'Repite el d20 y te quedas con el nuevo resultado']);
    if (t.lucky && d20.value === 1) btns.push(['lucky', 'Suerte: repetir el 1', 'Rasgo Suerte: repites el 1 natural']);
    if (!btns.length) return;
    const bar = Object.assign(document.createElement('span'), { className: 'xr' });
    bar.innerHTML = btns.map(([k, l, tip]) => `<button type="button" data-k="${k}" title="${tip}">${l}</button>`).join('');
    bar.onclick = e => {
      const k = (e.target as HTMLElement).closest('button')?.dataset.k as 'inspiration' | 'lucky' | undefined;
      if (k) { send({ t: 'reroll', msgId: msg.id, kind: k, tokenId: t.id }); bar.remove(); }
    };
    el.append(bar);
  };

  // ---- emotes e interactuar ----
  const xe = Object.assign(document.createElement('div'), { className: 'xe', role: 'group' });
  xe.setAttribute('aria-label', 'Emotes rápidos');
  xe.innerHTML = ['👍', '❗', '❓'].map(e => `<button type="button" data-e="${e}" aria-label="Emote ${e}">${e}</button>`).join('') + '<button type="button" data-i title="Interactuar con lo que hay bajo tu token (E)">Interactuar</button>';
  $('#chat').after(xe);
  const interact = () => { const t = state.scene.tokens.find(k => k.owners.includes(me) && !k.hidden); if (t) send({ t: 'interact', tokenId: t.id }); };
  xe.onclick = e => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.dataset.e) send({ t: 'chat', text: b.dataset.e });
    else interact();
  };
  document.addEventListener('keydown', e => { if (e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.altKey && !e.metaKey && !typing(e.target) && w.role !== 'spectator') interact(); });

  // ---- cerradura: prueba de Atletismo o herramientas de ladrón ----
  const lockDialog = () => {
    const t = mine()[0], s = state.scene;
    if (!t) return;
    const near = s.walls.filter(x => x.kind === 'door' && x.locked && Math.hypot(t.x - (x.a.x + x.b.x) / 2, t.y - (x.a.y + x.b.y) / 2) <= 1.5 * s.grid.size)
      .sort((a, b) => Math.hypot(t.x - (a.a.x + a.b.x) / 2, t.y - (a.a.y + a.b.y) / 2) - Math.hypot(t.x - (b.a.x + b.b.x) / 2, t.y - (b.a.y + b.b.y) / 2))[0];
    if (!near) return;
    const dlg = document.createElement('dialog');
    dlg.setAttribute('aria-labelledby', 'lk-t');
    dlg.innerHTML = `<form method="dialog"><h2 id="lk-t">Puerta cerrada con llave</h2><p class="sub">Tira tú mismo contra la cerradura.</p>
      <div class="dmbtns"><button class="primary" value="athletics">Forzarla (Atletismo)</button><button value="thieves">Ganzúas (Destreza)</button></div><button class="secondary" value="">Dejarlo</button></form>`;
    document.body.append(dlg);
    dlg.addEventListener('close', () => { if (dlg.returnValue) send({ t: 'unlock', wallId: near.id, tokenId: t.id, tool: dlg.returnValue as 'athletics' | 'thieves' }); dlg.remove(); });
    dlg.showModal();
  };

  // ---- vista «como jugador» (solo DM) ----
  const banner = Object.assign(document.createElement('div'), { className: 'xv panel', hidden: true, role: 'status' });
  root.append(banner);
  const viewAs = (id: string | null) => {
    viewing = id;
    send({ t: 'asPlayer', memberId: id });
    if (!id) { banner.hidden = true; net.setFilter(undefined); return; }
    net.setFilter(m => { // los cambios reales de estado se sustituyen por el estado filtrado de ese jugador
      if (m.t !== 'state') return false;
      send({ t: 'asPlayer', memberId: viewing });
      return true;
    });
  };

  // ---- marcadores del diario ----
  const layer = Object.assign(document.createElement('div'), { className: 'xp-layer' });
  mapa.append(layer);
  const pinEls = new Map<Id, HTMLButtonElement>();
  let raf = 0;
  const tick = () => {
    raf = 0;
    const pins = state.scene.pins ?? [];
    for (const [id, el] of pinEls) if (!pins.some(p => p.id === id)) { el.remove(); pinEls.delete(id); }
    if (!pins.length || !tableRef) { if (pins.length) raf = requestAnimationFrame(tick); return; }
    const r = mapa.getBoundingClientRect();
    for (const p of pins) {
      let el = pinEls.get(p.id);
      if (!el) {
        el = Object.assign(document.createElement('button'), { type: 'button', className: 'xp-pin', textContent: '📍' });
        el.onclick = () => { const e = state.journal.find(x => x.id === p.entryId); if (e) showHandout(e); };
        layer.append(el); pinEls.set(p.id, el);
      }
      el.title = state.journal.find(x => x.id === p.entryId)?.title ?? '';
      el.setAttribute('aria-label', `Marcador: ${el.title}`);
      const c = tableRef.worldToClient(p.x, p.y);
      el.style.transform = `translate(${c.x - r.left}px, ${c.y - r.top}px)`;
    }
    raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf && (state.scene.pins?.length || pinEls.size)) raf = requestAnimationFrame(tick); };
  document.addEventListener('lantern:pin', ev => { // «Fijar en el mapa» desde el Diario: el siguiente clic en el mapa
    const entryId = (ev as CustomEvent<{ entryId: string }>).detail.entryId;
    toast('Haz clic en el mapa para fijar el marcador');
    mapa.addEventListener('click', async ce => {
      ce.stopImmediatePropagation(); ce.preventDefault();
      const t = await table, a = t.worldToClient(0, 0), b = t.worldToClient(1000, 1000);
      send({ t: 'pin', op: 'add', entryId, x: Math.round((ce.clientX - a.x) / ((b.x - a.x) / 1000)), y: Math.round((ce.clientY - a.y) / ((b.y - a.y) / 1000)) });
    }, { capture: true, once: true });
  });

  // ---- resincronización automática con D&D Beyond (solo cambios en D&D Beyond; lo que cambias en la mesa no se pisa) ----
  const seen = new Map<Id, string>();
  let polling = false;
  const poll = async () => {
    if (polling || document.hidden || viewing || w.role === 'spectator') return;
    const linked = mine().filter(t => t.ddb && t.ddb.id > 0);
    if (!linked.length) return;
    polling = true;
    try {
      const l = await linkAvailable();
      if (!l.ok || !l.loggedIn) return;
      for (const t of linked) try {
        const c = await getCharacter(t.ddb!.id), h = JSON.stringify(c), prev = seen.get(t.id);
        seen.set(t.id, h);
        if (prev !== undefined && prev !== h) { send({ t: 'importCharacter', tokenId: t.id, data: c }); toast(`${t.name} actualizado desde D&D Beyond`, 2500); }
      } catch { /* la extensión no responde: se reintenta en el siguiente sondeo */ }
    } finally { polling = false; }
  };
  const pollTimer = setInterval(() => void poll(), DDB_POLL);
  void poll();

  // ---- mensajes ----
  net.on(m => {
    if (m.t === 'welcome') { viewing = null; banner.hidden = true; state = m.state; kick(); }
    else if (m.t === 'state') { state = m.state; tools?.update(); kick(); }
    else if (m.t === 'chat') onChat(m.msg);
    else if (m.t === 'restRequest') openRest(m.kind, mine().filter(t => t.faction === 'ally'), send, `El DM propone un descanso ${m.kind === 'long' ? 'largo' : 'corto'}`);
    else if (m.t === 'docView') syncDoc(m);
    else if (m.t === 'asState') {
      if (m.memberId !== viewing) { if (m.memberId === null) net.emit({ t: 'state', state: m.state }); return; }
      const who = m.state.members.find(x => x.id === m.memberId)?.name ?? '';
      banner.hidden = false; banner.innerHTML = `Viendo como <strong>${esc(who)}</strong> <button type="button" class="secondary">Volver a mi vista</button>`;
      banner.querySelector('button')!.onclick = () => viewAs(null);
      net.emit({ t: 'state', state: m.state });
    } else if (m.t === 'error' && m.msg === 'cerrada con llave') lockDialog();
  });

  // ---- personaje elegido al entrar (pregenerado o JSON) ----
  try {
    const pending = sessionStorage.getItem(PENDING_CHAR);
    if (pending) {
      sessionStorage.removeItem(PENDING_CHAR);
      if (w.role === 'player' || w.role === 'trusted') send({ t: 'myChar', data: JSON.parse(pending) });
    }
  } catch { /* sin almacenamiento o JSON roto */ }
  kick();
  return { destroy() { clearInterval(pollTimer); cancelAnimationFrame(raf); } };
}
