// Gravity-assisted rectification (spec §5.2). Pure.
//
// Conventions:
//  - Device frame (W3C DeviceOrientation): x right, y up, z out of the screen,
//    in the device's natural (portrait) orientation.
//  - Screen frame: same, but rotated with the current screen orientation.
//  - Camera frame (back camera): x right, y down, z forward (out of the back),
//    matching image axes. Camera frames from getUserMedia follow the screen.
import {
  cross, dot, fromColumns, invert, mul, mulVec, normalize, sub3, scale3, transpose, translation, applyH,
  type Mat3, type Vec3,
} from './mat3.ts';

const RAD = Math.PI / 180;

/** Default 35 mm-equivalent focal length of a phone's main (1×) camera. */
export const DEFAULT_F35_MM = 26;
/** Diagonal of a 35 mm frame (36 × 24 mm). */
const FULL_FRAME_DIAG_MM = 43.267;

/** Tolerances for guided capture (spec §6.1). */
export const WALL_MAX_ROLL_DEG = 3;
export const WALL_MAX_PITCH_DEG = 8;
export const FLOOR_MAX_TILT_DEG = 5;

/** Gravity direction in the device frame from DeviceOrientation β, γ (degrees). */
export function gravityDevice(betaDeg: number, gammaDeg: number): Vec3 {
  const b = betaDeg * RAD;
  const g = gammaDeg * RAD;
  return [Math.cos(b) * Math.sin(g), -Math.sin(b), -Math.cos(b) * Math.cos(g)];
}

/**
 * Device frame -> screen frame for `screen.orientation.angle` (0, 90, 180, 270/-90).
 * Angle 90 means the device is turned 90° counter-clockwise (landscape-primary).
 */
export function deviceToScreen(v: Vec3, screenAngleDeg: number): Vec3 {
  const a = (((screenAngleDeg % 360) + 360) % 360) * RAD;
  const c = Math.round(Math.cos(a) * 1e9) / 1e9;
  const s = Math.round(Math.sin(a) * 1e9) / 1e9;
  // Device axes expressed in screen coordinates are rotated by +angle.
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}

/** Screen frame -> back-camera frame (x right, y down, z forward). */
export const screenToCamera = (v: Vec3): Vec3 => [v[0], -v[1], -v[2]];

/** Unit gravity vector in the camera frame. */
export function gravityCamera(betaDeg: number, gammaDeg: number, screenAngleDeg = 0): Vec3 {
  return normalize(screenToCamera(deviceToScreen(gravityDevice(betaDeg, gammaDeg), screenAngleDeg)));
}

/** Average several gravity readings (vector mean; robust where Euler angles jump). */
export function meanGravity(gs: readonly Vec3[]): Vec3 | null {
  if (!gs.length) return null;
  const s = gs.reduce<Vec3>((a, g) => [a[0] + g[0], a[1] + g[1], a[2] + g[2]], [0, 0, 0]);
  return normalize(s);
}

export interface WallTilt {
  /** Rotation in the image plane; 0 = level. Positive = clockwise on screen. */
  rollDeg: number;
  /** Positive = camera pointing down (towards the floor). */
  pitchDeg: number;
}

export function wallTilt(g: Vec3): WallTilt {
  return {
    rollDeg: Math.atan2(-g[0], g[1]) / RAD,
    pitchDeg: Math.atan2(g[2], Math.hypot(g[0], g[1])) / RAD,
  };
}

export interface FloorTilt {
  /** Angle between the camera axis and straight down. */
  tiltDeg: number;
  /** Direction gravity leans across the image (unit-ish, for a bubble level). */
  lean: [number, number];
}

export function floorTilt(g: Vec3): FloorTilt {
  return { tiltDeg: Math.acos(Math.min(1, Math.max(-1, g[2]))) / RAD, lean: [g[0], g[1]] };
}

export const wallLevelOk = (t: WallTilt) => Math.abs(t.rollDeg) <= WALL_MAX_ROLL_DEG && Math.abs(t.pitchDeg) <= WALL_MAX_PITCH_DEG;
export const floorLevelOk = (t: FloorTilt) => t.tiltDeg <= FLOOR_MAX_TILT_DEG;

/** Focal length in pixels for an image of w×h. */
export function focalPx(w: number, h: number, f35 = DEFAULT_F35_MM): number {
  // Phone video/photo frames are 4:3 crops of the full field of view along the
  // long edge. Use that 4:3 diagonal so 16:9 frames get the same focal length.
  const long = Math.max(w, h);
  const diag = Math.hypot(long, (long * 3) / 4);
  return (f35 / FULL_FRAME_DIAG_MM) * diag;
}

export function intrinsics(w: number, h: number, f35 = DEFAULT_F35_MM): Mat3 {
  const f = focalPx(w, h, f35);
  return [f, 0, w / 2, 0, f, h / 2, 0, 0, 1];
}

export type RectifyMode = 'wall' | 'floor';

/**
 * Rotation R whose columns are the virtual (level) camera's axes in the real
 * camera frame.
 *  - wall:  virtual y along gravity (verticals vertical), virtual z as close
 *           to the real z as possible. Removes pitch and roll, keeps yaw.
 *  - floor: virtual z along gravity (looking straight down), virtual x as
 *           close to the real x as possible.
 */
export function virtualRotation(g: Vec3, mode: RectifyMode): Mat3 {
  const gn = normalize(g);
  if (mode === 'wall') {
    const y = gn;
    const z = normalize(sub3([0, 0, 1], scale3(y, dot([0, 0, 1], y))));
    const x = cross(y, z);
    return fromColumns(x, y, z);
  }
  const z = gn;
  const x = normalize(sub3([1, 0, 0], scale3(z, dot([1, 0, 0], z))));
  const y = cross(z, x);
  return fromColumns(x, y, z);
}

/** H = K · Rᵀ · K⁻¹: maps real image pixels to the level virtual camera's pixels. */
export function rectifyingHomography(g: Vec3, mode: RectifyMode, w: number, h: number, f35 = DEFAULT_F35_MM): Mat3 {
  const K = intrinsics(w, h, f35);
  return mul(mul(K, transpose(virtualRotation(g, mode))), invert(K));
}

export interface WarpPlan {
  /** Homography to pass to warpPerspective (includes the translation to the output box). */
  H: Mat3;
  width: number;
  height: number;
}

/** Largest allowed growth of the output image relative to the input. */
export const MAX_OUTPUT_GROWTH = 1.6;

/**
 * Output bounds for warping a w×h image by H, with H translated so the warped
 * image starts at (0,0). Returns null for absurd results (e.g. a corner going to
 * infinity), in which case the caller should skip rectification.
 */
export function planWarp(H: Mat3, w: number, h: number): WarpPlan | null {
  const corners: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]];
  for (const c of corners) {
    const den = H[6]! * c[0] + H[7]! * c[1] + H[8]!;
    if (den <= 1e-9) return null; // corner behind the virtual camera
  }
  const pts = corners.map((c) => applyH(H, c));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.ceil(Math.max(...xs) - minX);
  const height = Math.ceil(Math.max(...ys) - minY);
  if (!(width > 0 && height > 0) || width * height > w * h * MAX_OUTPUT_GROWTH ** 2) return null;
  return { H: mul(translation(-minX, -minY), H), width, height };
}

export { mulVec };

/**
 * Like planWarp, but crops to the largest axis-aligned rectangle inside the
 * warped image (conservative, from the warped corners), so the result has no
 * empty wedges. Empty corners would otherwise look like objects to detection
 * and spoil floor-colour sampling.
 */
export function planWarpInner(H: Mat3, w: number, h: number): WarpPlan | null {
  const full = planWarp(H, w, h);
  if (!full) return null;
  const [tl, tr, br, bl] = ([[0, 0], [w, 0], [w, h], [0, h]] as [number, number][]).map((c) => applyH(full.H, c));
  const x0 = Math.max(tl![0], bl![0]);
  const x1 = Math.min(tr![0], br![0]);
  const y0 = Math.max(tl![1], tr![1]);
  const y1 = Math.min(bl![1], br![1]);
  const width = Math.floor(x1 - x0);
  const height = Math.floor(y1 - y0);
  if (width < w * 0.5 || height < h * 0.5) return null;
  return { H: mul(translation(-Math.ceil(x0), -Math.ceil(y0)), full.H), width, height };
}
