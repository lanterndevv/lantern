import type { S2C } from '@lantern/protocol';
import { CODE_ALPHABET } from '@lantern/protocol';
import { net, savedName, savedKey, recentCodes, forgetKey } from '../net.ts';
import { mountAccount } from './account.ts';
import { PREGENS, CLASSES, pregenToImported } from '@lantern/srd';
import { parseSheetJson } from './sheetx.ts';
import { t, tsrv } from '../i18n.ts';

// El personaje elegido aquí se aplica al entrar en la mesa (extras.ts lo envía con myChar).
export const PENDING_CHAR = 'lantern:pending-char';

// Acepta el código suelto o el enlace de invitación entero (…?code=XXXXXX).
const clean = (s: string) => [...(s.match(/code=([^&#\s]+)/i)?.[1] ?? s).toUpperCase()].filter(c => CODE_ALPHABET.includes(c)).join('').slice(0, 6);
const fmt = (c: string) => c.length > 3 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;

export function mountJoin(app: HTMLElement) {
  const main = document.createElement('main');
  main.className = 'unirse';
  main.innerHTML = `
    <form class="panel" id="f">
      <h1>${t('Únete a la mesa')}</h1>
      <p class="sub">${t('Escribe el código que te dio tu DM.')}</p>
      <label>${t('Código de la mesa')}
        <input id="code" class="mono" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${t('K7Q-4ZP o enlace')}" inputmode="text">
      </label>
      <label>${t('Tu nombre')}
        <input id="name" autocomplete="nickname" maxlength="24" required>
      </label>
      <label>${t('Personaje inicial (opcional)')}
        <select id="pre"><option value="">${t('Lo elegiré después')}</option>${Object.entries(PREGENS).map(([id, p]) => `<option value="${id}">${p.name} — ${CLASSES[p.class]?.name ?? p.class} (${t('pregenerado')})</option>`).join('')}<option value="json">${t('Importar hoja JSON…')}</option></select>
      </label>
      <input type="file" id="prej" accept=".json,application/json" hidden>
      <p id="err" role="alert" class="err" hidden></p>
      <button class="primary" type="submit">${t('Entrar')}</button>
      <button class="secondary" type="button" id="new">${t('Crear mesa nueva (serás DM)')}</button>
      <section id="rec" aria-labelledby="rec-t" hidden><h2 id="rec-t">${t('Mesas recientes')}</h2><ul id="recl"></ul></section>
      <ul class="chips"><li>${t('Sin cuenta')}</li><li>${t('Sin instalar nada')}</li><li>${t('Gratis para jugadores')}</li></ul>
    </form>`;
  app.append(main);
  const $ = <T extends HTMLElement>(id: string) => main.querySelector<T>('#' + id)!;
  const code = $<HTMLInputElement>('code'), name = $<HTMLInputElement>('name'), err = $('err');
  name.value = savedName();
  code.value = fmt(clean(new URLSearchParams(location.search).get('code') ?? ''));
  code.oninput = () => { code.value = fmt(clean(code.value)); };
  const fail = (m: string) => { err.textContent = m; err.hidden = false; };

  let sheet = '';
  const pre = $<HTMLSelectElement>('pre'), prej = $<HTMLInputElement>('prej');
  pre.onchange = () => { if (pre.value === 'json') prej.click(); else sheet = ''; };
  prej.onchange = async () => {
    const f = prej.files?.[0]; prej.value = '';
    try { const c = parseSheetJson(await f!.text()); sheet = JSON.stringify(c); pre.options[pre.selectedIndex].text = t('Hoja: {name}', { name: c.name }); err.hidden = true; }
    catch (e) { sheet = ''; pre.value = ''; fail((e as Error).message); }
  };
  const keep = () => {
    try {
      if (pre.value === 'json' && sheet) sessionStorage.setItem(PENDING_CHAR, sheet);
      else if (pre.value && PREGENS[pre.value]) sessionStorage.setItem(PENDING_CHAR, JSON.stringify(pregenToImported(PREGENS[pre.value])));
      else sessionStorage.removeItem(PENDING_CHAR);
    } catch { /* sin almacenamiento */ }
  };
  $('f').onsubmit = e => {
    e.preventDefault();
    const c = clean(code.value);
    if (c.length !== 6) return fail(t('El código tiene 6 caracteres.')), code.focus();
    err.hidden = true; keep();
    net.send({ t: 'join', code: c, name: name.value.trim() });
  };
  $('new').onclick = () => {
    if (!name.reportValidity()) return;
    err.hidden = true;
    try { sessionStorage.removeItem(PENDING_CHAR); } catch { /* sin almacenamiento */ }
    net.send({ t: 'join', name: name.value.trim() });
  };
  // Mesas recientes: las keys guardadas; un clic vuelve a entrar y «Olvidar» borra la key.
  const recientes = () => {
    const cs = recentCodes(), ul = $('recl');
    $('rec').hidden = !cs.length;
    ul.replaceChildren(...cs.map(c => {
      const li = document.createElement('li'), go = document.createElement('button'), del = document.createElement('button');
      go.type = del.type = 'button'; go.className = 'secondary'; del.className = 'secondary';
      go.textContent = `${t('Entrar')} ${fmt(c)}`;
      go.onclick = () => { err.hidden = true; net.send({ t: 'join', code: c, name: name.value.trim() || savedName() || 'DM', key: savedKey(c) ?? undefined }); };
      del.textContent = t('Olvidar'); del.setAttribute('aria-label', t('Olvidar la mesa {code}', { code: fmt(c) }));
      del.onclick = () => { forgetKey(c); recientes(); };
      li.append(go, del);
      return li;
    }));
  };
  recientes();
  mountAccount(main); // cuentas opcionales: «Mis mesas» en cualquier dispositivo
  return { handle(m: S2C) { if (m.t === 'error') fail(tsrv(m.msg) + (m.re && m.msg === 'mensaje inválido' ? ` (${m.re})` : '')); } };
}
