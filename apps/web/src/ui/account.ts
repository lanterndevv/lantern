import { t, tsrv } from '../i18n.ts';
import { saveName, savedName } from '../net.ts';
// Cuentas opcionales (recuperar tus mesas en otro dispositivo).
// Montaje: en la pantalla de unirse, `mountAccount(main)` (p. ej. al final de mountJoin, con el <main> ya creado).
// Al entrar en una mesa con éxito (welcome), el orquestador llama `linkCurrentTable(code, key)`; sin sesión no hace nada.
// Los estilos usan las clases existentes (dialog, panel, primary, secondary, err, sub) y solo añade `.cuenta-*` mínimos inline.
const H = { 'x-lantern': '1', 'content-type': 'application/json' };
async function api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch('/api/account' + path, { method, headers: H, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
// ---- passkeys (WebAuthn): el servidor manda base64url; el navegador quiere ArrayBuffer ----
const toBuf = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const toB64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
type Opts = { challenge: string; rpId: string; allowCredentials?: string[] };
async function getAssertion(o: Opts, uv: boolean) {
  const c = await navigator.credentials.get({ publicKey: { challenge: toBuf(o.challenge), rpId: o.rpId, userVerification: uv ? 'required' : 'preferred', timeout: 60000,
    allowCredentials: (o.allowCredentials ?? []).map(id => ({ type: 'public-key' as const, id: toBuf(id) })) } }) as PublicKeyCredential | null;
  if (!c) throw new Error('cancelado');
  const r = c.response as AuthenticatorAssertionResponse;
  return { id: c.id, clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.authenticatorData), signature: toB64(r.signature) };
}
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** Vincula la mesa actual a la cuenta si hay sesión. Devuelve true si quedó vinculada. */
export async function linkCurrentTable(code: string, key: string): Promise<boolean> {
  try { return (await api('POST', '/link', { code, key })).status === 200; } catch { return false; }
}

export function mountAccount(el: HTMLElement, current?: { code: string; key: string }) {
  const a = document.createElement('a');
  a.href = '#cuenta'; a.textContent = t('Mi cuenta (opcional)'); a.className = 'sub';
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
  const close = `<button type="button" class="secondary" id="cerrar">${t('Cerrar')}</button>`;
  const fd = (f: HTMLFormElement) => Object.fromEntries(new FormData(f)) as Record<string, string>;
  const send = async (path: string, body: unknown) => { try { return await api('POST', path, body); } catch { return { status: 0, data: { error: t('Sin conexión con el servidor.') } }; } };

  async function render() {
    let me: any = null;
    try { const r = await api('GET', '/me'); if (r.status === 200) me = r.data; } catch { /* sin servidor */ }
    me ? logged(me) : anon('entrar');
    q('#cerrar').onclick = () => dlg.close();
  }

  function anon(tab: 'entrar' | 'crear', f2?: { totp: boolean; passkey?: Opts }) {
    const login = tab === 'entrar', need2fa = !!f2;
    dlg.innerHTML = head(t('Mi cuenta')) + `
      <div role="tablist" style="display:flex;gap:8px;margin-bottom:12px">
        <button type="button" role="tab" id="t-entrar" aria-selected="${login}" class="${login ? 'primary' : 'secondary'}">${t('Entrar')}</button>
        <button type="button" role="tab" id="t-crear" aria-selected="${!login}" class="${login ? 'secondary' : 'primary'}">${t('Crear cuenta')}</button>
      </div>` + (login
      ? form('f', field('email', t('Correo'), 'email', 'autocomplete="username"') + field('password', t('Contraseña'), 'password', 'autocomplete="current-password"')
        + (f2?.totp ? field('totp', t('Código de verificación (6 dígitos)'), 'text', 'inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" autofocus') : '')
        + (f2?.passkey ? '<button class="secondary" type="button" id="pk2">' + t('Verificar con passkey') + '</button>' : '')
        + (f2?.totp || !f2 ? '<button class="primary" type="submit">' + t('Entrar') + '</button>' : '')
        + (f2 ? '' : '<button class="secondary" type="button" id="pk-login">' + t('Entrar con passkey (sin contraseña)') + '</button>'))
      : form('f', field('name', t('Nombre'), 'text', 'maxlength="32" autocomplete="nickname"') + field('email', t('Correo'), 'email', 'autocomplete="username"')
        + field('password', t('Contraseña (mínimo 10 caracteres)'), 'password', 'minlength="10" autocomplete="new-password"') + '<button class="primary" type="submit">' + t('Crear cuenta') + '</button>'))
      + close;
    q('#cerrar').onclick = () => dlg.close();
    q('#t-entrar').onclick = () => anon('entrar'); q('#t-crear').onclick = () => anon('crear');
    const pkErr = (e: unknown) => msg(e instanceof DOMException && e.name === 'NotAllowedError' ? t('Passkey cancelada o no disponible.') : t('No se pudo usar la passkey.'));
    if (login && !f2) q('#pk-login').onclick = async () => {
      if (!window.PublicKeyCredential) return msg(t('Este navegador no admite passkeys.'));
      try {
        const o = await send('/passkey/login/options', {});
        const r = await send('/passkey/login', await getAssertion(o.data, true));
        r.status === 200 ? void render() : msg(r.data.error ? tsrv(r.data.error) : t('Passkey inválida.'));
      } catch (e) { pkErr(e); }
    };
    q<HTMLFormElement>('#f').onsubmit = async e => {
      e.preventDefault();
      const b = fd(e.target as HTMLFormElement);
      const r = await send(login ? '/login' : '/register', b);
      if (r.status === 200) return void render();
      if (r.data.need2fa) {
        anon('entrar', { totp: !!r.data.totp, passkey: r.data.passkey }); q<HTMLInputElement>('[name=email]').value = b.email; q<HTMLInputElement>('[name=password]').value = b.password;
        const pk = q('#pk2') as HTMLButtonElement | null;
        if (pk) pk.onclick = async () => { // el segundo factor reenvía correo y contraseña con la aserción
          try {
            const r2 = await send('/login', { email: b.email, password: b.password, passkey: await getAssertion(r.data.passkey, false) });
            r2.status === 200 ? void render() : msg(r2.data.error ? tsrv(r2.data.error) : t('Passkey inválida.'));
          } catch (e2) { pkErr(e2); }
        };
        return msg(r.data.totp ? t('Introduce el código de tu app o usa una passkey.') : t('Verifica con tu passkey.'), true);
      }
      msg(r.data.error ? tsrv(r.data.error) : t('No se pudo completar la operación.'));
    };
  }

  async function logged(me: { email: string; name: string; has2fa: boolean; passkeys?: number }) {
    const tables = (await api('GET', '/tables').catch(() => null))?.data;
    const list = Array.isArray(tables) && tables.length
      ? `<ul style="list-style:none;padding:0;margin:0;display:grid;gap:8px">${tables.map((tb: any) => `<li style="display:flex;gap:8px;align-items:center;justify-content:space-between"><span><b class="mono">${esc(tb.code)}</b> ${esc(tb.name)} <small>(${esc(tb.role)})</small></span><button type="button" class="secondary" data-code="${esc(tb.code)}">${t('Entrar')}</button></li>`).join('')}</ul>`
      : `<p class="sub">${t('Aún no has vinculado ninguna mesa.')}</p>`;
    dlg.innerHTML = head(t('Hola, {n}', { n: esc(me.name) })) + `
      <div style="display:grid;gap:16px">
        <p class="sub">${esc(me.email)}</p>
        <section aria-labelledby="h-mesas"><h3 id="h-mesas">${t('Mis mesas')}</h3>${list}</section>
        ${current ? `<button type="button" class="secondary" id="vincular">${t('Vincular esta mesa')}</button>` : ''}
        <section aria-labelledby="h-2fa"><h3 id="h-2fa">${t('Verificación en dos pasos')}</h3><div id="s2fa"></div></section>
        <section aria-labelledby="h-pk"><h3 id="h-pk">Passkeys</h3><div id="spk"></div></section>
        <button type="button" class="secondary" id="salir">${t('Cerrar sesión')}</button>
        ${close}
      </div>`;
    q('#cerrar').onclick = () => dlg.close();
    dlg.querySelectorAll<HTMLButtonElement>('[data-code]').forEach(b => b.onclick = async () => {
      const code = b.dataset.code!;
      const r = await send(`/tables/${code}/key`, {});
      if (r.status !== 200) return msg(r.data.error ? tsrv(r.data.error) : t('No se pudo obtener acceso.'));
      try { localStorage.setItem(`lantern:key:${code}`, r.data.key); } catch { return msg(t('El navegador no permite guardar la clave.')); }
      if (!savedName()) saveName(me.name); // en un dispositivo nuevo, para que ?code= entre solo con la key
      location.search = '?code=' + code;
    });
    if (current) q('#vincular').onclick = async () => msg(await linkCurrentTable(current.code, current.key) ? t('Mesa vinculada.') : t('No se pudo vincular la mesa.'), true);
    q('#salir').onclick = async () => { await send('/logout', {}); void render(); };
    twoFa(me.has2fa);
    void passkeys();
  }

  async function passkeys() {
    const box = q('#spk'), list = (await api('GET', '/passkeys').catch(() => null))?.data;
    box.innerHTML = `<p class="sub">${t('Con una passkey registrada, la contraseña necesita además la passkey (o el código 2FA). También puedes entrar sin contraseña.')}</p>`
      + (Array.isArray(list) && list.length ? `<ul style="list-style:none;padding:0;margin:0 0 8px;display:grid;gap:8px">${list.map((p: any) => `<li style="display:flex;gap:8px;align-items:center;justify-content:space-between"><span>${esc(p.name)}</span><button type="button" class="secondary" data-pk="${esc(p.id)}">${t('Quitar')}</button></li>`).join('')}</ul>` : '')
      + `<button type="button" class="secondary" id="pk-add">${t('Añadir passkey')}</button>`;
    box.querySelectorAll<HTMLButtonElement>('[data-pk]').forEach(b => b.onclick = async () => {
      const password = prompt(t('Contraseña para quitar la passkey'));
      if (!password) return;
      const r = await send('/passkey/delete', { id: b.dataset.pk, password });
      r.status === 200 ? void passkeys() : msg(r.data.error ? tsrv(r.data.error) : t('No se pudo quitar.'));
    });
    q('#pk-add').onclick = async () => {
      if (!window.PublicKeyCredential) return msg(t('Este navegador no admite passkeys.'));
      try {
        const o = (await send('/passkey/register/options', {})).data;
        if (o.error) return msg(tsrv(o.error));
        const c = await navigator.credentials.create({ publicKey: { challenge: toBuf(o.challenge), rp: o.rp, user: { ...o.user, id: toBuf(o.user.id) }, pubKeyCredParams: o.pubKeyCredParams, timeout: 60000,
          excludeCredentials: o.excludeCredentials.map((id: string) => ({ type: 'public-key' as const, id: toBuf(id) })), authenticatorSelection: o.authenticatorSelection, attestation: 'none' } }) as PublicKeyCredential | null;
        if (!c) return;
        const r = c.response as AuthenticatorAttestationResponse;
        const res = await send('/passkey/register', { id: c.id, clientDataJSON: toB64(r.clientDataJSON), attestationObject: toB64(r.attestationObject), name: prompt(t('Nombre para esta passkey'), 'Passkey')?.slice(0, 40) ?? 'Passkey' });
        res.status === 200 ? void passkeys() : msg(res.data.error ? tsrv(res.data.error) : t('No se pudo registrar la passkey.'));
      } catch (e) { msg(e instanceof DOMException && e.name === 'NotAllowedError' ? t('Registro cancelado.') : t('No se pudo crear la passkey.')); }
    };
  }

  function twoFa(on: boolean) {
    const box = q('#s2fa');
    if (on) {
      box.innerHTML = form('f2', `<p class="sub">${t('Activada.')}</p>` + field('password', t('Contraseña'), 'password', 'autocomplete="current-password"')
        + field('totp', t('Código de 6 dígitos'), 'text', 'inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code"') + `<button class="secondary" type="submit">${t('Desactivar 2FA')}</button>`);
      q<HTMLFormElement>('#f2').onsubmit = async e => {
        e.preventDefault();
        const r = await send('/2fa/disable', fd(e.target as HTMLFormElement));
        r.status === 200 ? void render() : msg(r.data.error ? tsrv(r.data.error) : t('No se pudo desactivar.'));
      };
      return;
    }
    box.innerHTML = `<button type="button" class="secondary" id="setup">${t('Activar 2FA')}</button>`;
    q('#setup').onclick = async () => {
      const r = await send('/2fa/setup', {});
      if (r.status !== 200) return msg(r.data.error ? tsrv(r.data.error) : t('No se pudo iniciar el 2FA.'));
      box.innerHTML = `<p class="sub">${t('Añade esta cuenta en tu app de autenticación (introduce el secreto o pega el enlace) y escribe el código que muestre.')}</p>
        <label>${t('Secreto')}<input readonly class="mono" value="${esc(r.data.secret)}"></label>
        <label>${t('Enlace otpauth')}<input readonly class="mono" value="${esc(r.data.otpauth)}"></label>` +
        form('f3', field('totp', t('Código de 6 dígitos'), 'text', 'inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code"') + `<button class="primary" type="submit">${t('Confirmar y activar')}</button>`);
      box.querySelectorAll('input[readonly]').forEach(i => (i as HTMLInputElement).onfocus = () => (i as HTMLInputElement).select());
      q<HTMLFormElement>('#f3').onsubmit = async e => {
        e.preventDefault();
        const r2 = await send('/2fa/enable', fd(e.target as HTMLFormElement));
        r2.status === 200 ? void render() : msg(r2.data.error ? tsrv(r2.data.error) : t('Código incorrecto.'));
      };
    };
  }
}
