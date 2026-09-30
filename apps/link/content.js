// Puente página <-> background. Solo actúa si la página lleva <meta name="lantern" content="1"> y, además, el usuario
// ha autorizado este origen (se pregunta una vez; la lista vive en el background).
(async () => {
  if (!document.querySelector('meta[name="lantern"][content="1"]')) return;
  const FORWARD = new Set(['ping', 'getCharacter', 'searchMonsters', 'getMonster', 'gameLogRoll']);   // authorize/authorized nunca vienen de la página
  const ask = (m) => chrome.runtime.sendMessage(m).catch(() => ({ t: 'error', msg: 'La extensión Lantern Link no responde' }));
  if (!(await ask({ t: 'authorized' })).ok) {
    if (!confirm(`Lantern Link: ¿permitir que ${location.origin} use tu sesión de D&D Beyond?\nAcepta solo si es tu servidor de Lantern.`)) return;
    await ask({ t: 'authorize' });
  }
  window.addEventListener('message', async (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.lantern !== 'link' || m.dir !== 'req' || !FORWARD.has(m.t)) return;
    const res = await ask({ t: m.t, id: m.id, query: m.query, characterId: m.characterId, roll: m.roll });
    window.postMessage({ ...res, lantern: 'link', dir: 'res', rid: m.rid }, window.location.origin);
  });
})();
