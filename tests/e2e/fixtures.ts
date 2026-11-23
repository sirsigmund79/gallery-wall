import type { Page } from '@playwright/test';

/**
 * Synthetic wall photo with known geometry, drawn in the browser so no binary
 * fixture is committed. 0.5 px per mm: the image covers 4000 × 3200 mm.
 */
export const WALL = {
  pxPerMm: 0.5,
  widthPx: 2000,
  heightPx: 1600,
  // A 36 in (914.4 mm) door, left jamb at x=300 px.
  door: { x1: 300, x2: 300 + 914.4 * 0.5, top: 1500 - 2032 * 0.5, bottom: 1500 },
  floorPx: 1500,
};

export async function wallPhotoPng(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate((W) => {
    const c = document.createElement('canvas');
    c.width = W.widthPx;
    c.height = W.heightPx;
    const g = c.getContext('2d')!;
    g.fillStyle = '#e9e4da';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#8b6f4e';
    g.fillRect(0, W.floorPx, c.width, c.height - W.floorPx); // floor
    g.fillStyle = '#ffffff';
    g.fillRect(W.door.x1, W.door.top, W.door.x2 - W.door.x1, W.door.bottom - W.door.top);
    g.strokeStyle = '#555';
    g.lineWidth = 4;
    g.strokeRect(W.door.x1, W.door.top, W.door.x2 - W.door.x1, W.door.bottom - W.door.top);
    return c.toDataURL('image/png');
  }, WALL);
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

/** Screen position of an image-pixel point inside the PhotoMarkup overlay. */
export async function imageToScreen(page: Page, x: number, y: number) {
  const box = (await page.locator('.markup svg').boundingBox())!;
  return { x: box.x + (x / WALL.widthPx) * box.width, y: box.y + (y / WALL.heightPx) * box.height };
}

/** Drag a markup handle (by aria-label) to an image-pixel point. */
export async function dragHandle(page: Page, label: string, x: number, y: number) {
  const h = page.getByRole('slider', { name: label });
  const b = (await h.boundingBox())!;
  const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const to = await imageToScreen(page, x, y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}
