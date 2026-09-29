import { t } from './i18n.ts';
// Puente Beyond20 → Lantern. Beyond20 (extensión) emite en el `document` de los «custom domains» el evento
// `Beyond20_RenderedRoll` con detail = [request]. No hay que anunciar nada: al cargar en un dominio
// registrado, Beyond20 ya emite `Beyond20_Loaded` y reenvía las tiradas de la hoja de DDB.
// Fuente: docs/api.md de kakaroto/Beyond20 («The DOM API»).
import type { C2S, Die } from '@lantern/protocol';

export type B20Roll = { name: string; expr: string; total: number; dice: Die[]; kind: string };

// Formas mínimas de un `rendered-roll` (ver «Roll Format», «Dice Roll Format», «Damage Roll Info Format»).
type DiceRoll = { faces?: number; rolls?: { roll: number; discarded?: boolean }[] };
type Roll = { formula?: string; parts?: (DiceRoll | string | number)[]; total?: number; discarded?: boolean };
type Rendered = {
  action?: string; title?: string; whisper?: number;
  request?: { type?: string; whisper?: number };
  character?: { name?: string };
  attack_rolls?: Roll[]; damage_rolls?: [string, Roll, number][];
};

const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function diceOf(r: Roll): Die[] {
  const out: Die[] = [];
  for (const p of r.parts ?? []) {
    if (typeof p !== 'object' || p === null || !num(p.faces) || p.faces < 2) continue;
    for (const d of p.rolls ?? []) if (num(d.roll)) out.push({ sides: p.faces, value: d.roll, kept: !d.discarded && !r.discarded });
  }
  return out;
}

// Todas las tiradas que produce una tirada de Beyond20: [principal, daño?]. Vacío si no hay nada que mostrar.
export function parseBeyond20All(req: unknown): B20Roll[] {
  const q = req as Rendered | null;
  if (!q || typeof q !== 'object' || q.action !== 'rendered-roll') return [];
  // whisper 1/3 = el jugador la quiere en secreto; externalRoll no tiene destinatario, así que no se envía.
  if ((q.request?.whisper ?? q.whisper) === 1 || (q.request?.whisper ?? q.whisper) === 3) return [];
  const title = String(q.title ?? '').trim() || t('Tirada');
  const who = q.character?.name ? ` (${q.character.name})` : '';
  const out: B20Roll[] = [];

  // attack_rolls = tiradas «primarias»: d20 de ataque/salvación/habilidad/iniciativa o fórmula custom.
  const prim = (q.attack_rolls ?? []).filter(r => r && num(r.total));
  const main = prim.find(r => !r.discarded) ?? prim[0];
  if (main) out.push({
    name: title + who, expr: main.formula ?? '', total: main.total!,
    dice: prim.flatMap(diceOf), kind: q.request?.type ?? 'roll',
  });

  // damage_rolls = [tipo, Roll, flags]; flags 0 = solo texto, 32 = condicional (fuera del total).
  const dmg = (q.damage_rolls ?? []).filter(d => Array.isArray(d) && d[2] !== 0 && !((d[2] ?? 0) & 32) && d[1] && num(d[1].total));
  if (dmg.length) out.push({
    name: t('{title} · daño{who}', { title, who }),
    expr: dmg.map(([t, r]) => `${r.formula ?? r.total} ${t}`.trim()).join(' + '),
    total: dmg.reduce((s, d) => s + d[1].total!, 0),
    dice: dmg.flatMap(d => diceOf(d[1])), kind: 'damage',
  });
  return out;
}

// La tirada principal (o null). Para enviar todo (ataque + daño) usar parseBeyond20All.
export const parseBeyond20 = (req: unknown): B20Roll | null => parseBeyond20All(req)[0] ?? null;

// Escucha los eventos DOM de Beyond20. Devuelve la función para desmontar.
export function mountBeyond20(send: (m: C2S) => void): () => void {
  const on = (e: Event) => {
    const req = (e as CustomEvent).detail?.[0];   // detail = array de argumentos
    for (const r of parseBeyond20All(req)) send({ t: 'externalRoll', source: 'beyond20', ...r });
  };
  document.addEventListener('Beyond20_RenderedRoll', on);
  return () => document.removeEventListener('Beyond20_RenderedRoll', on);
}
