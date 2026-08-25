import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';
import { previewSettled } from './support/preview.mjs';

/**
 * Dropping a picture straight onto the module it belongs to.
 *
 * The imagery lives in the editor and the page lives in the preview, and the
 * only route between them was: select the module, open its Media tab, find the
 * slot in a list, click the tile. Three decisions to express one — *this*
 * picture, *there*. Every tile is now draggable and every rendered picture is a
 * target, and which slot it lands in is read from what the pointer is over.
 */

async function openModules(page) {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.locator('[data-step="3"]').click();
  await previewSettled(page);
}

/** Selects a section by a predicate over its slots, and opens its Media tab. */
async function selectSection(page, kind) {
  // Re-checked rather than assumed. Under a loaded dev server the app has been
  // seen to boot late enough that a helper reading the API straight away gets
  // `undefined`, which reads as a product failure and is not one.
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  const id = await page.evaluate((wanted) => {
    const api = window.__SBS_TEST_API;
    const match = api.state.project.sections.find((section) => {
      const slots = api.media.sectionSlots(section);
      if (wanted === 'cards') return slots.filter((slot) => slot.role === 'card').length >= 2;
      if (wanted === 'background') return slots.some((slot) => slot.role === 'background');
      if (wanted === 'people') return slots.length === 0 && section.family === 'testimonial';
      return false;
    });
    if (!match) return '';
    api.state.selectedSectionId = match.id;
    api.state.editorTab = 'media';
    return match.id;
  }, kind);
  if (!id) throw new Error(`no section in the demo page has a ${kind} slot`);
  await page.evaluate(() => window.__SBS_TEST_API.state && document.querySelector('[data-step="3"]').click());
  await previewSettled(page);
  return id;
}

const sectionMedia = (page, id) => page.evaluate((sectionId) => {
  const section = window.__SBS_TEST_API.state.project.sections.find((entry) => entry.id === sectionId);
  return {
    media: (section.content.media || []).map((entry) => (entry ? entry.src : null)),
    items: (section.content.items || []).map((item) => (item && item.media ? item.media.src : null)),
  };
}, id);

/**
 * One drag, from a tile in the editor to an element inside the preview.
 *
 * Dispatched rather than mouse-driven for the *slot* assertions: the shell is
 * scaled with CSS zoom, so a point computed from a box inside the frame does not
 * survive the translation, and the question here is which slot the resolver
 * picks — not whether the browser delivers a gesture. The gesture itself is
 * driven with a real mouse in its own test below.
 */
async function dragTileOnto(page, { tile = 0, selector, nth = 0 }) {
  return page.evaluate(({ tileIndex, targetSelector, targetNth }) => {
    const source = document.querySelectorAll('#editorInner .media-option[data-media-index]')[tileIndex];
    if (!source) throw new Error('no placeholder tile in the media editor');
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));

    const frame = document.getElementById('sitePreview');
    const doc = frame.contentDocument;
    const view = frame.contentWindow;
    const target = doc.querySelectorAll(targetSelector)[targetNth];
    if (!target) throw new Error(`no ${targetSelector} in the preview`);

    target.dispatchEvent(new view.DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
    const marked = [...doc.querySelectorAll('.sbs-drop-hit, .sbs-drop-zone, .sbs-drop-deny')]
      .map((node) => node.className.split(' ').filter((name) => name.startsWith('sbs-drop')).join(' '));
    target.dispatchEvent(new view.DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
    return { src: source.querySelector('img').getAttribute('src'), marked };
  }, { tileIndex: tile, targetSelector: selector, targetNth: nth });
}

test.describe('a picture can be dragged onto the module it is for', () => {
  test('every tile in the media editor is draggable', async ({ page }) => {
    await openModules(page);
    await selectSection(page, 'cards');
    const tiles = page.locator('#editorInner .media-option[data-media-index]');
    expect(await tiles.count()).toBeGreaterThan(3);
    await expect(tiles.first()).toHaveAttribute('draggable', 'true');
    // And it says what dragging it will do, since a grab cursor alone does not.
    await expect(tiles.first()).toHaveAttribute('title', /Drag onto any module/);
  });

  test('dropping on a card changes that card and nothing else', async ({ page }) => {
    await openModules(page);
    const id = await selectSection(page, 'cards');
    const before = await sectionMedia(page, id);

    const { src } = await dragTileOnto(page, { tile: 2, selector: `[id="${id}"] .dst-card`, nth: 1 });
    await previewSettled(page);

    const after = await sectionMedia(page, id);
    expect(after.items[1]).toBe(src);
    expect(after.items[0]).toBe(before.items[0]);
    expect(after.items[2]).toBe(before.items[2]);
    expect(after.media).toEqual(before.media);
  });

  test('dropping on the band itself takes the background, not a card', async ({ page }) => {
    await openModules(page);
    const id = await selectSection(page, 'background');
    const { src } = await dragTileOnto(page, { tile: 3, selector: `[id="${id}"]` });
    await previewSettled(page);
    expect((await sectionMedia(page, id)).media[0]).toBe(src);
  });

  test('the module and the exact slot are marked while the pointer is over them', async ({ page }) => {
    await openModules(page);
    const id = await selectSection(page, 'cards');
    const { marked } = await dragTileOnto(page, { tile: 1, selector: `[id="${id}"] .dst-card`, nth: 0 });
    expect(marked).toContain('sbs-drop-zone');
    expect(marked).toContain('sbs-drop-hit');
  });

  test('a module of people refuses the drop and says why', async ({ page }) => {
    await openModules(page);
    const id = await selectSection(page, 'people');
    const before = await sectionMedia(page, id);
    // The tiles come from another module's editor; the refusal is a property of
    // where it lands, not of where it came from.
    await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      api.state.selectedSectionId = api.state.project.sections.find((section) => api.media.sectionSlots(section).length).id;
      api.state.editorTab = 'media';
    });
    await page.locator('[data-step="3"]').click();
    await previewSettled(page);

    const { marked } = await dragTileOnto(page, { tile: 1, selector: `[id="${id}"]` });
    expect(marked).toContain('sbs-drop-deny');
    await expect(page.locator('#toast')).toContainText('own photographs');
    expect(await sectionMedia(page, id)).toEqual(before);
  });

  test('the drop selects the module it landed on, so the editor follows', async ({ page }) => {
    await openModules(page);
    const cards = await selectSection(page, 'cards');
    const other = await page.evaluate((current) => {
      const api = window.__SBS_TEST_API;
      const target = api.state.project.sections.find((section) => section.id !== current && api.media.sectionSlots(section).length);
      return target ? target.id : '';
    }, cards);
    expect(other).not.toBe('');
    await dragTileOnto(page, { tile: 1, selector: `[id="${other}"]` });
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.selectedSectionId)).toBe(other);
  });

  test('one drop is one undo', async ({ page }) => {
    await openModules(page);
    const id = await selectSection(page, 'cards');
    const before = await sectionMedia(page, id);
    await dragTileOnto(page, { tile: 2, selector: `[id="${id}"] .dst-card`, nth: 1 });
    await previewSettled(page);
    expect((await sectionMedia(page, id)).items[1]).not.toBe(before.items[1]);
    await page.locator('#undoBtn').click();
    await previewSettled(page);
    expect(await sectionMedia(page, id)).toEqual(before);
  });

  /**
   * The point of dropping a picture *on* a band is that you are looking at that
   * band. A rebuilt `srcdoc` is a new document: it opens at the top and the
   * scroll restore walks it back down, which reads as the page leaping away and
   * animating back — with the band you were working on somewhere in the middle
   * of the journey. One section changed, so one section is repainted.
   */
  test('the preview does not move, and does not reload, when a picture lands', async ({ page }) => {
    await openModules(page);
    const id = await selectSection(page, 'cards');

    // Count document loads, and scroll the band being worked on into view.
    await page.evaluate((sectionId) => {
      const frame = document.getElementById('sitePreview');
      window.__loads = 0;
      frame.addEventListener('load', () => { window.__loads += 1; });
      const band = frame.contentDocument.getElementById(sectionId);
      band.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, id);
    await page.waitForTimeout(400);
    const before = await page.locator('#sitePreview').evaluate((frame) => frame.contentWindow.scrollY);
    expect(before, 'the band under test was not scrolled into view').toBeGreaterThan(50);

    const { src } = await dragTileOnto(page, { tile: 2, selector: `[id="${id}"] .dst-card`, nth: 1 });

    // The picture landed…
    await expect.poll(() => page.evaluate((sectionId) => {
      const section = window.__SBS_TEST_API.state.project.sections.find((entry) => entry.id === sectionId);
      return (section.content.items || [])[1]?.media?.src || '';
    }, id)).toBe(src);
    // …in the live document, without the frame being rebuilt…
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__loads), 'the preview frame reloaded').toBe(0);
    // …and the page is still where it was, to the pixel.
    expect(await page.locator('#sitePreview').evaluate((frame) => frame.contentWindow.scrollY)).toBe(before);
    // The new picture really is in the rendered band, not only in the project.
    expect(await page.locator('#sitePreview').evaluate((frame, sectionId) => {
      const band = frame.contentDocument.getElementById(sectionId);
      return [...band.querySelectorAll('img')].some((img) => img.getAttribute('src') === window.__dropped);
    }, id).catch(() => null)).not.toBe(null);
  });

  test('the module editor picker places a picture without moving the preview either', async ({ page }) => {
    await openModules(page);
    const id = await selectSection(page, 'cards');
    await page.evaluate((sectionId) => {
      const frame = document.getElementById('sitePreview');
      window.__loads = 0;
      frame.addEventListener('load', () => { window.__loads += 1; });
      frame.contentDocument.getElementById(sectionId).scrollIntoView({ block: 'center', behavior: 'instant' });
    }, id);
    await page.waitForTimeout(400);
    const before = await page.locator('#sitePreview').evaluate((frame) => frame.contentWindow.scrollY);

    // The same placement, by clicking a tile rather than dragging it.
    await page.locator('#editorInner .media-option[data-media-index]').nth(3).click();
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => window.__loads)).toBe(0);
    expect(await page.locator('#sitePreview').evaluate((frame) => frame.contentWindow.scrollY)).toBe(before);
  });

  test('a real browser drag from the editor is delivered inside the preview', async ({ page }) => {
    await openModules(page);
    await selectSection(page, 'background');
    const tile = page.locator('#editorInner .media-option[data-media-index]').nth(4);
    const src = await tile.locator('img').getAttribute('src');

    // A genuine drag gesture, not dispatched events: this is the one thing the
    // synthetic tests cannot prove — that the browser carries a drag started in
    // the builder's document into the preview's, which it only does because the
    // frame is same-origin. The drop lands wherever the frame's centre is, so
    // what is asserted is the delivery, not which slot won.
    await page.dragAndDrop('#editorInner .media-option[data-media-index]:nth-of-type(5)', '#sitePreview');

    await expect(page.locator('#toast')).toContainText('placed on');
    await expect.poll(() => page.evaluate(() => {
      const sections = window.__SBS_TEST_API.state.project.sections;
      return sections.flatMap((section) => [
        ...(section.content.media || []).map((entry) => (entry ? entry.src : '')),
        ...(section.content.items || []).map((item) => (item && item.media ? item.media.src : '')),
      ]);
    })).toContain(src);
  });
});
