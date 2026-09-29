// Permisos unificados (§3.17). Roles: dm/assistant ven y controlan todo; el resto depende de owners, visibleTo (escena/documento).
import type { JournalEntry, Scene, Token } from '@lantern/protocol';
import type { MemberRec } from './room.ts';

export const isDM = (m: MemberRec) => m.role === 'dm' || m.role === 'assistant';
/** Token: «controlar» (mover/actuar) = DM/asistente o miembro listado en owners. */
export const canControl = (t: Pick<Token, 'owners'>, m: MemberRec) => isDM(m) || t.owners.includes(m.id);
/** Documento del diario: 'all', 'dm' (solo DM) o lista de miembros. */
export const canReadDoc = (e: Pick<JournalEntry, 'visibleTo'>, m: MemberRec) => isDM(m) || e.visibleTo === 'all' || (Array.isArray(e.visibleTo) && e.visibleTo.includes(m.id));
/** Escena: sin visibleTo la ven todos; con lista, solo esos miembros (y el DM). */
export const canSeeScene = (s: Pick<Scene, 'visibleTo'>, m: MemberRec) => isDM(m) || !s.visibleTo || s.visibleTo.includes(m.id);
