// Cuentas opcionales (recuperar tus mesas en otro dispositivo).
// Montaje: en la pantalla de unirse, `mountAccount(main)` (p. ej. al final de mountJoin, con el <main> ya creado).
// Al entrar en una mesa con éxito (welcome), el orquestador llama `linkCurrentTable(code, key)`; sin sesión no hace nada.
// Los estilos usan las clases existentes (dialog, panel, primary, secondary, err, sub) y solo añade `.cuenta-*` mínimos inline.
const H = { 'x-lantern': '1', 'content-type': 'application/json' };
async function api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch('/api/account' + path, { method, headers: H, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** Vincula la mesa actual a la cuenta si hay sesión. Devuelve true si quedó vinculada. */
export async function linkCurrentTable(code: string, key: string): Promise<boolean> {
  try { return (await api('POST', '/link', { code, key })).status === 200; } catch { return false; }
}

export function mountAccount(el: HTMLElement, current?: { code: string; key: string }) {
  const a = document.createElement('a');
  a.href = '#cuenta'; a.textContent = 'Mi cuenta (opcional)'; a.className = 'sub';
  a.setAttribute('role', 'button');
  const dlg = document.createElement('dialog');
  dlg.setAttribute('aria-labelledby', 'cuenta-t');
  el.append(a, dlg);
  a.onclick = e => { e.preventDefault(); void render(); dlg.showModal(); };
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // clic en el fondo
  const q = <T extends HTMLElement>(s: string) => dlg.querySelector<T>(s)!;
  const msg = (t: string, ok = false) => { const p = q('#cuenta-msg'); p.textContent = t; p.hidden = !t; p.style.color = ok ? 'var(--txt2)' : ''; };
  const form = (id: string, inner: string) => `<form id="${id}" style="display:grid;gap:12px">${inner}</form>`;
  const field = (n: string, label: string, type = 'text', extra = '') => `<label>${label}<input name="${n}" type="${type}" required ${extra}></label>`;
  const head = (t: string) => `<h2 id="cuenta-t">${t}</h2><p id="cuenta-msg" role="alert" class="err" hidden></p>`;
  const close = `<button type="button" class="secondary" id="cerrar">Cerrar</button>`;
  const fd = (f: HTMLFormElement) => Object.fromEntries(new FormData(f)) as Record<string, string>;
  const send = async (path: string, body: unknown) => { try { return await api('POST', path, body); } catch { return { status: 0, data: { error: 'Sin conexión con el servidor.' } }; } };

  async function render() {
    let me: any = null;
    try { const r = await api('GET', '/me'); if (r.status === 200) me = r.data; } catch { /* sin servidor */ }
    me ? logged(me) : anon('entrar');
    q('#cerrar').onclick = () => dlg.close();
  }

  function anon(tab: 'entrar' | 'crear', need2fa = false) {
    const login = tab === 'entrar';
    dlg.innerHTML = head('Mi cuenta') + `
      <div role="tablist" style="display:flex;gap:8px;margin-bottom:12px">
        <button type="button" role="tab" id="t-entrar" aria-selected="${login}" class="${login ? 'primary' : 'secondary'}">Entrar</button>
        <button type="button" role="tab" id="t-crear" aria-selected="${!login}" class="${login ? 'secondary' : 'primary'}">Crear cuenta</button>
      </div>` + (login
      ? form('f', field('email', 'Correo', 'email', 'autocomplete="username"') + field('password', 'Contraseña', 'password', 'autocomplete="current-password"')
        + (need2fa ? field('totp', 'Código de verificación (6 dígitos)', 'text', 'inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" autofocus') : '')
        + '<button class="primary" type="submit">Entrar</button>')
      : form('f', field('name', 'Nombre', 'text', 'maxlength="32" autocomplete="nickname"') + field('email', 'Correo', 'email', 'autocomplete="username"')
        + field('password', 'Contraseña (mínimo 10 caracteres)', 'password', 'minlength="10" autocomplete="new-password"') + '<button class="primary" type="submit">Crear cuenta</button>'))
      + close;
    q('#cerrar').onclick = () => dlg.close();
    q('#t-entrar').onclick = () => anon('entrar'); q('#t-crear').onclick = () => anon('crear');
    q<HTMLFormElement>('#f').onsubmit = async e => {
      e.preventDefault();
      const b = fd(e.target as HTMLFormElement);
      const r = await send(login ? '/login' : '/register', b);
      if (r.status === 200) return void render();
      if (r.data.need2fa) { anon('entrar', true); q<HTMLInputElement>('[name=email]').value = b.email; q<HTMLInputElement>('[name=password]').value = b.password; return msg('Introduce el código de tu app de autenticación.', true); }
      msg(r.data.error ?? 'No se pudo completar la operación.');
    };
  }

  async function logged(me: { email: string; name: string; has2fa: boolean }) {
    const tables = (await api('GET', '/tables').catch(() => null))?.data;
    const list = Array.isArray(tables) && tables.length
      ? `<ul style="list-style:none;padding:0;margin:0;display:grid;gap:8px">${tables.map((t: any) => `<li style="display:flex;gap:8px;align-items:center;justify-content:space-between"><span><b class="mono">${esc(t.code)}</b> ${esc(t.name)} <small>(${esc(t.role)})</small></span><button type="button" class="secondary" data-code="${esc(t.code)}">Entrar</button></li>`).join('')}</ul>`
      : '<p class="sub">Aún no has vinculado ninguna mesa.</p>';
    dlg.innerHTML = head(`Hola, ${esc(me.name)}`) + `
      <div style="display:grid;gap:16px">
        <p class="sub">${esc(me.email)}</p>
        <section aria-labelledby="h-mesas"><h3 id="h-mesas">Mis mesas</h3>${list}</section>
        ${current ? '<button type="button" class="secondary" id="vincular">Vincular esta mesa</button>' : ''}
        <section aria-labelledby="h-2fa"><h3 id="h-2fa">Verificación en dos pasos</h3><div id="s2fa"></div></section>
        <button type="button" class="secondary" id="salir">Cerrar sesión</button>
        ${close}
      </div>`;
    q('#cerrar').onclick = () => dlg.close();
    dlg.querySelectorAll<HTMLButtonElement>('[data-code]').forEach(b => b.onclick = async () => {
      const code = b.dataset.code!;
      const r = await send(`/tables/${code}/key`, {});
      if (r.status !== 200) return msg(r.data.error ?? 'No se pudo obtener acceso.');
      try { localStorage.setItem(`lantern:key:${code}`, r.data.key); } catch { return msg('El navegador no permite guardar la clave.'); }
      location.search = '?code=' + code;
    });
    if (current) q('#vincular').onclick = async () => msg(await linkCurrentTable(current.code, current.key) ? 'Mesa vinculada.' : 'No se pudo vincular la mesa.', true);
    q('#salir').onclick = async () => { await send('/logout', {}); void render(); };
    twoFa(me.has2fa);
  }

  function twoFa(on: boolean) {
    const box = q('#s2fa');
    if (on) {
      box.innerHTML = form('f2', '<p class="sub">Activada.</p>' + field('password', 'Contraseña', 'password', 'autocomplete="current-password"')
        + field('totp', 'Código de 6 dígitos', 'text', 'inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code"') + '<button class="secondary" type="submit">Desactivar 2FA</button>');
      q<HTMLFormElement>('#f2').onsubmit = async e => {
        e.preventDefault();
        const r = await send('/2fa/disable', fd(e.target as HTMLFormElement));
        r.status === 200 ? void render() : msg(r.data.error ?? 'No se pudo desactivar.');
      };
      return;
    }
    box.innerHTML = '<button type="button" class="secondary" id="setup">Activar 2FA</button>';
    q('#setup').onclick = async () => {
      const r = await send('/2fa/setup', {});
      if (r.status !== 200) return msg(r.data.error ?? 'No se pudo iniciar el 2FA.');
      box.innerHTML = `<p class="sub">Añade esta cuenta en tu app de autenticación (introduce el secreto o pega el enlace) y escribe el código que muestre.</p>
        <label>Secreto<input readonly class="mono" value="${esc(r.data.secret)}"></label>
        <label>Enlace otpauth<input readonly class="mono" value="${esc(r.data.otpauth)}"></label>` +
        form('f3', field('totp', 'Código de 6 dígitos', 'text', 'inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code"') + '<button class="primary" type="submit">Confirmar y activar</button>');
      box.querySelectorAll('input[readonly]').forEach(i => (i as HTMLInputElement).onfocus = () => (i as HTMLInputElement).select());
      q<HTMLFormElement>('#f3').onsubmit = async e => {
        e.preventDefault();
        const r2 = await send('/2fa/enable', fd(e.target as HTMLFormElement));
        r2.status === 200 ? void render() : msg(r2.data.error ?? 'Código incorrecto.');
      };
    };
  }
}
