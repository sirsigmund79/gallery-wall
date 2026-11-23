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
