// Scale calibration from user measurements (spec §5.3–5.5). Pure.
import type { CalibrationQuality, CalibrationRecord, Mm } from '../domain/types.ts';
import { dist, median, type Pt } from './vec.ts';

export interface Measurement {
  p: Pt;
  q: Pt;
  lengthMm: Mm;
}

/** Quality thresholds on spreadPct (spec §5.4). */
export const SPREAD_GOOD_PCT = 1.5;
export const SPREAD_CHECK_PCT = 3.5;
/** A measurement within this many degrees of horizontal/vertical counts as that axis (§5.5). */
export const AXIS_TOLERANCE_DEG = 20;
/** Beyond this x/y scale disagreement, first-order correction isn't trustworthy. */
export const MAX_ANISOTROPY_PCT = 10;

export type Axis = 'h' | 'v' | 'diag';

export function axisOf(m: Pick<Measurement, 'p' | 'q'>): Axis {
  const dx = Math.abs(m.q[0] - m.p[0]);
  const dy = Math.abs(m.q[1] - m.p[1]);
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI; // 0 = horizontal, 90 = vertical
  if (deg <= AXIS_TOLERANCE_DEG) return 'h';
  if (deg >= 90 - AXIS_TOLERANCE_DEG) return 'v';
  return 'diag';
}

/** Pixels per mm implied by one measurement. */
export const impliedScale = (m: Measurement): number => dist(m.p, m.q) / m.lengthMm;

export function spreadPct(scales: readonly number[]): number {
  if (scales.length < 2) return 0;
  return ((Math.max(...scales) - Math.min(...scales)) / median(scales)) * 100;
}

export function qualityFromSpread(pct: number): CalibrationQuality {
  if (pct <= SPREAD_GOOD_PCT) return 'good';
  if (pct <= SPREAD_CHECK_PCT) return 'check';
  return 'poor';
}

export interface CaptureContext {
  /** Photo came from guided capture with gravity rectification within tolerance. */
  guided: boolean;
}

export interface CalibrationFit {
  pxPerMm: number;
  anisotropy?: { sx: number; sy: number };
  spreadPct: number;
  quality: CalibrationQuality;
  /** Short, plain-language advice for the UI, or undefined if none is needed. */
  advice?: string;
}

/** Length in mm of a pixel segment under per-axis scales. */
export const segmentMm = (p: Pt, q: Pt, sx: number, sy: number): Mm =>
  Math.hypot((q[0] - p[0]) / sx, (q[1] - p[1]) / sy);

/**
 * Fit a calibration to one or more measurements.
 *
 * - One measurement: scale from it; quality from capture conditions (§5.4).
 * - Several: isotropic median scale; spread decides quality. If measurements
 *   on both axes disagree, fit separate x/y scales (two-axis correction, §5.5)
 *   and judge quality on what remains after correction.
 */
export function fitCalibration(ms: readonly Measurement[], ctx: CaptureContext): CalibrationFit | null {
  const valid = ms.filter((m) => m.lengthMm > 0 && dist(m.p, m.q) > 0);
  if (!valid.length) return null;

  const scales = valid.map(impliedScale);
  const iso = median(scales);

  if (valid.length === 1) {
    return ctx.guided
      ? { pxPerMm: iso, spreadPct: 0, quality: 'good' }
      : {
          pxPerMm: iso,
          spreadPct: 0,
          quality: 'check',
          advice: 'Add a second measurement on the other axis to verify.',
        };
  }

  const isoSpread = spreadPct(scales);
  if (isoSpread <= SPREAD_GOOD_PCT) {
    return { pxPerMm: iso, spreadPct: isoSpread, quality: 'good' };
  }

  const h = valid.filter((m) => axisOf(m) === 'h').map(impliedScale);
  const v = valid.filter((m) => axisOf(m) === 'v').map(impliedScale);
  if (!h.length || !v.length) {
    const quality = qualityFromSpread(isoSpread);
    return {
      pxPerMm: iso,
      spreadPct: isoSpread,
      quality,
      advice:
        quality === 'poor'
          ? 'Measurements disagree a lot. Was the photo taken at an angle? Try a straighter photo.'
          : 'Add a measurement on the other axis (one across, one up-down) to correct for angle.',
    };
  }

  const sx = median(h);
  const sy = median(v);
  const residual = spreadPct(valid.map((m) => segmentMm(m.p, m.q, sx, sy) / m.lengthMm));
  const anisoPct = (Math.abs(sx - sy) / Math.min(sx, sy)) * 100;
  const fitted = { pxPerMm: sx, anisotropy: { sx, sy } };

  if (anisoPct > MAX_ANISOTROPY_PCT) {
    return {
      ...fitted,
      spreadPct: residual,
      quality: 'poor',
      advice: 'The photo looks strongly angled. Retake it facing the wall straight on.',
    };
  }
  // One measurement per axis exactly determines sx and sy, so there is nothing
  // left to check them against.
  const redundant = valid.length > 2;
  if (!redundant) {
    return {
      ...fitted,
      spreadPct: residual,
      quality: 'check',
      advice: 'Corrected for angle. Add a third measurement to confirm.',
    };
  }
  return { ...fitted, spreadPct: residual, quality: qualityFromSpread(residual) };
}

/** Per-axis px/mm of a calibration (equal unless two-axis corrected). */
export function axisScales(c: Pick<CalibrationRecord, 'pxPerMm' | 'anisotropy'>): { sx: number; sy: number } {
  return c.anisotropy ?? { sx: c.pxPerMm, sy: c.pxPerMm };
}

/** Image pixel -> wall mm. */
export function pxToMm(c: Pick<CalibrationRecord, 'pxPerMm' | 'anisotropy'>, p: Pt): Pt {
  const { sx, sy } = axisScales(c);
  return [p[0] / sx, p[1] / sy];
}

/** Wall mm -> image pixel. */
export function mmToPx(c: Pick<CalibrationRecord, 'pxPerMm' | 'anisotropy'>, p: Pt): Pt {
  const { sx, sy } = axisScales(c);
  return [p[0] * sx, p[1] * sy];
}

/** Rough ± figure to show next to a calibrated size. */
export function accuracyPct(fit: Pick<CalibrationFit, 'spreadPct' | 'quality'>): number {
  return Math.max(SPREAD_GOOD_PCT, Math.round(fit.spreadPct * 10) / 10);
}
