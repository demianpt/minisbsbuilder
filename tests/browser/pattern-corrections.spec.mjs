import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * Decisions about individual patterns that no rule can derive.
 *
 * How many quotes a pull-quote band shows, where a column sits in its row,
 * whether a picture should hold still while the copy beside it scrolls. They live
 * in `scripts/clean-patterns.mjs` as a table rather than hand-edited into the
 * data, so they survive a re-ingest — and here as assertions, so a re-ingest that
 * skipped them fails rather than quietly reverting the page.
 */

async function boot(page) {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
}

/** Renders one pattern on its own and reads the markup back. */
function render(page, patternId, read) {
  return page.evaluate(({ id, source }) => {
    const inspect = new Function(`return (${source})`)();
    const api = window.__SBS_TEST_API;
    const pattern = api.catalog.all().find((entry) => entry.id === id);
    if (!pattern) throw new Error(`no such pattern: ${id}`);
    const section = api.createSection(pattern.family, 0, id);
    api.state.project.sections.push(section);
    const doc = new DOMParser().parseFromString(api.buildSiteDocument(), 'text/html');
    api.state.project.sections.pop();
    const band = doc.getElementById(section.id);
    if (!band) throw new Error(`${id} rendered nothing`);
    return inspect(band, doc);
  }, { id: patternId, source: read.toString() });
}

test.describe('how many quotes a testimonial band shows', () => {
  /*
   * A pull-quote band shows one large quote; a card band shows two or three.
   * Which it is belongs to the pattern, not the family — sweeping the whole
   * family to three across turned every one of these into the same three-up grid.
   */
  const ACROSS = {
    'sbs-testimonial-p15-v1': 1,
    'sbs-testimonial-p15-v2': 1,
    'sbs-testimonial-p43-v1': 1,
    'sbs-testimonial-p43-v2': 2,
    'sbs-testimonial-p10-v1': 2,
  };

  for (const [id, across] of Object.entries(ACROSS)) {
    test(`${id} shows ${across} at a time`, async ({ page }) => {
      await boot(page);
      const grid = await render(page, id, (band) => {
        const node = band.querySelector('.dst-cards__grid');
        return node ? node.getAttribute('style') : '';
      });
      expect(grid).toContain(`--dst-slider-cols:${across}`);
      expect(grid).toContain(`--col:${across}`);
    });
  }
});

test('the first column of p15 v2 sits at the top of its row', async ({ page }) => {
  await boot(page);
  // The pattern set the row to `end` *and* pinned this column to `bottom`, which
  // left the heading on the floor of the band beside a column of quotes. The
  // column is the one that renders `align-self`, so both had to move.
  const column = await render(page, 'sbs-testimonial-p15-v2', (band) => ({
    row: (band.querySelector('.ds-row') || {}).className || '',
    first: (band.querySelector('.ds-column') || {}).getAttribute
      ? band.querySelector('.ds-column').getAttribute('style')
      : '',
  }));
  expect(column.row).toContain('valign-start');
  expect(column.first).toContain('align-self:start');
  expect(column.first).not.toContain('align-self:end');
});

test.describe('the stats bands that put a picture beside a list', () => {
  for (const id of ['sbs-stats-p31-v2', 'sbs-stats-p31-v3']) {
    test(`${id} holds its picture at the top of the band`, async ({ page }) => {
      await boot(page);
      const band = await render(page, id, (node) => ({
        row: (node.querySelector('.ds-row') || {}).className || '',
        sticky: node.querySelectorAll('.ds-column.is-sticky-media').length,
        stickyHoldsMedia: [...node.querySelectorAll('.ds-column.is-sticky-media')]
          .every((column) => column.querySelector('.dst-media, .ph, img')),
        lists: [...node.querySelectorAll('.dst-list')].map((list) => list.className),
      }));
      // Centring a tall picture against a list twice its height leaves it
      // floating in the middle of a lot of nothing.
      expect(band.row).toContain('valign-start');
      expect(band.row).not.toContain('valign-center');
      expect(band.sticky, 'the picture column is not marked to hold').toBe(1);
      expect(band.stickyHoldsMedia).toBe(true);
      // And the list is not a container inside a band that already is one.
      for (const list of band.lists) expect(list).not.toContain('c-default');
    });
  }

  test('the held column is sticky, un-clipped, and static on a phone', async ({ page }) => {
    await boot(page);
    const css = await page.evaluate(() => window.__SBS_TEST_API.buildSiteDocument());
    // `align-self:start` is what makes sticky mean anything in a grid: a
    // stretched item is already as tall as the row and has nowhere to travel.
    // The offset is a token, so the held column, the timeline counter and the
    // stacking cards line up with each other instead of each choosing its own.
    expect(css).toContain('.ds-column.is-sticky-media{position:sticky;top:var(--sbs-sticky-top,12rem);align-self:start}');
    // `overflow:hidden` anywhere above a sticky element silently turns it back
    // into a static one, and both `.has-bg-media` and the decoration layer set it.
    expect(css).toMatch(/\.dst-wrapper:has\(\.is-sticky-media\)[^{]*\{overflow:visible\}/);
    // Sticky and a single column do not mix: the picture would pin to the top and
    // the copy would scroll underneath it.
    expect(css).toMatch(/@media\(max-width:900px\)\{[^}]*is-sticky-media\{position:static\}/);
  });
});

test('the form slot is readable on its own white card', async ({ page }) => {
  await boot(page);
  const ink = await page.evaluate(() => {
    const api = window.__SBS_TEST_API;
    const read = () => {
      const css = api.buildSiteDocument();
      return (css.match(/\.sbs-form-slot\{color:(#[0-9a-fA-F]{3,8})\}/) || [])[1] || '';
    };
    const before = read();
    // A dark-ground palette makes `ink` a *pale* colour, which is right for the
    // page and wrong for the one surface that is always white.
    api.state.project.design.palette.ink = '#F4F1E8';
    api.state.project.design.palette.dark = '#EFEFEF';
    api.state.project.design.paletteLocked = true;
    const pale = read();
    return { before, pale };
  });
  const luminance = (hex) => {
    const [r, g, b] = hex.replace('#', '').match(/../g).map((pair) => Number.parseInt(pair, 16));
    return (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
  };
  expect(luminance(ink.before)).toBeLessThan(0.38);
  // Nothing dark in the palette at all, so the floor applies.
  expect(ink.pale.toLowerCase()).toBe('#111111');
});

test('the closing statement takes the width it has', async ({ page }) => {
  await boot(page);
  const css = await page.evaluate(() => window.__SBS_TEST_API.buildSiteDocument());
  // The headline was clamped to twelve characters, which broke a four-word
  // sign-off across four lines.
  expect(css).toContain('.sbs-footer-statement{max-width:100%}');
  expect(css).toContain('.sbs-footer-statement .footer__nl-head{max-width:100%}');
  // The centred layout is the exception, and has to be: centring is relative to
  // something, and at full width there is nothing to centre within — that layout
  // became a copy of the editorial one.
  expect(css).toContain('.sbs-footer.footer-centered .sbs-footer-statement{max-width:105rem}');
});

test('the footer watermark is the client’s name, until somebody types their own', async ({ page }) => {
  await boot(page);
  const marks = await page.evaluate(() => {
    const api = window.__SBS_TEST_API;
    const project = api.state.project;
    const seeded = project.footer.wordmark;

    project.brief.clientName = 'Red Moon Motorcycles';
    api.ensureProject(project);
    const followed = project.footer.wordmark;

    // A leading article is dropped, and a first word too short to read as a
    // fragment takes the second with it.
    project.brief.clientName = 'The Bicycle Company';
    api.ensureProject(project);
    const article = project.footer.wordmark;
    project.brief.clientName = 'Ex Machina Studio';
    api.ensureProject(project);
    const short = project.footer.wordmark;

    // Typed by hand, it stops following.
    api.updateBinding('global.footer.wordmark', 'ATLAS');
    project.brief.clientName = 'Something Else Entirely';
    api.ensureProject(project);
    return { seeded, followed, article, short, typed: project.footer.wordmark };
  });
  // The default project is called Vision Continuity, which is why every page
  // built afterwards carried "Vision" across the bottom: the watermark was
  // seeded once and never revisited.
  expect(marks.seeded).toBe('Vision');
  expect(marks.followed).toBe('Red Moon');
  expect(marks.article).toBe('Bicycle');
  expect(marks.short).toBe('Ex Machina');
  expect(marks.typed).toBe('ATLAS');
});

test('a stats band gets figures with units, not instructions', async ({ page }) => {
  await boot(page);
  const written = await page.evaluate(() => {
    const api = window.__SBS_TEST_API;
    const project = api.state.project;
    project.brief.clientName = 'Red Moon Motorcycles';
    project.brief.industry = 'Premium motorcycle rental near the Grand Canyon';
    const section = project.sections.find((entry) => entry.family === 'stats');
    api.brain.applyContentDraft({
      sections: project.sections.filter((entry) => entry.visible !== false).map((entry) => (
        entry.family === 'stats'
          ? {
            family: 'stats',
            title: 'What the programme leaves behind',
            items: [
              { title: 'Distance covered', description: 'Across the routes we run.', value: 'Add the measured figure' },
              { title: 'Response window', description: 'From enquiry to confirmation.', value: '' },
              { title: 'Routes offered', description: 'Each one scouted.', value: 'TBC' },
            ],
          }
          : { family: entry.family, title: 'x' }
      )),
    });
    return { values: (section.content.items || []).map((item) => item.value), body: section.content.body };
  });
  // Three cards reading "Add the measured figure" is a template, not a concept —
  // and the units come from the brief's own vocabulary.
  expect(written.values).toHaveLength(3);
  for (const value of written.values) expect(value).toMatch(/\d/);
  expect(written.values.join(' ')).toMatch(/km|hrs|routes/i);
  // Said on the band rather than left for somebody to notice.
  expect(written.body).toMatch(/illustrative|demonstration/i);
});

/**
 * A pale band paints in the palette's dark role.
 *
 * `is-style-colors-standard` resolves to `--dst--base-text-color`, which is the
 * palette's `ink` — and on a dark-ground concept palette `ink` is a *pale*
 * colour. Correct against a near-black page, wrong against a white wash. So the
 * headline, the pretitle, the supporting line and the outlined button all
 * rendered near-white on white.
 */
test.describe('the pale heroes read', () => {
  /* The concept palette the model actually produced: dark ground, pale ink. */
  const DARK_GROUND = { bg: '#0D0D0D', ink: '#EAEAEA', accent: '#C22B26', soft: '#1A1A1A', dark: '#212121' };
  const PALE = ['sbs-hero-p5-v2', 'sbs-hero-p5-v4', 'sbs-hero-p89-v3', 'sbs-hero-p30-v2', 'sbs-hero-p30-v4'];
  const DARK = ['sbs-hero-p5-v3', 'sbs-hero-p30-v1'];

  /** Renders one hero into the live preview and reads the colours back. */
  async function hero(page, patternId) {
    const id = await page.evaluate(({ pid, palette }) => {
      const api = window.__SBS_TEST_API;
      api.state.project.design.palette = { ...palette };
      api.state.project.design.paletteLocked = true;
      api.state.project.sections.length = 0;
      const section = api.createSection('hero', 0, pid);
      api.state.project.sections.push(section);
      api.paint.queue(section);
      return section.id;
    }, { pid: patternId, palette: DARK_GROUND });
    await page.waitForFunction((sid) => {
      const frame = document.getElementById('sitePreview');
      return Boolean(frame && frame.contentDocument && frame.contentDocument.getElementById(sid));
    }, id);
    await page.waitForTimeout(400);
    return page.locator('#sitePreview').evaluate((frame, sid) => {
      const band = frame.contentDocument.getElementById(sid);
      const colour = (selector) => {
        const node = band.querySelector(selector);
        return node ? getComputedStyle(node).color : null;
      };
      const outlined = band.querySelector('.c-btn.-secondary, .c-btn.-secondary-inverted');
      const filled = band.querySelector('.c-btn.-primary, .c-btn.-primary-inverted');
      return {
        pale: /is-pale-overlay/.test(band.className),
        title: colour('.c-heading__title'),
        pretitle: colour('.c-heading__pre'),
        subtitle: colour('.c-heading__sub'),
        outlined: outlined ? {
          variant: /-inverted/.test(outlined.className) ? 'inverted' : 'standard',
          colour: getComputedStyle(outlined).color,
          border: getComputedStyle(outlined).borderTopColor,
        } : null,
        filled: filled ? {
          variant: /-inverted/.test(filled.className) ? 'inverted' : 'standard',
          colour: getComputedStyle(filled).color,
        } : null,
      };
    }, id);
  }

  const luminance = (value) => {
    const [r, g, b] = (String(value).match(/\d+/g) || ['0', '0', '0']).map(Number);
    return (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
  };
  /* #212121 — the palette's dark role, and the one colour guaranteed to read here. */
  const DARK_INK = luminance('rgb(33, 33, 33)');

  for (const id of PALE) {
    test(`${id} paints its copy and its outline in the dark role`, async ({ page }) => {
      await boot(page);
      const shown = await hero(page, id);
      expect(shown.pale, 'the band should have resolved to the pale tone').toBe(true);
      for (const part of ['title', 'pretitle', 'subtitle']) {
        expect(luminance(shown[part]), `${part} is ${shown[part]}`).toBeCloseTo(DARK_INK, 2);
      }
      // An outlined button: dark outline, dark label. And the *variant* follows
      // the resolved tone — two of these rendered `-secondary-inverted`, a white
      // outline and a white label, because the variant read the family preset.
      expect(shown.outlined.variant).toBe('standard');
      expect(luminance(shown.outlined.colour)).toBeCloseTo(DARK_INK, 2);
      expect(luminance(shown.outlined.border)).toBeCloseTo(DARK_INK, 2);
      // A filled button keeps the brand colour; only its label is guaranteed.
      expect(luminance(shown.filled.colour)).toBeGreaterThan(0.5);
    });
  }

  for (const id of DARK) {
    test(`${id} is untouched, because its wash really is dark`, async ({ page }) => {
      await boot(page);
      const shown = await hero(page, id);
      expect(shown.pale).toBe(false);
      expect(luminance(shown.title)).toBeGreaterThan(0.5);
      expect(shown.outlined.variant).toBe('inverted');
    });
  }

  test('the outlined button stays readable when the pointer is on it', async ({ page }) => {
    await boot(page);
    const id = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      api.state.project.design.palette = { bg: '#0D0D0D', ink: '#EAEAEA', accent: '#C22B26', soft: '#1A1A1A', dark: '#212121' };
      api.state.project.design.paletteLocked = true;
      api.state.project.sections.length = 0;
      const section = api.createSection('hero', 0, 'sbs-hero-p89-v3');
      api.state.project.sections.push(section);
      api.paint.queue(section);
      return section.id;
    });
    await page.waitForFunction((sid) => {
      const frame = document.getElementById('sitePreview');
      return Boolean(frame && frame.contentDocument && frame.contentDocument.getElementById(sid));
    }, id);
    await page.waitForTimeout(400);

    /*
     * Measured rather than grepped.
     *
     * This used to assert the text of an `!important` rule, which stopped being
     * true when the band moved to re-pointing the button roles instead of
     * overruling them — and a rule's text was never the thing that mattered. The
     * pair of colours the pointer produces is.
     */
    const box = await page.locator('#sitePreview').evaluate((frame, sid) => {
      const band = frame.contentDocument.getElementById(sid);
      const button = band.querySelector('.c-btn.-secondary, .c-btn.-secondary-inverted');
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, id);
    expect(box, 'the hero has no outlined button').toBeTruthy();

    const frame = await page.locator('#sitePreview').boundingBox();
    const scale = await page.locator('#sitePreview').evaluate((el) => ({
      x: el.getBoundingClientRect().width / el.contentWindow.innerWidth,
      y: el.getBoundingClientRect().height / el.contentWindow.innerHeight,
    }));
    await page.mouse.move(frame.x + box.x * scale.x, frame.y + box.y * scale.y);
    await page.waitForTimeout(320);

    const hovered = await page.locator('#sitePreview').evaluate((el, sid) => {
      const band = el.contentDocument.getElementById(sid);
      const button = band.querySelector('.c-btn.-secondary, .c-btn.-secondary-inverted');
      const style = getComputedStyle(button);
      return { colour: style.color, background: style.backgroundColor };
    }, id);

    const channels = (value) => (String(value).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const luminanceOf = (value) => channels(value)
      .map((channel) => { const v = channel / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
      .reduce((total, v, i) => total + v * [0.2126, 0.7152, 0.0722][i], 0);
    const label = luminanceOf(hovered.colour);
    const fill = luminanceOf(hovered.background);
    const ratio = (Math.max(label, fill) + 0.05) / (Math.min(label, fill) + 0.05);
    expect(ratio, `label ${hovered.colour} on fill ${hovered.background}`).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe('what holds still while the page scrolls', () => {
  test('every sticky element uses the same offset, clear of the header', async ({ page }) => {
    await boot(page);
    const css = await page.evaluate(() => window.__SBS_TEST_API.buildSiteDocument());
    // `top:0` pinned a held column *under* the sticky header, which covered the
    // top of whatever was holding.
    expect(css).toContain('--sbs-sticky-top:12rem');
    for (const marker of ['is-sticky-media', 'is-sticky-heading']) {
      const rule = css.match(new RegExp(`\\.ds-column\\.${marker}\\{[^}]+}`));
      expect(rule, `no rule for ${marker}`).toBeTruthy();
      expect(rule[0]).toContain('top:var(--sbs-sticky-top,12rem)');
      expect(rule[0]).not.toContain('top:0');
    }
    // A sticky element resolves its offsets against the nearest positioned
    // ancestor; without one it pins to the viewport and leaves its own band.
    expect(css).toMatch(/\.ds-row:has\(\.is-sticky-heading\)\{position:relative/);
    expect(css).toMatch(/\.ds-row:has\(\.is-sticky-media\)\{position:relative/);
  });

  test('the timeline holds its heading beside the entries', async ({ page }) => {
    await boot(page);
    const column = await render(page, 'sbs-timeline-p1-v2', (band) => {
      const sticky = band.querySelector('.ds-column.is-sticky-heading');
      return {
        found: Boolean(sticky),
        holdsHeading: Boolean(sticky && sticky.querySelector('.c-heading')),
        others: band.querySelectorAll('.ds-column').length,
      };
    });
    expect(column.found, 'the heading column is not marked to hold').toBe(true);
    expect(column.holdsHeading).toBe(true);
    expect(column.others).toBeGreaterThan(1);
  });

  test('a timeline entry stacks, with room under it', async ({ page }) => {
    await boot(page);
    // Row was the default, which put the counter beside the title and squeezed
    // the copy into whatever was left.
    const shown = await page.evaluate(() => {
      const css = window.__SBS_TEST_API.buildSiteDocument();
      const rule = css.match(/\.list-timeline \.dst-list__content\{[^}]+}/);
      return rule ? rule[0] : '';
    });
    expect(shown).toContain('flex-direction:column');
    expect(shown).toContain('margin-bottom:2rem');
  });
});
