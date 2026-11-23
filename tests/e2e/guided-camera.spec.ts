import { expect, test } from '@playwright/test';

// Fake camera + simulated motion sensor. Chromium only: the fake-media flags are Chromium's.
test.skip(({ browserName }) => browserName !== 'chromium', 'Fake camera flags are Chromium-only');
test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'],
});

async function tilt(page: import('@playwright/test').Page, beta: number, gamma: number) {
  await page.evaluate(
    ([b, g]) => {
      for (let i = 0; i < 10; i++) window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: b, gamma: g }));
    },
    [beta, gamma],
  );
}

test('level guide reacts to tilt, and a level shot is straightened', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/#/art/scan');
  await page.getByRole('button', { name: 'Use camera with level' }).click();
  await expect(page.getByRole('dialog', { name: 'Camera' })).toBeVisible();

  await tilt(page, 10, 0);
  await expect(page.getByRole('status')).toContainText('Tilted 10°');
  await expect(page.getByRole('button', { name: 'Take photo (not level)' })).toBeVisible();

  await tilt(page, 1, -1);
  await expect(page.getByRole('status')).toHaveText('Level · looking down');

  // Raise the phone to face a wall: the guide switches by itself, no option to pick.
  await tilt(page, 90, 0);
  await expect(page.getByRole('status')).toHaveText('Level · facing the wall');
  await tilt(page, 78, 0); // camera pointing 12° down (tolerance is 8°)
  await expect(page.getByRole('status')).toContainText('Tilt up 12°');
  // Back down over the floor.
  await tilt(page, 1, -1);
  await expect(page.getByRole('status')).toHaveText('Level · looking down');
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();

  // Through straightening + detection to the review screen.
  await expect(page.getByText('Straightened with the level sensor.')).toBeVisible({ timeout: 60_000 });
});

test('a shot of a wall is straightened as a wall photo', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/#/art/scan');
  await page.getByRole('button', { name: 'Use camera with level' }).click();
  // A phone streams readings continuously; keep sending until the camera listens.
  await expect(async () => {
    await tilt(page, 91, 1);
    await expect(page.getByRole('status')).toHaveText('Level · facing the wall', { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();
  await expect(page.getByText('Straightened with the level sensor.')).toBeVisible({ timeout: 60_000 });
  await page.goto('/#/settings/diagnostics');
  await expect(page.locator('.log').last()).toContainText('pointing at a wall');
  await expect(page.locator('.log').last()).toContainText('view wall-level');
});

test('sensor check shows camera-frame gravity', async ({ page }) => {
  await page.goto('/#/settings/sensors');
  await page.getByRole('button', { name: 'Start' }).click();
  // Keep sending readings until the screen has started listening.
  await expect(async () => {
    await tilt(page, 90, 0);
    await expect(page.locator('.mono')).toContainText('g (camera) = ( 0.000,  1.000,  0.000)', { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  // Flat on a table: gravity along the camera axis.
  await expect(async () => {
    await tilt(page, 0, 0);
    await expect(page.locator('.mono')).toContainText('Floor: tilt  0.0°', { timeout: 500 });
  }).toPass({ timeout: 10_000 });
});
