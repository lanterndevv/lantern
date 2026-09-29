// Modo Historia, PNJ que habla, transiciones y panel DM «Escena y ambiente».
import type { AudioState, C2S, ClientState, Role, StoryLayer, TransitionKind, Weather } from '@lantern/protocol';
import { playTransition } from './transiciones.ts';
import { SFX_LIST } from './sfx.ts';
import { AUDIO_PACK, packOptions } from '../audio-pack.ts';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input,textarea,select,dialog');
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const div = (cls: string, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; };

export function mountStory(root: HTMLElement, mapa: HTMLElement, o: { isDm: boolean; send(m: C2S): void }) {
  // Capa de historia: va ANTES del mapa en el DOM para que los dados 3D (dentro del mapa) queden encima.
  const hist = div('historia', '<img alt="" hidden><div class="vineta"></div><div class="h-tit"><h2></h2><p></p></div>');
  hist.hidden = true; mapa.before(hist);
  const caps = div('hcapas'); hist.querySelector('img')!.after(caps); // capas de parallax entre la imagen base y la viñeta
  const img = hist.querySelector('img')!, h2 = hist.querySelector('h2')!, sub = hist.querySelector('p')!;

  // iOS solo entrega deviceorientation tras pedir permiso con un gesto del usuario (requestPermission existe solo ahí)
  const askTilt = (globalThis as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent?.requestPermission;
  const ctl = div('hctl', `${o.isDm ? '<button type="button" data-a="tac">Táctico</button>' : ''}<button type="button" data-a="ui" aria-pressed="false">Ocultar interfaz</button>${askTilt ? '<button type="button" data-a="tilt">Activar inclinación</button>' : ''}`);
  ctl.hidden = true;
  const live = div('sr'); live.setAttribute('aria-live', 'polite');
  const npc = div('npc', '<span class="ret" aria-hidden="true"></span><div><strong></strong><p></p><small>Clic o Espacio para continuar</small></div>');
  npc.hidden = true; npc.setAttribute('aria-hidden', 'true');
  const tr = div('trans', '<div class="tinta"></div><div class="tcont"><small>Capítulo</small><h2></h2><p></p></div>');
  tr.hidden = true; tr.setAttribute('aria-hidden', 'true');
  root.append(ctl, npc, tr, live);
  const announce = (s: string) => { live.textContent = ''; setTimeout(() => { live.textContent = s; }, 50); };

  const toggleUi = () => {
    const on = root.classList.toggle('sin-ui');
    ctl.querySelector('[data-a=ui]')!.setAttribute('aria-pressed', String(on));
  };
  ctl.onclick = e => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a === 'tac') o.send({ t: 'view', value: 'tactical' });
    else if (a === 'ui') toggleUi();
    else if (a === 'tilt') void askTilt!.call(DeviceOrientationEvent).then(r => { if (r === 'granted') (e.target as HTMLElement).remove(); }, () => {});
  };

  // PNJ que habla
  let ti = 0, tc = 0;
  const closeNpc = () => { clearInterval(ti); clearTimeout(tc); npc.hidden = true; };
  npc.onclick = closeNpc;
  document.addEventListener('keydown', e => {
    if (e.key === ' ' && !npc.hidden && !e.ctrlKey && !e.altKey && !e.metaKey && !typing(e.target)) { e.preventDefault(); closeNpc(); }
    else if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.altKey && !e.metaKey && !typing(e.target) && root.classList.contains('historia-on')) toggleUi();
  });

  // Parallax: ratón, inclinación del dispositivo y vaivén lento; nada con movimiento reducido
  let px = 0, py = 0, tk = 0, key = '';
  const move = (x: number, y: number) => { px = x; py = y; };
  document.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') move(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1); });
  addEventListener('deviceorientation', e => { if (e.gamma != null && e.beta != null) move(Math.max(-1, Math.min(1, e.gamma / 30)), Math.max(-1, Math.min(1, (e.beta - 45) / 30))); });
  const tick = (t: number) => {
    const sway = Math.sin(t / 5000) * 0.35;
    for (const c of caps.children as Iterable<HTMLElement>) {
      const d = +c.dataset.d!;
      c.style.transform = `translate(${(px + sway) * d * -28}px, ${(py + sway / 2) * d * -18}px) scale(${1 + d * 0.1})`;
    }
    tk = requestAnimationFrame(tick);
  };

  let tt = 0;
  return {
    update(s: ClientState) {
      const on = s.view === 'story', st = s.scene.story;
      root.classList.toggle('historia-on', on);
      if (!on) { root.classList.remove('sin-ui'); ctl.querySelector('[data-a=ui]')!.setAttribute('aria-pressed', 'false'); }
      hist.hidden = ctl.hidden = !on;
      h2.textContent = st?.title ?? ''; sub.textContent = st?.subtitle ?? '';
      const ly = st?.layers ?? [], k = on ? JSON.stringify(ly) : '';
      if (k !== key) {
        key = k; cancelAnimationFrame(tk);
        caps.replaceChildren(...(k ? ly : []).map(l => { const c = div('hcapa'); c.dataset.d = String(l.depth); const i = new Image(); i.alt = ''; i.src = l.image; c.append(i); return c; }));
        if (ly.length && on && !reduced()) tk = requestAnimationFrame(tick);
      }
      if (st?.image !== (img.hidden ? undefined : img.getAttribute('src'))) {
        img.hidden = !st?.image;
        if (st?.image) { img.src = st.image; img.style.animation = 'none'; void img.offsetWidth; img.style.animation = ''; }
        else img.removeAttribute('src');
      }
    },
    npcSay(m: { name: string; text: string; portrait?: string }) {
      closeNpc();
      const ret = npc.querySelector('.ret')!, txt = npc.querySelector('p')!;
      ret.replaceChildren();
      if (m.portrait) { const i = new Image(); i.alt = ''; i.src = m.portrait; ret.append(i); } else ret.textContent = (m.name[0] ?? '?').toUpperCase();
      npc.querySelector('strong')!.textContent = m.name;
      announce(`${m.name}: ${m.text}`);
      if (reduced()) txt.textContent = m.text;
      else {
        let n = 0; const inc = Math.ceil(m.text.length / 120); txt.textContent = '';
        ti = window.setInterval(() => { n += inc; txt.textContent = m.text.slice(0, n); if (n >= m.text.length) clearInterval(ti); }, 28);
      }
      npc.hidden = false;
      tc = window.setTimeout(closeNpc, 12000);
    },
    transition(m: { title: string; subtitle?: string; kind?: TransitionKind; ms?: number }) {
      if (m.kind) { playTransition({ ...m, kind: m.kind }); announce(m.title + (m.subtitle ? '. ' + m.subtitle : '')); return; } // cambio de escena con efecto elegido por el DM
      clearTimeout(tt); tr.hidden = true; void tr.offsetWidth; // reinicia las animaciones
      tr.querySelector('h2')!.textContent = m.title; tr.querySelector('p')!.textContent = m.subtitle ?? '';
      announce(`Capítulo: ${m.title}${m.subtitle ? '. ' + m.subtitle : ''}`);
      tr.hidden = false;
      tt = window.setTimeout(() => { tr.hidden = true; }, reduced() ? 1000 : 3200);
    },
  };
}

// ---- Panel «Escena y ambiente» ----
export const WEATHER: [Weather['kind'], string][] = [['none', 'Despejado'], ['rain', 'Lluvia'], ['snow', 'Nieve'], ['fog', 'Niebla'], ['ash', 'Ceniza'], ['storm', 'Tormenta'], ['leaves', 'Hojas'], ['embers', 'Brasas']];
const isUrl = (s: string) => /^(https?:\/\/|\/)\S+$/.test(s);
const rid = () => Math.random().toString(36).slice(2, 10);
const MAX_UPLOAD = 30e6;

async function upload(code: string, f: File): Promise<string> {
  const key = localStorage.getItem(`lantern:key:${code}`) ?? '';
  const r = await fetch('/api/assets', { method: 'POST', headers: { 'content-type': f.type, 'x-lantern-code': code, 'x-lantern-key': key }, body: f });
  const t = await r.text();
  if (!r.ok) throw new Error(t || `Error ${r.status}`);
  let url = t.trim();
  try { url = (JSON.parse(t) as { url: string }).url; } catch { /* texto plano */ }
  if (!isUrl(url)) throw new Error('El servidor no devolvió una URL');
  return url;
}

export function mountScenePanel(el: HTMLElement, o: { role: Role; code: string; send(m: C2S): void }) {
  const staff = o.role === 'dm' || o.role === 'assistant', dm = o.role === 'dm';
  const q = <T extends HTMLElement>(id: string) => el.querySelector<T>('#e-' + id)!;
  const inp = (l: string, id: string, extra = '') => `<label>${l}<input id="e-${id}" ${extra}></label>`;
  const rng = (l: string, id: string, min: number, max: number) => inp(l, id, `type="range" min="${min}" max="${max}"`);
  const file = (l: string, id: string, kind: string) => inp(l, id, `type="file" accept="${kind}/*"`);
  el.innerHTML = `<p class="det" id="e-st" role="status"></p>` + (staff ? `
    <section aria-labelledby="e-h1"><h3 id="e-h1">Escena</h3>
      ${inp('Nombre de la escena', 'name', 'maxlength="60"')}${rng('Luz global', 'luz', 0, 100)}
      <label>Clima<select id="e-wk">${WEATHER.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
      ${rng('Intensidad del clima', 'wi', 0, 100)}${rng('Viento', 'ww', -100, 100)}
      <div class="dmbtns"><button type="button" id="e-vs">Modo Historia</button><button type="button" id="e-vt">Modo Táctico</button></div></section>
    <section aria-labelledby="e-h2"><h3 id="e-h2">Imágenes</h3>
      ${file('Fondo del mapa', 'bg', 'image')}${file('Imagen de historia', 'si', 'image')}
      ${file('Capa de parallax (atrás → delante, máx. 4)', 'pf', 'image')}${rng('Profundidad de la capa', 'pd', 0, 100)}
      <button type="button" id="e-pa">Añadir capa</button><ul class="capas" id="e-pl"></ul>
      ${inp('Título de la historia', 'stt', 'maxlength="100"')}${inp('Subtítulo de la historia', 'sts', 'maxlength="160"')}
      <button type="button" id="e-sta">Aplicar título</button></section>
    <section aria-labelledby="e-h3"><h3 id="e-h3">PNJ habla</h3>
      ${inp('Nombre', 'nn', 'maxlength="60"')}<label>Texto<textarea id="e-nt" rows="3" maxlength="500"></textarea></label>
      ${file('Retrato (opcional)', 'np', 'image')}<button type="button" id="e-ns">Hacer hablar</button></section>
    <section aria-labelledby="e-h4"><h3 id="e-h4">Transición</h3>
      ${inp('Título', 'tt', 'maxlength="100"')}${inp('Subtítulo', 'ts', 'maxlength="160"')}<button type="button" id="e-tg">Lanzar transición</button></section>` : '') + `
    <section aria-labelledby="e-h5"><h3 id="e-h5">Música</h3><p class="det" id="e-cur">Nada suena</p>
      <label>Paquete incluido<select id="e-mk">${packOptions('musica')}</select></label>${file('Archivo de audio', 'mf', 'audio')}${inp('o URL', 'mu', 'type="url" placeholder="https://…"')}
      <label class="chk"><input type="checkbox" id="e-ml" checked> Repetir</label>
      <div class="dmbtns3"><button type="button" class="primary" id="e-mp">Reproducir</button><button type="button" id="e-mpa">Pausa</button><button type="button" id="e-mr">Reanudar</button></div>
      <button type="button" id="e-ms">Parar</button></section>
    <section aria-labelledby="e-h6"><h3 id="e-h6">Capas de ambiente</h3>
      <label>Paquete incluido<select id="e-lk">${packOptions('ambiente')}</select></label>${file('Archivo de audio', 'lf', 'audio')}${inp('o URL', 'lu', 'type="url" placeholder="https://…"')}${rng('Volumen', 'lv', 0, 100)}
      <button type="button" id="e-la">Añadir capa</button><ul class="capas" id="e-ls"></ul></section>` + (dm ? `
    <section aria-labelledby="e-h7"><h3 id="e-h7">Tablero de efectos</h3><div class="sfxg"></div>
      <label class="chk"><input type="checkbox" id="e-kb"> Asignar atajos (pulsa un botón y luego una tecla; Supr lo borra)</label></section>
    <section aria-labelledby="e-h8"><h3 id="e-h8">Biblioteca de audio</h3>
      <label>Importar archivos de audio<input type="file" id="e-jf" accept="audio/*" multiple></label>
      <label>Importar carpeta<input type="file" id="e-jd" webkitdirectory multiple></label>
      <ul class="capas" id="e-jl"></ul></section>` : '');

  let cur: ClientState | undefined;
  const st = (m: string) => { q('st').textContent = m; };
  const val = (id: string) => q<HTMLInputElement>(id).value.trim();
  q<HTMLInputElement>('lv').value = '70';
  const pick = async (id: string, kind: string): Promise<string | undefined> => {
    const f = q<HTMLInputElement>(id).files?.[0]; if (!f) return;
    if (!f.type.startsWith(kind + '/')) { st(`Tipo de archivo no válido: ${f.type || 'desconocido'}`); return; }
    if (f.size > MAX_UPLOAD) { st('El archivo pesa más de 30 MB'); return; }
    st('Subiendo…');
    try { const u = await upload(o.code, f); st(''); return u; } catch (e) { st((e as Error).message); }
  };
  // archivo o URL para audio; devuelve {url,name} o undefined con el aviso en pantalla
  const audioSrc = async (fid: string, uid: string, kid: string) => {
    const k = AUDIO_PACK.find(p => p.id === q<HTMLSelectElement>(kid).value); // paquete incluido: tiene prioridad
    if (k) return { url: k.url, name: k.nombre };
    const f = q<HTMLInputElement>(fid).files?.[0], u = val(uid);
    if (!f && !u) { st('Elige un archivo o escribe una URL'); return; }
    if (!f && !isUrl(u)) { st('La URL debe empezar por http:// o https://'); return; }
    const url = f ? await pick(fid, 'audio') : u;
    return url ? { url, name: (f?.name ?? decodeURIComponent(u.split('/').pop() || u)).slice(0, 80) } : undefined;
  };
  const scene = (patch: Extract<C2S, { t: 'scene' }>['patch']) => o.send({ t: 'scene', patch });

  if (staff) {
    q('name').onchange = () => { const n = val('name'); if (n) scene({ name: n }); else st('El nombre no puede estar vacío'); };
    q('luz').onchange = () => scene({ globalLight: +q<HTMLInputElement>('luz').value / 100 });
    const wx = () => scene({ weather: { kind: q<HTMLSelectElement>('wk').value as Weather['kind'], intensity: +q<HTMLInputElement>('wi').value / 100, wind: +q<HTMLInputElement>('ww').value / 100 } });
    for (const i of ['wk', 'wi', 'ww']) q(i).onchange = wx;
    q('vs').onclick = () => o.send({ t: 'view', value: 'story' });
    q('vt').onclick = () => o.send({ t: 'view', value: 'tactical' });
    q('bg').onchange = async () => { const u = await pick('bg', 'image'); if (u) scene({ background: u }); };
    q('si').onchange = async () => { const u = await pick('si', 'image'); if (u) scene({ story: { ...cur?.scene.story, image: u } }); };
    const layers = () => cur?.scene.story?.layers ?? [];
    const setLayers = (l: StoryLayer[]) => scene({ story: { ...cur?.scene.story, layers: l } });
    q('pa').onclick = async () => {
      if (layers().length >= 4) return st('Máximo 4 capas');
      const u = await pick('pf', 'image'); if (u) setLayers([...layers(), { image: u, depth: +q<HTMLInputElement>('pd').value / 100 }]);
    };
    q('pl').addEventListener('change', e => { const i = e.target as HTMLInputElement; setLayers(layers().map((l, n) => n === +i.dataset.n! ? { ...l, depth: +i.value / 100 } : l)); });
    q('pl').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button'), n = +(b?.dataset.n ?? -1), l = [...layers()];
      if (!b || n < 0) return;
      if (b.dataset.a === 'up' && n > 0) [l[n - 1], l[n]] = [l[n], l[n - 1]]; else if (b.dataset.a === 'rm') l.splice(n, 1); else return;
      setLayers(l);
    });
    q('sta').onclick = () => scene({ story: { ...cur?.scene.story, title: val('stt'), subtitle: val('sts') } });
    q('ns').onclick = async () => {
      if (!val('nn') || !val('nt')) return st('Escribe el nombre y el texto');
      const portrait = q<HTMLInputElement>('np').files?.length ? await pick('np', 'image') : undefined;
      if (q<HTMLInputElement>('np').files?.length && !portrait) return;
      o.send({ t: 'npcSay', name: val('nn'), text: val('nt'), ...(portrait ? { portrait } : {}) });
    };
    q('tg').onclick = () => { if (!val('tt')) return st('Escribe un título'); o.send({ t: 'transition', title: val('tt'), ...(val('ts') ? { subtitle: val('ts') } : {}) }); };
  }
  q('mp').onclick = async () => {
    const s = await audioSrc('mf', 'mu', 'mk');
    if (s) o.send({ t: 'audio', op: 'play', ...s, loop: q<HTMLInputElement>('ml').checked });
  };
  q('mpa').onclick = () => o.send({ t: 'audio', op: 'pause' });
  q('mr').onclick = () => o.send({ t: 'audio', op: 'resume' });
  q('ms').onclick = () => o.send({ t: 'audio', op: 'stop' });
  q('la').onclick = async () => {
    const s = await audioSrc('lf', 'lu', 'lk');
    if (s) o.send({ t: 'audio', op: 'layer', layer: { id: rid(), ...s, volume: +q<HTMLInputElement>('lv').value / 100 } });
  };
  const layer = (id: string) => cur?.audio.layers.find(l => l.id === id);
  q('ls').addEventListener('change', e => {
    const i = e.target as HTMLInputElement, l = layer(i.dataset.id ?? '');
    if (l) o.send({ t: 'audio', op: 'layer', layer: { ...l, volume: +i.value / 100 } });
  });
  q('ls').addEventListener('click', e => {
    const id = (e.target as HTMLElement).closest('button')?.dataset.q;
    if (id) o.send({ t: 'audio', op: 'unlayer', id });
  });
  if (dm) {
    // Atajos del tablero: por defecto F1-F9 sobre los primeros efectos; se pueden reasignar (se guardan en este navegador).
    let keys: Record<string, string> = Object.fromEntries(SFX_LIST.slice(0, 9).map(([n], i) => [n, 'F' + (i + 1)]));
    try { keys = { ...keys, ...JSON.parse(localStorage.getItem('lantern:sfxkeys') ?? '{}') }; } catch { /* sin almacenamiento */ }
    const board = el.querySelector('.sfxg')!;
    const paintBoard = () => { board.innerHTML = SFX_LIST.map(([n, l]) => `<button type="button" data-s="${n}">${l}${keys[n] ? ` <kbd>${esc(keys[n])}</kbd>` : ''}</button>`).join(''); };
    paintBoard();
    let assign: string | undefined;
    board.addEventListener('click', e => {
      const n = (e.target as HTMLElement).closest('button')?.dataset.s;
      if (!n) return;
      if (q<HTMLInputElement>('kb').checked) { assign = n; st(`Pulsa la tecla para «${n}»`); return; }
      o.send({ t: 'sfx', name: n });
    });
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.altKey || e.metaKey || typing(e.target)) return;
      if (assign) {
        e.preventDefault();
        if (e.key === 'Escape') { assign = undefined; return st(''); }
        for (const k of Object.keys(keys)) if (keys[k] === e.key) delete keys[k]; // una tecla, un efecto
        if (e.key === 'Delete') delete keys[assign]; else keys[assign] = e.key;
        try { localStorage.setItem('lantern:sfxkeys', JSON.stringify(keys)); } catch { /* sin almacenamiento */ }
        assign = undefined; st(''); paintBoard(); return;
      }
      const s = Object.entries(keys).find(([, k]) => k === e.key);
      if (!s) return;
      e.preventDefault(); o.send({ t: 'sfx', name: s[0] });
    });

    // Biblioteca importada: se sube cada archivo como asset y queda en la lista (por sala, en este navegador) para lanzarlo como música o ambiente.
    type Clip = { name: string; url: string };
    const jkey = 'lantern:jukebox:' + o.code;
    let clips: Clip[] = [];
    try { clips = JSON.parse(localStorage.getItem(jkey) ?? '[]'); } catch { /* sin almacenamiento */ }
    const paintJb = () => {
      q('jl').innerHTML = clips.map((c, i) => `<li><span>${esc(c.name)}</span><button type="button" data-a="m" data-i="${i}">Música</button><button type="button" data-a="l" data-i="${i}">Ambiente</button><button type="button" data-a="x" data-i="${i}">Quitar</button></li>`).join('') || '<li class="det">Vacía</li>';
    };
    paintJb();
    const importFiles = async (inp: HTMLInputElement) => {
      const fs = [...inp.files ?? []].filter(f => f.type.startsWith('audio/') && f.size <= MAX_UPLOAD);
      let n = 0;
      for (const f of fs) {
        st(`Subiendo ${++n}/${fs.length}…`);
        try { clips.push({ name: f.name.replace(/\.[^.]+$/, '').slice(0, 80), url: await upload(o.code, f) }); } catch (er) { st((er as Error).message); break; }
      }
      inp.value = '';
      try { localStorage.setItem(jkey, JSON.stringify(clips)); } catch { /* sin almacenamiento */ }
      paintJb(); if (n === fs.length) st(fs.length ? `${n} archivo(s) importados` : 'No hay audio válido (máx. 30 MB por archivo)');
    };
    q('jf').onchange = () => importFiles(q<HTMLInputElement>('jf'));
    q('jd').onchange = () => importFiles(q<HTMLInputElement>('jd'));
    q('jl').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button'), c = clips[+(b?.dataset.i ?? -1)];
      if (!b || !c) return;
      if (b.dataset.a === 'm') o.send({ t: 'audio', op: 'play', url: c.url, name: c.name, loop: q<HTMLInputElement>('ml').checked });
      else if (b.dataset.a === 'l') o.send({ t: 'audio', op: 'layer', layer: { id: rid(), url: c.url, name: c.name, volume: +q<HTMLInputElement>('lv').value / 100 } });
      else { clips.splice(+b.dataset.i!, 1); try { localStorage.setItem(jkey, JSON.stringify(clips)); } catch { /* sin almacenamiento */ } paintJb(); }
    });
  }

  let sig = '';
  return {
    render(s: ClientState) {
      cur = s;
      const set = (id: string, v: string) => { const e = q<HTMLInputElement>(id); if (document.activeElement !== e) e.value = v; };
      if (staff) {
        const w = s.scene.weather;
        set('name', s.scene.name); set('luz', String(Math.round(s.scene.globalLight * 100)));
        set('wk', w?.kind ?? 'none'); set('wi', String(Math.round((w?.intensity ?? 0.5) * 100))); set('ww', String(Math.round((w?.wind ?? 0) * 100)));
        if (!q('pl').contains(document.activeElement)) q('pl').innerHTML = (s.scene.story?.layers ?? []).map((l, n) =>
          `<li><span>Capa ${n + 1}</span><input type="range" min="0" max="100" value="${Math.round(l.depth * 100)}" data-n="${n}" aria-label="Profundidad de la capa ${n + 1}">
          <button type="button" data-a="up" data-n="${n}" aria-label="Subir capa ${n + 1} hacia delante">↑</button><button type="button" data-a="rm" data-n="${n}">Quitar<span class="sr"> capa ${n + 1}</span></button></li>`).join('') || '<li class="det">Sin capas de parallax</li>';
        set('stt', s.scene.story?.title ?? ''); set('sts', s.scene.story?.subtitle ?? '');
      }
      const t = s.audio.track;
      q('cur').textContent = t ? `${t.pausedAt != null ? 'En pausa' : 'Suena'}: ${t.name}${t.loop ? ' (en bucle)' : ''}` : 'Nada suena';
      const k = JSON.stringify(s.audio.layers as AudioState['layers']);
      if (k === sig) return;
      sig = k;
      q('ls').innerHTML = s.audio.layers.length ? s.audio.layers.map(l =>
        `<li><span>${esc(l.name)}</span><input type="range" min="0" max="100" value="${Math.round(l.volume * 100)}" data-id="${esc(l.id)}" aria-label="Volumen de ${esc(l.name)}">
        <button type="button" data-q="${esc(l.id)}">Quitar<span class="sr"> ${esc(l.name)}</span></button></li>`).join('') : '<li class="det">Sin capas</li>';
    },
  };
}
