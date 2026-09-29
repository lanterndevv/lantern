// Editor de escena (DM y asistente): barra de herramientas + inspector + diagnóstico.
//
// Montaje (en table.ts, solo si role es 'dm' o 'assistant'):
//   import { mountEditor } from './editor.ts';
//   const ed = mountEditor(toolbarEl, inspectorEl, { send, state: () => cur, table, role, memberId, toast });
//   // en cada estado recibido:            ed.update(state);
//   // en TableOptions.onMapClick(x, y):   if (ed.mapClick(x, y)) return;   // «Elegir destino» de teletransporte
// Solo hay que llamar a ed.mapClick: es la vía más simple (el renderer ya emite onMapClick con el clic en el suelo).
import type { Ability, C2S, ClientState, Light, Region, Role, Token, Wall, Weather } from '@lantern/protocol';
import { CONDITIONS } from '@lantern/rules';
import type { EditOp, EditTool } from '../render/api.ts';
import { SFX_LIST } from './sfx.ts';
import { WEATHER } from './story.ts';
import { t } from '../i18n.ts';
import { detectWalls } from '../render/walls-detect.ts';

export type EdCtx = {
  send(m: C2S): void; state(): ClientState;
  table: { setTool(t: EditTool): void; onEdit(cb: (op: EditOp) => void): void; previewWalls?(w: Wall[] | null): void }; // previewWalls: extra de Table (render/table.ts)
  role: Role; memberId: string; toast(msg: string): void;
};

type Kind = 'wall' | 'light' | 'region' | 'token';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input,textarea,select,dialog');

const REGION_KINDS: [Region['kind'], string][] = [['trap', t('Trampa')], ['difficult', t('Terreno difícil')], ['teleport', t('Teletransporte')], ['fog', t('Niebla')], ['darkness', t('Oscuridad')], ['sound', t('Sonido')], ['message', t('Mensaje')], ['weather', t('Clima')]];
const WALL_KINDS: [Wall['kind'], string][] = [['wall', t('Muro')], ['door', t('Puerta')], ['window', t('Ventana')], ['terrain', t('Terreno')], ['invisible', t('Invisible (bloquea la vista, no el paso)')], ['ethereal', t('Etéreo (bloquea el paso, no la vista)')]];
const TRIGGERS: [string, string][] = [['enter', t('Al entrar')], ['exit', t('Al salir')], ['interact', t('Al interactuar (tecla E)')], ['turnStart', t('Al empezar turno')], ['turnEnd', t('Al acabar turno')]];
const ACTIONS: [string, string][] = [['', '—'], ['silence', t('Silencio (sin conjuros verbales)')], ['doc', t('Mostrar documento')], ['scene', t('Cambiar de escena')], ['encounter', t('Activar encuentro')]];
const WALL_MODES = ['invisible', 'ethereal', 'oneway'];
const ABIL: [Ability, string][] = [['str', t('FUE')], ['dex', t('DES')], ['con', t('CON')], ['int', t('INT')], ['wis', t('SAB')], ['cha', t('CAR')]];
const DMG = [['', '—'], ['piercing', t('Perforante')], ['slashing', t('Cortante')], ['bludgeoning', t('Contundente')], ['fire', t('Fuego')], ['cold', t('Frío')], ['lightning', t('Rayo')], ['thunder', t('Trueno')], ['acid', t('Ácido')], ['poison', t('Veneno')], ['necrotic', t('Necrótico')], ['radiant', t('Radiante')], ['force', t('Fuerza')], ['psychic', t('Psíquico')]];
const TEMPLATES: [string, Partial<Region>][] = [
  [t('Foso con pinchos'), { kind: 'trap', name: t('Foso con pinchos'), hidden: true, save: { ability: 'dex', dc: 13 }, damage: '2d10', damageType: 'piercing', condition: 'prone' }],
  [t('Runa de alarma'), { kind: 'message', name: t('Runa de alarma'), hidden: true, once: true, text: t('Una runa se enciende bajo tus pies y suena una campana.'), sfx: 'bell' }],
  [t('Escalera'), { kind: 'teleport', name: t('Escalera'), hidden: false, to: undefined }], // sin `to`: cambia de planta en la misma posición
  [t('Corriente de agua'), { kind: 'difficult', name: t('Corriente de agua'), hidden: false }],
  [t('Silencio'), { kind: 'message', name: t('Zona de silencio'), hidden: false, action: 'silence' }],
  [t('Documento'), { kind: 'message', name: t('Documento'), hidden: true, trigger: 'interact', action: 'doc' }],
  [t('Emboscada'), { kind: 'message', name: t('Emboscada'), hidden: true, once: true, action: 'encounter' }],
];
const TOOLS: { id: string; label: string; key?: string; tool: EditTool | ((s: ClientState) => EditTool); icon: string }[] = [
  { id: 'none', label: t('Mesa'), key: 'Esc', tool: { tool: 'none' }, icon: '▦' },
  { id: 'select', label: t('Seleccionar'), key: 'V', tool: { tool: 'select' }, icon: '⌖' },
  { id: 'wall', label: t('Muro'), key: 'W', tool: { tool: 'wall', kind: 'wall' }, icon: '▬' },
  { id: 'door', label: t('Puerta'), key: 'D', tool: { tool: 'wall', kind: 'door' }, icon: '⌷' },
  { id: 'window', label: t('Ventana'), tool: { tool: 'wall', kind: 'window' }, icon: '▭' },
  { id: 'terrain', label: t('Terreno'), tool: { tool: 'wall', kind: 'terrain' }, icon: '≈' },
  { id: 'invisible', label: t('Muro invisible'), tool: { tool: 'wall', kind: 'wall' }, icon: '◌' }, // se dibuja como muro y el editor cambia el tipo al soltarlo
  { id: 'ethereal', label: t('Muro etéreo'), tool: { tool: 'wall', kind: 'wall' }, icon: '▨' },
  { id: 'oneway', label: t('Muro de una dirección (la vista solo se bloquea desde su lado izquierdo a→b)'), tool: { tool: 'wall', kind: 'wall' }, icon: '⇥' },
  { id: 'light', label: t('Luz'), key: 'L', tool: s => ({ tool: 'light', bright: ft2px(s, 20), dim: ft2px(s, 40), color: '#ffb85c' }), icon: '☀' },
  { id: 'region', label: t('Región'), key: 'G', tool: { tool: 'region', kind: 'trap' }, icon: '⬠' },
  { id: 'grid', label: t('Cuadrícula'), tool: { tool: 'grid' }, icon: '⌗' },
];
const ft2px = (s: ClientState, ft: number) => Math.round(ft * s.scene.grid.size / (s.scene.grid.feet || 5));
const px2ft = (s: ClientState, px: number) => Math.round(px * (s.scene.grid.feet || 5) / s.scene.grid.size);

// Esquema del muro a→b (horizontal): la flecha marca el lado desde el que SÍ bloquea la vista ('left' = el lado izquierdo de a→b, abajo en pantalla con a→b hacia la derecha).
const sideArrow = (side: Wall['oneWay']) => !side ? '' : `<svg viewBox="0 0 120 70" width="120" height="70" role="img" aria-label="${t('Bloquea la vista desde el lado {lado} de a a b', { lado: side === 'left' ? t('izquierdo') : t('derecho') })}" style="display:block">
  <line x1="10" y1="35" x2="110" y2="35" stroke="currentColor" stroke-width="4"/><path d="M110 35l-9-5v10z" fill="currentColor"/><text x="6" y="30" font-size="10" fill="currentColor">a</text><text x="106" y="30" font-size="10" fill="currentColor">b</text>
  <path d="M60 ${side === 'left' ? '64 v-18 m-5 6 l5 -6 l5 6' : '6 v18 m-5 -6 l5 6 l5 -6'}" fill="none" stroke="var(--ambar)" stroke-width="3"/></svg>`;

export function diagnostics(s: ClientState): string[] {
  const sc = s.scene, dark = sc.globalLight < 0.5;
  const blind = dark ? sc.tokens.filter(t => t.faction === 'ally' && !t.darkvision).length : 0;
  const n = (k: Wall['kind']) => sc.walls.filter(w => w.kind === k).length;
  const out: string[] = [];
  if (blind) out.push(t('{n} tokens aliados sin visión en la oscuridad en escena oscura', { n: blind }));
  out.push(t('{n} luces', { n: sc.lights.length }), t('Luz global {n} %', { n: Math.round(sc.globalLight * 100) }),
    t('{w} muros · {d} puertas · {v} ventanas · {l} luces · {r} regiones', { w: n('wall'), d: n('door'), v: n('window'), l: sc.lights.length, r: sc.regions?.length ?? 0 }));
  return out;
}

export function mountEditor(toolbarEl: HTMLElement, inspectorEl: HTMLElement, ctx: EdCtx) {
  let wallMode = '', active = 'none', sel: { kind: Kind; id: string } | null = null, picking = false, draft: Region | null = null, sig = '';
  const st = () => ctx.state();

  // ---- barra ----
  toolbarEl.classList.add('ed-bar');
  toolbarEl.setAttribute('role', 'toolbar'); toolbarEl.setAttribute('aria-orientation', 'vertical'); toolbarEl.setAttribute('aria-label', t('Herramientas de edición'));
  toolbarEl.innerHTML = TOOLS.map(x => {
    const tip = `${x.label}${x.key ? ` (${x.key})` : ''}`;
    return `<button type="button" data-t="${x.id}" aria-label="${tip}" title="${tip}" aria-pressed="${x.id === 'none'}"${x.id === 'region' ? ' aria-haspopup="true" aria-expanded="false"' : ''}><span aria-hidden="true">${x.icon}</span></button>`;
  }).join('') + `<div class="ed-sub" role="group" aria-label="${t('Tipo de región')}" hidden>${REGION_KINDS.map(([k, n]) => `<button type="button" data-rk="${k}">${n}</button>`).join('')}</div>`;
  const sub = toolbarEl.querySelector<HTMLElement>('.ed-sub')!, regBtn = toolbarEl.querySelector<HTMLElement>('[data-t=region]')!;
  const setSub = (on: boolean) => { sub.hidden = !on; regBtn.setAttribute('aria-expanded', String(on)); };
  const choose = (id: string, tool?: EditTool) => {
    const tl = TOOLS.find(x => x.id === id)!;
    active = id; picking = false; wallMode = WALL_MODES.includes(id) ? id : '';
    toolbarEl.querySelectorAll<HTMLElement>('[data-t]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === id)));
    ctx.table.setTool(tool ?? (typeof tl.tool === 'function' ? tl.tool(st()) : tl.tool));
    setSub(id === 'region');
  };
  toolbarEl.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.dataset.rk) { choose('region', { tool: 'region', kind: b.dataset.rk as Region['kind'] }); ctx.toast(t('Región: {n}', { n: b.textContent ?? '' })); }
    else if (b.dataset.t) choose(b.dataset.t);
  });
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey || typing(e.target)) return;
    if (active === 'grid' && e.key.startsWith('Arrow')) { e.preventDefault(); nudge(e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0, 0, e.shiftKey); return; }
    if (active === 'grid' && (e.key === '+' || e.key === '-')) { nudge(0, 0, e.key === '+' ? 1 : -1, e.shiftKey); return; }
    if (e.key === 'Escape') { if (picking) { picking = false; ctx.toast(t('Destino cancelado')); } else choose('none'); return; }
    const tl = TOOLS.find(x => x.key?.toLowerCase() === e.key.toLowerCase() && x.key.length === 1);
    if (tl) choose(tl.id);
  });

  // Ajuste fino de la calibración: flechas (1 px; Mayús 10) y +/− para el tamaño de casilla
  const nudge = (dx: number, dy: number, ds: number, big: boolean) => {
    const g = st().scene.grid, k = big ? 10 : 1, size = Math.min(400, Math.max(20, g.size + ds * (big ? 5 : 1))), wrap = (v: number) => ((v % size) + size) % size;
    ctx.send({ t: 'scene', patch: { grid: { size, offsetX: wrap(g.offsetX + dx * k), offsetY: wrap(g.offsetY + dy * k), feet: g.feet } } });
  };

  // ---- inspector ----
  inspectorEl.classList.add('ed-insp');
  inspectorEl.setAttribute('aria-label', t('Inspector'));
  inspectorEl.innerHTML = `<div class="ed-form"></div><footer class="ed-diag" aria-label="${t('Diagnóstico')}"></footer>`;
  inspectorEl.insertAdjacentHTML('beforeend', `<div class="ed-btns ed-nudge" role="group" aria-label="${t('Ajuste fino de la cuadrícula')}">
    <button type="button" data-n="-1,0,0" aria-label="${t('Cuadrícula a la izquierda')}">◀</button><button type="button" data-n="0,-1,0" aria-label="${t('Cuadrícula arriba')}">▲</button>
    <button type="button" data-n="0,1,0" aria-label="${t('Cuadrícula abajo')}">▼</button><button type="button" data-n="1,0,0" aria-label="${t('Cuadrícula a la derecha')}">▶</button>
    <button type="button" data-n="0,0,-1" aria-label="${t('Casilla más pequeña')}">−</button><button type="button" data-n="0,0,1" aria-label="${t('Casilla más grande')}">+</button>
    <small class="det">${t('Ajuste fino (Mayús = más). Con la herramienta Cuadrícula: flechas y +/−.')}</small></div>`);
  inspectorEl.querySelector('.ed-nudge')!.addEventListener('click', e => {
    const n = (e.target as HTMLElement).closest('button')?.dataset.n?.split(',').map(Number);
    if (n) nudge(n[0], n[1], n[2], (e as MouseEvent).shiftKey);
  });
  inspectorEl.insertAdjacentHTML('beforeend', `<div class="ed-btns ed-auto"><button type="button" data-auto="detect">${t('Detectar muros (beta)')}</button></div>`);
  const auto = inspectorEl.querySelector<HTMLElement>('.ed-auto')!;
  let found: Wall[] = [];
  const autoUi = () => { auto.innerHTML = found.length ? `<button type="button" class="primary" data-auto="ok">${t('Aceptar {n} muros', { n: found.length })}</button><button type="button" data-auto="no">${t('Descartar')}</button>` : `<button type="button" data-auto="detect">${t('Detectar muros (beta)')}</button>`; };
  auto.addEventListener('click', async e => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.auto, sc = st().scene;
    if (a === 'detect') {
      if (!sc.background) return ctx.toast(t('La escena no tiene imagen de fondo'));
      try {
        const img = new Image(); img.crossOrigin = 'anonymous'; img.src = sc.background; await img.decode();
        found = detectWalls(img, sc.grid, { width: sc.width, height: sc.height });
      } catch { return ctx.toast(t('No se pudo analizar la imagen')); }
      ctx.table.previewWalls?.(found); autoUi(); ctx.toast(found.length ? t('{n} muros detectados (vista previa)', { n: found.length }) : t('No se detectó ningún muro'));
    } else if (a === 'ok' || a === 'no') {
      const todo = a === 'ok' ? found : []; found = []; ctx.table.previewWalls?.(null); autoUi();
      for (let i = 0; i < todo.length; i += 50) { // lotes de 50 por tick
        for (const item of todo.slice(i, i + 50)) ctx.send({ t: 'upsert', kind: 'wall', item });
        await new Promise(r => setTimeout(r));
      }
      if (todo.length) ctx.toast(t('{n} muros añadidos', { n: todo.length }));
    }
  });
  const form = inspectorEl.querySelector<HTMLElement>('.ed-form')!, diag = inspectorEl.querySelector<HTMLElement>('.ed-diag')!;
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => form.querySelector<T>('#ed-' + id)!;
  const chk = (id: string, l: string, v?: boolean) => `<label class="chk"><input type="checkbox" id="ed-${id}"${v ? ' checked' : ''}> ${l}</label>`;
  const txt = (id: string, l: string, v: unknown, extra = '') => `<label>${l}<input id="ed-${id}" value="${esc(v)}" ${extra}></label>`;
  const opts = (list: readonly (readonly [string, string])[], cur?: string) => list.map(([k, n]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${n}</option>`).join('');
  const find = (): Wall | Light | Region | Token | undefined => {
    if (!sel) return; const sc = st().scene;
    return sel.kind === 'wall' ? sc.walls.find(x => x.id === sel!.id) : sel.kind === 'light' ? sc.lights.find(x => x.id === sel!.id)
      : sel.kind === 'region' ? sc.regions?.find(x => x.id === sel!.id) : sc.tokens.find(x => x.id === sel!.id);
  };
  const actions = (del: boolean) => `<div class="ed-btns"><button type="button" class="primary" data-a="save">${t('Guardar')}</button>${del ? `<button type="button" data-a="del">${t('Borrar')}</button>` : ''}</div>`;

  function render() {
    const it = find();
    if (!it || !sel) { form.innerHTML = `<p class="det">${t('Selecciona un muro, una luz, una región o un token con la herramienta Seleccionar (V).')}</p>`; return; }
    const s = st();
    let h = '';
    if (sel.kind === 'wall') {
      const w = it as Wall;
      h = `<h3>${t('Muro')}</h3><label>${t('Tipo')}<select id="ed-kind">${opts(WALL_KINDS, w.kind)}</select></label>${chk('open', t('Abierta'), w.open)}${chk('secret', t('Secreta'), w.secret)}${chk('locked', t('Con llave'), w.locked)}
        ${w.kind === 'door' ? txt('lockdc', t('CD de la cerradura (Atletismo o herramientas de ladrón; vacío = 15)'), w.lock?.dc ?? '', 'type="number" min="1" max="40"') : ''}
        <label>${t('Una dirección')}<select id="ed-oneway">${opts([['', t('No (bloquea desde ambos lados)')], ['left', t('Solo desde su izquierda (a→b)')], ['right', t('Solo desde su derecha (a→b)')]], w.oneWay ?? '')}</select></label>
        ${sideArrow(w.oneWay)}${w.oneWay ? `<button type="button" data-a="flip">${t('Invertir lado')}</button>` : ''}
        <label>${t('Nota del DM')}<textarea id="ed-note" rows="3">${esc(w.note)}</textarea></label>${actions(true)}`;
    } else if (sel.kind === 'light') {
      const l = it as Light;
      h = `<h3>${t('Luz')}</h3>${txt('bright', t('Luz brillante (pies)'), px2ft(s, l.bright), 'type="number" min="0"')}${txt('dim', t('Luz tenue (pies)'), px2ft(s, l.dim), 'type="number" min="0"')}
        <label>${t('Color')}<input id="ed-color" type="color" value="${esc(l.color)}"></label>
        <label>${t('Animación')}<select id="ed-anim">${opts([['none', t('Ninguna')], ['torch', t('Antorcha')], ['pulse', t('Pulso')]], l.anim ?? 'none')}</select></label>${actions(true)}`;
    } else if (sel.kind === 'region') {
      const r = draft ?? (it as Region), k = r.kind;
      h = `<h3>${t('Región')}</h3><div class="ed-tpl" role="group" aria-label="${t('Plantillas rápidas')}">${TEMPLATES.map(([n], i) => `<button type="button" data-tpl="${i}">${n}</button>`).join('')}</div>
        ${txt('name', t('Nombre'), r.name, 'maxlength="60"')}<label>${t('Tipo')}<select id="ed-kind">${opts(REGION_KINDS, k)}</select></label>
        ${chk('hidden', t('Oculta a los jugadores'), r.hidden)}${chk('once', t('Una sola vez'), r.once)}${chk('onlyAllies', t('Solo aliados'), r.onlyAllies)}
        <label>${t('Se dispara')}<select id="ed-trigger">${opts(TRIGGERS, r.trigger ?? 'enter')}</select></label>
        <label>${t('Acción extra')}<select id="ed-action">${opts(ACTIONS, r.action ?? '')}</select></label>`;
      if (r.action === 'doc') h += `<label>${t('Documento')}<select id="ed-docid">${opts([['', '—'], ...s.journal.map(e => [e.id, e.title] as [string, string])], r.docId ?? '')}</select></label><p class="det">${t('Se muestra a quien lo dispara y pasa a ser legible para él.')}</p>`;
      if (r.action === 'scene') h += `<label>${t('Escena de destino')}<select id="ed-sceneid">${opts([['', '—'], ...(s.library ?? []).map(l => [l.id, l.name] as [string, string])], r.sceneId ?? '')}</select></label>`;
      if (r.action === 'encounter') h += txt('enc', t('Etiqueta del encuentro (la misma que en los tokens ocultos)'), r.encounter ?? '', 'maxlength="40"');
      if (k === 'trap') h += `<label>${t('Salvación')}<select id="ed-sab">${opts(ABIL, r.save?.ability ?? 'dex')}</select></label>${txt('dc', t('CD'), r.save?.dc ?? 13, 'type="number" min="1" max="30"')}
        ${txt('dmg', t('Daño (dados)'), r.damage ?? '', 'placeholder="2d10"')}<label>${t('Tipo de daño')}<select id="ed-dt">${opts(DMG as [string, string][], r.damageType ?? '')}</select></label>
        <label>${t('Condición al fallar')}<select id="ed-cond">${opts([['', '—'], ...Object.entries(CONDITIONS).map(([k, v]) => [k, t(v)] as [string, string])], r.condition ?? '')}</select></label>`;
      if (k === 'teleport') h += `<label>${t('Planta de destino')}<select id="ed-tolevel">${opts([['', '—'], ...(s.scene.levels ?? []).map((l, i) => [l.id, l.name || (i ? t('Planta {n}', { n: i }) : t('Base'))] as [string, string])], r.toLevel ?? '')}</select></label><p class="det" role="status">${r.to ? t('Destino: {x}, {y}', { x: Math.round(r.to.x), y: Math.round(r.to.y) }) : t('Sin destino')}${picking ? t(' — haz clic en el mapa (Esc cancela)') : ''}</p><button type="button" data-a="pick"${picking ? ' aria-pressed="true"' : ''}>${t('Elegir destino')}</button>`;
      if (k === 'weather') { const w = r.weather ?? { kind: 'rain' as const, intensity: 0.6, wind: 0 }; h += `<label>${t('Clima de la zona')}<select id="ed-wk">${opts(WEATHER, w.kind)}</select></label>${txt('wi', t('Intensidad (0-100)'), Math.round(w.intensity * 100), 'type="number" min="0" max="100"')}${txt('ww', t('Viento (-100 a 100)'), Math.round(w.wind * 100), 'type="number" min="-100" max="100"')}<p class="det">${t('El clima se dibuja solo dentro de la región. «Despejado» crea una zona sin clima.')}</p>`; }
      if (k === 'message') h += `<label>${t('Texto')}<textarea id="ed-text" rows="3" maxlength="500">${esc(r.text)}</textarea></label>`;
      if (k === 'trap' || k === 'sound') h += `<label>${t('Sonido')}<select id="ed-sfx">${opts([['', '—'], ...SFX_LIST.map(([n, l]) => [n, l] as [string, string]), ...(SFX_LIST.some(x => x[0] === 'bell') ? [] : [['bell', t('Campana')] as [string, string]])], r.sfx ?? '')}</select></label>`;
      h += actions(true);
    } else {
      const tk = it as Token;
      const sn = tk.senses ?? {}, ft = (px?: number) => px ? px2ft(s, px) : '';
      h = `<h3>${esc(tk.name)}</h3>${chk('hidden', t('Oculto'), tk.hidden)}
        <fieldset><legend>${t('Ficha')}</legend>${txt('hpmax', t('PG máximos'), tk.hp?.max ?? '', 'type="number" min="0"')}${txt('ac', t('CA'), tk.ac ?? '', 'type="number" min="0"')}${txt('speed', t('Velocidad (pies)'), tk.speed ?? '', 'type="number" min="0"')}
          ${txt('init', t('Iniciativa (mod.)'), tk.initMod ?? '', 'type="number"')}<label>${t('Edición')}<select id="ed-edition">${opts([['', t('La de la mesa')], ['2014', '2014'], ['2024', '2024']], tk.edition ?? '')}</select></label>
          ${chk('lucky', t('Suerte (mediano): repite un 1'), tk.lucky)}${chk('inspiration', t('Inspiración heroica'), tk.inspiration)}
          ${txt('enc', t('Etiqueta de encuentro'), tk.encounter ?? '', `maxlength="40" placeholder="${t('p. ej. emboscada')}"`)}</fieldset>
        <fieldset><legend>${t('Sentidos (pies)')}</legend>${txt('dv', t('Visión en la oscuridad'), ft(tk.darkvision), 'type="number" min="0"')}${txt('bs', t('Vista ciega'), ft(sn.blindsight), 'type="number" min="0"')}
          ${txt('ts', t('Visión verdadera'), ft(sn.truesight), 'type="number" min="0"')}${txt('tr', t('Sentido de vibraciones'), ft(sn.tremorsense), 'type="number" min="0"')}${txt('ds', t('Visión del diablo'), ft(sn.devilsSight), 'type="number" min="0"')}</fieldset>
        <label>${t('Nota del DM')}<textarea id="ed-notes" rows="5">${esc(tk.notes)}</textarea></label>${actions(false)}`;
    }
    form.innerHTML = h;
  }

  // Lee el formulario de región a un objeto completo (parte del original o del borrador).
  function readRegion(base: Region): Region {
    const g = (id: string) => form.querySelector<HTMLInputElement>('#ed-' + id);
    const r: Region = { ...base, name: g('name')!.value.trim() || base.name, kind: g('kind')!.value as Region['kind'], hidden: g('hidden')!.checked, once: g('once')!.checked, onlyAllies: g('onlyAllies')!.checked };
    if (g('sab')) { r.save = { ability: g('sab')!.value as Ability, dc: +g('dc')!.value || 10 }; r.damage = g('dmg')!.value.trim() || undefined; r.damageType = g('dt')!.value || undefined; r.condition = g('cond')!.value || undefined; }
    if (g('wk')) r.weather = { kind: g('wk')!.value as Weather['kind'], intensity: Math.min(1, Math.max(0, (+g('wi')!.value || 0) / 100)), wind: Math.min(1, Math.max(-1, (+g('ww')!.value || 0) / 100)) };
    if (r.kind !== 'weather') delete r.weather;
    if (g('tolevel')) r.toLevel = g('tolevel')!.value || undefined;
    if (g('text')) r.text = g('text')!.value;
    if (g('sfx')) r.sfx = g('sfx')!.value || undefined;
    r.trigger = (g('trigger')!.value as Region['trigger']) === 'enter' ? undefined : g('trigger')!.value as Region['trigger'];
    r.action = (g('action')!.value || undefined) as Region['action'];
    r.docId = g('docid')?.value || undefined; r.sceneId = g('sceneid')?.value || undefined; r.encounter = g('enc')?.value.trim() || undefined;
    return r;
  }

  form.addEventListener('change', e => {
    const id = (e.target as HTMLElement).id;
    if ((id === 'ed-kind' || id === 'ed-action') && sel?.kind === 'region') { draft = readRegion(draft ?? (find() as Region)); render(); form.querySelector<HTMLElement>('#' + id)?.focus(); }
  });
  form.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button'); if (!b || !sel) return;
    const it = find(), s = st();
    if (b.dataset.tpl != null && sel.kind === 'region') {
      const [tn, tp] = TEMPLATES[+b.dataset.tpl], base = readRegion(draft ?? (it as Region));
      draft = { ...base, ...tp } as Region;
      if (tn === t('Escalera')) { // destino por defecto: la planta de encima (o la de debajo si es la última)
        const ls = s.scene.levels ?? [], i = Math.max(0, ls.findIndex(l => l.id === base.level));
        draft.toLevel = (ls[i + 1] ?? ls[i - 1])?.id;
      }
      render(); ctx.toast(t('Plantilla aplicada; pulsa Guardar')); return;
    }
    if (b.dataset.a === 'pick') { draft = readRegion(draft ?? (it as Region)); picking = true; render(); ctx.toast(t('Haz clic en el mapa para fijar el destino')); return; }
    if (b.dataset.a === 'flip' && sel.kind === 'wall') { const w = it as Wall; ctx.send({ t: 'upsert', kind: 'wall', item: { ...w, oneWay: w.oneWay === 'left' ? 'right' : 'left' } }); return; }
    if (b.dataset.a === 'del') { ctx.send({ t: 'remove', kind: sel.kind as 'wall' | 'light' | 'region', id: sel.id }); sel = null; draft = null; render(); return; }
    if (b.dataset.a !== 'save' || !it) return;
    const num = (id: string) => Math.max(0, +$(id).value || 0);
    if (sel.kind === 'wall') {
      const w = it as Wall, note = $<HTMLTextAreaElement>('note').value.trim();
      const dc = form.querySelector<HTMLInputElement>('#ed-lockdc')?.value, ow = $<HTMLSelectElement>('oneway').value as Wall['oneWay'] | '';
      ctx.send({ t: 'upsert', kind: 'wall', item: { ...w, kind: $<HTMLSelectElement>('kind').value as Wall['kind'], open: $('open').checked, secret: $('secret').checked, locked: $('locked').checked, note: note || undefined,
        oneWay: ow || undefined, lock: $('locked').checked && dc ? { dc: Math.min(40, Math.max(1, +dc)) } : undefined } });
    } else if (sel.kind === 'light') {
      ctx.send({ t: 'upsert', kind: 'light', item: { ...(it as Light), bright: ft2px(s, num('bright')), dim: ft2px(s, num('dim')), color: $('color').value, anim: $<HTMLSelectElement>('anim').value as Light['anim'] } });
    } else if (sel.kind === 'region') {
      ctx.send({ t: 'upsert', kind: 'region', item: readRegion(draft ?? (it as Region)) }); draft = null;
    } else {
      const t = it as Token, n = (id: string) => { const v = $(id).value.trim(); return v === '' ? undefined : Math.max(0, +v || 0); };
      const px = (id: string) => { const v = n(id); return v ? ft2px(s, v) : undefined; }, sn = { darkvision: px('dv'), blindsight: px('bs'), truesight: px('ts'), tremorsense: px('tr'), devilsSight: px('ds') };
      const hpMax = n('hpmax'), init = $('init').value.trim();
      ctx.send({ t: 'upsert', kind: 'token', item: { ...t, hidden: $('hidden').checked, notes: $<HTMLTextAreaElement>('notes').value.trim() || undefined,
        darkvision: sn.darkvision ?? 0, senses: Object.fromEntries(Object.entries({ ...sn, darkvision: undefined }).filter(([, v]) => v)) as Token['senses'],
        hp: hpMax === undefined ? t.hp : { cur: Math.min(t.hp?.cur ?? hpMax, hpMax), max: hpMax, temp: t.hp?.temp ?? 0 }, ac: n('ac'), speed: n('speed'), initMod: init === '' ? undefined : +init || 0,
        edition: (($<HTMLSelectElement>('edition').value) || undefined) as Token['edition'], lucky: $('lucky').checked || undefined, inspiration: $('inspiration').checked || undefined, encounter: $('enc').value.trim() || undefined } });
    }
    ctx.toast(t('Guardado'));
  });

  // ---- EditOp → C2S ----
  ctx.table.onEdit(op => {
    if (op.op === 'upsert' && op.kind === 'wall' && wallMode && !st().scene.walls.some(w => w.id === op.item.id)) { // muro nuevo dibujado con una herramienta especial
      const item: Wall = wallMode === 'oneway' ? { ...op.item, oneWay: 'left' } : { ...op.item, kind: wallMode as Wall['kind'] };
      ctx.send({ t: 'upsert', kind: 'wall', item });
    } else if (op.op === 'upsert') ctx.send({ t: 'upsert', kind: op.kind, item: op.item } as C2S);
    else if (op.op === 'remove') ctx.send({ t: 'remove', kind: op.kind, id: op.id } as C2S);
    else if (op.op === 'grid') ctx.send({ t: 'scene', patch: { grid: { size: op.size, offsetX: op.offsetX, offsetY: op.offsetY, feet: st().scene.grid.feet } } });
    else { sel = op.kind && op.id ? { kind: op.kind, id: op.id } : null; draft = null; picking = false; sig = ''; render(); if (sel) form.querySelector<HTMLElement>('input,select,textarea')?.focus(); }
  });

  render();
  return {
    update(s: ClientState) {
      diag.innerHTML = diagnostics(s).map(l => `<div>${esc(l)}</div>`).join('');
      const it = find();
      if (sel && !it) { sel = null; draft = null; picking = false; render(); return; }
      const k = JSON.stringify(it ?? null) + s.scene.grid.size;
      if (k !== sig) { sig = k; if (!inspectorEl.contains(document.activeElement) && !draft) render(); }
    },
    /** Llamar desde onMapClick. Devuelve true si el clic se ha consumido como destino de teletransporte. */
    mapClick(x: number, y: number): boolean {
      if (!picking || !draft) return false;
      draft = { ...draft, to: { x: Math.round(x), y: Math.round(y) } }; picking = false; render(); ctx.toast(t('Destino fijado; pulsa Guardar'));
      return true;
    },
  };
}
