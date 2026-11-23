import { expect, test } from '@playwright/test';
import { WALL, dragHandle, wallPhotoPng } from './fixtures.ts';

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

  // ── Wall ──
  await page.getByRole('link', { name: 'Walls' }).click();
  await page.getByRole('link', { name: 'Add a wall' }).click();
  const png = await wallPhotoPng(page);
  await page.locator('input[type=file]:not([capture])').setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: png });

  // Measure the 36 in door width.
  await expect(page.getByRole('slider', { name: 'Measurement 1 start' })).toBeVisible();
  await dragHandle(page, 'Measurement 1 start', WALL.door.x1, 1200);
  await dragHandle(page, 'Measurement 1 end', WALL.door.x2, 1200);
  await page.getByLabel('Real length of line #1').fill('36');
  await expect(page.locator('.badge')).toContainText('Check'); // imported photo, one measurement
  // Photo is 4000 × 3200 mm = 157 1/2 × 126 in, give or take drag rounding.
  await expect(page.getByText(/Photo is 15[67]/)).toBeVisible();

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Mark the floor line').check();
  await dragHandle(page, 'Floor line', 800, WALL.floorPx);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('4. Name this wall').fill('Hallway');
  await page.getByRole('button', { name: 'Save and start arranging' }).click();

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
