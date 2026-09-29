import { t } from './i18n.ts';
// Paquete de audio incluido (todo CC0, ver public/audio/CREDITS.md). Se reproduce con el mismo mecanismo que las subidas.
export type PackItem = { id: string; nombre: string; tipo: 'musica' | 'ambiente'; url: string; creditos: string };

const P = (id: string, nombre: string, tipo: PackItem['tipo'], creditos: string): PackItem => ({ id, nombre, tipo, url: `/audio/${id}.ogg`, creditos });

export const AUDIO_PACK: PackItem[] = [
  P('taberna', t('Taberna'), 'musica', 'The Old Tower Inn, RandomMind (CC0)'),
  P('exploracion', t('Exploración'), 'musica', 'Exploration, RandomMind (CC0)'),
  P('mazmorra', t('Mazmorra'), 'musica', 'Dark Theme, JaggedStone (CC0)'),
  P('combate', t('Combate'), 'musica', 'Battle Theme A, cynicmusic (CC0)'),
  P('calma', t('Calma / descanso'), 'musica', 'Contemplation, Joth (CC0)'),
  P('jefe', t('Épica / jefe'), 'musica', 'Epic Boss Battle, Juhani Junkala (CC0)'),
  P('lluvia', t('Lluvia'), 'ambiente', 'AMB Rain Loop 1, Kresiek the Furry (CC0)'),
  P('hoguera', t('Hoguera / chimenea'), 'ambiente', 'Fireplace Sound loop, pagdev (CC0)'),
  P('cueva', t('Cueva con goteo'), 'ambiente', 'Dripping water loop, qubodup (CC0)'),
  P('viento', t('Viento'), 'ambiente', 'Mild Wind Background Noise, bashar3a (CC0)'),
];

export const packOptions = (tipo: PackItem['tipo']) =>
  '<option value="">' + t('Paquete incluido…') + '</option>' + AUDIO_PACK.filter(p => p.tipo === tipo).map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
