import { expect, test } from '@playwright/test';
import { WALL, addPiece, dragHandle, wallPhotoPng } from './fixtures.ts';

test.use({ locale: 'en-US', hasTouch: false, isMobile: false });

test('suggest mixes library art into layouts that fit; apply, undo and shuffle', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  for (const [n, w, h] of [['A', '16', '20'], ['B', '16', '20'], ['C', '11', '14'], ['D', '11', '14'], ['E', '24', '18']] as const) await addPiece(page, n, w, h);

  // A wall from the synthetic photo, calibrated on the 36 in door.
  await page.goto('/#/walls/new');
  await page.locator('input[type=file]:not([capture])').setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: await wallPhotoPng(page) });
  await dragHandle(page, 'Measurement 1 start', WALL.door.x1, 1200);
  await dragHandle(page, 'Measurement 1 end', WALL.door.x2, 1200);
  await page.getByLabel('Real length of line #1').fill('36');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Mark the floor line').check();
  await dragHandle(page, 'Floor line', 800, WALL.floorPx);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Save and start arranging' }).click();

  await page.getByRole('button', { name: 'Suggest' }).click();
  const cards = page.getByRole('button', { name: /^Use suggestion/ });
  await expect(cards.first()).toBeVisible({ timeout: 20_000 });
  expect(await cards.count()).toBeGreaterThanOrEqual(3);
  const before = await cards.evaluateAll((els) => els.map((e) => e.querySelector('svg')!.innerHTML).join());

  await page.getByRole('button', { name: 'Shuffle' }).click();
  await expect.poll(async () => cards.evaluateAll((els) => els.map((e) => e.querySelector('svg')!.innerHTML).join()), { timeout: 20_000 }).not.toBe(before);

  // Apply the first suggestion, then check the hang guide lists its pieces.
  const label = (await cards.first().getAttribute('aria-label'))!;
  const count = Number(/, (\d+) piece/.exec(label)![1]);
  await cards.first().click();
  const emptyHint = page.getByText(/or “Suggest” for ideas/);
  await expect(emptyHint).toBeHidden();

  // One undo removes the whole suggestion; redo brings it back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(emptyHint).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(emptyHint).toBeHidden();

  await page.waitForTimeout(600); // autosave
  await page.getByRole('link', { name: 'Hang guide' }).click();
  await expect(page.locator('tbody tr.first')).toHaveCount(count);
});
