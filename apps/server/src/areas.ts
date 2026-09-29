// Áreas persistentes de conjuros: al lanzar uno de la tabla, `act` crea la región con su comportamiento (id SRD → forma y efecto).
import { randomUUID } from 'node:crypto';
import type { Action, Point, Region, Scene, Token } from '@lantern/protocol';
import { SPELL_INDEX } from '@lantern/srd';

type Def = { shape: 'sphere' | 'cube' | 'line'; size: number; self?: boolean; kind: Region['kind']; trigger?: Region['trigger']; fx?: Region['fx']; save?: 'str' | 'dex' | 'con' | 'wis'; condition?: string; silence?: boolean };
// ponytail: tabla corta de los conjuros duraderos más usados; el daño/CD salen de la acción (el lanzador), la duración de SPELL_INDEX
const AREAS: Record<string, Def> = {
  'stinking-cloud': { shape: 'sphere', size: 20, kind: 'trap', trigger: 'turnStart', fx: 'fog', save: 'con', condition: 'poisoned' },
  'wall-of-fire': { shape: 'line', size: 60, kind: 'trap', fx: 'fire', save: 'dex' },
  'spirit-guardians': { shape: 'sphere', size: 15, self: true, kind: 'trap', trigger: 'turnStart', save: 'wis' },
  web: { shape: 'cube', size: 20, kind: 'difficult', fx: 'web' },
  darkness: { shape: 'sphere', size: 15, kind: 'darkness' },
  'fog-cloud': { shape: 'sphere', size: 20, kind: 'fog', fx: 'fog' },
  cloudkill: { shape: 'sphere', size: 20, kind: 'trap', trigger: 'turnStart', fx: 'fog', save: 'con' },
  entangle: { shape: 'cube', size: 20, kind: 'difficult', fx: 'brambles' },
  grease: { shape: 'cube', size: 10, kind: 'difficult' },
  'spike-growth': { shape: 'sphere', size: 20, kind: 'difficult', fx: 'brambles' },
  'sleet-storm': { shape: 'sphere', size: 40, kind: 'difficult', fx: 'ice' },
  moonbeam: { shape: 'sphere', size: 5, kind: 'trap', trigger: 'turnStart', save: 'con' },
  'black-tentacles': { shape: 'sphere', size: 20, kind: 'trap', trigger: 'turnStart', save: 'dex', condition: 'restrained' },
  'insect-plague': { shape: 'sphere', size: 20, kind: 'trap', trigger: 'turnStart', save: 'con' },
  'blade-barrier': { shape: 'line', size: 60, kind: 'trap', save: 'dex' },
  silence: { shape: 'sphere', size: 20, kind: 'sound', silence: true },
};

// nombres en español (los conjuros personalizados no llevan el id SRD)
const ES: Record<string, string> = { 'nube apestosa': 'stinking-cloud', 'muro de fuego': 'wall-of-fire', 'espíritus guardianes': 'spirit-guardians', telaraña: 'web', oscuridad: 'darkness',
  niebla: 'fog-cloud', 'nube de niebla': 'fog-cloud', 'nube aniquiladora': 'cloudkill', enredar: 'entangle', grasa: 'grease', 'crecimiento de espinas': 'spike-growth',
  'tormenta de aguanieve': 'sleet-storm', 'rayo de luna': 'moonbeam', 'tentáculos negros': 'black-tentacles', 'plaga de insectos': 'insect-plague', 'barrera de cuchillas': 'blade-barrier', silencio: 'silence' };

/** Rondas de una duración SRD («up to 1 minute», «10 minutes», «1 hour»); undefined si no es por tiempo. */
export function roundsOf(duration: string): number | undefined {
  const m = /(\d+) (minute|hour)/.exec(duration);
  return m ? Number(m[1]) * (m[2] === 'hour' ? 600 : 10) : undefined;
}

/** Regiones que crea `act` lanzado por `tk`; `at`/`aim` = plantilla, `cx` = centroide de los objetivos (respaldo). `round`: ronda actual (undefined fuera de combate). */
export function spellRegions(s: Scene, tk: Token, act: Action, o: { at?: Point; aim?: Point; targets: Point[]; round?: number; conc: boolean }): Region[] {
  const id = AREAS[act.id] ? act.id : ES[act.name.toLowerCase()], d = AREAS[id];
  if (!d || !act.slot) return [];
  const c: Point | undefined = d.self ? tk : o.at ?? (o.targets.length ? { x: o.targets.reduce((n, t) => n + t.x, 0) / o.targets.length, y: o.targets.reduce((n, t) => n + t.y, 0) / o.targets.length } : undefined);
  const dir = o.aim ?? o.at;
  if (!c || (d.shape === 'line' && !dir)) return [];
  const k = s.grid.size / s.grid.feet, L = d.size * k; // pies → px
  let points: Point[];
  if (d.shape === 'sphere') points = Array.from({ length: 16 }, (_, i) => ({ x: c.x + L * Math.cos(i * Math.PI / 8), y: c.y + L * Math.sin(i * Math.PI / 8) }));
  else if (d.shape === 'cube') { // esquina en `c`, hacia `aim` (o al lado contrario del lanzador, como la plantilla)
    const sx = (o.aim ? o.aim.x < c.x : c.x < tk.x) ? -1 : 1, sy = (o.aim ? o.aim.y < c.y : c.y < tk.y) ? -1 : 1;
    points = [{ x: c.x, y: c.y }, { x: c.x + sx * L, y: c.y }, { x: c.x + sx * L, y: c.y + sy * L }, { x: c.x, y: c.y + sy * L }];
  } else { // línea desde el lanzador de 5 pies de ancho
    const dx = dir!.x - tk.x, dy = dir!.y - tk.y, n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n, w = 2.5 * k;
    points = [{ x: tk.x - uy * w, y: tk.y + ux * w }, { x: tk.x + ux * L - uy * w, y: tk.y + uy * L + ux * w }, { x: tk.x + ux * L + uy * w, y: tk.y + uy * L - ux * w }, { x: tk.x + uy * w, y: tk.y - ux * w }];
  }
  const dur = roundsOf(SPELL_INDEX[id]?.duration ?? '');
  const r: Region = { id: randomUUID(), name: act.name, points, kind: d.kind, hidden: false, ...(tk.level && { level: tk.level }),
    ...(d.fx && { fx: d.fx }), ...(d.trigger && { trigger: d.trigger }), ...(d.silence && { action: 'silence' as const }),
    ...(d.kind === 'trap' && { save: { ability: d.save!, dc: act.save?.dc ?? 13 }, ...(act.damage && { damage: act.damage }), ...(act.damageType && { damageType: act.damageType }), ...(d.condition && { condition: d.condition }) }),
    ...(o.round !== undefined && dur && { untilRound: o.round + dur }), ...(o.conc && { sourceId: `conc:${tk.id}` }) };
  return [r];
}
