import { expect, test } from '@playwright/test';
import { previewSettled } from './support/preview.mjs';

/**
 * The second round of upgrades, held to the behaviour that was asked for:
 *
 * - the simple builder is the front door
 * - a module swap in the preview changes the module and nothing else
 * - a supplied logo is the whole identity
 * - the global parts have real colour and opacity controls
 * - any media slot takes a clip, not only a still
 * - the AI's working cue sits next to the button that started the job
 * - what the brief states about colour, type and scale reaches all three concepts
 * - the module a family opens with follows the brief instead of a fixed default
 */

async function boot(page) {
  // Cleared in-page rather than with an init script: an init script re-runs on
  // every navigation, and one of these tests reloads specifically to prove that
  // the saved choice survived.
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
}

async function enterAdvanced(page) {
  await boot(page);
  await page.locator('[data-builder-mode="advanced"]').click();
  await expect(page.locator('.step-btn')).toHaveCount(5);
}

/** The facts a swap must not disturb. */
function readPreview(page) {
  return page.evaluate(() => {
    const frame = document.getElementById('sitePreview');
    return {
      witness: frame.contentWindow.__sbsWitness || '',
      revealed: frame.contentDocument.querySelectorAll('.in-view').length,
    };
  });
}

/** Waits for the preview document to be built and rendered. */
async function settledPreview(page) {
  const preview = page.locator('#sitePreview');
  await expect
    .poll(() => preview.evaluate((frame) => Boolean(frame.contentDocument?.querySelector('#sbs-site'))))
    .toBe(true);
  // `#sbs-site` exists in the outgoing document too, so that poll alone can be
  // satisfied by a frame about to be replaced — and a rebuild also re-renders
  // the editor, which detaches any field a test is holding. Under load that is
  // how a colour typed into a swatch went nowhere.
  await previewSettled(page);
  return preview;
}

test.describe('the front door', () => {
  test('opens on the simple builder, not the advanced one', async ({ page }) => {
    await boot(page);
    await expect(page.locator('[data-builder-mode="simple"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-builder-mode="simple"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('body')).toHaveClass(/is-simple-builder/);
    await expect(page.locator('#sideKicker')).toHaveText('Simple builder');
    await expect(page.locator('.step-btn')).toHaveCount(4);
    // And the first step is the one paragraph, ready to type into.
    await expect(page.locator('#simple-brief')).toBeVisible();
  });

  test('a session that chose the advanced builder still comes back to it', async ({ page }) => {
    await enterAdvanced(page);
    // The choice is written on the autosave debounce, so wait for the record
    // rather than for the click.
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sbs-builder-v3') || '{}').builderMode))
      .toBe('advanced');
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    await expect(page.locator('#sideKicker')).toHaveText('Advanced builder');
  });
});

test.describe('switching a module changes the module and nothing else', () => {
  /**
   * Where the reader is, as one number.
   *
   * Depending on zoom and device, either the preview document or the stage
   * around it is the surface that scrolls — so "the position" is their sum, and
   * measuring only one of them would call a jump a non-event half the time.
   */
  function position(page) {
    return page.evaluate(() => (
      document.getElementById('sitePreview').contentWindow.scrollY
      + document.querySelector('.preview-stage').scrollTop
    ));
  }

  test('keeps the document, the scroll position and every revealed section', async ({ page }) => {
    await enterAdvanced(page);
    await page.locator('[data-step="3"]').click();
    await settledPreview(page);
    // `#sbs-site` exists in the *previous* document too, so wait for this
    // project's own sections before measuring anything.
    await expect
      .poll(() => page.locator('#sitePreview').evaluate((frame) => {
        const api = window.__SBS_TEST_API;
        return api.state.project.sections.every((section) => Boolean(frame.contentDocument?.getElementById(section.id)));
      }))
      .toBe(true);

    /*
     * Park halfway down whichever surface actually scrolls, re-applying until it
     * sticks: a preview rebuild left over from opening the step reloads the
     * frame and takes the scroll with it, and this test only starts once the
     * page is genuinely settled. Set directly rather than through `scrollTo`,
     * because the rendered page uses `scroll-behavior:smooth` and that would be
     * an animation to race.
     */
    await expect
      .poll(() => page.evaluate(() => {
        const half = (element) => (element ? Math.round(Math.max(0, element.scrollHeight - element.clientHeight) / 2) : 0);
        const frame = document.getElementById('sitePreview');
        const doc = frame.contentDocument.scrollingElement;
        if (doc) doc.scrollTop = half(doc);
        const stage = document.querySelector('.preview-stage');
        stage.scrollTop = half(stage);
        return frame.contentWindow.scrollY + stage.scrollTop;
      }))
      .toBeGreaterThan(20);

    /*
     * What "do not lose my place" can mean here is worth being exact about. The
     * replacement is a different height and brings its own images, which resolve
     * on their own schedule, so the offset legitimately drifts as the page
     * reflows around it. What must never happen — and is what a rebuild always
     * did — is the offset collapsing to the top, the document being replaced, or
     * the whole page replaying its entrance.
     */
    const subject = await page.locator('#sitePreview').evaluate((frame) => {
      const api = window.__SBS_TEST_API;
      const doc = frame.contentDocument;
      const view = frame.contentWindow;
      const onScreen = api.state.project.sections
        .map((entry) => ({ id: entry.id, node: doc.getElementById(entry.id) }))
        .filter((entry) => entry.node)
        .filter((entry) => {
          const box = entry.node.getBoundingClientRect();
          return box.bottom > 0 && box.top < view.innerHeight;
        });
      frame.contentWindow.__sbsWitness = 'same document';
      return { id: onScreen[0].id };
    });
    const before = {
      ...(await readPreview(page)),
      position: await position(page),
      patternId: await page.evaluate((id) => window.__SBS_TEST_API.state.project.sections.find((s) => s.id === id).patternId, subject.id),
    };

    await page.evaluate((id) => {
      window.__SBS_TEST_API.previewSwitcher.show(id);
      window.__SBS_TEST_API.previewSwitcher.step(id, 1);
    }, subject.id);

    await expect
      .poll(() => page.evaluate((id) => window.__SBS_TEST_API.state.project.sections.find((s) => s.id === id).patternId, subject.id))
      .not.toBe(before.patternId);

    // Give a stray rebuild every chance to happen before asserting it did not.
    await page.waitForTimeout(1_400);
    const after = await readPreview(page);
    const moved = await position(page);

    // The document itself survived: no reload, so no blank frame and no lost
    // scroll — this is the whole difference from rebuilding the preview.
    expect(after.witness).toBe('same document');
    // Still down the page where the reader left it, not back at the top.
    expect(moved).toBeGreaterThan(before.position / 2);
    // Nothing was un-revealed, so nothing replays its entrance animation.
    expect(after.revealed).toBeGreaterThanOrEqual(before.revealed);
  });

  test('the swapped module is live immediately, without waiting for a rebuild', async ({ page }) => {
    await enterAdvanced(page);
    await page.locator('[data-step="3"]').click();
    await settledPreview(page);

    const bound = await page.locator('#sitePreview').evaluate((frame) => {
      const api = window.__SBS_TEST_API;
      const section = api.state.project.sections[1];
      api.previewSwitcher.show(section.id);
      api.previewSwitcher.step(section.id, 1);
      const node = frame.contentDocument.getElementById(section.id);
      return {
        exists: Boolean(node),
        // `__sbsBind` marks what it has wired; the replacement must arrive wired.
        revealed: node.classList.contains('in-view') || node.querySelectorAll('.in-view').length > 0,
        interactive: [...node.querySelectorAll('[data-slider],[data-tabs],[data-hacc],[data-viewport]')]
          .every((element) => element.__sbsBound === true),
      };
    });
    expect(bound.exists).toBe(true);
    expect(bound.revealed).toBe(true);
    expect(bound.interactive).toBe(true);
  });
});

test.describe('the global parts', () => {
  test('a supplied logo replaces the mark and the wordmark, and carries the alt', async ({ page }) => {
    await enterAdvanced(page);
    await page.locator('[data-bind="global.header.logoUrl"]').fill('https://example.test/logo.svg');
    await page.locator('[data-bind="global.header.logoAlt"]').fill('Harbour Dental');
    await page.locator('[data-bind="global.header.logoDescription"]').fill('The Harbour Dental anchor mark');
    // The three fields land in the project before the preview is rebuilt from
    // it; checking that first separates "the field did not stick" from "the
    // preview has not caught up yet".
    await expect
      .poll(() => page.evaluate(() => {
        const { logoUrl, logoAlt, logoDescription } = window.__SBS_TEST_API.state.project.header;
        return [logoUrl, logoAlt, logoDescription].join('|');
      }))
      .toBe('https://example.test/logo.svg|Harbour Dental|The Harbour Dental anchor mark');
    await settledPreview(page);

    await expect
      .poll(() => page.locator('#sitePreview').evaluate((frame) => {
        const doc = frame.contentDocument;
        const image = doc.querySelector('.site-header__logo .sbs-logo-image');
        return {
          image: image?.getAttribute('src') || '',
          alt: image?.getAttribute('alt') || '',
          title: image?.getAttribute('title') || '',
          marks: doc.querySelectorAll('.site-header .sbs-logo-mark').length,
          texts: doc.querySelectorAll('.site-header__logo-text').length,
        };
      }))
      .toEqual({
        image: 'https://example.test/logo.svg',
        alt: 'Harbour Dental',
        title: 'The Harbour Dental anchor mark',
        marks: 0,
        texts: 0,
      });
  });

  test('the navigation background has a real opacity control', async ({ page }) => {
    await enterAdvanced(page);
    const slider = page.locator('[data-bind="global.header.bgOpacity"]');
    await expect(slider).toHaveCount(1);

    // A `color-mix` resolves to `rgba(...)` or to `color(srgb r g b / a)`
    // depending on the palette, so the alpha is read rather than pattern-matched
    // on one of the two spellings.
    const alpha = () => page.locator('#sitePreview').evaluate((frame) => {
      const value = getComputedStyle(frame.contentDocument.querySelector('.site-header')).backgroundColor;
      const slash = value.match(/\/\s*([\d.]+)\s*\)/);
      if (slash) return Number(slash[1]);
      const rgba = value.match(/rgba?\(([^)]+)\)/);
      const parts = rgba ? rgba[1].split(',') : [];
      return parts.length > 3 ? Number(parts[3]) : 1;
    });
    await settledPreview(page);

    await slider.fill('20');
    await expect.poll(alpha).toBeCloseTo(0.2, 1);
    await slider.fill('70');
    await expect.poll(alpha).toBeCloseTo(0.7, 1);
    await slider.fill('100');
    await expect.poll(alpha).toBe(1);
  });

  test('every element of the navigation and the footer takes a colour', async ({ page }) => {
    await enterAdvanced(page);
    // Settle before touching a field: a pending rebuild re-renders the editor
    // and the swatch this test is about would be replaced mid-edit.
    await settledPreview(page);
    for (const path of ['global.header.bgColor', 'global.header.textColor', 'global.header.linkHoverColor',
      'global.header.borderColor', 'global.footer.bgColor', 'global.footer.textColor',
      'global.footer.headingColor', 'global.footer.linkColor', 'global.footer.accentColor']) {
      await expect(page.locator(`[data-bind="${path}"]`), path).toHaveCount(1);
    }

    await page.locator('[data-bind="global.header.textColor"]').evaluate((input) => {
      input.value = '#ff0000';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('[data-bind="global.footer.bgColor"]').evaluate((input) => {
      input.value = '#0000ff';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settledPreview(page);

    await expect
      .poll(() => page.locator('#sitePreview').evaluate((frame) => {
        const doc = frame.contentDocument;
        return {
          nav: getComputedStyle(doc.querySelector('.site-header .nav-menu a')).color,
          footer: getComputedStyle(doc.querySelector('.site-footer')).backgroundColor,
        };
      }))
      .toEqual({ nav: 'rgb(255, 0, 0)', footer: 'rgb(0, 0, 255)' });

    // An untouched colour still says it is following the palette.
    await expect(page.locator('.color-override:has([data-bind="global.footer.linkColor"]) .color-override__state'))
      .toHaveText('Following the palette');
  });
});

test.describe('media slots take clips as well as stills', () => {
  test('lists every slot the pattern renders and writes a video into one', async ({ page }) => {
    await enterAdvanced(page);
    await page.locator('[data-step="3"]').click();

    // Whichever module on this page actually renders media slots, and is not a
    // people section — those keep the placeholder library on purpose.
    await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const carrier = api.state.project.sections.find((section) => api.media.sectionSlots(section).length);
      api.state.selectedSectionId = carrier.id;
    });
    await page.locator('[data-step="3"]').click();
    await page.locator('[data-editor-tab="media"]').click();

    const slots = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const section = api.state.project.sections.find((entry) => entry.id === api.state.selectedSectionId);
      return api.media.sectionSlots(section).length;
    });
    expect(slots).toBeGreaterThan(0);
    await expect(page.locator('.media-slot')).toHaveCount(slots);

    const key = await page.locator('.media-slot').first().getAttribute('data-slot-key');
    await page.locator(`[data-slot-media="${key}"][data-key="src"]`)
      .fill('https://example.test/clip.mp4');
    await page.locator(`[data-slot-media="${key}"][data-key="alt"]`).fill('The workshop in use');

    // The type follows the file, without a second control to remember.
    await expect(page.locator(`[data-slot-media="${key}"][data-key="kind"]`)).toHaveValue('video');
    await expect(page.locator(`.media-slot[data-slot-key="${key}"]`)).toHaveClass(/is-video/);
    await expect(page.locator(`[data-slot-media="${key}"][data-key="poster"]`)).toHaveCount(1);

    await settledPreview(page);
    await expect
      .poll(() => page.locator('#sitePreview').evaluate((frame) => {
        const video = frame.contentDocument.querySelector('video[src], video source[src]');
        return video ? (video.getAttribute('src') || '') : '';
      }))
      .toBe('https://example.test/clip.mp4');
  });
});

test.describe('the AI controls', () => {
  test('the working cue sits inside the row of the button that was pressed', async ({ page }) => {
    await page.route('**/api/brief/**', async (route) => {
      const url = route.request().url();
      const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.endsWith('/status')) {
        return json({ provider: 'ollama', model: 'gemma4:31b', configured: true, available: true, modelAvailable: true });
      }
      await new Promise((resolve) => { setTimeout(resolve, 2_500); });
      return json({
        source: 'ai', degraded: null, model: 'gemma4:31b', archetypeName: 'Editorial',
        readback: { business: 'b', audience: 'a', offer: 'o', goal: 'g', voice: 'v' },
        confidence: 0.9, missingFields: [], keywords: [], signals: [],
        archetype: { key: 'A', reason: 'Understated.' },
        flows: [{ id: 'B3', reason: 'Proof first.', fit: 0.9 }],
      });
    });
    await enterAdvanced(page);
    await page.locator('[data-brain-action="understand"]').click();

    const trigger = page.locator('[data-brain-action="understand"]');
    await expect(trigger).toHaveClass(/is-working/);
    await expect(trigger.locator('.brain-btn-spin')).toHaveCount(1);
    await expect(trigger).toContainText('Reading the brief');
    // The cue is a sibling of the button, not a banner at the top of the panel.
    await expect(page.locator('.brain-actions:has([data-brain-action="understand"]) .brain-thinking'))
      .toContainText('Reading the brief');

    await expect(trigger).not.toHaveClass(/is-working/, { timeout: 15_000 });
    await expect(page.locator('.brain-thinking')).toHaveCount(0);
  });
});

test.describe('the one button on the first step', () => {
  test('reads the brief, writes the copy and puts it on the page in one press', async ({ page }) => {
    await page.route('**/api/brief/**', async (route) => {
      const url = route.request().url();
      const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.endsWith('/status')) {
        return json({ provider: 'ollama', model: 'gemma4:31b', configured: true, available: true, modelAvailable: true });
      }
      if (url.endsWith('/concepts')) {
        return json({
          source: 'ai', degraded: null, model: 'gemma4:31b', confidence: 0.9, missingFields: [],
          readback: { business: 'A dental practice.', audience: 'Families.', offer: 'Gentle care.', goal: 'Book online.', voice: 'Calm.' },
          fields: { industry: 'Family dental practice', audience: 'Local families', goal: 'Book online', offer: 'Gentle care', tone: 'Calm', keywords: 'gentle', clientName: 'Harbour Dental' },
          concepts: [
            { name: 'Calm', archetypeKey: 'D', preset: 'calm', buttonStyle: 'solid-shift', dialOverrides: {}, why: 'w' },
            { name: 'Warm', archetypeKey: 'C', preset: 'friendly', buttonStyle: 'pill-glow', dialOverrides: {}, why: 'w' },
            { name: 'Bold', archetypeKey: 'B', preset: 'bold', buttonStyle: 'sweep-fill', dialOverrides: {}, why: 'w' },
          ],
          flows: [{ id: 'B3', reason: 'Proof first.', fit: 0.9 }],
        });
      }
      if (url.endsWith('/content')) {
        const { families } = JSON.parse(route.request().postData());
        return json({
          source: 'ai', degraded: null, model: 'gemma4:31b', families,
          sections: families.map((family) => ({
            family, pretitle: 'Pre', title: `Copy for ${family}`, subtitle: '', body: '', items: [], buttons: [],
          })),
        });
      }
      return json({});
    });
    await boot(page);
    await page.evaluate(() => window.__SBS_TEST_API.simple.setMode('simple', { force: true }));
    await page.locator('#simple-brief').fill('Harbour Dental is a family dental practice in Portsmouth. We want nervous adults to book online.');

    // One press. There is no draft to review and no second button to apply it:
    // both were steps that had to happen anyway, so neither is a step now.
    await page.locator('[data-brain-action="build-concepts"]').click();
    await expect(page.locator('.concept-card')).toHaveCount(3);
    await expect(page.locator('#editorInner [data-brain-action="write-content"]')).toHaveCount(0);
    await expect(page.locator('#editorInner [data-brain-action="apply-content"]')).toHaveCount(0);

    await expect
      .poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.sections[0].content.title))
      .toBe('Copy for hero');
    // And it reached the rendered page, not just the project.
    await expect
      // `body` is null for the instant between two documents, and a poll that
      // throws there fails on a page that was correct before and after.
      .poll(() => page.locator('#sitePreview').evaluate((frame) => {
        const body = frame.contentDocument && frame.contentDocument.body;
        return Boolean(body && body.textContent.includes('Copy for hero'));
      }))
      .toBe(true);
  });
});

test.describe('what the brief states about the design', () => {
  test('reaches all three concepts, not one', async ({ page }) => {
    await boot(page);
    const concepts = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const simple = api.simple.ensure();
      simple.concepts = api.simple.normalizeConcepts([
        { name: 'Calm', archetypeKey: 'A', preset: 'calm', buttonStyle: 'solid-shift', dialOverrides: {}, why: 'w' },
        { name: 'Warm', archetypeKey: 'C', preset: 'friendly', buttonStyle: 'pill-glow', dialOverrides: {}, why: 'w' },
        { name: 'Bold', archetypeKey: 'B', preset: 'bold', buttonStyle: 'sweep-fill', dialOverrides: {}, why: 'w' },
      ]);
      return simple.concepts.length;
    });
    expect(concepts).toBe(3);

    // Everything the brief says outright, in one field.
    await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      api.state.project.brief.notes = 'Our brand colour is #0B3D2E. Use Fraunces for the headings. '
        + 'We want big typography and no animation.';
    });

    const directives = await page.evaluate(() => window.__SBS_TEST_API.briefDirectives());
    expect(directives.palette.accent).toBe('#0b3d2e');
    expect(directives.fontDisplay).toBe('Fraunces');
    expect(directives.dials).toMatchObject({ headline: 92, motion: 0 });

    // The archetype grid lives on the advanced builder's Direction step.
    await page.locator('[data-builder-mode="advanced"]').click();
    await page.locator('[data-step="1"]').click();
    await expect(page.locator('[data-archetype="A"]')).toBeVisible();

    // Applying any archetype keeps what the brief pinned and restyles the rest.
    const applied = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const out = [];
      for (const key of ['A', 'C', 'B']) {
        api.state.project.design.archetype = key;
        document.querySelector(`[data-archetype="${key}"]`)?.click();
        out.push({
          accent: api.state.project.design.palette.accent,
          fontDisplay: api.state.project.design.fontDisplay,
          headline: api.state.project.design.headline,
          motion: api.state.project.design.motion,
          // The archetype still owns everything the brief did not name.
          canvas: api.state.project.design.palette.bg,
        });
      }
      return out;
    });
    for (const design of applied) {
      expect(design.accent).toBe('#0b3d2e');
      expect(design.fontDisplay).toBe('Fraunces');
      expect(design.headline).toBe(92);
      expect(design.motion).toBe(0);
    }
    expect(new Set(applied.map((design) => design.canvas)).size).toBeGreaterThan(1);
  });
});

test.describe('the module a family opens with', () => {
  test('follows the brief and the dials instead of one fixed default', async ({ page }) => {
    await enterAdvanced(page);

    const picks = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const read = () => ['hero', 'cards', 'split'].map((family) => api.pickPattern(family, 0));

      // A restrained, text-led brief.
      Object.assign(api.state.project.design, { imagery: 6, expressiveness: 8, density: 20, measure: 18, motion: 0 });
      const quiet = read();

      // The same page asked to be photographic and loud.
      Object.assign(api.state.project.design, { imagery: 96, expressiveness: 94, density: 80, measure: 88, motion: 90 });
      const loud = read();

      return { quiet, loud, repeat: read() };
    });

    // Every family answered, and the two designs do not want the same modules.
    for (const id of [...picks.quiet, ...picks.loud]) expect(id).toBeTruthy();
    expect(picks.quiet).not.toEqual(picks.loud);
    // Deterministic: the same design asked twice gives the same page.
    expect(picks.repeat).toEqual(picks.loud);
  });

  test('explains itself, and an explicit pattern is still obeyed', async ({ page }) => {
    await enterAdvanced(page);
    const ranking = await page.evaluate(() => window.__SBS_TEST_API.patternChoice('hero', 0));
    expect(ranking.length).toBeGreaterThan(1);
    expect(ranking[0].score).toBeGreaterThanOrEqual(ranking[1].score);
    expect(ranking[0].why.join(' ')).toMatch(/\S/);

    const asked = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const wanted = api.patterns.filter((pattern) => pattern.family === 'hero').at(-1).id;
      return { wanted, got: api.createSection('hero', 0, wanted).patternId };
    });
    expect(asked.got).toBe(asked.wanted);
  });
});
