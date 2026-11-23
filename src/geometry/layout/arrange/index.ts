// Auto-arrange / mix-and-match (spec §6.6): generate candidate sets and
// layouts, keep the valid ones, score, and return a varied top N. Pure and
// deterministic for a given seed.
import type { Rect } from '../rect.ts';
import { centreOn, generate } from './generate.ts';
import { rng } from './rng.ts';
import { scoreLayout, valid } from './score.ts';
import { selectSet } from './select.ts';
import type { ArrangeInput, ArrangePiece, Style, Variant } from './types.ts';
import { artZone } from './zone.ts';

export const STYLES: Style[] = ['row', 'grid', 'salon', 'symmetric'];
export const DEFAULT_VARIANTS = 6;
/** Attempts per style per subset (each with its own random choices). */
const TRIES = 6;
/** Subsets to try in mix mode. */
const SUBSETS = 8;

export * from './types.ts';
export { artZone } from './zone.ts';

function key(v: Variant): string {
  // Same pieces at (nearly) the same spots count as the same suggestion.
  return v.placements
    .map((p) => `${p.id}@${Math.round(p.x / 40)},${Math.round(p.y / 40)}`)
    .sort()
    .join('|');
}

export function suggest(input: ArrangeInput): Variant[] {
  const zone = artZone(input.wall);
  const r = rng(input.seed);
  const n = input.count ?? DEFAULT_VARIANTS;
  const styles = input.style === 'any' ? STYLES : [input.style];
  const locked = input.pool.filter((p) => p.locked);
  const lockedRects: Rect[] = locked.map((p) => ({ x: p.locked!.x, y: p.locked!.y, w: p.w, h: p.h }));
  const obstacles = [...lockedRects, ...zone.keepOut];

  const sets: ArrangePiece[][] = [];
  if (input.mode === 'rearrange') sets.push(input.pool);
  else
    for (let i = 0; i < SUBSETS; i++) {
      const s = selectSet(input.pool, zone, r);
      if (s) sets.push(s);
    }

  const candidates: Variant[] = [];
  for (const set of sets) {
    const free = set.filter((p) => !p.locked);
    const fixed = set.filter((p) => p.locked);
    for (const style of styles) {
      for (let t = 0; t < TRIES; t++) {
        const rel = generate(style, free, input.gap, r, zone);
        if (!rel) continue;
        const placed = centreOn(rel, zone, obstacles, input.gap);
        if (!placed) continue;
        const all = [...placed, ...fixed.map((p) => ({ id: p.id, x: p.locked!.x, y: p.locked!.y }))];
        const byId = new Map(set.map((p) => [p.id, p]));
        const rects = all.map((q) => ({ x: q.x, y: q.y, w: byId.get(q.id)!.w, h: byId.get(q.id)!.h }));
        if (!rects.length || !valid(rects, zone, input.gap * 0.9)) continue;
        const { score, terms } = scoreLayout(rects, zone);
        candidates.push({ style, placements: all, score, terms });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  // Variety: no duplicates; first pass allows one per (style, piece set) and,
  // with 'any', at most 2 per style; later passes relax that if we're short.
  const out: Variant[] = [];
  const seen = new Set<string>();
  const perStyle = new Map<Style, number>();
  const perStyleSet = new Map<string, number>();
  const styleSet = (v: Variant) => `${v.style}:${v.placements.map((p) => p.id).sort().join(',')}`;
  for (const [maxStyle, maxStyleSet] of [[2, 1], [Infinity, 1], [Infinity, Infinity]] as const) {
    for (const c of candidates) {
      if (out.length >= n) break;
      const k = key(c);
      if (seen.has(k)) continue;
      if (input.style === 'any' && (perStyle.get(c.style) ?? 0) >= maxStyle) continue;
      if ((perStyleSet.get(styleSet(c)) ?? 0) >= maxStyleSet) continue;
      seen.add(k);
      perStyle.set(c.style, (perStyle.get(c.style) ?? 0) + 1);
      perStyleSet.set(styleSet(c), (perStyleSet.get(styleSet(c)) ?? 0) + 1);
      out.push(c);
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
