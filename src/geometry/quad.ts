// Quadrilaterals: ordering, measurement, confidence, standard sizes (spec §5.6). Pure.
import type { Confidence, Mm } from '../domain/types.ts';
import { applyH, type Mat3 } from './mat3.ts';
import { inToMm } from './units.ts';
import { dist, type Pt } from './vec.ts';

/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];

/** Order 4 points TL, TR, BR, BL (image coords, y down). */
export function orderQuad(pts: readonly Pt[]): Quad {
  if (pts.length !== 4) throw new Error('A quad needs 4 points');
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
  const cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  // Clockwise on screen (y down) starting from the top-left-most by angle.
  const sorted = [...pts].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // sorted starts near angle -π (left), going through top (-π/2) to right (0) …
  let tl = 0;
  for (let i = 1; i < 4; i++) if (sorted[i]![0] + sorted[i]![1] < sorted[tl]![0] + sorted[tl]![1]) tl = i;
  return [0, 1, 2, 3].map((k) => sorted[(tl + k) % 4]!) as Quad;
}

/** Signed-area-based polygon area (absolute). */
export function polygonArea(pts: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

export function isConvex(q: readonly Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i]!, b = q[(i + 1) % q.length]!, c = q[(i + 2) % q.length]!;
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-9) continue;
    if (!sign) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

export function bbox(pts: readonly Pt[]): { x: number; y: number; w: number; h: number } {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Intersection-over-union of two quads' bounding boxes (cheap dedupe test). */
export function bboxIoU(a: readonly Pt[], b: readonly Pt[]): number {
  const A = bbox(a), B = bbox(b);
  const ix = Math.max(0, Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x));
  const iy = Math.max(0, Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y));
  const inter = ix * iy;
  return inter / (A.w * A.h + B.w * B.h - inter || 1);
}

/** Is quad `inner` (by bbox) inside `outer`, with a little slack? */
export function bboxContains(outer: readonly Pt[], inner: readonly Pt[], slack = 2): boolean {
  const O = bbox(outer), I = bbox(inner);
  return I.x >= O.x - slack && I.y >= O.y - slack && I.x + I.w <= O.x + O.w + slack && I.y + I.h <= O.y + O.h + slack;
}

/** How image pixels map to millimetres on the photographed plane. */
export type PlaneMap = { kind: 'homography'; H: Mat3 } | { kind: 'scale'; pxPerMm: number };

export const toMm = (m: PlaneMap, p: Pt): Pt => (m.kind === 'homography' ? applyH(m.H, p) : [p[0] / m.pxPerMm, p[1] / m.pxPerMm]);

export interface QuadMeasure {
  widthMm: Mm;
  heightMm: Mm;
  /** Opposite edges' worst relative difference, %. */
  edgeDiffPct: number;
  /** Worst corner's deviation from 90°. */
  maxAngleErrDeg: number;
  confidence: Confidence;
}

/** Confidence thresholds (spec §5.6). */
export const HIGH_EDGE_PCT = 2;
export const HIGH_ANGLE_DEG = 3;
export const CHECK_EDGE_PCT = 5;
export const CHECK_ANGLE_DEG = 6;

function cornerAngleDeg(a: Pt, b: Pt, c: Pt): number {
  const u = [a[0] - b[0], a[1] - b[1]];
  const v = [c[0] - b[0], c[1] - b[1]];
  const cos = (u[0]! * v[0]! + u[1]! * v[1]!) / (Math.hypot(u[0]!, u[1]!) * Math.hypot(v[0]!, v[1]!));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Measure a quad on the plane: mean of opposite edges, plus how rectangular it is. */
export function measureQuad(q: Quad, m: PlaneMap): QuadMeasure {
  const [tl, tr, br, bl] = q.map((p) => toMm(m, p)) as Quad;
  const top = dist(tl, tr), bottom = dist(bl, br), left = dist(tl, bl), right = dist(tr, br);
  const widthMm = (top + bottom) / 2;
  const heightMm = (left + right) / 2;
  const edgeDiffPct = Math.max(Math.abs(top - bottom) / widthMm, Math.abs(left - right) / heightMm) * 100;
  const corners: [Pt, Pt, Pt][] = [[bl, tl, tr], [tl, tr, br], [tr, br, bl], [br, bl, tl]];
  const maxAngleErrDeg = Math.max(...corners.map(([a, b, c]) => Math.abs(cornerAngleDeg(a, b, c) - 90)));
  const confidence: Confidence =
    edgeDiffPct <= HIGH_EDGE_PCT && maxAngleErrDeg <= HIGH_ANGLE_DEG
      ? 'high'
      : edgeDiffPct <= CHECK_EDGE_PCT && maxAngleErrDeg <= CHECK_ANGLE_DEG
        ? 'check'
        : 'low';
  return { widthMm, heightMm, edgeDiffPct, maxAngleErrDeg, confidence };
}

export interface StandardSize {
  label: string;
  /** Short side, long side. */
  a: Mm;
  b: Mm;
}

const inch = (a: number, b: number): StandardSize => ({ label: `${a} × ${b} in`, a: inToMm(a), b: inToMm(b) });
const cm = (a: number, b: number): StandardSize => ({ label: `${a} × ${b} cm`, a: a * 10, b: b * 10 });

/** Common frame/print sizes for snap suggestions (spec §5.6). */
export const STANDARD_SIZES: StandardSize[] = [
  inch(4, 6), inch(5, 7), inch(8, 10), inch(8.5, 11), inch(11, 14), inch(12, 16), inch(16, 20), inch(18, 24), inch(20, 24), inch(24, 36),
  { label: 'A5', a: 148, b: 210 }, { label: 'A4', a: 210, b: 297 }, { label: 'A3', a: 297, b: 420 }, { label: 'A2', a: 420, b: 594 },
  cm(13, 18), cm(20, 30), cm(30, 40), cm(40, 50), cm(50, 70), cm(70, 100),
];

/** Snap tolerance on each dimension (spec §5.6). */
export const SNAP_TOLERANCE_PCT = 1.5;

/** The closest standard size within tolerance on both sides, oriented like the measurement. */
export function snapSuggestion(widthMm: Mm, heightMm: Mm): { label: string; widthMm: Mm; heightMm: Mm } | null {
  const portrait = heightMm >= widthMm;
  const [s, l] = portrait ? [widthMm, heightMm] : [heightMm, widthMm];
  let best: { size: StandardSize; err: number } | null = null;
  for (const size of STANDARD_SIZES) {
    const e = Math.max(Math.abs(s - size.a) / size.a, Math.abs(l - size.b) / size.b) * 100;
    if (e <= SNAP_TOLERANCE_PCT && (!best || e < best.err)) best = { size, err: e };
  }
  if (!best) return null;
  const { a, b, label } = best.size;
  return portrait ? { label, widthMm: a, heightMm: b } : { label, widthMm: b, heightMm: a };
}

/**
 * Least-squares similarity (uniform scale + rotation + translation) mapping
 * `src` points onto `dst` (closed form, 2D Umeyama). Used when the photo is
 * already straightened by gravity, so a reference only has to supply scale:
 * no perspective is fitted, so small corner errors don't get amplified far
 * from the reference.
 */
export function similarityFit(src: readonly Pt[], dst: readonly Pt[]): Mat3 {
  const n = src.length;
  const mean = (ps: readonly Pt[]): Pt => [ps.reduce((s, p) => s + p[0], 0) / n, ps.reduce((s, p) => s + p[1], 0) / n];
  const ms = mean(src), md = mean(dst);
  let a = 0, b = 0, ss = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i]![0] - ms[0], y = src[i]![1] - ms[1];
    const u = dst[i]![0] - md[0], v = dst[i]![1] - md[1];
    a += x * u + y * v;
    b += x * v - y * u;
    ss += x * x + y * y;
  }
  const c = a / ss, s = b / ss; // scale·cos, scale·sin
  return [c, -s, md[0] - (c * ms[0] - s * ms[1]), s, c, md[1] - (s * ms[0] + c * ms[1]), 0, 0, 1];
}
