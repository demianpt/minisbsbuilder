import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * Step 04 opens in Basic view. The requirement was that a digital strategist is
 * never shown a padding token unless they ask for one, while an advanced user
 * still reaches every registered attribute.
 */

async function openLayout(page) {
  // Clear storage in-page rather than with addInitScript: an init script re-runs
  // on every navigation, which would wipe the state a reload test is checking.
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.locator('[data-step="3"]').click();
  await page.locator('.module-row').first().click();
  await page.locator('[data-editor-tab="layout"]').click();
}

/**
 * Builds a flow that definitely contains the family, then selects it. The
 * default flow has no card grid, and a repeating-items test needs one.
 */
async function selectFamily(page, family) {
  const id = await page.evaluate((target) => {
    const api = window.__SBS_TEST_API;
    if (!api.state.project.sections.some((item) => item.family === target)) {
      api.brain.applyCustomFlow({ name: 'View probe', rationale: 'test', families: ['hero', target, 'cta'] });
    }
    const section = api.state.project.sections.find((item) => item.family === target);
    api.state.selectedSectionId = section.id;
    return section.id;
  }, family);
  await page.locator('[data-step="3"]').click();
  await page.locator(`.module-row[data-section-id="${id}"]`).click();
  await page.locator('[data-editor-tab="layout"]').click();
  return id;
}

function bindPaths(page) {
  return page.$$eval('#editorInner [data-bind]', (nodes) => nodes.map((node) => node.dataset.bind));
}

test.describe('module editor views', () => {
  test('opens in Basic view with the plain-language choices only', async ({ page }) => {
    await openLayout(page);
    await expect(page.locator('.view-switch')).toBeVisible();
    await expect(page.locator('[data-module-view="simple"]')).toHaveClass(/active/);
    await expect(page.locator('.view-switch-copy b')).toHaveText('Basic view');

    const labels = await page.$$eval('#editorInner .fidelity-group__head h3', (nodes) => nodes.map((node) => node.textContent));
    // "How many across" only appears for a section that repeats items, which the
    // opening hero does not. The overlay group is here in both views: a headline
    // lost inside a bright photograph is the most common thing to need fixing,
    // and Basic is where most people are standing when they see it.
    expect(labels).toEqual(['How this section looks', 'Background and image overlay', 'How it arrives', 'Decorative pattern']);

    const binds = await bindPaths(page);
    // Space above/below stay, because "how much room" is a strategist decision.
    // Everything a strategist should not have to understand is gone: raw
    // geometry, per-breakpoint values and ratios. Opacity survives — but only as
    // a labelled slider, never as a number somebody has to know the range of.
    expect(binds.filter((path) => /\.(?:[a-zA-Z]*(?:Tablet|Mobile)|ratio|margin)\b/i.test(path))).toEqual([]);
    const opacityTypes = await page.$$eval('#editorInner [data-bind*="pacity" i]', (nodes) => nodes.map((node) => node.type));
    expect(opacityTypes.length).toBeGreaterThan(0);
    expect(opacityTypes.every((type) => type === 'range')).toBe(true);
    expect(binds.filter((path) => path.startsWith('fidelity.') && /padding|gap|radius|width|height/i.test(path))).toEqual([]);
    expect(binds).toContain(`setting.${await page.evaluate(() => window.__SBS_TEST_API.state.selectedSectionId)}.paddingTop`);
    // And the things they should have: registered motifs and a reveal effect.
    expect(binds.some((path) => path.startsWith('decoration.'))).toBe(true);
    expect(binds.some((path) => path.endsWith('.viewport'))).toBe(true);
  });

  test('shows the items-per-row choice only for a section that repeats items', async ({ page }) => {
    await openLayout(page);
    await selectFamily(page, 'cards');
    const labels = await page.$$eval('#editorInner .fidelity-group__head h3', (nodes) => nodes.map((node) => node.textContent));
    expect(labels).toContain('How many across');
    // A slider rather than a dropdown: dragging is the same gesture whether the
    // value is a count, a gap or an overlay strength, which is the whole point
    // of putting them all on one control type.
    const columns = page.locator('#editorInner input[data-bind$=".cards.desktop"]');
    await expect(columns).toHaveAttribute('type', 'range');
    await expect(columns).toHaveAttribute('min', '1');
    await expect(columns).toHaveAttribute('max', '6');
    await columns.fill('5');
    await expect.poll(() => page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      return api.state.project.sections.find((s) => s.id === api.state.selectedSectionId).fidelity.cards.desktop;
    })).toBe(5);
  });

  test('the arrival effect is described in words, not effect ids', async ({ page }) => {
    await openLayout(page);
    const options = await page.$$eval('#editorInner select[data-bind$=".viewport"] option', (nodes) => nodes.map((node) => node.textContent));
    expect(options).toContain('No movement');
    expect(options).toContain('Rise up as it arrives');
    expect(options).not.toContain('fade-up');
  });

  test('Extended view exposes every registered attribute group', async ({ page }) => {
    await openLayout(page);
    // A card section is the one that owns per-breakpoint columns and geometry.
    await selectFamily(page, 'cards');
    const simpleBinds = await bindPaths(page);
    await page.locator('[data-module-view="extended"]').click();
    await expect(page.locator('[data-module-view="extended"]')).toHaveClass(/active/);
    await expect(page.locator('.view-switch-copy b')).toHaveText('Extended view');

    const extendedBinds = await bindPaths(page);
    expect(extendedBinds.length).toBeGreaterThan(simpleBinds.length * 2);
    expect(extendedBinds.some((path) => /padding/i.test(path))).toBe(true);
    expect(extendedBinds.some((path) => /Tablet/.test(path))).toBe(true);
    expect(extendedBinds.some((path) => /Mobile/.test(path))).toBe(true);
    expect(extendedBinds.some((path) => path.endsWith('.scroll'))).toBe(true);
    await expect(page.locator('[data-fidelity-overlay-control]')).toHaveCount(1);
  });

  test('the choice survives a reload and a step change', async ({ page }) => {
    await openLayout(page);
    await page.locator('[data-module-view="extended"]').click();
    await page.locator('[data-step="0"]').click();
    await page.locator('[data-step="3"]').click();
    await page.locator('[data-editor-tab="layout"]').click();
    await expect(page.locator('[data-module-view="extended"]')).toHaveClass(/active/);

    await expect.poll(() => page.evaluate(() => localStorage.getItem('sbs-builder-v3')?.includes('"moduleView":"extended"'))).toBe(true);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    await page.locator('[data-step="3"]').click();
    await page.locator('[data-editor-tab="layout"]').click();
    await expect(page.locator('[data-module-view="extended"]')).toHaveClass(/active/);
  });

  test('a Basic-view change reaches the preview and the export like any other', async ({ page }) => {
    await openLayout(page);
    const sectionId = await page.evaluate(() => window.__SBS_TEST_API.state.selectedSectionId);
    await page.locator(`select[data-bind="decoration.${sectionId}.motif"]`).selectOption('dot-grid');
    await expect.poll(() => page.evaluate((id) => {
      const section = window.__SBS_TEST_API.state.project.sections.find((item) => item.id === id);
      return section.decoration?.motif;
    }, sectionId)).toBe('dot-grid');
    await expect.poll(() => page.locator('#sitePreview').evaluate((frame, id) => {
      const section = frame.contentDocument.getElementById(id);
      return Boolean(section?.querySelector('.c-decoration'));
    }, sectionId)).toBe(true);

    await page.locator(`select[data-bind="setting.${sectionId}.inverted"]`).selectOption('true');
    await expect.poll(() => page.evaluate((id) => {
      const project = window.__SBS_TEST_API.state.project;
      return project.sections.find((item) => item.id === id).layout.inverted;
    }, sectionId)).toBe(true);
  });
});
