// Laya (motor de decisión «System 1») como proceso auxiliar: tools/laya/sidecar.py, JSON por líneas. Se arranca en el primer uso.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

export type LayaQuestions = Record<string, unknown>;
const HERE = new URL('../../../tools/laya/', import.meta.url).pathname;
const TIMEOUT_MS = 3000;
let proc: ChildProcess | undefined, ready: Promise<void> | undefined, seq = 0, loaded = false;
const waiting = new Map<number, (r: { answers?: Record<string, { choice?: string; probabilities?: Record<string, number> }>; error?: string }) => void>();

const python = () => process.env.LANTERN_LAYA_PYTHON || (existsSync(`${HERE}.venv/bin/python`) ? `${HERE}.venv/bin/python` : undefined);
export const layaOn = () => process.env.LANTERN_LAYA !== '0' && !!python();
export const copilotOn = () => layaOn() || !!process.env.LANTERN_LLM_URL; // lo que ve la UI: hay Laya o LLM

// Dentro del ejecutable único (SEA) el sidecar viaja como asset: se extrae a la carpeta de datos.
function sidecar(): string {
  const sea = process.getBuiltinModule('node:sea');
  if (!sea.isSea()) return `${HERE}sidecar.py`;
  const dir = join(dirname(resolve(process.env.LANTERN_DB ?? 'lantern.db')), 'laya'), file = join(dir, 'sidecar.py');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, Buffer.from(sea.getAsset('sidecar.py')));
  return file;
}

// off = desactivada o sin Python; loading = cargando el modelo (o aún sin arrancar); ready = responde
export const layaState = (): 'off' | 'loading' | 'ready' => !layaOn() ? 'off' : loaded && proc ? 'ready' : 'loading';

function start(): Promise<void> {
  loaded = false;
  const p = spawn(python()!, [sidecar()], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, LANTERN_LAYA_DEVICE: process.env.LANTERN_LAYA_DEVICE || 'cpu' } });
  proc = p;
  const r = new Promise<void>((ok) => {
    createInterface({ input: p.stdout! }).on('line', (l) => {
      try {
        const m = JSON.parse(l);
        if (m.ready) { loaded = true; ok(); } else waiting.get(m.id)?.(m);
      } catch { /* línea ajena al protocolo */ }
    });
  });
  p.stdin!.on('error', () => {});
  p.on('exit', () => { if (proc === p) { proc = ready = undefined; loaded = false; } for (const f of waiting.values()) f({ error: 'laya terminó' }); }); // se reinicia en la siguiente petición
  return r;
}

// Devuelve la opción elegida (clave de `criteria`) o undefined si Laya no está, falla o tarda más de 3 s.
export async function askLaya(state: string, questions: LayaQuestions, pick = 'pick'): Promise<string | undefined> {
  if (!layaOn()) return undefined;
  const id = ++seq;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    ready ??= start();
    const res = await Promise.race([
      ready.then(() => new Promise<{ answers?: Record<string, { choice?: string }> }>((ok) => { waiting.set(id, ok); proc!.stdin!.write(`${JSON.stringify({ id, state, questions })}\n`); })),
      new Promise<undefined>((ok) => { timer = setTimeout(() => ok(undefined), TIMEOUT_MS) as typeof timer; }), // el modelo sigue cargando en segundo plano
    ]);
    return res?.answers?.[pick]?.choice;
  } catch { return undefined; } finally { clearTimeout(timer); waiting.delete(id); }
}

// Carga el modelo al arrancar (~4 s en CPU) para que el primer turno no caiga en la heurística; no en los tests.
export function warmLaya() { if (layaOn() && !process.env.NODE_TEST_CONTEXT) ready ??= start(); }

export function stopLaya() { proc?.kill(); proc = ready = undefined; loaded = false; }
