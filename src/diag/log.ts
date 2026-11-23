// On-device diagnostics log. Phones have no visible console, so errors,
// warnings and our own progress events are kept here (in memory and in
// sessionStorage) and shown under Settings → Diagnostics, with a Copy button.
// Nothing is ever sent anywhere.

export type Level = 'info' | 'warn' | 'error';
export interface Entry {
  t: number;
  level: Level;
  msg: string;
}

const KEY = 'hangplan.diag';
const MAX = 300;
let entries: Entry[] = load();
const listeners = new Set<() => void>();

function load(): Entry[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as Entry[];
  } catch {
    return [];
  }
}

function persist() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* storage full or blocked: keep in memory only */
  }
}

const fmt = (x: unknown): string => {
  if (x instanceof Error) return `${x.name}: ${x.message}${x.stack ? `\n${x.stack.split('\n').slice(0, 4).join('\n')}` : ''}`;
  if (typeof x === 'string') return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
};

export function log(level: Level, ...parts: unknown[]) {
  entries = [...entries, { t: Date.now(), level, msg: parts.map(fmt).join(' ').slice(0, 2000) }].slice(-MAX);
  persist();
  listeners.forEach((l) => l());
}

export const info = (...p: unknown[]) => log('info', ...p);
export const warn = (...p: unknown[]) => log('warn', ...p);
export const error = (...p: unknown[]) => log('error', ...p);

export const getEntries = () => entries;
export function clearLog() {
  entries = [];
  persist();
  listeners.forEach((l) => l());
}
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Device/browser facts that matter for debugging camera, sensors and the image tools. */
export function environmentReport(): string {
  const n = navigator as Navigator & { deviceMemory?: number };
  const lines = [
    `App build: ${import.meta.env.MODE}`,
    `User agent: ${n.userAgent}`,
    `Screen: ${screen.width}×${screen.height} @${devicePixelRatio}x, orientation ${screen.orientation?.type ?? 'n/a'} ${screen.orientation?.angle ?? ''}`,
    `Secure context: ${window.isSecureContext}`,
    `Cores: ${n.hardwareConcurrency ?? '?'}, memory: ${n.deviceMemory ?? '?'} GB`,
    `WebAssembly: ${typeof WebAssembly === 'object'}`,
    `OffscreenCanvas: ${typeof OffscreenCanvas !== 'undefined'}`,
    `Camera API: ${!!navigator.mediaDevices?.getUserMedia}`,
    `Motion API: ${'DeviceOrientationEvent' in window}${typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown })?.requestPermission === 'function' ? ' (needs permission)' : ''}`,
    `Service worker: ${navigator.serviceWorker?.controller ? 'active' : 'none'}`,
  ];
  return lines.join('\n');
}

export function reportText(): string {
  const body = entries.map((e) => `${new Date(e.t).toISOString().slice(11, 23)} ${e.level.toUpperCase().padEnd(5)} ${e.msg}`).join('\n');
  return `${environmentReport()}\n\n--- Log ---\n${body || '(empty)'}`;
}

/** Capture uncaught errors and console warnings/errors from the whole app. */
export function installGlobalCapture() {
  window.addEventListener('error', (e) => error('Uncaught:', e.message, e.filename ? `${e.filename}:${e.lineno}` : ''));
  window.addEventListener('unhandledrejection', (e) => error('Unhandled promise rejection:', e.reason));
  const wrap = (level: 'warn' | 'error') => {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      log(level, ...args);
      orig(...args);
    };
  };
  wrap('warn');
  wrap('error');
}
