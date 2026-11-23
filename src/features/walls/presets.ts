import type { Mm } from '../../domain/types.ts';

/** One-tap reference lengths for the measurement field (spec §5.3). */
export const LENGTH_PRESETS: { label: string; mm: Mm }[] = [
  { label: 'Credit card (long side)', mm: 85.6 },
  { label: 'US Letter tall', mm: 279.4 },
  { label: 'US Letter wide', mm: 215.9 },
  { label: 'A4 tall', mm: 297 },
  { label: 'A4 wide', mm: 210 },
];
