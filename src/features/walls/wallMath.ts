// Calibrating a wall from one known rectangle (spec §5.5 "fix angle"). Pure.
import type { LengthUnit, Mm } from '../../domain/types.ts';
import { planWarp, planWarpInner } from '../../geometry/gravity.ts';
import { applyH, mul, scaling, type Mat3 } from '../../geometry/mat3.ts';
import type { Quad } from '../../geometry/quad.ts';
import { inToMm } from '../../geometry/units.ts';
import type { Pt } from '../../geometry/vec.ts';

export type RefKind = 'door' | 'sheet' | 'plate' | 'other';

export interface RefPreset {
  label: string;
  /** Short side, long side (mm). */
  a: Mm;
  b: Mm;
  kind: RefKind;
}

/** Things most walls have, with standard sizes. Doors follow the user's units. */
export function wallPresets(units: LengthUnit): RefPreset[] {
  const doors: RefPreset[] =
    units === 'in'
      ? [30, 32, 36].map((w) => ({ label: `Door ${w} × 80 in`, a: inToMm(w), b: inToMm(80), kind: 'door' as const }))
      : [70, 80, 90].map((w) => ({ label: `Door ${w} × 200 cm`, a: w * 10, b: 2000, kind: 'door' as const }));
  return [
    ...doors,
    { label: 'Light switch plate', a: inToMm(2.75), b: inToMm(4.5), kind: 'plate' },
    { label: 'US Letter sheet', a: 215.9, b: 279.4, kind: 'sheet' },
    { label: 'A4 sheet', a: 210, b: 297, kind: 'sheet' },
  ];
}

export interface RectifyPlan {
  /** Source px → rectified px (for warpPerspective). */
  H: Mat3;
  width: number;
  height: number;
  /** Rectified pixels per mm (uniform). */
  pxPerMm: number;
}

/**
 * Given H (source px → wall mm, from the reference rectangle), plan a warp to
 * a face-on image that keeps roughly the same number of pixels. Prefers a crop
 * with no empty corners; falls back to the full extent. Null if the warp is
 * degenerate (e.g. part of the photo is above the horizon of the wall plane).
 */
export function planRectify(Hmm: Mat3, w: number, h: number): RectifyPlan | null {
  const corners: Pt[] = [[0, 0], [w, 0], [w, h], [0, h]];
  for (const c of corners) if (Hmm[6]! * c[0] + Hmm[7]! * c[1] + Hmm[8]! <= 0) return null;
  const mm = corners.map((c) => applyH(Hmm, c));
  const xs = mm.map((p) => p[0]), ys = mm.map((p) => p[1]);
  const areaMm = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  if (!(areaMm > 0)) return null;
  const k = Math.sqrt((w * h) / areaMm);
  const M = mul(scaling(k), Hmm);
  const plan = planWarpInner(M, w, h) ?? planWarp(M, w, h);
  return plan ? { H: plan.H, width: plan.width, height: plan.height, pxPerMm: k } : null;
}

export const mapQuad = (H: Mat3, q: Quad): Quad => q.map((p) => applyH(H, p)) as Quad;

/** Axis-aligned box of a quad, converted to mm. */
export function quadBoxMm(q: Quad, pxPerMm: number): { x: Mm; y: Mm; w: Mm; h: Mm } {
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0 / pxPerMm, y: y0 / pxPerMm, w: (Math.max(...xs) - x0) / pxPerMm, h: (Math.max(...ys) - y0) / pxPerMm };
}

/** "Wall N" for the next wall. */
export function nextWallName(existing: readonly string[]): string {
  let n = existing.length;
  for (const s of existing) {
    const m = /^Wall (\d+)$/.exec(s);
    if (m) n = Math.max(n, Number(m[1]));
  }
  for (;;) {
    n++;
    if (!existing.includes(`Wall ${n}`)) return `Wall ${n}`;
  }
}

export { DEFAULT_ROOM } from '../../db/schema.ts';

// ── When is it safe to re-warp a photo from a reference? ──

/** A reference must span at least this share of the photo's width or height to correct the angle. */
export const LARGE_REF_FRAC = 0.25;
/** Max ratio of local magnification across the photo after a warp (beyond it, it looks stretched). */
export const MAX_LOCAL_SCALE_RATIO = 1.5;
/** Max change of the photo's overall proportions after a warp. */
export const MAX_ASPECT_CHANGE = 1.5;
/** Typical corner error (px) after automatic refinement, for the ± hint. */
export const CORNER_ERROR_PX = 1.5;

export type CalibChoice = { kind: 'warp' } | { kind: 'size'; reason: 'level' | 'one-side' | 'small' | 'implausible' };

const quadSides = (q: Quad) => q.map((p, i) => Math.hypot(q[(i + 1) % 4]![0] - p[0], q[(i + 1) % 4]![1] - p[1]));

/** Rough ± (%) a reference gives, from its shortest side in pixels. */
export function refErrorPct(q: Quad): number {
  return (CORNER_ERROR_PX / Math.max(1, Math.min(...quadSides(q)))) * 100;
}

/** Share of the photo the reference spans (max of width and height fractions). */
export function refSpan(q: Quad, w: number, h: number): number {
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  return Math.max((Math.max(...xs) - Math.min(...xs)) / w, (Math.max(...ys) - Math.min(...ys)) / h);
}

/** Does warping by Hmm (px → mm) stretch the photo implausibly? */
export function warpIsPlausible(Hmm: Mat3, w: number, h: number): boolean {
  const corners: Pt[] = [[0, 0], [w, 0], [w, h], [0, h]];
  // Local linear magnification at each corner (sqrt of the Jacobian's determinant).
  const d = Math.max(w, h) * 0.01;
  const local = corners.map(([x, y]) => {
    const p = applyH(Hmm, [x, y]), px = applyH(Hmm, [x + d, y]), py = applyH(Hmm, [x, y + d]);
    const a = (px[0] - p[0]) / d, b = (py[0] - p[0]) / d, c = (px[1] - p[1]) / d, e = (py[1] - p[1]) / d;
    return Math.sqrt(Math.abs(a * e - b * c));
  });
  if (local.some((v) => !Number.isFinite(v) || v <= 0)) return false;
  if (Math.max(...local) / Math.min(...local) > MAX_LOCAL_SCALE_RATIO) return false;
  const mm = corners.map((c) => applyH(Hmm, c));
  const xs = mm.map((p) => p[0]), ys = mm.map((p) => p[1]);
  const aspectOut = (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
  const change = aspectOut / (w / h);
  return change <= MAX_ASPECT_CHANGE && change >= 1 / MAX_ASPECT_CHANGE;
}

/**
 * Re-warp face-on from the reference, or use it for size only?
 *  - Level-camera photos are already straight: never warp (a slightly-off
 *    outline would only add a false angle).
 *  - Ordinary photos: warp only from a large reference with both sides known,
 *    and only if the result isn't implausibly stretched.
 */
export function chooseCalibration(o: { guided: boolean; bothSides: boolean; refQuad: Quad; w: number; h: number; Hmm?: Mat3 }): CalibChoice {
  if (o.guided) return { kind: 'size', reason: 'level' };
  if (!o.bothSides) return { kind: 'size', reason: 'one-side' };
  if (refSpan(o.refQuad, o.w, o.h) < LARGE_REF_FRAC) return { kind: 'size', reason: 'small' };
  if (!o.Hmm || !warpIsPlausible(o.Hmm, o.w, o.h)) return { kind: 'size', reason: 'implausible' };
  return { kind: 'warp' };
}

/**
 * Uniform px/mm from a reference used for size only: the average of the
 * scales its known sides imply, and how much they disagree (%).
 */
export function sizeOnlyScale(q: Quad, widthMm: Mm | null, heightMm: Mm | null): { pxPerMm: number; spreadPct: number } | null {
  const [top, right, bottom, left] = quadSides(q);
  const s: number[] = [];
  if (widthMm) s.push((top! + bottom!) / 2 / widthMm);
  if (heightMm) s.push((left! + right!) / 2 / heightMm);
  if (!s.length) return null;
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { pxPerMm: mean, spreadPct: s.length > 1 ? (Math.abs(s[0]! - s[1]!) / mean) * 100 : 0 };
}
