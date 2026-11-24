// Writes a synthetic "art hanging on a wall" photo as a Y4M video, for
// Chromium's --use-file-for-fake-video-capture. Generated at test time into
// the OS temp dir; nothing binary is committed.
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ARTWALL = {
  width: 1280,
  height: 960,
  pxPerMm: 0.64,
  wall: [205, 200, 188],
  floorY: 870,
  pieces: [
    { x: 150, y: 200, wMm: 406.4, hMm: 508, frame: [25, 25, 25], inner: [235, 230, 220] },
    { x: 500, y: 230, wMm: 279.4, hMm: 355.6, frame: [120, 80, 45], inner: [70, 100, 150] },
    { x: 760, y: 250, wMm: 203.2, hMm: 254, frame: [90, 90, 95], inner: [160, 60, 50] },
  ],
  a4: { x: 1000, y: 240, wMm: 210, hMm: 297 },
};

function rgba(): Uint8ClampedArray {
  const { width: W, height: H, pxPerMm: k } = ARTWALL;
  const d = new Uint8ClampedArray(W * H * 4);
  const fill = (x0: number, y0: number, w: number, h: number, c: number[]) => {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++)
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) d.set([c[0]!, c[1]!, c[2]!, 255], (y * W + x) * 4);
  };
  fill(0, 0, W, H, ARTWALL.wall);
  fill(0, ARTWALL.floorY, W, H - ARTWALL.floorY, [125, 90, 60]);
  for (const p of ARTWALL.pieces) {
    fill(p.x, p.y, p.wMm * k, p.hMm * k, p.frame);
    const b = Math.min(p.wMm, p.hMm) * 0.12 * k;
    fill(p.x + b, p.y + b, p.wMm * k - 2 * b, p.hMm * k - 2 * b, p.inner);
  }
  fill(ARTWALL.a4.x, ARTWALL.a4.y, ARTWALL.a4.wMm * k, ARTWALL.a4.hMm * k, [250, 250, 248]);
  let seed = 7;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < d.length; i++) if (i % 4 !== 3) d[i] = d[i]! + Math.round((r() - 0.5) * 8);
  return d;
}

/** Write the Y4M file (I420, a few identical frames) and return its path. */
export function writeArtWallY4m(): string {
  return writeY4m('artwall', ARTWALL.width, ARTWALL.height, rgba());
}

/** Hallway like the owner's photo: ceiling, panel moulding with a switch plate inside, doorway cut off on the right. */
export const HALLWAY = {
  width: 1200,
  height: 1600,
  panel: { x0: 250, y0: 250, x1: 820, y1: 1250 },
  switchPlate: { x0: 760, y0: 700, x1: 800, y1: 760 },
  floorY: 1470,
};

export function writeHallwayY4m(): string {
  const { width: W, height: H } = HALLWAY;
  const d = new Uint8ClampedArray(W * H * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number, c: number[]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d.set([c[0]!, c[1]!, c[2]!, 255], (y * W + x) * 4);
  };
  const frame = (x0: number, y0: number, x1: number, y1: number, t: number, c: number[]) => {
    fill(x0, y0, x1, y0 + t, c); fill(x0, y1 - t, x1, y1, c); fill(x0, y0, x0 + t, y1, c); fill(x1 - t, y0, x1, y1, c);
  };
  fill(0, 0, W, H, [222, 214, 196]);
  fill(0, 0, W, 90, [190, 186, 180]);
  fill(0, 1380, W, 1470, [245, 245, 242]);
  fill(0, 1470, W, H, [150, 100, 55]);
  const P = HALLWAY.panel;
  frame(P.x0, P.y0, P.x1, P.y1, 12, [246, 244, 238]);
  frame(P.x0 + 12, P.y0 + 12, P.x1 - 12, P.y1 - 12, 3, [185, 178, 160]);
  const S = HALLWAY.switchPlate;
  fill(S.x0, S.y0, S.x1, S.y1, [250, 250, 250]);
  frame(S.x0, S.y0, S.x1, S.y1, 2, [160, 155, 150]);
  fill(935, 312, W, 1470, [70, 62, 55]);
  fill(900, 280, 935, 1470, [248, 248, 245]);
  fill(900, 280, W, 312, [248, 248, 245]);
  let seed = 3;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < d.length; i++) if (i % 4 !== 3) d[i] = d[i]! + Math.round((r() - 0.5) * 8);
  return writeY4m('hallway', W, H, d);
}

function writeY4m(name: string, W: number, H: number, px: Uint8ClampedArray): string {
  const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2)), V = Buffer.alloc((W / 2) * (H / 2));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const [r, g, b] = [px[i]!, px[i + 1]!, px[i + 2]!];
      Y[y * W + x] = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
      if (y % 2 === 0 && x % 2 === 0) {
        const j = (y / 2) * (W / 2) + x / 2;
        U[j] = Math.max(0, Math.min(255, Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b)));
        V[j] = Math.max(0, Math.min(255, Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b)));
      }
    }
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, U, V]);
  const file = join(tmpdir(), `hangplan-${name}-${W}x${H}.y4m`);
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`), frame, frame, frame]));
  return file;
}
