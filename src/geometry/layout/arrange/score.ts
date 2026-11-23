// How good an arrangement looks, from common gallery-wall rules of thumb.
// Each term is 0..1 (1 = ideal); the score is their weighted mean. Pure.
import type { Mm } from '../../../domain/types.ts';
import { bottom, overlaps, right, type Rect } from '../rect.ts';
import { existingGaps } from '../snap.ts';
import type { Zone } from './types.ts';

/** Tunable weights (covered by tests in score.test.ts). */
export const WEIGHTS = {
  /** Visual centre (area-weighted) on the target point: eye level, wall centre. */
  centre: 2,
  /** Left/right visual weight balanced about the group's own centre line. */
  balance: 1.5,
  /** Gaps between neighbours all the same. */
  gaps: 1.5,
  /** Pieces sharing edge or centre lines. */
  align: 1,
  /** Group width near the target (≈ 2/3 of the usable width). */
  width: 1,
  /** Group reads as one block: art fills its bounding box. */
  fill: 1,
  /** Breathing room from the usable area's edges. */
  margin: 0.5,
} as const;

/** Positions within this many mm count as aligned. */
const ALIGN_EPS = 3;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Hard constraints: inside the usable area and no overlaps (art never touches). */
export function valid(rects: Rect[], zone: Zone, minGap: Mm): boolean {
  const U = zone.usable;
  for (const r of rects) if (r.x < U.x - 0.5 || r.y < U.y - 0.5 || right(r) > U.x + U.w + 0.5 || bottom(r) > U.y + U.h + 0.5) return false;
  for (const r of rects) if (zone.keepOut.some((k) => overlaps(r, k))) return false;
  const half = Math.max(0, minGap / 2 - 0.5);
  const grown = rects.map((r) => ({ x: r.x - half, y: r.y - half, w: r.w + 2 * half, h: r.h + 2 * half }));
  for (let i = 0; i < grown.length; i++) for (let j = i + 1; j < grown.length; j++) if (overlaps(grown[i]!, grown[j]!)) return false;
  return true;
}

export function scoreLayout(rects: Rect[], zone: Zone): { score: number; terms: Record<keyof typeof WEIGHTS, number> } {
  const A = rects.reduce((s, r) => s + r.w * r.h, 0);
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map(right)), y1 = Math.max(...rects.map(bottom));
  const bw = x1 - x0, bh = y1 - y0;
  const gcx = rects.reduce((s, r) => s + (r.x + r.w / 2) * r.w * r.h, 0) / A;
  const gcy = rects.reduce((s, r) => s + (r.y + r.h / 2) * r.w * r.h, 0) / A;
  const U = zone.usable;

  const centre = clamp01(1 - Math.hypot((gcx - zone.target.x) / (U.w * 0.25 || 1), (gcy - zone.target.y) / (U.h * 0.25 || 1)));

  // Balance: area-weighted lever arms either side of the bounding box's centre line.
  const mid = (x0 + x1) / 2;
  const moment = rects.reduce((s, r) => s + (r.x + r.w / 2 - mid) * r.w * r.h, 0);
  const balance = clamp01(1 - Math.abs(moment) / (A * (bw / 2 || 1)) / 0.5);

  const gapsXY = [...existingGaps(rects, 'x'), ...existingGaps(rects, 'y')].map((g) => g.gap);
  let gaps = 1;
  if (gapsXY.length > 1) {
    const m = gapsXY.reduce((a, b) => a + b, 0) / gapsXY.length;
    const sd = Math.sqrt(gapsXY.reduce((s, g) => s + (g - m) ** 2, 0) / gapsXY.length);
    gaps = clamp01(1 - (sd / (m || 1)) * 2);
  }

  let aligned = 0;
  for (const r of rects) {
    const lines = (q: Rect) => [q.x, q.x + q.w / 2, right(q), q.y, q.y + q.h / 2, bottom(q)];
    const mine = lines(r);
    if (rects.some((o) => o !== r && lines(o).some((v, i) => Math.abs(v - mine[i]!) < ALIGN_EPS))) aligned++;
  }
  const align = rects.length > 1 ? aligned / rects.length : 1;

  const width = clamp01(1 - Math.abs(bw - zone.targetWidth) / zone.targetWidth);
  const fill = clamp01((A / (bw * bh) - 0.35) / 0.45);
  const minMargin = Math.min(x0 - U.x, U.x + U.w - x1, y0 - U.y, U.y + U.h - y1);
  const margin = clamp01(minMargin / (Math.min(U.w, U.h) * 0.1 || 1));

  const terms = { centre, balance, gaps, align, width, fill, margin };
  const wsum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const score = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce((s, k) => s + WEIGHTS[k] * terms[k], 0) / wsum;
  return { score, terms };
}
