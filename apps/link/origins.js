// Qué orígenes pueden usar la sesión de D&D Beyond. La lista la guarda el background (chrome.storage) y el
// origen sale siempre de `sender`, nunca del mensaje: el <meta name="lantern"> no autoriza nada por sí solo.
export const originOf = (sender) => {
  try { const o = new URL(sender?.url ?? '').origin; return /^https?:\/\//.test(o) ? o : ''; } catch { return ''; }
};
export const allowed = (origin, list) => origin !== '' && Array.isArray(list) && list.includes(origin);
