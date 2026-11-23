// Sub-pixel quad refinement on a grayscale image. Pure TS (no OpenCV), so it
// runs anywhere and is unit-tested directly.
//
// For each side: sample points along it, search along the side's normal for the
// strongest consistent brightness step (parabolic sub-pixel peak), fit a line through
// those points (total least squares, outliers trimmed), then intersect
// neighbouring lines to get the corners.
import type { Quad } from '../geometry/quad.ts';
import type { Pt } from '../geometry/vec.ts';

export interface GrayImage {
  data: Float32Array | Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/** Bilinear sample. */
function at(g: GrayImage, x: number, y: number): number {
  const W = g.width, H = g.height;
  if (x < 0 || y < 0 || x > W - 1 || y > H - 1) return NaN;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const d = g.data;
  return (
    d[y0 * W + x0]! * (1 - fx) * (1 - fy) + d[y0 * W + x1]! * fx * (1 - fy) + d[y1 * W + x0]! * (1 - fx) * fy + d[y1 * W + x1]! * fx * fy
  );
}

interface Line {
  /** Point on the line and unit direction. */
  p: Pt;
  d: Pt;
}

function fitLine(pts: Pt[]): Line | null {
  if (pts.length < 2) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // principal direction
  return { p: [mx, my], d: [Math.cos(theta), Math.sin(theta)] };
}

const residual = (l: Line, q: Pt) => Math.abs((q[0] - l.p[0]) * -l.d[1] + (q[1] - l.p[1]) * l.d[0]);

function robustLine(pts: Pt[]): Line | null {
  let l = fitLine(pts);
  for (let iter = 0; l && iter < 2; iter++) {
    const r = pts.map((q) => residual(l!, q));
    const med = [...r].sort((a, b) => a - b)[r.length >> 1]!;
    const keep = pts.filter((_, i) => r[i]! <= Math.max(0.5, 2.5 * med));
    if (keep.length < Math.max(4, pts.length / 3)) break;
    l = fitLine(keep);
  }
  return l;
}

function intersect(a: Line, b: Line): Pt | null {
  const den = a.d[0] * b.d[1] - a.d[1] * b.d[0];
  if (Math.abs(den) < 1e-6) return null;
  const t = ((b.p[0] - a.p[0]) * b.d[1] - (b.p[1] - a.p[1]) * b.d[0]) / den;
  return [a.p[0] + t * a.d[0], a.p[1] + t * a.d[1]];
}

export interface RefineOptions {
  /** Search distance either side of the current edge, px. */
  radius?: number;
  /** Samples per side. */
  samples?: number;
  /** Skip this fraction of each side near the corners (corner rounding, shadows). */
  endTrim?: number;
}

/**
 * Snap a quad's sides to the strongest nearby edges. Returns the input
 * unchanged if a side can't be refined reliably (too few edge points, or the
 * result moved implausibly far).
 */
export function refineQuad(g: GrayImage, q: Quad, opts: RefineOptions = {}): Quad {
  return refineQuadScored(g, q, opts).quad;
}

/**
 * As refineQuad, plus `support` in [0, 1]: the share of samples along the sides
 * that found a consistent edge close to the fitted line (0 if refinement failed).
 */
export function refineQuadScored(g: GrayImage, q: Quad, opts: RefineOptions = {}): { quad: Quad; support: number } {
  const radius = opts.radius ?? Math.max(4, Math.round(Math.max(g.width, g.height) * 0.005));
  const samples = opts.samples ?? 40;
  const trim = opts.endTrim ?? 0.12;
  const lines: Line[] = [];
  let supported = 0;
  for (let s = 0; s < 4; s++) {
    const a = q[s]!, b = q[(s + 1) % 4]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const nrm: Pt = [-dir[1], dir[0]];
    // Brightness profiles across the edge (1 px steps), with a wide step
    // detector: mean of 2 px after minus mean of 2 px before. A step (frame vs
    // floor) scores high; a thin line (wood grain, a gap) mostly cancels out.
    const profiles: { c: Pt; grad: number[] }[] = [];
    for (let i = 0; i < samples; i++) {
      const t = trim + ((1 - 2 * trim) * (i + 0.5)) / samples;
      const c: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const prof: number[] = [];
      for (let k = -radius - 2; k <= radius + 2; k++) prof.push(at(g, c[0] + nrm[0] * k, c[1] + nrm[1] * k));
      if (prof.some(Number.isNaN)) continue;
      const grad: number[] = [];
      for (let k = 2; k < prof.length - 2; k++) grad.push((prof[k + 1]! + prof[k + 2]! - prof[k - 1]! - prof[k - 2]!) / 2);
      profiles.push({ c, grad });
    }
    // The real edge has the same polarity (dark→light or light→dark) all along
    // the side: take the majority sign of each sample's strongest response.
    // Only interior local maxima count: a response at the window's edge is
    // cut off (it's really something further away, like a neighbouring grain line).
    const peak = (grad: number[], sgn: number) => {
      let best = -1, bestV = 0;
      for (let k = 1; k < grad.length - 1; k++) {
        const v = grad[k]! * sgn;
        if (v > bestV && v >= grad[k - 1]! * sgn && v >= grad[k + 1]! * sgn) { bestV = v; best = k; }
      }
      return { best, bestV };
    };
    let vote = 0;
    for (const { grad } of profiles) {
      const up = peak(grad, 1).bestV, down = peak(grad, -1).bestV;
      vote += up > down ? 1 : up < down ? -1 : 0;
    }
    const sign = vote >= 0 ? 1 : -1;
    const pts: Pt[] = [];
    const strengths: number[] = [];
    for (const { c, grad } of profiles) {
      const { best, bestV } = peak(grad, sign);
      if (best < 1) continue;
      const gm = grad[best - 1]! * sign, gp = grad[best + 1]! * sign;
      const den = gm - 2 * bestV + gp;
      const off = Math.abs(den) > 1e-9 ? (0.5 * (gm - gp)) / den : 0;
      // grad[j] is centred on profile sample j+2, i.e. offset j - radius from the side.
      const k = best - radius + Math.max(-0.5, Math.min(0.5, off));
      pts.push([c[0] + nrm[0] * k, c[1] + nrm[1] * k]);
      strengths.push(bestV);
    }
    // Keep reasonably strong edge samples only.
    const medS = [...strengths].sort((x, y) => x - y)[strengths.length >> 1] ?? 0;
    const strong = pts.filter((_, i) => strengths[i]! >= medS * 0.5 && strengths[i]! > 4);
    const line = strong.length >= samples / 4 ? robustLine(strong) : null;
    if (!line) {
      return { quad: q, support: 0 };
    }
    lines.push(line);
    supported += strong.filter((p) => residual(line, p) <= 1).length / samples;
  }
  const out: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    const p = intersect(lines[(i + 3) % 4]!, lines[i]!);
    if (!p || Math.hypot(p[0] - q[i]![0], p[1] - q[i]![1]) > radius * 2.5) {
      return { quad: q, support: 0 };
    }
    out.push(p);
  }
  return { quad: out as Quad, support: supported / 4 };
}
