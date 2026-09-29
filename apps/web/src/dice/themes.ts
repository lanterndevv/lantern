// Aspecto de cada set de dados. Fuente única para el renderer 3D (dice3d.ts) y el diseño.
import type { DiceTheme } from '@lantern/protocol';
import { t } from '../i18n.ts';

export type DiceLook = {
  name: string;          // nombre visible
  body: string;          // color del cuerpo
  number: string;        // color de los números
  numberGlow: number;    // 0..1 emisión de los números (brasa, runas)
  roughness: number;     // 0 pulido … 1 mate
  metalness: number;     // 0 dieléctrico … 1 metal
  transmission: number;  // 0 opaco … 1 cristal
  edge: string;          // color del biselado/aristas
  note: string;          // descripción corta para el selector
};

export const DICE: Record<DiceTheme, DiceLook> = {
  linterna:  { name: t('Ámbar de linterna'), body: '#E8A33D', number: '#2A1606', numberGlow: 0,   roughness: 0.25, metalness: 0,    transmission: 0.55, edge: '#FFD27A', note: t('Resina ámbar translúcida; el set de la casa.') },
  obsidiana: { name: t('Obsidiana y brasa'), body: '#141013', number: '#FF8A2A', numberGlow: 0.9, roughness: 0.15, metalness: 0.1,  transmission: 0,    edge: '#3A2A22', note: t('Vidrio volcánico con números incandescentes.') },
  hueso:     { name: t('Hueso tallado'),     body: '#E9DCC2', number: '#5A3A22', numberGlow: 0,   roughness: 0.8,  metalness: 0,    transmission: 0,    edge: '#C9B48C', note: t('Marfil envejecido con grabado sepia.') },
  escarcha:  { name: t('Escarcha'),          body: '#BFE9FF', number: '#F4FBFF', numberGlow: 0.5, roughness: 0.1,  metalness: 0,    transmission: 0.7,  edge: '#E8F8FF', note: t('Hielo cristalino, números que brillan en frío.') },
  bronce:    { name: t('Bronce antiguo'),    body: '#9C6B35', number: '#1E3B34', numberGlow: 0,   roughness: 0.35, metalness: 0.85, transmission: 0,    edge: '#5E8C7A', note: t('Metal con pátina verde en las aristas.') },
  esmeralda: { name: t('Esmeralda venenosa'),body: '#1F8A55', number: '#F5C877', numberGlow: 0.2, roughness: 0.3,  metalness: 0,    transmission: 0.3,  edge: '#6FCB7C', note: t('Piedra jaspeada con números dorados.') },
  arcano:    { name: t('Cuarzo arcano'),     body: '#7A4FD0', number: '#FFE08A', numberGlow: 0.8, roughness: 0.2,  metalness: 0,    transmission: 0.5,  edge: '#C29CF5', note: t('Cristal violeta con runas encendidas.') },
  dragon:    { name: t('Sangre de dragón'),  body: '#8A1622', number: '#F2E8DA', numberGlow: 0,   roughness: 0.2,  metalness: 0.15, transmission: 0.15, edge: '#D94A3A', note: t('Rojo profundo lacado, escamas en las caras.') },
};
