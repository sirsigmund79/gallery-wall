import type { Mm } from '../../../domain/types.ts';
import type { Rect } from '../rect.ts';

export type Style = 'row' | 'grid' | 'salon' | 'symmetric';
export type StyleChoice = Style | 'any';

export interface ArrangePiece {
  id: string;
  w: Mm;
  h: Mm;
  /** Fixed position (locked in the editor). Always kept, never moved. */
  locked?: { x: Mm; y: Mm };
}

export interface WallSpec {
  bounds: { left: Mm; top: Mm; right: Mm; bottom: Mm };
  floorY?: Mm;
  ceilingY?: Mm;
  /** No art here: doors, windows, a TV (spec §6.6 keepOut). */
  keepOut?: Rect[];
}

export interface ArrangeInput {
  wall: WallSpec;
  /** Candidate pieces. 'mix' picks a subset; 'rearrange' uses all of them. */
  pool: ArrangePiece[];
  mode: 'mix' | 'rearrange';
  style: StyleChoice;
  gap: Mm;
  seed: number;
  /** Number of variants to return. */
  count?: number;
}

export interface Placed {
  id: string;
  x: Mm;
  y: Mm;
}

export interface Variant {
  style: Style;
  placements: Placed[];
  score: number;
  /** Per-term scores, for tests and tuning. */
  terms: Record<string, number>;
}

export interface Zone {
  /** Where art may go (wall minus margins). */
  usable: Rect;
  /** Where the group's centre should sit. */
  target: { x: Mm; y: Mm };
  /** Ideal overall width of the group. */
  targetWidth: Mm;
  /** Ideal overall height of the group. */
  targetHeight: Mm;
  /** Areas art must not cover. */
  keepOut: Rect[];
}
