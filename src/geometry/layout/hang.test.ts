import { describe, expect, it } from 'vitest';
import { availableDatums, hangParamsOf, hookPositions, makeHangSpec, resizeHangSpec } from './hang.ts';

const wall = { bounds: { left: 100, top: 50, right: 3100, bottom: 2500 }, datums: { floorY: 2600, ceilingY: 0 } };

describe('hang specs', () => {
  it('sawtooth and wire hang from the centre', () => {
    expect(makeHangSpec('sawtooth', 400, { dropMm: 15, insetMm: 0 }).hooks).toEqual([{ dx: 200, dy: 15 }]);
    expect(makeHangSpec('wire', 500, { dropMm: 80, insetMm: 0 }).hooks).toEqual([{ dx: 250, dy: 80 }]);
  });
  it('d-rings are inset from each side and clamped to the centre', () => {
    expect(makeHangSpec('dring2', 600, { dropMm: 70, insetMm: 50 }).hooks).toEqual([
      { dx: 50, dy: 70 },
      { dx: 550, dy: 70 },
    ]);
    expect(makeHangSpec('dring2', 80, { dropMm: 70, insetMm: 50 }).hooks.map((h) => h.dx)).toEqual([40, 40]);
  });
  it('params round-trip and resize keeps hooks centred', () => {
    const s = makeHangSpec('dring2', 600, { dropMm: 70, insetMm: 50 });
    expect(hangParamsOf(s)).toEqual({ dropMm: 70, insetMm: 50 });
    expect(resizeHangSpec(s, 1000).hooks).toEqual([{ dx: 50, dy: 70 }, { dx: 950, dy: 70 }]);
    expect(resizeHangSpec(makeHangSpec('wire', 400, { dropMm: 60, insetMm: 0 }), 300).hooks[0]!.dx).toBe(150);
  });
});

describe('hookPositions', () => {
  it('measures from left edge and each datum', () => {
    const hang = makeHangSpec('dring2', 600, { dropMm: 70, insetMm: 50 });
    const at = { x: 1000, y: 1200 };
    const floor = hookPositions(at, hang, wall, 'floor');
    expect(floor.map((h) => h.fromLeft)).toEqual([950, 1450]);
    expect(floor.map((h) => h.vertical)).toEqual([1330, 1330]);
    expect(hookPositions(at, hang, wall, 'ceiling')[0]!.vertical).toBe(1270);
    expect(hookPositions(at, hang, wall, 'top')[0]!.vertical).toBe(1220);
  });
  it('lists only marked datums', () => {
    expect(availableDatums({ datums: {} })).toEqual(['top']);
    expect(availableDatums(wall)).toEqual(['floor', 'ceiling', 'top']);
  });
});
