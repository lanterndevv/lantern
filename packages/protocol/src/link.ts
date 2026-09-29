// Mensajes entre la página de Lantern y la extensión Lantern Link, vía window.postMessage.
// Todos llevan `lantern: 'link'` para distinguirlos; `rid` empareja petición y respuesta.
import type { ImportedCharacter } from './index.ts';

export type LinkReq =
  | { lantern: 'link'; dir: 'req'; rid: string; t: 'ping' }
  | { lantern: 'link'; dir: 'req'; rid: string; t: 'getCharacter'; id: number };   // id numérico de dndbeyond.com/characters/<id>

export type LinkRes =
  | { lantern: 'link'; dir: 'res'; rid: string; t: 'pong'; version: string; loggedIn: boolean }
  | { lantern: 'link'; dir: 'res'; rid: string; t: 'character'; data: ImportedCharacter }
  | { lantern: 'link'; dir: 'res'; rid: string; t: 'error'; msg: string };

// Extrae el id de «https://www.dndbeyond.com/characters/12345678/abcd» o de «12345678».
export const ddbCharacterId = (s: string): number | undefined => {
  const m = s.trim().match(/(?:characters\/)?(\d{4,12})(?:\D|$)/);
  return m ? Number(m[1]) : undefined;
};
