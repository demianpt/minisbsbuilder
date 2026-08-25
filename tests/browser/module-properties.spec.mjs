import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';
import { previewSettled } from './support/preview.mjs';

/**
 * Changing a module's properties leaves the preview exactly where it is.
 *
 * Every control in the module editor used to queue a rebuild of the whole
 * preview document, and a rebuilt `srcdoc` opens at the top before the scroll
 * restore walks it back down. So choosing "Space above: None" on a band halfway
 * down the page threw the page away and glided it back — and the band being
 * spaced was somewhere in the middle of that journey.
 *
 * Every test here asserts the same two facts, which together are the whole
 * feature: the frame did not reload (`window.__loads` stays at 0) and the
 * scroll position is unchanged *to the pixel*. Each one also proves the change
 * actually reached the live document, because a preview that never updates
 * would pass the first two trivially.
 */

async function openModules(page) {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.locator('[data-step="3"]').click();
  await previewSettled(page);
}

/**
 * Selects a module well down the page, opens one of its editor tabs, scrolls
 * the band into view and starts counting document loads.
 *
 * The module is deliberately not the first: a band already at scroll 0 cannot
 * show whether the page moved.
 */
async function focusModule(page, tab, { index = 2 } = {}) {
  const id = await page.evaluate(({ wantedTab, at }) => {
    const api = window.__SBS_TEST_API;
    const section = api.state.project.sections[at] || api.state.project.sections[0];
    api.state.selectedSectionId = section.id;
    api.state.editorTab = wantedTab;
    return section.id;
  }, { wantedTab: tab, at: index });
  await page.locator('[data-step="3"]').click();
  await previewSettled(page);

  await page.evaluate((sectionId) => {
    const frame = document.getElementById('sitePreview');
    window.__loads = 0;
    frame.addEventListener('load', () => { window.__loads += 1; });
    frame.contentDocument.getElementById(sectionId).scrollIntoView({ block: 'center', behavior: 'instant' });
  }, id);
  await page.waitForTimeout(300);
  const scroll = await page.locator('#sitePreview').evaluate((frame) => frame.contentWindow.scrollY);
  expect(scroll, 'the band under test was not scrolled away from the top').toBeGreaterThan(50);
  return { id, scroll };
}

/** The frame never reloaded, never fell back to a rebuild, and never moved. */
async function heldStill(page, scroll) {
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(() => window.__SBS_TEST_API.paint.rebuilt()),
    'a repaint degraded into a full rebuild',
  ).toBe(0);
  expect(await page.evaluate(() => window.__loads), 'the preview frame was rebuilt').toBe(0);
  expect(
    await page.locator('#sitePreview').evaluate((frame) => frame.contentWindow.scrollY),
    'the preview scrolled away from the module being edited',
  ).toBe(scroll);
}

/** The live class list of a band inside the preview. */
const bandClasses = (page, id) => page.locator('#sitePreview').evaluate((frame, sectionId) => {
  const band = frame.contentDocument.getElementById(sectionId);
  return band ? band.className : '';
}, id);

test.describe('a module property change does not move the preview', () => {
  test('space above is applied in place', async ({ page }) => {
    await openModules(page);
    const { id, scroll } = await focusModule(page, 'layout');

    await page.locator(`[data-bind="setting.${id}.paddingTop"]`).selectOption('none');

    // `none` above renders as the `dt-0` rhythm class on the band itself.
    await expect.poll(() => bandClasses(page, id)).toContain('dt-0');
    await heldStill(page, scroll);
  });

  test('space below is applied in place', async ({ page }) => {
    await openModules(page);
    const { id, scroll } = await focusModule(page, 'layout');

    await page.locator(`[data-bind="setting.${id}.paddingBottom"]`).selectOption('large');

    await expect.poll(() => bandClasses(page, id)).toContain('db-l');
    await heldStill(page, scroll);
  });

  test('flipping a band between light and dark is applied in place', async ({ page }) => {
    await openModules(page);
    const { id, scroll } = await focusModule(page, 'layout');
    // The band at this position in the demo page may open either way, so the
    // test flips it to whichever tone it is not.
    const wasDark = (await bandClasses(page, id)).includes('is-style-colors-inverted');

    await page.locator(`[data-bind="setting.${id}.inverted"]`).selectOption(wasDark ? 'false' : 'true');

    await expect.poll(async () => (await bandClasses(page, id)).includes('is-style-colors-inverted')).toBe(!wasDark);
    await heldStill(page, scroll);
  });

  test('the content measure is applied in place', async ({ page }) => {
    await openModules(page);
    const { id, scroll } = await focusModule(page, 'layout');

    // The rendered container class, not its width: a `default` container is
    // already capped at the preview's own width in this viewport, so measuring
    // pixels would compare 1440 against 1440 and prove nothing either way.
    const measure = () => page.locator('#sitePreview').evaluate((frame, sectionId) => {
      const inner = frame.contentDocument.querySelector(`[id="${sectionId}"] .dst-wrapper__inner`);
      return inner ? inner.className : '';
    }, id);
    expect(await measure()).not.toContain('c-full');

    await page.locator(`[data-bind="setting.${id}.container"]`).selectOption('full');

    await expect.poll(measure).toContain('c-full');
    await heldStill(page, scroll);
  });

  test('an arrival effect is applied in place, and does not replay', async ({ page }) => {
    await openModules(page);
    const { id, scroll } = await focusModule(page, 'layout');

    await page.locator(`[data-bind="effect.${id}.viewport"]`).selectOption('zoom-in');

    // The repainted band carries the new effect and is already revealed: an
    // entrance animation replaying under the cursor is the same complaint in a
    // different costume.
    await expect.poll(() => page.locator('#sitePreview').evaluate((frame, sectionId) => {
      const band = frame.contentDocument.getElementById(sectionId);
      if (!band) return '';
      return `${band.getAttribute('data-viewport-effect')}|${band.classList.contains('in-view')}`;
    }, id)).toBe('zoom-in|true');
    await heldStill(page, scroll);
  });

  test('a decorative motif is applied in place', async ({ page }) => {
    await openModules(page);
    const { id, scroll } = await focusModule(page, 'layout');
    const motif = await page.locator(`[data-bind="decoration.${id}.motif"] option`).nth(1).getAttribute('value');

    await page.locator(`[data-bind="decoration.${id}.motif"]`).selectOption(motif);

    await expect.poll(() => bandClasses(page, id)).toContain('has-deco');
    await heldStill(page, scroll);
  });

  test('dragging a slider repaints without rebuilding, once the gesture ends', async ({ page }) => {
    await openModules(page);
    const { id, scroll } = await focusModule(page, 'layout');
    await page.locator(`[data-bind="decoration.${id}.motif"]`).selectOption(
      await page.locator(`[data-bind="decoration.${id}.motif"] option`).nth(1).getAttribute('value'),
    );
    await expect.poll(() => bandClasses(page, id)).toContain('has-deco');

    // A dragged slider fires `input` per pixel. Fifteen of them in a row is the
    // shape that would rebuild the document fifteen times.
    const slider = page.locator(`[data-bind="decoration.${id}.opacity"]`);
    await slider.evaluate((input) => {
      for (let step = 10; step <= 80; step += 5) {
        input.value = String(step);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect.poll(() => page.evaluate((sectionId) => {
      const section = window.__SBS_TEST_API.state.project.sections.find((entry) => entry.id === sectionId);
      return section.decoration ? Number(section.decoration.opacity).toFixed(2) : '';
    }, id)).toBe('0.80');
    await heldStill(page, scroll);
  });

  test('typing a headline updates the band without moving the page', async ({ page }) => {
    await openModules(page);
    const { id, scroll } = await focusModule(page, 'content');

    await page.locator(`[data-bind="section.${id}.title"]`).fill('A headline typed in place');

    await expect.poll(() => page.locator('#sitePreview').evaluate((frame, sectionId) => {
      const band = frame.contentDocument.getElementById(sectionId);
      return band ? band.textContent : '';
    }, id)).toContain('A headline typed in place');
    await heldStill(page, scroll);
  });

  test('adding a repeated item updates the band without moving the page', async ({ page }) => {
    await openModules(page);
    // A module that repeats items, so the repeater is the one on screen.
    const index = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections
      .findIndex((section, at) => at > 0 && (section.content.items || []).length >= 2));
    test.skip(index < 0, 'the demo page has no module with repeated items below the fold');
    const { id, scroll } = await focusModule(page, 'content', { index });

    const cards = () => page.locator('#sitePreview').evaluate((frame, sectionId) => {
      const band = frame.contentDocument.getElementById(sectionId);
      return band ? band.querySelectorAll('[data-dst-component]').length : 0;
    }, id);
    const before = await cards();

    await page.locator('#editorInner [data-add-item]').first().click();

    await expect.poll(cards).toBeGreaterThan(before);
    await heldStill(page, scroll);
  });

  test('a change the frame cannot absorb still falls back to a rebuild', async ({ page }) => {
    await openModules(page);
    const { scroll } = await focusModule(page, 'layout');

    // The design dials are not a module: they rewrite the document stylesheet,
    // so they must keep the rebuild rather than repaint one band.
    await page.locator('[data-step="1"]').click();
    await page.locator('[data-bind="design.density"]').first().evaluate((input) => {
      input.value = '90';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__loads), 'a design dial must still rebuild').toBeGreaterThan(0);
    expect(scroll).toBeGreaterThan(50);
  });
});
