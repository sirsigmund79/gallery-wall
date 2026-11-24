import { expect, test } from '@playwright/test';
import { clickImagePoint } from './fixtures.ts';
import { HALLWAY, writeHallwayY4m } from './y4m.ts';

test.skip(({ browserName }) => browserName !== 'chromium', 'Fake camera flags are Chromium-only');
const video = writeHallwayY4m();
test.use({
  locale: 'en-US',
  hasTouch: false,
  isMobile: false,
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`] },
  permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'],
});

test('hallway: hang inside the panel, size from the switch plate, level photo kept as taken', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/#/walls/new');
  await page.getByRole('button', { name: 'Use camera with level' }).click();
  await expect(async () => {
    await page.evaluate(() => {
      for (let i = 0; i < 10; i++) window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 90, gamma: 0 }));
    });
    await expect(page.getByRole('status')).toHaveText('Level · facing the wall', { timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();
  await expect(page.getByText('Tap things on the wall')).toBeVisible({ timeout: 60_000 });

  const W = HALLWAY.width, H = HALLWAY.height, P = HALLWAY.panel, S = HALLWAY.switchPlate;
  // The panel: tap inside it (away from the switch) → hang art inside it.
  await clickImagePoint(page, (P.x0 + P.x1) / 2, (P.y0 + P.y1) / 2, W, H);
  await page.getByRole('radio', { name: 'Hang art inside this' }).click();
  await expect(page.getByText('Art will only be planned inside this area')).toBeVisible();

  // The switch plate, inside the panel, is still selectable (smaller sits on top).
  await clickImagePoint(page, (S.x0 + S.x1) / 2, (S.y0 + S.y1) / 2, W, H);
  await page.getByRole('radio', { name: 'I know its size' }).click();
  await page.getByRole('button', { name: 'Light switch plate' }).click();
  await expect(page.getByText(/About ±\d+% from something this size/)).toBeVisible();
  // Its corner grips are offset outside the tiny plate so they don't overlap.
  const boxes = await Promise.all([1, 2, 3, 4].map((i) => page.getByRole('slider', { name: `Corner ${i}` }).boundingBox()));
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.width * 0.9);
    }
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Yes' }).first().click(); // floor
  await page.getByRole('button', { name: 'Continue' }).click();
  // Level camera: kept as taken, no straighten toggle.
  await expect(page.getByText(/, as taken/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Taken with the level camera')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Straightened' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start arranging' }).click();
  await expect(page.getByRole('button', { name: 'Suggest' })).toBeVisible();

  // The wall is the panel: about 570 px at 40 px per 2 3/4 in ≈ 39 in wide (within the switch's ±).
  await page.getByRole('link', { name: 'Back to Home' }).click();
  const text = (await page.locator('.wall-card-text .muted').first().textContent())!;
  const widthIn = Number(/^(\d+)/.exec(text)![1]);
  expect(widthIn).toBeGreaterThanOrEqual(36);
  expect(widthIn).toBeLessThanOrEqual(42);
});
