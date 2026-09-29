import type { C2S, SessionSummary } from '@lantern/protocol';
import { t, tsrv } from '../i18n.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const ICON: Record<SessionSummary['highlights'][number]['kind'], [string, string]> = {
  crit: ['★', t('Crítico')], fumble: ['✖', t('Pifia')], kill: ['☠', t('Derrota')], down: ['▼', t('Caído')], highest: ['▲', t('Tirada más alta')],
};
const dur = (ms: number) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

const markdown = (s: SessionSummary) => [
  `# ${t('Resumen de sesión')}`, '',
  `- ${t('Duración')}: ${dur(s.ended - s.started)}`, `- ${t('Rondas')}: ${s.rounds}`, ...(s.xp != null ? [`- ${t('PX')}: ${s.xp}`] : []), '',
  `## ${t('Destacados')}`, ...s.highlights.map(h => `- ${ICON[h.kind][1]}: ${tsrv(h.text)}`), '',
  `## ${t('Por personaje')}`, `| ${t('Personaje')} | ${t('Daño hecho')} | ${t('Daño recibido')} | ${t('Curación')} | ${t('Críticos')} |`, '|---|---|---|---|---|',
  ...s.perToken.map(p => `| ${p.name} | ${p.damageDealt} | ${p.damageTaken} | ${p.healed} | ${p.crits} |`), '',
].join('\n');

export function showSummary(s: SessionSummary, send?: (m: C2S) => void) {
  const d = document.createElement('dialog');
  d.className = 'resumen'; d.setAttribute('aria-labelledby', 'rs-t');
  d.innerHTML = `<h2 id="rs-t">${t('Fin de la sesión')}</h2>
    <p class="rs-datos"><span>${t('Duración')} <strong>${dur(s.ended - s.started)}</strong></span><span>${t('Rondas')} <strong>${s.rounds}</strong></span>${s.xp != null ? `<span>${t('PX')} <strong>${s.xp}</strong></span>` : ''}</p>
    <h3>${t('Destacados')}</h3>
    <ul class="rs-dest">${s.highlights.map(h => `<li><span aria-hidden="true">${ICON[h.kind][0]}</span><span class="sr">${ICON[h.kind][1]}: </span>${esc(tsrv(h.text))}</li>`).join('') || `<li class="det">${t('Sin destacados.')}</li>`}</ul>
    <table class="rs-tabla"><caption class="sr">${t('Estadísticas por personaje')}</caption>
      <thead><tr><th scope="col">${t('Personaje')}</th><th scope="col">${t('Daño hecho')}</th><th scope="col">${t('Daño recibido')}</th><th scope="col">${t('Curación')}</th><th scope="col">${t('Críticos')}</th></tr></thead>
      <tbody>${s.perToken.map(p => `<tr><th scope="row">${esc(p.name)}</th><td>${p.damageDealt}</td><td>${p.damageTaken}</td><td>${p.healed}</td><td>${p.crits}</td></tr>`).join('')}</tbody></table>
    ${s.tips?.length && send ? `<h3>${t('Sugerencias')}</h3><ul class="rs-tips">${s.tips.map((tp, i) => `<li>${esc(tsrv(tp.text))} <button type="button" data-tip="${i}">${t('Activar')}</button></li>`).join('')}</ul>` : ''}
    <div class="rs-btns"><button type="button" data-md>${t('Exportar a Markdown')}</button><button type="button" class="primary" data-x>${t('Cerrar')}</button></div>`;
  d.querySelector<HTMLElement>('[data-md]')!.onclick = () => {
    const a = document.createElement('a'), u = URL.createObjectURL(new Blob([markdown(s)], { type: 'text/markdown' }));
    a.href = u; a.download = `sesion-${new Date(s.ended).toISOString().slice(0, 10)}.md`; a.click(); URL.revokeObjectURL(u);
  };
  d.querySelectorAll<HTMLButtonElement>('[data-tip]').forEach(b => { b.onclick = () => { send?.({ t: 'settings', patch: s.tips![+b.dataset.tip!].patch }); b.disabled = true; b.textContent = t('Activado'); }; });
  d.querySelector<HTMLElement>('[data-x]')!.onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  document.body.append(d); d.showModal();
}

/** DM: botón «Terminar sesión» con confirmación (confirm nativo: accesible y modal). */
export function sessionEndButton(ctx: { send(m: C2S): void }) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = t('Terminar sesión');
  b.onclick = () => { if (confirm(t('¿Terminar la sesión para todos? Se mostrará el resumen.'))) ctx.send({ t: 'sessionEnd' }); };
  return b;
}
