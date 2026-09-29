import { monsterSearch, spellSearch } from './compendium.ts';

// Pantalla del DM: referencia rápida (resúmenes propios). Contenido basado en el SRD 5.2.1, © Wizards of the Coast LLC, CC-BY-4.0.
type Sec = { id: string; title: string; rows: [string, string][] };

const COND: [string, string][] = [
  ['Agotamiento', 'Niveles 1–6: −2 por nivel a las pruebas d20 y a la CD de conjuros, −5 pies de velocidad por nivel; nivel 6 = muerte. Un descanso largo quita 1 nivel.'],
  ['Apresado', 'Velocidad 0. Desventaja al atacar a cualquiera salvo a quien te agarra. Acaba si el agarrador queda incapacitado o te alejan.'],
  ['Asustado', 'Desventaja en pruebas y ataques mientras veas la fuente del miedo. No puedes acercarte voluntariamente a ella.'],
  ['Aturdido', 'Incapacitado, no te mueves y hablas con dificultad. Fallas salvaciones de FUE y DES. Los ataques contra ti tienen ventaja.'],
  ['Cegado', 'No ves; fallas pruebas que requieran vista. Tus ataques tienen desventaja y los ataques contra ti, ventaja.'],
  ['Derribado', 'Solo te arrastras (o te levantas gastando la mitad de la velocidad). Desventaja al atacar. Cuerpo a cuerpo a 5 pies contra ti: ventaja; a distancia: desventaja.'],
  ['Ensordecido', 'No oyes; fallas pruebas que requieran oído.'],
  ['Hechizado', 'No puedes atacar a quien te hechizó ni tenerlo como objetivo de efectos dañinos. Esa criatura tiene ventaja en interacciones sociales contigo.'],
  ['Incapacitado', 'No puedes hacer acciones, acciones adicionales ni reacciones. Pierdes la concentración. No hablas; sorprendido si lo estabas al tirar iniciativa.'],
  ['Inconsciente', 'Incapacitado, caído, sin conciencia. Ataques contra ti con ventaja; los cuerpo a cuerpo a 5 pies son críticos automáticos. Fallas salvaciones de FUE y DES.'],
  ['Invisible', 'Ventaja a tu iniciativa y a tus ataques; los ataques contra ti, desventaja. No te ven salvo por magia o sentidos especiales.'],
  ['Paralizado', 'Incapacitado, no te mueves ni hablas. Fallas salvaciones de FUE y DES. Ataques contra ti con ventaja; cuerpo a cuerpo a 5 pies, crítico automático.'],
  ['Petrificado', 'Convertido en piedra: incapacitado, peso ×10, sin envejecer. Resistencia a todo el daño, inmune a veneno y enfermedad. Ataques contra ti con ventaja.'],
  ['Envenenado', 'Desventaja en tiradas de ataque y en pruebas de característica.'],
  ['Restringido', 'Velocidad 0. Ataques contra ti con ventaja, tus ataques con desventaja. Desventaja en salvaciones de DES.'],
];

const SECS: Sec[] = [
  { id: 'cond', title: 'Condiciones (15)', rows: COND },
  { id: 'cob', title: 'Cobertura', rows: [
    ['Media (½)', '+2 a la CA y a las salvaciones de DES.'],
    ['Tres cuartos (¾)', '+5 a la CA y a las salvaciones de DES.'],
    ['Total', 'No se puede elegir como objetivo directo de ataques ni de la mayoría de conjuros; solo áreas que lleguen hasta el objetivo.'],
  ] },
  { id: 'cd', title: 'CD sugeridas', rows: [
    ['Muy fácil', '5'], ['Fácil', '10'], ['Media', '15'], ['Difícil', '20'], ['Muy difícil', '25'], ['Casi imposible', '30'],
  ] },
  { id: 'viaje', title: 'Viaje (por hora / día)', rows: [
    ['Lento', '2 mi/h · 18 mi/día. Permite moverse en sigilo.'],
    ['Normal', '3 mi/h · 24 mi/día.'],
    ['Rápido', '4 mi/h · 30 mi/día. −5 a la Sabiduría (Percepción) pasiva.'],
    ['Terreno difícil', 'Cuesta el doble de movimiento: mitad de distancia.'],
    ['Marcha forzada', 'Pasadas 8 h de viaje, cada hora extra exige salvación de CON (CD 10 + 1 por hora extra) o +1 de agotamiento.'],
  ] },
  { id: 'luz', title: 'Luz y visión', rows: [
    ['Luz brillante', 'Se ve con normalidad.'],
    ['Luz tenue', 'Zona de oscuridad ligera: desventaja en Percepción basada en vista.'],
    ['Oscuridad', 'Zona muy oscura: cuentas como cegado respecto a lo que hay en ella.'],
    ['Visión en la oscuridad', 'Hasta su alcance, la oscuridad cuenta como luz tenue y la luz tenue como brillante (sin color en la oscuridad).'],
    ['Visión ciega / verdadera', 'Percibe sin depender de la luz, en su alcance. La verdadera además ve lo invisible y lo mágicamente oculto.'],
    ['Antorcha', 'Luz brillante 20 pies y tenue 20 más; arde 1 hora.'],
  ] },
  { id: 'desc', title: 'Descansos', rows: [
    ['Descanso corto', 'Al menos 1 hora. Se gastan Dados de Golpe para curar; se recuperan algunas capacidades de clase.'],
    ['Descanso largo', 'Al menos 8 h (máx. 6 h activo). Recuperas todos los PG y la mitad de tus Dados de Golpe; los espacios de conjuro; −1 agotamiento. Solo uno cada 24 h.'],
  ] },
];

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

/** Monta la pantalla en `el` (pestaña «Pantalla» o panel acoplable). */
export function mountDmScreen(el: HTMLElement) {
  el.classList.add('dms');
  el.innerHTML = `<label>Buscar en la pantalla<input type="search" id="dms-q" autocomplete="off" aria-controls="dms-out"></label>
    <p class="sr" id="dms-n" role="status" aria-live="polite"></p><div id="dms-out"></div>
    <p class="det">Referencia resumida basada en el SRD 5.2.1 de Wizards of the Coast, bajo licencia
    <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC-BY-4.0</a>.</p>`;
  const out = el.querySelector<HTMLElement>('#dms-out')!, n = el.querySelector('#dms-n')!;
  const draw = (f: string) => {
    const k = f.trim().toLowerCase();
    const secs = SECS.map(s => ({ s, rows: !k || s.title.toLowerCase().includes(k) ? s.rows : s.rows.filter(r => (r[0] + ' ' + r[1]).toLowerCase().includes(k)) })).filter(x => x.rows.length);
    out.innerHTML = secs.map(({ s, rows }) => `<section aria-labelledby="dms-${s.id}"><h3 id="dms-${s.id}">${esc(s.title)}</h3><dl>${rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl></section>`).join('') || '<p class="det">Sin resultados.</p>';
    n.textContent = `${secs.reduce((a, x) => a + x.rows.length, 0)} entradas en ${secs.length} secciones`;
  };
  for (const [title, fill] of [['Buscador de conjuros', spellSearch], ['Buscador de monstruos', (b: HTMLElement) => monsterSearch(b)]] as const) { // perezosos: se rellenan al abrir
    const d = document.createElement('details'), box = document.createElement('div');
    d.innerHTML = `<summary>${title}</summary>`; d.append(box);
    d.addEventListener('toggle', () => { if (d.open && !box.hasChildNodes()) fill(box); });
    el.querySelector('#dms-out')!.before(d);
  }
  el.querySelector('#dms-q')!.addEventListener('input', e => draw((e.target as HTMLInputElement).value));
  draw('');
}
