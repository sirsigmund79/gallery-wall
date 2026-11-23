import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { existingGaps, snapRect } from './snap.ts';
import type { Rect } from './rect.ts';

const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const none = { linesX: [], linesY: [] };

describe('snapRect', () => {
  it('leaves a rect alone when nothing is close', () => {
    expect(snapRect(R(500, 500, 100, 100), { others: [R(0, 0, 50, 50)], ...none }, 10)).toMatchObject({ x: 500, y: 500, guides: [] });
  });

  it('snaps left edge to another piece left edge', () => {
    const s = snapRect(R(104, 500, 100, 100), { others: [R(100, 0, 200, 200)], ...none }, 10);
    expect(s.x).toBe(100);
    expect(s.guides[0]).toMatchObject({ axis: 'x', at: 100, kind: 'edge' });
  });

  it('snaps centres', () => {
    const s = snapRect(R(0, 293, 100, 100), { others: [R(500, 300, 200, 100)], ...none }, 10);
    expect(s.y).toBe(300); // centres align at y=350
  });

  it('snaps to wall lines (e.g. centre line)', () => {
    const s = snapRect(R(1445, 0, 100, 100), { others: [], linesX: [1500], linesY: [] }, 10);
    expect(s.x).toBe(1450); // centred on 1500
    expect(s.guides[0]).toMatchObject({ kind: 'line', at: 1500 });
  });

  it('snaps to an equal gap and reports gap marks', () => {
    // A [0..100], B [150..250]: gap 50. Moving C near B's right with ~50 gap.
    const others = [R(0, 0, 100, 100), R(150, 0, 100, 100)];
    const s = snapRect(R(303, 20, 100, 60), { others, ...none }, 6);
    expect(s.x).toBe(300);
    expect(s.gaps).toHaveLength(2);
    expect(s.gaps.every((g) => g.to - g.from === 50)).toBe(true);
  });

  it('existingGaps pairs nearest facing neighbours only', () => {
    const gaps = existingGaps([R(0, 0, 10, 10), R(20, 0, 10, 10), R(100, 0, 10, 10), R(20, 500, 10, 10)], 'x');
    expect(gaps.map((g) => g.gap).sort((a, b) => a - b)).toEqual([10, 70]);
  });

  it('property: never moves more than the threshold on either axis', () => {
    const rect = fc.record({
      x: fc.integer({ min: 0, max: 3000 }), y: fc.integer({ min: 0, max: 3000 }),
      w: fc.integer({ min: 10, max: 900 }), h: fc.integer({ min: 10, max: 900 }),
    });
    fc.assert(
      fc.property(rect, fc.array(rect, { maxLength: 8 }), fc.integer({ min: 1, max: 60 }), (r, others, th) => {
        const s = snapRect(r, { others, linesX: [1500], linesY: [1200] }, th);
        return Math.abs(s.x - r.x) <= th + 1e-9 && Math.abs(s.y - r.y) <= th + 1e-9;
      }),
    );
  });
});
