// Puente página <-> background. Solo actúa si la página lleva <meta name="lantern" content="1">.
if (document.querySelector('meta[name="lantern"][content="1"]')) {
  window.addEventListener('message', async (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.lantern !== 'link' || m.dir !== 'req') return;
    let res;
    try { res = await chrome.runtime.sendMessage({ t: m.t, id: m.id, query: m.query, characterId: m.characterId, roll: m.roll }); }
    catch { res = { t: 'error', msg: 'La extensión Lantern Link no responde' }; }
    window.postMessage({ ...res, lantern: 'link', dir: 'res', rid: m.rid }, window.location.origin);
  });
}
