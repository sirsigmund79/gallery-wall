import { expect, test } from '@playwright/test';
import { FLOOR, clickImagePoint, floorPhotoPng } from './fixtures.ts';

test.use({ locale: 'en-US', hasTouch: false, isMobile: false });

test('scan several pieces from one photo, using an A4 sheet as the size reference', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/#/art');
  await page.getByRole('link', { name: 'Scan art' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'floor.png', mimeType: 'image/png', buffer: await floorPhotoPng(page) });

  // Detection (first run also loads OpenCV in the worker).
  await expect(page.getByText(/Found\s+4\s+shapes/)).toBeVisible({ timeout: 60_000 });

  // Tap the A4 sheet and use it as the reference.
  const k = FLOOR.pxPerMm;
  // The scan stores the photo downscaled to ≤3000 px; this fixture is smaller, so 1:1.
  await clickImagePoint(page, (FLOOR.a4.x + FLOOR.a4.w / 2) * k, (FLOOR.a4.y + FLOOR.a4.h / 2) * k, FLOOR.width, FLOOR.height);
  await page.getByRole('button', { name: 'I know this one’s size' }).click();
  await page.getByRole('button', { name: 'A4 sheet' }).click();
  await expect(page.getByLabel('It’s only a reference (don’t add it to my art)')).toBeChecked();

  await page.getByRole('button', { name: 'Measure 3 pieces' }).click();
  await expect(page.getByRole('heading', { name: 'Check sizes' })).toBeVisible({ timeout: 30_000 });

  // Each piece is recognised as its standard size.
  for (const label of ['16 × 20 in', '11 × 14 in', '8 × 10 in']) {
    await expect(page.getByRole('button', { name: `Use ${label}` })).toBeVisible();
  }
  // The 16 × 20 in piece measures within 1/8 in.
  const hints = (await page.locator('.result .hint').allTextContents()).join(' ');
  expect(hints).toMatch(/Measured (15 7\/8|15 15\/16|16|16 1\/16|16 1\/8) in × (19 7\/8|19 15\/16|20|20 1\/16|20 1\/8) in/);

  await page.getByRole('button', { name: 'Use 16 × 20 in' }).click();
  await page.getByLabel('Name').first().fill('Big print');
  await page.getByRole('button', { name: 'Add 3 pieces to library' }).click();

  await expect(page).toHaveURL(/#\/art$/);
  await expect(page.getByText('Big print')).toBeVisible();
  await expect(page.getByText('16 in × 20 in')).toBeVisible();
  await expect(page.locator('.tile img')).toHaveCount(3); // each has its cropped photo

  // A second scan continues the numbering instead of starting at "Piece 1" again.
  await page.getByRole('link', { name: 'Scan art' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'floor.png', mimeType: 'image/png', buffer: await floorPhotoPng(page) });
  await expect(page.getByText(/Found\s+4\s+shapes/)).toBeVisible({ timeout: 60_000 });
  await clickImagePoint(page, (FLOOR.a4.x + FLOOR.a4.w / 2) * k, (FLOOR.a4.y + FLOOR.a4.h / 2) * k, FLOOR.width, FLOOR.height);
  await page.getByRole('button', { name: 'I know this one’s size' }).click();
  await page.getByRole('button', { name: 'A4 sheet' }).click();
  await page.getByRole('button', { name: 'Measure 3 pieces' }).click();
  await expect(page.getByRole('heading', { name: 'Check sizes' })).toBeVisible({ timeout: 30_000 });
  const names = await page.getByLabel('Name').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(names).toEqual(['Piece 4', 'Piece 5', 'Piece 6']);
});
