// Image import: decode (honouring EXIF orientation), downscale, re-encode.

/** Long-edge cap for the editing copy (spec §8; also keeps under iOS canvas limits). */
export const EDIT_MAX_PX = 3000;
/** Long-edge cap for the stored original (spec §2). */
export const ORIGINAL_MAX_PX = 4096;
export const THUMB_MAX_PX = 400;

export interface DecodedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  let bitmap: ImageBitmap;
  try {
    // Applies EXIF orientation in current browsers.
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // Older Safari: decode via <img> (which also honours EXIF orientation).
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      bitmap = await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

export function fitSize(w: number, h: number, maxPx: number): { w: number; h: number } {
  const k = Math.min(1, maxPx / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const toBlob = (c: HTMLCanvasElement, type = 'image/jpeg', quality = 0.9) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), type, quality));

/** Draw `src` scaled to fit `maxPx` and encode as JPEG. */
export async function resizeToBlob(
  src: CanvasImageSource & { width: number; height: number },
  maxPx: number,
  quality = 0.9,
): Promise<{ blob: Blob; width: number; height: number }> {
  const { w, h } = fitSize(src.width, src.height, maxPx);
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const blob = await toBlob(c, 'image/jpeg', quality);
  c.width = c.height = 0; // release memory promptly on iOS
  return { blob, width: w, height: h };
}

export interface ImportedPhoto {
  original: { blob: Blob; width: number; height: number };
  edit: { blob: Blob; width: number; height: number };
  thumb: { blob: Blob; width: number; height: number };
}

/** Turn a user-picked file into original/edit/thumb blobs. */
export async function importPhoto(file: Blob): Promise<ImportedPhoto> {
  const { bitmap } = await decodeImage(file);
  try {
    const original = await resizeToBlob(bitmap, ORIGINAL_MAX_PX, 0.92);
    const edit = await resizeToBlob(bitmap, EDIT_MAX_PX, 0.9);
    const thumb = await resizeToBlob(bitmap, THUMB_MAX_PX, 0.8);
    return { original, edit, thumb };
  } finally {
    bitmap.close();
  }
}
