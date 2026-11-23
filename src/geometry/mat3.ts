// 3×3 matrices (row-major, length 9) and 3-vectors. Pure.
export type Mat3 = number[];
export type Vec3 = [number, number, number];

export const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array<number>(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
  return r;
}

export function transpose(m: Mat3): Mat3 {
  return [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
}

export function det(m: Mat3): number {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

export function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const D = det(m);
  if (Math.abs(D) < 1e-15) throw new Error('Singular matrix');
  return [
    (e * i - f * h) / D, (c * h - b * i) / D, (b * f - c * e) / D,
    (f * g - d * i) / D, (a * i - c * g) / D, (c * d - a * f) / D,
    (d * h - e * g) / D, (b * g - a * h) / D, (a * e - b * d) / D,
  ];
}

/** Apply a homography to a 2D point. */
export function applyH(h: Mat3, p: readonly [number, number]): [number, number] {
  const x = h[0]! * p[0] + h[1]! * p[1] + h[2]!;
  const y = h[3]! * p[0] + h[4]! * p[1] + h[5]!;
  const w = h[6]! * p[0] + h[7]! * p[1] + h[8]!;
  return [x / w, y / w];
}

export const translation = (tx: number, ty: number): Mat3 => [1, 0, tx, 0, 1, ty, 0, 0, 1];
export const scaling = (sx: number, sy = sx): Mat3 => [sx, 0, 0, 0, sy, 0, 0, 0, 1];

/** Normalise so h[8] = 1 (when possible). */
export function normalizeH(h: Mat3): Mat3 {
  const s = h[8]!;
  return Math.abs(s) > 1e-12 ? h.map((v) => v / s) : h;
}

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  return [a[0] / n, a[1] / n, a[2] / n];
}
export const scale3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Matrix with the given vectors as columns. */
export const fromColumns = (x: Vec3, y: Vec3, z: Vec3): Mat3 => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];

export function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}
