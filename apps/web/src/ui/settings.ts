import type { C2S, ClientState, Role, TableSettings } from '@lantern/protocol';
import { t } from '../i18n.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const ROLES: Record<Role, string> = { dm: 'DM', assistant: t('Asistente'), trusted: t('De confianza'), player: t('Jugador'), spectator: t('Espectador') };
const LAYERS: [keyof TableSettings['layers'], string][] = [
  ['lighting', t('Luz y visión')], ['initiative', t('Iniciativa')], ['automation', t('Automatización')], ['effects', t('Efectos')], ['story', t('Modo Historia')],
];
const OPT: [keyof TableSettings['optional'], string, string][] = [
  ['flanking', t('Flanqueo'), t('Ventaja al atacar con un aliado en el lado opuesto.')],
  ['heroPoints', t('Puntos de héroe'), t('Cada jugador puede repetir una tirada gastando un punto.')],
  ['brutalCrit', t('Crítico brutal'), t('Los críticos suman un dado de daño extra.')],
  ['fumbles', t('Pifias'), t('Un 1 natural en ataque tiene consecuencias.')],
  ['sideInit', t('Iniciativa por bandos'), t('Una tirada para aliados y otra para enemigos.')],
];

export function mountSettings(el: HTMLElement, send: (m: C2S) => void, myId: string) {
  let s: ClientState | undefined;
  const render = (st: ClientState) => {
    s = st;
    const focus = (document.activeElement as HTMLElement | null)?.dataset.f;
    const S = st.settings;
    const sw = (f: string, on: boolean, label: string, desc = '') =>
      `<button type="button" role="switch" class="sw" data-f="${f}" aria-checked="${on}"${desc ? ` aria-describedby="d-${f}"` : ''}><span>${label}</span><i aria-hidden="true"></i></button>${desc ? `<p class="det" id="d-${f}">${desc}</p>` : ''}`;
    const card = (m: 'simple' | 'full', ti: string, d: string) =>
      `<button type="button" role="radio" class="card" data-f="mode-${m}" data-mode="${m}" aria-checked="${S.mode === m}"><strong>${ti}</strong><span class="det">${d}</span></button>`;
    el.innerHTML = `<section aria-labelledby="st-m"><h2 id="st-m">${t('Modo de mesa')}</h2>
        <div class="cards" role="radiogroup" aria-labelledby="st-m">${card('simple', t('Sencillo'), t('Mapa, tokens, dados y chat.'))}${card('full', t('Completo'), t('Todas las capas activas.'))}</div>
        <div class="sws">${LAYERS.map(([k, n]) => sw('layer-' + k, S.layers[k], n)).join('')}</div></section>
      <section aria-labelledby="st-e"><h2 id="st-e">${t('Edición')}</h2>
        <div class="seg" role="radiogroup" aria-labelledby="st-e">${(['2014', '2024'] as const).map(v =>
          `<button type="button" role="radio" data-f="ed-${v}" data-ed="${v}" aria-checked="${S.edition === v}">${v}</button>`).join('')}</div></section>
      <section aria-labelledby="st-o"><h2 id="st-o">${t('Reglas opcionales')}</h2>${OPT.map(([k, n, d]) => sw('opt-' + k, !!S.optional[k], n, d)).join('')}</section>
      <section aria-labelledby="st-r"><h2 id="st-r">${t('Roles')}</h2><table class="roles"><thead><tr><th scope="col">${t('Miembro')}</th><th scope="col">${t('Rol')}</th></tr></thead><tbody>${st.members.map(m =>
        `<tr><th scope="row">${esc(m.name)}</th><td><select data-f="role-${esc(m.id)}" data-role="${esc(m.id)}" aria-label="${t('Rol de {name}', { name: esc(m.name) })}"${m.id === myId ? ' disabled' : ''}>${(Object.keys(ROLES) as Role[]).map(r =>
          `<option value="${r}"${m.role === r ? ' selected' : ''}>${ROLES[r]}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></section>`;
    if (focus) el.querySelector<HTMLElement>(`[data-f="${focus}"]`)?.focus();
  };
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b || !s) return;
    const f = b.dataset.f ?? '', on = b.getAttribute('aria-checked') !== 'true';
    if (b.dataset.mode) send({ t: 'settings', patch: { mode: b.dataset.mode as 'simple' | 'full' } });
    else if (b.dataset.ed) send({ t: 'settings', patch: { edition: b.dataset.ed as '2014' | '2024' } });
    else if (f.startsWith('layer-')) send({ t: 'settings', patch: { layers: { [f.slice(6)]: on } } });
    else if (f.startsWith('opt-')) send({ t: 'settings', patch: { optional: { [f.slice(4)]: on } } });
  });
  el.addEventListener('change', e => {
    const sel = e.target as HTMLSelectElement;
    if (sel.dataset.role) send({ t: 'setRole', memberId: sel.dataset.role, role: sel.value as Role });
  });
  return { render };
}
