export type Pt = [number, number];

export const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function median(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
