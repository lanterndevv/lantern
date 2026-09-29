// Compendio SRD 5.2 (CC-BY-4.0). Lo rellena el agente de reglas.
import type { Token } from '@lantern/protocol';
export type SrdMonster = Omit<Token, 'id' | 'x' | 'y' | 'owners' | 'hidden'> & { cr: string; type: string };
export const MONSTERS: Record<string, SrdMonster> = {};
