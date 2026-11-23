import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  deviceToScreen, floorTilt, gravityCamera, gravityDevice, intrinsics, planWarp, rectifyingHomography, virtualRotation, wallTilt,
} from './gravity.ts';
import { applyH, fromColumns, mul, mulVec, transpose, type Mat3, type Vec3 } from './mat3.ts';

const close = (a: number[], b: number[], eps = 1e-9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, -Math.log10(eps)));

describe('sensor conversions (spec §5.2 sanity checks)', () => {
  it('flat on a table, screen up: gravity is -z (device) and +z (camera)', () => {
    close(gravityDevice(0, 0), [0, 0, -1]);
    close(gravityCamera(0, 0), [0, 0, 1]);
  });
  it('upright in portrait: gravity points down the image', () => {
    close(gravityCamera(90, 0), [0, 1, 0]);
  });
  it('landscape: device turned 90° CCW maps device -y to screen +x', () => {
    // Upright in landscape-primary: gravity in device frame is +x... check via screen frame.
    close(deviceToScreen([0, -1, 0], 90), [1, 0, 0]);
    close(deviceToScreen([1, 0, 0], 90), [0, 1, 0]);
    close(deviceToScreen([1, 0, 0], -90), deviceToScreen([1, 0, 0], 270));
  });
  it('tilt readouts', () => {
    expect(wallTilt(gravityCamera(90, 0))).toEqual({ rollDeg: expect.closeTo(0, 9), pitchDeg: expect.closeTo(0, 9) });
    expect(wallTilt(gravityCamera(80, 0)).pitchDeg).toBeCloseTo(10, 6); // top tipped away: back camera points down
    expect(floorTilt(gravityCamera(0, 0)).tiltDeg).toBeCloseTo(0, 6);
    expect(floorTilt(gravityCamera(4, 0)).tiltDeg).toBeCloseTo(4, 6);
    expect(floorTilt(gravityCamera(0, -3)).tiltDeg).toBeCloseTo(3, 6);
  });
});

// Synthetic scene: a level virtual camera sees a perfect grid; the real camera
// is the virtual one rotated by Rtrue. Rectifying with the gravity seen by the
// real camera must give back an axis-aligned grid.
function rot(ax: Vec3, deg: number): Mat3 {
  const [x, y, z] = ax;
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}

function realView(Rtrue: Mat3, K: Mat3, pts: [number, number][]): [number, number][] {
  // Virtual image point -> ray -> real camera: d_real = Rtrue · d_virtual.
  const Kinv = [1 / K[0]!, 0, -K[2]! / K[0]!, 0, 1 / K[4]!, -K[5]! / K[4]!, 0, 0, 1];
  const Hvr = mul(mul(K, Rtrue), Kinv);
  return pts.map((p) => applyH(Hvr, p));
}

describe('rectifyingHomography', () => {
  const W = 4000, H = 3000;
  const K = intrinsics(W, H);
  const grid: [number, number][] = [];
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 4; j++) grid.push([800 + i * 400, 700 + j * 400]);

  // `rows`: also require horizontal rows. Wall mode keeps yaw by design, so
  // with a yaw component only verticals are guaranteed vertical.
  const check = (mode: 'wall' | 'floor', Rtrue: Mat3, gVirtual: Vec3, rows = true) => {
    const real = realView(Rtrue, K, grid);
    const gReal = mulVec(Rtrue, gVirtual); // gravity seen by the real camera
    const Hr = rectifyingHomography(gReal, mode, W, H);
    const out = real.map((p) => applyH(Hr, p));
    // Columns share x, rows share y (axis-aligned grid), within 0.05 px.
    for (let i = 0; i <= 6; i++) {
      const col = out.slice(i * 5, i * 5 + 5).map((p) => p[0]);
      expect(Math.max(...col) - Math.min(...col)).toBeLessThan(0.05);
    }
    for (let j = 0; rows && j <= 4; j++) {
      const row = [0, 1, 2, 3, 4, 5, 6].map((i) => out[i * 5 + j]![1]);
      expect(Math.max(...row) - Math.min(...row)).toBeLessThan(0.05);
    }
  };

  it('wall mode removes pitch + roll', () => {
    // Level camera facing the wall: gravity along +y. Roll ∘ pitch, no yaw.
    check('wall', mul(rot([0, 0, 1], 2.5), rot([1, 0, 0], -6)), [0, 1, 0]);
  });

  it('wall mode keeps verticals vertical even with yaw', () => {
    check('wall', mul(rot([1, 0, 0], 7), rot([0, 0, 1], -4)), [0, 1, 0], false);
    check('wall', mul(mul(rot([0, 1, 0], 15), rot([1, 0, 0], 5)), rot([0, 0, 1], 2)), [0, 1, 0], false);
  });

  it('floor mode removes tilt when shooting down', () => {
    check('floor', mul(rot([1, 0, 0], 4), rot([0, 1, 0], -3)), [0, 0, 1]);
  });

  it('property: wall mode with random pitch/roll within ±12°', () => {
    fc.assert(
      fc.property(fc.double({ min: -12, max: 12, noNaN: true }), fc.double({ min: -12, max: 12, noNaN: true }), (p, r) => {
        check('wall', mul(rot([0, 0, 1], r), rot([1, 0, 0], p)), [0, 1, 0]);
      }),
      { numRuns: 200 },
    );
  });

  it('is the identity when already level', () => {
    close(rectifyingHomography([0, 1, 0], 'wall', W, H), [1, 0, 0, 0, 1, 0, 0, 0, 1], 1e-9);
    close(rectifyingHomography([0, 0, 1], 'floor', W, H), [1, 0, 0, 0, 1, 0, 0, 0, 1], 1e-9);
  });

  it('virtual rotation is orthonormal', () => {
    const R = virtualRotation([0.1, 0.9, 0.2], 'wall');
    close(mul(transpose(R), R), [1, 0, 0, 0, 1, 0, 0, 0, 1], 1e-9);
    close(fromColumns([1, 0, 0], [0, 1, 0], [0, 0, 1]), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe('planWarp', () => {
  it('translates output into view and sizes it', () => {
    const p = planWarp([1, 0, -50, 0, 1, 20, 0, 0, 1], 100, 80)!;
    expect(p).toMatchObject({ width: 100, height: 80 });
    close(applyH(p.H, [0, 0]), [0, 0]);
  });
  it('rejects absurd warps', () => {
    expect(planWarp([1, 0, 0, 0, 1, 0, -0.02, 0, 1], 100, 100)).toBeNull(); // a corner goes behind the camera
    expect(planWarp([3, 0, 0, 0, 3, 0, 0, 0, 1], 100, 100)).toBeNull(); // grows too much
  });
});

describe('planWarpInner', () => {
  it('crops a slightly rotated warp to an inner rectangle with no empty corners', async () => {
    const { planWarpInner } = await import('./gravity.ts');
    const t = (3 * Math.PI) / 180;
    const R = [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1];
    const p = planWarpInner(R, 1000, 800)!;
    expect(p.width).toBeLessThan(1000);
    expect(p.width).toBeGreaterThan(900);
    // Every output corner maps back inside the source image.
    const inv = (await import('./mat3.ts')).invert(p.H);
    for (const c of [[0, 0], [p.width, 0], [p.width, p.height], [0, p.height]] as [number, number][]) {
      const s = applyH(inv, c);
      expect(s[0]).toBeGreaterThanOrEqual(-1e-6);
      expect(s[1]).toBeGreaterThanOrEqual(-1e-6);
      expect(s[0]).toBeLessThanOrEqual(1000 + 1e-6);
      expect(s[1]).toBeLessThanOrEqual(800 + 1e-6);
    }
  });
});
