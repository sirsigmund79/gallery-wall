// Rectangle (art piece) detection and perspective warps, on OpenCV.js.
// Single-sheet approach adapted from jscanify / opencv-document-scanner (MIT):
// edges -> contours -> polygon approximation. Extended here to find many
// pieces per photo, with a second (threshold) pass, rectangularity fallback,
// de-duplication and nesting removal.
import type { Mat3 } from '../geometry/mat3.ts';
import { bboxContains, bboxIoU, isConvex, orderQuad, polygonArea, type Quad } from '../geometry/quad.ts';
import type { Pt } from '../geometry/vec.ts';
import { refineQuadScored } from './refine.ts';
import type { CV, Mat, RGBAImage } from './types.ts';

/** Detection runs on a downscaled copy with this long edge. */
export const DETECT_MAX_PX = 1200;
/** Ignore candidates smaller than this fraction of the image. */
export const MIN_AREA_FRAC = 0.004;
/** …or larger (that's the floor/background). */
export const MAX_AREA_FRAC = 0.85;
/** Contour area / its min-area rectangle, to accept non-4-point contours. */
export const MIN_RECTANGULARITY = 0.88;
/** Reject slivers: shortest side under this fraction of the image's long edge… */
export const MIN_SIDE_FRAC = 0.03;
/** …or sides more unequal than this (wood grain, floorboard gaps, skirting). */
export const MAX_ASPECT = 6;

interface Candidate {
  quad: Quad;
  area: number;
  score: number;
}

/** Size limits for candidates. Walls need smaller ones (switch plates, outlets). */
export interface Limits {
  minAreaFrac: number;
  minSideFrac: number;
}
const FLOOR_LIMITS: Limits = { minAreaFrac: MIN_AREA_FRAC, minSideFrac: MIN_SIDE_FRAC };
const WALL_LIMITS: Limits = { minAreaFrac: 0.0005, minSideFrac: 0.015 };

function plausible(q: Quad, longEdge: number, lim: Limits): boolean {
  const sides = q.map((p, i) => Math.hypot(q[(i + 1) % 4]![0] - p[0], q[(i + 1) % 4]![1] - p[1]));
  const min = Math.min(...sides);
  return min >= longEdge * lim.minSideFrac && Math.max(...sides) / min <= MAX_ASPECT;
}

function contourToCandidate(cv: CV, cnt: Mat, imgArea: number, longEdge: number, lim: Limits): Candidate | null {
  const c = rawCandidate(cv, cnt, imgArea, lim);
  return c && plausible(c.quad, longEdge, lim) ? c : null;
}

function rawCandidate(cv: CV, cnt: Mat, imgArea: number, lim: Limits): Candidate | null {
  const area = cv.contourArea(cnt);
  if (area < imgArea * lim.minAreaFrac || area > imgArea * MAX_AREA_FRAC) return null;
  const peri = cv.arcLength(cnt, true);
  const approx = new cv.Mat();
  try {
    for (const eps of [0.015, 0.025, 0.04]) {
      cv.approxPolyDP(cnt, approx, eps * peri, true);
      if (approx.rows === 4) {
        const pts: Pt[] = [];
        for (let i = 0; i < 4; i++) pts.push([approx.data32S[i * 2], approx.data32S[i * 2 + 1]]);
        const quad = orderQuad(pts);
        if (isConvex(quad)) return { quad, area: polygonArea(quad), score: area / polygonArea(quad) };
      }
    }
  } finally {
    approx.delete();
  }
  // Fallback: rotated bounding rectangle when the contour is rectangular enough
  // (rounded corners, a shadow along one side…).
  const rr = cv.minAreaRect(cnt);
  const rectArea = rr.size.width * rr.size.height;
  if (rectArea > 0 && area / rectArea >= MIN_RECTANGULARITY) {
    const pts = cv.RotatedRect.points(rr).map((p: { x: number; y: number }) => [p.x, p.y] as Pt);
    const quad = orderQuad(pts);
    return { quad, area: rectArea, score: (area / rectArea) * 0.98 };
  }
  return null;
}

function collect(cv: CV, bin: Mat, out: Candidate[], mode = cv.RETR_LIST, lim: Limits = FLOOR_LIMITS) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const imgArea = bin.rows * bin.cols;
  const longEdge = Math.max(bin.rows, bin.cols);
  try {
    cv.findContours(bin, contours, hierarchy, mode, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const cand = contourToCandidate(cv, c, imgArea, longEdge, lim);
      if (cand) out.push(cand);
      c.delete();
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
}

/** Keep the best of overlapping duplicates, then drop quads nested inside others (mats, prints inside frames). */
export function dedupe(cands: Candidate[], keepNested = false): Quad[] {
  const sorted = [...cands].sort((a, b) => b.score - a.score || b.area - a.area);
  const kept: Candidate[] = [];
  for (const c of sorted) {
    const dup = kept.findIndex((k) => bboxIoU(k.quad, c.quad) > 0.7);
    if (dup < 0) kept.push(c);
    else if (c.area > kept[dup]!.area * 1.02 && c.score > kept[dup]!.score - 0.05) kept[dup] = c; // prefer the outer edge of a frame
  }
  // On the floor, a quad inside another is a mat or the print inside a frame:
  // drop it. On a wall it may be a switch plate inside a panel: keep it.
  const outer = keepNested ? kept : kept.filter((c) => !kept.some((o) => o !== c && o.area > c.area * 1.05 && bboxContains(o.quad, c.quad)));
  // Reading order: top-to-bottom rows, then left-to-right.
  return outer
    .map((c) => c.quad)
    .sort((a, b) => {
      const ay = (a[0][1] + a[2][1]) / 2, by = (b[0][1] + b[2][1]) / 2;
      const ah = a[2][1] - a[0][1];
      return Math.abs(ay - by) > ah / 2 ? ay - by : a[0][0] - b[0][0];
    });
}

/** Optional hook for tests/tuning: sees every candidate before de-duplication. */
export type DetectDebug = (cands: { quad: Quad; score: number; support: number }[]) => void;

/** Find rectangular pieces in an image. Returns quads in the input image's pixel coordinates. */
export function detectQuads(cv: CV, img: RGBAImage, debug?: DetectDebug, opts: { keepNested?: boolean } = {}): Quad[] {
  const src = cv.matFromImageData(img);
  const small = new cv.Mat();
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const edges = new cv.Mat();
  const bin = new cv.Mat();
  const fullGray = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  try {
    const k = Math.min(1, DETECT_MAX_PX / Math.max(img.width, img.height));
    cv.resize(src, small, new cv.Size(Math.round(img.width * k), Math.round(img.height * k)), 0, 0, cv.INTER_AREA);
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    const cands: Candidate[] = [];
    const lim = opts.keepNested ? WALL_LIMITS : FLOOR_LIMITS;

    // Pass 0 (most robust for art on a floor): pixels that differ from the
    // floor colour, estimated from the photo's border. Handles textured floors
    // where edges are broken up by grain.
    floorMask(cv, small, bin);
    collect(cv, bin, cands, cv.RETR_EXTERNAL, lim);

    // Pass 0b: on a textured floor (wood grain, carpet), smooth regions stand
    // out even when a frame is the same colour as the floor.
    if (smoothMask(cv, gray, bin)) collect(cv, bin, cands, cv.RETR_EXTERNAL, lim);

    // Pass 1: Canny edges, closed so frame outlines become single contours.
    // Fixed gradient thresholds: brightness-scaled ("auto") thresholds get too
    // insensitive on bright walls, missing white frames on pale paint.
    cv.Canny(blur, edges, CANNY_LO, CANNY_HI);
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);
    collect(cv, edges, cands, cv.RETR_LIST, lim);

    // Pass 2: Otsu threshold, both polarities (dark art on light floor and vice versa).
    cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.morphologyEx(bin, bin, cv.MORPH_OPEN, kernel, new cv.Point(-1, -1), 2);
    collect(cv, bin, cands, cv.RETR_LIST, lim);
    cv.bitwise_not(bin, bin);
    collect(cv, bin, cands, cv.RETR_LIST, lim);

    // Snap every candidate to the true edges at full resolution (detection ran
    // downscaled and the masks are blurred), and score it by how well real
    // edges support its sides. Duplicates from different passes then converge
    // and the best-supported one wins.
    cv.cvtColor(src, fullGray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(fullGray, fullGray, new cv.Size(3, 3), 0);
    const g = { data: fullGray.data as Uint8Array, width: img.width, height: img.height };
    const radius = Math.max(8, Math.ceil(6 / k));
    const refined = cands.map((c) => {
      const r = refineQuadScored(g, c.quad.map(([x, y]) => [x / k, y / k]) as Quad, { radius });
      return { quad: r.quad, area: polygonArea(r.quad), score: c.score + r.support, support: r.support };
    });
    debug?.(refined.map(({ quad, score, support }) => ({ quad, score, support })));
    return dedupe(refined, opts.keepNested);
  } finally {
    [src, small, gray, blur, edges, bin, kernel, fullGray].forEach((m) => m.delete());
  }
}

/** Fraction of the image width/height treated as "floor" when sampling its colour. */
const BORDER_FRAC = 0.04;

/**
 * Binary mask (255 = not floor) by colour distance in Lab from the floor colour,
 * sampled along the image border. Threshold adapts to how varied the floor is.
 */
function floorMask(cv: CV, rgba: Mat, out: Mat) {
  const rgb = new cv.Mat();
  const lab = new cv.Mat();
  const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  try {
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    cv.GaussianBlur(rgb, rgb, new cv.Size(7, 7), 0);
    cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
    const W = lab.cols, H = lab.rows;
    const d: Uint8Array = lab.data;
    const bw = Math.max(2, Math.round(W * BORDER_FRAC));
    const bh = Math.max(2, Math.round(H * BORDER_FRAC));
    const L: number[] = [], A: number[] = [], B: number[] = [];
    for (let y = 0; y < H; y += 3)
      for (let x = 0; x < W; x += 3) {
        if (x >= bw && x < W - bw && y >= bh && y < H - bh) continue;
        const i = (y * W + x) * 3;
        L.push(d[i]!); A.push(d[i + 1]!); B.push(d[i + 2]!);
      }
    const med = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1] ?? 0;
    const fl = med(L), fa = med(A), fb = med(B);
    // Lightness differences count for less than colour (shadows, grain).
    const dist = (i: number) => Math.hypot((d[i]! - fl) * 0.6, d[i + 1]! - fa, d[i + 2]! - fb);
    const borderD: number[] = [];
    for (let y = 0; y < H; y += 3)
      for (let x = 0; x < W; x += 3) {
        if (x >= bw && x < W - bw && y >= bh && y < H - bh) continue;
        borderD.push(dist((y * W + x) * 3));
      }
    // Robust spread (median + scaled MAD): the border is mostly background, but
    // may include a strip of floor, skirting or furniture, which must not
    // inflate the threshold.
    borderD.sort((a, b) => a - b);
    const medD = borderD[borderD.length >> 1] ?? 0;
    const dev = borderD.map((v) => Math.abs(v - medD)).sort((a, b) => a - b);
    const mad = dev[dev.length >> 1] ?? 0;
    const thr = Math.max(14, medD + 6 * 1.4826 * mad);
    detectStats.colourThreshold = thr;
    out.create(H, W, cv.CV_8UC1);
    const o: Uint8Array = out.data;
    for (let p = 0, i = 0; p < W * H; p++, i += 3) o[p] = dist(i) > thr ? 255 : 0;
    cv.morphologyEx(out, out, cv.MORPH_OPEN, k, new cv.Point(-1, -1), 1);
    cv.morphologyEx(out, out, cv.MORPH_CLOSE, k, new cv.Point(-1, -1), 3);
  } finally {
    [rgb, lab, k].forEach((m) => m.delete());
  }
}

/** Canny hysteresis thresholds (on the blurred 8-bit image). */
const CANNY_LO = 25;
const CANNY_HI = 70;

/** Numbers from the last detection run, for tuning and tests. */
export const detectStats: Record<string, number> = {};

/** Box size for local texture, px (at detection resolution). */
const TEXTURE_BOX = 15;
/** Floors with less texture than this (mean |Laplacian|) are "plain": skip the pass. */
const MIN_FLOOR_TEXTURE = 6;

/**
 * Binary mask (255 = smooth) of regions much smoother than the floor, which is
 * sampled along the border. Returns false when the floor itself is smooth.
 */
function smoothMask(cv: CV, gray: Mat, out: Mat): boolean {
  const lap = new cv.Mat();
  const tex = new cv.Mat();
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(TEXTURE_BOX, TEXTURE_BOX));
  try {
    cv.Laplacian(gray, lap, cv.CV_16S, 3);
    cv.convertScaleAbs(lap, lap);
    cv.boxFilter(lap, tex, -1, new cv.Size(TEXTURE_BOX, TEXTURE_BOX));
    const W = tex.cols, H = tex.rows;
    const d: Uint8Array = tex.data;
    const bw = Math.max(2, Math.round(W * BORDER_FRAC));
    const bh = Math.max(2, Math.round(H * BORDER_FRAC));
    const border: number[] = [];
    for (let y = 0; y < H; y += 3)
      for (let x = 0; x < W; x += 3) if (x < bw || x >= W - bw || y < bh || y >= H - bh) border.push(d[y * W + x]!);
    border.sort((a, b) => a - b);
    const floorTex = border[border.length >> 1] ?? 0;
    const floorP5 = border[Math.floor(border.length * 0.05)] ?? 0;
    detectStats.floorTexture = floorTex;
    if (floorTex < MIN_FLOOR_TEXTURE) return false;
    // Below nearly all of the floor (its 5th percentile), so scattered smooth
    // floor spots stay small and don't join up with the pieces.
    const thr = Math.max(2, Math.min(floorTex * 0.35, floorP5 * 0.5));
    detectStats.smoothThreshold = thr;
    cv.threshold(tex, out, thr, 255, cv.THRESH_BINARY_INV);
    cv.morphologyEx(out, out, cv.MORPH_OPEN, k, new cv.Point(-1, -1), 1);
    // The box filter eats about half a box into each smooth region; give it back.
    cv.dilate(out, out, cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(TEXTURE_BOX, TEXTURE_BOX)), new cv.Point(-1, -1), 1);
    return true;
  } finally {
    [lap, tex, k].forEach((m) => m.delete());
  }
}


/** 3×3 homography mapping four source points onto four destination points (OpenCV). */
export function perspectiveTransform(cv: CV, src: readonly Pt[], dst: readonly Pt[]): Mat3 {
  const a = cv.matFromArray(4, 1, cv.CV_32FC2, src.flat());
  const b = cv.matFromArray(4, 1, cv.CV_32FC2, dst.flat());
  const M = cv.getPerspectiveTransform(a, b);
  try {
    return Array.from(M.data64F as Float64Array);
  } finally {
    [a, b, M].forEach((m) => m.delete());
  }
}

/** Warp an image by H into an outW × outH image. */
export function warpImage(cv: CV, img: RGBAImage, H: Mat3, outW: number, outH: number): RGBAImage {
  const src = cv.matFromImageData(img);
  const dst = new cv.Mat();
  const M = cv.matFromArray(3, 3, cv.CV_64F, H);
  try {
    cv.warpPerspective(src, dst, M, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
    return { data: new Uint8ClampedArray(dst.data), width: outW, height: outH };
  } finally {
    [src, dst, M].forEach((m) => m.delete());
  }
}

/** Crop and straighten one quad into an outW × outH rectangle. */
export function rectifyQuad(cv: CV, img: RGBAImage, quad: Quad, outW: number, outH: number): RGBAImage {
  const H = perspectiveTransform(cv, quad, [[0, 0], [outW, 0], [outW, outH], [0, outH]]);
  return warpImage(cv, img, H, outW, outH);
}

/** Long edge of the image used for floor-line detection. */
const FLOOR_MAX_PX = 1000;

/**
 * Suggest where the floor meets the wall in a levelled wall photo: the
 * strongest long, near-horizontal edge in the lower part of the image
 * (skirting bottom, floor/wall boundary). Returns y in input pixels, or null.
 */
export function suggestFloorLine(cv: CV, img: RGBAImage, region: 'floor' | 'ceiling' = 'floor'): number | null {
  const src = cv.matFromImageData(img);
  const small = new cv.Mat();
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const lines = new cv.Mat();
  try {
    const k = Math.min(1, FLOOR_MAX_PX / Math.max(img.width, img.height));
    const W = Math.round(img.width * k), H = Math.round(img.height * k);
    cv.resize(src, small, new cv.Size(W, H), 0, 0, cv.INTER_AREA);
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 15, 45); // ceilings meet walls at low contrast
    cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 60, W * 0.2, 15);
    // Sum the length of near-horizontal segments per 4 px band, in the lower 55%.
    const band = 4;
    const score = new Map<number, number>();
    const d: Int32Array = lines.data32S;
    for (let i = 0; i < lines.rows; i++) {
      const [x1, y1, x2, y2] = [d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!, d[i * 4 + 3]!];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const angle = (Math.abs(Math.atan2(y2 - y1, x2 - x1)) * 180) / Math.PI;
      if (Math.min(angle, 180 - angle) > 4) continue;
      const y = (y1 + y2) / 2;
      if (region === 'floor' ? y < H * 0.45 || y > H * 0.985 : y > H * 0.4 || y < H * 0.015) continue;
      const b = Math.round(y / band);
      score.set(b, (score.get(b) ?? 0) + len);
    }
    let best: [number, number] | null = null;
    for (const [b, s] of score) if (!best || s > best[1] || (s === best[1] && (region === 'floor' ? b > best[0] : b < best[0]))) best = [b, s];
    if (!best || best[1] < W * 0.3) return null;
    return (best[0] * band) / k;
  } finally {
    [src, small, gray, edges, lines].forEach((m) => m.delete());
  }
}

export interface Doorway {
  quad: Quad;
  /** False when the door's top is cut off by the photo's top edge (width-only reference). */
  topVisible: boolean;
}

/**
 * Doorways in a levelled wall photo: pairs of long near-vertical edges that
 * reach down to the floor (or the photo's bottom), standing door-width apart
 * (0.3–0.55 of their height). Works when the top of the door is out of frame,
 * where rectangle detection can't.
 */
export function detectDoorways(cv: CV, img: RGBAImage, floorY: number | null): Doorway[] {
  const src = cv.matFromImageData(img);
  const small = new cv.Mat();
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const lines = new cv.Mat();
  try {
    const k = Math.min(1, FLOOR_MAX_PX / Math.max(img.width, img.height));
    const W = Math.round(img.width * k), H = Math.round(img.height * k);
    cv.resize(src, small, new cv.Size(W, H), 0, 0, cv.INTER_AREA);
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 30, 90);
    cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 60, H * 0.3, 20);
    const floor = floorY !== null ? floorY * k : H;
    // Merge near-vertical segments into lines by x (6 px buckets).
    const byX = new Map<number, { x: number; y0: number; y1: number; n: number }>();
    const d: Int32Array = lines.data32S;
    for (let i = 0; i < lines.rows; i++) {
      const [x1, y1, x2, y2] = [d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!, d[i * 4 + 3]!];
      const ang = (Math.abs(Math.atan2(x2 - x1, y2 - y1)) * 180) / Math.PI;
      if (Math.min(ang, 180 - ang) > 3) continue;
      const x = (x1 + x2) / 2;
      const b = Math.round(x / 6);
      const cur = byX.get(b) ?? { x: 0, y0: Infinity, y1: -Infinity, n: 0 };
      cur.x = (cur.x * cur.n + x) / (cur.n + 1);
      cur.n++;
      cur.y0 = Math.min(cur.y0, y1, y2);
      cur.y1 = Math.max(cur.y1, y1, y2);
      byX.set(b, cur);
    }
    const verts = [...byX.values()].filter((v) => v.y1 - v.y0 >= H * 0.45 && v.y1 >= floor - H * 0.06).sort((a, b) => a.x - b.x);
    const out: { d: Doorway; score: number; x0: number; x1: number }[] = [];
    for (let i = 0; i < verts.length; i++)
      for (let j = i + 1; j < verts.length; j++) {
        const a = verts[i]!, b = verts[j]!;
        const top = Math.max(a.y0, b.y0), bottom = Math.min(floor, Math.max(a.y1, b.y1));
        const h = bottom - Math.min(a.y0, b.y0);
        const w = b.x - a.x;
        if (Math.abs(a.y0 - b.y0) > h * 0.15) continue;
        const topVisible = top > H * 0.03;
        // A full door is 0.3–0.55 as wide as tall; with the top cut off it only looks narrower.
        const ratio = w / h;
        if (topVisible ? ratio < 0.3 || ratio > 0.55 : ratio < 0.2 || ratio > 0.55) continue;
        const quad: Quad = [[a.x / k, top / k], [b.x / k, top / k], [b.x / k, bottom / k], [a.x / k, bottom / k]];
        out.push({ d: { quad, topVisible }, score: (a.y1 - a.y0) + (b.y1 - b.y0), x0: a.x, x1: b.x });
      }
    // Best first; drop candidates overlapping a better one (door casings give several parallel edges).
    out.sort((p, q) => q.score - p.score);
    const kept: typeof out = [];
    for (const c of out) if (!kept.some((k2) => c.x0 < k2.x1 && k2.x0 < c.x1)) kept.push(c);
    return kept.slice(0, 2).map((c) => c.d);
  } finally {
    [src, small, gray, edges, lines].forEach((m) => m.delete());
  }
}
