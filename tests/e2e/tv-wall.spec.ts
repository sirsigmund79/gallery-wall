import { expect, test } from '@playwright/test';
import { TV, WALL, WINDOW, addPiece, addWallWithDoor, clickImagePoint } from './fixtures.ts';

test.use({ locale: 'en-US', hasTouch: false, isMobile: false });

/** Read the first wall's current layout straight from IndexedDB (mm). */
async function layoutRects(page: import('@playwright/test').Page) {
  return page.evaluate(
    () =>
      new Promise<{ rects: { x: number; y: number; w: number; h: number }[]; keepOut: { x: number; y: number; w: number; h: number; kind?: string }[] }>((resolve, reject) => {
        const req = indexedDB.open('hangplan');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['walls', 'pieces'], 'readonly');
          const walls = tx.objectStore('walls').getAll();
          const pieces = tx.objectStore('pieces').getAll();
          tx.oncomplete = () => {
            const w = walls.result[0];
            const layout = [...w.layouts].sort((a: { updatedAt: number }, b: { updatedAt: number }) => b.updatedAt - a.updatedAt)[0];
            const byId = new Map(pieces.result.map((p: { id: string }) => [p.id, p]));
            resolve({
              rects: layout.placements.map((pl: { pieceId: string; x: number; y: number }) => {
                const p = byId.get(pl.pieceId) as unknown as { widthMm: number; heightMm: number };
                return { x: pl.x, y: pl.y, w: p.widthMm, h: p.heightMm };
              }),
              keepOut: w.keepOut ?? [],
            });
          };
        };
      }),
  );
}

test('TV wall: tag the TV and a window, then suggestions sit above the TV and clear of both', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  for (const [n, w, h] of [['A', '16', '20'], ['B', '11', '14'], ['C', '11', '14'], ['D', '8', '10'], ['E', '12', '12']] as const) await addPiece(page, n, w, h);
  await addWallWithDoor(page, { tv: true });

  // Suggest first nudges towards tagging.
  await page.getByRole('button', { name: 'Suggest' }).click();
  await page.getByRole('link', { name: /Tell us what’s on this wall/ }).click();
  await expect(page.getByText('Tap things on the wall')).toBeVisible({ timeout: 60_000 });

  // The TV is recognised as a likely TV: one tap to confirm.
  await clickImagePoint(page, TV.x + TV.w / 2, TV.y + TV.h / 2, WALL.widthPx, WALL.heightPx);
  await page.getByRole('button', { name: 'It’s a TV: keep art off it' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  // The window: keep art off → Window.
  await clickImagePoint(page, WINDOW.x + WINDOW.w / 2, WINDOW.y + WINDOW.h / 2, WALL.widthPx, WALL.heightPx);
  await page.getByRole('radio', { name: 'Keep art off this' }).click();
  await page.getByRole('radio', { name: 'Window' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('button', { name: 'Suggest' }).click();
  await expect(page.getByRole('link', { name: /Tell us what’s on this wall/ })).toHaveCount(0);
  const cards = page.getByRole('button', { name: /^Use suggestion/ });
  await expect(cards.first()).toBeVisible({ timeout: 20_000 });
  await cards.first().click();
  await page.waitForTimeout(700); // autosave

  const { rects, keepOut } = await layoutRects(page);
  expect(rects.length).toBeGreaterThan(0);
  const tv = keepOut.find((k) => k.kind === 'tv')!;
  const win = keepOut.find((k) => k.kind === 'window')!;
  expect(tv).toBeTruthy();
  expect(win).toBeTruthy();
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const r of rects) {
    expect(overlaps(r, tv)).toBe(false);
    expect(overlaps(r, win)).toBe(false);
    expect(r.y + r.h).toBeLessThanOrEqual(tv.y - 200); // ≥ 8 in (203 mm) above the TV, with rounding
  }
  // Centred over the TV.
  const x0 = Math.min(...rects.map((r) => r.x)), x1 = Math.max(...rects.map((r) => r.x + r.w));
  expect(Math.abs((x0 + x1) / 2 - (tv.x + tv.w / 2))).toBeLessThan(150);
});
