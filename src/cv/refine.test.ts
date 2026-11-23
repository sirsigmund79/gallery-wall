import { describe, expect, it } from 'vitest';
import { refineQuad, type GrayImage } from './refine.ts';
import type { Quad } from '../geometry/quad.ts';

/** Anti-aliased dark rotated rectangle on a light background (supersampled). */
function render(W: number, H: number, q: Quad, inside = 40, outside = 200): GrayImage {
  const data = new Float32Array(W * H);
  const inQuad = (x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i]!, b = q[(i + 1) % 4]!;
      const z = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      if (!sign) sign = Math.sign(z);
      else if (Math.sign(z) !== sign) return false;
    }
    return true;
  };
  const S = 4;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let c = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) if (inQuad(x + (sx + 0.5) / S, y + (sy + 0.5) / S)) c++;
      const f = c / (S * S);
      data[y * W + x] = inside * f + outside * (1 - f);
    }
  return { data, width: W, height: H };
}

describe('refineQuad', () => {
  // Pixel-centre convention: the edge at continuous coordinate x sits at x - 0.5 in pixel-index space.
  const truth: Quad = [[60.3, 50.7], [240.8, 58.2], [233.4, 190.6], [52.9, 183.1]];
  const img = render(300, 240, truth);
  /** Move each corner `d` px outwards (TL up-left, TR up-right, …), in pixel-index space. */
  const shifted = (q: Quad, d: number): Quad =>
    q.map(([x, y], i) => [x - 0.5 + (i === 1 || i === 2 ? d : -d), y - 0.5 + (i < 2 ? -d : d)]) as Quad;

  it('pulls a quad that is off by ~3 px onto the true edges to within 0.2 px', () => {
    const rough = shifted(truth, 3);
    const r = refineQuad(img, rough, { radius: 6 });
    r.forEach((p, i) => {
      expect(Math.abs(p[0] - (truth[i]![0] - 0.5))).toBeLessThan(0.2);
      expect(Math.abs(p[1] - (truth[i]![1] - 0.5))).toBeLessThan(0.2);
    });
  });

  it('leaves the quad alone when there is no edge nearby', () => {
    const flat: GrayImage = { data: new Float32Array(300 * 240).fill(128), width: 300, height: 240 };
    expect(refineQuad(flat, truth)).toBe(truth);
  });
});
