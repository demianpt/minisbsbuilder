import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

async function openModules(page) {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.locator('[data-step="3"]').click();
  await page.locator('.module-row').first().click();
  await page.locator('[data-editor-tab="layout"]').click();
  // The layout panel opens in Basic view; these controls live in Extended.
  await page.locator('[data-module-view="extended"]').click();
}

async function choosePattern(page, patternId) {
  await page.locator('[data-action="choose-pattern"]').click();
  await page.locator('#patternFamily').selectOption('all');
  await page.locator(`[data-pattern-id="${patternId}"]`).click();
  await expect(page.locator('#patternModal')).not.toHaveClass(/\bopen\b/);
  await page.locator('[data-editor-tab="layout"]').click();
  await page.locator('[data-module-view="extended"]').click();
}

async function previewSectionStyles(page, sectionId, selector, expected) {
  await page.waitForFunction(({ id, targetSelector, expectedStyles }) => {
    const frame = document.querySelector('#sitePreview');
    const section = frame?.contentDocument?.getElementById(id);
    const target = section?.querySelector(targetSelector);
    if (!target) return false;
    const styles = [getComputedStyle(section).backgroundColor, getComputedStyle(target).color, getComputedStyle(target).textAlign];
    return styles.every((value, index) => value === expectedStyles[index]);
  }, { id: sectionId, targetSelector: selector, expectedStyles: expected });

  return page.locator('#sitePreview').evaluate((frame, args) => {
    const section = frame.contentDocument.getElementById(args.sectionId);
    const target = section.querySelector(args.selector);
    return [getComputedStyle(section).backgroundColor, getComputedStyle(target).color, getComputedStyle(target).textAlign];
  }, { sectionId, selector });
}

test('keeps section tones, card overlays, heading copy, and logo marks readable', async ({ page }) => {
  await openModules(page);
  await choosePattern(page, 'sbs-layout-p998-v3');

  await expect(page.locator('input[data-bind$=".columns.desktop"]')).toHaveValue('1');
  await page.locator('select[data-bind$=".inverted"]').selectOption('true');
  const selectedSectionId = await page.evaluate(() => window.__SBS_TEST_API.state.selectedSectionId);
  const darkHeading = ['rgb(7, 28, 42)', 'rgb(247, 245, 239)', 'left'];
  await expect(await previewSectionStyles(page, selectedSectionId, '.c-heading__title', darkHeading))
    .toEqual(darkHeading);

  await page.locator('select[data-bind$=".inverted"]').selectOption('false');
  // The heading alignment, not a separate content alignment: `c-heading` has one
  // alignment pair, so that is the control that both moves the preview and
  // survives into WordPress. The supporting text follows it.
  await page.locator('select[data-bind$=".headingAlign"]').selectOption('center');
  const lightCenteredText = ['rgb(247, 245, 239)', 'rgb(10, 37, 54)', 'center'];
  await expect(await previewSectionStyles(page, selectedSectionId, '.c-heading__description .sbs-rich-text', lightCenteredText))
    .toEqual(lightCenteredText);

  await choosePattern(page, 'sbs-layout-p237-v2');
  // The scrim is the renderer's own soft bottom-up gradient, not the hard black
  // one the pattern brought from the site it was exported from — that one hid
  // the photograph it was supposed to make a title readable on. What matters is
  // that it darkens towards the copy, which is what these two stops say.
  await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => {
    const scrim = frame.contentDocument.querySelector('.dst-card--media-background .c-block__scrim');
    return scrim ? getComputedStyle(scrim).backgroundImage : '';
  })).toMatch(/linear-gradient\(rgba\(7, 28, 42, 0\.02\), rgba\(7, 28, 42, 0\.92\)\)/);

  await choosePattern(page, 'sbs-logo-p2-v1');
  await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => frame.contentDocument.querySelectorAll('.sbs-logo-orb').length)).toBeGreaterThan(2);
});
