// Sample the wall's colour around a piece (for the optional "cover current
// spots" patch). A plain average colour: no generated imagery. Pure.
import type { RGBAImage } from '../cv/types.ts';

/**
 * Median colour of a thin ring just outside the rectangle (px), as `#rrggbb`.
 * `gap` skips the frame's shadow; `ring` is the ring's thickness.
 */
export function ringColour(img: RGBAImage, r: { x: number; y: number; w: number; h: number }, gap = 6, ring = 10): string {
  const xs: number[] = [], gs: number[] = [], bs: number[] = [];
  const x0 = Math.round(r.x - gap - ring), x1 = Math.round(r.x + r.w + gap + ring);
  const y0 = Math.round(r.y - gap - ring), y1 = Math.round(r.y + r.h + gap + ring);
  const inner = { x0: r.x - gap, x1: r.x + r.w + gap, y0: r.y - gap, y1: r.y + r.h + gap };
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y += 2)
    for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x += 2) {
      if (x >= inner.x0 && x < inner.x1 && y >= inner.y0 && y < inner.y1) continue;
      const i = (y * img.width + x) * 4;
      xs.push(img.data[i]!);
      gs.push(img.data[i + 1]!);
      bs.push(img.data[i + 2]!);
    }
  const med = (a: number[]) => (a.sort((p, q) => p - q)[a.length >> 1] ?? 200);
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${hex(med(xs))}${hex(med(gs))}${hex(med(bs))}`;
}
