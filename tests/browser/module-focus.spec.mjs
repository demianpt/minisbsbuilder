import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';
import { previewSettled } from './support/preview.mjs';

/**
 * "Edit module", from the preview to the controls.
 *
 * The button changed step and left the editor at the top of it, which in the
 * modules step is the brief reader, then the imagery panel, then the sequence —
 * so the thing that had just been asked for was several screens below the fold
 * with nothing to say it had moved. The step now travels to the module editor
 * and marks it on arrival.
 */

async function openPreview(page, { simple = false } = {}) {
  await page.addInitScript(() => localStorage.clear());
  if (!simple) await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await previewSettled(page);
}

/** Puts the pointer on a module and returns the id the overlay reports. */
async function hoverModule(page) {
  const stage = await page.locator('.preview-stage').boundingBox();
  for (let y = 90; y < stage.height - 10; y += 26) {
    await page.mouse.move(stage.x + stage.width / 2, stage.y + y);
    await page.mouse.move(stage.x + stage.width / 2 + 2, stage.y + y + 1);
    await page.waitForTimeout(50);
    const hovered = await page.evaluate(() => window.__SBS_TEST_API.previewSwitcher.hoverId());
    if (hovered && !hovered.startsWith('@')) return hovered;
  }
  throw new Error('the overlay never reported a module under the pointer');
}

const editorScroll = (page) => page.evaluate(() => document.querySelector('.editor').scrollTop);

/** The scroll position once the animation has finished moving it. */
async function settledScroll(page) {
  let last = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const at = await editorScroll(page);
    if (at === last) return at;
    last = at;
    await page.waitForTimeout(80);
  }
  return last;
}

/** Where the module editor sits relative to the editor pane's own viewport. */
const panelPosition = (page) => page.evaluate(() => {
  const view = document.querySelector('.editor');
  const panel = document.querySelector('#editorInner [data-module-editor]');
  if (!panel) return null;
  const viewBox = view.getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  return { top: box.top - viewBox.top, height: viewBox.height, revealed: panel.classList.contains('is-revealed') };
});

test.describe('editing a module from the preview lands on the controls', () => {
  test('the advanced builder scrolls to the module editor instead of stopping at the top', async ({ page }) => {
    await openPreview(page);
    const id = await hoverModule(page);
    await page.locator('#previewHud [data-pv="edit"]').click();

    // The right step, and the module that was hovered.
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.currentStep)).toBe(3);
    expect(await page.evaluate(() => window.__SBS_TEST_API.state.selectedSectionId)).toBe(id);

    expect(await settledScroll(page), 'the editor never scrolled to the module editor').toBeGreaterThan(120);
    const at = await panelPosition(page);
    expect(at, 'the module editor panel was not rendered').not.toBeNull();
    // Visible, and near the top rather than merely somewhere on the page.
    expect(at.top).toBeGreaterThan(-4);
    expect(at.top).toBeLessThan(at.height / 2);
  });

  test('the panel it landed on says so for a moment', async ({ page }) => {
    await openPreview(page);
    await hoverModule(page);
    await page.locator('#previewHud [data-pv="edit"]').click();
    await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('#editorInner [data-module-editor].is-revealed')))).toBe(true);
    // And it is a moment, not a permanent highlight.
    await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('#editorInner [data-module-editor].is-revealed'))), { timeout: 4_000 }).toBe(false);
  });

  test('the travel is animated, so the page is not just somewhere else', async ({ page }) => {
    await openPreview(page);
    await hoverModule(page);
    await page.locator('#previewHud [data-pv="edit"]').click();
    // Sampled straight away: an instant jump is already at its destination on
    // the first frame, an animated one is still on its way.
    const early = await editorScroll(page);
    await expect.poll(() => editorScroll(page)).toBeGreaterThan(120);
    const settled = await editorScroll(page);
    expect(early, 'the scroll finished before a single frame had passed').toBeLessThan(settled);
  });

  test('with motion switched off it arrives instantly, and still arrives', async ({ page }) => {
    await openPreview(page);
    await page.evaluate(() => { window.__SBS_TEST_API.state.project.design.motion = 0; });
    await hoverModule(page);
    await page.locator('#previewHud [data-pv="edit"]').click();
    expect(await settledScroll(page)).toBeGreaterThan(120);
    const at = await panelPosition(page);
    expect(at.top).toBeLessThan(at.height / 2);
  });

  test('the simple builder lands on its own module editor, two steps along', async ({ page }) => {
    await openPreview(page, { simple: true });
    // The simple builder's first step cannot be left until a concept is chosen,
    // and choosing one is the AI job. One concept, seeded the way the other
    // simple-builder specs seed it, is the precondition rather than the subject.
    await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const simple = api.simple.ensure();
      simple.briefText = 'A family dental practice in Portsmouth that needs nervous adults to book online.';
      simple.concepts = api.simple.normalizeConcepts([{ name: 'Calm first', archetypeKey: 'A', preset: 'editorial', buttonStyle: 'solid-shift', dialOverrides: {}, why: 'Plain and quiet.' }]);
      simple.active = 0;
      api.simple.setMode('simple', { force: true });
    });
    await previewSettled(page);
    await hoverModule(page);
    await page.locator('#previewHud [data-pv="edit"]').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.currentStep)).toBe(2);
    expect(await settledScroll(page)).toBeGreaterThan(120);
  });
});
