import type { ChatMsg, ClientState, Member, Role, S2C } from '@lantern/protocol';
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

export function mountTable(app: HTMLElement, w: Extract<S2C, { t: 'welcome' }>) {
  let state = w.state;
  const root = document.createElement('div');
  root.className = 'mesa';
  root.innerHTML = `
    <div class="mapa" id="mapa"></div>
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
        <div id="p-mesa" role="tabpanel" aria-labelledby="t-mesa" hidden><ul id="miembros" class="miembros"></ul></div>
      </div>
    </aside>
    <div id="toast" class="toast" role="status"></div>`;
  app.append(root);
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const name = (id: string) => state.members.find(m => m.id === id)?.name ?? '???';

  const table = createTable($('mapa'), {
    role: w.role, memberId: w.memberId,
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
  };

  const addMsg = (m: ChatMsg) => {
    const log = $('log');
    const el = document.createElement('div');
    const who = esc(name(m.from));
    if (m.roll) {
      el.className = 'msg tirada';
      el.innerHTML = `<span class="quien">${who}</span><code>${esc(m.roll.expr)}</code>
        <strong class="total">${m.roll.total}</strong><span class="det">${esc(m.roll.detail)}</span>
        ${m.roll.secret ? '<em class="secreta">secreta</em>' : ''}`;
    } else {
      el.className = 'msg';
      el.innerHTML = `<span class="quien">${who}</span> ${esc(m.text ?? '')}`;
    }
    log.append(el);
    log.scrollTop = log.scrollHeight;
  };

  w.chat.forEach(addMsg);
  render(state);

  // Conexión
  net.onConn(c => {
    const el = $('conn');
    el.className = 'conn ' + c;
    el.textContent = c === 'online' ? 'En línea' : 'Reconectando…';
  });

  // Copiar enlace
  let tt: number;
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
      if (m.t === 'welcome') { state = m.state; $('log').replaceChildren(); m.chat.forEach(addMsg); render(m.state); }
      else if (m.t === 'state') render(m.state);
      else if (m.t === 'chat') addMsg(m.msg);
      else if (m.t === 'ping') table.then(t => t.ping(m.x, m.y, colorOf(m.from)));
      else if (m.t === 'error') { const t = $('toast'); t.textContent = m.msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }
    },
  };
}
