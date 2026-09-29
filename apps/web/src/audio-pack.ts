// Paquete de audio incluido (todo CC0, ver public/audio/CREDITS.md). Se reproduce con el mismo mecanismo que las subidas.
export type PackItem = { id: string; nombre: string; tipo: 'musica' | 'ambiente'; url: string; creditos: string };

const P = (id: string, nombre: string, tipo: PackItem['tipo'], creditos: string): PackItem => ({ id, nombre, tipo, url: `/audio/${id}.ogg`, creditos });

export const AUDIO_PACK: PackItem[] = [
  P('taberna', 'Taberna', 'musica', 'The Old Tower Inn, RandomMind (CC0)'),
  P('exploracion', 'Exploración', 'musica', 'Exploration, RandomMind (CC0)'),
  P('mazmorra', 'Mazmorra', 'musica', 'Dark Theme, JaggedStone (CC0)'),
  P('combate', 'Combate', 'musica', 'Battle Theme A, cynicmusic (CC0)'),
  P('calma', 'Calma / descanso', 'musica', 'Contemplation, Joth (CC0)'),
  P('jefe', 'Épica / jefe', 'musica', 'Epic Boss Battle, Juhani Junkala (CC0)'),
  P('lluvia', 'Lluvia', 'ambiente', 'AMB Rain Loop 1, Kresiek the Furry (CC0)'),
  P('hoguera', 'Hoguera / chimenea', 'ambiente', 'Fireplace Sound loop, pagdev (CC0)'),
  P('cueva', 'Cueva con goteo', 'ambiente', 'Dripping water loop, qubodup (CC0)'),
  P('viento', 'Viento', 'ambiente', 'Mild Wind Background Noise, bashar3a (CC0)'),
];

export const packOptions = (tipo: PackItem['tipo']) =>
  '<option value="">Paquete incluido…</option>' + AUDIO_PACK.filter(p => p.tipo === tipo).map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
