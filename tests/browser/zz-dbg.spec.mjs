import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';
import { previewSettled } from './support/preview.mjs';

test('why does the picker reload', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.locator('[data-step="3"]').click();
  await previewSettled(page);
  const id = await page.evaluate(() => {
    const api = window.__SBS_TEST_API;
    const s = api.state.project.sections.find((x) => api.media.sectionSlots(x).filter((k) => k.role === 'card').length >= 2);
    api.state.selectedSectionId = s.id; api.state.editorTab = 'media';
    return s.id;
  });
  await page.locator('[data-step="3"]').click();
  await previewSettled(page);
  await page.evaluate(() => {
    const frame = document.getElementById('sitePreview');
    window.__loads = 0;
    window.__srcdocSets = 0;
    frame.addEventListener('load', () => { window.__loads += 1; });
    const proto = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
    Object.defineProperty(frame, 'srcdoc', {
      get() { return proto.get.call(this); },
      set(value) { window.__srcdocSets += 1; window.__lastStack = new Error().stack.split('\n').slice(1, 6).join(' | '); proto.set.call(this, value); },
    });
  });
  await page.locator('#editorInner .media-option[data-media-index]').nth(3).click();
  await page.waitForTimeout(900);
  console.log('===', JSON.stringify(await page.evaluate(() => ({ loads: window.__loads, sets: window.__srcdocSets, stack: window.__lastStack })), null, 1));
});
