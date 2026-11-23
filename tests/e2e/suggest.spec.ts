import { expect, test } from '@playwright/test';
import { addPiece, addWallWithDoor } from './fixtures.ts';

test.use({ locale: 'en-US', hasTouch: false, isMobile: false });

test('suggest mixes library art into layouts that fit; apply, undo and shuffle', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  for (const [n, w, h] of [['A', '16', '20'], ['B', '16', '20'], ['C', '11', '14'], ['D', '11', '14'], ['E', '24', '18']] as const) await addPiece(page, n, w, h);

  await addWallWithDoor(page);

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
  // The door is a no-art zone: no suggestion covers it (checked in unit tests); it's drawn on the wall.
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
