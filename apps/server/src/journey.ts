// Ritmo de sesión: transiciones de escena (y precarga), viaje por el mapa del mundo, tarjeta de documento y avisos tras la sesión.
// Envuelve al manejador (handleJourney): lo que no es suyo pasa tal cual. Los contadores del aviso viven en memoria (se reinician con el servidor).
import { randomUUID } from 'node:crypto';
import type { S2C, TransitionKind } from '@lantern/protocol';
import { PACE, pathLength, travelPlan } from '@lantern/protocol/travel';
import { pushChat, type Effect, type MemberRec, type Room, type RollFn } from './room.ts';
import { inScene, inr, obj, str } from './validate.ts';

type Next = (room: Room, m: MemberRec, msg: unknown, rollFn: RollFn, now: number) => Effect;

const DENY: Effect = { error: 'no permitido' }, BAD: Effect = { error: 'mensaje inválido' };
const isDM = (m: MemberRec) => m.role === 'dm' || m.role === 'assistant';
const KINDS: TransitionKind[] = ['fade', 'ink', 'scroll', 'title'];
const MAX_MIN = 43200; // tope del reloj del mundo por avance (30 días), igual que world.ts

// kind + ms válidos (ms entre 0,5 y 8 s) o null
const trans = (v: unknown, dflt = 2000): { kind: TransitionKind; ms: number } | null =>
  obj(v) && KINDS.includes(v.kind as TransitionKind) && (v.ms === undefined ? true : inr(v.ms, 500, 8000)) ? { kind: v.kind as TransitionKind, ms: (v.ms as number | undefined) ?? dflt } : null;

// ---- contadores para el aviso tras la sesión ----
type Tally = { d20: number; hp: number; fog: number };
const tallies = new WeakMap<Room, Tally>();
const T = (room: Room) => { let t = tallies.get(room); if (!t) tallies.set(room, t = { d20: 0, hp: 0, fog: 0 }); return t; };
const TIPS = [
  { key: 'd20', min: 6, text: (n: number) => `Has tirado d20 a mano ${n} veces (¿iniciativa?). ¿Activar la iniciativa automática?`, patch: { mode: 'full', layers: { initiative: true } } },
  { key: 'hp', min: 8, text: (n: number) => `Has editado los PG a mano ${n} veces. ¿Activar la automatización de acciones y daño?`, patch: { mode: 'full', layers: { automation: true } } },
  { key: 'fog', min: 3, text: (n: number) => `Has pintado niebla o dibujos a mano ${n} veces. ¿Activar la iluminación y la niebla dinámicas?`, patch: { mode: 'full', layers: { lighting: true } } },
] as const;

function tally(room: Room, m: MemberRec, msg: Record<string, unknown>) {
  if (!isDM(m) || room.settings.mode !== 'simple') return;
  const t = T(room), it = msg.item;
  if (msg.t === 'roll' && typeof msg.expr === 'string' && /^\s*1?d20\b/i.test(msg.expr)) t.d20++;
  else if (msg.t === 'hp') t.hp++;
  else if ((msg.t === 'draw' && msg.persist === true) || (msg.t === 'upsert' && msg.kind === 'region' && obj(it) && (it.kind === 'fog' || it.kind === 'darkness'))) t.fog++;
}

export function handleJourney(room: Room, m: MemberRec, msg: unknown, rollFn: RollFn, now: number, next: Next): Effect {
  if (!obj(msg) || typeof msg.t !== 'string') return next(room, m, msg, rollFn, now);
  const dm = isDM(m);
  switch (msg.t) {
    case 'sceneActivate': { // con `transition`: el cambio de escena se acompaña del efecto en todos los clientes
      if (msg.transition === undefined) break;
      if (!dm) return DENY;
      const tr = trans(msg.transition);
      if (!tr) return BAD;
      const fx = next(room, m, msg, rollFn, now);
      return fx.error ? fx : { ...fx, all: { t: 'transition', title: room.scene.name, ...tr } };
    }
    case 'transition': { // estilo y duración opcionales de la tarjeta de título
      if (!('kind' in msg) && !('ms' in msg)) break;
      if (!dm) return DENY;
      const tr = trans(msg);
      if (!tr) return BAD;
      const fx = next(room, m, msg, rollFn, now);
      return fx.all?.t === 'transition' ? { ...fx, all: { ...fx.all, ...tr } } : fx;
    }
    case 'scenePrepare': { // precarga: solo URLs de imágenes de la escena (nunca fichas ni nada oculto)
      if (!dm) return DENY;
      const sc = str(msg.id, 64) && Object.hasOwn(room.scenes, msg.id) ? room.scenes[msg.id] : undefined;
      if (!sc) return { error: 'escena inexistente' };
      const urls = [...new Set([sc.background, sc.story?.image, ...(sc.story?.layers ?? []).map((l) => l.image)].filter((u): u is string => !!u))];
      return { all: { t: 'prepare', urls } as S2C };
    }
    case 'travel': return dm ? travel(room, m, msg, rollFn, now, next) : DENY;
    case 'handout': { // tarjeta en el chat solo para quienes lo reciben
      const fx = next(room, m, msg, rollFn, now);
      const e = fx.error || !dm ? undefined : room.journal.find((x) => x.id === msg.entryId);
      if (!e) return fx;
      const to = [...room.members.values()].filter((x) => !isDM(x) && (e.visibleTo === 'all' || (Array.isArray(e.visibleTo) && e.visibleTo.includes(x.id)))).map((x) => x.id);
      if (!to.length) return fx;
      const card = pushChat(room, { id: randomUUID(), from: m.id, at: now, to, doc: { entryId: e.id, title: e.title, ...(e.image && { image: e.image }), ...(e.pdf && { pdf: true }) } });
      return { ...fx, chats: [...(fx.chats ?? []), card] };
    }
    case 'sessionEnd': {
      const fx = next(room, m, msg, rollFn, now), t = T(room), simple = room.settings.mode === 'simple';
      tallies.delete(room);
      const all = fx.all;
      if (fx.error || all?.t !== 'sessionSummary' || !simple) return fx;
      const tips = TIPS.filter((x) => t[x.key] >= x.min).map((x) => ({ text: x.text(t[x.key]), patch: structuredClone(x.patch) as NonNullable<typeof all.summary.tips>[number]['patch'] }));
      if (!tips.length) return fx;
      const { all: _a, ...rest } = fx; // los avisos son del DM: los demás reciben el resumen de siempre
      return { ...rest, sends: [...(fx.sends ?? []), { who: isDM, msg: { t: 'sessionSummary', summary: { ...all.summary, tips } } }, { who: (x) => !isDM(x), msg: all }] };
    }
  }
  const fx = next(room, m, msg, rollFn, now);
  if (!fx.error) tally(room, m, msg);
  return fx;
}

// Viaje: distancia de la regla → millas (escala de la escena) → tiempo según el ritmo → avanza el reloj y tira encuentros por jornada.
function travel(room: Room, m: MemberRec, msg: Record<string, unknown>, rollFn: RollFn, now: number, next: Next): Effect {
  const s = room.scene, pts = msg.points, dc = msg.dc ?? 18;
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > 50 || !pts.every((p) => obj(p) && inScene(s, p.x, p.y))) return BAD;
  if (typeof msg.pace !== 'string' || !Object.hasOwn(PACE, msg.pace) || !Number.isInteger(dc) || (dc as number) < 2 || (dc as number) > 20) return BAD;
  const table = msg.tableId === undefined ? undefined : str(msg.tableId, 64) ? room.journal.find((e) => e.id === msg.tableId) ?? null : null;
  if (table === null || (table && !table.table)) return { error: 'tabla inexistente' };
  if (!s.miles) return { error: 'define la escala del mapa (millas por casilla)' };
  const pace = msg.pace as keyof typeof PACE, miles = Math.round(pathLength(pts as { x: number; y: number }[]) / s.grid.size * s.miles * 10) / 10;
  if (miles < 0.1) return { error: 'distancia nula' };
  const plan = travelPlan(miles, pace);
  if (plan.minutes > MAX_MIN) return { error: 'viaje demasiado largo (máximo 30 días)' };
  const fx = next(room, m, { t: 'clock', advance: plan.minutes }, rollFn, now); // el reloj de siempre: antorchas y luz del día
  if (fx.error) return fx;
  const h = Math.floor(plan.hours), min = Math.round((plan.hours - h) * 60);
  const P = PACE[pace], name = { slow: 'lento', normal: 'normal', fast: 'rápido' }[pace];
  const chats = [pushChat(room, { id: randomUUID(), from: m.id, at: now, text: `Viaje: ${miles} mi a ritmo ${name} (${P.mph} mi/h, ${P.day} mi/día) · ${h} h ${min} min de marcha · ${plan.days} jornada${plan.days > 1 ? 's' : ''}${P.note ? ` · ${P.note}` : ''}` }), ...(fx.chats ?? [])];
  for (let d = 1; d <= plan.days; d++) { // un chequeo por jornada; los resultados son secretos (solo DM)
    const r = rollFn('1d20');
    if (r.total < (dc as number)) continue;
    chats.push(pushChat(room, { id: randomUUID(), from: m.id, at: now, roll: { expr: `Jornada ${d}: encuentro aleatorio`, total: r.total, detail: `${r.detail} ≥ ${dc}`, secret: true } }));
    if (table) { const t = next(room, m, { t: 'rollTable', entryId: table.id, secret: true }, rollFn, now); if (t.chat) chats.push(t.chat); }
  }
  return { ...fx, state: true, chats };
}
