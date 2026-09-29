// Fuentes verificadas: PX por VD y presupuesto 2024 = SRD 5.2.1 (p. 201 y 255-256); umbrales/multiplicadores 2014 = Basic Rules 2014 (dndbeyond.com/sources/basic-rules/building-combat-encounters).
// Dificultad de encuentros: PX por VD (SRD) y presupuestos de 2024 / umbrales de 2014.
const XP: Record<string, number> = { '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900, '8': 3900, '9': 5000,
  '10': 5900, '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000, '17': 18000, '18': 20000, '19': 22000, '20': 25000,
  '21': 33000, '22': 41000, '23': 50000, '24': 62000, '25': 75000, '26': 90000, '27': 105000, '28': 120000, '29': 135000, '30': 155000 };

// Por nivel 1–20: [Bajo, Moderado, Alto] (SRD 5.2.1)
const BUDGET: number[][] = [[50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100], [600, 1000, 1400], [750, 1300, 1700], [1000, 1700, 2100],
  [1300, 2000, 2600], [1600, 2300, 3100], [1900, 2900, 4100], [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200], [3300, 5400, 7800], [3800, 6100, 9800],
  [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000]];
// Por nivel 1–20: [fácil, medio, difícil, mortal] (2014)
const THRESH: number[][] = [[25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500], [250, 500, 750, 1100], [300, 600, 900, 1400], [350, 750, 1100, 1700],
  [450, 900, 1400, 2100], [550, 1100, 1600, 2400], [600, 1200, 1900, 2800], [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500], [1100, 2200, 3400, 5100], [1250, 2500, 3800, 5700],
  [1400, 2800, 4300, 6400], [1600, 3200, 4800, 7200], [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500], [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700]];

export const encounterXP = (crs: string[]): number =>
  crs.reduce((n, cr) => { if (!Object.hasOwn(XP, cr)) throw new Error(`VD no válido: "${cr}"`); return n + XP[cr]; }, 0);

const lvl = (l: number) => { if (!Number.isInteger(l) || l < 1 || l > 20) throw new Error(`Nivel no válido: ${l}`); return l - 1; };
// Multiplicadores 2014 (DMG p. 82 / Basic Rules 2014, "Building Combat Encounters"); el grupo <3 sube un escalón, >=6 baja uno.
const MULTS = [0.5, 1, 1.5, 2, 2.5, 3, 4];
const mult = (n: number, party: number) => {
  const i = n <= 1 ? 1 : n === 2 ? 2 : n <= 6 ? 3 : n <= 10 ? 4 : n <= 14 ? 5 : 6;
  return MULTS[Math.min(6, Math.max(0, i + (party < 3 ? 1 : party >= 6 ? -1 : 0)))];
};

export type Difficulty = { xp: number; adjusted?: number; rating: string };

// 2024: rating = 'low' | 'moderate' | 'high' (por encima del presupuesto Alto también es 'high').
// 2014: 'trivial' | 'easy' | 'medium' | 'hard' | 'deadly', con `adjusted` = PX × multiplicador por nº de monstruos.
export function encounterDifficulty(partyLevels: number[], crs: string[], edition: '2014' | '2024'): Difficulty {
  const xp = encounterXP(crs);
  if (!partyLevels.length) throw new Error('Grupo vacío');
  const sum = (t: number[][], i: number) => partyLevels.reduce((n, l) => n + t[lvl(l)][i], 0);
  if (edition === '2024') {
    const rating = xp <= sum(BUDGET, 0) ? 'low' : xp <= sum(BUDGET, 1) ? 'moderate' : 'high';
    return { xp, rating };
  }
  const adjusted = xp * mult(crs.length, partyLevels.length);
  const i = [3, 2, 1, 0].find((k) => adjusted >= sum(THRESH, k));
  return { xp, adjusted, rating: i === undefined ? 'trivial' : ['easy', 'medium', 'hard', 'deadly'][i] };
}
