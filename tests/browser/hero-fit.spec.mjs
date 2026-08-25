import { expect, test } from '@playwright/test';
import { measureWhen } from './support/preview.mjs';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * The hero banner applied its editorial width caps without regard to what was
 * inside the inner, which produced two visible defects:
 *
 *   1. A centred heading sat inside a left-pinned inner, so a "centred" hero
 *      read as off-centre on every wide screen.
 *   2. A hero built from a two-column layout inherited the single-column cap and
 *      squeezed the copy and the image into a third of the page each.
 */

async function boot(page) {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => Boolean(frame.contentDocument?.querySelector('.sbs-hero')))).toBe(true);
}

/**
 * Swaps the hero to a specific registered pattern through the real modal.
 * `until` names the rendered signature to wait for: the preview is rebuilt on a
 * debounce, so polling only for "a title exists" would measure the old pattern.
 */
async function useHeroPattern(page, patternId, until) {
  await page.evaluate(() => {
    const api = window.__SBS_TEST_API;
    api.state.selectedSectionId = api.state.project.sections.find((section) => section.family === 'hero').id;
  });
  await page.locator('[data-step="3"]').click();
  await page.locator('[data-action="choose-pattern"]').click();
  await page.locator('#patternFamily').selectOption('all');
  await page.locator(`[data-pattern-id="${patternId}"]`).click();
  await expect(page.locator('#patternModal')).not.toHaveClass(/\bopen\b/);
  await expect.poll(() => page.evaluate(() => {
    const api = window.__SBS_TEST_API;
    return api.state.project.sections.find((section) => section.family === 'hero').patternId;
  })).toBe(patternId);
  // Returns the reading that satisfied the wait, so callers measure the page
  // that was checked rather than asking again and risking a rebuild in between.
  return measureWhen(() => measure(page), (value) => Boolean(value.patternReady && (!until || until(value))));
}

function measure(page) {
  return page.locator('#sitePreview').evaluate((frame) => {
    const doc = frame.contentDocument;
    const inner = doc.querySelector('.sbs-hero .dst-banner__inner');
    if (!inner) return null;
    const container = inner.parentElement;
    const heading = inner.querySelector('.c-heading');
    const title = inner.querySelector('.c-heading__title');
    const content2 = inner.querySelector('.dst-content2');
    const box = (element) => element.getBoundingClientRect();
    const containerBox = box(container);
    const innerBox = box(inner);
    const styles = getComputedStyle(container);
    return {
      patternReady: Boolean(title),
      containerWidth: Math.round(containerBox.width),
      innerWidth: Math.round(innerBox.width),
      // Measured against the container's padding box: the gutter is the
      // container's padding and belongs to neither side's alignment.
      leftGap: Math.round(innerBox.left - containerBox.left - Number.parseFloat(styles.paddingLeft)),
      rightGap: Math.round(containerBox.right - Number.parseFloat(styles.paddingRight) - innerBox.right),
      centred: heading ? heading.classList.contains('text-center') || heading.classList.contains('-center') : false,
      hasContent2: Boolean(content2),
      copyWidth: content2 ? Math.round(box(content2.querySelector('.sbs-copy-col')).width) : 0,
      mediaWidth: content2 ? Math.round(box(content2.querySelector('.sbs-media-col')).width) : 0,
    };
  });
}

test.describe('hero fit', () => {
  test('a hero with a centred heading centres its inner', async ({ page }) => {
    await boot(page);
    // One reading, taken once the swap has settled: the centring is what is
    // being waited for and what is then asserted.
    const hero = await useHeroPattern(page, 'sbs-hero-p30-v1', (entry) => entry.centred && Math.abs(entry.leftGap - entry.rightGap) <= 1);
    expect(hero.centred).toBe(true);
    // The inner is still capped, but the leftover room is split evenly.
    expect(hero.innerWidth).toBeLessThan(hero.containerWidth);
    expect(hero.leftGap).toBeGreaterThan(40);
  });

  test('a hero with a left-aligned heading stays left-aligned', async ({ page }) => {
    await boot(page);
    const hero = await useHeroPattern(page, 'sbs-hero-p5-v3', (entry) => !entry.centred && !entry.hasContent2 && entry.leftGap <= 1);
    expect(hero.centred).toBe(false);
    expect(hero.rightGap).toBeGreaterThan(100);
  });

  test('a two-column hero uses the authored width instead of the single-column cap', async ({ page }) => {
    await boot(page);
    for (const patternId of ['sbs-hero-p1-v1', 'sbs-hero-p1-v3']) {
      const hero = await useHeroPattern(page, patternId, (entry) => entry.hasContent2);
      expect(hero.hasContent2, patternId).toBe(true);
      // The cap was min(86rem, 70vw) — 860px inside a 1440px container.
      expect(hero.innerWidth, patternId).toBeGreaterThan(1200);
      expect(hero.innerWidth, patternId).toBeLessThanOrEqual(hero.containerWidth);
      // Neither column may end up squeezed into a third of the page.
      expect(hero.copyWidth, patternId).toBeGreaterThan(hero.containerWidth * 0.35);
      expect(hero.mediaWidth, patternId).toBeGreaterThan(hero.containerWidth * 0.35);
    }
  });

  test('a two-column hero lets its headline use the column, not the hero measure', async ({ page }) => {
    await boot(page);
    await useHeroPattern(page, 'sbs-hero-p1-v1', (hero) => hero.hasContent2);
    const title = await page.locator('#sitePreview').evaluate((frame) => {
      const element = frame.contentDocument.querySelector('.sbs-hero .dst-content2 .c-heading__title');
      const column = element.closest('.sbs-copy-col');
      return {
        width: Math.round(element.getBoundingClientRect().width),
        columnWidth: Math.round(column.getBoundingClientRect().width),
        lines: Math.round(element.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(element).lineHeight)),
      };
    });
    // The column is the constraint now, so the headline fills it.
    expect(title.width).toBeGreaterThan(title.columnWidth * 0.85);
    expect(title.lines).toBeLessThanOrEqual(4);
  });

  test('an authored narrower contentWidth is still honoured', async ({ page }) => {
    await boot(page);
    await useHeroPattern(page, 'sbs-hero-p1-v1', (hero) => hero.hasContent2);
    // The correction falls back to `--cw`; it must not override a deliberate
    // authored width with 100%.
    await page.locator('#sitePreview').evaluate((frame) => {
      frame.contentDocument.querySelector('.sbs-hero .dst-banner__inner').style.setProperty('--cw', '60%');
    });
    const constrained = await measure(page);
    expect(constrained.innerWidth).toBeLessThan(constrained.containerWidth * 0.65);
  });

  test('the corrections travel into the exported standalone HTML', async ({ page }) => {
    await boot(page);
    const html = await page.evaluate(() => window.__SBS_TEST_API.buildSiteDocument());
    expect(html).toContain('.dst-banner__inner:has(> .c-heading.text-center)');
    expect(html).toContain('.dst-banner__inner:has(> .dst-content2)');
    expect(html).toContain('max-width:var(--cw,100%)');
  });
});
