// Tipos de daño: nombre, color e icono SVG de trazo (24×24) para tarjetas y números flotantes. El estilo del icono (.dmg-ic) lo pone el CSS.
import { DAMAGE_ES } from '@lantern/srd';

const P = (d: string) => `<path d="${d}"/>`;
export const DMG_TYPES: Record<string, { color: string; icon: string }> = {
  bludgeoning: { color: '#B8A48A', icon: P('M14 3l7 7-3 3-7-7z') + P('M13 9L4 18l2 2 9-9') },
  piercing: { color: '#CFC8B8', icon: P('M12 2l4 6h-3v14h-2V8H8z') },
  slashing: { color: '#D98C7A', icon: P('M5 4l6 16') + P('M10 3l6 16') + P('M15 2l6 16') },
  fire: { color: '#F58A3C', icon: P('M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z') },
  cold: { color: '#8FD3F5', icon: P('M12 2v20') + P('M4 7l16 10') + P('M20 7L4 17') },
  lightning: { color: '#F2E45A', icon: P('M13 2L5 14h6l-1 8 8-12h-6z') },
  acid: { color: '#A5D65A', icon: P('M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z') + P('M10 15a2 2 0 0 0 2 2') },
  poison: { color: '#6FCB7C', icon: P('M6 11a6 6 0 0 1 12 0v3l-2 1v3H8v-3l-2-1z') + P('M10 12h.01') + P('M14 12h.01') },
  necrotic: { color: '#9DBB86', icon: P('M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z') },
  radiant: { color: '#FFE08A', icon: '<circle cx="12" cy="12" r="4"/>' + P('M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2') },
  force: { color: '#C29CF5', icon: P('M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z') },
  psychic: { color: '#EE8CCB', icon: P('M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z') + '<circle cx="12" cy="12" r="3"/>' },
  thunder: { color: '#8FA6F7', icon: P('M4 9v6h3l5 4V5L7 9z') + P('M16 9a4 4 0 0 1 0 6') + P('M19 6a8 8 0 0 1 0 12') },
};
const FALLBACK = '#D3C3A6'; // desconocidos

export const dmgName = (t?: string) => (t && DAMAGE_ES[t]) || t || '';
export const dmgColor = (t?: string) => (t && DMG_TYPES[t]?.color) || FALLBACK;
/** SVG completo del icono con el trazo en `color` (para Pixi: Graphics.svg no entiende currentColor). */
export const dmgSvg = (t: string | undefined, color = 'currentColor') => {
  const i = t && DMG_TYPES[t];
  return i ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${i.icon}</svg>` : '';
};
/** Icono en línea para HTML (hereda el color del texto). */
export const dmgIcon = (t?: string, px = 14) => {
  const s = dmgSvg(t);
  return s ? s.replace('<svg ', `<svg class="dmg-ic" width="${px}" height="${px}" aria-hidden="true" `).replace(' width="24" height="24"', '') : '';
};
