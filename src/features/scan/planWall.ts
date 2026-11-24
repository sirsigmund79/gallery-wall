// "Plan this wall": turn a scan of art hanging on a wall into a wall, with the
// pieces where they really hang. Reuses the scan's calibration, so there's no
// second photo or measurement. The photo itself is never altered.
import { cloneImage, cvCall, rgbaToBlob } from '../../cv/client.ts';
import type { RGBAImage } from '../../cv/types.ts';
import { info } from '../../diag/log.ts';
import { newId } from '../../db/ids.ts';
import { getPiece, putBlob, saveWall, savePiece } from '../../db/repo.ts';
import type { CalibrationRecord, Mm, Wall } from '../../domain/types.ts';
import { applyH } from '../../geometry/mat3.ts';
import type { PlaneMap, Quad } from '../../geometry/quad.ts';
import { ringColour } from '../../media/colour.ts';
import { resizeToBlob, THUMB_MAX_PX } from '../../media/image.ts';
import { planRectify, warpIsPlausible } from '../walls/wallMath.ts';

export interface ScannedOnWall {
  pieceId: string;
  quad: Quad;
  widthMm: Mm;
  heightMm: Mm;
}

export interface PlanWallInput {
  img: RGBAImage;
  plane: PlaneMap;
  pieces: ScannedOnWall[];
  name: string;
  room: string;
  capture: Wall['capture'];
}

export const AS_IT_HANGS = 'As it hangs now';
export const NEW_PLAN = 'New plan';

/** Creates the wall and returns its id and the id of the layout to open. */
export async function planWallFromScan(input: PlanWallInput): Promise<{ wallId: string; layoutId: string }> {
  const { img, plane } = input;
  let rect: RGBAImage = img;
  let k: number;
  let toRect: (p: [number, number]) => [number, number];
  let homography: number[] | undefined;
  const H = plane.kind === 'homography' ? plane.H : null;
  const affine = H !== null && Math.abs(H[6]!) < 1e-12 && Math.abs(H[7]!) < 1e-12;
  if (H && affine) {
    // Level-camera photo with a scale-only fit: keep the photo exactly as taken.
    k = 1 / Math.sqrt(Math.abs(H[0]! * H[4]! - H[1]! * H[3]!));
    toRect = (p) => p;
  } else if (H) {
    const plan = planRectify(H, img.width, img.height);
    if (!plan || !warpIsPlausible(H, img.width, img.height)) throw new Error('Could not straighten this photo. Try the level camera, facing the wall.');
    const copy = cloneImage(img);
    rect = await cvCall('warp', { img: copy, H: plan.H, width: plan.width, height: plan.height }, [copy.data.buffer]);
    k = plan.pxPerMm;
    toRect = (p) => applyH(plan.H, p);
    homography = plan.H;
  } else {
    k = (plane as { pxPerMm: number }).pxPerMm;
    toRect = (p) => p;
  }

  const copy = cloneImage(rect);
  const floorPx = await cvCall('floorLine', { img: copy }, [copy.data.buffer]);

  const spots = input.pieces.map((p) => {
    const q = p.quad.map(toRect);
    const cx = q.reduce((s, c) => s + c[0], 0) / 4 / k;
    const cy = q.reduce((s, c) => s + c[1], 0) / 4 / k;
    const x = cx - p.widthMm / 2, y = cy - p.heightMm / 2;
    const color = ringColour(rect, { x: x * k, y: y * k, w: p.widthMm * k, h: p.heightMm * k }, Math.max(4, 8 * k), Math.max(6, 15 * k));
    return { pieceId: p.pieceId, x, y, w: p.widthMm, h: p.heightMm, color };
  });

  const blob = await rgbaToBlob(rect, 0.92);
  const bmp = await createImageBitmap(blob);
  const thumbBlob = (await resizeToBlob(bmp, THUMB_MAX_PX, 0.8)).blob;
  bmp.close();
  const originalBlob = rect === img ? blob : await rgbaToBlob(img, 0.92);
  const [original, rectified, thumb] = await Promise.all([putBlob(originalBlob), putBlob(blob), putBlob(thumbBlob)]);

  const first = spots[0];
  const calibration: CalibrationRecord = {
    method: homography ? 'rect' : 'measure',
    measurements: first ? [{ p: [first.x * k, first.y * k], q: [(first.x + first.w) * k, first.y * k], lengthMm: first.w }] : [],
    pxPerMm: k,
    homography,
    spreadPct: 0,
    quality: homography || affine ? 'good' : 'check',
  };
  const now = Date.now();
  const placements = spots.map((s) => ({ pieceId: s.pieceId, x: s.x, y: s.y }));
  const hangs = { id: newId(), name: AS_IT_HANGS, placements, createdAt: now, updatedAt: now };
  const plan = { id: newId(), name: NEW_PLAN, placements: placements.map((p) => ({ ...p })), createdAt: now, updatedAt: now + 1 };
  const wall: Wall = {
    id: newId(),
    name: input.name,
    room: input.room,
    photo: { original, rectified, widthPx: rect.width, heightPx: rect.height },
    thumb,
    capture: input.capture,
    calibration,
    bounds: { left: 0, top: 0, right: rect.width / k, bottom: rect.height / k },
    datums: { floorY: floorPx !== null ? floorPx / k : undefined },
    currentSpots: spots,
    foreground: [],
    layouts: [hangs, plan],
    createdAt: now,
    updatedAt: now,
  };
  await saveWall(wall);
  for (const s of spots) {
    const p = await getPiece(s.pieceId);
    if (p && p.status !== 'hung') await savePiece({ ...p, status: 'hung' });
  }
  info(`Plan this wall: created "${wall.name}" with ${spots.length} piece(s) where they hang (${homography ? 'straightened' : 'scale only'})`);
  return { wallId: wall.id, layoutId: plan.id };
}
