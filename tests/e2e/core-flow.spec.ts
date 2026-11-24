import { expect, test } from '@playwright/test';
import { WALL, clickImagePoint, wallPhotoPng } from './fixtures.ts';

test.use({ locale: 'en-US', hasTouch: false, isMobile: false });

test('add art, calibrate a wall from one measurement, place art, read nail positions', async ({ page }) => {
  await page.goto('/');

  // ── Art ──
  await page.getByRole('link', { name: 'Art' }).click();
  await page.getByRole('link', { name: 'Add by hand' }).click();
  await page.getByLabel('Name').fill('Beach print');
  await page.getByLabel('Width').fill('16');
  await page.getByLabel('Height').fill('20');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('16 in × 20 in')).toBeVisible();

  await page.getByRole('link', { name: 'Add by hand' }).click();
  await page.getByLabel('Name').fill('Map');
  await page.getByLabel('Width').fill('24 1/2');
  await page.getByLabel('Height').fill('18');
  await page.getByLabel('Hanger').selectOption('dring2');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('24 1/2 in × 18 in')).toBeVisible();

  // ── Wall: tap the door, pick its standard size, confirm the floor ──
  await page.goto('/#/walls/new');
  await page.locator('input[type=file]').setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: await wallPhotoPng(page) });
  await expect(page.getByText('Tap things on the wall')).toBeVisible({ timeout: 60_000 });
  await clickImagePoint(page, (WALL.door.x1 + WALL.door.x2) / 2, (WALL.door.top + WALL.door.bottom) / 2, WALL.widthPx, WALL.heightPx);
  await page.getByRole('radio', { name: 'I know its size' }).click();
  await page.getByRole('button', { name: 'Door 36 × 80 in' }).click();
  await expect(page.getByText('Is the green line the floor?')).toBeVisible();
  await page.getByRole('button', { name: 'Yes' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  // Both sides known: angle corrected, quality Good. Photo is 4000 × 3200 mm = 157 1/2 × 126 in.
  await expect(page.locator('.badge')).toContainText('Good', { timeout: 30_000 });
  // Within 1% (the synthetic door has a 4 px outline, so its edge is ambiguous by ~2 px).
  await expect(page.getByText(/Photo covers 15[6-9][^×]* in × 12[5-7]/)).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue('Wall 1');
  await page.getByLabel('Name').fill('Hallway');
  await page.getByRole('button', { name: 'Start arranging' }).click();

  // ── Editor ──
  await expect(page.getByRole('button', { name: 'Add art' })).toBeVisible();
  await page.getByRole('button', { name: 'Add art' }).click();
  await page.getByRole('button', { name: /Beach print/ }).click();
  // New pieces are centred at eye level (57 in above the floor).
  const nail = page.locator('.nails li');
  await expect(nail).toContainText('up from floor');

  // Exact positioning: put the left edge 20 in from the wall's left.
  const left = page.getByLabel('Left edge, from wall’s left');
  await left.fill('20');
  await left.press('Enter');
  await expect(nail).toContainText('28 in from left'); // 20 + 16/2

  // Nudge right twice (1/8 in each), then undo once.
  await page.getByRole('button', { name: 'Nudge right' }).click();
  await page.getByRole('button', { name: 'Nudge right' }).click();
  await expect(nail).toContainText('28 1/4 in from left');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(nail).toContainText('28 1/8 in from left');

  // Survives a reload.
  await page.waitForTimeout(800); // autosave debounce
  await page.reload();
  await page.getByRole('link', { name: 'Hang guide' }).click();
  await expect(page.getByRole('cell', { name: '28 1/8 in' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Beach print/ })).toBeVisible();
});
