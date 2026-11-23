import type { CV } from './types.ts';

/**
 * Wait for an OpenCV.js module's WASM runtime.
 *
 * The Emscripten module object has a `then` method, so it must never be awaited
 * or returned from an async function directly (that loops forever), and it
 * can't be loaded with `await import()` (the namespace re-exports `then`).
 * Callers import it statically (the worker) or with Node's `require` (tests)
 * and pass it in; the result is wrapped in a plain object.
 */
export function whenCvReady(cvModule: unknown): Promise<{ cv: CV }> {
  const cv = cvModule as CV;
  return new Promise((resolve) => {
    if (cv.Mat) return resolve({ cv });
    const prev = cv.onRuntimeInitialized;
    cv.onRuntimeInitialized = () => {
      prev?.();
      resolve({ cv });
    };
  });
}
