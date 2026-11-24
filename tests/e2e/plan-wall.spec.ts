import { expect, test } from '@playwright/test';
import { inToMm } from '../../src/geometry/units.ts';
import { clickImagePoint } from './fixtures.ts';
import { ARTWALL, writeArtWallY4m } from './y4m.ts';

// Chromium-only: uses a fake camera fed from a generated video file.
test.skip(({ browserName }) => browserName !== 'chromium', 'Fake camera flags are Chromium-only');
const video = writeArtWallY4m();
test.use({
  locale: 'en-US',
  hasTouch: false,
  isMobile: false,
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`] },
  permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'],
});

/** "17 1/4 in" → mm */
function inchesText(s: string): number {
  const m = /(\d+)(?: (\d+)\/(\d+))?/.exec(s)!;
  return inToMm(Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0));
}

test('scan art hanging on a wall, then "Plan this wall" puts the pieces where they hang', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/#/art/scan');
  await page.getByRole('button', { name: 'Use camera with level' }).click();
  await expect(async () => {
    await page.evaluate(() => {
      for (let i = 0; i < 10; i++) window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 90, gamma: 0 }));
    });
    await expect(page.getByRole('status')).toHaveText('Level · facing the wall', { timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();

  await expect(page.getByText(/Found\s+4\s+shapes/)).toBeVisible({ timeout: 60_000 });
  const k = ARTWALL.pxPerMm, a4 = ARTWALL.a4;
  await clickImagePoint(page, a4.x + (a4.wMm * k) / 2, a4.y + (a4.hMm * k) / 2, ARTWALL.width, ARTWALL.height);
  await page.getByRole('button', { name: 'I know this one’s size' }).click();
  await page.getByRole('button', { name: 'A4 sheet' }).click();
  await page.getByRole('button', { name: 'Measure 3 pieces' }).click();
  await expect(page.getByRole('heading', { name: 'Check sizes' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Add 3 pieces to library' }).click();

  // Only offered because the photo was taken facing a wall.
  await expect(page.getByRole('heading', { name: 'Plan new art for this wall?' })).toBeVisible();
  await page.getByLabel('Wall name').fill('Hall gallery');
  await page.getByRole('button', { name: 'Plan this wall' }).click();

  // Opens the editor on "New plan", with "As it hangs now" kept.
  await expect(page.locator('.editor-title')).toContainText('Hall gallery', { timeout: 30_000 });
  await expect(page.getByRole('tab', { name: 'New plan' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'As it hangs now' })).toBeVisible();
  await expect(page.getByLabel('Cover where art hangs now')).toBeVisible();

  // Hang guide: nails where they really are (wire hangs from each piece's centre line).
  await page.getByRole('link', { name: 'Hang guide' }).click();
  await expect(page.locator('tbody tr.first')).toHaveCount(3);
  const firstFromLeft = inchesText((await page.locator('tbody tr.first').first().locator('td').nth(2).textContent())!);
  const p0 = ARTWALL.pieces[0]!;
  const trueCentreMm = (p0.x + (p0.wMm * k) / 2) / k;
  expect(Math.abs(firstFromLeft - trueCentreMm)).toBeLessThan(8); // within 8 mm (display rounds to 1/16 in)

  // The pieces are now marked as hanging.
  await page.goto('/#/art');
  await expect(page.locator('.chip.status-hung')).toHaveCount(3);
});
