import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';
import { previewSettled } from './support/preview.mjs';

/**
 * The production form id is the one thing about a form you must be able to say.
 *
 * Ten patterns embed `gravityforms/form`, all carrying `formId: "1"` from the
 * DST staging site. That attribute is exempt from the registry filter, so it
 * reaches WordPress verbatim — where form 1 is a different form, or none, and
 * the contact band imports empty. There was no control for it anywhere.
 */

async function openContact(page) {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));

  const id = await page.evaluate(() => {
    const api = window.__SBS_TEST_API;
    const pattern = api.catalog.all().find((entry) => entry.flags.form);
    if (!pattern) return '';
    const section = api.createSection(pattern.family, 0, pattern.id);
    api.state.project.sections.push(section);
    api.state.selectedSectionId = section.id;
    api.state.editorTab = 'content';
    // Changing step deliberately does *not* rebuild the preview — that is the
    // whole point of the repaint work — so a band added from outside the editor
    // has to ask for one. It cannot be patched in (it is not in the document
    // yet), so this falls back to the rebuild, which is the correct answer here.
    api.paint.queue(section);
    return section.id;
  });
  if (!id) throw new Error('no pattern in the library embeds a form');
  await page.locator('[data-step="3"]').click();
  await page.waitForFunction((sectionId) => {
    const frame = document.getElementById('sitePreview');
    return Boolean(frame && frame.contentDocument && frame.contentDocument.getElementById(sectionId));
  }, id);
  await previewSettled(page);
  return id;
}

test.describe('a module with a form asks which form', () => {
  test('the control is there, and only where there is a form', async ({ page }) => {
    const id = await openContact(page);
    await expect(page.locator(`[data-bind="form.${id}.formId"]`)).toBeVisible();

    // A module with no form must not offer the control: a field that cannot land
    // anywhere is worse than no field.
    await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const plain = api.state.project.sections.find((section) => section.family === 'hero');
      api.state.selectedSectionId = plain.id;
    });
    await page.locator('[data-step="3"]').click();
    await expect(page.locator('[data-bind$=".formId"]')).toHaveCount(0);
  });

  test('the id reaches the project, the preview and the export', async ({ page }) => {
    const id = await openContact(page);
    await page.locator(`[data-bind="form.${id}.formId"]`).fill('37');

    // The project holds it…
    await expect.poll(() => page.evaluate((sectionId) => {
      const api = window.__SBS_TEST_API;
      const section = api.state.project.sections.find((entry) => entry.id === sectionId);
      const form = api.catalog.nodes(section.node).find((node) => node.component === 'gravityforms/form');
      return form ? form.attributes.formId : '';
    }, id)).toBe('37');

    // …the preview slot says so, so the control is not invisible…
    await expect.poll(() => page.locator('#sitePreview').evaluate((frame, sectionId) => {
      const band = frame.contentDocument.getElementById(sectionId);
      const head = band && band.querySelector('.sbs-form-slot__head b');
      return head ? head.textContent : '';
    }, id)).toBe('Form 37');

    // …and the export carries it rather than the staging id.
    const exported = await page.evaluate(() => JSON.stringify(window.__SBS_TEST_API.buildCompleteExport()));
    expect(exported).toContain('"formId":"37"');
    expect(exported).not.toContain('"formId":"1"');
  });

  test('only digits, because the block attribute is a form number', async ({ page }) => {
    const id = await openContact(page);
    await page.locator(`[data-bind="form.${id}.formId"]`).fill('gform_12x');
    await expect.poll(() => page.evaluate((sectionId) => {
      const api = window.__SBS_TEST_API;
      const section = api.state.project.sections.find((entry) => entry.id === sectionId);
      const form = api.catalog.nodes(section.node).find((node) => node.component === 'gravityforms/form');
      return form.attributes.formId;
    }, id)).toBe('12');
  });

  test('changing it does not move the preview either', async ({ page }) => {
    const id = await openContact(page);
    await page.evaluate((sectionId) => {
      const frame = document.getElementById('sitePreview');
      window.__loads = 0;
      frame.addEventListener('load', () => { window.__loads += 1; });
      frame.contentDocument.getElementById(sectionId).scrollIntoView({ block: 'center', behavior: 'instant' });
    }, id);
    await page.waitForTimeout(300);
    const before = await page.locator('#sitePreview').evaluate((frame) => frame.contentWindow.scrollY);

    await page.locator(`[data-bind="form.${id}.formId"]`).fill('9');

    await expect.poll(() => page.locator('#sitePreview').evaluate((frame, sectionId) => {
      const head = frame.contentDocument.querySelector(`[id="${sectionId}"] .sbs-form-slot__head b`);
      return head ? head.textContent : '';
    }, id)).toBe('Form 9');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__loads)).toBe(0);
    expect(await page.locator('#sitePreview').evaluate((frame) => frame.contentWindow.scrollY)).toBe(before);
  });
});
