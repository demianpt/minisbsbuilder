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
  const pattern = page.locator(`[data-pattern-id="${patternId}"]`);
  await expect(pattern).toHaveCount(1);
  await pattern.click();
  await expect(page.locator('#patternModal')).not.toHaveClass(/\bopen\b/);
}

function exportedSingleSection() {
  const api = window.__SBS_TEST_API;
  const project = structuredClone(api.state.project);
  project.sections = [structuredClone(project.sections.find((section) => section.id === api.state.selectedSectionId))];
  const result = api.buildPageExport(project);
  const find = (node, component) => {
    if (!node || typeof node !== 'object') return null;
    if (node.component === component) return node;
    for (const child of node.children || []) {
      const match = find(child, component);
      if (match) return match;
    }
    return null;
  };
  return {
    section: result.concept.page.sections[0],
    html: api.buildSiteDocument(project),
    projectFidelity: project.sections[0].fidelity,
    projectCards: find(project.sections[0].node, 'ds-blocks/c-cards')?.attributes || null,
    components: {
      columns: find(result.concept.page.sections[0], 'ds-blocks/ds-columns')?.attributes || null,
      cards: find(result.concept.page.sections[0], 'ds-blocks/c-cards')?.attributes || null,
      list: find(result.concept.page.sections[0], 'ds-blocks/c-list')?.attributes || null,
    },
  };
}

test.describe('DST layout fidelity controls', () => {
  test('round-trips wrapper padding, columns, and card orientation into preview and export', async ({ page }) => {
    await openModules(page);

    await choosePattern(page, 'sbs-stats-p2-v3');
    await page.locator('[data-editor-tab="layout"]').click();
    await page.locator('select[data-bind$=".surface.sidePadding"]').selectOption('true');
    await page.locator('input[data-bind$=".list.desktop"]').fill('3');
    await page.locator('input[data-bind$=".list.tablet"]').fill('2');
    await page.locator('input[data-bind$=".list.mobile"]').fill('1');

    let output = await page.evaluate(exportedSingleSection);
    expect(output.section.attributes.dsContainerSideGap).toBe(true);
    expect(output.components.list).toMatchObject({
      colCount: 3,
      colCountTablet: 2,
      colCountMobile: 1,
    });
    expect(output.html).not.toContain('class="c-default no-side-padding dst-list');

    await choosePattern(page, 'sbs-layout-p998-v3');
    await page.locator('[data-editor-tab="layout"]').click();
    await expect(page.locator('input[data-bind$=".columns.desktop"]')).toHaveValue('1');
    await page.locator('input[data-bind$=".columns.desktop"]').fill('1');
    await page.locator('input[data-bind$=".columns.tablet"]').fill('1');
    await page.locator('input[data-bind$=".columns.mobile"]').fill('1');
    // The gap is a slider now, so the control speaks in `rem` and the stored
    // attribute is what carries the unit.
    await page.locator('input[data-bind$=".columns.gap"]').fill('1.6');

    output = await page.evaluate(exportedSingleSection);
    expect(output.components.columns).toMatchObject({
      desktopColumnsPerRow: 1,
      tabletCount: 1,
      mobileCount: 1,
      gap: '1.6rem',
    });
    expect(output.html).toContain('--cols:1;--cols-t:1;--cols-m:1;--col-gap:1.6rem');

    await choosePattern(page, 'sbs-testimonial-p43-v2');
    await page.locator('[data-editor-tab="layout"]').click();
    await expect(page.locator('select[data-bind$=".cards.horizontal"]')).toHaveValue('true');
    await page.locator('select[data-bind$=".cards.horizontal"]').selectOption('false');
    await expect(page.locator('select[data-bind$=".cards.horizontal"]')).toHaveValue('false');
    await expect.poll(() => page.evaluate(() => {
      const section = window.__SBS_TEST_API.state.project.sections.find((item) => item.id === window.__SBS_TEST_API.state.selectedSectionId);
      return section.fidelity.cards.horizontal;
    })).toBe(false);
    await expect.poll(() => page.evaluate(() => {
      const section = window.__SBS_TEST_API.state.project.sections.find((item) => item.id === window.__SBS_TEST_API.state.selectedSectionId);
      const find = (node) => node.component === 'ds-blocks/c-cards' ? node : (node.children || []).map(find).find(Boolean);
      return find(section.node)?.attributes?.isHorizontal;
    })).toBe(false);
    await page.locator('input[data-bind$=".cards.desktop"]').fill('1');

    output = await page.evaluate(exportedSingleSection);
    expect(output.projectFidelity.cards.horizontal).toBe(false);
    expect(output.projectCards.isHorizontal).toBe(false);
    expect(output.components.cards).toMatchObject({
      columnsDesktop: 1,
      isHorizontal: false,
    });
    expect(output.html).not.toContain('dst-cards__grid dst-slider text-left is-horizontal');
  });
});
