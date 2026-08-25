import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

async function openLayout(page) {
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

test('uses visual color and gradient controls and enables side padding by default', async ({ page }) => {
  await openLayout(page);

  const background = page.locator('[data-fidelity-color-control] input[data-fidelity-color-value]');
  await expect(background).toHaveCount(1);
  await background.evaluate((input) => {
    input.value = '#1A5E63';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => {
    const section = window.__SBS_TEST_API.state.project.sections.find((item) => item.id === window.__SBS_TEST_API.state.selectedSectionId);
    return section.fidelity.surface.backgroundColor;
  })).toBe('rgba(26, 94, 99, 1.00)');

  const overlay = page.locator('[data-fidelity-overlay-control]');
  await overlay.locator('[data-fidelity-overlay-mode]').selectOption('gradient');
  await overlay.locator('[data-fidelity-gradient-start]').evaluate((input) => {
    input.value = '#102A43';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await overlay.locator('[data-fidelity-gradient-end]').evaluate((input) => {
    input.value = '#E56B4F';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => {
    const section = window.__SBS_TEST_API.state.project.sections.find((item) => item.id === window.__SBS_TEST_API.state.selectedSectionId);
    return section.fidelity.surface.overlay;
  })).toContain('rgba(16, 42, 67, 1.00)');
  await expect.poll(() => page.evaluate(() => {
    const section = window.__SBS_TEST_API.state.project.sections.find((item) => item.id === window.__SBS_TEST_API.state.selectedSectionId);
    return section.fidelity.surface.overlay;
  })).toContain('rgba(229, 107, 79, 1.00)');

  const defaults = await page.evaluate(() => {
    const api = window.__SBS_TEST_API;
    return api.patternIds.map((patternId, index) => api.createSection('text', index, patternId).fidelity.surface.sidePadding);
  });
  expect(defaults.every(Boolean)).toBe(true);
});

/**
 * Sliders, not typed values.
 *
 * "Overlay strength" was a text box wanting a number between 0 and 1, and
 * "Overlay blur" was a text box wanting a CSS length. Both are quantities a
 * strategist has an opinion about and no vocabulary for, so both are now
 * dragged, and the unit conversion lives on the control rather than in the head
 * of whoever is using it.
 */
test('every quantity in the overlay group is a slider that stores a real value', async ({ page }) => {
  await openLayout(page);

  const surface = () => page.evaluate(() => {
    const api = window.__SBS_TEST_API;
    return api.state.project.sections.find((item) => item.id === api.state.selectedSectionId).fidelity.surface;
  });

  const strength = page.locator('input[data-bind$=".surface.overlayOpacity"]');
  await expect(strength).toHaveAttribute('type', 'range');
  await strength.fill('35');
  await expect.poll(async () => (await surface()).overlayOpacity).toBe(0.35);
  // The reading beside the label is in the unit a person would say out loud.
  await expect(page.locator('.range-field:has(input[data-bind$=".surface.overlayOpacity"]) output')).toHaveText('35%');

  const blur = page.locator('input[data-bind$=".surface.overlayBlur"]');
  await expect(blur).toHaveAttribute('type', 'range');
  await blur.fill('8');
  await expect.poll(async () => (await surface()).overlayBlur).toBe('8px');
  // Zero means "no blur", not "a blur of zero" — nothing should be emitted.
  await blur.fill('0');
  await expect.poll(async () => (await surface()).overlayBlur).toBe('');

  // How the overlay mixes stays a named choice, because it is not a quantity.
  await expect(page.locator('select[data-bind$=".surface.overlayBlend"]')).toHaveCount(1);
});

test('the overlay strength reaches the rendered scrim and the export', async ({ page }) => {
  await openLayout(page);
  await page.locator('input[data-bind$=".surface.overlayOpacity"]').fill('25');
  await page.locator('input[data-bind$=".surface.overlayBlur"]').fill('6');

  const sectionId = await page.evaluate(() => window.__SBS_TEST_API.state.selectedSectionId);
  await expect.poll(() => page.locator('#sitePreview').evaluate((frame, id) => {
    const overlay = frame.contentDocument.querySelector(`#${id} .c-overlay`);
    return overlay ? getComputedStyle(overlay).opacity : null;
  }, sectionId)).toBe('0.25');
  await expect.poll(() => page.locator('#sitePreview').evaluate((frame, id) => {
    const overlay = frame.contentDocument.querySelector(`#${id} .c-overlay`);
    return overlay ? getComputedStyle(overlay).filter : null;
  }, sectionId)).toContain('blur(6px)');

  const exported = await page.evaluate(() => {
    const api = window.__SBS_TEST_API;
    const page_ = api.buildPageExport();
    const find = (node) => (node.attributes && node.attributes.backgroundOverlay
      ? node.attributes
      : (node.children || []).map(find).find(Boolean));
    return find(page_.concept.page.sections[0]);
  });
  // The strength is folded into the colour rather than exported beside it: the
  // theme's blocks carry an overlay's opacity *inside* the colour and declare no
  // opacity attribute, so a separate number landed at full strength and the
  // photograph vanished behind a solid band.
  expect(exported.backgroundOverlayOpacity).toBeUndefined();
  expect(String(exported.backgroundOverlay)).toMatch(/rgba\(|#[0-9a-f]{8}|color-mix/i);
  expect(exported.backgroundOverlayBlur).toBe('6px');
});
