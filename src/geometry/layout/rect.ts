import type { Mm } from '../../domain/types.ts';

export interface Rect {
  x: Mm;
  y: Mm;
  w: Mm;
  h: Mm;
}

export const right = (r: Rect) => r.x + r.w;
export const bottom = (r: Rect) => r.y + r.h;
export const cx = (r: Rect) => r.x + r.w / 2;
export const cy = (r: Rect) => r.y + r.h / 2;

/** Strict overlap (touching edges don't count). `eps` tolerates float noise. */
export const overlaps = (a: Rect, b: Rect, eps = 1e-6): boolean =>
  a.x < right(b) - eps && b.x < right(a) - eps && a.y < bottom(b) - eps && b.y < bottom(a) - eps;

/** Do the two rects share any extent on the given axis? */
export const spanOverlap = (a: Rect, b: Rect, axis: 'x' | 'y'): boolean =>
  axis === 'x' ? a.x < right(b) && b.x < right(a) : a.y < bottom(b) && b.y < bottom(a);
