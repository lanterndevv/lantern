// Resolución de acciones y aplicación de tarjetas (funciones puras).
import type { Action, ActionCard, Die, Token } from '@lantern/protocol';
import { applyDamage, d20Penalty, autoCrit, autoFailSave, attackMode, heal, roll, saveDamage } from './index.ts';
import { editionOf } from './rest.ts';

const d20 = (rng: () => number) => Math.floor(rng() * 20) + 1;
// Duplica N en cada NdM: '2d6+3' → '4d6+3'
export const doubleDice = (expr: string) => expr.replace(/(\d*)d(\d+)/gi, (_, n, m) => `${(n === '' ? 1 : Number(n)) * 2}d${m}`);
// Visión ciega o verdadera al alcance anulan la invisibilidad del otro. ponytail: no mira línea de visión (el servidor ya exige objetivos visibles)
const sees = (v: Token, o: Token) => { const r = Math.max(v.senses?.blindsight ?? 0, v.senses?.truesight ?? 0); return r > 0 && Math.hypot(o.x - v.x, o.y - v.y) <= r; };
const unseen = (conds: string[], seen: boolean) => seen ? conds.filter((c) => c !== 'invisible') : conds;

export function resolveAction(
  actor: Token, action: Action, targets: Token[], rng: () => number = Math.random,
  opts: { within5ft?: (t: Token) => boolean; cover?: (t: Token) => number; edition?: '2014' | '2024'; exhaustionOf?: (t: Token) => number;
    flank?: (t: Token) => boolean; dodge?: (t: Token) => boolean; brutalCrit?: boolean } = {},
): ActionCard {
  const card: ActionCard = {
    actorId: actor.id, actorName: actor.name, actionName: action.name, kind: action.kind,
    damageType: action.damageType, targets: [], applied: false,
  };
  const details: string[] = [];
  const dice: Die[] = [];
  const dmg = action.damage ?? '0';
  // la edición de cada criatura prevalece sobre la de la mesa: la del actor para su ataque, la del objetivo para su salvación
  const edition = opts.edition ?? '2024', exOf = opts.exhaustionOf ?? ((t: Token) => t.exhaustion ?? 0);
  const edA = editionOf(actor, edition), ex = exOf(actor), pen = d20Penalty(ex, edA);

  if (action.kind === 'attack') {
    for (const t of targets) {
      const near = opts.within5ft ? opts.within5ft(t) : action.range <= 5;
      // ponytail: asustado da desventaja aunque la fuente no esté a la vista (no se guarda la fuente del miedo); haría falta condSource.frightened + perceives()
      const mode = attackMode(unseen(actor.conditions, sees(t, actor)), unseen(t.conditions, sees(actor, t)), { ranged: action.range > 5, within5ft: near, adv: opts.flank?.(t),
        dis: (edA === '2014' && ex >= 3) || opts.dodge?.(t) });
      const a = d20(rng);
      const b = mode === 'normal' ? a : d20(rng);
      const die = mode === 'adv' ? Math.max(a, b) : mode === 'dis' ? Math.min(a, b) : a;
      dice.push({ sides: 20, value: a, kept: mode === 'normal' || a === die });
      if (mode !== 'normal') dice.push({ sides: 20, value: b, kept: a !== die }); // empate: se conserva el primero
      const total = die + (action.toHit ?? 0) + pen;
      const hit = die !== 1 && (die === 20 || total >= (t.ac ?? 10) + (opts.cover?.(t) ?? 0));
      const crit = die === 20 || autoCrit(t.conditions, near);
      // brutalCrit: dados al máximo + una tirada normal (ponytail: cuenta NdM sin signo; sirve para daños normales)
      const maxDice = [...dmg.matchAll(/(\d*)d(\d+)/gi)].reduce((n, m) => n + (m[1] === '' ? 1 : Number(m[1])) * Number(m[2]), 0);
      const r = roll(crit ? (opts.brutalCrit ? `${maxDice}+${dmg}` : doubleDice(dmg)) : dmg, rng);
      dice.push(...r.dice);
      details.push(`${t.name}: ${r.detail}${crit ? ' (crítico)' : ''}`);
      card.targets.push({ id: t.id, name: t.name, attack: { d20: die, total, mode, hit, crit }, amount: hit ? r.total : 0 });
    }
  } else if (action.kind === 'save') {
    const save = action.save!;
    const r = roll(dmg, rng);
    details.push(r.detail);
    dice.push(...r.dice);
    for (const t of targets) {
      const edT = editionOf(t, edition), exT = exOf(t), dis = edT === '2014' && exT >= 3; // 2014: desventaja en salvaciones desde agotamiento 3
      const a = d20(rng), b = dis ? d20(rng) : a, v = Math.min(a, b);
      dice.push({ sides: 20, value: a, kept: a === v });
      if (dis) dice.push({ sides: 20, value: b, kept: a !== v });
      const total = v + (t.saves?.[save.ability] ?? 0) + d20Penalty(exT, edT);
      const success = !autoFailSave(t.conditions, save.ability) && total >= save.dc;
      card.targets.push({
        id: t.id, name: t.name, save: { total, success, ability: save.ability, dc: save.dc },
        amount: saveDamage(r.total, success, save.half),
      });
    }
  } else {
    for (const t of targets) {
      const r = roll(dmg, rng);
      dice.push(...r.dice);
      details.push(`${t.name}: ${r.detail}`);
      card.targets.push({ id: t.id, name: t.name, amount: r.total });
    }
  }
  card.detail = details.join('\n');
  card.dice = dice;
  return card;
}

export function applyCard(card: ActionCard, tokens: Token[], mode: 'full' | 'half' | 'none'): Token[] {
  if (mode === 'none') return tokens;
  return tokens.map((t) => {
    const ct = card.targets.find((x) => x.id === t.id);
    if (!ct || !t.hp) return t;
    const amount = mode === 'half' ? Math.floor((ct.amount ?? 0) / 2) : ct.amount ?? 0;
    const hp = card.kind === 'heal' ? heal(t.hp, amount) : applyDamage(t.hp, amount, card.damageType ?? '', t.defenses).hp;
    return { ...t, hp };
  });
}
