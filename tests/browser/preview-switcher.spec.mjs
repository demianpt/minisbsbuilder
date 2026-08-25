import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';
import { previewSettled } from './support/preview.mjs';

/**
 * Switching a module's pattern from the preview, and the two heading defects
 * that made a pattern impossible to judge once it was on screen.
 */

/** Opens the builder on Step 04 with a settled preview. */
async function openModules(page) {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.locator('[data-step="3"]').click();
  const preview = page.locator('#sitePreview');
  await expect.poll(() => preview.evaluate((frame) => Boolean(frame.contentDocument?.querySelector('#sbs-site')))).toBe(true);
  // #sbs-site exists in the outgoing document too, so that poll can be
  // satisfied by a frame that is about to be replaced.
  await previewSettled(page);
  return preview;
}

/** Puts the pointer over a module in the preview and waits for the overlay. */
async function hoverModule(page, index) {
  const offset = await page.evaluate((n) => {
    const api = window.__SBS_TEST_API;
    const frame = document.getElementById('sitePreview');
    const doc = frame.contentDocument;
    const section = doc.getElementById(api.state.project.sections[n].id);
    frame.contentWindow.scrollTo(0, section.getBoundingClientRect().top + frame.contentWindow.scrollY - 40);
    return 120;
  }, index);
  const box = await page.locator('#sitePreview').boundingBox();
  // Two moves: the first can land before the scroll settles, and a hover is
  // only registered on a move that changes the module under the pointer.
  await page.mouse.move(box.x + box.width / 2, box.y + offset);
  await page.mouse.move(box.x + box.width / 2 + 3, box.y + offset + 3);
  await expect(page.locator('#previewHud')).toBeVisible();
}

/** Presses one of the overlay's arrows at its own coordinates. */
async function pressArrow(page, direction) {
  const rect = await page.evaluate((d) => {
    const button = document.querySelector(`.pv-hud__arrow.-${d}`);
    const box = button.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, direction);
  await page.mouse.click(rect.x, rect.y);
}

test.describe('switching patterns from the preview', () => {
  test('hovering a module names its pattern and its place in the family', async ({ page }) => {
    await openModules(page);
    await hoverModule(page, 0);

    const overlay = await page.evaluate(() => ({
      pattern: document.querySelector('.pv-hud__copy b').textContent,
      family: document.querySelector('.pv-hud__copy span').textContent,
      count: document.querySelector('.pv-hud__count').textContent,
      hoverId: window.__SBS_TEST_API.previewSwitcher.hoverId(),
    }));

    const section = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0]);
    expect(overlay.hoverId).toBe(section.id);
    expect(overlay.family).toBe('Hero');
    expect(overlay.count).toMatch(/^\d+ \/ \d+$/);
    // The overlay names the pattern the module is actually on.
    expect(overlay.pattern.toLowerCase().replace(/[^a-z0-9]/g, '')).toContain(section.patternId.replace(/[^a-z0-9]/g, ''));
  });

  test('an arrow steps the module to the next pattern in its own family', async ({ page }) => {
    await openModules(page);
    await hoverModule(page, 0);

    const before = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].patternId);
    const family = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].family);
    const pool = await page.evaluate((f) => window.__SBS_TEST_API.previewSwitcher.pool(f).map((p) => p.id), family);

    await pressArrow(page, 'next');
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].patternId)).not.toBe(before);

    const after = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].patternId);
    expect(pool).toContain(after);
    expect(pool.indexOf(after)).toBe((pool.indexOf(before) + 1) % pool.length);

    // The preview, the overlay, the sequence list and the Selected pattern
    // panel all have to agree, or the reader cannot trust any of them.
    const title = pool.length ? await page.evaluate((id) => window.__SBS_TEST_API.patterns && (window.__SBS_TEST_API.previewSwitcher.pool(window.__SBS_TEST_API.state.project.sections[0].family).find((p) => p.id === id) || {}).title, after) : '';
    await expect.poll(() => page.evaluate(() => document.querySelector('.pv-hud__copy b').textContent)).toBe(title);
    await expect.poll(() => page.evaluate(() => document.querySelector('.module-row .module-copy span').textContent)).toBe(title);
    await expect.poll(() => page.evaluate(() => document.querySelector('.pattern-summary b').textContent)).toBe(title);
    await expect.poll(() => page.evaluate(() => {
      const doc = document.getElementById('sitePreview').contentDocument;
      return Boolean(doc.getElementById(window.__SBS_TEST_API.state.project.sections[0].id));
    })).toBe(true);
  });

  test('the arrows wrap, and a run of presses is one undo', async ({ page }) => {
    await openModules(page);
    await hoverModule(page, 0);
    const before = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].patternId);

    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(140);
    }
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].patternId)).not.toBe(before);

    // One gesture, one undo — the rule typing already follows.
    await page.waitForTimeout(900);
    await page.locator('#undoBtn').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].patternId)).toBe(before);
  });

  test('the module edits keep their copy across a swap', async ({ page }) => {
    await openModules(page);
    await page.locator('.module-row').first().click();
    const sectionId = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].id);
    await page.locator(`[data-bind="section.${sectionId}.title"]`).fill('A headline the strategist wrote');
    await hoverModule(page, 0);
    await pressArrow(page, 'next');
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].content.title))
      .toBe('A headline the strategist wrote');
  });

  test('the switcher is available in the simple builder too', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await useAdvancedBuilder(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    await page.locator('.mode-btn[data-builder-mode="simple"]').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.simple.mode())).toBe('simple');
    const preview = page.locator('#sitePreview');
    await expect.poll(() => preview.evaluate((frame) => Boolean(frame.contentDocument?.querySelector('#sbs-site')))).toBe(true);
    await previewSettled(page);

    await hoverModule(page, 0);
    const before = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].patternId);
    await pressArrow(page, 'next');
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].patternId)).not.toBe(before);
  });
});

test.describe('headings never render invisible', () => {
  /** Builds a one-section page on a named pattern and returns its rendered heading facts. */
  async function renderPattern(page, patternId, family) {
    await page.addInitScript(() => localStorage.clear());
    await useAdvancedBuilder(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    await page.locator('[data-step="1"]').click();
    await page.evaluate((args) => {
      const api = window.__SBS_TEST_API;
      api.state.project.sections = [api.createSection(args.family, 0, args.patternId)];
      api.state.selectedSectionId = api.state.project.sections[0].id;
    }, { patternId, family });
    // Nudge a bound dial so the project renders through the app's own path.
    await page.evaluate(() => {
      const dial = document.querySelector('[data-bind="design.density"]');
      dial.value = String(Number(dial.value) + 1);
      dial.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(() => page.evaluate(() => {
      const doc = document.getElementById('sitePreview').contentDocument;
      return Boolean(doc && doc.getElementById(window.__SBS_TEST_API.state.project.sections[0].id));
    })).toBe(true);
    await page.waitForTimeout(500);

    return page.evaluate(() => {
      const doc = document.getElementById('sitePreview').contentDocument;
      const section = doc.getElementById(window.__SBS_TEST_API.state.project.sections[0].id);
      function ground(node) {
        let current = node;
        while (current && current !== doc.body) {
          const colour = getComputedStyle(current).backgroundColor;
          if (colour && colour !== 'rgba(0, 0, 0, 0)') return colour;
          current = current.parentElement;
        }
        return 'rgb(255, 255, 255)';
      }
      const headings = [...section.querySelectorAll('.dst-heading')];
      const subtitles = [...section.querySelectorAll('.c-heading__sub')];
      return {
        headings: headings.length,
        invisible: headings.filter((heading) => {
          const text = heading.querySelector('.c-heading__title') || heading.querySelector('.c-heading__sub');
          return text && getComputedStyle(text).color === ground(text);
        }).length,
        columns: [...section.querySelectorAll('.ds-column')].map((column) => ({
          dark: getComputedStyle(column).backgroundColor === 'rgb(7, 28, 42)',
          inverted: Boolean(column.querySelector('.dst-heading.is-style-colors-inverted')),
        })),
        subtitlesWithInlineSize: subtitles.filter((sub) => /font-size/.test(sub.getAttribute('style') || '')).length,
      };
    });
  }

  for (const patternId of ['sbs-pricing-p18-v1', 'sbs-pricing-p26-v2']) {
    test(`${patternId} inverts the tier it actually paints dark, and only that one`, async ({ page }) => {
      const result = await renderPattern(page, patternId, 'pricing');
      expect(result.headings).toBeGreaterThan(0);
      expect(result.invisible).toBe(0);
      // The builder paints the featured tier on the ink token and its
      // neighbours on paper, so inversion has to follow the column, not the
      // pattern's captured attribute.
      for (const column of result.columns) expect(column.inverted).toBe(column.dark);
      // `subtitleTypography.fontSize` in these patterns is a captured price
      // style, not a subtitle style, and must not reach the page.
      expect(result.subtitlesWithInlineSize).toBe(0);
    });
  }

  test('a hero still renders its heading inverted on the dark band', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await useAdvancedBuilder(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    const preview = page.locator('#sitePreview');
    await expect.poll(() => preview.evaluate((frame) => Boolean(frame.contentDocument?.querySelector('#sbs-site')))).toBe(true);
    const hero = await page.evaluate(() => {
      const doc = document.getElementById('sitePreview').contentDocument;
      const section = doc.getElementById(window.__SBS_TEST_API.state.project.sections[0].id);
      const title = section.querySelector('.c-heading__title');
      return {
        sectionInverted: section.classList.contains('is-style-colors-inverted'),
        headingInverted: Boolean(section.querySelector('.dst-heading.is-style-colors-inverted')),
        titleColour: getComputedStyle(title).color,
      };
    });
    expect(hero.sectionInverted).toBe(true);
    expect(hero.headingInverted).toBe(true);
    expect(hero.titleColour).toBe('rgb(247, 245, 239)');
  });
});

test.describe('a testimonial module always has a set to slide through', () => {
  test('starts with four quotes and renders four cards in a slider', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await useAdvancedBuilder(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    const preview = page.locator('#sitePreview');
    await expect.poll(() => preview.evaluate((frame) => Boolean(frame.contentDocument?.querySelector('#sbs-site')))).toBe(true);

    const result = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const section = api.state.project.sections.find((entry) => entry.family === 'testimonial');
      const doc = document.getElementById('sitePreview').contentDocument;
      const element = doc.getElementById(section.id);
      return {
        items: (section.content.items || []).length,
        cards: element.querySelectorAll('.sbs-quote-card').length,
        slider: Boolean(element.querySelector('[data-slider]')),
      };
    });
    expect(result.items).toBeGreaterThanOrEqual(4);
    expect(result.cards).toBeGreaterThanOrEqual(4);
    expect(result.slider).toBe(true);
  });

  test('a draft that writes one quote does not collapse the module to one card', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await useAdvancedBuilder(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));

    const result = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      api.brain.applyContentDraft({
        sections: api.state.project.sections.map((section) => ({
          family: section.family,
          pretitle: 'Proof',
          title: 'A drafted headline',
          subtitle: '',
          body: '',
          items: section.family === 'testimonial'
            ? [{ title: 'Operations lead', description: 'The single quote the model returned.', value: '' }]
            : [],
          buttons: [],
        })),
      });
      const section = api.state.project.sections.find((entry) => entry.family === 'testimonial');
      return { items: section.content.items.map((item) => ({ title: item.title, text: item.text })) };
    });

    expect(result.items.length).toBeGreaterThanOrEqual(4);
    // The drafted quote is written in first; the rest of the set is kept.
    expect(result.items[0].title).toBe('Operations lead');
    expect(result.items[0].text).toBe('The single quote the model returned.');
    expect(result.items.every((item) => item.text)).toBe(true);
  });
});
