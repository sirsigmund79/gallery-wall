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

/** Art sits this far above a TV or furniture (designer rule of thumb: 8–10 in). */
export const ANCHOR_GAP_MM = inToMm(8);
/** Inside a tagged panel, margins are smaller and the group fills more of it. */
export const PANEL_MARGIN_MM = inToMm(3);
export const PANEL_WIDTH_FRAC = 0.8;
/**
 * Above an anchor the group spans about this much of its width: a TV is
 * visually heavy, so art about its width (or a little wider) balances it;
 * over a sofa or console about three quarters reads best.
 */
export const ANCHOR_WIDTH_FRAC: Record<string, number> = { tv: 1.1, furniture: 0.75 };
const ANCHOR_KINDS = new Set(['tv', 'furniture']);

/**
 * Clear stretches of wall (left to right) between keep-outs that reach into
 * the band [bandTop, bandBottom], each widened by `margin`.
 */
export function freeSpans(x0: Mm, x1: Mm, bandTop: Mm, bandBottom: Mm, keepOut: Rect[], margin = SIDE_MARGIN_MM): [Mm, Mm][] {
  const blocks = keepOut
    .filter((k) => k.y < bandBottom && k.y + k.h > bandTop)
    .map((k) => [Math.max(x0, k.x - margin), Math.min(x1, k.x + k.w + margin)] as [Mm, Mm])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const out: [Mm, Mm][] = [];
  let cur = x0;
  for (const [a, b] of [...blocks, [x1, x1] as [Mm, Mm]]) {
    if (a > cur) out.push([cur, a]);
    cur = Math.max(cur, b);
  }
  return out;
}

/** The widest clear stretch (see freeSpans). */
export function widestFreeSpan(x0: Mm, x1: Mm, bandTop: Mm, bandBottom: Mm, keepOut: Rect[]): [Mm, Mm] {
  return freeSpans(x0, x1, bandTop, bandBottom, keepOut).reduce<[Mm, Mm]>((b, s) => (s[1] - s[0] > b[1] - b[0] ? s : b), [x0, x0]);
}

export function artZone(wall: WallSpec): Zone {
  const b = wall.bounds;
  const margin = wall.hangArea ? PANEL_MARGIN_MM : SIDE_MARGIN_MM;
  const keepOut = wall.keepOut ?? [];
  const top = Math.max(b.top, wall.ceilingY ?? -Infinity) + margin;
  const floorLimit = wall.floorY !== undefined && wall.floorY - FLOOR_MARGIN_MM < b.bottom - margin ? wall.floorY - FLOOR_MARGIN_MM : b.bottom - margin;
  let bottom = floorLimit;
  const left = b.left + margin;
  const right = b.right - margin;
  const wallCx = (left + right) / 2;

  // Anchors (TV, furniture) below the art: centre on the main one, bottom 8 in above it.
  const anchors = keepOut.filter((k) => ANCHOR_KINDS.has(k.kind ?? '') && k.x < right && k.x + k.w > left && k.y > top + 100);
  const main = anchors.sort(
    (a, z) => z.w * z.h * (1 - Math.abs(z.x + z.w / 2 - wallCx) / (right - left)) - a.w * a.h * (1 - Math.abs(a.x + a.w / 2 - wallCx) / (right - left)),
  )[0];
  if (main) bottom = Math.min(bottom, main.y - ANCHOR_GAP_MM);
  const usable = { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };

  if (main) {
    const ax = main.x + main.w / 2;
    const spans = freeSpans(left, right, top, bottom, keepOut.filter((k) => k !== main));
    const span = spans.find(([s0, s1]) => s0 <= ax && ax <= s1) ?? spans.reduce<[Mm, Mm]>((p, s) => (s[1] - s[0] > p[1] - p[0] ? s : p), [left, left]);
    const spanW = Math.max(0, span[1] - span[0]);
    const frac = ANCHOR_WIDTH_FRAC[main.kind ?? 'furniture'] ?? 0.75;
    const targetWidth = Math.max(Math.min(main.w * frac, spanW * 0.95), Math.min(spanW, main.w) * 0.5);
    const tx = Math.min(span[1] - targetWidth / 2, Math.max(span[0] + targetWidth / 2, ax));
    const targetHeight = Math.min(usable.h, targetWidth / TARGET_ASPECT);
    return { usable, target: { x: tx, y: bottom }, targetWidth, targetHeight, keepOut, align: 'bottom' };
  }

  // Otherwise: eye level, on the widest clear stretch.
  const eye = wall.floorY !== undefined ? wall.floorY - EYE_LEVEL_MM : (top + bottom) / 2;
  const [s0, s1] = widestFreeSpan(left, right, eye - usable.h * 0.25, eye + usable.h * 0.25, keepOut);
  const span = s1 - s0 > 0 ? s1 - s0 : usable.w;
  const targetWidth = span * (wall.hangArea ? PANEL_WIDTH_FRAC : TARGET_WIDTH_FRAC);
  const targetHeight = Math.min(usable.h * (wall.hangArea ? 0.9 : 0.8), targetWidth / TARGET_ASPECT);
  const cx = s1 - s0 > 0 ? (s0 + s1) / 2 : wallCx;
  const half = Math.min(targetHeight, usable.h) / 2;
  const cy = Math.min(bottom - half, Math.max(top + half, eye));
  return { usable, target: { x: cx, y: cy }, targetWidth, targetHeight, keepOut, align: 'centre' };
}

export const zoneArea = (z: Zone): Mm => z.targetWidth * z.targetHeight;
