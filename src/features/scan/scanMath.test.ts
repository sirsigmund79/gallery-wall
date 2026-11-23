import { describe, expect, it } from 'vitest';
import { applyH } from '../../geometry/mat3.ts';
import type { Quad } from '../../geometry/quad.ts';
import { cropSize, measureAll, orientPreset, planCalibration } from './scanMath.ts';

const ref: Quad = [[100, 100], [397, 100], [397, 310], [100, 310]]; // 297×210 px

describe('planCalibration', () => {
  it('straightened + both sides → similarity mapping the reference exactly', () => {
    const p = planCalibration(ref, { quadId: 'r', widthMm: 297, heightMm: 210 }, true)!;
    expect(p.kind).toBe('similarity');
    if (p.kind !== 'similarity') return;
    const q = applyH(p.H, [397, 310]);
    expect(q[0]).toBeCloseTo(297);
    expect(q[1]).toBeCloseTo(210);
  });
  it('angled photo + both sides → perspective (computed by OpenCV)', () => {
    expect(planCalibration(ref, { quadId: 'r', widthMm: 297, heightMm: 210 }, false)?.kind).toBe('perspective');
  });
  it('one side → uniform scale from that side', () => {
    expect(planCalibration(ref, { quadId: 'r', widthMm: 148.5, heightMm: null }, true)).toEqual({ kind: 'scale', pxPerMm: 2 });
    expect(planCalibration(ref, { quadId: 'r', widthMm: null, heightMm: 105 }, true)).toEqual({ kind: 'scale', pxPerMm: 2 });
    expect(planCalibration(ref, { quadId: 'r', widthMm: null, heightMm: null }, true)).toBeNull();
  });
});

describe('measureAll', () => {
  it('measures and suggests standard sizes', () => {
    // 2 px/mm; an 8×10 in print = 203.2×254 mm = 406.4×508 px.
    const q: Quad = [[0, 0], [406.4, 0], [406.4, 508], [0, 508]];
    const [m] = measureAll([q], { kind: 'scale', pxPerMm: 2 });
    expect(m!.widthMm).toBeCloseTo(203.2);
    expect(m!.suggestion?.label).toBe('8 × 10 in');
    expect(m!.confidence).toBe('high');
  });
});

describe('helpers', () => {
  it('cropSize keeps aspect and never upsamples', () => {
    expect(cropSize(400, 200, [[0, 0], [800, 0], [800, 400], [0, 400]])).toEqual({ width: 800, height: 400 });
    expect(cropSize(400, 200, [[0, 0], [4000, 0], [4000, 2000], [0, 2000]])).toEqual({ width: 1600, height: 800 });
  });
  it('orientPreset matches the long side to the quad', () => {
    expect(orientPreset(ref, 210, 297)).toEqual({ widthMm: 297, heightMm: 210 });
    expect(orientPreset([[0, 0], [100, 0], [100, 300], [0, 300]], 210, 297)).toEqual({ widthMm: 210, heightMm: 297 });
  });
});
