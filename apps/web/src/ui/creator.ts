// Asistente de creación de personaje. Contenido: SRD 5.2.1 (CC-BY-4.0), Wizards of the Coast LLC.
import type { Ability, Action, ImportedCharacter } from '@lantern/protocol';
import { CLASSES, SPECIES, SPELLS, SPELL_INDEX } from '@lantern/srd';
import { t } from '../i18n.ts';
import { dmgName } from './dmgtypes.ts';

const AB: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const AB_ES: Record<Ability, string> = { str: 'Fuerza', dex: 'Destreza', con: 'Constitución', int: 'Inteligencia', wis: 'Sabiduría', cha: 'Carisma' };
// ids de habilidad canónicos = camelCase de @lantern/rules (DDB usa kebab: 'sleight-of-hand' → 'sleightOfHand')
const camel = (k: string) => k.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const SKILLS: Record<string, [string, Ability]> = {
  acrobatics: ['Acrobacias', 'dex'], 'animal-handling': ['Trato con animales', 'wis'], arcana: ['Arcanos', 'int'], athletics: ['Atletismo', 'str'],
  deception: ['Engaño', 'cha'], history: ['Historia', 'int'], insight: ['Perspicacia', 'wis'], intimidation: ['Intimidación', 'cha'],
  investigation: ['Investigación', 'int'], medicine: ['Medicina', 'wis'], nature: ['Naturaleza', 'int'], perception: ['Percepción', 'wis'],
  performance: ['Interpretación', 'cha'], persuasion: ['Persuasión', 'cha'], religion: ['Religión', 'int'], 'sleight-of-hand': ['Juego de manos', 'dex'],
  stealth: ['Sigilo', 'dex'], survival: ['Supervivencia', 'wis'],
};
const STD = [15, 14, 13, 12, 10, 8];
const COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const STEPS = [t('Nombre y especie'), t('Clase, nivel y equipo'), t('Características'), t('Competencias'), t('Conjuros'), t('Resumen')];
const LAST = STEPS.length - 1, SPELL_STEP = 4;
// Armas iniciales de todas las clases (una por id); ponytail: se asume competencia con la elegida
const WEAPONS = [...new Map(Object.values(CLASSES).map(k => [k.weapon.id, k.weapon])).values()];
type Armor = 'none' | 'light' | 'medium' | 'heavy';
const ARMOR: [Armor, string][] = [['none', 'Sin armadura'], ['light', 'Ligera (CA 11 + DES)'], ['medium', 'Intermedia (CA 14 + DES, máx. 2)'], ['heavy', 'Pesada (CA 16)']];
const EXTRA_ATTACK = ['barbarian', 'fighter', 'monk', 'paladin', 'ranger'];
const mod = (n: number) => Math.floor((n - 10) / 2);
const sg = (n: number) => (n >= 0 ? '+' : '') + n;
const esc = (s: string) => s.replace(/[&<>"]/g, ch => `&#${ch.charCodeAt(0)};`);
const opts = (o: [string, string][], sel: string) => o.map(([v, n]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(t(n))}</option>`).join('');

type St = {
  name: string; species: string; cls: string; level: number; method: 'std' | 'buy';
  std: (number | null)[]; buy: number[]; plus2: Ability | ''; plus1: Ability | ''; skills: string[]; skillsFor: string;
  weapon: string; armor: Armor; shield: boolean; gearFor: string; spells: string[]; spellsFor: string;
};
const bestArmor = (cls: string): Armor => { const a = CLASSES[cls].armor; return a.heavy ? 'heavy' : a.medium ? 'medium' : a.light ? 'light' : 'none'; };

export function openCreator(onDone: (c: ImportedCharacter) => void): void {
  const st: St = { name: '', species: 'human', cls: 'fighter', level: 1, method: 'std', std: AB.map(() => null), buy: AB.map(() => 8), plus2: '', plus1: '', skills: [], skillsFor: '', weapon: '', armor: 'none', shield: false, gearFor: '', spells: [], spellsFor: '' };
  let step = 0, err = '';
  const dlg = document.createElement('dialog');
  dlg.className = 'creador';
  dlg.setAttribute('aria-labelledby', 'cr-t');
  dlg.innerHTML = `<style>
    .creador { width: min(560px, 94vw); max-height: 92vh; overflow-y: auto; }
    .creador form { display: grid; gap: 12px; }
    .creador .fila { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    .creador progress { width: 100%; accent-color: var(--ambar); }
    .creador fieldset { border: 1px solid var(--borde); border-radius: var(--r-card); padding: 10px; display: grid; gap: 8px; }
    .creador select, .creador input:not([type=checkbox]):not([type=radio]) { min-height: 44px; background: var(--relieve); border: 1px solid var(--borde); border-radius: var(--r-btn); padding: 0 10px; }
    .creador .chk { display: flex; align-items: center; gap: 10px; min-height: 44px; }
    .creador .chk input { width: 22px; height: 22px; min-height: 0; accent-color: var(--ambar); }
    .creador .pt { display: flex; align-items: center; gap: 8px; } .creador .pt output { min-width: 2ch; text-align: center; font-family: var(--mono); }
    .creador .pie { display: flex; justify-content: space-between; gap: 8px; }
    .creador dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 0; } .creador dt { color: var(--txt2); } .creador dd { margin: 0; }
    .creador .err { color: var(--peligro); margin: 0; }
  </style><form novalidate><h2 id="cr-t" tabindex="-1"></h2><progress max="${STEPS.length}" aria-hidden="true"></progress><div id="cr-b" class="cuerpo" style="display:grid;gap:12px"></div>
    <p class="err" role="alert" id="cr-e"></p>
    <div class="pie"><button type="button" class="secondary" id="cr-a">${t('Anterior')}</button><button type="submit" class="primary" id="cr-s"></button></div></form>`;
  document.body.append(dlg);
  const $ = <T extends HTMLElement>(id: string) => dlg.querySelector<T>('#' + id)!;
  dlg.addEventListener('close', () => dlg.remove());

  const scores = (): Record<Ability, number> | null => {
    const base = st.method === 'std' ? st.std : st.buy;
    if (base.some(v => v === null) || !st.plus2 || !st.plus1) return null;
    return Object.fromEntries(AB.map((a, i) => [a, Math.min(20, (base[i] as number) + (a === st.plus2 ? 2 : 0) + (a === st.plus1 ? 1 : 0))])) as Record<Ability, number>;
  };
  const spent = () => st.buy.reduce((n, v) => n + COST[v], 0);
  // Conjuros de nivel 1+ que puede elegir: automatizables (SPELLS), de su clase y de un nivel para el que tenga espacios
  const maxSlot = () => CLASSES[st.cls].slots[st.level - 1].length;
  const spellChoices = () => CLASSES[st.cls].cast ? Object.keys(SPELLS).filter(id => SPELL_INDEX[id]?.classes.includes(st.cls) && (SPELLS[id].slot ?? 0) >= 1 && SPELLS[id].slot! <= maxSlot())
    .sort((a, b) => SPELLS[a].slot! - SPELLS[b].slot! || SPELL_INDEX[a].name.localeCompare(SPELL_INDEX[b].name)) : [];
  // ponytail: límite simplificado (mod. de lanzamiento + nivel, mín. 1) en vez de la tabla de conjuros preparados de cada clase
  const spellMax = () => { const k = CLASSES[st.cls]; return k.cast && scores() ? Math.max(1, mod(scores()![k.cast]) + st.level) : 0; };
  const hasSpells = () => spellChoices().length > 0;

  const body: ((b: HTMLElement) => void)[] = [
    b => { // 1
      b.innerHTML = `<label>${t('Nombre')}<input id="f-name" maxlength="40" autocomplete="off" value="${esc(st.name)}" required></label>
        <label>${t('Especie')}<select id="f-sp">${opts(Object.entries(SPECIES).map(([k, v]) => [k, v.name]), st.species)}</select></label>`;
      b.insertAdjacentHTML('beforeend', `<p id="f-info" class="sub" aria-live="polite"></p>`);
      const info = () => { const s = SPECIES[st.species]; $('f-info').textContent = t('Velocidad {sp} pies · Visión en la oscuridad {dv} pies · Resistencias: {r}', { sp: s.speed, dv: s.darkvision, r: s.resist.map(dmgName).join(', ') || t('ninguna') }); };
      info();
      $<HTMLInputElement>('f-name').oninput = e => { st.name = (e.target as HTMLInputElement).value; };
      $<HTMLSelectElement>('f-sp').onchange = e => { st.species = (e.target as HTMLSelectElement).value; info(); };
      $('f-name').focus();
    },
    b => { // 2
      b.innerHTML = `<div class="fila"><label>${t('Clase')}<select id="f-cl">${opts(Object.entries(CLASSES).map(([k, v]) => [k, v.name]), st.cls)}</select></label>
        <label>${t('Nivel (1–20)')}<input id="f-lv" type="number" min="1" max="20" inputmode="numeric" value="${st.level}"></label></div>
        <fieldset><legend>${t('Equipo')}</legend><div class="fila" id="f-gear"></div></fieldset>
        <p class="sub">${t('Creador rápido: calcula PG, competencia, CA, espacios, trucos, conjuros y Ataque extra. Subclase, dotes, mejoras de característica y el resto de rasgos de clase se completan a mano en la hoja.')}</p>
        <p id="f-info" class="sub" aria-live="polite"></p>`;
      const gear = () => { // arma, armadura y escudo; al cambiar de clase vuelven a los de la clase
        const k = CLASSES[st.cls];
        if (st.gearFor !== st.cls) { st.weapon = k.weapon.id; st.armor = bestArmor(st.cls); st.shield = k.armor.shield && k.weapon.range <= 5 && !['greataxe', 'quarterstaff'].includes(k.weapon.id); st.gearFor = st.cls; } // escudo si el arma inicial es de una mano
        $('f-gear').innerHTML = `<label>${t('Arma')}<select id="f-wp">${opts(WEAPONS.map(x => [x.id, x.name]), st.weapon)}</select></label>
          <label>${t('Armadura')}<select id="f-ar">${opts(ARMOR.filter(([a]) => a === 'none' || k.armor[a]), st.armor)}</select></label>
          ${k.armor.shield ? `<label class="chk"><input type="checkbox" id="f-sh"${st.shield ? ' checked' : ''}>${t('Escudo (+2 CA)')}</label>` : ''}`;
        $<HTMLSelectElement>('f-wp').onchange = e => { st.weapon = (e.target as HTMLSelectElement).value; };
        $<HTMLSelectElement>('f-ar').onchange = e => { st.armor = (e.target as HTMLSelectElement).value as Armor; };
        const sh = dlg.querySelector<HTMLInputElement>('#f-sh'); if (sh) sh.onchange = () => { st.shield = sh.checked; };
      };
      const info = () => { const k = CLASSES[st.cls]; $('f-info').textContent = `${t('Dado de golpe d{n}', { n: k.hitDie })} · ${t('Salvaciones:')} ${k.saves.map(a => t(AB_ES[a])).join(', ')} · ${k.cast ? t('Lanzamiento:') + ' ' + t(AB_ES[k.cast]) : t('No lanza conjuros')}`; };
      info(); gear();
      $<HTMLSelectElement>('f-cl').onchange = e => { st.cls = (e.target as HTMLSelectElement).value; info(); gear(); };
      $<HTMLInputElement>('f-lv').oninput = e => { st.level = Math.max(1, Math.min(20, Math.round(+(e.target as HTMLInputElement).value) || 1)); };
      $('f-cl').focus();
    },
    b => { // 3
      const draw = (focus?: string) => {
        const std = st.method === 'std';
        const rows = AB.map((a, i) => std
          ? `<label>${t(AB_ES[a])}<select id="a-${a}"><option value="">—</option>${STD.filter(v => v === st.std[i] || !st.std.includes(v)).map(v => `<option${v === st.std[i] ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`
          : `<div class="pt" role="group" aria-label="${t(AB_ES[a])}"><span style="flex:1">${t(AB_ES[a])}</span>
              <button type="button" id="m-${a}" aria-label="${esc(t('Bajar {name}', { name: t(AB_ES[a]) }))}"${st.buy[i] <= 8 ? ' disabled' : ''}>−</button><output id="o-${a}" aria-live="polite">${st.buy[i]}</output>
              <button type="button" id="p-${a}" aria-label="${esc(t('Subir {name}', { name: t(AB_ES[a]) }))}"${st.buy[i] >= 15 || spent() - COST[st.buy[i]] + COST[st.buy[i] + 1] > 27 ? ' disabled' : ''}>+</button></div>`).join('');
        const ab = (id: string, sel: string, other: string) => `<select id="${id}"><option value="">—</option>${AB.filter(a => a !== other).map(a => `<option value="${a}"${a === sel ? ' selected' : ''}>${t(AB_ES[a])}</option>`).join('')}</select>`;
        b.innerHTML = `<fieldset><legend>${t('Método')}</legend>
            <label class="chk"><input type="radio" name="mt" value="std"${std ? ' checked' : ''}>${t('Array estándar (15, 14, 13, 12, 10, 8)')}</label>
            <label class="chk"><input type="radio" name="mt" value="buy"${std ? '' : ' checked'}>${t('Compra por puntos (27)')}</label></fieldset>
          ${std ? '' : `<p aria-live="polite">${t('Puntos restantes:')} <strong>${27 - spent()}</strong></p>`}
          <div class="fila">${rows}</div>
          <fieldset><legend>${t('Aumentos del trasfondo (+2 / +1)')}</legend><div class="fila">
            <label>${t('+2 a')}<span style="display:contents">${ab('f-p2', st.plus2, st.plus1)}</span></label>
            <label>${t('+1 a')}<span style="display:contents">${ab('f-p1', st.plus1, st.plus2)}</span></label></div></fieldset>`;
        b.querySelectorAll<HTMLInputElement>('[name=mt]').forEach(r => r.onchange = () => { st.method = r.value as St['method']; draw('mt-' + r.value); });
        b.querySelectorAll<HTMLInputElement>('[name=mt]').forEach(r => r.id = 'mt-' + r.value);
        AB.forEach((a, i) => {
          const s = b.querySelector<HTMLSelectElement>('#a-' + a);
          if (s) s.onchange = () => { st.std[i] = s.value ? +s.value : null; draw('a-' + a); };
          const m = b.querySelector<HTMLElement>('#m-' + a), p = b.querySelector<HTMLElement>('#p-' + a);
          if (m) m.onclick = () => { st.buy[i]--; draw(st.buy[i] <= 8 ? 'p-' + a : 'm-' + a); };
          if (p) p.onclick = () => { st.buy[i]++; draw(b.querySelector<HTMLButtonElement>('#p-' + a)!.disabled ? 'm-' + a : 'p-' + a); };
        });
        $<HTMLSelectElement>('f-p2').onchange = e => { st.plus2 = (e.target as HTMLSelectElement).value as Ability | ''; draw('f-p2'); };
        $<HTMLSelectElement>('f-p1').onchange = e => { st.plus1 = (e.target as HTMLSelectElement).value as Ability | ''; draw('f-p1'); };
        (b.querySelector<HTMLElement>('#' + (focus ?? 'mt-' + st.method)))?.focus();
      };
      draw();
    },
    b => { // 4
      const k = CLASSES[st.cls];
      if (st.skillsFor !== st.cls) { st.skills = k.skills.slice(0, 2); st.skillsFor = st.cls; }
      b.innerHTML = `<p class="sub" id="f-h">${t('Elige de 2 a 4 habilidades. Las de {cls} van marcadas como sugeridas.', { cls: t(k.name) })}</p>
        <fieldset aria-describedby="f-h"><legend>${t('Habilidades competentes')}</legend><div class="fila">${Object.entries(SKILLS).map(([id, [n, a]]) =>
          `<label class="chk"><input type="checkbox" value="${id}"${st.skills.includes(id) ? ' checked' : ''}>${t(n)} (${t(AB_ES[a]).slice(0, 3)})${k.skills.includes(id) ? ' · ' + t('sugerida') : ''}</label>`).join('')}</div></fieldset>`;
      b.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(i => i.onchange = () => {
        st.skills = [...b.querySelectorAll<HTMLInputElement>('input:checked')].map(x => x.value);
      });
      b.querySelector<HTMLElement>('input')!.focus();
    },
    b => { // 5: conjuros de nivel 1+ (solo lanzadores con espacios; si no, se salta)
      const key = `${st.cls}:${st.level}`, all = spellChoices(), max = spellMax();
      if (st.spellsFor !== key) { st.spells = st.spells.filter(id => all.includes(id)).slice(0, max); st.spellsFor = key; }
      b.innerHTML = `<p class="sub" id="f-sh2">${t('Elige hasta {n} conjuros de nivel 1 a {m}. Solo aparecen los que Lantern resuelve con tirada; los demás, a mano en la hoja.', { n: max, m: maxSlot() })}</p>
        <p aria-live="polite" id="f-cnt"></p>
        <fieldset aria-describedby="f-sh2"><legend>${t('Conjuros')}</legend><div class="fila">${all.map(id =>
          `<label class="chk"><input type="checkbox" value="${id}"${st.spells.includes(id) ? ' checked' : ''}>${esc(t(SPELLS[id].name))} (${t('nv.')}${SPELLS[id].slot})</label>`).join('')}</div></fieldset>`;
      const cnt = () => { $('f-cnt').textContent = t('{a} de {b} elegidos', { a: st.spells.length, b: max }); b.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(i => { i.disabled = !i.checked && st.spells.length >= max; }); };
      b.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(i => i.onchange = () => { st.spells = [...b.querySelectorAll<HTMLInputElement>('input:checked')].map(x => x.value); cnt(); });
      cnt(); b.querySelector<HTMLElement>('input')?.focus();
    },
    b => { // 6
      const c = build();
      b.innerHTML = `<dl><dt>${t('Personaje')}</dt><dd>${esc(c.name)} — ${esc(t(SPECIES[st.species].name))} ${esc(t(CLASSES[st.cls].name))} ${st.level}</dd>
        <dt>${t('PG / CA')}</dt><dd>${c.hp!.max} / ${c.ac}</dd><dt>${t('Competencia')}</dt><dd>${sg(c.prof)}</dd>
        <dt>${t('Iniciativa')}</dt><dd>${sg(c.initMod!)}</dd><dt>${t('Velocidad')}</dt><dd>${c.speed} ${t('pies')}</dd>
        <dt>${t('Visión en la oscuridad')}</dt><dd>${c.darkvision ? `${c.darkvision / 12} ${t('pies')} (${c.darkvision} px)` : t('no')}</dd>
        <dt>${t('Características')}</dt><dd>${AB.map(a => `${t(AB_ES[a]).slice(0, 3)} ${c.abilities[a]} (${sg(mod(c.abilities[a]))})`).join(' · ')}</dd>
        <dt>${t('Salvaciones')}</dt><dd>${AB.map(a => `${t(AB_ES[a]).slice(0, 3)} ${sg(c.saves![a]!)}`).join(' · ')}</dd>
        <dt>${t('Habilidades')}</dt><dd>${st.skills.map(k => `${t(SKILLS[k][0])} ${sg(c.skills[camel(k)])}`).join(' · ')}</dd>
        <dt>${t('Acciones')}</dt><dd>${c.actions!.map(a => a.multi ? `${esc(a.name)} (${a.multi[0].n}×)` : `${esc(t(a.name))} (${a.save ? t('CD') + ' ' + a.save.dc : a.toHit != null ? sg(a.toHit) : t('curación')}, ${a.damage})`).join(' · ')}</dd>
        <dt>${t('Espacios')}</dt><dd>${Object.entries(c.slots!).map(([l, x]) => `${t('nv.')}${l}: ${x.max}`).join(' · ') || t('ninguno')}</dd></dl>`;
    },
  ];

  // Ficha calculada. ImportedCharacter no declara abilities/skills/prof (sí los tiene Token): van como propiedades extra.
  function build(): ImportedCharacter & { abilities: Record<Ability, number>; skills: Record<string, number>; prof: number } {
    const k = CLASSES[st.cls], sp = SPECIES[st.species], ab = scores()!, L = st.level;
    const prof = 2 + Math.floor((L - 1) / 4), m = (a: Ability) => mod(ab[a]);
    const hp = k.hitDie + (L - 1) * (k.hitDie / 2 + 1) + m('con') * L;
    // armadura elegida; sin armadura: Defensa sin armadura del bárbaro (+CON) y del monje (+SAB, sin escudo)
    const unarmored = 10 + m('dex') + (st.cls === 'barbarian' ? m('con') : st.cls === 'monk' && !st.shield ? m('wis') : 0);
    const base = st.armor === 'heavy' ? 16 : st.armor === 'medium' ? 14 + Math.min(m('dex'), 2) : st.armor === 'light' ? 11 + m('dex') : unarmored;
    const ac = base + (st.shield && k.armor.shield ? 2 : 0);
    const w = WEAPONS.find(x => x.id === st.weapon) ?? k.weapon;
    // ponytail: arma de fineza (estoque, daga, espada corta) usa la mejor de FUE/DES; el resto, la suya
    const wm = ['rapier', 'dagger', 'shortsword'].includes(w.id) ? Math.max(m('str'), m('dex')) : m(w.ability);
    const weapon: Action = { ...w, toHit: prof + wm, damage: w.damage + (wm ? sg(wm) : '') };
    delete (weapon as Action & { ability?: Ability }).ability;
    const actions: Action[] = [weapon];
    if (k.cast) {
      const cm = m(k.cast), scale = L >= 17 ? 4 : L >= 11 ? 3 : L >= 5 ? 2 : 1;
      for (const id of k.cantrips) {
        const sp0 = SPELLS[id], a: Action = { ...sp0, damage: sp0.damage!.replace(/^\d+/, String(scale)) };
        if (a.save) a.save = { ...a.save, dc: 8 + prof + cm }; else a.toHit = prof + cm;
        actions.push(a);
      }
      for (const id of hasSpells() ? st.spells : []) { // conjuros de nivel 1+: CD/ataque con su modificador; +3 era el marcador del mod. en curaciones
        const a: Action = { ...SPELLS[id], ...(SPELLS[id].damage && { damage: SPELLS[id].damage!.replace(/\+3$/, cm ? sg(cm) : '') }) };
        if (a.save) a.save = { ...a.save, dc: 8 + prof + cm }; else if (a.kind === 'attack') a.toHit = prof + cm;
        actions.push(a);
      }
    }
    if (EXTRA_ATTACK.includes(st.cls) && L >= 5) { // Ataque extra: encadena el arma (guerrero: 3 a nivel 11, 4 a nivel 20)
      const n = st.cls === 'fighter' ? (L >= 20 ? 4 : L >= 11 ? 3 : 2) : 2;
      actions.unshift({ id: 'extra-attack', name: t('Ataque extra'), cost: 'action', kind: 'attack', range: w.range, multi: [{ id: w.id, n }] });
    }
    const slots: NonNullable<ImportedCharacter['slots']> = {};
    k.slots[L - 1].forEach((n, i) => { if (n) slots[i + 1] = { max: n, used: 0 }; });
    return {
      ddbId: 0, name: st.name.trim(), level: L, classes: `${k.name} ${L}`, hp: { cur: hp, max: hp, temp: 0 }, ac, speed: sp.speed, initMod: m('dex'),
      saves: Object.fromEntries(AB.map(a => [a, m(a) + (k.saves.includes(a) ? prof : 0)])), darkvision: sp.darkvision * 12,
      actions, slots, defenses: sp.resist.length ? { resist: sp.resist } : undefined, abilities: ab, prof, hitDice: { die: k.hitDie, max: L, used: 0 }, ...(st.species === 'halfling' && { lucky: true }),
      skills: Object.fromEntries(Object.entries(SKILLS).map(([id, [, a]]) => [camel(id), m(a) + (st.skills.includes(id) ? prof : 0)])),
    };
  }

  function validate(): string {
    if (step === 0 && !st.name.trim()) return t('Escribe un nombre.');
    if (step === 2) {
      if ((st.method === 'std' ? st.std : st.buy).some(v => v === null)) return t('Asigna un valor a cada característica.');
      if (!st.plus2 || !st.plus1) return t('Elige a qué característica va el +2 y a cuál el +1.');
    }
    if (step === 3 && (st.skills.length < 2 || st.skills.length > 4)) return t('Elige entre 2 y 4 habilidades.');
    return '';
  }

  function show() {
    $('cr-t').textContent = `${t('Creador rápido')} · ${step + 1}/${STEPS.length} · ${STEPS[step]}`;
    dlg.querySelector('progress')!.value = step + 1;
    $('cr-a').hidden = step === 0;
    $('cr-s').textContent = step === LAST ? t('Crear') : t('Siguiente');
    $('cr-e').textContent = err;
    body[step]($('cr-b'));
    if (step === LAST) $('cr-t').focus(); // el foco inicial del resumen es el título; el cuerpo se lee tras él
  }
  $('cr-a').onclick = () => { err = ''; step--; if (step === SPELL_STEP && !hasSpells()) step--; show(); };
  dlg.querySelector('form')!.onsubmit = e => {
    e.preventDefault();
    err = validate();
    if (err) { $('cr-e').textContent = err; return; }
    if (step < LAST) { step++; if (step === SPELL_STEP && !hasSpells()) step++; show(); return; }
    onDone(build());
    dlg.close();
  };
  dlg.showModal();
  show();
}
