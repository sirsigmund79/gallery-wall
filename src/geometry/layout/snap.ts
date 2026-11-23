// Smart-guide snapping for the layout editor (spec §6.5). Pure.
// Edges/centres follow the approach of Konva's "Objects Snapping" demo; equal-gap
// and datum snapping are ours.
import type { Mm } from '../../domain/types.ts';
import { bottom, cx, cy, right, spanOverlap, type Rect } from './rect.ts';

export interface SnapTargets {
  /** Other pieces (not the one being moved). */
  others: Rect[];
  /** Extra vertical lines (x) and horizontal lines (y): wall centre lines, datums, guides. */
  linesX: Mm[];
  linesY: Mm[];
}

export interface Guide {
  axis: 'x' | 'y';
  /** Position of the guide line on its axis. */
  at: Mm;
  kind: 'edge' | 'center' | 'line';
}

export interface GapMark {
  axis: 'x' | 'y';
  /** Gap segment start/end on its axis, and the cross-axis position to draw it at. */
  from: Mm;
  to: Mm;
  cross: Mm;
}

export interface SnapResult {
  x: Mm;
  y: Mm;
  guides: Guide[];
  gaps: GapMark[];
}

interface Candidate {
  /** New top-left coordinate on this axis if the snap is taken. */
  pos: Mm;
  dist: number;
  guide?: Guide;
  gap?: Mm;
}

/** All gaps between pairs of pieces that face each other along `axis`. */
export function existingGaps(rects: readonly Rect[], axis: 'x' | 'y'): { gap: Mm; a: Rect; b: Rect }[] {
  const cross = axis === 'x' ? 'y' : 'x';
  const out: { gap: Mm; a: Rect; b: Rect }[] = [];
  for (const a of rects) {
    // Nearest neighbour after `a` along the axis that shares cross-axis extent.
    let best: { gap: Mm; b: Rect } | undefined;
    for (const b of rects) {
      if (a === b || !spanOverlap(a, b, cross)) continue;
      const gap = axis === 'x' ? b.x - right(a) : b.y - bottom(a);
      if (gap > 0 && (!best || gap < best.gap)) best = { gap, b };
    }
    if (best) out.push({ gap: best.gap, a, b: best.b });
  }
  return out;
}

function axisCandidates(r: Rect, t: SnapTargets, axis: 'x' | 'y', threshold: Mm): Candidate[] {
  const pos = axis === 'x' ? r.x : r.y;
  const size = axis === 'x' ? r.w : r.h;
  const lo = (o: Rect) => (axis === 'x' ? o.x : o.y);
  const hi = (o: Rect) => (axis === 'x' ? right(o) : bottom(o));
  const mid = (o: Rect) => (axis === 'x' ? cx(o) : cy(o));
  const cands: Candidate[] = [];
  const push = (newPos: Mm, guide?: Guide, gap?: Mm) => {
    const d = Math.abs(newPos - pos);
    if (d <= threshold) cands.push({ pos: newPos, dist: d, guide, gap });
  };

  // My edges/centre against their edges/centre.
  for (const o of t.others) {
    for (const [line, kind] of [[lo(o), 'edge'], [hi(o), 'edge'], [mid(o), 'center']] as const) {
      push(line, { axis, at: line, kind });               // my start edge
      push(line - size, { axis, at: line, kind });        // my end edge
      push(line - size / 2, { axis, at: line, kind: kind === 'center' ? 'center' : kind }); // my centre
    }
  }
  const lines = axis === 'x' ? t.linesX : t.linesY;
  for (const line of lines) {
    push(line, { axis, at: line, kind: 'line' });
    push(line - size, { axis, at: line, kind: 'line' });
    push(line - size / 2, { axis, at: line, kind: 'line' });
  }

  // Equal gaps: sit at an existing gap's distance from a facing neighbour.
  const cross = axis === 'x' ? 'y' : 'x';
  const gaps = existingGaps(t.others, axis).map((g) => g.gap);
  for (const o of t.others) {
    if (!spanOverlap(r, o, cross)) continue;
    for (const g of gaps) {
      push(hi(o) + g, undefined, g);          // after o
      push(lo(o) - g - size, undefined, g);   // before o
    }
  }
  return cands;
}

function best(cands: Candidate[]): Candidate | undefined {
  // Prefer the closest; on ties, prefer an alignment guide over a gap.
  return cands.reduce<Candidate | undefined>(
    (b, c) => (!b || c.dist < b.dist - 1e-9 || (Math.abs(c.dist - b.dist) <= 1e-9 && c.guide && !b.guide) ? c : b),
    undefined,
  );
}

/** Gap marks to draw for a rect at its final position (all gaps equal to a snapped gap). */
function gapMarks(r: Rect, others: readonly Rect[], axis: 'x' | 'y', gap: Mm): GapMark[] {
  const all = [...others, r];
  const eps = 0.5;
  return existingGaps(all, axis)
    .filter((g) => Math.abs(g.gap - gap) < eps)
    .map(({ a, b }) => {
      const crossLo = axis === 'x' ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
      const crossHi = axis === 'x' ? Math.min(bottom(a), bottom(b)) : Math.min(right(a), right(b));
      return {
        axis,
        from: axis === 'x' ? right(a) : bottom(a),
        to: axis === 'x' ? b.x : b.y,
        cross: (crossLo + crossHi) / 2,
      };
    });
}

/**
 * Snap a moving rect. `threshold` is in mm; callers convert from a fixed
 * on-screen distance (spec: snap distance is in screen pixels) via the zoom.
 */
export function snapRect(r: Rect, t: SnapTargets, threshold: Mm): SnapResult {
  const bx = best(axisCandidates(r, t, 'x', threshold));
  const x = bx ? bx.pos : r.x;
  // Snap y using the x-snapped rect so cross-axis overlap tests are current.
  const by = best(axisCandidates({ ...r, x }, t, 'y', threshold));
  const y = by ? by.pos : r.y;
  const final = { ...r, x, y };

  const guides: Guide[] = [];
  const gaps: GapMark[] = [];
  for (const [b, axis] of [[bx, 'x'], [by, 'y']] as const) {
    if (!b) continue;
    if (b.guide) guides.push(b.guide);
    if (b.gap !== undefined) gaps.push(...gapMarks(final, t.others, axis, b.gap));
  }
  return { x, y, guides, gaps };
}
