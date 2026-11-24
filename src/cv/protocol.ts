import type { Mat3 } from '../geometry/mat3.ts';
import type { Quad } from '../geometry/quad.ts';
import type { Pt } from '../geometry/vec.ts';
import type { RGBAImage } from './types.ts';

export interface Ops {
  detect: { req: { img: RGBAImage; keepNested?: boolean }; res: Quad[] };
  warp: { req: { img: RGBAImage; H: Mat3; width: number; height: number }; res: RGBAImage };
  crops: { req: { img: RGBAImage; items: { quad: Quad; width: number; height: number }[] }; res: RGBAImage[] };
  perspective: { req: { src: Pt[]; dst: Pt[] }; res: Mat3 };
  floorLine: { req: { img: RGBAImage; region?: 'floor' | 'ceiling' }; res: number | null };
  /** Everything a wall photo needs in one pass: rectangles (nested kept), floor, ceiling, doorways. */
  wallFeatures: {
    req: { img: RGBAImage };
    res: { quads: Quad[]; floorY: number | null; ceilingY: number | null; doorways: { quad: Quad; topVisible: boolean }[] };
  };
}
export type Op = keyof Ops;

export type Request = { [K in Op]: { id: number; op: K; payload: Ops[K]['req'] } }[Op];

/** Replies to requests, plus unsolicited status/log messages from the worker. */
export type Response =
  | { id: number; ok: true; result: unknown; ms: number }
  | { id: number; ok: false; error: string }
  | { type: 'status'; stage: 'started' | 'ready' | 'failed'; ms: number; error?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; msg: string };
