import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { axisOf, fitCalibration, mmToPx, pxToMm, spreadPct, type Measurement } from './calibration.ts';
import { median } from './vec.ts';

const m = (p: [number, number], q: [number, number], lengthMm: number): Measurement => ({ p, q, lengthMm });

describe('axisOf', () => {
  it('classifies by angle with a 20° tolerance', () => {
    expect(axisOf(m([0, 0], [100, 0], 1))).toBe('h');
    expect(axisOf(m([0, 0], [100, 36], 1))).toBe('h'); // ~19.8°
    expect(axisOf(m([0, 0], [100, 37], 1))).toBe('diag');
    expect(axisOf(m([0, 0], [0, -50], 1))).toBe('v');
    expect(axisOf(m([0, 0], [-36, 100], 1))).toBe('v');
    expect(axisOf(m([0, 0], [100, 100], 1))).toBe('diag');
  });
});

describe('median / spread', () => {
  it('median handles odd/even', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it('spread is (max-min)/median in %', () => {
    expect(spreadPct([1])).toBe(0);
    expect(spreadPct([0.99, 1, 1.01])).toBeCloseTo(2);
  });
});

describe('fitCalibration', () => {
  it('returns null with no usable measurement', () => {
    expect(fitCalibration([], { guided: false })).toBeNull();
    expect(fitCalibration([m([0, 0], [0, 0], 100)], { guided: false })).toBeNull();
    expect(fitCalibration([m([0, 0], [10, 0], 0)], { guided: false })).toBeNull();
  });

  it('one measurement: scale exact; quality from capture', () => {
    const one = [m([10, 10], [310, 10], 150)];
    expect(fitCalibration(one, { guided: true })).toMatchObject({ pxPerMm: 2, quality: 'good' });
    const imp = fitCalibration(one, { guided: false })!;
    expect(imp.pxPerMm).toBe(2);
    expect(imp.quality).toBe('check');
    expect(imp.advice).toMatch(/second measurement/);
  });

  it('agreeing measurements are good and isotropic', () => {
    const f = fitCalibration(
      [m([0, 0], [200, 0], 100), m([0, 0], [0, 401], 200), m([5, 5], [305, 5], 150)],
      { guided: false },
    )!;
    expect(f.quality).toBe('good');
    expect(f.anisotropy).toBeUndefined();
    expect(f.pxPerMm).toBeCloseTo(2);
  });

  it('same-axis disagreement grades by spread', () => {
    expect(fitCalibration([m([0, 0], [200, 0], 100), m([0, 0], [205, 0], 100)], { guided: false })!.quality).toBe('check');
    expect(fitCalibration([m([0, 0], [200, 0], 100), m([0, 0], [210, 0], 100)], { guided: false })!.quality).toBe('poor');
  });

  it('recovers synthetic two-axis foreshortening', () => {
    // True scale 2 px/mm; x foreshortened by cos(12°) ≈ 0.978 (yaw).
    const sx = 2 * Math.cos((12 * Math.PI) / 180);
    const sy = 2;
    const pts: Measurement[] = [
      m([0, 0], [1000 * sx, 0], 1000),
      m([0, 0], [0, 800 * sy], 800),
      m([100, 100], [100 + 300 * sx, 100 + 400 * sy], 500), // 3-4-5 diagonal
    ];
    const f = fitCalibration(pts, { guided: false })!;
    expect(f.anisotropy!.sx).toBeCloseTo(sx, 9);
    expect(f.anisotropy!.sy).toBeCloseTo(sy, 9);
    expect(f.spreadPct).toBeCloseTo(0, 9);
    expect(f.quality).toBe('good');
    // Round-trip a point.
    const mm = pxToMm(f, [500, 600]);
    expect(mmToPx(f, mm)).toEqual([expect.closeTo(500, 9), expect.closeTo(600, 9)]);
  });

  it('two-axis with exactly two measurements is "check" (nothing to verify against)', () => {
    const f = fitCalibration([m([0, 0], [1950, 0], 1000), m([0, 0], [0, 1600], 800)], { guided: false })!;
    expect(f.anisotropy).toBeDefined();
    expect(f.quality).toBe('check');
  });

  it('huge anisotropy is poor', () => {
    const f = fitCalibration([m([0, 0], [1600, 0], 1000), m([0, 0], [0, 1600], 800)], { guided: false })!;
    expect(f.quality).toBe('poor');
  });

  it('property: scaling all pixel coords by k scales pxPerMm by k', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x1: fc.integer({ min: 0, max: 3000 }), y1: fc.integer({ min: 0, max: 3000 }),
            x2: fc.integer({ min: 0, max: 3000 }), y2: fc.integer({ min: 0, max: 3000 }),
            len: fc.integer({ min: 10, max: 5000 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        (raw, k) => {
          const ms = raw.map((r) => m([r.x1, r.y1], [r.x2, r.y2], r.len));
          const a = fitCalibration(ms, { guided: true });
          const b = fitCalibration(ms.map((x) => m([x.p[0] * k, x.p[1] * k], [x.q[0] * k, x.q[1] * k], x.lengthMm)), { guided: true });
          if (!a) return b === null;
          return Math.abs(b!.pxPerMm / a.pxPerMm - k) < 1e-6 * k && b!.quality === a.quality;
        },
      ),
    );
  });
});
