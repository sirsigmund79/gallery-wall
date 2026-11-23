// Hook geometry and hang-guide coordinates (spec §4 HangSpec, §6.7). Pure.
import type { HangSpec, HangType, Mm, Wall } from '../../domain/types.ts';

// Defaults are round imperial numbers (most frames are sold in inches) and still
// read cleanly in metric: 1/2 in = 12.7 mm, 3 in = 76.2 mm, 2 in = 50.8 mm.
/** Typical distance from a frame's top edge to a sawtooth hanger's notch. */
export const SAWTOOTH_DROP_MM = 12.7;
export const DEFAULT_WIRE_DROP_MM = 76.2;
export const DEFAULT_DRING_INSET_MM = 50.8;
export const DEFAULT_DRING_DROP_MM = 76.2;

/** User-editable parameters behind each hang type. */
export interface HangParams {
  /** Top edge of the piece down to the hook point (taut-wire peak for wire). */
  dropMm: Mm;
  /** D-rings only: side edge in to each ring. */
  insetMm: Mm;
}

export function defaultHangParams(type: HangType): HangParams {
  switch (type) {
    case 'sawtooth':
      return { dropMm: SAWTOOTH_DROP_MM, insetMm: 0 };
    case 'wire':
      return { dropMm: DEFAULT_WIRE_DROP_MM, insetMm: 0 };
    case 'dring2':
      return { dropMm: DEFAULT_DRING_DROP_MM, insetMm: DEFAULT_DRING_INSET_MM };
    case 'custom':
      return { dropMm: SAWTOOTH_DROP_MM, insetMm: 0 };
  }
}

/** Build a HangSpec for a piece of width `widthMm`. */
export function makeHangSpec(type: HangType, widthMm: Mm, p: HangParams): HangSpec {
  if (type === 'dring2') {
    const a = Math.min(Math.max(0, p.insetMm), widthMm / 2);
    return { type, hooks: [{ dx: a, dy: p.dropMm }, { dx: widthMm - a, dy: p.dropMm }] };
  }
  return { type, hooks: [{ dx: widthMm / 2, dy: p.dropMm }] };
}

/** Recover editable params from a stored spec. */
export function hangParamsOf(spec: HangSpec): HangParams {
  const first = spec.hooks[0];
  if (!first) return defaultHangParams(spec.type);
  return { dropMm: first.dy, insetMm: spec.type === 'dring2' ? first.dx : 0 };
}

/** Rebuild a spec after the piece's width changes (keeps centred/inset hooks correct). */
export const resizeHangSpec = (spec: HangSpec, widthMm: Mm): HangSpec =>
  spec.type === 'custom' ? spec : makeHangSpec(spec.type, widthMm, hangParamsOf(spec));

export type VerticalDatum = 'floor' | 'ceiling' | 'top';

export interface HookPosition {
  /** Index of the hook on the piece. */
  index: number;
  /** Wall coordinates (mm from image top-left). */
  wall: { x: Mm; y: Mm };
  /** Distance right of the wall's left edge. */
  fromLeft: Mm;
  /** Distance above the floor / below the ceiling / below the wall's top bound. */
  vertical: Mm;
}

/** Datums available for a wall, best first. */
export function availableDatums(wall: Pick<Wall, 'datums'>): VerticalDatum[] {
  const out: VerticalDatum[] = [];
  if (wall.datums.floorY !== undefined) out.push('floor');
  if (wall.datums.ceilingY !== undefined) out.push('ceiling');
  out.push('top');
  return out;
}

export function hookPositions(
  placement: { x: Mm; y: Mm },
  hang: HangSpec,
  wall: Pick<Wall, 'bounds' | 'datums'>,
  datum: VerticalDatum,
): HookPosition[] {
  return hang.hooks.map((h, index) => {
    const x = placement.x + h.dx;
    const y = placement.y + h.dy;
    let vertical: Mm;
    if (datum === 'floor') vertical = (wall.datums.floorY ?? wall.bounds.bottom) - y;
    else if (datum === 'ceiling') vertical = y - (wall.datums.ceilingY ?? wall.bounds.top);
    else vertical = y - wall.bounds.top;
    return { index, wall: { x, y }, fromLeft: x - wall.bounds.left, vertical };
  });
}

export const DATUM_LABEL: Record<VerticalDatum, string> = {
  floor: 'up from floor',
  ceiling: 'down from ceiling',
  top: 'down from top of wall area',
};
