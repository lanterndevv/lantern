// Reparto de números entre caras. Sin three: se prueba con `node --test`.
type N = { x: number; y: number; z: number };
const dot = (a: N, b: N) => a.x * b.x + a.y * b.y + a.z * b.z;
const opposite = (ns: N[], i: number) => ns.findIndex(m => dot(m, ns[i]) < -0.99);

// Etiqueta de cada cara: caras opuestas suman N+1 (con L[k] + L[N-1-k]). El d4 no tiene opuestas.
export function assignLabels(ns: N[], L: string[]): string[] {
  const out: string[] = [], N = ns.length;
  let k = 0;
  ns.forEach((n, i) => {
    if (out[i] !== undefined) return;
    const j = ns.findIndex((g, m) => m !== i && out[m] === undefined && dot(g, n) < -0.99);
    out[i] = L[k];
    if (j >= 0) out[j] = L[N - 1 - k];
    k++;
  });
  return out;
}

// Deja `target` en la cara `read` (la que quedó arriba tras la física) intercambiando etiquetas;
// las opuestas se intercambian a la par para que sigan sumando N+1.
export function relabel(labels: string[], ns: N[], read: number, target: string): string[] {
  const out = [...labels], f = out.indexOf(target);
  if (f < 0) { out[read] = target; return out; } // valor fuera de rango: se escribe igualmente
  if (f === read) return out;
  const oR = opposite(ns, read), oF = opposite(ns, f);
  [out[read], out[f]] = [out[f], out[read]];
  if (oR >= 0 && oF >= 0 && f !== oR) [out[oR], out[oF]] = [out[oF], out[oR]];
  return out;
}
