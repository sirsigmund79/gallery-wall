import { describe, expect, it } from 'vitest';
import { ringColour } from './colour.ts';

describe('ringColour', () => {
  it('returns the wall colour around a dark frame, ignoring the frame', () => {
    const W = 200, H = 150;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const x = i % W, y = (i / W) | 0;
      const frame = x >= 60 && x < 140 && y >= 40 && y < 110;
      data.set(frame ? [20, 20, 20, 255] : [210, 200, 180, 255], i * 4);
    }
    expect(ringColour({ data, width: W, height: H }, { x: 60, y: 40, w: 80, h: 70 })).toBe('#d2c8b4');
  });
});
