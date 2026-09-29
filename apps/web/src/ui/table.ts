import type { Action, ActionCard, Ability, ChatMsg, ClientState, Id, Member, Point, Role, S2C, Token } from '@lantern/protocol';
import { MONSTERS } from '@lantern/srd';
import { createTable } from '../render/table.ts';
import { net } from '../net.ts';

const ROLES: Record<Role, string> = { dm: 'DM', assistant: 'Asistente', trusted: 'De confianza', player: 'Jugador', spectator: 'Espectador' };
const PALETTE = ['#F5C877', '#5B9BE0', '#7FCB8A', '#E0643A', '#C79BF0', '#6FD3D3', '#F08AB4', '#E8E27A'];
const colorOf = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const DMG: Record<string, [string, string]> = {
  fire: ['fuego', '#F58A3C'], cold: ['frío', '#8FD3F5'], lightning: ['rayo', '#F2E45A'], acid: ['ácido', '#A5D65A'],
  poison: ['veneno', '#6FCB7C'], necrotic: ['necrótico', '#9DBB86'], radiant: ['radiante', '#FFE08A'], force: ['fuerza', '#C29CF5'],
  psychic: ['psíquico', '#EE8CCB'], thunder: ['trueno', '#8FA6F7'],
};
const dmgName = (t?: string) => (t && DMG[t]?.[0]) || t || '';
const dmgColor = (t?: string) => (t && DMG[t]?.[1]) || '#D3C3A6'; // físicos y desconocidos
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
      <em class="res ${a.hit ? 'ok' : 'ko'}">${a.crit ? 'Crítico' : a.hit ? '¡Impacto!' : 'Fallo'}</em>` : '';
    const sa = sv ? `<span class="det">${AB[sv.ability]}${sv.dc != null ? ` CD ${sv.dc}` : ''}: <strong class="tot">${sv.total}</strong></span>
      <em class="res ${sv.success ? 'ok' : 'ko'}">${sv.success ? 'Supera' : 'Falla'}</em>` : '';
    const am = t.amount ? `<strong class="amt" style="color:${col}">${c.kind === 'heal' ? '+' : '−'}${t.amount}${c.kind === 'heal' ? '' : ' ' + esc(dmgName(c.damageType))}</strong>` : '';
    return `<li><span class="obj">${esc(t.name)}</span>${at}${sa}${am}</li>`;
  }).join('');
  const btns = c.pending && !c.applied && canConfirm
    ? `<div class="conf" data-p="${esc(c.pending)}"><button class="primary" data-m="full" type="button">Aplicar</button>
       <button data-m="half" type="button">Mitad</button><button class="secondary" data-m="none" type="button">Nada</button></div>` : '';
  const st = c.applied ? '' : c.pending ? '<em class="det">Pendiente de confirmar</em>' : '';
  return `<div class="cab"><span class="quien">${esc(c.actorName)}</span> ${esc(c.actionName)}</div>
    <ul class="filas">${rows}</ul>${c.detail ? `<div class="det">${esc(c.detail)}</div>` : ''}${st}${btns}`;
}

export function mountTable(app: HTMLElement, w: Extract<S2C, { t: 'welcome' }>) {
  me = w.memberId;
  let state = w.state;
  const root = document.createElement('div');
  root.className = 'mesa';
  root.innerHTML = `
    <div class="mapa" id="mapa"></div>
    <div id="init" class="init panel" hidden></div>
    <div id="aviso" class="aviso" role="alert" aria-live="assertive"></div>
    <div id="hud" class="hud panel" hidden></div>
    <dialog id="elegir" aria-labelledby="elegir-t"><h2 id="elegir-t">Elige tu personaje</h2><ul id="libres" class="libres"></ul></dialog>
    <div class="panel tl">
      <h1 id="escena"></h1>
      <button class="chip" id="cod" type="button" title="Copiar enlace"></button>
      <span class="conn" id="conn"></span>
    </div>
    <aside class="panel lado" id="lado">
      <header>
        <div role="tablist" aria-label="Panel">
          <button role="tab" id="t-reg" aria-selected="true" aria-controls="p-reg">Registro</button>
          <button role="tab" id="t-mesa" aria-selected="false" aria-controls="p-mesa">Mesa</button>
        </div>
        <button id="plegar" type="button" aria-expanded="true" aria-controls="cuerpo" aria-label="Plegar panel">▾</button>
      </header>
      <div id="cuerpo">
        <div id="p-reg" role="tabpanel" aria-labelledby="t-reg">
          <div id="log" class="log" aria-live="polite" aria-label="Registro" tabindex="0"></div>
          <form id="chat">
            <label class="sr" for="txt">Mensaje o tirada</label>
            <input id="txt" autocomplete="off" placeholder="Mensaje, /r 1d20+5 o /rs 2d6" maxlength="500">
            <button class="primary" type="submit">Enviar</button>
          </form>
        </div>
        <div id="p-mesa" role="tabpanel" aria-labelledby="t-mesa" hidden>
          <ul id="miembros" class="miembros"></ul>
          <section id="dm" class="dm" aria-label="Controles del DM" hidden>
            <div class="dmbtns">
              <button type="button" data-op="start">Empezar combate</button><button type="button" data-op="next">Siguiente turno</button>
              <button type="button" data-op="prev">Turno anterior</button><button type="button" data-op="end">Terminar combate</button>
            </div>
            <button id="auto" type="button" role="switch" aria-checked="false"></button>
            <label for="buscar">Buscar monstruo</label>
            <input id="buscar" type="search" autocomplete="off">
            <label class="chk"><input type="checkbox" id="oculto"> Oculto</label>
            <ul id="monstruos" class="monstruos"></ul>
          </section>
        </div>
      </div>
    </aside>
    <div id="toast" class="toast" role="status"></div>`;
  app.append(root);
  let tt = 0;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const name = (id: string) => state.members.find(m => m.id === id)?.name ?? '???';

  // Estado de interacción
  let selected: Id | undefined, targets: Id[] = [], armed: { tok: Id; a: Action } | undefined;
  let spawn: string | undefined, pointer: Point | undefined, turnKey = '';
  const tok = (id?: Id) => state.scene.tokens.find(t => t.id === id);
  const mine = () => state.scene.tokens.filter(t => t.owners.includes(w.memberId));
  const activeId = () => state.combat?.order[state.combat.turn]?.tokenId;
  const hudTok = () => { const m = mine(); return m.find(t => t.id === selected) ?? m[0] ?? (w.role === 'dm' ? tok(selected) ?? tok(activeId()) : undefined); };
  const canConfirm = w.role === 'dm' || w.role === 'assistant';
  const areaR = (a: Action) => a.area!.size / state.scene.grid.feet * state.scene.grid.size;
  const marks = () => table.then(t => t.setMarks({
    active: activeId(), selected, targets,
    area: armed?.a.area && pointer ? { ...pointer, radius: areaR(armed.a), color: '#E8A33D' } : undefined,
  }));
  const say = (msg: string, ms = 2000) => {
    const t = $('toast'); t.textContent = msg; t.classList.remove('sel'); t.classList.add('show');
    clearTimeout(tt); tt = window.setTimeout(() => t.classList.remove('show'), ms);
  };
  const fire = (tokenId: Id, actionId: Id, tg: Id[]) => {
    net.send({ t: 'act', tokenId, actionId, targets: tg });
    armed = undefined; targets = []; renderHud(); marks();
  };
  const atArea = (x: number, y: number) => {
    if (!armed) return;
    const r = areaR(armed.a);
    fire(armed.tok, armed.a.id, state.scene.tokens.filter(t => Math.hypot(t.x - x, t.y - y) <= r).map(t => t.id));
  };
  const cancel = () => {
    if (!armed && !spawn) return;
    armed = undefined; spawn = undefined; renderHud(); renderMonsters(); marks();
  };

  const table = createTable($('mapa'), {
    role: w.role, memberId: w.memberId,
    onTokenClick: (id, shift) => {
      const t = tok(id); if (!t) return;
      if (armed?.a.area) return atArea(t.x, t.y);
      if (armed) {
        if (shift) { targets = [...new Set([...targets, id])]; marks(); return; }
        return fire(armed.tok, armed.a.id, [...new Set([...targets, id])]);
      }
      selected = id; targets = shift ? [...new Set([...targets, id])] : [id];
      renderHud(); marks();
    },
    onMapClick: (x, y) => {
      if (spawn) {
        net.send({ t: 'spawn', srd: spawn, x, y, ...($<HTMLInputElement>('oculto').checked ? { hidden: true } : {}) });
        spawn = undefined; renderMonsters();
      } else if (armed?.a.area) atArea(x, y);
      // ponytail: clic en el suelo sin acción no deselecciona; Esc o elegir otro token
    },
    onPointer: (x, y) => { pointer = { x, y }; if (armed?.a.area) marks(); },
    onMoveToken: (id, x, y) => net.send({ t: 'moveToken', id, x, y }),
    onPing: (x, y) => net.send({ t: 'ping', x, y }),
    onDoor: (id, open) => net.send({ t: 'door', id, open }),
  });

  const render = (s: ClientState) => {
    state = s;
    $('escena').textContent = s.scene.name;
    $('cod').textContent = `${s.code.slice(0, 3)}-${s.code.slice(3)}`;
    $('miembros').innerHTML = s.members.map((m: Member) =>
      `<li><span class="dot ${m.online ? 'on' : ''}" role="img" aria-label="${m.online ? 'Conectado' : 'Desconectado'}"></span>
       <span class="nom">${esc(m.name)}</span><span class="rol">${ROLES[m.role]}</span></li>`).join('');
    table.then(t => t.setState(s));
    if (selected && !tok(selected)) selected = undefined;
    targets = targets.filter(id => tok(id));
    if (armed && !tok(armed.tok)) armed = undefined;
    renderInit(); renderTurn(); renderHud(); renderDm(); renderClaim(); marks();
  };

  const renderInit = () => {
    const c = state.combat, el = $('init');
    el.hidden = !c;
    if (!c) return;
    el.innerHTML = `<span class="ronda">Ronda ${c.round}</span><ol>` + c.order.map((o, i) => {
      const t = tok(o.tokenId); if (!t) return '';
      const on = i === c.turn;
      return `<li class="${on ? 'act' : ''}" title="${esc(t.name)}"${on ? ' aria-current="true"' : ''}>${portrait(t)}${hpBar(t)}<span class="sr">${esc(t.name)}${on ? ', turno activo' : ''}</span></li>`;
    }).join('') + '</ol>';
  };

  const renderTurn = () => {
    const id = activeId(), key = state.combat && id ? `${state.combat.round}:${id}` : '';
    if (key === turnKey) return;
    turnKey = key;
    const t = tok(id);
    if (!t || !t.owners.includes(w.memberId)) return;
    const a = $('aviso');
    a.textContent = `¡Tu turno, ${t.name}!`;
    a.classList.remove('show'); void a.offsetWidth; a.classList.add('show'); // reinicia la animación
    setTimeout(() => { a.classList.remove('show'); a.textContent = ''; }, 1600);
  };

  const pick = (i: number) => {
    const t = hudTok(), a = t?.actions?.[i];
    if (!t || !a) return;
    if (armed?.a.id === a.id) return cancel();
    spawn = undefined; renderMonsters();
    if (!a.area && targets.length) return fire(t.id, a.id, targets);
    armed = { tok: t.id, a };
    renderHud(); marks();
    say(a.area ? `${a.name}: haz clic en el mapa` : `${a.name}: elige un objetivo`);
  };

  const renderHud = () => {
    const t = hudTok(), el = $('hud');
    el.hidden = !t;
    if (!t) return;
    const c = state.combat, u = c?.used[t.id];
    const pill = (k: 'action' | 'bonus' | 'reaction', n: string) =>
      `<span class="pill ${k}${u?.[k] ? ' gastada' : ''}"><i aria-hidden="true"></i>${n}${u?.[k] ? '<span class="sr"> (gastada)</span>' : ''}</span>`;
    const acts = (t.actions ?? []).map((a, i) => {
      const tip = `${a.name} · ${a.range <= 5 ? 'cuerpo a cuerpo' : a.range + ' pies'}${a.damage ? ` · ${a.damage} ${dmgName(a.damageType)}` : ''}${a.area ? ` · área ${a.area.size} pies` : ''}`;
      return `<button type="button" class="acc c-${a.cost}" data-i="${i}" title="${esc(tip)}" aria-label="${esc(tip)} (tecla ${(i + 1) % 10})"
        aria-pressed="${armed?.a.id === a.id}"${u?.[a.cost] ? ' disabled' : ''}><b>${(i + 1) % 10}</b><span>${esc(a.name)}</span></button>`;
    }).join('');
    const slots = Object.entries(t.slots ?? {}).map(([lv, s]) =>
      `<span class="slot" role="img" aria-label="Nivel ${lv}: ${s.max - s.used} de ${s.max} espacios">N${lv} ${'◆'.repeat(Math.max(0, s.max - s.used))}${'◇'.repeat(Math.min(s.used, s.max))}</span>`).join('');
    // ponytail: hoy `combat` es solo del DM; si el servidor rechaza «next» se muestra su error (toast)
    const end = c && (activeId() === t.id || w.role === 'dm') ? '<button type="button" class="primary" data-end>Fin de turno</button>' : '';
    el.innerHTML = `${portrait(t)}<div class="info"><strong>${esc(t.name)}</strong>
      <span>${t.hp ? `PG ${t.hp.cur}/${t.hp.max}${t.hp.temp ? ` (+${t.hp.temp})` : ''}` : ''}${t.ac != null ? ` · CA ${t.ac}` : ''}</span></div>
      ${c ? `<div class="eco">${pill('action', 'Acción')}${pill('bonus', 'Adicional')}${pill('reaction', 'Reacción')}</div>` : ''}
      <div class="acts">${acts}</div>${slots ? `<div class="slots">${slots}</div>` : ''}${end}`;
  };
  $('hud').onclick = e => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.dataset.i) pick(+b.dataset.i);
    else if (b.hasAttribute('data-end')) net.send({ t: 'combat', op: 'next' });
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') return cancel();
    if (e.ctrlKey || e.altKey || e.metaKey || !/^[0-9]$/.test(e.key)) return;
    if ((e.target as HTMLElement).closest('input,textarea,select,dialog')) return;
    pick((+e.key + 9) % 10);
  });

  // DM: combate, automatización, monstruos
  const renderMonsters = () => {
    const q = $<HTMLInputElement>('buscar').value.trim().toLowerCase();
    const list = Object.entries(MONSTERS).filter(([, m]) => m.name.toLowerCase().includes(q));
    $('monstruos').innerHTML = list.length ? list.map(([id, m]) =>
      `<li><button type="button" data-id="${esc(id)}" aria-pressed="${spawn === id}">${esc(m.name)} <span class="rol">VD ${esc(m.cr)}</span></button></li>`).join('')
      : '<li class="rol">Sin resultados</li>';
  };
  const renderDm = () => {
    const c = state.combat, auto = state.automation === 'auto';
    $('dm').hidden = w.role !== 'dm';
    root.querySelector<HTMLButtonElement>('[data-op=start]')!.disabled = !!c;
    for (const op of ['next', 'prev', 'end']) root.querySelector<HTMLButtonElement>(`[data-op=${op}]`)!.disabled = !c;
    $('auto').setAttribute('aria-checked', String(auto));
    $('auto').textContent = `Automatización: ${auto ? 'Automática' : 'Asistida'}`;
  };
  root.querySelector('.dmbtns')!.addEventListener('click', e => {
    const op = (e.target as HTMLElement).closest('button')?.dataset.op as 'start' | 'next' | 'prev' | 'end' | undefined;
    if (op) net.send({ t: 'combat', op });
  });
  $('auto').onclick = () => net.send({ t: 'automation', value: state.automation === 'auto' ? 'assisted' : 'auto' });
  $('buscar').oninput = renderMonsters;
  $('monstruos').onclick = e => {
    const id = (e.target as HTMLElement).closest('button')?.dataset.id; if (!id) return;
    armed = undefined; spawn = spawn === id ? undefined : id;
    renderHud(); renderMonsters(); marks();
    if (spawn) say(`${MONSTERS[id].name}: haz clic en el mapa para colocarlo`);
  };
  renderMonsters();

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
  $('libres').onclick = e => {
    const id = (e.target as HTMLElement).closest('button')?.dataset.id;
    if (id) net.send({ t: 'claim', tokenId: id });
  };

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
        net.send({ t: 'confirm', pending: c.pending!, mode: b.dataset.m as 'full' | 'half' | 'none' });
        el.querySelectorAll('button').forEach(x => x.disabled = true);
      });
      if (live && c.applied) for (const t of c.targets) if (t.amount && t.amount > 0)
        table.then(tb => tb.floatText(t.id, `${c.kind === 'heal' ? '+' : '−'}${t.amount}`, c.kind === 'heal' ? HEAL : dmgColor(c.damageType)));
    } else if (m.roll) {
      el.className = 'msg tirada';
      el.innerHTML = `<span class="quien">${who}</span><code>${esc(m.roll.expr)}</code>
        ${m.roll.expr === 'iniciativa' ? '' : `<strong class="total">${m.roll.total}</strong>`}<span class="det">${esc(m.roll.detail)}</span>
        ${m.roll.secret ? '<em class="secreta">secreta</em>' : ''}`;
    } else {
      el.className = 'msg';
      el.innerHTML = `<span class="quien">${who}</span> ${esc(m.text ?? '')}`;
    }
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
  const tab = (a: 'reg' | 'mesa') => {
    for (const k of ['reg', 'mesa'] as const) {
      $('t-' + k).setAttribute('aria-selected', String(k === a));
      $('p-' + k).hidden = k !== a;
    }
  };
  $('t-reg').onclick = () => tab('reg');
  $('t-mesa').onclick = () => tab('mesa');
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
    const r = v.match(/^\/(rs|r|tirar)\s+(.+)$/i);
    if (r) net.send({ t: 'roll', expr: r[2], ...(r[1].toLowerCase() === 'rs' ? { secret: true } : {}) });
    else net.send({ t: 'chat', text: v });
    inp.value = '';
  };

  return {
    handle(m: S2C) {
      if (m.t === 'welcome') { state = m.state; $('log').replaceChildren(); m.chat.forEach(x => addMsg(x)); render(m.state); }
      else if (m.t === 'state') render(m.state);
      else if (m.t === 'chat') addMsg(m.msg, true);
      else if (m.t === 'ping') table.then(t => t.ping(m.x, m.y, colorOf(m.from)));
      else if (m.t === 'error') { const t = $('toast'); t.textContent = m.msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }
    },
  };
}
