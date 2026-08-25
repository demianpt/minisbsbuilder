import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';
import { measureWhen, previewSettled } from './support/preview.mjs';

/**
 * A live setting change does not move the preview — and no longer rebuilds it.
 *
 * This test used to require the opposite: it waited for the frame's load count
 * to *grow*, then checked the scroll had been restored afterwards. That was the
 * best available guarantee while every change rebuilt the document, and it is
 * also a description of the thing people complained about — the page vanishing
 * to the top and gliding back with the band they were editing somewhere inside
 * the journey.
 *
 * The change is now patched into the live document, so the honest assertion is
 * the stronger one: no reload at all, and a scroll position identical to the
 * pixel rather than merely "still past 500".
 */
test('keeps the preview scroll position after a live setting change', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.locator('[data-step="3"]').click();
  await page.locator('.module-row').first().click();
  await page.locator('[data-editor-tab="layout"]').click();
  // The layout panel opens in Basic view; these controls live in Extended.
  await page.locator('[data-module-view="extended"]').click();

  const preview = page.locator('#sitePreview');
  await expect.poll(() => preview.evaluate((frame) => Boolean(frame.contentDocument?.querySelector('#sbs-site')))).toBe(true);
  await previewSettled(page);

  await preview.evaluate((frame) => {
    frame.dataset.previewLoads = '0';
    frame.addEventListener('load', () => {
      frame.dataset.previewLoads = String(Number(frame.dataset.previewLoads || 0) + 1);
    });
    frame.contentWindow.scrollTo(0, 700);
  });
  await expect.poll(() => preview.evaluate((frame) => frame.contentWindow.scrollY)).toBeGreaterThan(500);
  // A programmatic scroll that was clamped because the document had not finished
  // growing is restored by the browser as the page gets taller, so the baseline
  // is the first reading that holds still — otherwise the assertion below blames
  // this change for the browser's own catch-up.
  const scroll = await measureWhen(
    async () => {
      const first = await preview.evaluate((frame) => frame.contentWindow.scrollY);
      await page.waitForTimeout(150);
      const second = await preview.evaluate((frame) => frame.contentWindow.scrollY);
      return { first, second };
    },
    ({ first, second }) => first === second,
  ).then(({ second }) => second);

  const control = page.locator('select[data-bind$=".surface.sidePadding"]');
  const path = await control.getAttribute('data-bind');
  await control.selectOption('false');

  // The change was applied. The first module is a banner, whose own container
  // hardcodes its side gap, so the honest check is the value the block carries
  // rather than a class that cannot move.
  const sectionId = path.split('.')[1];
  await expect.poll(() => page.evaluate((id) => {
    const section = window.__SBS_TEST_API.state.project.sections.find((entry) => entry.id === id);
    return section && section.fidelity ? section.fidelity.surface.sidePadding : null;
  }, sectionId)).toBe(false);
  // And it was patched in, not rebuilt.
  expect(await page.evaluate(() => window.__SBS_TEST_API.paint.painted()), 'nothing was repainted in place').toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__SBS_TEST_API.paint.rebuilt()), 'a repaint degraded into a rebuild').toBe(0);

  await page.waitForTimeout(500);
  expect(await preview.evaluate((frame) => Number(frame.dataset.previewLoads)), 'the preview was rebuilt').toBe(0);
  expect(await preview.evaluate((frame) => frame.contentWindow.scrollY)).toBe(scroll);
});
