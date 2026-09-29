import es from './lang/es.ts';
import en from './lang/en.ts';

// Interfaz ES/EN sin dependencias. La clave de t() es el propio texto en español; es.ts no necesita entradas
// (t devuelve la clave) y en.ts la traduce. Idioma: localStorage 'lantern:lang' > navigator.language (en* → en) > es.
export type Lang = 'es' | 'en';
const KEY = 'lantern:lang';
const DICT: Record<Lang, Record<string, string>> = { es, en };

export const getLang = (): Lang => {
  try { const l = localStorage.getItem(KEY); if (l === 'es' || l === 'en') return l; } catch { /* sin storage */ }
  return typeof navigator !== 'undefined' && /^en/i.test(navigator.language) ? 'en' : 'es';
};
export const lang: Lang = getLang();
if (typeof document !== 'undefined') document.documentElement.lang = lang;
/** Guarda el idioma y recarga la vista (los textos se resuelven al montar cada módulo). */
export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* sin storage */ }
  location.reload();
}

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;

/**
 * Plural: la clave «{n} tirada|{n} tiradas» elige singular|plural según vars.n (1 → primero). {x} se sustituye por vars.x.
 * Sin traducción devuelve la propia clave (español).
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = DICT[lang][key] ?? key;
  if (s.includes('|')) { const [a, b] = s.split('|'); s = vars?.n === 1 ? a : b; }
  return fill(s, vars);
}

// Mensajes del servidor (siempre en español, algunos con datos incrustados): coincidencia exacta en el diccionario
// o, si no, contra las claves con {x} convertidas en patrón.
let pats: [RegExp, string, string[]][] | undefined;
const patrones = () => pats ??= Object.keys(DICT[lang]).filter(k => /\{\w+\}/.test(k)).map(k => {
  const names: string[] = [];
  const re = k.split(/\{(\w+)\}/).map((p, i) => i % 2 ? (names.push(p), '(.+?)') : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return [new RegExp(`^${re}$`), k, names] as [RegExp, string, string[]];
});
/** Traduce un texto que envía el servidor (errores, avisos de sistema). Lo que no conoce se deja tal cual. */
export function tsrv(msg: string): string {
  if (lang === 'es') return msg;
  if (DICT[lang][msg] !== undefined) return t(msg);
  for (const [re, k, names] of patrones()) {
    const m = re.exec(msg);
    if (m) return t(k, Object.fromEntries(names.map((n, i) => [n, m[i + 1]])));
  }
  return msg;
}
