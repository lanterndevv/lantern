// Ritmo de marcha (SRD 5e, «Travel Pace»): millas por hora y por día. Solo cálculo, sin estado.
import type { Point, TravelPace } from './index.ts';

export const PACE: Record<TravelPace, { mph: number; day: number; note: string }> = {
  slow: { mph: 2, day: 18, note: 'puede ir en sigilo' },
  normal: { mph: 3, day: 24, note: '' },
  fast: { mph: 4, day: 30, note: '−5 a la Percepción pasiva' },
};
export const REST_MIN = 16 * 60; // entre jornadas: 16 h de descanso

/** Millas → horas de marcha, jornadas (días de viaje) y minutos que avanza el reloj (marcha + descansos entre jornadas). */
export function travelPlan(miles: number, pace: TravelPace) {
  const p = PACE[pace], hours = miles / p.mph, days = Math.max(1, Math.ceil(miles / p.day - 1e-9));
  return { hours, days, minutes: Math.round(hours * 60) + (days - 1) * REST_MIN };
}

/** Longitud de la poligonal en las unidades de los puntos. */
export const pathLength = (pts: Point[]) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
