// Placement helpers shared by the editor UI. Pure.
import type { ArtPiece, Mm, Placement, Wall } from '../../domain/types.ts';
import { overlaps, type Rect } from '../../geometry/layout/rect.ts';
import { inToMm } from '../../geometry/units.ts';

/** Default eye-level line for centring art, above the floor (spec §6.5). */
export const EYE_LEVEL_MM = inToMm(57);
/** Gap used when dropping a new piece next to existing ones (~2 in). */
export const DEFAULT_GAP_MM = inToMm(2);

type Size = Pick<ArtPiece, 'widthMm' | 'heightMm'>;

/** Centre of where new art goes: wall centre, at eye level if the floor is known. */
export function targetCentre(wall: Pick<Wall, 'bounds' | 'datums'>): { x: Mm; y: Mm } {
  const b = wall.bounds;
  return {
    x: (b.left + b.right) / 2,
    y: wall.datums.floorY !== undefined ? wall.datums.floorY - EYE_LEVEL_MM : (b.top + b.bottom) / 2,
  };
}

/** Where to drop a piece with nothing else on the wall. */
export function initialPosition(wall: Pick<Wall, 'bounds' | 'datums'>, piece: Size): { x: Mm; y: Mm } {
  const c = targetCentre(wall);
  return { x: c.x - piece.widthMm / 2, y: c.y - piece.heightMm / 2 };
}

/**
 * Drop a new piece near the target centre without covering anything already
 * placed: try the centre, then beside the existing pieces (alternating right
 * and left), then above/below. Falls back to the centre.
 */
export function freeSpot(wall: Pick<Wall, 'bounds' | 'datums'>, piece: Size, placed: Rect[], gap: Mm = DEFAULT_GAP_MM): { x: Mm; y: Mm } {
  const start = initialPosition(wall, piece);
  const me = (x: Mm, y: Mm): Rect => ({ x, y, w: piece.widthMm, h: piece.heightMm });
  const free = (r: Rect) => !placed.some((o) => overlaps(r, o, 0.01));
  if (free(me(start.x, start.y))) return start;

  const c = targetCentre(wall);
  const cands: { x: Mm; y: Mm }[] = [];
  for (const o of placed) {
    const midY = o.y + o.h / 2 - piece.heightMm / 2;
    const midX = o.x + o.w / 2 - piece.widthMm / 2;
    cands.push(
      { x: o.x + o.w + gap, y: midY },
      { x: o.x - gap - piece.widthMm, y: midY },
      { x: midX, y: o.y - gap - piece.heightMm },
      { x: midX, y: o.y + o.h + gap },
    );
  }
  // Closest to the target centre first; prefer staying inside the wall.
  const b = wall.bounds;
  const inside = (p: { x: Mm; y: Mm }) => p.x >= b.left && p.y >= b.top && p.x + piece.widthMm <= b.right && p.y + piece.heightMm <= b.bottom;
  const d = (p: { x: Mm; y: Mm }) => Math.hypot(p.x + piece.widthMm / 2 - c.x, p.y + piece.heightMm / 2 - c.y);
  const ok = cands.filter((p) => free(me(p.x, p.y))).sort((a, z) => Number(inside(z)) - Number(inside(a)) || d(a) - d(z));
  return ok[0] ?? start;
}

export function fitsWall(wall: Pick<Wall, 'bounds'>, piece: Size): boolean {
  const b = wall.bounds;
  return piece.widthMm <= b.right - b.left && piece.heightMm <= b.bottom - b.top;
}

/** Current spots whose piece is not at that spot in this layout (moved or removed). */
export function movedSpots(wall: Pick<Wall, 'currentSpots'>, placements: Placement[], tol: Mm = 5) {
  return (wall.currentSpots ?? []).filter((sp) => {
    const pl = placements.find((p) => p.pieceId === sp.pieceId);
    return !pl || Math.abs(pl.x - sp.x) > tol || Math.abs(pl.y - sp.y) > tol;
  });
}
