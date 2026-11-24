import { beforeAll, describe, expect, it } from 'vitest';
import { applyH, invert, type Mat3 } from '../geometry/mat3.ts';
import { measureQuad, similarityFit, type Quad } from '../geometry/quad.ts';
import { dist, type Pt } from '../geometry/vec.ts';
import { detectDoorways, detectQuads, perspectiveTransform, rectifyQuad, suggestFloorLine } from './detect.ts';
import { loadCvForTests } from '../../tests/cv.ts';
import type { CV, RGBAImage } from './types.ts';

let cv: CV;
beforeAll(async () => {
  ({ cv } = await loadCvForTests());
}, 30_000);

/** Seeded PRNG so fixtures are deterministic. */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

interface Piece {
  /** Position and size on the floor, mm. */
  x: number; y: number; w: number; h: number;
  frame: [number, number, number];
  inner?: [number, number, number];
}

/**
 * Render a floor (wood-grain-ish texture) with framed pieces, as seen through
 * `Hmm2px` (floor mm -> image px), with mild noise. Synthetic: nothing committed.
 */
function scene(W: number, H: number, Hmm2px: Mat3, pieces: Piece[], seed = 1): RGBAImage {
  const r = rng(seed);
  const m = new cv.Mat(H, W, cv.CV_8UC4, new cv.Scalar(150, 110, 75, 255));
  // Grain: thin horizontal-ish stripes of varying brightness.
  for (let y = 0; y < H; y += 6) {
    const v = 130 + Math.round(r() * 40);
    cv.line(m, new cv.Point(0, y), new cv.Point(W, y + Math.round((r() - 0.5) * 20)), new cv.Scalar(v + 20, v - 15, v - 50, 255), 2);
  }
  const poly = (pts: Pt[], color: [number, number, number]) => {
    const mat = cv.matFromArray(4, 1, cv.CV_32SC2, pts.flatMap((p) => [Math.round(p[0]), Math.round(p[1])]));
    const v = new cv.MatVector();
    v.push_back(mat);
    cv.fillPoly(m, v, new cv.Scalar(color[0], color[1], color[2], 255));
    v.delete();
    mat.delete();
  };
  const project = (x: number, y: number, w: number, h: number): Pt[] =>
    [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map((p) => applyH(Hmm2px, p as Pt));
  for (const p of pieces) {
    poly(project(p.x, p.y, p.w, p.h), p.frame);
    if (p.inner) {
      const b = Math.min(p.w, p.h) * 0.12;
      poly(project(p.x + b, p.y + b, p.w - 2 * b, p.h - 2 * b), p.inner);
    }
  }
  // Sensor noise (±8 per channel).
  const data = new Uint8ClampedArray(m.data);
  for (let i = 0; i < data.length; i++) if (i % 4 !== 3) data[i] = data[i]! + Math.round((r() - 0.5) * 16);
  const out = { data, width: W, height: H };
  m.delete();
  return out;
}

const PIECES: Piece[] = [
  { x: 100, y: 100, w: 406.4, h: 508, frame: [20, 20, 20], inner: [230, 225, 210] },   // 16×20 in, black frame, white mat
  { x: 620, y: 140, w: 279.4, h: 355.6, frame: [190, 150, 90], inner: [60, 90, 140] }, // 11×14 in, wood frame
  { x: 1020, y: 90, w: 297, h: 210, frame: [245, 245, 240] },                          // A4 landscape, white
  { x: 640, y: 620, w: 609.6, h: 457.2, frame: [35, 35, 40], inner: [180, 60, 50] },  // 24×18 in
];

/** Mild perspective: floor 1500×1150 mm into a 1600×1200 image, top edge farther away. */
const SRC_MM: Pt[] = [[0, 0], [1500, 0], [1500, 1150], [0, 1150]];
const DST_PX: Pt[] = [[90, 60], [1510, 40], [1560, 1170], [40, 1150]];

function truthQuads(H: Mat3): Quad[] {
  return PIECES.map((p) => [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]].map((q) => applyH(H, q as Pt)) as Quad);
}

function matchQuad(found: Quad[], truth: Quad): Quad | undefined {
  return found.find((f) => f.every((c, i) => dist(c, truth[i]!) < 12));
}

describe('detectQuads (synthetic floor photo)', () => {
  it('finds every piece (outer frame edge) and nothing else', () => {
    const H = perspectiveTransform(cv, SRC_MM, DST_PX);
    const img = scene(1600, 1200, H, PIECES);
    const found = detectQuads(cv, img);
    const truth = truthQuads(H);
    for (const t of truth) expect(matchQuad(found, t), `missing piece at ${t[0]}`).toBeDefined();
    expect(found).toHaveLength(PIECES.length);
  });

  // Imported (tilted) photo: full perspective from one small reference far from
  // some pieces. Error grows with distance from the reference; spec allows 4%.
  it('tilted photo: measures every piece within 1.5% from one small reference', () => {
    const H = perspectiveTransform(cv, SRC_MM, DST_PX);
    const img = scene(1600, 1200, H, PIECES, 7);
    const found = detectQuads(cv, img);
    // Reference: the A4 sheet, both dimensions known.
    const ref = matchQuad(found, truthQuads(H)[2]!)!;
    const plane = perspectiveTransform(cv, ref, [[0, 0], [297, 0], [297, 210], [0, 210]]);
    for (const [i, p] of PIECES.entries()) {
      const q = matchQuad(found, truthQuads(H)[i]!)!;
      const m = measureQuad(q, { kind: 'homography', H: plane });
      expect(Math.abs(m.widthMm - p.w) / p.w).toBeLessThan(0.015);
      expect(Math.abs(m.heightMm - p.h) / p.h).toBeLessThan(0.015);
      expect(m.confidence).not.toBe('low');
    }
  });

  // Straight-down photo (guided capture after gravity rectification): fit only
  // scale + rotation to the reference, so nothing is extrapolated.
  it('straight-down photo: measures every piece within 0.5% from one small reference', () => {
    const k = 0.95; // px per mm
    const H = [k, 0, 60, 0, k, 50, 0, 0, 1];
    const img = scene(1600, 1200, H, PIECES, 11);
    const found = detectQuads(cv, img);
    const ref = matchQuad(found, truthQuads(H)[2]!)!;
    const plane = similarityFit(ref, [[0, 0], [297, 0], [297, 210], [0, 210]]);
    for (const [i, p] of PIECES.entries()) {
      const q = matchQuad(found, truthQuads(H)[i]!);
      expect(q, `piece ${i}`).toBeDefined();
      const m = measureQuad(q!, { kind: 'homography', H: plane });
      expect(Math.abs(m.widthMm - p.w) / p.w).toBeLessThan(0.005);
      expect(Math.abs(m.heightMm - p.h) / p.h).toBeLessThan(0.005);
      expect(m.confidence).toBe('high');
    }
  });

  it('returns nothing on an empty floor', () => {
    const H = perspectiveTransform(cv, SRC_MM, DST_PX);
    expect(detectQuads(cv, scene(1600, 1200, H, [], 3))).toEqual([]);
  });
});

describe('detectQuads (art hanging on a wall)', () => {
  it('finds framed pieces on a painted wall, ignoring the floor strip along the bottom', () => {
    // Wall 2400 × 1700 mm with mild side-on perspective (photographer a little to the left).
    const H = perspectiveTransform(cv, [[0, 0], [2400, 0], [2400, 1700], [0, 1700]], [[60, 70], [1540, 30], [1560, 1180], [40, 1150]]);
    const wallPieces: Piece[] = [
      { x: 500, y: 350, w: 609.6, h: 457.2, frame: [25, 25, 25], inner: [235, 230, 220] },
      { x: 1250, y: 300, w: 406.4, h: 508, frame: [180, 140, 90], inner: [70, 100, 150] },
      { x: 1250, y: 880, w: 406.4, h: 304.8, frame: [240, 240, 236], inner: [150, 60, 50] },
    ];
    const r = rng(5);
    const W = 1600, Himg = 1200;
    const m = new cv.Mat(Himg, W, cv.CV_8UC4, new cv.Scalar(205, 200, 188, 255)); // painted wall
    const poly = (pts: Pt[], c: [number, number, number]) => {
      const mat = cv.matFromArray(4, 1, cv.CV_32SC2, pts.flatMap((p) => [Math.round(p[0]), Math.round(p[1])]));
      const v = new cv.MatVector();
      v.push_back(mat);
      cv.fillPoly(m, v, new cv.Scalar(c[0], c[1], c[2], 255));
      v.delete();
      mat.delete();
    };
    const proj = (x: number, y: number, w: number, h: number) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map((p) => applyH(H, p as Pt));
    // Floor strip and skirting across the bottom of the photo.
    poly([[0, 1130], [W, 1090], [W, Himg], [0, Himg]], [120, 85, 55]);
    for (const p of wallPieces) {
      poly(proj(p.x, p.y, p.w, p.h), p.frame);
      if (p.inner) {
        const b = Math.min(p.w, p.h) * 0.12;
        poly(proj(p.x + b, p.y + b, p.w - 2 * b, p.h - 2 * b), p.inner);
      }
    }
    const data = new Uint8ClampedArray(m.data);
    m.delete();
    for (let i = 0; i < data.length; i++) if (i % 4 !== 3) data[i] = data[i]! + Math.round((r() - 0.5) * 12);
    const found = detectQuads(cv, { data, width: W, height: Himg });
    const truth = wallPieces.map((p) => proj(p.x, p.y, p.w, p.h) as Quad);
    for (const t of truth) expect(matchQuad(found, t), `missing piece at ${t[0]}`).toBeDefined();
    expect(found).toHaveLength(wallPieces.length);
  });
});

describe('perspective helpers', () => {
  it('perspectiveTransform maps the four points exactly', () => {
    const H = perspectiveTransform(cv, SRC_MM, DST_PX);
    SRC_MM.forEach((p, i) => {
      const q = applyH(H, p);
      expect(q[0]).toBeCloseTo(DST_PX[i]![0], 3);
      expect(q[1]).toBeCloseTo(DST_PX[i]![1], 3);
    });
    const back = applyH(invert(H), DST_PX[2]!);
    expect(back[0]).toBeCloseTo(1500, 3);
  });

  it('rectifyQuad straightens a piece into a rectangle', () => {
    const H = perspectiveTransform(cv, SRC_MM, DST_PX);
    const img = scene(1600, 1200, H, PIECES);
    const out = rectifyQuad(cv, img, truthQuads(H)[0]!, 400, 500);
    expect(out.width).toBe(400);
    // Centre of the crop is the white mat; corners are the black frame.
    const px = (x: number, y: number) => out.data[(y * 400 + x) * 4]!;
    expect(px(200, 250)).toBeGreaterThan(190);
    expect(px(8, 8)).toBeLessThan(70);
  });
});

describe('suggestFloorLine', () => {
  function wallWithFloor(floorY: number | null, seed: number): RGBAImage {
    const r = rng(seed);
    const W = 1600, H = 1200;
    const m = new cv.Mat(H, W, cv.CV_8UC4, new cv.Scalar(210, 205, 195, 255));
    if (floorY !== null) {
      cv.rectangle(m, new cv.Point(0, floorY - 60), new cv.Point(W, floorY), new cv.Scalar(245, 245, 242, 255), -1); // skirting
      cv.rectangle(m, new cv.Point(0, floorY), new cv.Point(W, H), new cv.Scalar(125, 90, 60, 255), -1); // floor
    }
    // A framed picture and a door: vertical/horizontal clutter higher up.
    cv.rectangle(m, new cv.Point(300, 200), new cv.Point(700, 600), new cv.Scalar(30, 30, 30, 255), -1);
    cv.rectangle(m, new cv.Point(1100, 150), new cv.Point(1450, floorY ?? 1150), new cv.Scalar(250, 250, 250, 255), -1);
    const data = new Uint8ClampedArray(m.data);
    m.delete();
    for (let i = 0; i < data.length; i++) if (i % 4 !== 3) data[i] = data[i]! + Math.round((r() - 0.5) * 10);
    return { data, width: W, height: H };
  }
  it('finds where the skirting meets the floor', () => {
    const y = suggestFloorLine(cv, wallWithFloor(1020, 1));
    expect(y).not.toBeNull();
    expect(Math.abs(y! - 1020)).toBeLessThan(8);
  });
  it('returns null when there is no floor in view', () => {
    expect(suggestFloorLine(cv, wallWithFloor(null, 2))).toBeNull();
  });
});

/** Hallway wall like the owner's photo: ceiling, panel moulding with a switch inside, doorway on the right, floor. */
function hallway(seed: number): RGBAImage {
  const r = rng(seed);
  const W = 1400, H = 1600;
  const m = new cv.Mat(H, W, cv.CV_8UC4, new cv.Scalar(222, 214, 196, 255));
  const rect = (x0: number, y0: number, x1: number, y1: number, c: number[], t = -1) =>
    cv.rectangle(m, new cv.Point(x0, y0), new cv.Point(x1, y1), new cv.Scalar(c[0], c[1], c[2], 255), t);
  rect(0, 0, W, 90, [190, 186, 180]); // ceiling
  rect(0, 1380, W, 1470, [245, 245, 242]); // skirting
  rect(0, 1470, W, H, [150, 100, 55]); // floor
  // Panel moulding: raised outline (light) with a shadow line.
  rect(250, 250, 820, 1250, [246, 244, 238], 10);
  rect(262, 262, 808, 1238, [185, 178, 160], 2);
  // Switch plate inside the panel, near its right edge.
  rect(760, 700, 800, 760, [250, 250, 250]);
  rect(760, 700, 800, 760, [170, 165, 160], 2);
  // Doorway on the right: casing (white) both sides, dark opening between, reaching the floor.
  rect(935, 312, 1335, 1470, [70, 62, 55]); // opening (room beyond), ~0.34 wide-to-tall
  rect(900, 280, 935, 1470, [248, 248, 245]); // left casing
  rect(1335, 280, 1370, 1470, [248, 248, 245]); // right casing
  rect(900, 280, 1370, 312, [248, 248, 245]); // head casing
  const data = new Uint8ClampedArray(m.data);
  m.delete();
  for (let i = 0; i < data.length; i++) if (i % 4 !== 3) data[i] = data[i]! + Math.round((r() - 0.5) * 8);
  return { data, width: W, height: H };
}

describe('wall features (hallway)', () => {
  it('keeps the switch plate inside the panel moulding when keepNested is on', () => {
    const img = hallway(1);
    const near = (q: Quad, x0: number, y0: number, x1: number, y1: number, tol = 14) =>
      Math.abs(q[0][0] - x0) < tol && Math.abs(q[0][1] - y0) < tol && Math.abs(q[2][0] - x1) < tol && Math.abs(q[2][1] - y1) < tol;
    const wall = detectQuads(cv, img, undefined, { keepNested: true });
    expect(wall.some((q) => near(q, 245, 245, 825, 1255))).toBe(true); // panel
    expect(wall.some((q) => near(q, 760, 700, 800, 760, 6))).toBe(true); // switch
    // Floor mode (default) drops it, as before.
    expect(detectQuads(cv, img).some((q) => near(q, 760, 700, 800, 760, 6))).toBe(false);
  });
  it('finds the floor and ceiling lines', () => {
    const img = hallway(2);
    expect(Math.abs(suggestFloorLine(cv, img, 'floor')! - 1470)).toBeLessThan(10);
    expect(Math.abs(suggestFloorLine(cv, img, 'ceiling')! - 90)).toBeLessThan(10);
  });
  it('finds the doorway from its vertical edges', () => {
    const img = hallway(3);
    const doors = detectDoorways(cv, img, 1470);
    expect(doors.length).toBeGreaterThan(0);
    const d = doors[0]!;
    const w = d.quad[1][0] - d.quad[0][0];
    expect(d.quad[0][0]).toBeGreaterThan(880);
    expect(d.quad[1][0]).toBeLessThan(1390);
    expect(w).toBeGreaterThan(380);
    expect(d.quad[2][1]).toBeGreaterThan(1440);
  });
});
