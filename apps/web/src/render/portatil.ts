// Modo portátil (ahorro de batería): ajuste local del cliente. Fuerza LITE, limita a 30 fps y apaga el postproceso.
// Se lee al cargar el módulo, así que cambiarlo recarga la página.
const KEY = 'lantern:portatil';
export const PORTATIL = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
export const MAX_FPS_PORTATIL = 30;
export function setPortatil(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* sin almacenamiento */ }
  location.reload();
}
