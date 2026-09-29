import type { C2S, SessionSummary } from '@lantern/protocol';

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const ICON: Record<SessionSummary['highlights'][number]['kind'], [string, string]> = {
  crit: ['★', 'Crítico'], fumble: ['✖', 'Pifia'], kill: ['☠', 'Derrota'], down: ['▼', 'Caído'], highest: ['▲', 'Tirada más alta'],
};
const dur = (ms: number) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

const markdown = (s: SessionSummary) => [
  `# Resumen de sesión`, '',
  `- Duración: ${dur(s.ended - s.started)}`, `- Rondas: ${s.rounds}`, ...(s.xp != null ? [`- PX: ${s.xp}`] : []), '',
  `## Destacados`, ...s.highlights.map(h => `- ${ICON[h.kind][1]}: ${h.text}`), '',
  `## Por personaje`, '| Personaje | Daño hecho | Daño recibido | Curación | Críticos |', '|---|---|---|---|---|',
  ...s.perToken.map(t => `| ${t.name} | ${t.damageDealt} | ${t.damageTaken} | ${t.healed} | ${t.crits} |`), '',
].join('\n');

export function showSummary(s: SessionSummary, send?: (m: C2S) => void) {
  const d = document.createElement('dialog');
  d.className = 'resumen'; d.setAttribute('aria-labelledby', 'rs-t');
  d.innerHTML = `<h2 id="rs-t">Fin de la sesión</h2>
    <p class="rs-datos"><span>Duración <strong>${dur(s.ended - s.started)}</strong></span><span>Rondas <strong>${s.rounds}</strong></span>${s.xp != null ? `<span>PX <strong>${s.xp}</strong></span>` : ''}</p>
    <h3>Destacados</h3>
    <ul class="rs-dest">${s.highlights.map(h => `<li><span aria-hidden="true">${ICON[h.kind][0]}</span><span class="sr">${ICON[h.kind][1]}: </span>${esc(h.text)}</li>`).join('') || '<li class="det">Sin destacados.</li>'}</ul>
    <table class="rs-tabla"><caption class="sr">Estadísticas por personaje</caption>
      <thead><tr><th scope="col">Personaje</th><th scope="col">Daño hecho</th><th scope="col">Daño recibido</th><th scope="col">Curación</th><th scope="col">Críticos</th></tr></thead>
      <tbody>${s.perToken.map(t => `<tr><th scope="row">${esc(t.name)}</th><td>${t.damageDealt}</td><td>${t.damageTaken}</td><td>${t.healed}</td><td>${t.crits}</td></tr>`).join('')}</tbody></table>
    ${s.tips?.length && send ? `<h3>Sugerencias</h3><ul class="rs-tips">${s.tips.map((t, i) => `<li>${esc(t.text)} <button type="button" data-tip="${i}">Activar</button></li>`).join('')}</ul>` : ''}
    <div class="rs-btns"><button type="button" data-md>Exportar a Markdown</button><button type="button" class="primary" data-x>Cerrar</button></div>`;
  d.querySelector<HTMLElement>('[data-md]')!.onclick = () => {
    const a = document.createElement('a'), u = URL.createObjectURL(new Blob([markdown(s)], { type: 'text/markdown' }));
    a.href = u; a.download = `sesion-${new Date(s.ended).toISOString().slice(0, 10)}.md`; a.click(); URL.revokeObjectURL(u);
  };
  d.querySelectorAll<HTMLButtonElement>('[data-tip]').forEach(b => { b.onclick = () => { send?.({ t: 'settings', patch: s.tips![+b.dataset.tip!].patch }); b.disabled = true; b.textContent = 'Activado'; }; });
  d.querySelector<HTMLElement>('[data-x]')!.onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  document.body.append(d); d.showModal();
}

/** DM: botón «Terminar sesión» con confirmación (confirm nativo: accesible y modal). */
export function sessionEndButton(ctx: { send(m: C2S): void }) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = 'Terminar sesión';
  b.onclick = () => { if (confirm('¿Terminar la sesión para todos? Se mostrará el resumen.')) ctx.send({ t: 'sessionEnd' }); };
  return b;
}
