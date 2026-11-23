import { error as logError, info } from '../diag/log.ts';
import type { ArrangeInput, Variant } from '../geometry/layout/arrange/index.ts';

let worker: Worker | null = null;
let nextId = 1;
const TIMEOUT_MS = 15_000;

export function suggestInWorker(input: ArrangeInput): Promise<Variant[]> {
  worker ??= new Worker(new URL('./arrange.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      w.removeEventListener('message', onMsg);
      logError('Suggest: timed out');
      reject(new Error('Suggestions took too long'));
    }, TIMEOUT_MS);
    function onMsg(e: MessageEvent<{ id: number; ok: boolean; variants?: Variant[]; error?: string; ms?: number }>) {
      if (e.data.id !== id) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMsg);
      if (e.data.ok) {
        info(`Suggest: ${e.data.variants!.length} variants in ${e.data.ms} ms (${input.mode}, ${input.style}, ${input.pool.length} pieces)`);
        resolve(e.data.variants!);
      } else {
        logError('Suggest failed:', e.data.error);
        reject(new Error(e.data.error));
      }
    }
    w.addEventListener('message', onMsg);
    w.onerror = (e) => {
      clearTimeout(timer);
      logError('Suggest worker error:', e.message);
      reject(new Error(e.message || 'Suggestions failed'));
      worker = null;
    };
    w.postMessage({ id, input });
  });
}
