import type { C2S, ClientState, Role } from '@lantern/protocol';

const ROLES: Record<Role, string> = { dm: 'DM', assistant: 'Asistente', trusted: 'De confianza', player: 'Jugador', spectator: 'Espectador' };
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const seen = (code: string) => { try { return sessionStorage.getItem('lantern:listo:' + code) === '1'; } catch { return false; } };

/**
 * Antesala de sesión. Montaje en ui/table.ts (ver informe): no llamar en vistas mesa/espectador.
 * Devuelve { update } para repintar miembros y listas cuando llega un `state`.
 */
export function showLobby(ctx: { state(): ClientState; send(m: C2S): void; me: string; role: Role; onReady(): void }) {
  const code = ctx.state().code;
  if (seen(code)) { ctx.onReady(); return { update() {}, close() {} }; }
  const d = document.createElement('dialog');
  d.className = 'antesala';
  d.setAttribute('aria-labelledby', 'an-t');
  d.innerHTML = `
    <div class="an-fondo" aria-hidden="true"></div>
    <div class="an-cuerpo">
      <header><p class="det">Antesala de sesión</p><h1 id="an-t"></h1><p class="det">Código <span class="mono" id="an-cod"></span></p></header>
      <section aria-labelledby="an-m"><h2 id="an-m">En la mesa</h2><ul class="an-miembros" id="an-lista"></ul></section>
      <section aria-labelledby="an-a"><h2 id="an-a">Sonido</h2>
        <div class="an-audio">
          <button type="button" id="an-son">Probar sonido</button>
          <button type="button" id="an-mic">Probar micrófono</button>
          <meter id="an-med" min="0" max="1" value="0" aria-label="Nivel del micrófono" hidden></meter>
        </div><p class="det" id="an-est" role="status"></p></section>
      <section class="an-seg" aria-labelledby="an-s"><h2 id="an-s">Líneas y velos</h2>
        <p class="det">Anónimo: nadie ve quién escribe cada una. Cualquiera puede añadir o quitar.</p>
        ${(['lines', 'veils'] as const).map(l => `<div><h3 id="an-h-${l}">${l === 'lines' ? 'Líneas (no aparecen)' : 'Velos (pasan fuera de plano)'}</h3>
          <ul class="chips" data-l="${l}" aria-labelledby="an-h-${l}"></ul>
          <form data-l="${l}"><label class="sr" for="an-i-${l}">Añadir a ${l === 'lines' ? 'líneas' : 'velos'}</label>
            <input id="an-i-${l}" maxlength="80" autocomplete="off" placeholder="Añadir…"><button type="submit">Añadir</button></form></div>`).join('')}
        <p class="det">La tarjeta X está activa durante la partida (tecla Alt+X o botón «X» abajo a la izquierda).</p></section>
      <button type="button" class="primary an-listo" id="an-ok">Estoy listo</button>
    </div>`;
  const $ = <T extends HTMLElement>(s: string) => d.querySelector<T>(s)!;
  let stream: MediaStream | undefined, ac: AudioContext | undefined, raf = 0;
  const stopMic = () => { cancelAnimationFrame(raf); stream?.getTracks().forEach(t => t.stop()); stream = undefined; void ac?.close(); ac = undefined; };

  const update = () => {
    const s = ctx.state();
    $('#an-t').textContent = s.scene.name; $('#an-cod').textContent = s.code;
    const img = s.scene.story?.image;
    $('.an-fondo').style.backgroundImage = img ? `url(${JSON.stringify(img)})` : '';
    $('#an-lista').innerHTML = s.members.map(m => {
      const pj = s.scene.tokens.filter(t => t.owners.includes(m.id)).map(t => t.name).join(', ');
      return `<li><span class="an-pto ${m.online ? 'on' : ''}" aria-hidden="true"></span><strong>${esc(m.name)}${m.id === ctx.me ? ' (tú)' : ''}</strong>
        <span class="det">${ROLES[m.role]}${pj ? ' · ' + esc(pj) : ''} · ${m.online ? 'en línea' : 'desconectado'}</span></li>`;
    }).join('');
    for (const l of ['lines', 'veils'] as const)
      $(`ul[data-l=${l}]`).innerHTML = s.safety[l].map((t, i) =>
        `<li>${esc(t)} <button type="button" class="an-x" data-l="${l}" data-i="${i}" aria-label="Quitar «${esc(t)}»">×</button></li>`).join('') || '<li class="det">Nada por ahora</li>';
  };
  d.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.an-x'); if (!b) return;
    const l = b.dataset.l as 'lines' | 'veils';
    ctx.send({ t: 'safety', op: 'remove', list: l, text: ctx.state().safety[l][+b.dataset.i!] });
  });
  d.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target as HTMLFormElement, i = f.querySelector('input')!, text = i.value.trim();
    if (text) { ctx.send({ t: 'safety', op: 'add', list: f.dataset.l as 'lines' | 'veils', text }); i.value = ''; }
  });
  $('#an-son').onclick = () => {
    const a = new AudioContext(), o = a.createOscillator(), g = a.createGain();
    o.frequency.value = 440; g.gain.setValueAtTime(.15, a.currentTime); g.gain.exponentialRampToValueAtTime(.001, a.currentTime + .5);
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + .5); o.onended = () => void a.close();
    $('#an-est').textContent = 'Has oído un tono corto. Si no, revisa el volumen.';
  };
  $('#an-mic').onclick = async () => {
    stopMic();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      ac = new AudioContext();
      const an = ac.createAnalyser(); an.fftSize = 512;
      ac.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize), med = $<HTMLMeterElement>('#an-med'); med.hidden = false; // se muestra al probar el micrófono
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128) / 128);
        med.value = Math.min(1, m * 2); raf = requestAnimationFrame(tick);
      };
      tick(); $('#an-est').textContent = 'Micrófono activo: habla y mira el medidor.';
    } catch { $('#an-est').textContent = 'No se pudo acceder al micrófono.'; }
  };
  const close = () => { stopMic(); d.close(); d.remove(); };
  $('#an-ok').onclick = () => {
    try { sessionStorage.setItem('lantern:listo:' + code, '1'); } catch { /* sin storage: se volverá a ver */ }
    close(); ctx.onReady();
  };
  d.addEventListener('cancel', e => e.preventDefault()); // solo se cierra con «Estoy listo»
  update();
  document.body.append(d); d.showModal(); $('#an-ok').focus();
  return { update, close };
}
