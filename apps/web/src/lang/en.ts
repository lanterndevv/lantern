// Inglés (terminología SRD 5.1). Un fichero por zona para poder revisarlos por separado; las claves son el texto español de t().
import a from './en-a.ts';
import b from './en-b.ts';
import c from './en-c.ts';
import d from './en-d.ts';
import e from './en-e.ts';
import f from './en-f.ts';
export default { ...a, ...b, ...c, ...d, ...e, ...f } as Record<string, string>;
