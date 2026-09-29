import { t } from '../i18n.ts';
import type { C2S, ClientState, ExtensionManifest, ExtensionPermission, Id, Role } from '@lantern/protocol';
import type { RadialItem } from '../ui/radial.ts';

export type ExtCtx = { state(): ClientState; send(m: C2S): void; role: Role; memberId: Id };

const PERMS: Record<ExtensionPermission, string> = {
  state: t('Leer el estado de la escena (tokens visibles para ti, ronda y turno)'),
  chat: t('Escribir en el chat como tú'),
  roll: t('Tirar dados como tú'),
  contextMenu: t('Añadir entradas al menú radial de los tokens'),
  panel: t('Cambiar la altura de su propio panel'),
  tokens: t('Mover tokens (solo los que tú podrías mover)'),
};
const RATE = 20;   // llamadas por segundo y extensión
const MAX_MENU = 10;

// Solo https, o http en localhost (desarrollo). Cualquier otra cosa (javascript:, data:, file:) se rechaza.
export function urlOk(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || (x.protocol === 'http:' && (x.hostname === 'localhost' || x.hostname === '127.0.0.1'));
  } catch { return false; }
}

// Lo que ve una extensión: solo lo que el servidor ya le mandó a este miembro. Sin key, sin memberIds, sin notas.
function publicState(s: ClientState) {
  const c = s.combat;
  return {
    scene: { id: s.scene.id, name: s.scene.name, width: s.scene.width, height: s.scene.height, gridSize: s.scene.grid.size },
    tokens: s.scene.tokens.map(t => ({ id: t.id, name: t.name, x: t.x, y: t.y, faction: t.faction, ...(t.hp ? { hp: { cur: t.hp.cur, max: t.hp.max } } : {}) })),
    ...(c ? { round: c.round, turnTokenId: c.order[c.turn]?.tokenId } : {}),
  };
}

type Ext = {
  key: string; m: ExtensionManifest; box: HTMLDetailsElement; frame: HTMLIFrameElement;
  ready: boolean; sub: boolean; menu: { id: string; label: string }[]; calls: number[];
};

export function mountExtensions(container: HTMLElement, ctx: ExtCtx) {
  const exts = new Map<string, Ext>();
  const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

  const reply = (e: Ext, id: number, r: { ok: unknown } | { error: string }) =>
    e.frame.contentWindow?.postMessage({ lantern: 'sdk', v: 1, re: id, ...r }, '*'); // origen opaco ('null') → '*'
  const emit = (e: Ext, event: string, data: unknown) =>
    e.frame.contentWindow?.postMessage({ lantern: 'sdk', v: 1, event, data }, '*');

  function handle(e: Ext, method: string, p: Record<string, unknown>): unknown {
    if (method === 'hello') {
      if (p.apiVersion !== 1) throw new Error(`apiVersion ${String(p.apiVersion)} no soportada (el host acepta 1)`);
      e.ready = true;
      return { apiVersion: 1, permissions: e.m.permissions };
    }
    if (!e.ready) throw new Error('falta el handshake (hello)');
    const need = ({ 'state.get': 'state', 'state.subscribe': 'state', 'chat.send': 'chat', roll: 'roll', 'contextMenu.add': 'contextMenu', 'panel.setHeight': 'panel', 'tokens.move': 'tokens' } as Record<string, ExtensionPermission>)[method];
    if (!need) throw new Error(`método desconocido: ${method}`);
    if (!e.m.permissions.includes(need)) throw new Error(`permiso «${need}» no concedido`);
    switch (method) {
      case 'state.get': return publicState(ctx.state());
      case 'state.subscribe': e.sub = true; return null;
      case 'chat.send':
        if (!isStr(p.text, 500)) throw new Error('text inválido');
        ctx.send({ t: 'chat', text: p.text }); return null;
      case 'roll':
        if (!isStr(p.expr, 100)) throw new Error('expr inválida');
        ctx.send({ t: 'roll', expr: p.expr, secret: p.secret === true }); return null;
      case 'contextMenu.add': {
        if (!isStr(p.id, 40) || !isStr(p.label, 40)) throw new Error('id/label inválidos');
        const i = e.menu.findIndex(x => x.id === p.id);
        if (i < 0 && e.menu.length >= MAX_MENU) throw new Error('demasiadas entradas');
        const it = { id: p.id, label: p.label };
        if (i < 0) e.menu.push(it); else e.menu[i] = it;
        return null;
      }
      case 'panel.setHeight':
        if (!isNum(p.px)) throw new Error('px inválido');
        e.frame.style.height = `${Math.max(40, Math.min(800, Math.round(p.px)))}px`; return null;
      default: // tokens.move
        if (!isStr(p.id, 80) || !isNum(p.x) || !isNum(p.y)) throw new Error('parámetros inválidos');
        ctx.send({ t: 'moveToken', id: p.id, x: p.x, y: p.y }); return null; // el servidor decide si puede moverlo
    }
  }

  window.addEventListener('message', ev => {
    // Solo responde al iframe de una extensión (comparando la ventana, no el origen: es opaco).
    const e = [...exts.values()].find(x => x.frame.contentWindow && x.frame.contentWindow === ev.source);
    const d = ev.data as { lantern?: unknown; v?: unknown; id?: unknown; method?: unknown; params?: unknown } | null;
    if (!e || !d || d.lantern !== 'sdk' || d.v !== 1 || typeof d.id !== 'number' || typeof d.method !== 'string') return;
    const now = Date.now();
    e.calls = e.calls.filter(t => now - t < 1000);
    if (e.calls.length >= RATE) return reply(e, d.id, { error: 'límite de llamadas superado (20/s)' });
    e.calls.push(now);
    try {
      const params = d.params && typeof d.params === 'object' ? d.params as Record<string, unknown> : {};
      reply(e, d.id, { ok: handle(e, d.method, params) });
    } catch (err) { reply(e, d.id, { error: err instanceof Error ? err.message : 'error' }); }
  });

  function add(m: ExtensionManifest) {
    const box = document.createElement('details'); box.className = 'ext-panel';
    const sum = document.createElement('summary'); sum.textContent = m.name;
    const frame = document.createElement('iframe');
    frame.className = 'ext-frame';
    frame.setAttribute('sandbox', 'allow-scripts allow-forms'); // SIN allow-same-origin: origen opaco, sin cookies ni storage de la mesa
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.title = t('Extensión {name}', { name: m.name });
    frame.src = m.url;
    box.append(sum, frame); container.append(box);
    exts.set(m.id, { key: JSON.stringify(m), m, box, frame, ready: false, sub: false, menu: [], calls: [] });
  }

  return {
    update(state: ClientState) {
      const want = new Map(state.extensions.filter(m => urlOk(m.url)).map(m => [m.id, m]));
      for (const [id, e] of exts) if (JSON.stringify(want.get(id)) !== e.key) { e.box.remove(); exts.delete(id); }
      for (const [id, m] of want) if (!exts.has(id)) add(m);
      const ps = publicState(state);
      for (const e of exts.values()) if (e.ready && e.sub && e.m.permissions.includes('state')) emit(e, 'state', ps);
    },
    radialItems(tokenId: Id): RadialItem[] {
      return [...exts.values()].filter(e => e.ready && e.m.permissions.includes('contextMenu')).flatMap(e =>
        e.menu.map(it => ({ id: `ext:${e.m.id}:${it.id}`, label: it.label, icon: 'notes', run: () => emit(e, 'contextMenu', { tokenId, itemId: it.id }) })));
    },
  };
}

// Instalador para el DM: descarga el manifiesto, muestra los permisos y solo instala tras confirmar.
export function openInstaller(ctx: ExtCtx): void {
  if (ctx.role !== 'dm') return;
  const dlg = document.createElement('dialog'); dlg.className = 'panel ext-inst';
  dlg.setAttribute('aria-label', t('Extensiones'));
  const cur = ctx.state().extensions;
  dlg.innerHTML = `<h2>${t('Extensiones')}</h2><ul class="ext-lista"></ul>
    <form><label>${t('URL del manifiesto (JSON)')}<input name="u" type="url" required placeholder="http://localhost:5174/manifest.json"></label><button type="submit">${t('Ver')}</button></form>
    <div class="ext-prev" aria-live="polite"></div><p class="err" role="alert"></p><button type="button" class="ext-cerrar">${t('Cerrar')}</button>`;
  const q = <T extends Element>(s: string) => dlg.querySelector<T>(s)!;
  const err = q<HTMLElement>('.err'), prev = q<HTMLElement>('.ext-prev'), ul = q<HTMLElement>('.ext-lista');
  cur.forEach(m => {
    const li = document.createElement('li'); li.textContent = `${m.name} ${m.version} `;
    const b = document.createElement('button'); b.type = 'button'; b.textContent = t('Quitar');
    b.onclick = () => { ctx.send({ t: 'extRemove', id: m.id }); li.remove(); };
    li.append(b); ul.append(li);
  });
  if (!cur.length) ul.innerHTML = '<li class="sub">' + t('Ninguna instalada.') + '</li>';
  q<HTMLButtonElement>('.ext-cerrar').onclick = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  q<HTMLFormElement>('form').onsubmit = async ev => {
    ev.preventDefault(); err.textContent = ''; prev.replaceChildren();
    try {
      const u = new URL(q<HTMLInputElement>('input').value);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(t('URL no válida'));
      const r = await fetch(u, { credentials: 'omit' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const m = await r.json() as ExtensionManifest;
      const perms = Array.isArray(m.permissions) ? m.permissions : [];
      if (!/^[a-z0-9-]{3,40}$/.test(String(m.id)) || typeof m.name !== 'string' || typeof m.version !== 'string' || !urlOk(String(m.url)) || perms.some(p => !(p in PERMS)))
        throw new Error(t('Manifiesto inválido (id, nombre, versión, url https/localhost o permisos desconocidos)'));
      const el = (s: string, txt: string, tag = 'p') => { const n = document.createElement(tag); n.className = s; n.textContent = txt; return n; };
      const lst = document.createElement('ul');
      perms.forEach(p => lst.append(el('', `${p}: ${PERMS[p]}`, 'li')));
      if (!perms.length) lst.append(el('', t('No pide ningún permiso'), 'li'));
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'primary'; ok.textContent = t('Instalar');
      ok.onclick = () => { ctx.send({ t: 'extInstall', manifest: { id: m.id, name: m.name, version: m.version, author: m.author, description: m.description, url: m.url, permissions: perms } }); dlg.close(); };
      prev.append(el('', m.name, 'h3'), el('sub', `${m.author ?? t('autor desconocido')} · v${m.version}`), el('', m.description ?? ''), el('sub', t('Cargará {url} en un iframe aislado. Permisos que pide:', { url: m.url })), lst, ok);
    } catch (e) { err.textContent = e instanceof Error ? e.message : t('No se pudo descargar el manifiesto'); }
  };
  document.body.append(dlg); dlg.showModal();
}
