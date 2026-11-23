import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { bboxContains, bboxIoU, isConvex, measureQuad, orderQuad, polygonArea, snapSuggestion, type Quad } from './quad.ts';
import { inToMm } from './units.ts';

describe('orderQuad', () => {
  it('orders TL, TR, BR, BL regardless of input order', () => {
    const q = orderQuad([[100, 80], [0, 0], [0, 80], [100, 0]]);
    expect(q).toEqual([[0, 0], [100, 0], [100, 80], [0, 80]]);
  });
  it('handles a rotated quad', () => {
    const q = orderQuad([[50, 0], [100, 50], [50, 100], [0, 50]]);
    expect(polygonArea(q)).toBe(5000);
    expect(isConvex(q)).toBe(true);
  });
  it('property: any permutation of a convex quad gives the same order', () => {
    const base: Quad = [[10, 12], [210, 20], [205, 160], [5, 150]];
    fc.assert(fc.property(fc.shuffledSubarray(base, { minLength: 4, maxLength: 4 }), (perm) => {
      expect(orderQuad(perm)).toEqual(base);
    }));
  });
});

describe('measureQuad', () => {
  it('measures a clean rectangle with a scale map', () => {
    const m = measureQuad([[0, 0], [200, 0], [200, 100], [0, 100]], { kind: 'scale', pxPerMm: 2 });
    expect(m).toMatchObject({ widthMm: 100, heightMm: 50, confidence: 'high' });
  });
  it('downgrades skewed quads', () => {
    const skew = measureQuad([[0, 0], [200, 0], [210, 100], [10, 100]], { kind: 'scale', pxPerMm: 1 });
    expect(skew.confidence).toBe('check'); // ~5.7° corners
    const bad = measureQuad([[0, 0], [200, 0], [180, 100], [0, 100]], { kind: 'scale', pxPerMm: 1 });
    expect(bad.confidence).toBe('low');
  });
  it('uses the plane homography', () => {
    // Homography that halves x and y.
    const m = measureQuad([[0, 0], [400, 0], [400, 200], [0, 200]], { kind: 'homography', H: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 1] });
    expect(m.widthMm).toBeCloseTo(200);
    expect(m.heightMm).toBeCloseTo(100);
  });
});

describe('snapSuggestion', () => {
  it('suggests 16 × 20 in within 1.5%, keeping orientation', () => {
    expect(snapSuggestion(inToMm(16.1), inToMm(19.9))).toMatchObject({ label: '16 × 20 in', widthMm: inToMm(16), heightMm: inToMm(20) });
    expect(snapSuggestion(inToMm(20), inToMm(16))).toMatchObject({ widthMm: inToMm(20), heightMm: inToMm(16) });
  });
  it('suggests A4', () => {
    expect(snapSuggestion(211, 295)?.label).toBe('A4');
  });
  it('returns null when nothing is close', () => {
    expect(snapSuggestion(inToMm(15), inToMm(20))).toBeNull();
  });
});

describe('bbox helpers', () => {
  it('IoU and containment', () => {
    const a: Quad = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(bboxIoU(a, a)).toBe(1);
    expect(bboxIoU(a, [[20, 20], [30, 20], [30, 30], [20, 30]])).toBe(0);
    expect(bboxContains(a, [[2, 2], [8, 2], [8, 8], [2, 8]])).toBe(true);
  });
});

describe('similarityFit', () => {
  it('recovers scale, rotation and translation exactly', async () => {
    const { similarityFit } = await import('./quad.ts');
    const { applyH } = await import('./mat3.ts');
    const t = 0.3, k = 2.5;
    const f = (p: [number, number]): [number, number] => [k * (Math.cos(t) * p[0] - Math.sin(t) * p[1]) + 7, k * (Math.sin(t) * p[0] + Math.cos(t) * p[1]) - 3];
    const src: [number, number][] = [[0, 0], [10, 0], [10, 5], [0, 5]];
    const H = similarityFit(src, src.map(f));
    for (const p of [[3, 4], [-2, 9]] as [number, number][]) {
      const q = applyH(H, p);
      expect(q[0]).toBeCloseTo(f(p)[0], 9);
      expect(q[1]).toBeCloseTo(f(p)[1], 9);
    }
  });
});
