import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * The dials existed before this suite and did almost nothing a strategist could
 * see. These tests measure the rendered page, not the token values, because
 * "I can't see relevant changes" was the actual defect.
 */

async function openDirection(page) {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.locator('[data-step="1"]').click();
  await expect(page.locator('.dial-sample')).toBeVisible();
}

async function setDials(page, values) {
  await page.evaluate((next) => {
    const api = window.__SBS_TEST_API;
    Object.assign(api.state.project.design, next);
    api.design.ensure(api.state.project);
    document.getElementById('sitePreview').srcdoc = api.buildSiteDocument(api.state.project);
  }, values);
  await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => Boolean(frame.contentDocument?.querySelector('.c-heading__title')))).toBe(true);
}

function measurePreview(page) {
  return page.locator('#sitePreview').evaluate((frame) => {
    const doc = frame.contentDocument;
    const site = doc.getElementById('sbs-site');
    const round = (value) => Math.round(Number.parseFloat(value) || 0);
    const title = doc.querySelector('.c-heading__title');
    const hero = doc.querySelector('.sbs-hero');
    const body = doc.querySelector('.sbs-rich-text p') || doc.querySelector('.c-heading__sub');
    return {
      motionLevel: site.dataset.motionLevel,
      densityLevel: site.dataset.densityLevel,
      surfaceLevel: site.dataset.surfaceLevel,
      titlePx: title ? round(getComputedStyle(title).fontSize) : 0,
      headerPx: round(getComputedStyle(site).getPropertyValue('--dst--header-height')),
      heroMinPx: hero ? round(getComputedStyle(hero).minHeight) : 0,
      lineHeight: round(getComputedStyle(site).lineHeight),
      measurePx: body ? round(getComputedStyle(body).maxWidth) : 0,
      motionDistance: getComputedStyle(site).getPropertyValue('--sbs-motion-distance').trim(),
      motionDuration: getComputedStyle(site).getPropertyValue('--sbs-motion-duration').trim(),
      docHeight: doc.documentElement.scrollHeight,
      // With movement off, nothing may be left invisible waiting for an
      // IntersectionObserver that will never usefully fire.
      hiddenReveals: [...doc.querySelectorAll('[data-viewport-effect] > *')]
        .filter((node) => Number(getComputedStyle(node).opacity) < 1).length,
    };
  });
}

const ALL_MIN = { density: 0, measure: 0, headline: 0, accent: 0, surface: 0, corner: 0, imagery: 0, motion: 0, expressiveness: 0 };
const ALL_MAX = { density: 100, measure: 100, headline: 100, accent: 100, surface: 100, corner: 100, imagery: 100, motion: 100, expressiveness: 100 };

test.describe('design dials', () => {
  test('every dial group and its explanation is rendered', async ({ page }) => {
    await openDirection(page);
    const keys = await page.evaluate(() => window.__SBS_TEST_API.design.dialKeys);
    expect(keys.length).toBe(9);
    for (const key of keys) {
      await expect(page.locator(`.dial[data-dial="${key}"] input[type="range"]`)).toHaveCount(1);
      await expect(page.locator(`.dial[data-dial="${key}"] .dial-help`)).not.toBeEmpty();
      await expect(page.locator(`.dial[data-dial="${key}"] output`)).toContainText('·');
    }
    await expect(page.locator('.dial-group')).toHaveCount(6);
  });

  test('moving a dial updates its plain-language readout immediately', async ({ page }) => {
    await openDirection(page);
    const slider = page.locator('.dial[data-dial="density"] input[type="range"]');
    const output = page.locator('.dial[data-dial="density"] output');
    await slider.fill('4');
    await expect(output).toHaveText('4 · Spacious');
    await slider.fill('92');
    await expect(output).toHaveText('92 · Compact');
  });

  test('the extremes produce a visibly different page', async ({ page }) => {
    await openDirection(page);
    await setDials(page, ALL_MIN);
    const min = await measurePreview(page);
    await setDials(page, ALL_MAX);
    const max = await measurePreview(page);

    // Headline scale is the change a strategist notices first.
    expect(max.titlePx).toBeGreaterThan(min.titlePx * 2);
    // Density really compresses the page.
    expect(max.headerPx).toBeLessThan(min.headerPx - 30);
    expect(max.lineHeight).toBeLessThan(min.lineHeight);
    // Image presence and expression own the hero height.
    expect(max.heroMinPx).toBeGreaterThan(min.heroMinPx + 200);
    // Reading width is a real constraint, not a hint.
    expect(max.measurePx).toBeGreaterThan(min.measurePx + 100);
    // And the discrete bands flip.
    expect(min.densityLevel).toBe('spacious');
    expect(max.densityLevel).toBe('compact');
    expect(min.surfaceLevel).toBe('flat');
    expect(max.surfaceLevel).toBe('raised');
  });

  test('the movement dial is unmistakable between its lowest and highest settings', async ({ page }) => {
    await openDirection(page);
    await setDials(page, { ...ALL_MAX, motion: 1 });
    const low = await measurePreview(page);
    await setDials(page, { ...ALL_MAX, motion: 100 });
    const high = await measurePreview(page);

    expect(low.motionLevel).toBe('still');
    expect(low.motionDistance).toBe('0px');
    expect(low.motionDuration).toBe('0s');
    expect(low.hiddenReveals).toBe(0);
    expect(high.motionLevel).toBe('dynamic');
    expect(Number.parseFloat(high.motionDistance)).toBeGreaterThan(60);
    expect(Number.parseFloat(high.motionDuration)).toBeGreaterThan(0.7);
  });

  test('the logo marquee speed changes without any scrolling', async ({ page }) => {
    await openDirection(page);
    // Only sbs-logo-p4-v1 uses ds-blocks/marquee, so select it explicitly:
    // this is the one motion cue a strategist sees before scrolling at all.
    await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      api.brain.applyCustomFlow({ name: 'Marquee probe', rationale: 'test', families: ['hero', 'logo', 'cta'] });
      const logo = api.state.project.sections.find((section) => section.family === 'logo');
      api.state.selectedSectionId = logo.id;
    });
    await page.locator('[data-step="3"]').click();
    await page.locator('[data-action="choose-pattern"]').click();
    await page.locator('#patternFamily').selectOption('all');
    await page.locator('[data-pattern-id="sbs-logo-p4-v1"]').click();
    await expect(page.locator('#patternModal')).not.toHaveClass(/\bopen\b/);
    await page.locator('[data-step="1"]').click();
    const speedAt = async (motion) => {
      await setDials(page, { motion });
      return page.locator('#sitePreview').evaluate((frame) => {
        const track = frame.contentDocument.querySelector('.dst-marquee__track');
        return track ? getComputedStyle(track).animationDuration : null;
      });
    };
    // At the lowest setting the marquee stops completely.
    expect(Number.parseFloat(await speedAt(2))).toBe(0);
    // Above that it runs, and the speed difference is large enough to read at
    // a glance rather than measure.
    const slow = Number.parseFloat(await speedAt(20));
    const fast = Number.parseFloat(await speedAt(100));
    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeGreaterThan(fast * 3);
  });

  test('a quick style sets every dial at once and is undoable', async ({ page }) => {
    await openDirection(page);
    const before = await page.evaluate(() => ({ ...window.__SBS_TEST_API.state.project.design }));
    await page.locator('[data-dial-preset="bold"]').click();
    await expect(page.locator('[data-dial-preset="bold"]')).toHaveClass(/is-active/);
    const after = await page.evaluate(() => ({ ...window.__SBS_TEST_API.state.project.design }));
    const keys = await page.evaluate(() => window.__SBS_TEST_API.design.dialKeys);
    expect(keys.some((key) => before[key] !== after[key])).toBe(true);
    await expect(page.locator('.dial[data-dial="headline"] output')).toHaveText('92 · Huge');

    await page.locator('#undoBtn').click();
    const undone = await page.evaluate(() => ({ ...window.__SBS_TEST_API.state.project.design }));
    for (const key of keys) expect(undone[key]).toBe(before[key]);
  });

  test('the corner dial drives the exported radius token', async ({ page }) => {
    await openDirection(page);
    await page.locator('.dial[data-dial="corner"] input[type="range"]').fill('0');
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.buildTheme().layout['default-radius'])).toBe('0px');
    await page.locator('.dial[data-dial="corner"] input[type="range"]').fill('100');
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.buildTheme().layout['default-radius'])).toBe('44px');
  });

  test('every dial reaches the WordPress theme export', async ({ page }) => {
    await openDirection(page);
    await setDials(page, ALL_MAX);
    const theme = await page.evaluate(() => window.__SBS_TEST_API.buildTheme());
    const keys = await page.evaluate(() => window.__SBS_TEST_API.design.dialKeys);
    for (const key of keys) expect(theme.designDials[key]).toBe(100);
    expect(theme.designDialLevels.motion).toBe('dynamic');
    expect(theme.motion.distance).toBe('92px');
    expect(theme.layout['header-height']).toBe('64px');
    expect(theme.typography['reading-measure']).toBe('90ch');
  });

  test('the live sample is one card carrying the real tokens, and nothing else', async ({ page }) => {
    await openDirection(page);
    await page.locator('.dial[data-dial="motion"] input[type="range"]').fill('100');
    const sample = page.locator('[data-dial-sample]');
    await expect(sample).toHaveAttribute('style', /--sample-distance:\s*\d+px/);
    const distance = await sample.evaluate((node) => node.style.getPropertyValue('--sample-distance'));
    expect(Number.parseFloat(distance)).toBeGreaterThan(60);
    // One card, not three: the panel is a token readout, not a layout demo, and
    // three cards cost three times the height in a column that was too long.
    await expect(page.locator('.dial-sample-card')).toHaveCount(1);
    // The replay control is gone. It re-ran an entrance nobody asked to see.
    await expect(page.locator('[data-dial-replay]')).toHaveCount(0);
  });

  test('pairs the dials two to a row', async ({ page }) => {
    await openDirection(page);
    const groups = await page.$$eval('.dial-group', (nodes) => nodes.map((group) => ({
      columns: getComputedStyle(group.querySelector('.dial-grid')).gridTemplateColumns.split(' ').length,
      dials: group.querySelectorAll('.dial').length,
    })));
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) expect(group.columns).toBe(2);
    // Nine dials in two columns is at most five rows, where one per row was nine.
    const rows = await page.$$eval('.dial', (nodes) => new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().top))).size);
    const dials = groups.reduce((total, group) => total + group.dials, 0);
    expect(rows).toBeLessThan(dials);
  });
});
