import type { C2S, Action, ImportedCharacter, ActionCard, Ability, ChatMsg, ClientState, DiceTheme, Id, Member, MoveMode, Point, Role, S2C, Token } from '@lantern/protocol';
import { MONSTERS } from '@lantern/srd';
import type { Table, TableOptions } from '../render/api.ts';
import { net } from '../net.ts';
import { DICE } from '../dice/themes.ts';
import { ddbCharacterId } from '@lantern/protocol/link';
import { getCharacter, linkAvailable, sendGameLogRoll } from '../link.ts';
import { mountSheet, deathSavesHtml } from './sheet.ts';
import { mountSettings } from './settings.ts';
import { mountAudio, mountMixer, getVolume } from './audio.ts';
import { mountVoice } from './voice.ts';
import { mountStory, mountScenePanel } from './story.ts';
import { sfx } from './sfx.ts';
import { mountEditor } from './editor.ts';
import { mountJournal, showHandout, showRegionMsg } from './journal.ts';
import { mountLibrary, type UiCtx } from './library.ts';
import { mountEncounter } from './encounter.ts';
import { maybeStartTutorial } from './tutorial.ts';
import { openRadial, tokenRadialItems, type RadialItem } from './radial.ts';
import { mountChat2, chatSendFromInput, renderChatExtras } from './chat2.ts';
import { mountDraw, bindUndo } from './draw.ts';
import { mountClock, torchButton } from './clock.ts';
import { mountDmScreen } from './dmscreen.ts';
import { mountDdbMonsters } from './ddbmonsters.ts';
import { mountLasso } from './select.ts';
import { isPopout, mountDock, selectTab } from './dock.ts';
import { legendaryPips, bindLegendary, bindReorder, combatExtras, combatOptions, combat2RadialItems, pickToken, reactionPrompt, spellBanner, templateTargeting, tokenBar, turnReminder, moveRuler, acOf, hpText, type C2Ctx } from './combat2.ts';
import { mountExtensions, openInstaller } from '../ext/host.ts';
import { mountLevels } from './levels.ts';
import { mountCopilot } from './copilot.ts';
import { mountVoicesToggle, speakNpc } from './voices.ts';
import { mountBeyond20 } from '../beyond20.ts';
import { showLobby } from './lobby.ts';
import { mountSafety, handleSafety, checkProtocol } from './safety.ts';
import { mountCheckRequester, handleCheckRequest, handleSaveRequest, rollBadges, heroButton } from './checks.ts';
import { showSummary, sessionEndButton } from './summary.ts';
import { preload } from './transiciones.ts';
import { mountTravel } from './viaje.ts';
import { linkCurrentTable } from './account.ts';
import { mountPalette, defaultCommands } from './palette.ts';
import { applyDisplayMode, displayModeFromUrl } from './display.ts';
import { dmgColor, dmgIcon, dmgName, dmgSvg } from './dmgtypes.ts';
import { mountA11y, mountScreenReaderMirror, matchesShortcut } from './a11y.ts';

const ROLES: Record<Role, string> = { dm: 'DM', assistant: 'Asistente', trusted: 'De confianza', player: 'Jugador', spectator: 'Espectador' };
const PALETTE = ['#F5C877', '#5B9BE0', '#7FCB8A', '#E0643A', '#C79BF0', '#6FD3D3', '#F08AB4', '#E8E27A'];
const colorOf = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const HEAL = '#7FCB8A';
const AB: Record<Ability, string> = { str: 'FUE', dex: 'DES', con: 'CON', int: 'INT', wis: 'SAB', cha: 'CAR' };
const initials = (n: string) => n.split(/\s+/).map(x => x[0] ?? '').join('').slice(0, 2).toUpperCase();
let me = ''; // memberId propio, para pintar en dorado los tokens que controlas
const portrait = (t: Token, cls = '') =>
  `<span class="ret ${t.faction} ${t.owners.includes(me) ? 'mio' : ''} ${cls}" aria-hidden="true">${t.img ? `<img src="${esc(t.img)}" alt="">` : esc(initials(t.name))}</span>`;
const hpBar = (t: Token) => t.hp ? `<span class="hpbar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, t.hp.cur / t.hp.max * 100))}%"></i></span>` : '';

function cardHtml(c: ActionCard, canConfirm: boolean) {
  const col = c.kind === 'heal' ? HEAL : dmgColor(c.damageType);
  const rows = c.targets.map(t => {
    const a = t.attack, sv = t.save;
    const at = a ? `<span class="d20" title="d20 ${a.d20}${a.mode === 'normal' ? '' : a.mode === 'adv' ? ' (ventaja)' : ' (desventaja)'}">${a.d20}</span>
      <strong class="tot">${a.total}</strong>
      ${c.manual ? (a.d20 === 20 ? '<em class="res ok">20 natural</em>' : a.d20 === 1 ? '<em class="res ko">1 natural</em>' : '') : `<em class="res ${a.hit ? 'ok' : 'ko'}">${a.crit ? 'Crítico' : a.hit ? '¡Impacto!' : 'Fallo'}</em>`}` : '';
    const sa = sv ? `<span class="det">${AB[sv.ability]}${sv.dc != null ? ` CD ${sv.dc}` : ''}: <strong class="tot">${sv.total}</strong></span>
      ${c.manual ? '' : `<em class="res ${sv.success ? 'ok' : 'ko'}">${sv.success ? 'Supera' : 'Falla'}</em>`}` : c.awaiting?.includes(t.id) ? '<em class="det">tira su salvación…</em>' : '';
    const am = t.amount ? `<strong class="amt" style="color:${col}">${c.kind === 'heal' ? '+' : '−'}${t.amount}${c.kind === 'heal' ? '' : dmgIcon(c.damageType) + ' ' + esc(dmgName(c.damageType))}</strong>` : '';
    const cv = t.cover === 2 || t.cover === 5 ? `<span class="chip cob"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 1l6 2v5c0 3-2.5 5.5-6 7-3.5-1.5-6-4-6-7V3z" fill="currentColor"/></svg>Cobertura ${t.cover === 2 ? '½ (+2)' : '¾ (+5)'}</span>` : '';
    return `<li><span class="obj">${esc(t.name)}</span>${cv}${at}${sa}${am}</li>`;
  }).join('');
  const btns = c.pending && !c.applied && canConfirm
    ? `<div class="conf" data-p="${esc(c.pending)}"><button class="primary" data-m="full" type="button">Aplicar</button>
       <button data-m="half" type="button">Mitad</button>${c.manual ? '<button data-m="heal" type="button">Curar</button>' : ''}<button class="secondary" data-m="none" type="button">Nada</button></div>` : '';
  const st = c.applied ? '' : c.awaiting?.length ? '<em class="det">Esperando salvaciones de los jugadores</em>' : c.pending ? '<em class="det">Pendiente de confirmar</em>' : '';
  return `<div class="cab"><span class="quien">${esc(c.actorName)}</span> ${esc(c.actionName)}</div>
    <ul class="filas">${rows}</ul>${c.detail ? `<div class="det">${esc(c.detail)}</div>` : ''}${st}${btns}`;
}

export function mountTable(app: HTMLElement, w: Extract<S2C, { t: 'welcome' }>) {
  me = w.memberId;
  let state = w.state;
  let copilot: ReturnType<typeof mountCopilot> | undefined; // se monta más abajo; lo usan callbacks y render()
  const root = document.createElement('div');
  root.className = 'mesa';
  root.innerHTML = `
    <div class="mapa" id="mapa"></div>
    <div id="init" class="init panel" hidden></div>
    <div id="aviso" class="aviso" role="alert" aria-live="assertive"></div>
    <div id="hud" class="hud panel" hidden></div>
    <nav id="ed-bar" class="ed-bar panel" aria-label="Herramientas de edición" hidden></nav>
    <section id="ed-insp" class="ed-insp panel" aria-label="Inspector" hidden></section>
    <dialog id="elegir" aria-labelledby="elegir-t"><h2 id="elegir-t">Elige tu personaje</h2><ul id="libres" class="libres"></ul><button type="button" id="ddbc">Traer mi personaje de D&amp;D Beyond</button></dialog>
    <div id="lv" class="lv"></div>
    <div id="dr-bar" class="dr-bar"></div>
    <div class="panel tl">
      <h1 id="escena"></h1><span id="reloj"></span><span class="chip simple" id="simple" hidden>Modo Sencillo</span>
      <button class="chip" id="cod" type="button" title="Copiar enlace"></button>
      <span class="conn" id="conn"></span>
    </div>
    <aside class="panel lado" id="lado">
      <header>
        <div role="tablist" aria-label="Panel">
          <button role="tab" id="t-reg" aria-selected="true" aria-controls="p-reg">Registro</button>
          <button role="tab" id="t-hoja" aria-selected="false" aria-controls="p-hoja">Hoja</button>
          <button role="tab" id="t-mesa" aria-selected="false" aria-controls="p-mesa">Mesa</button>
          <button role="tab" id="t-esc" aria-selected="false" aria-controls="p-esc" hidden>Escena</button>
          <button role="tab" id="t-aj" aria-selected="false" aria-controls="p-aj" hidden>Ajustes</button>
          <button role="tab" id="t-dia" aria-selected="false" aria-controls="p-dia">Diario</button>
          <button role="tab" id="t-biblioteca" aria-selected="false" aria-controls="p-biblioteca" hidden>Biblioteca</button>
          <button role="tab" id="t-encuentros" aria-selected="false" aria-controls="p-encuentros" hidden>Encuentros</button>
          <button role="tab" id="t-pantalla" aria-selected="false" aria-controls="p-pantalla" hidden>Pantalla</button>
          <button role="tab" id="t-cuenta" aria-selected="false" aria-controls="p-cuenta" hidden>Tu cuenta</button>
        </div>
        <button id="plegar" type="button" aria-expanded="true" aria-controls="cuerpo" aria-label="Plegar panel">▾</button>
      </header>
      <div id="cuerpo">
        <div id="p-reg" role="tabpanel" aria-labelledby="t-reg">
          <div id="log" class="log" aria-live="polite" aria-label="Registro" tabindex="0"></div>
          <form id="chat">
            <label class="sr" for="txt">Mensaje o tirada</label>
            <input id="txt" autocomplete="off" placeholder="Mensaje, /r 1d20, /w nombre, /me, /ic" maxlength="500">
            <button class="primary" type="submit">Enviar</button>
          </form>
        <div id="exts"></div></div>
        <div id="p-hoja" role="tabpanel" aria-labelledby="t-hoja" class="hoja" hidden></div>
        <div id="p-esc" role="tabpanel" aria-labelledby="t-esc" class="ajustes escena" hidden></div>
        <div id="p-aj" role="tabpanel" aria-labelledby="t-aj" class="ajustes" hidden></div>
        <div id="p-dia" role="tabpanel" aria-labelledby="t-dia" class="ajustes" hidden></div>
        <div id="p-biblioteca" role="tabpanel" aria-labelledby="t-biblioteca" class="ajustes" hidden></div>
        <div id="p-encuentros" role="tabpanel" aria-labelledby="t-encuentros" class="ajustes" hidden></div>
        <div id="p-pantalla" role="tabpanel" aria-labelledby="t-pantalla" class="ajustes" hidden></div>
        <div id="p-cuenta" role="tabpanel" aria-labelledby="t-cuenta" class="ajustes" hidden></div>
        <div id="p-mesa" role="tabpanel" aria-labelledby="t-mesa" hidden>
          <ul id="miembros" class="miembros"></ul>
          <section id="voz" class="voz" aria-label="Voz"></section>
          <section id="mezcla" class="mezcla" aria-label="Mezclador de sonido"></section>
          <section id="copiloto" aria-label="Copiloto"></section><section id="voces" aria-label="Voces de PNJ"></section>
          <section id="mios" aria-label="Tu personaje"></section>
          <section class="dados" aria-label="Dados">
            <h2 id="sets-t">Tus dados</h2>
            <ul id="sets" class="sets" role="radiogroup" aria-labelledby="sets-t"></ul>
            <button id="d3d" type="button" role="switch" aria-checked="true">Ver dados 3D</button>
            <label id="glw" hidden><input id="gl" type="checkbox"> Enviar mis tiradas al Game Log de D&amp;D Beyond</label>
          </section>
          <section id="dm" class="dm" aria-label="Controles del DM" hidden>
            <div class="dmbtns" id="cbt">
              <button type="button" data-op="start">Empezar combate</button><button type="button" data-op="next">Siguiente turno</button>
              <button type="button" data-op="prev">Turno anterior</button><button type="button" data-op="undoTurn">Deshacer turno</button><button type="button" data-op="end">Terminar combate</button>
            </div>
            <button id="auto" type="button" aria-live="polite"></button>
            <div id="c2opts"></div>
            <label for="buscar">Buscar monstruo</label>
            <input id="buscar" type="search" autocomplete="off">
            <label class="chk"><input type="checkbox" id="oculto"> Oculto</label>
            <ul id="monstruos" class="monstruos"></ul>
          </section>
        </div>
      </div>
    </aside>
    <dialog id="ddb" aria-labelledby="ddb-t"><h2 id="ddb-t">Traer mi personaje de D&amp;D Beyond</h2>
      <form id="ddbf"><label>Enlace o id del personaje<input id="ddbid" autocomplete="off" placeholder="dndbeyond.com/characters/12345678" required></label>
        <p id="ddbst" role="status"></p><div id="ddbprev"></div>
        <div class="dmbtns"><button class="primary" type="submit" id="ddbgo">Traer</button><span id="ddbap"></span><button type="button" class="secondary" id="ddbno">Cancelar</button></div></form></dialog>
    <div id="toast" class="toast" role="status"></div>`;
  app.append(root);
  let tt = 0;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  // three.js (~550 kB) se carga aparte, sin retrasar la entrada a la mesa
  const popout = !!isPopout(); // ventana aparte: sin renderer ni dados 3D; las promesas de mesa/bandeja no resuelven nunca
  const trayP = popout ? new Promise<never>(() => {}) : import('../dice/dice3d.ts').then(d => d.createDiceTray($('mapa')));
  const name = (id: string) => state.members.find(m => m.id === id)?.name ?? '???';

  // Estado de interacción
  let selected: Id | undefined, targets: Id[] = [], armed: { tok: Id; a: Action } | undefined;
  let tpl: ReturnType<typeof templateTargeting> | undefined; // plantilla de área de la acción armada
  let drawApi: ReturnType<typeof mountDraw> | undefined, lasso: ReturnType<typeof mountLasso> | undefined; // se montan tras createTable; render() corre antes
  let mapCb: ((x: number, y: number) => void) | null = null;
  let spawn: string | undefined, pointer: Point | undefined, turnKey = '';
  const tok = (id?: Id) => state.scene.tokens.find(t => t.id === id);
  const mine = () => state.scene.tokens.filter(t => t.owners.includes(w.memberId));
  const activeId = () => state.combat?.order[state.combat.turn]?.tokenId;
  const hudTok = () => { const m = mine(); return m.find(t => t.id === selected) ?? m[0] ?? (w.role === 'dm' ? tok(selected) ?? tok(activeId()) : undefined); };
  const layerOn = (k: keyof ClientState['settings']['layers']) => state.settings.mode === 'full' && state.settings.layers[k];
  const canConfirm = w.role === 'dm' || w.role === 'assistant';
  const areaR = (a: Action) => a.area!.size / state.scene.grid.feet * state.scene.grid.size;
  const baseMarks = () => ({ active: activeId(), selected, targets });
  const marks = () => armed?.a.area && tpl && pointer ? tpl.pointer(pointer.x, pointer.y) : void table.then(t => t.setMarks(baseMarks()));
  const say = (msg: string, ms = 2000) => {
    const t = $('toast'); t.textContent = msg; t.classList.remove('sel'); t.classList.add('show');
    clearTimeout(tt); tt = window.setTimeout(() => t.classList.remove('show'), ms);
  };
  const fire = (tokenId: Id, actionId: Id, tg: Id[], extra?: { at: Point; dir?: Point }) => {
    net.send({ t: 'act', tokenId, actionId, targets: tg, ...extra });
    armed = undefined; targets = []; tpl?.cancel(); tpl = undefined; renderHud(); marks();
  };
  const atArea = (x: number, y: number) => tpl?.click(x, y);
  const cancel = () => {
    if (!armed && !spawn) return;
    tpl?.cancel(); tpl = undefined;
    armed = undefined; spawn = undefined; renderHud(); renderMonsters(); marks();
  };

  let ruler: ReturnType<typeof moveRuler> | undefined; // regla viva del arrastre (se monta tras createTable)
  let bar: ReturnType<typeof tokenBar> | undefined, co: ReturnType<typeof combatOptions> | undefined; // barra de token y opciones de combate (tras c2)
  // onDrag: el renderer avisa del arrastre con la ruta (inicio + puntos de paso + posición actual) para la regla viva; onMoveToken puede traer path/mode
  const tableOpts: Omit<TableOptions, 'onMoveToken'> & { onMoveToken(id: Id, x: number, y: number, path?: Point[], mode?: MoveMode): void; onDrag?(id: Id, points: Point[]): void } = {
    role: w.role, memberId: w.memberId,
    onDrag: (id, pts) => ruler?.drag(id, pts),
    onTokenClick: (id, shift) => {
      if (pickToken(id)) return;
      const t = tok(id); if (!t) return;
      if (armed?.a.area) return atArea(t.x, t.y);
      if (armed) {
        if (shift) { targets = [...new Set([...targets, id])]; marks(); return; }
        return fire(armed.tok, armed.a.id, [...new Set([...targets, id])]);
      }
      selected = id; targets = shift ? [...new Set([...targets, id])] : [id]; sheet.render();
      renderHud(); marks(); renderBar();
    },
    onMapClick: (x, y) => {
      if (ed?.mapClick(x, y)) return;
      if (mapCb) { const cb = mapCb; mapCb = null; return cb(x, y); }
      if (spawn) {
        net.send({ t: 'spawn', srd: spawn, x, y, ...($<HTMLInputElement>('oculto').checked ? { hidden: true } : {}) });
        spawn = undefined; renderMonsters();
      } else if (armed?.a.area) atArea(x, y);
      // ponytail: clic en el suelo sin acción no deselecciona; Esc o elegir otro token
    },
    onPointer: (x, y) => { pointer = { x, y }; drawApi?.pointer(x, y); if (armed?.a.area) tpl?.pointer(x, y); },
    onDraw: (d, persist) => drawApi?.onDraw(d, persist),
    onErase: id => drawApi?.onErase(id),
    onMoveToken: (id, x, y, path, mode) => {
      const r = ruler?.end(id);
      net.send({ t: 'moveToken', id, x, y, ...(path?.length ? { path } : r?.path?.length ? { path: r.path } : {}), ...(mode && mode !== 'walk' ? { mode } : r?.mode ? { mode: r.mode } : {}) });
    },
    onPing: (x, y) => net.send({ t: 'ping', x, y }),
    onTokenContext: (id, x, y) => { const t = tok(id); if (t) openRadial(x, y, [...tokenRadialItems(t, radialCtx), ...combat2RadialItems(t, c2), ...torchItem(t), ...(exts?.radialItems(id) ?? []), ...(copilot?.radialItems(id) ?? [])], t.name); },
    onDoor: (id, open) => net.send({ t: 'door', id, open }),
  };
  const table: Promise<Table> = popout ? new Promise(() => {}) : import('../render/table.ts').then(m => m.createTable($('mapa'), tableOpts));

  // ---- fase 5: edición, diario, biblioteca, encuentros, tutorial ----
  const ctx: UiCtx = { send: m => net.send(m), state: () => state, code: w.state.code, key: () => localStorage.getItem(`lantern:key:${w.state.code}`), role: w.role, toast: m => say(m, 3500), onMapClick: cb => { mapCb = cb; }, setTool: t => void table.then(x => x.setTool({ tool: t })) };
  const tableEd = { setTool: (t: Parameters<Awaited<typeof table>['setTool']>[0]) => void table.then(x => x.setTool(t)), onEdit: (cb: Parameters<Awaited<typeof table>['onEdit']>[0]) => void table.then(x => x.onEdit(cb)) };
  const staffEd = w.role === 'dm' || w.role === 'assistant';
  const ed = staffEd ? mountEditor($('ed-bar'), $('ed-insp'), { send: m => net.send(m), state: () => state, table: tableEd, role: w.role, memberId: w.memberId, toast: m => say(m, 3500) }) : undefined;
  $('ed-bar').hidden = !staffEd;
  const jr = mountJournal($('p-dia'), { send: m => net.send(m), state: () => state, role: w.role, memberId: w.memberId, toast: m => say(m, 3500) });
  const lib = staffEd ? mountLibrary($('p-biblioteca'), ctx) : undefined;
  const enc = staffEd ? mountEncounter($('p-encuentros'), ctx) : undefined;
  $('t-biblioteca').hidden = $('t-encuentros').hidden = !staffEd;
  maybeStartTutorial(ctx);

  const sheet = mountSheet($('p-hoja'), { role: w.role, memberId: w.memberId, code: w.state.code, key: () => localStorage.getItem(`lantern:key:${w.state.code}`), send: m => net.send(m), token: () => w.role === 'dm' ? tok(selected) ?? hudTok() : mine().find(t => t.id === selected) ?? mine()[0] });
  const staff = w.role === 'dm' || w.role === 'assistant';
  const settings = staff ? mountSettings($('p-aj'), m => net.send(m), w.memberId) : undefined;
  $('t-aj').hidden = !staff;
  mountMixer($('mezcla'));
  mountVoicesToggle($('voces'));
  copilot = mountCopilot($('copiloto'), { state: () => state, send: m => net.send(m), role: w.role, memberId: w.memberId, table, toast: m => say(m, 3500) });
  const voz = mountVoice($('voz'), { me: w.memberId, members: () => state.members, getVolume: () => getVolume('voz'), livekit: () => !!state.livekit });
  const audio = mountAudio(root, { own: () => mine()[0], walls: () => state.scene.walls, send: m => net.send(m) });
  const story = mountStory(root, $('mapa'), { isDm: w.role === 'dm', send: m => net.send(m) });
  const scenePanel = staff || w.role === 'trusted' ? mountScenePanel($('p-esc'), { role: w.role, code: w.state.code, send: m => net.send(m) }) : undefined;
  $('t-esc').hidden = !scenePanel;
  const travel = w.role === 'dm' ? mountTravel($('p-esc'), { ...ctx, route: p => void table.then(t => t.setRoute(p.length > 1 ? p : null)) }) : undefined; // viaje por mapas del mundo
  const c2: C2Ctx = { send: m => net.send(m), state: () => state, role: w.role, memberId: w.memberId, toast: m => say(m, 3500) };
  bindLegendary($('init'), c2);
  bindReorder($('init'), c2);
  if (!popout) { ruler = moveRuler(c2, () => table); bar = tokenBar(c2, () => table, () => selected); }
  if (w.role === 'dm') { co = combatOptions(c2); $('c2opts').append(co.el); }
  const extras = combatExtras(c2);
  root.append(extras.el);
  const chat2 = mountChat2($('chat'), { send: m => net.send(m), state: () => state, me: w.memberId, toast: m => say(m, 3500) });
  const clockCtx = { send: (m: C2S) => net.send(m), state: () => state, role: w.role };
  const clock = mountClock($('reloj'), clockCtx);
  const torchItem = (t: Token): RadialItem[] => {
    const b = torchButton(t, clockCtx); // solo DM; el botón se usa como fábrica de la acción
    return b ? [{ id: 'torch', label: 'Encender antorcha (1 h)', icon: 'light', run: () => b.click() }] : [];
  };
  bindUndo({ send: m => net.send(m), state: () => state, toast: m => say(m, 3500) });
  drawApi = mountDraw($('dr-bar'), { send: m => net.send(m), state: () => state, me: w.memberId, role: w.role, toast: m => say(m, 3500), table: () => table, onMapClick: cb => { mapCb = cb; } });
  void table.then(t => { lasso = mountLasso($('mapa'), { table: t, state: () => state, role: w.role, memberId: w.memberId, send: m => net.send(m), toast: m => say(m, 3500), onMapClick: cb => { mapCb = cb; } }); lasso.update(); });

  let exts: ReturnType<typeof mountExtensions> | undefined; // se monta más abajo; render() corre antes
  let lv: ReturnType<typeof mountLevels> | undefined, lobby: ReturnType<typeof showLobby> | undefined, cr: ReturnType<typeof mountCheckRequester> | undefined;
  const render = (s: ClientState) => {
    voz.onState(s.members); exts?.update(s); copilot?.update(); chat2.update(s); drawApi?.update(s); clock.update(s); extras.update(); lasso?.update();
    co?.update(s); ed?.update(s); jr.update(s); lib?.update(s); enc?.update(s); lv?.update(s); lobby?.update(); cr?.render();
    const was = new Map(state.scene.walls.filter(w => w.kind === 'door').map(w => [w.id, !!w.open]));
    for (const d of s.scene.walls) if (d.kind === 'door' && was.has(d.id) && was.get(d.id) !== !!d.open) { sfx(d.open ? 'door' : 'doorclose'); break; } // uno por cambio de estado
    state = s; paintGl();
    $('escena').textContent = s.scene.name;
    $('cod').textContent = `${s.code.slice(0, 3)}-${s.code.slice(3)}`;
    $('miembros').innerHTML = s.members.map((m: Member) =>
      `<li><span class="dot ${m.online ? 'on' : ''}" role="img" aria-label="${m.online ? 'Conectado' : 'Desconectado'}"></span>
       <span class="nom">${esc(m.name)}</span><span class="rol">${ROLES[m.role]}</span></li>`).join('');
    const mine3 = s.members.find(x => x.id === w.memberId)?.dice;
    $('sets').querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.th === mine3)));
    table.then(t => t.setState(s));
    if (selected && !tok(selected)) selected = undefined;
    targets = targets.filter(id => tok(id));
    if (armed && !tok(armed.tok)) armed = undefined;
    $('simple').hidden = state.settings.mode === 'full'; $('cbt').hidden = !layerOn('initiative');
    story.update(s); audio.update(s.audio); scenePanel?.render(s); travel?.update(s); sheet.render(); settings?.render(s); renderMios(); renderInit(); renderTurn(); renderHud(); renderDm(); renderClaim(); marks(); renderBar();
  };

  const camOn = () => { try { return localStorage.getItem('lantern.camturno') === '1'; } catch { return false; } };
  const renderInit = () => {
    const c = state.combat, el = $('init');
    el.hidden = !c || !layerOn('initiative');
    if (el.hidden || !c) return;
    const cur = c.order[c.turn], nxt = c.order.length > 1 && cur ? tok(c.order[(c.turn + 1) % c.order.length].tokenId) : undefined;
    const mineTurn = !!tok(cur?.tokenId)?.owners.includes(w.memberId), dm = w.role === 'dm';
    const hpTxt = (t: Token) => t.faction !== 'ally' && hpText(t) ? `<span class="c2-st ${t.hpState ?? ''}">${esc(hpText(t))}</span>` : '';
    el.innerHTML = `<span class="ronda">Ronda ${c.round}</span>${c.awaiting?.length ? '<span class="c2-sig">Esperando iniciativa…</span>' : ''}<ol>` + c.order.map((o, i) => {
      const t = tok(o.tokenId); if (!t) return '';
      const on = i === c.turn;
      return `<li class="${on ? 'act' : ''}" title="${esc(t.name)}" data-tid="${esc(t.id)}" data-i="${i}"${dm ? ' draggable="true"' : ''}${on ? ' aria-current="true"' : ''}>${portrait(t)}${hpBar(t)}${hpTxt(t)}${legendaryPips(t, w.role === 'dm')}<span class="sr">${esc(t.name)}${on ? ', turno activo' : ''}</span></li>`;
    }).join('') + '</ol>'
      + (nxt && !mineTurn ? `<span class="c2-sig">Siguiente: ${esc(nxt.name)}</span>` : '')
      + `<button type="button" class="chip" data-cam aria-pressed="${camOn()}" title="La cámara va al token cuando empieza tu turno">Cámara al turno</button>`;
  };
  $('init').addEventListener('click', e => {
    if (!(e.target as HTMLElement).closest('[data-cam]')) return;
    try { localStorage.setItem('lantern.camturno', camOn() ? '0' : '1'); } catch { /* sin almacenamiento */ }
    renderInit();
  });

  const renderTurn = () => {
    const id = activeId(), key = state.combat && id ? `${state.combat.round}:${id}` : '';
    if (key === turnKey) return;
    turnKey = key;
    const t = tok(id);
    if (!t || !t.owners.includes(w.memberId)) return;
    sfx('bell');
    if (camOn()) void table.then(tb => tb.focus(t.x, t.y));
    const a = $('aviso');
    a.textContent = `¡Tu turno, ${t.name}!`;
    a.classList.remove('show'); void a.offsetWidth; a.classList.add('show'); // reinicia la animación
    setTimeout(() => { a.classList.remove('show'); a.textContent = ''; }, 1600);
  };

  const armAction = (tokenId: Id, actionId: Id) => {
    const t = tok(tokenId), a = t?.actions?.find(x => x.id === actionId);
    if (!t || !a) return;
    if (armed?.a.id === a.id) return cancel();
    spawn = undefined; renderMonsters();
    if (!a.area && targets.length) return fire(t.id, a.id, targets);
    armed = { tok: t.id, a };
    tpl = a.area ? templateTargeting(a, { caster: t.id, state: () => state, table: { setMarks: m => void table.then(x => x.setMarks(m)) }, baseMarks, fire }) : undefined;
    renderHud(); marks();
    say(a.area ? `${a.name}: haz clic en el mapa` : `${a.name}: elige un objetivo`);
  };
  const pick = (i: number) => {
    const t = hudTok(), a = t?.actions?.[i];
    if (t && a && !$('hud').hidden) armAction(t.id, a.id);
  };

  const renderHud = () => {
    const t = hudTok(), el = $('hud');
    el.hidden = !t || !state.combat || !layerOn('initiative'); // ponytail: HUD solo en combate; acciones fuera de combate irán por el menú radial
    if (el.hidden || !t) return;
    const c = state.combat, u = c?.used[t.id];
    if (t.hp?.cur === 0 && t.deathSaves && c && activeId() === t.id && t.owners.includes(w.memberId)) {
      el.innerHTML = `${portrait(t)}<div class="info"><strong>${esc(t.name)}</strong><span>PG 0</span></div>${deathSavesHtml(t)}`;
      return;
    }
    const pill = (k: 'action' | 'bonus' | 'reaction' | 'object', n: string) =>
      `<button type="button" class="pill ${k}${u?.[k] ? ' gastada' : ''}" data-b="${k}" aria-pressed="${!!u?.[k]}" title="Clic: marcar como gastada o devolver"><i aria-hidden="true"></i>${n}${u?.[k] ? '<span class="sr"> (gastada)</span>' : ''}</button>`;
    const acts = (t.actions ?? []).map((a, i) => {
      const tip = `${a.name} · ${a.range <= 5 ? 'cuerpo a cuerpo' : a.range + ' pies'}${a.damage ? ` · ${a.damage} ${dmgName(a.damageType)}` : ''}${a.area ? ` · área ${a.area.size} pies` : ''}`;
      return `<button type="button" class="acc c-${a.cost}" data-i="${i}" title="${esc(tip)}" aria-label="${esc(tip)} (tecla ${(i + 1) % 10})"
        aria-pressed="${armed?.a.id === a.id}"${u?.[a.cost] ? ' disabled' : ''}><b>${(i + 1) % 10}</b><span>${esc(a.name)}</span></button>`;
    }).join('');
    const slots = Object.entries(t.slots ?? {}).map(([lv, s]) =>
      `<span class="slot" role="img" aria-label="Nivel ${lv}: ${s.max - s.used} de ${s.max} espacios">N${lv} ${'◆'.repeat(Math.max(0, s.max - s.used))}${'◇'.repeat(Math.min(s.used, s.max))}</span>`).join('');
    // ponytail: hoy `combat` es solo del DM; si el servidor rechaza «next» se muestra su error (toast)
    const end = c && (activeId() === t.id || w.role === 'dm') ? '<button type="button" class="primary" data-end>Fin de turno</button>' : '';
    const mv = c ? Math.min(u?.moved ?? 0, 9999) : 0, sp = (t.speed ?? 30) + (u?.dash ?? 0);
    const move = c ? `<div class="mov"><span>Movimiento ${mv}/${sp} pies</span><span class="hpbar" role="progressbar" aria-label="Movimiento" aria-valuemin="0" aria-valuemax="${sp}" aria-valuenow="${Math.min(mv, sp)}"><i style="width:${Math.min(100, mv / sp * 100)}%"></i></span></div>` : '';
    const ddb = t.ddb ? `<div class="det">Vinculado · nivel ${t.ddb.level} <button type="button" data-sync="${esc(t.id)}">Resincronizar</button></div>` : '';
    el.innerHTML = `${portrait(t)}<div class="info"><strong>${esc(t.name)}</strong>
      <span>${t.hp ? `PG ${t.hp.cur}/${t.hp.max}${t.hp.temp ? ` (+${t.hp.temp})` : ''}` : ''}${t.ac != null ? ` · CA ${acOf(t)}${t.shielded ? ' (Escudo)' : ''}` : ''}</span>${move}${ddb}</div>
      ${c ? `<div class="eco">${pill('action', 'Acción')}${pill('bonus', 'Adicional')}${pill('reaction', 'Reacción')}${pill('object', 'Objeto')}</div>` : ''}
      <div class="acts">${acts}</div>${slots ? `<div class="slots">${slots}</div>` : ''}${end}`;
    const hb = t.owners.includes(w.memberId) ? heroButton(t, { send: m => net.send(m), state: () => state }) : null;
    if (hb) el.append(hb);
  };
  const renderBar = () => bar?.update();
  $('hud').onclick = e => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.dataset.sync) void resync(b.dataset.sync);
    else if (b.dataset.i) pick(+b.dataset.i);
    else if (b.dataset.ds) net.send({ t: 'deathSave', tokenId: b.dataset.ds });
    else if (b.dataset.b) { const t = hudTok(); if (t) net.send({ t: 'budget', tokenId: t.id, slot: b.dataset.b as 'action', used: !state.combat?.used[t.id]?.[b.dataset.b as 'action'] }); }
    else if (b.hasAttribute('data-end')) net.send({ t: 'combat', op: 'next' });
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab' && ruler?.active) { e.preventDefault(); return ruler.cycle(); } // durante el arrastre, Tab cambia de modo de movimiento
    if (e.key === 'Escape') return cancel();
    if ((e.target as HTMLElement).closest('input,textarea,select,dialog')) return;
    for (let i = 1; i <= 10; i++) if (matchesShortcut(e, 'accion' + i)) return pick(i - 1); // atajos editables en Accesibilidad
    if (matchesShortcut(e, 'fin') && state.combat) net.send({ t: 'combat', op: 'next' });
  });

  // Shift+rueda gira la plantilla que se está colocando (la rueda sola sigue haciendo zoom)
  root.addEventListener('wheel', e => {
    if (!e.shiftKey || !armed?.a.area || !tpl) return;
    e.preventDefault(); e.stopPropagation();
    tpl.rotate((e.deltaY || e.deltaX) > 0 ? 1 : -1);
  }, { capture: true, passive: false });

  // DM: combate, automatización, monstruos
  const renderMonsters = () => {
    const q = $<HTMLInputElement>('buscar').value.trim().toLowerCase();
    const list = Object.entries(MONSTERS).filter(([, m]) => m.name.toLowerCase().includes(q));
    $('monstruos').innerHTML = list.length ? list.map(([id, m]) =>
      `<li><button type="button" data-id="${esc(id)}" aria-pressed="${spawn === id}">${esc(m.name)} <span class="rol">VD ${esc(m.cr)}</span></button></li>`).join('')
      : '<li class="rol">Sin resultados</li>';
  };
  const renderDm = () => {
    const c = state.combat;
    $('dm').hidden = w.role !== 'dm';
    root.querySelector<HTMLButtonElement>('[data-op=start]')!.disabled = !!c;
    for (const op of ['next', 'prev', 'end', 'undoTurn']) root.querySelector<HTMLButtonElement>(`[data-op=${op}]`)!.disabled = !c;
    $('auto').textContent = `Automatización: ${{ assisted: 'Asistida', auto: 'Automática', manual: 'Manual' }[state.automation]}`;
  };
  $('cbt').addEventListener('click', e => {
    const op = (e.target as HTMLElement).closest('button')?.dataset.op as 'start' | 'next' | 'prev' | 'end' | 'undoTurn' | undefined;
    if (op) net.send({ t: 'combat', op });
  });
  $('auto').onclick = () => net.send({ t: 'automation', value: ({ assisted: 'auto', auto: 'manual', manual: 'assisted' } as const)[state.automation] });
  $('buscar').oninput = renderMonsters;
  $('monstruos').onclick = e => {
    const id = (e.target as HTMLElement).closest('button')?.dataset.id; if (!id) return;
    armed = undefined; spawn = spawn === id ? undefined : id;
    renderHud(); renderMonsters(); marks();
    if (spawn) say(`${MONSTERS[id].name}: haz clic en el mapa para colocarlo`);
  };
  renderMonsters();

  // D&D Beyond (extensión Lantern Link)
  const ddbd = $<HTMLDialogElement>('ddb'), ddbst = $('ddbst'), ddbprev = $('ddbprev'), ddbap = $('ddbap');
  let got: ImportedCharacter | undefined, tgt: Token[] = [], claim = false;
  const list = (a: string[]) => a.length ? a.join(', ') : '—';
  const openImport = (ts: Token[], claimFirst = false) => {
    tgt = ts; claim = claimFirst; got = undefined;
    ddbprev.replaceChildren(); ddbap.replaceChildren(); ddbst.textContent = 'Comprobando la extensión…';
    if (!ddbd.open) ddbd.showModal();
    void linkAvailable().then(l => {
      ddbst.textContent = !l.ok ? 'Hace falta la extensión Lantern Link: en tu navegador, carga la carpeta apps/link como extensión sin empaquetar y recarga esta página.'
        : !l.loggedIn ? 'Inicia sesión en dndbeyond.com en este navegador.' : '';
    });
  };
  $('ddbf').onsubmit = async e => {
    e.preventDefault();
    const id = ddbCharacterId($<HTMLInputElement>('ddbid').value);
    if (!id) { ddbst.textContent = 'No reconozco ese enlace o id.'; return; }
    ddbst.textContent = 'Trayendo personaje…'; ddbprev.replaceChildren(); ddbap.replaceChildren();
    try {
      const c = got = await getCharacter(id);
      ddbst.textContent = '';
      const sv = Object.entries(c.saves ?? {}).map(([k, v]) => `${AB[k as Ability]} ${v! >= 0 ? '+' : ''}${v}`);
      ddbprev.innerHTML = `<h3>${esc(c.name)}</h3><p>${esc(c.classes)} · nivel ${c.level}</p>
        <p>PG ${c.hp?.max ?? '—'} · CA ${c.ac ?? '—'} · Velocidad ${c.speed ?? 30} pies</p>
        <p>Salvaciones: ${esc(list(sv))}</p><p>Acciones: ${esc(list((c.actions ?? []).map(a => a.name)))}</p>`;
      ddbap.innerHTML = tgt.map(t => `<button type="button" class="primary" data-t="${esc(t.id)}">Aplicar a ${esc(t.name)}</button>`).join('');
    } catch (err) { ddbst.textContent = (err as Error).message; }
  };
  ddbap.onclick = e => {
    const id = (e.target as HTMLElement).closest('button')?.dataset.t;
    if (!id || !got) return;
    if (claim) net.send({ t: 'claim', tokenId: id });
    net.send({ t: 'importCharacter', tokenId: id, data: got });
    ddbd.close();
  };
  $('ddbno').onclick = () => ddbd.close();
  const resync = async (id: Id) => {
    const t = tok(id); if (!t?.ddb) return;
    say('Resincronizando…');
    try { net.send({ t: 'importCharacter', tokenId: id, data: await getCharacter(t.ddb.id) }); say('Personaje resincronizado'); }
    catch (err) { say((err as Error).message, 4000); }
  };
  const renderMios = () => {
    $('mios').innerHTML = mine().map(t => `<div><strong>${esc(t.name)}</strong>
      ${t.ddb ? `<p class="det">Vinculado · nivel ${t.ddb.level}</p><button type="button" data-sync="${esc(t.id)}">Resincronizar</button>` : ''}
      <button type="button" data-imp="${esc(t.id)}">Traer mi personaje de D&amp;D Beyond</button></div>`).join('');
  };
  $('mios').onclick = e => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.dataset.sync) void resync(b.dataset.sync);
    else if (b.dataset.imp) { const t = tok(b.dataset.imp); if (t) openImport([t]); }
  };

  // Elegir personaje
  const dlg = $<HTMLDialogElement>('elegir');
  dlg.oncancel = e => e.preventDefault(); // obligatorio elegir
  const renderClaim = () => {
    const free = state.scene.tokens.filter(t => t.faction === 'ally' && !t.owners.length);
    if (w.role === 'player' && !mine().length && free.length) {
      $('libres').innerHTML = free.map(t => `<li><button type="button" data-id="${esc(t.id)}">${portrait(t)}${esc(t.name)}</button></li>`).join('');
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) dlg.close();
  };
  $('ddbc').onclick = () => openImport(state.scene.tokens.filter(t => t.faction === 'ally' && !t.owners.length), true);
  $('libres').onclick = e => {
    const id = (e.target as HTMLElement).closest('button')?.dataset.id;
    if (id) net.send({ t: 'claim', tokenId: id });
  };

  // Dados 3D: selector de set e interruptor (localStorage)
  const themes = Object.keys(DICE) as DiceTheme[];
  $('sets').innerHTML = themes.map(th => `<li><button type="button" role="radio" aria-checked="false" data-th="${th}" title="${esc(DICE[th].note)}">
    <i style="background:${DICE[th].body};border-color:${DICE[th].edge}"></i>${esc(DICE[th].name)}</button></li>`).join('');
  $('sets').onclick = e => {
    const th = (e.target as HTMLElement).closest('button')?.dataset.th as DiceTheme | undefined;
    if (th) net.send({ t: 'diceTheme', theme: th });
  };
  let show3d = true;
  try { show3d = localStorage.getItem('lantern.dados3d') !== '0'; } catch { /* sin almacenamiento */ }
  const paint3d = () => $('d3d').setAttribute('aria-checked', String(show3d));
  paint3d();
  $('d3d').onclick = () => {
    show3d = !show3d; paint3d();
    try { localStorage.setItem('lantern.dados3d', show3d ? '1' : '0'); } catch { /* sin almacenamiento */ }
  };
  // Relé opt-in al Game Log de DDB: solo con Link conectado y un personaje propio vinculado; nunca por defecto
  let linkOk = false, glOn = false;
  try { glOn = localStorage.getItem('lantern.gamelog') === '1'; } catch { /* sin almacenamiento */ }
  const glTok = (as?: string) => mine().find(t => t.ddb && (!as || t.name === as));
  const paintGl = () => { $('glw').hidden = !(linkOk && glTok()); $<HTMLInputElement>('gl').checked = glOn; };
  void linkAvailable().then(l => { linkOk = l.ok && l.loggedIn; paintGl(); });
  $('gl').onchange = () => {
    glOn = $<HTMLInputElement>('gl').checked;
    try { localStorage.setItem('lantern.gamelog', glOn ? '1' : '0'); } catch { /* sin almacenamiento */ }
  };
  const glSent = new Set<Id>();
  const relay = (m: ChatMsg) => {
    const r = m.roll, t = r && glTok(m.as);
    if (!glOn || !linkOk || !r || !t?.ddb || m.from !== w.memberId || m.to || r.secret || r.blind || r.external || r.expr === 'iniciativa' || !r.dice?.length || glSent.has(m.id)) return;
    glSent.add(m.id);
    sendGameLogRoll(t.ddb.id, { expr: r.expr, total: r.total, dice: r.dice }).catch(e => say(`Game Log: ${(e as Error).message}`, 3500));
  };
  const fxDone = new Set<Id>(); // efectos de tarjeta: una vez por mensaje
  const cardFx = (c: ActionCard) => {
    const A = tok(c.actorId), act = A?.actions?.find(a => a.name === c.actionName), melee = (act?.range ?? 5) <= 5;
    const at = (id: Id) => { const k = tok(id); return k && { x: k.x, y: k.y }; };
    const ts = c.targets.map(t => ({ t, p: at(t.id) })).filter((x): x is { t: typeof x.t; p: Point } => !!x.p);
    if (!ts.length) return;
    const from = A && { x: A.x, y: A.y };
    void table.then(tb => {
      if (c.kind === 'heal') ts.forEach(x => tb.effect({ kind: 'heal', at: x.p }));
      else if (c.kind === 'attack') for (const { t, p } of ts) {
        if (!t.attack?.hit) tb.effect({ kind: 'miss', at: p });
        else if (!melee && from) tb.effect({ kind: 'projectile', from, to: p, damageType: c.damageType });
        else tb.effect({ kind: 'impact', at: p, damageType: c.damageType, crit: t.attack.crit });
      } else if (act?.area) {
        const n = ts.length;
        tb.effect({ kind: 'burst', at: { x: ts.reduce((a, x) => a + x.p.x, 0) / n, y: ts.reduce((a, x) => a + x.p.y, 0) / n }, radius: areaR(act), damageType: c.damageType });
      } else ts.forEach(x => tb.effect({ kind: 'impact', at: x.p, damageType: c.damageType }));
    });
    const hits = c.kind === 'attack' ? c.targets.filter(t => t.attack?.hit) : c.targets;
    sfx(c.kind === 'heal' ? 'heal' : c.kind === 'attack' && !hits.length ? 'miss' : hits.some(t => t.attack?.crit) ? 'crit' : 'hit');
  };
  const rolled = new Set<Id>(); // la tarjeta se reenvía al confirmarse: solo se anima una vez

  const cards = new Map<Id, HTMLElement>(); // para reemplazar tarjetas que el servidor reenvía (pendiente → aplicada)
  const addMsg = (m: ChatMsg, live = false) => {
    const log = $('log');
    const el = cards.get(m.id) ?? document.createElement('div');
    const who = esc(name(m.from));
    if (m.card) {
      const c = m.card;
      el.className = 'msg tarjeta';
      el.innerHTML = cardHtml(c, canConfirm);
      cards.set(m.id, el);
      el.querySelector('.conf')?.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest('button'); if (!b) return;
        net.send({ t: 'confirm', pending: c.pending!, mode: b.dataset.m as 'full' | 'half' | 'none' | 'heal' });
        el.querySelectorAll('button').forEach(x => x.disabled = true);
      });
      if (live && (c.applied || c.pending) && !fxDone.has(m.id)) { fxDone.add(m.id); cardFx(c); }
      if (live && c.applied) for (const t of c.targets) if (t.amount && t.amount > 0)
        table.then(tb => tb.floatText(t.id, `${c.kind === 'heal' ? '+' : '−'}${t.amount}`, c.kind === 'heal' ? HEAL : dmgColor(c.damageType), c.kind === 'heal' ? undefined : dmgSvg(c.damageType, dmgColor(c.damageType))));
    } else if (m.roll) {
      el.className = 'msg tirada';
      el.innerHTML = `<span class="quien">${who}</span><code>${esc(m.roll.expr)}</code>
        ${m.roll.expr === 'iniciativa' ? '' : `<strong class="total">${m.roll.total}</strong>`}<span class="det">${esc(m.roll.detail)}</span>
        ${m.roll.secret ? '<em class="secreta">secreta</em>' : ''}${rollBadges(m.roll)}`;
    } else {
      const x = renderChatExtras(m, name);
      el.className = x?.cls ?? 'msg';
      el.innerHTML = x?.html ?? `<span class="quien">${who}</span> ${esc(m.text ?? '')}`;
    }
    if (live) relay(m);
    const dice = m.card?.dice ?? m.roll?.dice;
    if (live && show3d && dice?.length && !rolled.has(m.id)) {
      rolled.add(m.id); sfx('dice');
      const th = state.members.find(x => x.id === m.from)?.dice ?? 'linterna';
      void trayP.then(t => t.roll(dice, th, m.card ? `${m.card.actorName} · ${m.card.actionName}` : `${name(m.from)} · ${m.roll!.expr}`, m.roll?.total));
    }
    if (live && /\bsube a nivel \d+/.test(m.text ?? '')) sfx('levelup');
    else if (live && /descanso (largo|corto)/.test(m.text ?? '') && !/propone/.test(m.text ?? '')) sfx('rest');
    const d20 = m.roll?.dice?.find(d => d.sides === 20 && d.kept);
    if (live && !m.card && d20 && (d20.value === 20 || d20.value === 1)) sfx(d20.value === 20 ? 'crit' : 'fumble', show3d ? 1.2 : 0.5); // tras la animación
    if (!el.isConnected) log.append(el);
    log.scrollTop = log.scrollHeight;
  };

  w.chat.forEach(m => addMsg(m));
  render(state);

  // Conexión
  net.onConn(c => {
    const el = $('conn');
    el.className = 'conn ' + c;
    el.textContent = c === 'online' ? 'En línea' : 'Reconectando…';
  });

  // Copiar enlace
  $('cod').onclick = async () => {
    const url = `${location.origin}${location.pathname}?code=${state.code}`;
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch {
      // Sin API de portapapeles (http no seguro, permisos): método clásico con selección.
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { /* sin portapapeles */ }
      ta.remove();
    }
    const t = $('toast');
    t.textContent = ok ? `Enlace copiado · código ${state.code}` : `No se pudo copiar. Código: ${state.code} · ${url}`;
    t.classList.add('show'); t.classList.toggle('sel', !ok);
    clearTimeout(tt);
    tt = window.setTimeout(() => t.classList.remove('show'), ok ? 2000 : 10000);
  };

  // Pestañas y plegado
  const tab = (a: 'reg' | 'hoja' | 'mesa' | 'esc' | 'aj' | 'dia' | 'biblioteca' | 'encuentros' | 'pantalla' | 'cuenta') => {
    selectTab(a); // solo afecta a las pestañas de su zona (dock.ts)
  };
  $('t-reg').onclick = () => tab('reg');
  $('t-mesa').onclick = () => tab('mesa');
  $('t-hoja').onclick = () => tab('hoja');
  $('t-aj').onclick = () => tab('aj');
  $('t-esc').onclick = () => tab('esc');
  $('t-dia').onclick = () => tab('dia');
  $('t-biblioteca').onclick = () => tab('biblioteca');
  $('t-encuentros').onclick = () => tab('encuentros');
  $('t-pantalla').onclick = () => tab('pantalla');
  $('t-cuenta').onclick = () => tab('cuenta');
  if (w.role === 'dm') {
    mountDmScreen($('p-pantalla')); mountDdbMonsters($('p-cuenta'), ctx);
    $('t-pantalla').hidden = $('t-cuenta').hidden = false;
  }
  mountDock(root);
  // ---- fase 6: menú radial, paleta, modos de pantalla, accesibilidad ----
  const radialCtx = {
    role: w.role, memberId: w.memberId,
    send: (m: C2S) => net.send(m),
    arm: armAction,
    members: () => state.members,
    openSheet: (tokenId: Id) => { selected = tokenId; sheet.render(); tab('hoja'); $('lado').classList.remove('plegado'); },
    ping: (x: number, y: number) => net.send({ t: 'ping', x, y }),
    lit: (id: Id) => state.scene.lights.some(l => l.id === `luz-${id}`),
    grid: state.scene.grid.size,
  };
  const extCtx = { state: () => state, send: (m: C2S) => net.send(m), role: w.role, memberId: w.memberId };
  exts = mountExtensions($('exts'), extCtx);
  exts.update(state);
  if (w.role === 'dm') { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Extensiones…'; b.onclick = () => openInstaller(extCtx); $('p-aj').append(b); }
  void linkCurrentTable(w.state.code, w.key); // si hay cuenta con sesión, la mesa queda en «Mis mesas»
  mountPalette({ commands: q => defaultCommands({
    role: w.role, memberId: w.memberId, send: m => net.send(m), state: () => state,
    center: () => ({ x: state.scene.width / 2, y: state.scene.height / 2 }), // ponytail: centro de la escena, no de la vista
    mine: () => hudTok(), tab, focus: (x, y) => void table.then(t => t.focus(x, y)),
  }, q) });
  applyDisplayMode(displayModeFromUrl(), { table, root, state: w.state });
  // ---- fase 7b: plantas, antesala, tarjeta X, pruebas pedidas, cierre de sesión ----
  checkProtocol(w.v);
  if (w.role !== 'spectator') mountBeyond20(m => net.send(m)); // tiradas hechas en la hoja de DDB con Beyond20 (dominio propio en sus opciones)
  const normalView = displayModeFromUrl() === 'normal';
  if (normalView) mountSafety({ send: m => net.send(m) }); // botón X y Alt+X
  const chkCtx = { send: (m: C2S) => net.send(m), state: () => state, me: w.memberId };
  lobby = normalView && w.role !== 'spectator' ? showLobby({ state: () => state, send: m => net.send(m), me: w.memberId, role: w.role, onReady() {} }) : undefined;
  lv = mountLevels($('lv'), { state: () => state, send: m => net.send(m), role: w.role,
    setLevel: (id, o) => void table.then(t => t.setLevel(id, o)),
    ownLevel: () => state.scene.tokens.find(t => t.owners.includes(w.memberId))?.level });
  lv.update(state);
  if (w.role === 'dm') {
    const box = document.createElement('section'); box.className = 'dm-extra'; box.setAttribute('aria-label', 'Pruebas y sesión');
    $('dm').after(box);
    cr = mountCheckRequester(box, { send: m => net.send(m), state: () => state, selected: () => (selected ? [selected] : []) });
    box.append(sessionEndButton({ send: m => net.send(m) }));
  }
  // Móvil: el mapa entero no se lee en 390 px → al entrar, cámara sobre tu personaje.
  if (matchMedia('(max-width: 700px)').matches && displayModeFromUrl() === 'normal') {
    const own = mine()[0]; if (own) void table.then(t => t.focus(own.x, own.y, 1));
  }
  if (import.meta.env.DEV) (window as unknown as { __lantern: unknown }).__lantern = { table, state: () => state, send: (m: C2S) => net.send(m) }; // para pruebas E2E/bench/chaos
  mountA11y($('p-mesa'));
  if (!popout) void import('./extras.ts').then(x => x.mountExtras(root, w, table)); // fase 11: Compendio, Herramientas del DM, emotes, dados 2D…
  else if (isPopout() === 'comp' || isPopout() === 'dmx') void import('./extras.ts').then(x => x.mountPopoutExtras(root, w, isPopout() as 'comp' | 'dmx')); // esos paneles viven en extras.ts
  mountScreenReaderMirror(root, () => state);

  $('plegar').onclick = () => {
    const c = $('lado').classList.toggle('plegado');
    $('plegar').setAttribute('aria-expanded', String(!c));
  };
  if (matchMedia('(max-width: 699px)').matches) $('plegar').click(); // hoja inferior empieza plegada

  // Entrada: chat / tirada
  $('chat').onsubmit = e => {
    e.preventDefault();
    const inp = $<HTMLInputElement>('txt');
    const v = inp.value.trim();
    if (!v) return;
    if (chatSendFromInput(v, { send: m => net.send(m), state: () => state, me: w.memberId, toast: m => say(m, 3500) })) inp.value = '';
  };

  return {
    handle(m: S2C) {
      if (m.t === 'welcome') { state = m.state; $('log').replaceChildren(); m.chat.forEach(x => addMsg(x)); render(m.state); }
      else if (m.t === 'state') render(m.state);
      else if (m.t === 'chat') addMsg(m.msg, true);
      else if (m.t === 'ping') { sfx('ping'); table.then(t => t.ping(m.x, m.y, colorOf(m.from))); }
      else if (m.t === 'npcSay') { story.npcSay(m); speakNpc(m.name, m.text); }
      else if (m.t === 'copilot') copilot?.handle(m);
      else if (m.t === 'draw' || m.t === 'cursor' || m.t === 'focus') drawApi?.handle(m);
      else if (m.t === 'reactionPrompt') reactionPrompt(m, c2);
      else if (m.t === 'spellBanner') spellBanner(m);
      else if (m.t === 'turnReminder') turnReminder(m, c2);
      else if (m.t === 'saveRequest') handleSaveRequest(m, { send: x => net.send(x) });
      else if (m.t === 'route') void table.then(t => t.showGhost(m.tokenId, m.points));
      else if (m.t === 'handout') showHandout(m.entry);
      else if (m.t === 'regionMsg') showRegionMsg(m.text);
      else if (m.t === 'transition') story.transition(m);
      else if (m.t === 'prepare') preload(m.urls);
      else if (m.t === 'sfx') sfx(m.name);
      else if (m.t === 'clock') audio.clock(m.now);
      else if (m.t === 'safety') handleSafety(m);
      else if (m.t === 'checkRequest') handleCheckRequest(m, { send: x => net.send(x), state: () => state, me: w.memberId });
      else if (m.t === 'sessionSummary') showSummary(m.summary, m2 => net.send(m2));
      else if (m.t === 'error') { if (/llave/.test(m.msg)) sfx('locked'); const t = $('toast'); t.textContent = m.msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }
    },
  };
}
