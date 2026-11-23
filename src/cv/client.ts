// Main-thread side of the CV worker. The worker (and OpenCV.js, ~3.5 MB
// compressed) is only downloaded the first time a CV feature is used.
import type { Op, Ops, Request, Response } from './protocol.ts';
import type { RGBAImage } from './types.ts';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./cv.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<Response>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Image tools failed to load'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function cvCall<K extends Op>(op: K, payload: Ops[K]['req'], transfer: Transferable[] = []): Promise<Ops[K]['res']> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ id, op, payload } as Request, transfer);
  });
}

/** Free the worker's memory (e.g. when leaving the scan screen). */
export function releaseCv() {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error('Cancelled'));
  pending.clear();
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
