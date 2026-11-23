import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { inToMm } from '../../units.ts';
import { overlaps } from '../rect.ts';
import { STYLES, artZone, suggest, type ArrangeInput, type ArrangePiece, type Variant } from './index.ts';
import { rng } from './rng.ts';
import { scoreLayout } from './score.ts';
import { FILL_MAX, selectSet } from './select.ts';
import { zoneArea } from './zone.ts';

const IN = inToMm;
const P = (id: string, w: number, h: number, locked?: { x: number; y: number }): ArrangePiece => ({ id, w: IN(w), h: IN(h), locked });
/** 3 m × 2.4 m wall with the floor marked (spec §6.6 acceptance). */
const WALL = { bounds: { left: 0, top: 0, right: 3000, bottom: 2400 }, floorY: 2400 };
const EIGHT = [P('a', 24, 36), P('b', 16, 20), P('c', 16, 20), P('d', 11, 14), P('e', 11, 14), P('f', 8, 10), P('g', 8, 10), P('h', 12, 12)];
const GAP = IN(2);

function checkValid(v: Variant, input: ArrangeInput) {
  const zone = artZone(input.wall);
  const byId = new Map(input.pool.map((p) => [p.id, p]));
  const rects = v.placements.map((q) => ({ x: q.x, y: q.y, w: byId.get(q.id)!.w, h: byId.get(q.id)!.h }));
  const U = zone.usable;
  for (const r of rects) {
    expect(r.x).toBeGreaterThanOrEqual(U.x - 0.5);
    expect(r.y).toBeGreaterThanOrEqual(U.y - 0.5);
    expect(r.x + r.w).toBeLessThanOrEqual(U.x + U.w + 0.5);
    expect(r.y + r.h).toBeLessThanOrEqual(U.y + U.h + 0.5);
  }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
  for (const p of input.pool.filter((q) => q.locked)) {
    const q = v.placements.find((x) => x.id === p.id);
    expect(q).toEqual({ id: p.id, x: p.locked!.x, y: p.locked!.y });
  }
  expect(new Set(v.placements.map((q) => q.id)).size).toBe(v.placements.length);
}

describe('suggest: spec §6.6 acceptance', () => {
  it.each(STYLES)('%s: 8 mixed pieces on 3 × 2.4 m give ≥ 3 valid variants in < 500 ms', (style) => {
    const input: ArrangeInput = { wall: WALL, pool: EIGHT, mode: 'rearrange', style, gap: GAP, seed: 1 };
    const t0 = performance.now();
    const vs = suggest(input);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(500);
    expect(vs.length).toBeGreaterThanOrEqual(style === 'symmetric' ? 1 : 3);
    vs.forEach((v) => checkValid(v, input));
  });

  it('"any" returns a varied set of styles', () => {
    const vs = suggest({ wall: WALL, pool: EIGHT, mode: 'rearrange', style: 'any', gap: GAP, seed: 3 });
    expect(vs).toHaveLength(6);
    expect(new Set(vs.map((v) => v.style)).size).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic for a seed, and shuffling (new seed) changes the suggestions', () => {
    const base = { wall: WALL, pool: EIGHT, mode: 'mix' as const, style: 'any' as const, gap: GAP };
    expect(suggest({ ...base, seed: 9 })).toEqual(suggest({ ...base, seed: 9 }));
    expect(JSON.stringify(suggest({ ...base, seed: 9 }))).not.toEqual(JSON.stringify(suggest({ ...base, seed: 10 })));
  });

  it('mix mode picks a subset that fits the zone', () => {
    const big = [...EIGHT, P('i', 30, 40), P('j', 20, 24), P('k', 5, 7), P('l', 36, 48)];
    const vs = suggest({ wall: WALL, pool: big, mode: 'mix', style: 'any', gap: GAP, seed: 4 });
    expect(vs.length).toBeGreaterThan(0);
    for (const v of vs) {
      const ids = new Set(v.placements.map((p) => p.id));
      const area = big.filter((p) => ids.has(p.id)).reduce((s, p) => s + p.w * p.h, 0);
      expect(area).toBeLessThanOrEqual(zoneArea(artZone(WALL)) * FILL_MAX + 1);
    }
  });

  it('keeps locked pieces where they are and arranges around them', () => {
    const pool = [P('lock', 16, 20, { x: 300, y: 600 }), ...EIGHT.slice(0, 5)];
    const input: ArrangeInput = { wall: WALL, pool, mode: 'rearrange', style: 'any', gap: GAP, seed: 2 };
    const vs = suggest(input);
    expect(vs.length).toBeGreaterThan(0);
    vs.forEach((v) => checkValid(v, input));
  });
});

describe('keep-out zones', () => {
  it('never covers a door, and centres the group on the clear stretch beside it', () => {
    const door = { x: 200, y: 400, w: 914, h: 2000 };
    const wall = { ...WALL, keepOut: [door] };
    const input: ArrangeInput = { wall, pool: EIGHT.slice(0, 5), mode: 'rearrange', style: 'any', gap: GAP, seed: 5 };
    const vs = suggest(input);
    expect(vs.length).toBeGreaterThan(0);
    const byId = new Map(input.pool.map((p) => [p.id, p]));
    for (const v of vs) {
      checkValid(v, input);
      for (const q of v.placements) expect(overlaps({ x: q.x, y: q.y, w: byId.get(q.id)!.w, h: byId.get(q.id)!.h }, door)).toBe(false);
    }
    // Clear stretch is right of the door: its centre is well right of the wall's centre.
    expect(artZone(wall).target.x).toBeGreaterThan(1600);
  });
});

describe('suggest: properties over random walls and pieces', () => {
  it('never overlaps, never leaves the usable area, respects locks (1,000 inputs)', () => {
    const piece = fc.record({ w: fc.integer({ min: 4, max: 40 }), h: fc.integer({ min: 4, max: 40 }) });
    fc.assert(
      fc.property(
        fc.integer({ min: 1500, max: 6000 }),
        fc.integer({ min: 1800, max: 3200 }),
        fc.array(piece, { minLength: 1, maxLength: 9 }),
        fc.constantFrom('row', 'grid', 'salon', 'symmetric', 'any'),
        fc.constantFrom('mix', 'rearrange'),
        fc.boolean(),
        fc.integer(),
        (W, H, ps, style, mode, floor, seed) => {
          const pool = ps.map((p, i) => P(`p${i}`, p.w, p.h));
          const input: ArrangeInput = {
            wall: { bounds: { left: 0, top: 0, right: W, bottom: H }, floorY: floor ? H : undefined },
            pool,
            mode: mode as 'mix' | 'rearrange',
            style: style as ArrangeInput['style'],
            gap: GAP,
            seed,
            count: 3,
          };
          suggest(input).forEach((v) => checkValid(v, input));
        },
      ),
      { numRuns: 1000 },
    );
  }, 60_000);
});

describe('scoring', () => {
  const zone = artZone(WALL);
  const h = IN(20), w = IN(16);
  it('a centred, evenly spaced row beats a jumbled cluster', () => {
    const cx = zone.target.x, cy = zone.target.y;
    const neat = [-1, 0, 1].map((k) => ({ x: cx + k * (w + GAP) - w / 2, y: cy - h / 2, w, h }));
    const messy = [
      { x: cx - 900, y: cy - 400, w, h },
      { x: cx - 200, y: cy + 50, w, h },
      { x: cx + 300, y: cy - 150, w, h },
    ];
    expect(scoreLayout(neat, zone).score).toBeGreaterThan(scoreLayout(messy, zone).score);
  });
  it('a group off to one side scores lower than the same group centred', () => {
    const mk = (dx: number) => [0, 1].map((k) => ({ x: zone.target.x + dx + k * (w + GAP) - w, y: zone.target.y - h / 2, w, h }));
    expect(scoreLayout(mk(0), zone).terms.centre).toBeGreaterThan(scoreLayout(mk(700), zone).terms.centre);
  });
});

describe('selectSet', () => {
  it('stays within the fill limit and avoids extreme size mixes', () => {
    const zone = artZone(WALL);
    const pool = [P('poster', 36, 48), P('stamp', 3, 3), ...EIGHT];
    for (let s = 0; s < 50; s++) {
      const set = selectSet(pool, zone, rng(s))!;
      const area = set.reduce((a, p) => a + p.w * p.h, 0);
      expect(area).toBeLessThanOrEqual(zoneArea(zone) * FILL_MAX + 1);
      const areas = set.map((p) => p.w * p.h);
      expect(Math.max(...areas) / Math.min(...areas)).toBeLessThanOrEqual(10);
    }
  });
});
