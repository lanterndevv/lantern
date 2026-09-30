import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignLabels, relabel } from './labels.ts';

const cube = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => ({ x, y, z }));
const s = 1 / Math.sqrt(3);
const octa = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ x: i & 1 ? s : -s, y: i & 2 ? s : -s, z: i & 4 ? s : -s }));
const tetra = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(([x, y, z]) => ({ x: x * s, y: y * s, z: z * s }));

for (const [name, ns] of [['d4', tetra], ['d6', cube], ['d8', octa]] as const) test(`relabel ${name}: cualquier cara, cualquier valor`, () => {
  const N = ns.length, L = Array.from({ length: N }, (_, i) => String(i + 1)), base = assignLabels(ns, L);
  for (let read = 0; read < N; read++) for (const t of L) {
    const out = relabel(base, ns, read, t);
    assert.equal(out[read], t);
    assert.deepEqual([...out].sort(), [...L].sort());
    if (N > 4) ns.forEach((n, i) => {
      const j = ns.findIndex(m => m.x * n.x + m.y * n.y + m.z * n.z < -0.99);
      assert.equal(Number(out[i]) + Number(out[j]), N + 1);
    });
  }
});
