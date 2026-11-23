import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { EYE_LEVEL_MM, fitsWall, freeSpot, initialPosition } from './placement.ts';
import { overlaps } from '../../geometry/layout/rect.ts';

const wall = { bounds: { left: 0, top: 0, right: 3000, bottom: 2400 }, datums: {} as { floorY?: number } };

describe('placement helpers', () => {
  it('centres new pieces, at eye level when the floor is known', () => {
    expect(initialPosition(wall, { widthMm: 400, heightMm: 600 })).toEqual({ x: 1300, y: 900 });
    const p = initialPosition({ ...wall, datums: { floorY: 2400 } }, { widthMm: 400, heightMm: 600 });
    expect(p.y + 300).toBeCloseTo(2400 - EYE_LEVEL_MM);
  });

  it('uses the centre when it is free, otherwise sits beside existing art', () => {
    const piece = { widthMm: 400, heightMm: 600 };
    expect(freeSpot(wall, piece, [])).toEqual({ x: 1300, y: 900 });
    const placed = [{ x: 1300, y: 900, w: 400, h: 600 }];
    const p = freeSpot(wall, piece, placed, 50);
    expect(p).toEqual({ x: 1750, y: 900 });
  });

  it('property: never overlaps existing pieces when a free candidate exists inside a big wall', () => {
    const big = { bounds: { left: 0, top: 0, right: 100000, bottom: 100000 }, datums: {} };
    const size = fc.record({ widthMm: fc.integer({ min: 100, max: 1200 }), heightMm: fc.integer({ min: 100, max: 1200 }) });
    fc.assert(
      fc.property(fc.array(size, { minLength: 1, maxLength: 12 }), (sizes) => {
        const placed: { x: number; y: number; w: number; h: number }[] = [];
        for (const s of sizes) {
          const p = freeSpot(big, s, placed);
          const r = { x: p.x, y: p.y, w: s.widthMm, h: s.heightMm };
          if (placed.some((o) => overlaps(r, o, 0.01))) return false;
          placed.push(r);
        }
        return true;
      }),
    );
  });

  it('fitsWall', () => {
    expect(fitsWall(wall, { widthMm: 3000, heightMm: 10 })).toBe(true);
    expect(fitsWall(wall, { widthMm: 3001, heightMm: 10 })).toBe(false);
  });
});
