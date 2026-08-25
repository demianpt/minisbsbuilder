import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * The save state.
 *
 * It used to be a permanent line of text in the top bar reading "Saved locally"
 * whether or not anything had just been saved. It is now a notification: it
 * appears while the write is pending, confirms, and withdraws.
 */
test.describe('the save pill', () => {
  test('floats at the bottom right and reports saving, then saved', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await useAdvancedBuilder(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));

    const pill = page.locator('#saveStatus');
    // It is no longer part of the top bar's reading order.
    expect(await pill.evaluate((node) => Boolean(node.closest('.topbar')))).toBe(false);
    const placement = await pill.evaluate((node) => {
      const styles = getComputedStyle(node);
      return { position: styles.position, right: styles.right, bottom: styles.bottom, radius: styles.borderTopLeftRadius };
    });
    expect(placement.position).toBe('fixed');
    expect(Number.parseFloat(placement.right)).toBeLessThan(40);
    expect(Number.parseFloat(placement.bottom)).toBeLessThan(40);
    expect(placement.radius).toBe('999px');
    // A screen reader is told about it, now that nothing in the bar says it.
    await expect(pill).toHaveAttribute('aria-live', 'polite');

    await page.locator('#projectTitle').fill('Northwind Rail');
    // Saving first, while the debounced write is pending.
    await expect(pill).toHaveText('Saving');
    await expect(pill).toHaveClass(/is-visible/);
    // Then saved, and then it withdraws on its own.
    await expect(pill).toHaveText('Saved', { timeout: 3000 });
    await expect(pill).not.toHaveClass(/is-visible/, { timeout: 4000 });
  });

  test('a pending save is written when the page goes away', async ({ page }) => {
    await useAdvancedBuilder(page);
    await page.goto('/');
    // Cleared here rather than in an init script: an init script runs again on
    // the reload below and would wipe the very write this test is about.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));

    // The debounce is 420ms. Reloading inside that window used to lose the edit
    // outright: close the tab a third of a second after typing and the work was
    // simply gone.
    await page.locator('#projectTitle').fill('Northwind Rail');
    await expect(page.locator('#saveStatus')).toHaveText('Saving');
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    expect(await page.evaluate(() => window.__SBS_TEST_API.state.project.brief.projectName)).toBe('Northwind Rail');
    await expect(page.locator('#projectTitle')).toHaveValue('Northwind Rail');
  });
});
