// Tirada propia de Lantern → mensaje del Game Log de D&D Beyond (mismo formato que usa AboveVTT). Puede romperse si DDB lo cambia.
export type GameLogRoll = { expr: string; total: number; dice: { sides: number; value: number; kept: boolean }[] };
export type GameLogCtx = { gameId: string; userId: string; entityId: string; name: string; id?: string; now?: number };

export const buildGameLogRoll = (r: GameLogRoll, c: GameLogCtx) => {
  const kept = r.dice.filter(d => d.kept), sides = [...new Set(kept.map(d => d.sides))];
  const constant = r.total - kept.reduce((s, d) => s + d.value, 0);
  const d20 = r.dice.filter(d => d.sides === 20);
  const best = d20.find(d => d.kept)?.value ?? 0;   // 2 d20 con uno descartado: ventaja si se quedó el mayor
  const rollKind = d20.length === 2 && d20.some(d => !d.kept) ? (best >= Math.max(...d20.map(d => d.value)) ? 'advantage' : 'disadvantage') : '';
  const values = kept.map(d => d.value);
  const ctx = { entityId: c.entityId, entityType: 'character', messageScope: 'gameId', messageTarget: c.gameId, name: c.name };
  return {
    id: c.id ?? crypto.randomUUID(), dateTime: String(c.now ?? Date.now()), gameId: c.gameId, userId: c.userId,
    source: 'web', persist: true, messageScope: 'gameId', messageTarget: c.gameId,
    entityId: c.entityId, entityType: 'character', eventType: 'dice/roll/fulfilled',
    data: {
      action: r.expr,
      rolls: [{
        diceNotation: {
          set: sides.map(s => { const ds = kept.filter(d => d.sides === s); return { count: ds.length, dieType: 'd' + s, dice: ds.map(d => ({ dieType: 'd' + s, dieValue: d.value })), operation: 0 }; }),
          constant,
        },
        rollType: 'roll', rollKind,
        result: { constant, values, total: r.total, text: values.join('+') + (constant ? (constant > 0 ? '+' : '') + constant : '') },
      }],
      context: ctx,
    },
  };
};
