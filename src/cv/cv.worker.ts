/// <reference lib="webworker" />
// Runs OpenCV.js off the main thread (spec §3: heavy CV in workers).
// Reports its start-up and any crash to the page, which has no other way to
// see what happens in here on a phone.
// Must stay the first import: it hooks the console before OpenCV loads.
import './worker-console.ts';
import cvModule from '@techstark/opencv-js';
import { detectDoorways, detectQuads, perspectiveTransform, rectifyQuad, suggestFloorLine, warpImage } from './detect.ts';
import { whenCvReady } from './load.ts';
import type { Request, Response } from './protocol.ts';
import type { RGBAImage } from './types.ts';

const post = (m: Response, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
const t0 = performance.now();

// Emscripten calls onAbort when the runtime dies (e.g. it can't get memory).
// Without this the page would wait forever for "ready".
let aborted: string | null = null;
(cvModule as { onAbort?: (what: unknown) => void }).onAbort = (what) => {
  aborted = String(what);
  post({ type: 'log', level: 'error', msg: `[worker] OpenCV aborted: ${aborted}` });
  post({ type: 'status', stage: 'failed', ms: Math.round(performance.now() - t0), error: aborted });
};

const ready = whenCvReady(cvModule).then((r) => {
  post({ type: 'status', stage: 'ready', ms: Math.round(performance.now() - t0) });
  return r;
});

const transferOf = (r: unknown): Transferable[] => {
  const imgs = Array.isArray(r) ? r : [r];
  return imgs.flatMap((x) => (x && typeof x === 'object' && 'data' in x && (x as RGBAImage).data instanceof Uint8ClampedArray ? [(x as RGBAImage).data.buffer] : []));
};

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  try {
    if (aborted) throw new Error(`OpenCV could not start: ${aborted}`);
    const { cv } = await ready;
    const start = performance.now();
    let result: unknown;
    switch (req.op) {
      case 'detect':
        result = detectQuads(cv, req.payload.img, undefined, { keepNested: req.payload.keepNested });
        break;
      case 'warp':
        result = warpImage(cv, req.payload.img, req.payload.H, req.payload.width, req.payload.height);
        break;
      case 'crops':
        result = req.payload.items.map((it) => rectifyQuad(cv, req.payload.img, it.quad, it.width, it.height));
        break;
      case 'perspective':
        result = perspectiveTransform(cv, req.payload.src, req.payload.dst);
        break;
      case 'floorLine':
        result = suggestFloorLine(cv, req.payload.img, req.payload.region);
        break;
      case 'wallFeatures': {
        const img = req.payload.img;
        const floorY = suggestFloorLine(cv, img, 'floor');
        result = {
          quads: detectQuads(cv, img, undefined, { keepNested: true }),
          floorY,
          ceilingY: suggestFloorLine(cv, img, 'ceiling'),
          doorways: detectDoorways(cv, img, floorY),
        };
        break;
      }
    }
    post({ id: req.id, ok: true, result, ms: Math.round(performance.now() - start) }, transferOf(result));
  } catch (err) {
    post({ id: req.id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
