// Main-thread side of the CV worker. The worker (and OpenCV.js, ~3.5 MB
// compressed) is only downloaded the first time a CV feature is used.
// Every call has a time limit, and progress is written to the diagnostics log.
import { error as logError, info, warn } from '../diag/log.ts';
import type { Op, Ops, Request, Response } from './protocol.ts';
import type { RGBAImage } from './types.ts';

/** Max time to download and start the image tools (slow mobile connections). */
export const LOAD_TIMEOUT_MS = 120_000;
/** Max time for any single operation once loaded. */
export const OP_TIMEOUT_MS = 60_000;

export type CvState = 'idle' | 'loading' | 'ready' | 'failed';

let worker: Worker | null = null;
let state: CvState = 'idle';
let loadStart = 0;
let nextId = 1;
const pending = new Map<number, { op: Op; resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const stateListeners = new Set<(s: CvState) => void>();

function setState(s: CvState) {
  state = s;
  stateListeners.forEach((l) => l(s));
}
export const cvState = () => state;
export function onCvState(l: (s: CvState) => void) {
  stateListeners.add(l);
  return () => stateListeners.delete(l);
}

function failAll(msg: string) {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error(msg));
  }
  pending.clear();
}

function crash(msg: string) {
  logError('Image tools:', msg);
  setState('failed');
  failAll(msg);
  worker?.terminate();
  worker = null;
}

function getWorker(): Worker {
  if (worker) return worker;
  info('Image tools: starting worker');
  loadStart = performance.now();
  setState('loading');
  try {
    worker = new Worker(new URL('./cv.worker.ts', import.meta.url), { type: 'module' });
  } catch (e) {
    crash(`could not start worker (${(e as Error).message}). This browser may not support module workers.`);
    throw e;
  }
  worker.onmessage = (e: MessageEvent<Response>) => {
    const m = e.data;
    if ('type' in m) {
      if (m.type === 'status' && m.stage === 'started') info(`Image tools: worker script running after ${Math.round(performance.now() - loadStart)} ms`);
      else if (m.type === 'status' && m.stage === 'failed') crash(`OpenCV could not start: ${m.error ?? 'unknown error'}`);
      else if (m.type === 'status' && m.stage === 'ready') {
        info(`Image tools: ready (OpenCV init ${m.ms} ms; ${Math.round(performance.now() - loadStart)} ms since start)`);
        setState('ready');
      } else if (m.type === 'log') (m.level === 'error' ? logError : m.level === 'warn' ? warn : info)(m.msg);
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) {
      info(`Image tools: ${p.op} done in ${m.ms} ms`);
      p.resolve(m.result);
    } else {
      logError(`Image tools: ${p.op} failed:`, m.error);
      p.reject(new Error(m.error));
    }
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    crash(e.message || 'the worker failed to load (network error, or not enough memory)');
  };
  worker.onmessageerror = () => crash('could not read a message from the worker');
  return worker;
}

export function cvCall<K extends Op>(op: K, payload: Ops[K]['req'], transfer: Transferable[] = []): Promise<Ops[K]['res']> {
  const id = nextId++;
  const w = getWorker();
  // While the tools are still loading, allow for the download as well.
  const limit = state === 'ready' ? OP_TIMEOUT_MS : LOAD_TIMEOUT_MS + OP_TIMEOUT_MS;
  info(`Image tools: ${op} requested${state !== 'ready' ? ` (tools ${state})` : ''}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      const msg =
        state === 'ready'
          ? `${op} took longer than ${OP_TIMEOUT_MS / 1000} s`
          : `the image tools did not finish loading within ${Math.round(limit / 1000)} s`;
      logError('Image tools: timeout:', msg);
      if (state !== 'ready') crash(msg);
      reject(new Error(msg));
    }, limit);
    pending.set(id, { op, resolve: resolve as (v: unknown) => void, reject, timer });
    w.postMessage({ id, op, payload } as Request, transfer);
  });
}

/**
 * Load the tools and run a small detection: reports timings, or the error.
 * Used by Settings → Diagnostics.
 */
export async function selfTest(): Promise<string> {
  const t0 = performance.now();
  const W = 640, H = 480;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = (i / W) | 0;
    const inside = x > 200 && x < 440 && y > 120 && y < 360;
    data.set(inside ? [30, 30, 30, 255] : [200, 190, 170, 255], i * 4);
  }
  const quads = await cvCall('detect', { img: { data, width: W, height: H } }, [data.buffer]);
  return `OK: found ${quads.length} rectangle${quads.length === 1 ? '' : 's'} (expected 1) in ${Math.round(performance.now() - t0)} ms including load.`;
}

/** Free the worker's memory (e.g. when leaving the scan screen). */
export function releaseCv() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  failAll('Cancelled');
  setState('idle');
}

/** Copy an image so it can be transferred to the worker without losing ours. */
export const cloneImage = (img: RGBAImage): RGBAImage => ({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height });

// ── Canvas helpers ──

export async function blobToRGBA(blob: Blob, maxPx: number): Promise<RGBAImage> {
  const { decodeImage, fitSize } = await import('../media/image.ts');
  const { bitmap } = await decodeImage(blob);
  try {
    const { w, h } = fitSize(bitmap.width, bitmap.height, maxPx);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    c.width = c.height = 0;
    return { data: d.data, width: w, height: h };
  } finally {
    bitmap.close();
  }
}

export function rgbaToCanvas(img: RGBAImage): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), 'image/jpeg', quality));
}

export const rgbaToBlob = (img: RGBAImage, quality = 0.9) => canvasToBlob(rgbaToCanvas(img), quality);
