import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';
import { previewSettled } from './support/preview.mjs';

/**
 * Defaults and component corrections that a strategist should never have to
 * discover. The card overlay one is a genuine defect: `dst-shared.css` sets
 * `.dst-card--media-background > *:not(.c-block__media){position:relative}`,
 * which is more specific than `.c-block__scrim{position:absolute}`, so the
 * scrim collapsed to zero height and every media-background card rendered white
 * text straight onto a photograph.
 */

/**
 * `pins` names the exact pattern a family must be on.
 *
 * The builder now *chooses* the pattern for a family from the brief and the
 * design dials rather than always taking the registered default, which is the
 * point of that feature and a nuisance here: these tests are about a component's
 * CSS and export defaults, so they have to name the composition they mean
 * instead of inheriting whatever the picker currently prefers.
 */
async function boot(page, families, pins) {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  if (families) {
    await page.evaluate((list) => window.__SBS_TEST_API.brain.applyCustomFlow({
      name: 'Defaults probe', rationale: 'test', families: list,
    }), families);
  }
  if (pins) {
    await page.evaluate((wanted) => {
      const api = window.__SBS_TEST_API;
      api.state.project.sections = api.state.project.sections.map((section, index) => (
        wanted[section.family] ? api.createSection(section.family, index, wanted[section.family]) : section
      ));
      api.state.selectedSectionId = api.state.project.sections[0].id;
      // Re-render through the app's own path rather than poking the preview.
      // Whichever bound control the current step happens to show will do.
      const field = document.querySelector('#editorInner [data-bind]');
      field.value = field.value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, pins);
  }
  /*
   * The preview is rebuilt on a debounce, and `#sbs-site` exists in the *old*
   * document too — so waiting for that selector can pass against a stale frame
   * and every measurement after it reads the wrong page. Wait for the frame to
   * carry the sections that were actually asked for.
   */
  const expected = families || (await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.map((section) => section.family)));
  await expect.poll(() => page.locator('#sitePreview').evaluate((frame) => {
    const doc = frame.contentDocument;
    const site = doc?.getElementById('sbs-site');
    if (!site) return null;
    return [...doc.querySelectorAll('#sbs-site > section[id^="section-"]')]
      .map((section) => section.id.replace(/^section-/, '').replace(/-[^-]+-[^-]+$/, ''))
      .join(',');
  }), { timeout: 15_000 }).toBe(expected.join(','));
  // The document that satisfied that poll can still be replaced by a rebuild
  // that was already queued, and several tests below measure inside it.
  await previewSettled(page);
}

function inPreview(page, fn, arg) {
  return page.locator('#sitePreview').evaluate(fn, arg);
}

test.describe('card media overlay', () => {
  test('the scrim is a full-bleed layer between the image and the copy', async ({ page }) => {
    await boot(page, ['hero', 'cards', 'cta'], { cards: 'sbs-layout-p237-v2' });
    await expect.poll(() => inPreview(page, (frame) => Boolean(frame.contentDocument.querySelector('.dst-card--media-background .c-block__scrim')))).toBe(true);

    const layers = await inPreview(page, (frame) => {
      const card = frame.contentDocument.querySelector('.dst-card--media-background');
      const pick = (selector) => card.querySelector(selector);
      const read = (element) => {
        const styles = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return { position: styles.position, zIndex: styles.zIndex, width: Math.round(box.width), height: Math.round(box.height) };
      };
      const cardBox = card.getBoundingClientRect();
      return {
        card: { width: Math.round(cardBox.width), height: Math.round(cardBox.height), isolation: getComputedStyle(card).isolation },
        media: read(pick('.c-block__media')),
        scrim: read(pick('.c-block__scrim')),
        body: read(pick('.c-block__body')),
      };
    });

    // The defect: position:relative collapsed the scrim to a 0px flow element.
    expect(layers.scrim.position).toBe('absolute');
    // `inset:0` resolves against the padding box, so the card's 1px border and
    // subpixel rounding leave a few pixels — it still covers the whole surface.
    expect(layers.card.height - layers.scrim.height).toBeLessThanOrEqual(4);
    expect(layers.card.width - layers.scrim.width).toBeLessThanOrEqual(4);
    expect(layers.scrim.height).toBeGreaterThan(100);
    // Image under the scrim, copy over it.
    expect(Number(layers.media.zIndex)).toBeLessThan(Number(layers.scrim.zIndex));
    expect(Number(layers.body.zIndex)).toBeGreaterThan(Number(layers.scrim.zIndex));
    expect(layers.card.isolation).toBe('isolate');
  });

  test('the scrim actually darkens the pixels behind the card title', async ({ page }) => {
    await boot(page, ['hero', 'cards', 'cta'], { cards: 'sbs-layout-p237-v2' });
    const painted = await inPreview(page, (frame) => {
      const scrim = frame.contentDocument.querySelector('.dst-card--media-background .c-block__scrim');
      const styles = getComputedStyle(scrim);
      return {
        // Either an authored gradient or the fallback must be present.
        background: `${styles.backgroundImage} ${styles.backgroundColor}`,
        opacity: Number(styles.opacity),
        pointerEvents: styles.pointerEvents,
      };
    });
    expect(painted.background).toMatch(/gradient|rgba?\(/);
    expect(painted.background).not.toContain('none rgba(0, 0, 0, 0)');
    expect(painted.opacity).toBeGreaterThan(0);
    // It must never swallow a click meant for the card.
    expect(painted.pointerEvents).toBe('none');
  });
});

test.describe('grid defaults', () => {
  test('a card grid opens four across, two on tablet, one on mobile', async ({ page }) => {
    await boot(page, ['hero', 'cards', 'cta']);
    await expect.poll(() => inPreview(page, (frame) => {
      const grid = frame.contentDocument.querySelector('.dst-cards__grid');
      const styles = getComputedStyle(grid);
      return ['--col', '--col-t', '--col-m'].map((name) => styles.getPropertyValue(name).trim()).join('/');
    })).toBe('4/2/1');

    const fidelity = await page.evaluate(() => {
      const section = window.__SBS_TEST_API.state.project.sections.find((item) => item.family === 'cards');
      return { cards: section.fidelity.cards, items: section.content.items.length };
    });
    expect(fidelity.cards.desktop).toBe(4);
    expect(fidelity.cards.tablet).toBe(2);
    expect(fidelity.cards.mobile).toBe(1);
  });

  test('a grid with fewer items than four does not leave a hole', async ({ page }) => {
    await boot(page, ['hero', 'cards', 'cta']);
    await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const section = api.state.project.sections.find((item) => item.family === 'cards');
      section.content.items = section.content.items.slice(0, 3);
      // Clear the one-time marker so the default is recomputed for this content.
      delete section.fidelity.defaults.cardGrid;
      api.state.project.sections.forEach((item) => api.ensureProject(api.state.project) && item);
    });
    const desktop = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const section = api.state.project.sections.find((item) => item.family === 'cards');
      api.design.ensure(api.state.project);
      return section.fidelity.cards.desktop;
    });
    expect(desktop).toBeLessThanOrEqual(3);
  });

  test('a logo band reads as one row: six across, four on tablet, two on mobile', async ({ page }) => {
    await boot(page, ['hero', 'logo', 'cta'], { logo: 'sbs-logo-p2-v1' });
    await expect.poll(() => inPreview(page, (frame) => {
      const list = frame.contentDocument.querySelector('.sbs-logo-item')?.closest('.dst-list');
      if (!list) return null;
      const styles = getComputedStyle(list);
      return ['--dst-list__col', '--dst-list__col-tablet', '--dst-list__col-mobile'].map((name) => styles.getPropertyValue(name).trim()).join('/');
    })).toBe('6/4/2');

    // And the orbs really do sit on one line.
    const rows = await inPreview(page, (frame) => {
      const items = [...frame.contentDocument.querySelectorAll('.sbs-logo-item')];
      return new Set(items.map((item) => Math.round(item.getBoundingClientRect().top))).size;
    });
    expect(rows).toBe(1);
  });

  test('a strategist edit in Extended view is never reverted by the default', async ({ page }) => {
    await boot(page, ['hero', 'cards', 'cta']);
    const sectionId = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const section = api.state.project.sections.find((item) => item.family === 'cards');
      api.state.selectedSectionId = section.id;
      return section.id;
    });
    await page.locator('[data-step="3"]').click();
    await page.locator(`.module-row[data-section-id="${sectionId}"]`).click();
    await page.locator('[data-editor-tab="layout"]').click();
    await page.locator('[data-module-view="extended"]').click();
    await page.locator(`select[data-bind="fidelity.${sectionId}.cards.desktop"], input[data-bind="fidelity.${sectionId}.cards.desktop"]`).first().fill('2').catch(async () => {
      await page.locator(`[data-bind="fidelity.${sectionId}.cards.desktop"]`).first().selectOption('2');
    });
    await expect.poll(() => inPreview(page, (frame) => getComputedStyle(frame.contentDocument.querySelector('.dst-cards__grid')).getPropertyValue('--col').trim())).toBe('2');
    // A step change re-runs every ensure pass; the edit has to survive it.
    await page.locator('[data-step="0"]').click();
    await page.locator('[data-step="3"]').click();
    await expect.poll(() => page.evaluate(() => {
      const section = window.__SBS_TEST_API.state.project.sections.find((item) => item.family === 'cards');
      return section.fidelity.cards.desktop;
    })).toBe(2);
  });

  test('the defaults reach the WordPress export, not just the preview', async ({ page }) => {
    await boot(page, ['hero', 'cards', 'logo', 'contact'], { cards: 'sbs-layout-p237-v2', logo: 'sbs-logo-p2-v1' });
    const exported = await page.evaluate(() => {
      const find = (node, component) => {
        if (!node || typeof node !== 'object') return null;
        if (node.component === component) return node;
        for (const child of node.children || []) {
          const match = find(child, component);
          if (match) return match;
        }
        return null;
      };
      const page = window.__SBS_TEST_API.buildPageExport();
      const section = (family) => page.concept.page.sections.find((item) => JSON.stringify(item).includes(family));
      const cards = find(page.concept.page.sections.find((item) => find(item, 'ds-blocks/c-cards')), 'ds-blocks/c-cards');
      const list = find(page.concept.page.sections.find((item) => find(item, 'ds-blocks/c-list')), 'ds-blocks/c-list');
      return {
        cards: cards ? { desktop: cards.attributes.columnsDesktop, tablet: cards.attributes.columnsTablet, mobile: cards.attributes.columnsMobile } : null,
        list: list ? { desktop: list.attributes.colCount, tablet: list.attributes.colCountTablet, mobile: list.attributes.colCountMobile } : null,
      };
    });
    expect(exported.cards).toEqual({ desktop: 4, tablet: 2, mobile: 1 });
    expect(exported.list.desktop).toBeGreaterThanOrEqual(3);
  });
});

test.describe('contact overlay', () => {
  test('a contact band ships the same 60% brand wash as every other photograph', async ({ page }) => {
    await boot(page, ['hero', 'contact']);
    await expect.poll(() => inPreview(page, (frame) => Boolean(frame.contentDocument.querySelector('[id^="section-contact"] .c-overlay')))).toBe(true);
    const overlay = await inPreview(page, (frame) => {
      const section = frame.contentDocument.querySelector('[id^="section-contact"]');
      const element = section?.querySelector('.c-overlay');
      if (!element) return null;
      const styles = getComputedStyle(element);
      return { colour: styles.backgroundColor, image: styles.backgroundImage, opacity: Number(styles.opacity) };
    });
    expect(overlay).not.toBeNull();
    // One flat colour, not a gradient.
    expect(overlay.image).toBe('none');
    // The contact band used to carry its own convention: a 50% wash with the
    // alpha in the colour and the element opacity at 1. It was a second way of
    // saying the same thing, and weaker than the banners for no stated reason.
    // One rule now covers every band that paints a photograph.
    expect(overlay.opacity).toBeCloseTo(0.6, 2);

    const fidelity = await page.evaluate(() => {
      const section = window.__SBS_TEST_API.state.project.sections.find((item) => item.family === 'contact');
      return section.fidelity.surface;
    });
    expect(fidelity.overlayEnabled).toBe(true);
    expect(fidelity.overlayOpacity).toBeCloseTo(0.6, 2);
    // The wash is the brand's own dark, not black.
    const dark = await page.evaluate(() => window.__SBS_TEST_API.state.project.design.palette.dark);
    const channels = dark.replace('#', '').match(/../g).map((pair) => Number.parseInt(pair, 16));
    expect(fidelity.overlay).toBe(`rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, 1.00)`);
  });
});

test.describe('accordion animation', () => {
  test('opens and closes over time instead of snapping', async ({ page }) => {
    await boot(page, ['hero', 'faq', 'cta']);
    await expect.poll(() => inPreview(page, (frame) => frame.contentDocument.querySelectorAll('.dst-accordion__item').length)).toBeGreaterThan(1);

    /*
     * Sampled every frame rather than at a fixed delay: a single timed sample is
     * a race against the transition under parallel test load, and what actually
     * matters is that *some* frame lands between the two end states.
     */
    const track = (frame, shouldOpen) => {
      const item = frame.contentDocument.querySelectorAll('.dst-accordion__item')[1];
      const height = () => Math.round(item.getBoundingClientRect().height);
      const start = height();
      const samples = [];
      item.open = shouldOpen;
      return new Promise((resolve) => {
        const deadline = performance.now() + 1500;
        const sample = () => {
          samples.push(height());
          if (performance.now() < deadline) frame.contentWindow.requestAnimationFrame(sample);
          else resolve({ start, samples, end: height() });
        };
        frame.contentWindow.requestAnimationFrame(sample);
      });
    };

    const opening = await inPreview(page, track, true);
    expect(opening.end).toBeGreaterThan(opening.start);
    const between = opening.samples.filter((value) => value > opening.start && value < opening.end);
    expect(between.length, 'no frame landed mid-transition while opening').toBeGreaterThan(0);

    const closing = await inPreview(page, track, false);
    expect(closing.end).toBeLessThan(closing.start);
    const shrinking = closing.samples.filter((value) => value < closing.start && value > closing.end);
    expect(shrinking.length, 'no frame landed mid-transition while closing').toBeGreaterThan(0);
  });

  test('the movement dial owns the speed, and zero means instant', async ({ page }) => {
    await boot(page, ['hero', 'faq', 'cta']);
    const durationAt = async (motion) => {
      await page.evaluate((value) => {
        const api = window.__SBS_TEST_API;
        api.state.project.design.motion = value;
        api.design.ensure(api.state.project);
        document.getElementById('sitePreview').srcdoc = api.buildSiteDocument(api.state.project);
      }, motion);
      await expect.poll(() => inPreview(page, (frame) => Boolean(frame.contentDocument.querySelector('.dst-accordion__item')))).toBe(true);
      return inPreview(page, (frame) => getComputedStyle(frame.contentDocument.getElementById('sbs-site')).getPropertyValue('--sbs-accordion-dur').trim());
    };
    expect(await durationAt(0)).toBe('0s');
    const slow = Number.parseFloat(await durationAt(20));
    const fast = Number.parseFloat(await durationAt(100));
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
  });
});

test.describe('the preview follows the selected module', () => {
  test('selecting a row scrolls the preview to that section', async ({ page }) => {
    await boot(page, ['hero', 'cards', 'logo', 'faq', 'contact']);
    await page.locator('[data-step="3"]').click();
    await expect(page.locator('.module-row')).toHaveCount(5);

    const lastId = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.at(-1).id);
    await expect.poll(() => inPreview(page, (frame, id) => Boolean(frame.contentDocument.getElementById(id)), lastId)).toBe(true);
    const before = await inPreview(page, (frame) => frame.contentWindow.scrollY);
    await page.locator(`.module-row[data-section-id="${lastId}"]`).click();

    // The section lands just under the sticky header rather than behind it.
    await expect.poll(() => inPreview(page, (frame, id) => {
      const target = frame.contentDocument.getElementById(id);
      const header = frame.contentDocument.querySelector('.site-header');
      const offset = header ? header.getBoundingClientRect().height : 0;
      return Math.round(target.getBoundingClientRect().top - offset);
    }, lastId), { timeout: 6000 }).toBeLessThanOrEqual(24);

    const after = await inPreview(page, (frame) => frame.contentWindow.scrollY);
    expect(after).toBeGreaterThan(before);
  });

  test('the focused section is marked briefly so you can see where you are', async ({ page }) => {
    await boot(page, ['hero', 'cards', 'contact']);
    await page.locator('[data-step="3"]').click();
    const lastId = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.at(-1).id);
    await page.locator(`.module-row[data-section-id="${lastId}"]`).click();
    await expect.poll(() => inPreview(page, (frame, id) => frame.contentDocument.getElementById(id).hasAttribute('data-preview-focus'), lastId)).toBe(true);
    // And it clears itself rather than leaving a permanent ring.
    await expect.poll(() => inPreview(page, (frame) => frame.contentDocument.querySelectorAll('[data-preview-focus]').length), { timeout: 6000 }).toBe(0);
  });

  test('scrolling to a module never scrolls the editor chrome itself', async ({ page }) => {
    await boot(page, ['hero', 'cards', 'contact']);
    await page.locator('[data-step="3"]').click();
    const lastId = await page.evaluate(() => window.__SBS_TEST_API.state.project.sections.at(-1).id);
    const before = await page.evaluate(() => ({ window: window.scrollY, stage: document.querySelector('.preview-stage').scrollTop }));
    await page.locator(`.module-row[data-section-id="${lastId}"]`).click();
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => ({ window: window.scrollY, stage: document.querySelector('.preview-stage').scrollTop }));
    expect(after.window).toBe(before.window);
    expect(after.stage).toBe(before.stage);
  });
});

/**
 * The scrim under a banner's headline.
 *
 * A hero is a photograph with words on it, and which words survive was decided
 * by whatever the crop happened to be doing — a bright sky, a white wall. Two
 * separate faults produced that: patterns that named an overlay colour without
 * setting the boolean had it dropped the moment the section became editable, and
 * patterns that named no overlay at all got nothing.
 */
async function bannerOverlay(page, family, patternId) {
  // The section id is the only thing the rendered page carries that identifies
  // *this* build of the pattern, so it is what the preview is waited on.
  const sectionId = await page.evaluate(([kind, id]) => {
    const api = window.__SBS_TEST_API;
    api.state.project.sections = [api.createSection(kind, 0, id)];
    api.state.selectedSectionId = api.state.project.sections[0].id;
    document.querySelector('#editorInner [data-bind]').dispatchEvent(new Event('input', { bubbles: true }));
    return api.state.project.sections[0].id;
  }, [family, patternId]);
  await expect.poll(() => inPreview(page, (frame) => (
    frame.contentDocument.querySelector('#sbs-site > section')?.id || null
  ))).toBe(sectionId);
  return inPreview(page, (frame) => {
    const doc = frame.contentDocument;
    const overlay = doc.querySelector('.c-overlay');
    const heading = doc.querySelector('.c-heading__title') || doc.querySelector('h1');
    return {
      style: overlay ? overlay.getAttribute('style') : null,
      opacity: overlay ? Number(getComputedStyle(overlay).opacity) : null,
      inverted: /is-style-colors-inverted/.test(doc.querySelector('#sbs-site > section')?.className || ''),
      headingLuminance: heading
        ? getComputedStyle(heading).color.match(/\d+/g).slice(0, 3).reduce((sum, value, index) => sum + Number(value) * [0.2126, 0.7152, 0.0722][index], 0)
        : null,
    };
  });
}

test.describe('banner overlays', () => {
  test('a banner with no authored overlay still gets a readable wash', async ({ page }) => {
    await boot(page, ['hero']);
    for (const [family, pattern] of [['hero', 'sbs-hero-p5-v1'], ['cta', 'sbs-cta-p16-v1']]) {
      const result = await bannerOverlay(page, family, pattern);
      expect(result.style, `${pattern} rendered no scrim`).not.toBeNull();
      expect(result.opacity).toBeCloseTo(0.6, 2);
      expect(result.inverted).toBe(true);
    }
  });

  test('an authored overlay is kept, even when the pattern never set the flag', async ({ page }) => {
    await boot(page, ['hero']);
    // p89 v1 names `#240800` at 0.6 and never sets `backgroundOverlayEnabled`,
    // which used to read as "no overlay" and leave the headline on the photo.
    const result = await bannerOverlay(page, 'hero', 'sbs-hero-p89-v1');
    expect(result.style).toContain('#240800');
    expect(result.opacity).toBeCloseTo(0.6, 2);
  });

  test('a pale scrim makes the section light, so the headline is not white on white', async ({ page }) => {
    await boot(page, ['hero']);
    // p89 v3 washes white across the left 60% and puts the headline in it. The
    // exported value was a pale *blue*, which behind a headline read as a
    // mistake rather than a decision.
    const pale = await bannerOverlay(page, 'hero', 'sbs-hero-p89-v3');
    expect(pale.style).toContain('#ffffff');
    expect(pale.style).not.toMatch(/E3F8FF/i);
    // The catalogue value carries a trailing semicolon and line breaks, which
    // used to reach the page as `background:…;;opacity:1;`.
    expect(pale.style).not.toContain(';;');
    expect(pale.style).not.toMatch(/\n/);
    expect(pale.inverted).toBe(false);
    expect(pale.headingLuminance).toBeLessThan(90);

    // A dark scrim is untouched by the same rule.
    const dark = await bannerOverlay(page, 'hero', 'sbs-hero-p30-v3');
    expect(dark.inverted).toBe(true);
    expect(dark.headingLuminance).toBeGreaterThan(160);
  });

  test('a light tint is a tint, not a ground: the section stays dark', async ({ page }) => {
    await boot(page, ['hero']);
    // p89 v2 lays white over the photo at 27%. The photograph is still the
    // ground, so inverting the type there would be the same bug mirrored.
    const result = await bannerOverlay(page, 'hero', 'sbs-hero-p89-v2');
    expect(result.opacity).toBeCloseTo(0.27, 2);
    expect(result.inverted).toBe(true);
  });
});
