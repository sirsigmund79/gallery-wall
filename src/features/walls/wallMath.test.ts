import { describe, expect, it } from 'vitest';
import { applyH, invert, type Mat3 } from '../../geometry/mat3.ts';
import type { Quad } from '../../geometry/quad.ts';
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

describe('chooseCalibration', async () => {
  const { chooseCalibration, refErrorPct, sizeOnlyScale, warpIsPlausible } = await import('./wallMath.ts');
  const tiny: Quad = [[1000, 900], [1040, 901], [1041, 965], [1000, 964]];
  const door: Quad = [[300, 500], [760, 505], [758, 1500], [302, 1498]];
  it('never warps a level-camera photo, whatever the reference', () => {
    expect(chooseCalibration({ guided: true, bothSides: true, refQuad: door, w: 2000, h: 1600, Hmm: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 1] })).toEqual({ kind: 'size', reason: 'level' });
  });
  it('ordinary photo: small reference → size only', () => {
    expect(chooseCalibration({ guided: false, bothSides: true, refQuad: tiny, w: 2000, h: 1600, Hmm: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 1] }).kind).toBe('size');
  });
  it('ordinary photo: large reference and a plausible warp → warp', () => {
    expect(chooseCalibration({ guided: false, bothSides: true, refQuad: door, w: 2000, h: 1600, Hmm: [0.5, 0.01, 0, 0, 0.5, 0, 0.00002, 0, 1] })).toEqual({ kind: 'warp' });
  });
  it('rejects a warp that stretches one side of the photo far more than the other', () => {
    const extreme = [1, 0, 0, 0, 1, 0, 0.0008, 0, 1]; // strong perspective across 2000 px
    expect(warpIsPlausible(extreme, 2000, 1600)).toBe(false);
    expect(chooseCalibration({ guided: false, bothSides: true, refQuad: door, w: 2000, h: 1600, Hmm: extreme })).toEqual({ kind: 'size', reason: 'implausible' });
  });
  it('accuracy hint: a 40 px switch plate is a few %, a door well under 1%', () => {
    expect(refErrorPct(tiny)).toBeGreaterThan(3);
    expect(refErrorPct(door)).toBeLessThan(0.5);
  });
  it('size-only scale averages both sides and reports their disagreement', () => {
    const q: Quad = [[0, 0], [200, 0], [200, 103], [0, 103]];
    const s = sizeOnlyScale(q, 100, 50)!;
    expect(s.pxPerMm).toBeCloseTo(2.03, 6);
    expect(s.spreadPct).toBeCloseTo(2.96, 1);
    expect(sizeOnlyScale(q, 100, null)!.pxPerMm).toBe(2);
  });
});
