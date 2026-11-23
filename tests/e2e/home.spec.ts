import { expect, test } from '@playwright/test';
import { addWallWithDoor } from './fixtures.ts';

test.use({ locale: 'en-US', hasTouch: false, isMobile: false });

test('home groups walls by room; step into a wall and walk to the next one', async ({ page }) => {
  test.setTimeout(120_000);
  await addWallWithDoor(page, { name: 'Sofa wall', room: 'Living room' });
  await addWallWithDoor(page, { name: 'TV wall', room: 'Living room' });
  await addWallWithDoor(page, { name: 'Bed wall', room: 'Bedroom' });

  await page.goto('/#/walls');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  const living = page.getByRole('list', { name: 'Walls in Living room' });
  await expect(living.getByRole('link', { name: /Sofa wall/ })).toBeVisible();
  await expect(living.getByRole('link', { name: /TV wall/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Walls in Bedroom' }).getByRole('link', { name: /Bed wall/ })).toBeVisible();

  // Step into the first wall; walk to the next one in the same room.
  await living.getByRole('link', { name: /Sofa wall/ }).click();
  await expect(page.locator('.editor-title')).toContainText('Living room');
  await expect(page.locator('.editor-title')).toContainText('Sofa wall');
  await expect(page.getByRole('button', { name: 'No previous wall' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next wall: TV wall' }).click();
  await expect(page.locator('.editor-title')).toContainText('TV wall');
  await expect(page.getByRole('button', { name: 'No next wall' })).toBeDisabled(); // Bedroom is another room
  await page.getByRole('button', { name: 'Previous wall: Sofa wall' }).click();
  await expect(page.locator('.editor-title')).toContainText('Sofa wall');

  // Layouts are chips.
  await page.getByRole('button', { name: 'New layout' }).click();
  await expect(page.getByRole('tab', { name: 'Layout 2' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Layout 1' }).click();
  await expect(page.getByRole('tab', { name: 'Layout 1' })).toHaveAttribute('aria-selected', 'true');

  // Back home.
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});
