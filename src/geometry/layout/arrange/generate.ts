// Candidate arrangements of a set of pieces. Each generator returns positions
// relative to an arbitrary origin; `centreOn` then places the group. Pure.
import { MaxRectsPacker } from 'maxrects-packer';
import type { Mm } from '../../../domain/types.ts';
import { overlaps, type Rect } from '../rect.ts';
import { shuffle } from './rng.ts';
import type { ArrangePiece, Placed, Style, Zone } from './types.ts';

type Rel = { p: ArrangePiece; x: Mm; y: Mm };

const area = (p: ArrangePiece) => p.w * p.h;

/** Largest in the middle, the rest alternating outwards (pleasing, symmetric). */
function centreOut(ps: ArrangePiece[]): ArrangePiece[] {
  const sorted = [...ps].sort((a, b) => area(b) - area(a));
  const out: ArrangePiece[] = [];
  sorted.forEach((p, i) => (i % 2 ? out.unshift(p) : out.push(p)));
  return out;
}

/**
 * Row: one line of art on a shared centre line (or top/bottom aligned). When a
 * single row is wider than `maxW`, split into two rows hugging the centre line
 * (top row bottom-aligned, bottom row top-aligned): the classic gallery line.
 */
export function row(ps: ArrangePiece[], gap: Mm, r: () => number, maxW = Infinity): Rel[] {
  const order = r() < 0.6 ? centreOut(ps) : shuffle(ps, r);
  const lineW = (xs: ArrangePiece[]) => xs.reduce((s, p) => s + p.w, 0) + gap * Math.max(0, xs.length - 1);
  const lay = (xs: ArrangePiece[], y0: Mm, align: 'centre' | 'top' | 'bottom', H: Mm, x0: Mm): Rel[] => {
    let x = x0;
    return xs.map((p) => {
      const y = y0 + (align === 'top' ? 0 : align === 'bottom' ? H - p.h : (H - p.h) / 2);
      const rel = { p, x, y };
      x += p.w + gap;
      return rel;
    });
  };
  if (lineW(order) <= maxW || order.length < 2) {
    const align = r() < 0.6 ? 'centre' : r() < 0.5 ? 'top' : 'bottom';
    return lay(order, 0, align, Math.max(...order.map((p) => p.h)), 0);
  }
  // Two rows: split where the widths are most even.
  let cut = 1, best = Infinity;
  for (let i = 1; i < order.length; i++) {
    const d = Math.abs(lineW(order.slice(0, i)) - lineW(order.slice(i)));
    if (d < best) [best, cut] = [d, i];
  }
  const top = centreOut(order.slice(0, cut)), bot = centreOut(order.slice(cut));
  const Wt = lineW(top), Wb = lineW(bot), W = Math.max(Wt, Wb);
  const Ht = Math.max(...top.map((p) => p.h));
  return [...lay(top, 0, 'bottom', Ht, (W - Wt) / 2), ...lay(bot, Ht + gap, 'top', 0, (W - Wb) / 2)];
}

export function grid(ps: ArrangePiece[], gap: Mm, r: () => number, aspect: number): Rel[] {
  const n = ps.length;
  // Similar sizes next to each other read as a tidy grid.
  const order = r() < 0.5 ? [...ps].sort((a, b) => area(b) - area(a)) : shuffle(ps, r);
  let best: Rel[] = [];
  let bestErr = Infinity;
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows);
    if ((rows - 1) * cols >= n) continue;
    const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...order.filter((_, i) => i % cols === c).map((p) => p.w)));
    const rowH = Array.from({ length: rows }, (_, rr) => Math.max(0, ...order.filter((_, i) => Math.floor(i / cols) === rr).map((p) => p.h)));
    const W = colW.reduce((a, b) => a + b, 0) + gap * (cols - 1);
    const H = rowH.reduce((a, b) => a + b, 0) + gap * (rows - 1);
    const err = Math.abs(Math.log(W / H / aspect));
    if (err < bestErr) {
      bestErr = err;
      best = order.map((p, i) => {
        const c = i % cols, rr = Math.floor(i / cols);
        const cx = colW.slice(0, c).reduce((a, b) => a + b, 0) + gap * c;
        const cy = rowH.slice(0, rr).reduce((a, b) => a + b, 0) + gap * rr;
        // Centre each piece in its cell.
        return { p, x: cx + (colW[c]! - p.w) / 2, y: cy + (rowH[rr]! - p.h) / 2 };
      });
    }
  }
  return best;
}

/** Salon: MaxRects packing (spec §0A reuse) into a bin of the target proportions. */
export function salon(ps: ArrangePiece[], gap: Mm, r: () => number, zone: Zone): Rel[] | null {
  const totalArea = ps.reduce((s, p) => s + area(p), 0);
  const fill = 0.65 + r() * 0.15;
  const aspect = (zone.targetWidth / zone.targetHeight) * (0.8 + r() * 0.4);
  const binH = Math.sqrt(totalArea / fill / aspect);
  const binW = Math.max(binH * aspect, ...ps.map((p) => p.w));
  const packer = new MaxRectsPacker(binW + gap, Math.max(binH, ...ps.map((p) => p.h)) * 3 + gap, gap, {
    smart: false,
    pot: false,
    square: false,
    allowRotation: false,
    border: 0,
  });
  const order = r() < 0.5 ? [...ps].sort((a, b) => area(b) - area(a)) : shuffle(ps, r);
  const rects = order.map((p) => ({ width: p.w, height: p.h, data: p }));
  for (const rect of rects) packer.add(rect);
  if (packer.bins.length !== 1) return null;
  const placed = packer.bins[0]!.rects as unknown as { x: number; y: number; data: ArrangePiece }[];
  if (placed.length !== ps.length) return null;
  return placed.map((q) => ({ p: q.data, x: q.x, y: q.y }));
}

/** Symmetric: largest piece in the centre, similar pairs mirrored either side. */
export function symmetric(ps: ArrangePiece[], gap: Mm, r: () => number): Rel[] | null {
  const sorted = [...ps].sort((a, b) => area(b) - area(a));
  const hero = sorted.shift()!;
  const out: Rel[] = [{ p: hero, x: -hero.w / 2, y: -hero.h / 2 }];
  // Pair the rest by similar size.
  const pairs: [ArrangePiece, ArrangePiece][] = [];
  const singles: ArrangePiece[] = [];
  while (sorted.length) {
    const a = sorted.shift()!;
    const j = sorted.findIndex((b) => Math.abs(b.w - a.w) / a.w < 0.2 && Math.abs(b.h - a.h) / a.h < 0.2);
    if (j >= 0) pairs.push([a, sorted.splice(j, 1)[0]!]);
    else singles.push(a);
  }
  if (!pairs.length && singles.length) return null; // nothing to mirror
  // Stack pairs in columns beside the hero, vertically centred on it.
  const colW = Math.max(0, ...pairs.flatMap(([a, b]) => [a.w, b.w]));
  const stackH = pairs.reduce((s, [a]) => s + a.h, 0) + gap * (pairs.length - 1);
  let y = -stackH / 2;
  for (const [a, b] of r() < 0.5 ? pairs : [...pairs].reverse()) {
    out.push({ p: a, x: -hero.w / 2 - gap - (colW + a.w) / 2, y });
    out.push({ p: b, x: hero.w / 2 + gap + (colW - b.w) / 2, y });
    y += a.h + gap;
  }
  // Leftovers go centred above/below the hero, alternating.
  let above = -hero.h / 2 - gap, below = hero.h / 2 + gap;
  singles.forEach((s, i) => {
    if (i % 2 === 0) {
      out.push({ p: s, x: -s.w / 2, y: below });
      below += s.h + gap;
    } else {
      above -= s.h;
      out.push({ p: s, x: -s.w / 2, y: above });
      above -= gap;
    }
  });
  return out;
}

const bboxOf = (rel: Rel[]) => {
  const x0 = Math.min(...rel.map((q) => q.x)), y0 = Math.min(...rel.map((q) => q.y));
  const x1 = Math.max(...rel.map((q) => q.x + q.p.w)), y1 = Math.max(...rel.map((q) => q.y + q.p.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/**
 * Place a relative group on the wall: centre its bounding box on the target,
 * nudged to stay inside the usable area and clear of locked pieces.
 * Returns null if it can't fit.
 */
export function centreOn(rel: Rel[], zone: Zone, obstacles: Rect[], gap: Mm): Placed[] | null {
  if (!rel.length) return [];
  const bb = bboxOf(rel);
  const U = zone.usable;
  if (bb.w > U.w + 1e-6 || bb.h > U.h + 1e-6) return null;
  const clampX = (x: Mm) => Math.min(U.x + U.w - bb.w, Math.max(U.x, x));
  const clampY = (y: Mm) => Math.min(U.y + U.h - bb.h, Math.max(U.y, y));
  const baseX = clampX(zone.target.x - bb.w / 2);
  // Bottom-aligned (above a TV/sofa): the group's bottom edge on the line.
  const baseY = clampY(zone.align === 'bottom' ? zone.target.y - bb.h : zone.target.y - bb.h / 2);
  // Try the centred spot, then step sideways/up/down until clear of locked pieces.
  const step = Math.max(gap, 25);
  const tries: [number, number][] = [[0, 0]];
  // Above an anchor, only slide sideways or up (never down onto it).
  for (let k = 1; k <= 40; k++) tries.push([k * step, 0], [-k * step, 0], [0, -k * step], ...(zone.align === 'bottom' ? [] : [[0, k * step] as [number, number]]));
  for (const [dx, dy] of tries) {
    const ox = clampX(baseX + dx) - bb.x, oy = clampY(baseY + dy) - bb.y;
    const out = rel.map((q) => ({ id: q.p.id, x: q.x + ox, y: q.y + oy }));
    const rects = out.map((o, i) => ({ x: o.x - gap / 2, y: o.y - gap / 2, w: rel[i]!.p.w + gap, h: rel[i]!.p.h + gap }));
    if (!rects.some((a) => obstacles.some((b) => overlaps(a, b)))) return out;
  }
  return null;
}

export function generate(style: Style, ps: ArrangePiece[], gap: Mm, r: () => number, zone: Zone): Rel[] | null {
  if (!ps.length) return [];
  switch (style) {
    case 'row':
      return row(ps, gap, r, zone.usable.w);
    case 'grid':
      return grid(ps, gap, r, zone.targetWidth / zone.targetHeight);
    case 'salon':
      return salon(ps, gap, r, zone);
    case 'symmetric':
      return symmetric(ps, gap, r);
  }
}

export type { Rel };
