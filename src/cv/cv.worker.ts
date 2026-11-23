/// <reference lib="webworker" />
// Runs OpenCV.js off the main thread (spec §3: heavy CV in workers).
import cvModule from '@techstark/opencv-js';
import { detectQuads, perspectiveTransform, rectifyQuad, warpImage } from './detect.ts';
import { whenCvReady } from './load.ts';
import type { Request, Response } from './protocol.ts';
import type { RGBAImage } from './types.ts';

const ready = whenCvReady(cvModule);

const transferOf = (r: unknown): Transferable[] => {
  const imgs = Array.isArray(r) ? r : [r];
  return imgs.flatMap((x) => (x && typeof x === 'object' && 'data' in x && (x as RGBAImage).data instanceof Uint8ClampedArray ? [(x as RGBAImage).data.buffer] : []));
};

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  try {
    const { cv } = await ready;
    let result: unknown;
    switch (req.op) {
      case 'detect':
        result = detectQuads(cv, req.payload.img);
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
    }
    (self as unknown as Worker).postMessage({ id: req.id, ok: true, result } satisfies Response, transferOf(result));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: req.id, ok: false, error: String((err as Error)?.message ?? err) } satisfies Response);
  }
};
