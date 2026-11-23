import { describe, expect, it } from 'vitest';
import { applyH, invert, type Mat3 } from '../../geometry/mat3.ts';
import { inToMm } from '../../geometry/units.ts';
import { nextWallName, planRectify, quadBoxMm, wallPresets } from './wallMath.ts';

describe('wallPresets', () => {
  it('offers doors in the user’s units', () => {
    expect(wallPresets('in').filter((p) => p.kind === 'door').map((p) => p.label)).toEqual(['Door 30 × 80 in', 'Door 32 × 80 in', 'Door 36 × 80 in']);
    expect(wallPresets('cm')[0]).toMatchObject({ label: 'Door 70 × 200 cm', a: 700, b: 2000 });
    expect(wallPresets('in')[2]!.a).toBeCloseTo(inToMm(36));
  });
});

describe('planRectify', () => {
  it('maps a perspective photo of a wall to a face-on image with uniform scale', () => {
    // Synthetic: wall mm -> photo px with mild perspective; H is its inverse (photo px -> mm).
    const mm2px: Mat3 = [0.5, 0.02, 100, -0.01, 0.48, 80, 0.00003, 0.00001, 1];
    const Hmm = invert(mm2px);
    const p = planRectify(Hmm, 2000, 1500)!;
    expect(p).not.toBeNull();
    // A 1000 × 500 mm rectangle on the wall comes out as an axis-aligned rectangle at pxPerMm.
    const rect = [[1000, 600], [2000, 600], [2000, 1100], [1000, 1100]] as [number, number][];
    const out = rect.map((q) => applyH(p.H, applyH(mm2px, q)));
    expect(out[1]![0] - out[0]![0]).toBeCloseTo(1000 * p.pxPerMm, 6);
    expect(out[3]![1] - out[0]![1]).toBeCloseTo(500 * p.pxPerMm, 6);
    expect(out[1]![1]).toBeCloseTo(out[0]![1], 6);
    expect(out[3]![0]).toBeCloseTo(out[0]![0], 6);
    // Roughly preserves pixel count.
    expect(p.width * p.height).toBeLessThanOrEqual(2000 * 1500 * 1.05);
  });
  it('rejects degenerate warps', () => {
    expect(planRectify([1, 0, 0, 0, 1, 0, -0.01, 0, 1], 1000, 800)).toBeNull();
  });
});

describe('helpers', () => {
  it('quadBoxMm', () => {
    expect(quadBoxMm([[10, 20], [110, 20], [110, 70], [10, 70]], 2)).toEqual({ x: 5, y: 10, w: 50, h: 25 });
  });
  it('nextWallName', () => {
    expect(nextWallName([])).toBe('Wall 1');
    expect(nextWallName(['Living room', 'Wall 4'])).toBe('Wall 5');
  });
});
