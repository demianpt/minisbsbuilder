import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';
import { previewSettled } from './support/preview.mjs';

/**
 * What the pattern library brought with it from the site it was exported from.
 *
 * All 156 patterns are real WordPress exports, so each one carried that install's
 * own decisions: media library URLs, the overlay colour whoever built the page
 * happened to pick, and a link to its own contact page. In a concept builder all
 * three are wrong — a card that names
 * `dsstaging1.com/…/exterior-facade-high-reflection-blue.jpg` shows somebody
 * else's building instead of the imagery found for *this* brief, and a solid
 * `#f5f5f5` scrim at full opacity is a grey rectangle where the photograph was.
 *
 * These sweep every pattern rather than the handful that were reported, because
 * the reported ones were only the ones somebody happened to look at.
 */

async function boot(page) {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
}

/**
 * Renders every pattern once and reports on the markup.
 *
 * One round trip: a section per pattern, built, rendered and read inside the
 * page, because 156 patterns × a round trip each is slower than the rest of the
 * suite put together.
 */
function sweep(page, collect) {
  return page.evaluate((source) => {
    const read = new Function(`return (${source})`)();
    const api = window.__SBS_TEST_API;
    const out = [];
    for (const pattern of api.catalog.all()) {
      const section = api.createSection(pattern.family, 0, pattern.id);
      api.state.project.sections.push(section);
      const doc = new DOMParser().parseFromString(api.buildSiteDocument(), 'text/html');
      api.state.project.sections.pop();
      const band = doc.getElementById(section.id);
      if (!band) { out.push({ id: pattern.id, missing: true }); continue; }
      out.push({ id: pattern.id, family: pattern.family, ...read(band, pattern) });
    }
    return out;
  }, collect.toString());
}

test.describe('no pattern renders anything from the site it was exported from', () => {
  test('no media, no link, no attribute names the staging install', async ({ page }) => {
    await boot(page);
    const rows = await sweep(page, (band) => ({
      hits: (band.innerHTML.match(/https?:\/\/[a-z0-9.-]*dsstaging[^"'\s)]*/gi) || []).slice(0, 2),
    }));
    const dirty = rows.filter((row) => row.hits && row.hits.length).map((row) => `${row.id}: ${row.hits[0]}`);
    expect(dirty, `${dirty.length} patterns still point at the exporting site`).toEqual([]);
  });

  test('every card scrim is the renderer’s own, not a colour the pattern brought', async ({ page }) => {
    await boot(page);
    // A scrim exists for one reason: a title sitting on a photograph. The
    // renderer's is a soft bottom-up gradient that darkens the type's ground and
    // leaves the picture visible. Anything else came from the export — a solid
    // `#f5f5f5`, a white token at full opacity, a bright green gradient — and
    // each one is a rectangle where the photograph should be.
    const rows = await sweep(page, (band) => ({
      scrims: [...new Set([...band.querySelectorAll('.c-block__scrim')].map((node) => node.getAttribute('style') || ''))],
    }));
    const authored = [];
    for (const row of rows) {
      for (const scrim of row.scrims || []) {
        if (!/^background:linear-gradient\(180deg,rgba\(7,28,42,\.02\),rgba\(7,28,42,\.92\)\);/.test(scrim)) {
          authored.push(`${row.id}: ${scrim.slice(0, 70)}`);
        }
      }
    }
    expect(authored, `${authored.length} patterns paint a scrim of their own`).toEqual([]);
  });

  test('a card grid never renders one column when it holds more than one card', async ({ page }) => {
    await boot(page);
    // Thirteen cards at one column each is thirteen full-width bands, which is
    // what `sbs-stats-p29-v1` looked like: a `c-cards` with no column count fell
    // back to one.
    const rows = await sweep(page, (band, pattern) => {
      // A pattern that *states* one column means it — a stacked timeline is one
      // event per row. The failure is a grid that never said, and got one
      // because the fallback was one.
      let stated = false;
      const walk = (node) => {
        if (node.component === 'ds-blocks/c-cards') {
          const attrs = node.attributes || {};
          if (Number(attrs.columnsDesktop) === 1 || Number(attrs.columns) === 1) stated = true;
        }
        (node.children || []).forEach(walk);
      };
      walk(pattern.tree);
      return {
        stated,
        grids: [...band.querySelectorAll('.dst-cards__grid')].map((grid) => ({
          col: Number((grid.getAttribute('style').match(/--col:(\d+)/) || [])[1] || 0),
          cards: grid.querySelectorAll('.dst-card').length,
        })),
      };
    });
    const narrow = rows.filter((row) => !row.stated).flatMap((row) => (row.grids || [])
      .filter((grid) => grid.cards > 1 && grid.col < 2)
      .map((grid) => `${row.id}: ${grid.cards} cards in ${grid.col} column`));
    expect(narrow, `${narrow.length} card grids fell back to one card per row`).toEqual([]);
  });

  test('a card with a picture slot shows a picture', async ({ page }) => {
    await boot(page);
    // The slots were kept when the exporting site's files were removed, so a
    // card that was designed with a photograph still has one — the project's.
    const rows = await sweep(page, (band) => ({
      slots: band.querySelectorAll('.dst-card--media-background, .dst-card__media').length,
      imgs: band.querySelectorAll('img').length,
      placeholders: band.querySelectorAll('.ph:not(.ph--real)').length,
    }));
    const empty = rows
      .filter((row) => row.slots > 0 && row.imgs === 0 && row.placeholders === 0)
      .map((row) => `${row.id}: ${row.slots} media slots, no picture`);
    expect(empty, `${empty.length} patterns have a media slot with nothing in it`).toEqual([]);
  });
});

test.describe('a band’s text tone follows its overlay', () => {
  /*
   * The five heroes that fade something pale across the band and put the
   * headline in it. Their `is-style-colors-inverted` came from the family preset
   * — every hero is inverted, because a hero is usually a photograph — and the
   * class carries `!important` colour rules, so it beat the heading renderer,
   * which had already worked out the right answer. White type on near-white.
   */
  const PALE = ['sbs-hero-p89-v3', 'sbs-hero-p5-v2', 'sbs-hero-p5-v4', 'sbs-hero-p30-v4'];
  const DARK = ['sbs-hero-p5-v1', 'sbs-hero-p5-v3', 'sbs-hero-p30-v1', 'sbs-hero-p30-v3', 'sbs-hero-p89-v1', 'sbs-cta-p5-v1'];

  test('a pale overlay gets dark type, a dark one keeps light type', async ({ page }) => {
    await boot(page);
    const tones = await page.evaluate(({ pale, dark }) => {
      const api = window.__SBS_TEST_API;
      const toneOf = (id) => {
        const pattern = api.catalog.all().find((entry) => entry.id === id);
        const section = api.createSection(pattern.family, 0, id);
        api.state.project.sections.push(section);
        const doc = new DOMParser().parseFromString(api.buildSiteDocument(), 'text/html');
        api.state.project.sections.pop();
        const band = doc.getElementById(section.id);
        return band && /is-style-colors-inverted/.test(band.className) ? 'light' : 'dark';
      };
      return { pale: pale.map((id) => `${id}:${toneOf(id)}`), dark: dark.map((id) => `${id}:${toneOf(id)}`) };
    }, { pale: PALE, dark: DARK });

    expect(tones.pale).toEqual(PALE.map((id) => `${id}:dark`));
    expect(tones.dark).toEqual(DARK.map((id) => `${id}:light`));
  });

  test('the pale hero’s headline really is dark in the rendered page', async ({ page }) => {
    await boot(page);
    // The class is the mechanism; the colour on the screen is the point.
    const id = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      // A section built from the pattern, not an existing one with its node
      // swapped: the fidelity slice is captured from the pattern when the
      // section is made, and reusing a section reuses the previous capture.
      const section = api.createSection('hero', 0, 'sbs-hero-p89-v3');
      api.state.project.sections.push(section);
      api.paint.queue(section);
      return section.id;
    });
    await page.waitForFunction((sectionId) => {
      const frame = document.getElementById('sitePreview');
      return Boolean(frame && frame.contentDocument && frame.contentDocument.getElementById(sectionId));
    }, id);
    await previewSettled(page);
    const shown = await page.locator('#sitePreview').evaluate((frame, sectionId) => {
      const band = frame.contentDocument.getElementById(sectionId);
      const title = band && band.querySelector('.c-heading__title');
      const overlay = band && band.querySelector('.c-overlay');
      return {
        colour: title ? getComputedStyle(title).color : '',
        overlay: overlay ? overlay.getAttribute('style') : '',
      };
    }, id);
    // Whatever the palette, a pale ground needs type darker than mid-grey.
    const [r, g, b] = (shown.colour.match(/\d+/g) || ['255', '255', '255']).map(Number);
    const luminance = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
    expect(luminance, `the headline is ${shown.colour} over ${shown.overlay}`).toBeLessThan(0.5);
    // And the overlay is white rather than the pale blue it shipped with.
    expect(shown.overlay).not.toMatch(/E3F8FF/i);
  });
});

test.describe('the logo rail', () => {
  async function openRail(page) {
    await boot(page);
    const id = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const pattern = api.catalog.all().find((entry) => JSON.stringify(entry.tree).includes('ds-blocks/marquee'));
      const section = api.createSection(pattern.family, 0, pattern.id);
      api.state.project.sections.push(section);
      api.state.selectedSectionId = section.id;
      api.state.editorTab = 'media';
      api.paint.queue(section);
      return section.id;
    });
    await page.locator('[data-step="3"]').click();
    await page.waitForFunction((sectionId) => {
      const frame = document.getElementById('sitePreview');
      return Boolean(frame && frame.contentDocument && frame.contentDocument.getElementById(sectionId));
    }, id);
    await previewSettled(page);
    return id;
  }

  const railOf = (page, id) => page.locator('#sitePreview').evaluate((frame, sectionId) => {
    const band = frame.contentDocument.getElementById(sectionId);
    return {
      inline: band.querySelectorAll('.dst-marquee__img.is-placeholder svg').length,
      files: [...band.querySelectorAll('img.dst-marquee__img')].map((node) => node.getAttribute('src')),
    };
  }, id);

  test('ships inline placeholder marks and fetches nothing', async ({ page }) => {
    const id = await openRail(page);
    const rail = await railOf(page, id);
    // Six marks, drawn twice so the track can loop without a gap.
    expect(rail.inline).toBe(12);
    expect(rail.files).toEqual([]);
  });

  test('a real logo can be put in, and taken out again', async ({ page }) => {
    const id = await openRail(page);
    await expect(page.locator('#editorInner [data-logo-index]').first()).toBeVisible();

    await page.locator('#editorInner [data-logo-key="src"]').first().fill('https://cdn.example.com/acme.svg');
    await expect.poll(() => railOf(page, id).then((rail) => rail.files.length)).toBe(2);
    expect((await railOf(page, id)).files[0]).toBe('https://cdn.example.com/acme.svg');

    // Cleared: back to the placeholder rather than a hole in the rail.
    await page.locator('#editorInner [data-logo-key="src"]').first().fill('');
    await expect.poll(() => railOf(page, id).then((rail) => rail.files.length)).toBe(0);
    expect((await railOf(page, id)).inline).toBe(12);
  });

  test('a logo can be added and removed from the panel', async ({ page }) => {
    const id = await openRail(page);
    const before = await page.locator('#editorInner [data-logo-remove]').count();
    await page.locator('#editorInner [data-logo-add]').click();
    await expect(page.locator('#editorInner [data-logo-remove]')).toHaveCount(before + 1);
    await expect.poll(() => railOf(page, id).then((rail) => rail.inline)).toBe((before + 1) * 2);

    await page.locator('#editorInner [data-logo-remove]').first().click();
    await expect(page.locator('#editorInner [data-logo-remove]')).toHaveCount(before);
  });

  test('a placeholder mark exports as a file WordPress can render', async ({ page }) => {
    const id = await openRail(page);
    const logos = await page.evaluate((sectionId) => {
      const api = window.__SBS_TEST_API;
      const artifact = api.buildCompleteExport();
      const out = [];
      const walk = (node) => {
        if (node.component === 'ds-blocks/marquee') out.push(...(node.attributes.images || []));
        (node.children || []).forEach(walk);
      };
      artifact.concept.page.sections.forEach(walk);
      return out;
    }, id);
    expect(logos.length).toBeGreaterThan(0);
    // An image block with no `url` is an empty slot in WordPress, so the drawing
    // itself becomes the file. The importer leaves a data URI alone because it
    // only sideloads http(s), and the browser renders it directly.
    for (const logo of logos) {
      expect(logo.url).toMatch(/^data:image\/svg\+xml/);
      expect(logo.mimeType).toBe('image/svg+xml');
      expect(logo).toHaveProperty('id');
    }
  });
});

test('a column’s picture is not cropped to the viewport', async ({ page }) => {
  await boot(page);
  // 62vh cropped a portrait image in a two-column band and showed its middle.
  const capped = await page.locator('#sitePreview').evaluate((frame) => {
    const rules = [];
    for (const sheet of frame.contentDocument.styleSheets) {
      let list = [];
      try { list = [...sheet.cssRules]; } catch { continue; }
      for (const rule of list) {
        if (rule.style && /\.ds-column|\.dst-content2__col/.test(rule.selectorText || '') && /vh/.test(rule.style.maxHeight || '')) {
          rules.push(`${rule.selectorText} { max-height: ${rule.style.maxHeight} }`);
        }
      }
    }
    return rules;
  });
  expect(capped).toEqual([]);
});
