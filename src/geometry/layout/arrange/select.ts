// Choose which pieces go together ("mix" mode). Pure, seeded.
import type { Mm } from '../../../domain/types.ts';
import { shuffle } from './rng.ts';
import type { ArrangePiece, Zone } from './types.ts';
import { zoneArea } from './zone.ts';

/** Total art area as a share of the target zone (spec "Suggest a set", applied to the art zone). */
export const FILL_MIN = 0.35;
export const FILL_MAX = 0.5;
/** Largest piece's area / smallest piece's area allowed in one set (avoids a postage stamp next to a poster). */
export const MAX_AREA_RATIO = 10;
export const MAX_PIECES = 9;

const area = (p: ArrangePiece): Mm => p.w * p.h;

/**
 * Pick a set of pieces whose total area lands in [FILL_MIN, FILL_MAX] of the
 * zone, starting from a seeded "hero" (biased towards larger pieces).
 * Locked pieces are always included. Returns null if nothing sensible fits.
 */
export function selectSet(pool: readonly ArrangePiece[], zone: Zone, r: () => number): ArrangePiece[] | null {
  const za = zoneArea(zone);
  const locked = pool.filter((p) => p.locked);
  const free = pool.filter((p) => !p.locked && p.w <= zone.usable.w && p.h <= zone.usable.h);
  if (!free.length && !locked.length) return null;

  const set: ArrangePiece[] = [...locked];
  let total = set.reduce((s, p) => s + area(p), 0);

  // Hero: weighted towards bigger pieces that don't exceed the fill alone.
  const heroCands = free.filter((p) => area(p) <= za * FILL_MAX);
  if (!set.length && heroCands.length) {
    const weights = heroCands.map((p) => Math.sqrt(area(p)));
    let pick = r() * weights.reduce((a, b) => a + b, 0);
    let hero = heroCands[0]!;
    for (const [i, p] of heroCands.entries()) {
      pick -= weights[i]!;
      if (pick <= 0) {
        hero = p;
        break;
      }
    }
    set.push(hero);
    total += area(hero);
  }

  for (const p of shuffle(free, r)) {
    if (set.length >= MAX_PIECES || total >= za * FILL_MIN) break;
    if (set.includes(p)) continue;
    if (total + area(p) > za * FILL_MAX) continue;
    const areas = [...set, p].map(area);
    if (Math.max(...areas) / Math.min(...areas) > MAX_AREA_RATIO) continue;
    set.push(p);
    total += area(p);
  }
  // A single piece is a fine suggestion only when it fills the zone well.
  if (set.length === 0) return null;
  return set;
}
