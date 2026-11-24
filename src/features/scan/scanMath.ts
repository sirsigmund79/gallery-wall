// Calibration and measurement for a scan of several pieces. Pure.
import type { Mm } from '../../domain/types.ts';
import type { Mat3 } from '../../geometry/mat3.ts';
import { measureQuad, similarityFit, snapSuggestion, type PlaneMap, type Quad, type QuadMeasure } from '../../geometry/quad.ts';
import { dist, type Pt } from '../../geometry/vec.ts';

export interface Reference {
  quadId: string;
  widthMm: Mm | null;
  heightMm: Mm | null;
}

export type CalibrationPlan =
  | { kind: 'similarity'; H: Mat3 }
  | { kind: 'perspective'; src: Pt[]; dst: Pt[] } // computed by OpenCV in the worker
  | { kind: 'scale'; pxPerMm: number };

export const rectOf = (w: Mm, h: Mm): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];

/**
 * How the scan photo relates to the plane the art is on.
 *  - top-down: shot looking straight down and straightened by gravity → face-on.
 *  - wall-level: shot at a wall and straightened by gravity → no tilt, but the
 *    phone may have been turned a little to one side (yaw), which gravity can't see.
 *  - unknown: an ordinary photo.
 */
export type PhotoView = 'top-down' | 'wall-level' | 'unknown';

/**
 * Decide how to map pixels to mm from the reference.
 *  - Both sides known + level-camera photo (top-down or facing a wall): similarity
 *    (scale only). Gravity already straightened the photo; fitting a perspective
 *    to a small, slightly-off outline would only add a false angle.
 *  - Both sides known on an ordinary photo: full perspective from the reference.
 *  - One side known: uniform scale.
 */
export function planCalibration(refQuad: Quad, ref: Reference, view: PhotoView): CalibrationPlan | null {
  const { widthMm: w, heightMm: h } = ref;
  if (w && h) {
    return view !== 'unknown'
      ? { kind: 'similarity', H: similarityFit(refQuad, rectOf(w, h)) }
      : { kind: 'perspective', src: [...refQuad], dst: rectOf(w, h) };
  }
  const [tl, tr, br, bl] = refQuad;
  if (w) return { kind: 'scale', pxPerMm: (dist(tl, tr) + dist(bl, br)) / 2 / w };
  if (h) return { kind: 'scale', pxPerMm: (dist(tl, bl) + dist(tr, br)) / 2 / h };
  return null;
}

/** Overall accuracy note for the UI. */
export function calibrationNote(plan: CalibrationPlan, view: PhotoView): { quality: 'good' | 'check'; text: string } {
  if (view === 'top-down') return { quality: 'good', text: 'Straightened with the level sensor.' };
  if (plan.kind === 'perspective') return { quality: 'good', text: 'Angle corrected from your reference. Accuracy is best near the reference piece.' };
  if (view === 'wall-level') return { quality: 'good', text: 'Straightened with the level sensor. Stand square to the wall for best accuracy.' };
  return { quality: 'check', text: 'One side only on an angled photo: sizes may be a few % off. Enter both sides, or use the level camera.' };
}

export interface MeasuredPiece extends QuadMeasure {
  suggestion: ReturnType<typeof snapSuggestion>;
}

export function measureAll(quads: Quad[], map: PlaneMap): MeasuredPiece[] {
  return quads.map((q) => {
    const m = measureQuad(q, map);
    return { ...m, suggestion: snapSuggestion(m.widthMm, m.heightMm) };
  });
}

/** Pixel size of the straightened crop for a piece: true aspect, long edge ≤ maxPx. */
export function cropSize(widthMm: Mm, heightMm: Mm, quad: Quad, maxPx = 1600): { width: number; height: number } {
  // Don't upsample beyond the source: use the quad's own longest side as a cap.
  const srcLong = Math.max(...quad.map((p, i) => dist(p, quad[(i + 1) % 4]!)));
  const long = Math.max(64, Math.min(maxPx, Math.round(srcLong)));
  const k = long / Math.max(widthMm, heightMm);
  return { width: Math.max(1, Math.round(widthMm * k)), height: Math.max(1, Math.round(heightMm * k)) };
}

/** A default quad for "add a missing piece": centred, 25% of the image. */
export function defaultQuad(w: number, h: number): Quad {
  const s = Math.min(w, h) * 0.25;
  const cx = w / 2, cy = h / 2;
  return [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]];
}

/** Assign preset W×H to a reference so the long side matches the quad's long side. */
export function orientPreset(quad: Quad, a: Mm, b: Mm): { widthMm: Mm; heightMm: Mm } {
  const [tl, tr, br, bl] = quad;
  const wide = dist(tl, tr) + dist(bl, br) >= dist(tl, bl) + dist(tr, br);
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return wide ? { widthMm: hi, heightMm: lo } : { widthMm: lo, heightMm: hi };
}
