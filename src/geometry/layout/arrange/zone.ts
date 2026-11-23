// Where on the wall a group of art should go. Pure.
import type { Mm } from '../../../domain/types.ts';
import { inToMm } from '../../units.ts';
import type { Rect } from '../rect.ts';
import type { WallSpec, Zone } from './types.ts';

/** Keep art at least this far from the wall's sides and the ceiling. */
export const SIDE_MARGIN_MM = inToMm(6);
/** …and this far above the floor line (when marked). */
export const FLOOR_MARGIN_MM = inToMm(8);
/** Centre of a group at eye level above the floor (spec §6.5). */
export const EYE_LEVEL_MM = inToMm(57);
/** A group looks best spanning about this share of the usable width. */
export const TARGET_WIDTH_FRAC = 0.66;
/** Target group proportions: slightly wider than tall. */
export const TARGET_ASPECT = 1.4;

/**
 * The widest stretch of wall (left to right) not blocked by a keep-out that
 * reaches into the band where art would hang. Returns [x0, x1].
 */
export function widestFreeSpan(x0: Mm, x1: Mm, bandTop: Mm, bandBottom: Mm, keepOut: Rect[]): [Mm, Mm] {
  const blocks = keepOut
    .filter((k) => k.y < bandBottom && k.y + k.h > bandTop)
    .map((k) => [Math.max(x0, k.x - SIDE_MARGIN_MM), Math.min(x1, k.x + k.w + SIDE_MARGIN_MM)] as [Mm, Mm])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let best: [Mm, Mm] = [x0, x0];
  let cur = x0;
  for (const [a, b] of [...blocks, [x1, x1] as [Mm, Mm]]) {
    if (a - cur > best[1] - best[0]) best = [cur, a];
    cur = Math.max(cur, b);
  }
  return best;
}

export function artZone(wall: WallSpec): Zone {
  const b = wall.bounds;
  const top = Math.max(b.top, wall.ceilingY ?? -Infinity) + SIDE_MARGIN_MM;
  const bottom = wall.floorY !== undefined ? Math.min(b.bottom, wall.floorY - FLOOR_MARGIN_MM) : b.bottom - SIDE_MARGIN_MM;
  const left = b.left + SIDE_MARGIN_MM;
  const right = b.right - SIDE_MARGIN_MM;
  const usable = { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
  // Aim the group at the widest clear stretch (e.g. beside a door, not across it).
  const eye = wall.floorY !== undefined ? wall.floorY - EYE_LEVEL_MM : (top + bottom) / 2;
  const [s0, s1] = widestFreeSpan(left, right, eye - usable.h * 0.25, eye + usable.h * 0.25, wall.keepOut ?? []);
  const span = s1 - s0 > 0 ? s1 - s0 : usable.w;
  const targetWidth = span * TARGET_WIDTH_FRAC;
  const targetHeight = Math.min(usable.h * 0.8, targetWidth / TARGET_ASPECT);
  const cx = s1 - s0 > 0 ? (s0 + s1) / 2 : (left + right) / 2;
  const cy0 = eye;
  // Keep a group of the target height inside the usable area.
  const half = Math.min(targetHeight, usable.h) / 2;
  const cy = Math.min(bottom - half, Math.max(top + half, cy0));
  return { usable, target: { x: cx, y: cy }, targetWidth, targetHeight, keepOut: wall.keepOut ?? [] };
}

export const zoneArea = (z: Zone): Mm => z.targetWidth * z.targetHeight;
