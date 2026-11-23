import { expect, test } from '@playwright/test';
import { floorPhotoPng } from './fixtures.ts';

test.use({ locale: 'en-US' });

test.describe('worker blocked', () => {
  // The service worker would fetch the file itself, bypassing page.route.
  test.use({ serviceWorkers: 'block' });
  test('if the image tools cannot load, the scan shows an error instead of spinning forever', async ({ page }) => {
    await page.route(/cv\.worker/, (r) => r.abort());
    await page.goto('/#/art/scan');
    await page.locator('input[type=file]').setInputFiles({ name: 'f.png', mimeType: 'image/png', buffer: await floorPhotoPng(page) });
    await expect(page.getByRole('alert')).toContainText('Something went wrong', { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Copy details' })).toBeVisible();
    // The diagnostics page shows what happened.
    await page.getByRole('link', { name: 'Diagnostics' }).click();
    await expect(page.locator('.log').last()).toContainText('Image tools:');
    await expect(page.locator('.log').last()).toContainText('ERROR');
  });
});

test('diagnostics self-test loads the image tools and finds the test rectangle', async ({ page }) => {
  await page.goto('/#/settings/diagnostics');
  await page.getByRole('button', { name: 'Test image tools' }).click();
  await expect(page.locator('p.hint', { hasText: /OK: found 1 rectangle/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.log').last()).toContainText('ready (OpenCV init');
});
