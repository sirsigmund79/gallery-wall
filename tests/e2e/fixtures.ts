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

/**
 * Synthetic straight-down floor photo: three framed pieces and an A4 sheet on a
 * textured floor, 1.6 px per mm. Drawn in the browser; nothing committed.
 */
export const FLOOR = {
  pxPerMm: 1.6,
  width: 1800,
  height: 1350,
  pieces: [
    { name: 'black 16x20', x: 80, y: 90, w: 406.4, h: 508, frame: '#1c1c1c', inner: '#ece6d8' },
    { name: 'wood 11x14', x: 560, y: 120, w: 279.4, h: 355.6, frame: '#b08850', inner: '#3d5f8c' },
    { name: 'white 8x10', x: 600, y: 540, w: 203.2, h: 254, frame: '#f4f2ee', inner: '#a03a2c' },
  ],
  a4: { x: 900, y: 130, w: 210, h: 297 },
};

export async function floorPhotoPng(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate((F) => {
    const c = document.createElement('canvas');
    c.width = F.width;
    c.height = F.height;
    const g = c.getContext('2d')!;
    let seed = 42;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    g.fillStyle = '#9a7653';
    g.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < c.height; y += 5) {
      const v = 120 + Math.round(r() * 40);
      g.strokeStyle = `rgb(${v + 30},${v},${v - 40})`;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(c.width, y + (r() - 0.5) * 12);
      g.stroke();
    }
    const k = F.pxPerMm;
    for (const p of F.pieces) {
      g.fillStyle = p.frame;
      g.fillRect(p.x * k, p.y * k, p.w * k, p.h * k);
      const b = Math.min(p.w, p.h) * 0.12 * k;
      g.fillStyle = p.inner;
      g.fillRect(p.x * k + b, p.y * k + b, p.w * k - 2 * b, p.h * k - 2 * b);
    }
    g.fillStyle = '#fbfbf8';
    g.fillRect(F.a4.x * k, F.a4.y * k, F.a4.w * k, F.a4.h * k);
    return c.toDataURL('image/png');
  }, FLOOR);
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

/** Click a point given in image pixels on a PhotoMarkup of an image w×h. */
export async function clickImagePoint(page: Page, x: number, y: number, w: number, h: number) {
  const box = (await page.locator('.markup svg').boundingBox())!;
  await page.mouse.click(box.x + (x / w) * box.width, box.y + (y / h) * box.height);
}

/** Add a piece by hand (US units). */
export async function addPiece(page: Page, name: string, w: string, h: string) {
  await page.goto('/#/art/new');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Width').fill(w);
  await page.getByLabel('Height').fill(h);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/#\/art$/);
}

/** Add the synthetic wall with the new flow: tap the door, "Door 36 × 80 in", confirm the floor. */
export async function addWallWithDoor(page: Page, opts: { name?: string; room?: string } = {}) {
  await page.goto('/#/walls/new');
  await page.locator('input[type=file]').setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: await wallPhotoPng(page) });
  await page.getByText('Tap something you know the size of').waitFor({ timeout: 60_000 });
  await clickImagePoint(page, (WALL.door.x1 + WALL.door.x2) / 2, (WALL.door.top + WALL.door.bottom) / 2, WALL.widthPx, WALL.heightPx);
  await page.getByRole('button', { name: 'I know its size' }).click();
  await page.getByRole('button', { name: 'Door 36 × 80 in' }).click();
  await page.getByText('Is the green line the floor?').waitFor();
  await page.getByRole('button', { name: 'Yes' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Name').waitFor({ timeout: 30_000 });
  if (opts.name) await page.getByLabel('Name').fill(opts.name);
  if (opts.room) {
    const chip = page.getByRole('radio', { name: opts.room });
    if (await chip.count()) await chip.click();
    else {
      await page.getByRole('button', { name: '+ New room' }).click();
      await page.getByLabel('New room name').fill(opts.room);
    }
  }
  await page.getByRole('button', { name: 'Start arranging' }).click();
  await page.getByRole('button', { name: 'Add art' }).waitFor();
}
