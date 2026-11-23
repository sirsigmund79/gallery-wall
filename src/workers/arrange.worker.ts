/// <reference lib="webworker" />
// Runs auto-arrange off the main thread (spec §6.6).
import { suggest, type ArrangeInput } from '../geometry/layout/arrange/index.ts';

self.onmessage = (e: MessageEvent<{ id: number; input: ArrangeInput }>) => {
  const t0 = performance.now();
  try {
    const variants = suggest(e.data.input);
    (self as unknown as Worker).postMessage({ id: e.data.id, ok: true, variants, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: e.data.id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
