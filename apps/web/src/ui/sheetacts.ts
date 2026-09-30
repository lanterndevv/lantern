// Acciones y conjuros de la hoja: tiradas con un clic (ataque, daño, crítico o todo) y «Usar» para resolverlas en el mapa.
import type { Action, C2S, SpellbookEntry, Token } from '@lantern/protocol';
import { doubleDice } from '@lantern/rules';
import { SCHOOL_ES, SPELL_INDEX } from '@lantern/srd';
import { dmgName } from './dmgtypes.ts';
import { t } from '../i18n.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const AB: Record<string, string> = { str: 'FUE', dex: 'DES', con: 'CON', int: 'INT', wis: 'SAB', cha: 'CAR' };
const sg = (n: number) => (n >= 0 ? '+' : '−') + Math.abs(n);   // para mostrar
const sx = (n: number) => (n >= 0 ? '+' : '') + n;              // para la expresión de dados
const COST: Record<Action['cost'], string> = { action: 'Acción', bonus: 'Adicional', reaction: 'Reacción' };
const levelOf = (a: Action) => SPELL_INDEX[a.id]?.level ?? a.slot ?? 0;
const isSpell = (a: Action) => !!(a.school || SPELL_INDEX[a.id] || a.slot);

let TEXT: Record<string, { d: string; h?: string }> | undefined, loading = false;

type Ctx = { token: () => Token | undefined; send: (m: C2S) => void; arm?: (tokenId: string, actionId: string) => void };

/** Monta la sección en `el`; devuelve render(), que solo repinta si cambia algo que se ve (para no cerrar los desplegables). */
export function mountSheetActions(el: HTMLElement, cx: Ctx) {
  let sig = '';
  const open = new Set<string>();   // desplegables abiertos: sobreviven al repintado
  const spellInfo = (id: string | undefined) => {
    const i = id ? SPELL_INDEX[id] : undefined;
    if (!i) return `<p class="det">${t('Descripción no disponible (fuera del SRD).')}</p>`;
    const tx = TEXT?.[id!];
    return `<p class="det">${esc(t(SCHOOL_ES[i.school] ?? i.school))} · ${esc(i.time)} · ${esc(i.range)} · ${esc(i.components)} · ${esc(i.duration)}${i.concentration ? ` · ${t('concentración')}` : ''}${i.ritual ? ` · ${t('ritual')}` : ''}</p>`
      + (tx ? `<p class="sa-txt" lang="en">${esc(tx.d)}</p>${tx.h ? `<p class="sa-txt" lang="en"><strong>${t('A niveles superiores.')}</strong> ${esc(tx.h)}</p>` : ''}` : `<p class="det">${t('Cargando…')}</p>`);
  };
  const reach = (a: Action) => a.range <= 5 ? t('cuerpo a cuerpo') : t('{n} pies', { n: a.range });
  const actRow = (tk: Token, a: Action, i: number) => {
    const spell = isSpell(a), key = 'a:' + a.id, b = (r: string, txt: string, lab: string) => `<button type="button" data-r="${r}" data-i="${i}" aria-label="${esc(lab)}">${txt}</button>`;
    const btns = a.multi ? '' : [
      a.kind === 'attack' && a.toHit != null ? b('hit', sg(a.toHit), t('{name}: tirar ataque {m}', { name: a.name, m: sg(a.toHit) })) : '',
      a.kind === 'save' && a.save ? `<span class="chip">${t('CD {dc} {ab}', { dc: a.save.dc, ab: t(AB[a.save.ability]) })}</span>` : '',
      a.damage ? b('dmg', `${esc(a.damage)} ${esc(a.kind === 'heal' ? t('curación') : dmgName(a.damageType))}`, t('{name}: tirar {d}', { name: a.name, d: a.damage })) : '',
      a.damage && a.kind === 'attack' ? b('crit', t('Crít.'), t('{name}: daño de crítico', { name: a.name })) : '',
      a.kind === 'attack' && a.toHit != null && a.damage ? b('all', `⚄ ${t('Todo')}`, t('{name}: tirar ataque y daño', { name: a.name })) : '',
    ].join('');
    const use = cx.arm ? `<button type="button" class="primary" data-use="${i}" aria-label="${esc(t('{name}: usar en el mapa', { name: a.name }))}">🎯 ${t('Usar')}</button>` : '';
    const meta = `${t(COST[a.cost])} · ${reach(a)}${a.area ? ` · ${t('área {n} pies', { n: a.area.size })}` : ''}`;
    const body = spell ? spellInfo(SPELL_INDEX[a.id] ? a.id : undefined)
      : a.multi ? `<p class="det">${a.multi.map(m => `${m.n}× ${esc(tk.actions?.find(x => x.id === m.id)?.name ?? m.id)}`).join(', ')}</p>`
        : `<p class="det">${meta}${a.damage ? ` · ${esc(a.damage)} ${esc(dmgName(a.damageType))}` : ''}</p>`;
    return `<li class="sa"><details data-k="${esc(key)}"${open.has(key) ? ' open' : ''}><summary><strong>${esc(a.name)}</strong> <small class="det">${meta}</small></summary>${body}</details>
      <div class="sa-b">${btns}${use}</div></li>`;
  };
  const bookRow = (e: SpellbookEntry, i: number) => {
    const key = 'b:' + e.name;
    return `<li class="sa"><details data-k="${esc(key)}"${open.has(key) ? ' open' : ''}><summary><strong>${esc(e.name)}</strong>${e.conc ? ` <small class="det">${t('conc.')}</small>` : ''}</summary>${spellInfo(e.id)}</details>
      <div class="sa-b"><button type="button" class="primary" data-cast="${i}" aria-label="${esc(t('Lanzar {name}', { name: e.name }))}">${t('Lanzar')}</button></div></li>`;
  };
  const render = () => {
    const tk = cx.token(), acts = tk?.actions ?? [], book = tk?.spellbook ?? [];
    const k = JSON.stringify([tk?.id, acts, tk?.slots, book, !!TEXT]);
    if (k === sig) return;
    sig = k;
    if (!tk || (!acts.length && !book.length)) { el.replaceChildren(); return; }
    if ((book.length || acts.some(isSpell)) && !TEXT && !loading) {
      loading = true;
      void import('@lantern/srd/spelltext').then(m => { TEXT = m.SPELL_TEXT; render(); }, () => {});
    }
    const atk = acts.map((a, i) => [a, i] as const).filter(([a]) => !isSpell(a));
    const lvls = [...new Set([...acts.filter(isSpell).map(levelOf), ...book.map(e => e.level)])].sort((a, b) => a - b);
    const pips = (lv: number) => { const s = tk.slots?.[lv]; return s ? ` <span class="slots" role="img" aria-label="${t('Nivel {lv}: {a} de {b} espacios', { lv, a: s.max - s.used, b: s.max })}">${'◆'.repeat(Math.max(0, s.max - s.used))}${'◇'.repeat(Math.min(s.used, s.max))}</span>` : ''; };
    el.innerHTML = `<h3>${t('Acciones')} <small class="det">${t('Mayús + clic: tirada secreta')}</small></h3>`
      + (atk.length ? `<ul class="sa-l">${atk.map(([a, i]) => actRow(tk, a, i)).join('')}</ul>` : '')
      + (lvls.length ? `<h3>${t('Conjuros')}</h3>` + lvls.map(lv => `<h4>${lv ? t('Nivel {n}', { n: lv }) : t('Trucos')}${pips(lv)}</h4><ul class="sa-l">`
        + acts.map((a, i) => [a, i] as const).filter(([a]) => isSpell(a) && levelOf(a) === lv).map(([a, i]) => actRow(tk, a, i)).join('')
        + book.map((e, i) => [e, i] as const).filter(([e]) => e.level === lv).map(([e, i]) => bookRow(e, i)).join('') + '</ul>').join('') : '');
  };
  el.addEventListener('toggle', e => {
    const d = e.target as HTMLDetailsElement, k = d.dataset?.k;
    if (k) d.open ? open.add(k) : open.delete(k);
  }, true);   // toggle no burbujea
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button'), tk = cx.token();
    if (!b || !tk) return;
    const secret = e.shiftKey ? { secret: true } : {};
    const roll = (expr: string, what: string, a: Action) => cx.send({ t: 'roll', expr, label: `${tk.name}: ${a.name} · ${what}`.slice(0, 80), ...secret });
    if (b.dataset.cast) { const s = tk.spellbook?.[+b.dataset.cast]; if (s) cx.send({ t: 'cast', tokenId: tk.id, name: s.name }); return; }
    const a = tk.actions?.[+(b.dataset.use ?? b.dataset.i ?? NaN)];
    if (!a) return;
    if (b.dataset.use) return cx.arm?.(tk.id, a.id);
    const r = b.dataset.r, dmgWhat = a.kind === 'heal' ? t('curación') : t('daño');
    if ((r === 'hit' || r === 'all') && a.toHit != null) roll(`1d20${sx(a.toHit)}`, t('ataque'), a);
    if ((r === 'dmg' || r === 'all') && a.damage) roll(a.damage, dmgWhat, a);
    if (r === 'crit' && a.damage) roll(doubleDice(a.damage), t('daño crítico'), a);
  });
  return { render };
}
