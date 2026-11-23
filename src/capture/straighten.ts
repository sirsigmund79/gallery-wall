// Turn a guided capture into a straightened photo using gravity (spec §5.2).
import { blobToRGBA, cloneImage, cvCall, rgbaToBlob } from '../cv/client.ts';
import type { RGBAImage } from '../cv/types.ts';
import { DEFAULT_F35_MM, planWarpInner, rectifyingHomography, type RectifyMode } from '../geometry/gravity.ts';
import type { Vec3 } from '../geometry/mat3.ts';
import { EDIT_MAX_PX } from '../media/image.ts';

/** Beyond this tilt the correction is too large to trust (focal-length error grows). */
export const MAX_CORRECTION_DEG = 15;

export interface Straightened {
  img: RGBAImage;
  blob: Blob;
  /** False if no correction was applied (no gravity, or too tilted). */
  corrected: boolean;
}

function tiltFromTarget(g: Vec3, mode: RectifyMode): number {
  const target = mode === 'wall' ? g[1] : g[2];
  return (Math.acos(Math.max(-1, Math.min(1, target))) * 180) / Math.PI;
}

export async function straighten(blob: Blob, g: Vec3 | null, mode: RectifyMode, maxPx = EDIT_MAX_PX): Promise<Straightened> {
  const img = await blobToRGBA(blob, maxPx);
  if (!g || tiltFromTarget(g, mode) > MAX_CORRECTION_DEG) return { img, blob: await rgbaToBlob(img, 0.92), corrected: false };
  const H = rectifyingHomography(g, mode, img.width, img.height, DEFAULT_F35_MM);
  const plan = planWarpInner(H, img.width, img.height);
  if (!plan) return { img, blob: await rgbaToBlob(img, 0.92), corrected: false };
  const src = cloneImage(img);
  const out = await cvCall('warp', { img: src, H: plan.H, width: plan.width, height: plan.height }, [src.data.buffer]);
  return { img: out, blob: await rgbaToBlob(out, 0.92), corrected: true };
}
