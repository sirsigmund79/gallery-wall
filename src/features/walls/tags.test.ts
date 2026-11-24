import { describe, expect, it } from 'vitest';
import type { Quad } from '../../geometry/quad.ts';
import { drawOrder, guessKind, kindOf, setTag, tagsToWall, type TagItem } from './tags.ts';

const Q = (x0: number, y0: number, x1: number, y1: number): Quad => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

describe('tags', () => {
  it('draws large first so small items sit on top', () => {
    const items: TagItem[] = [{ id: 'switch', quad: Q(760, 700, 800, 760) }, { id: 'panel', quad: Q(250, 250, 820, 1250) }];
    expect(drawOrder(items).map((i) => i.id)).toEqual(['panel', 'switch']);
  });
  it('allows only one reference and one hanging area', () => {
    let items: TagItem[] = [{ id: 'a', quad: Q(0, 0, 1, 1) }, { id: 'b', quad: Q(0, 0, 2, 2) }];
    items = setTag(items, 'a', { as: 'ref' });
    items = setTag(items, 'b', { as: 'ref' });
    expect(items.map((i) => i.tag?.as)).toEqual([undefined, 'ref']);
    items = setTag(items, 'a', { as: 'keep', kind: 'tv' });
    expect(items[0]!.tag).toEqual({ as: 'keep', kind: 'tv' });
  });
  it('turns tags into keep-outs and a hanging area', () => {
    const items: TagItem[] = [
      { id: 'tv', quad: Q(100, 500, 300, 610), tag: { as: 'keep', kind: 'tv' } },
      { id: 'panel', quad: Q(0, 0, 400, 400), tag: { as: 'hang' } },
      { id: 'x', quad: Q(0, 0, 5, 5), tag: { as: 'ignore' } },
    ];
    const toMm = (q: Quad) => ({ x: q[0][0] / 2, y: q[0][1] / 2, w: (q[1][0] - q[0][0]) / 2, h: (q[2][1] - q[1][1]) / 2 });
    const r = tagsToWall(items, toMm);
    expect(r.keepOut).toEqual([{ x: 50, y: 250, w: 100, h: 55, kind: 'tv', label: 'TV' }]);
    expect(r.hang).toEqual({ x: 0, y: 0, w: 200, h: 200 });
  });
  it('guesses a TV from a dark 16:9 rectangle', () => {
    const W = 400, H = 300;
    const data = new Uint8ClampedArray(W * H * 4).fill(220);
    for (let y = 100; y < 190; y++) for (let x = 100; x < 260; x++) data.set([15, 15, 20, 255], (y * W + x) * 4);
    expect(guessKind({ data, width: W, height: H }, Q(100, 100, 260, 190))).toBe('tv');
    expect(guessKind({ data, width: W, height: H }, Q(10, 10, 60, 60))).toBeUndefined();
  });
  it('maps old door keep-outs', () => {
    expect(kindOf({ label: 'Door' })).toBe('door');
    expect(kindOf({ label: 'X', kind: 'tv' })).toBe('tv');
  });
});
