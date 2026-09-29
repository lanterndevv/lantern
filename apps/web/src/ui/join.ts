import type { S2C } from '@lantern/protocol';
import { CODE_ALPHABET } from '@lantern/protocol';
import { net, savedName } from '../net.ts';

// Acepta el código suelto o el enlace de invitación entero (…?code=XXXXXX).
const clean = (s: string) => [...(s.match(/code=([^&#\s]+)/i)?.[1] ?? s).toUpperCase()].filter(c => CODE_ALPHABET.includes(c)).join('').slice(0, 6);
const fmt = (c: string) => c.length > 3 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;

export function mountJoin(app: HTMLElement) {
  const main = document.createElement('main');
  main.className = 'unirse';
  main.innerHTML = `
    <form class="panel" id="f">
      <h1>Únete a la mesa</h1>
      <p class="sub">Escribe el código que te dio tu DM.</p>
      <label>Código de la mesa
        <input id="code" class="mono" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="K7Q-4ZP o enlace" inputmode="text">
      </label>
      <label>Tu nombre
        <input id="name" autocomplete="nickname" maxlength="24" required>
      </label>
      <p id="err" role="alert" class="err" hidden></p>
      <button class="primary" type="submit">Entrar</button>
      <button class="secondary" type="button" id="new">Crear mesa nueva (serás DM)</button>
      <ul class="chips"><li>Sin cuenta</li><li>Sin instalar nada</li><li>Gratis para jugadores</li></ul>
    </form>`;
  app.append(main);
  const $ = <T extends HTMLElement>(id: string) => main.querySelector<T>('#' + id)!;
  const code = $<HTMLInputElement>('code'), name = $<HTMLInputElement>('name'), err = $('err');
  name.value = savedName();
  code.value = fmt(clean(new URLSearchParams(location.search).get('code') ?? ''));
  code.oninput = () => { code.value = fmt(clean(code.value)); };
  const fail = (m: string) => { err.textContent = m; err.hidden = false; };

  $('f').onsubmit = e => {
    e.preventDefault();
    const c = clean(code.value);
    if (c.length !== 6) return fail('El código tiene 6 caracteres.'), code.focus();
    err.hidden = true;
    net.send({ t: 'join', code: c, name: name.value.trim() });
  };
  $('new').onclick = () => {
    if (!name.reportValidity()) return;
    err.hidden = true;
    net.send({ t: 'join', name: name.value.trim() });
  };
  return { handle(m: S2C) { if (m.t === 'error') fail(m.msg); } };
}
