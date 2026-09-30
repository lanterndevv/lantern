// Prueba manual: «t» cambia de set, espacio relanza la batería. Cada animación se verifica en consola.
import '../styles.css';
import type { Die, DiceTheme } from '@lantern/protocol';
import { createDiceTray } from './dice3d.ts';
import { DICE } from './themes.ts';

const themes = Object.keys(DICE) as DiceTheme[];
// ?v=7 fija el valor (verificación visual) · ?d=20 tira solo ese tipo de dado · ?set=obsidiana elige set
const q = new URLSearchParams(location.search), fixed = Number(q.get('v')) || 0, only = Number(q.get('d')) || 0;
let ti = Math.max(0, themes.indexOf(q.get('set') as DiceTheme));
const rnd = (s: number) => fixed ? Math.min(fixed, s) : 1 + Math.floor(Math.random() * s);
const many = (n: number, s: number, dropFirst = false): Die[] => Array.from({ length: n }, (_, i) => ({ sides: s, value: rnd(s), kept: !(dropFirst && i === 0) }));
const battery: [string, () => Die[]][] = [
  ['1d20', () => many(1, 20)], ['2d20 (uno descartado)', () => many(2, 20, true)], ['8d6', () => many(8, 6)], ['1d4', () => many(1, 4)],
  ['1d8', () => many(1, 8)], ['1d10', () => many(1, 10)], ['1d12', () => many(1, 12)], ['1d100', () => many(1, 100)],
];
const help = document.getElementById('ayuda')!;
const tray = createDiceTray(document.body, res => {
  const bad = res.filter(r => r.shown !== r.die.value);
  if (bad.length) console.error('DADOS: la cara visible NO coincide', bad.map(r => `d${r.die.sides}: esperado ${r.die.value}, se ve ${r.shown}`));
  else console.log('dados ok', res.map(r => `d${r.die.sides}=${r.shown}`).join(' '));
});
const go = () => {
  help.textContent = `set: ${DICE[themes[ti]].name} (t: siguiente set · espacio: relanzar)`;
  for (const [name, f] of battery.filter(([n]) => !only || n.includes('d' + only))) {
    const dice = f();
    tray.roll(dice, themes[ti], `${name} · ${DICE[themes[ti]].name}`, dice.filter(d => d.kept).reduce((a, d) => a + d.value, 0));
  }
};
addEventListener('keydown', e => {
  if (e.key === 't') { ti = (ti + 1) % themes.length; go(); }
  else if (e.key === ' ') { e.preventDefault(); go(); }
});
help.textContent = 'espacio: tirar la batería · t: siguiente set';
