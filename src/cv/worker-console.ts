// Imported first by the CV worker (before OpenCV.js): forwards the worker's
// console output to the page's diagnostics log. OpenCV/Emscripten report
// load failures (e.g. "Out of memory", "abort(...)") on the console, which
// is otherwise invisible on a phone.
import type { Response } from './protocol.ts';

const post = (m: Response) => (self as unknown as Worker).postMessage(m);
const fmt = (args: unknown[]) => args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 1000);

for (const level of ['error', 'warn'] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    post({ type: 'log', level, msg: `[worker] ${fmt(args)}` });
    orig(...args);
  };
}
self.addEventListener('error', (e) => post({ type: 'log', level: 'error', msg: `[worker] Uncaught: ${e.message}` }));
self.addEventListener('unhandledrejection', (e) =>
  post({ type: 'log', level: 'error', msg: `[worker] Unhandled rejection: ${String((e.reason as Error)?.message ?? e.reason)}` }),
);
post({ type: 'status', stage: 'started', ms: 0 });
