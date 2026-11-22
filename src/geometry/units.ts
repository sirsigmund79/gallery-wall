// Unit conversion and formatting. Pure; no DOM.
import type { LengthUnit, Mm } from '../domain/types.ts';

export const MM_PER_IN = 25.4;
/** Imperial display resolution: 1/16 in. */
export const INCH_DENOMINATOR = 16;

export const mmToIn = (mm: Mm): number => mm / MM_PER_IN;
export const inToMm = (inches: number): Mm => inches * MM_PER_IN;

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Inches rounded to the nearest 1/16, as whole + reduced fraction.
 * e.g. 11.4375 -> "11 7/16", 0.5 -> "1/2", 12 -> "12". Never mixes decimals.
 */
export function formatInches(inches: number, denominator = INCH_DENOMINATOR): string {
  const negative = inches < 0;
  const totalUnits = Math.round(Math.abs(inches) * denominator);
  const whole = Math.floor(totalUnits / denominator);
  let num = totalUnits % denominator;
  let den = denominator;
  if (num) {
    const g = gcd(num, den);
    num /= g;
    den /= g;
  }
  let s: string;
  if (!num) s = String(whole);
  else if (!whole) s = `${num}/${den}`;
  else s = `${whole} ${num}/${den}`;
  return negative && totalUnits ? `-${s}` : s;
}

/** Format a millimetre length for display in the user's unit, with unit suffix. */
export function formatLength(mm: Mm, unit: LengthUnit): string {
  switch (unit) {
    case 'in':
      return `${formatInches(mmToIn(mm))} in`;
    case 'cm': {
      const cm = Math.round(mm) / 10; // 1 mm resolution
      return `${Number.isInteger(cm) ? cm.toFixed(0) : cm.toFixed(1)} cm`;
    }
    case 'mm':
      return `${Math.round(mm)} mm`;
  }
}

const UNIT_ALIASES: Record<string, LengthUnit> = {
  in: 'in', inch: 'in', inches: 'in', '"': 'in', '″': 'in',
  cm: 'cm', mm: 'mm',
};

/**
 * Parse a user-typed length into millimetres. Accepts decimals and fractions
 * ("11 7/16", "11-7/16", "7/16", "11.5"), and an optional unit suffix that
 * overrides `defaultUnit` ("29.7 cm", "297mm", "11 7/16 in", `11"`).
 * Returns null if the input is not a valid positive-or-zero length.
 */
export function parseLength(input: string, defaultUnit: LengthUnit): Mm | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  let unit = defaultUnit;
  const unitMatch = s.match(/(inches|inch|in|cm|mm|"|″)$/);
  if (unitMatch) {
    unit = UNIT_ALIASES[unitMatch[1]!]!;
    s = s.slice(0, -unitMatch[1]!.length).trim();
  }
  let value: number;
  const mixed = s.match(/^(\d+)(?:\s+|-)(\d+)\s*\/\s*(\d+)$/);
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const den = Number(mixed[3]);
    if (!den) return null;
    value = Number(mixed[1]) + Number(mixed[2]) / den;
  } else if (frac) {
    const den = Number(frac[2]);
    if (!den) return null;
    value = Number(frac[1]) / den;
  } else if (/^(\d+\.?\d*|\.\d+)$/.test(s.replace(',', '.'))) {
    value = Number(s.replace(',', '.'));
  } else {
    return null;
  }
  if (!Number.isFinite(value)) return null;
  switch (unit) {
    case 'in':
      return inToMm(value);
    case 'cm':
      return value * 10;
    case 'mm':
      return value;
  }
}

/** Regions that conventionally use inches for this kind of measurement. */
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM']);

/** Default unit from a BCP-47 locale tag such as "en-US" or "fr-CA". */
export function defaultUnitForLocale(locale: string | undefined): LengthUnit {
  if (!locale) return 'cm';
  let region: string | undefined;
  try {
    region = new Intl.Locale(locale).maximize().region;
  } catch {
    region = locale.split(/[-_]/)[1]?.toUpperCase();
  }
  return region && IMPERIAL_REGIONS.has(region) ? 'in' : 'cm';
}
