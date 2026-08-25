import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

const catalog = JSON.parse(readFileSync(new URL('../../src/data/dst-data.json', import.meta.url), 'utf8'));

/**
 * "Bright background, bright text."
 *
 * Every other check in this suite reasons about colour from the project model,
 * which is the same model the mistakes are made in — a card whose scrim never
 * rendered, a band that painted its own background, a heading inheriting an
 * inverted class from a section that turned out light. None of those are visible
 * from there.
 *
 * These tests measure the rendered page instead: real computed colours against
 * the first opaque thing behind them, across every archetype the builder ships
 * and every family it can place.
 */

const FAMILIES = ['hero', 'stats', 'cards', 'slider', 'timeline', 'split', 'faq', 'pricing', 'testimonial', 'gallery', 'text', 'cta'];
const ARCHETYPES = Object.keys(catalog.archetypeStyles);

async function boot(page) {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
}

/** The audit the builder runs on its own preview, read back after a render. */
async function legibility(page) {
  await expect.poll(() => page.evaluate(() => Boolean((window.__SBS_TEST_API.state.previewAudit || {}).legibility)), { timeout: 15_000 }).toBe(true);
  return page.evaluate(() => window.__SBS_TEST_API.state.previewAudit.legibility);
}

async function buildPage(page, archetype) {
  await page.locator('[data-step="1"]').click();
  await page.locator(`[data-archetype="${archetype}"]`).click();
  await page.evaluate((families) => window.__SBS_TEST_API.brain.applyCustomFlow({ name: 'contrast probe', rationale: 't', families }), FAMILIES);
}

test.describe('every band can be read', () => {
  test('no archetype produces a section whose text is lost in its own background', async ({ page }) => {
    await boot(page);
    const broken = [];
    let measured = 0;
    for (const archetype of ARCHETYPES) {
      await buildPage(page, archetype);
      const result = await legibility(page);
      measured += result.checked;
      for (const failure of result.failures) {
        broken.push(`${archetype} · ${failure.id.replace(/-[^-]+-[^-]+$/, '')} · ${failure.ratio}:1 · "${failure.sample}"`);
      }
    }
    // Proof the measurement ran rather than quietly finding nothing to look at.
    expect(measured).toBeGreaterThan(ARCHETYPES.length * 3);
    expect(broken).toEqual([]);
  });

  test('text over a photograph is left to the overlay controls, not measured against the page', async ({ page }) => {
    await boot(page);
    await buildPage(page, 'A');
    const result = await legibility(page);
    // A hero is white type on a picture behind a scrim. Measuring it against the
    // page paper would report 1.1:1 for a headline anyone can read, so those
    // bands are excluded rather than reported as failures.
    expect(result.sections.some((entry) => entry.id.includes('hero'))).toBe(false);
    expect(result.sections.length).toBeGreaterThan(0);
  });

  /**
   * The negative control: is the instrument blind?
   *
   * Four tests above say every band in every archetype can be read. That claim
   * is worth nothing unless this one fails when a band cannot be, and for two
   * releases it did not — it tried to force the failure through the project
   * model, and the model kept defending itself. Palette repair put the ink back;
   * the derived tokens read text colour off the ground rather than from the ink;
   * every band with a photograph behind it inverts its copy and is excluded
   * anyway. All of that is the product being right, and none of it leaves a way
   * to express "unreadable" in the model.
   *
   * So the sabotage is applied where the audit actually looks: the rendered
   * page. One band's copy is painted the exact colour of the ground behind it —
   * which is the failure this check exists for, however it came about — and the
   * audit has to name that band and no other.
   */
  test('catches a band that really is unreadable', async ({ page }) => {
    await boot(page);
    await buildPage(page, 'A');
    const clean = await legibility(page);
    expect(clean.failures, 'the page was not legible before the sabotage').toEqual([]);

    const sabotaged = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const frame = document.getElementById('sitePreview');
      const doc = frame.contentDocument;
      const view = frame.contentWindow;
      const target = api.auditDocument(doc).legibility.sections[0];
      const band = doc.getElementById(target.id);

      /*
       * Each line painted the colour of *its own* ground, not the band's.
       *
       * One colour for the whole band does not work: a slider's card sits on its
       * own opaque panel, so painting its title the colour of the band behind the
       * panel makes that line more readable, not less. The walk below is the
       * audit's own — the first opaque thing behind this element — and the
       * selector is the audit's own too, so what is sabotaged is exactly what is
       * measured.
       */
      const groundOf = (element) => {
        let node = element;
        while (node) {
          if (/url\(/i.test(view.getComputedStyle(node).backgroundImage || '')) return '';
          const parts = (view.getComputedStyle(node).backgroundColor.match(/[\d.]+/g) || []).map(Number);
          if (parts.length >= 3 && (parts.length < 4 || parts[3] > 0.85)) return `rgb(${parts[0]},${parts[1]},${parts[2]})`;
          node = node.parentElement;
        }
        return '';
      };
      let painted = 0;
      let ground = '';
      band.querySelectorAll(api.legibilityTextSelector).forEach((element) => {
        const behind = groundOf(element);
        if (!behind) return;
        element.style.setProperty('color', behind, 'important');
        ground = behind;
        painted += 1;
      });

      // Re-audited and stored the way `renderPreview` stores it, so the preflight
      // check is reading the same measurement.
      const audit = api.auditDocument(doc);
      api.state.previewAudit = audit;
      return { id: target.id, was: target.ratio, target: target.target, ground, painted, legibility: audit.legibility };
    });

    expect(sabotaged.painted, 'no copy in the band could be painted').toBeGreaterThan(0);
    expect(sabotaged.ground, 'no opaque ground was found behind the copy').toMatch(/^rgb\(/);
    expect(sabotaged.was, 'the band chosen for sabotage was already failing').toBeGreaterThanOrEqual(sabotaged.target);
    // Exactly the band that was sabotaged, and nothing else.
    expect(sabotaged.legibility.failures.map((entry) => entry.id)).toEqual([sabotaged.id]);
    const failure = sabotaged.legibility.failures[0];
    expect(failure.ratio).toBeLessThan(1.1);
    expect(failure.sample.length).toBeGreaterThan(0);

    // And the preflight gate says so, in words, with the band and the number.
    const checks = await page.evaluate(() => window.__SBS_TEST_API.validate().checks);
    const rendered = checks.find((check) => check.code === 'RENDER-CONTRAST');
    expect(rendered.status).toBe('fail');
    expect(rendered.detail).toMatch(/:1/);
    expect(rendered.detail).toContain(failure.sample.slice(0, 12));
  });

  test('a stated colour survives every archetype, and the page stays readable', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.__SBS_TEST_API.state.project.brief.notes = 'We are a golf club. Make it green and white.';
    });
    // Green becomes the brand colour and white the page — never the other way
    // round, and never white as the inverted band.
    const directives = await page.evaluate(() => window.__SBS_TEST_API.briefDirectives());
    expect(directives.palette).toMatchObject({ accent: '#1F6F43', bg: '#FFFFFF' });
    expect(directives.palette.dark).toBeUndefined();

    for (const archetype of ['A', 'B', 'J']) {
      await buildPage(page, archetype);
      const design = await page.evaluate(() => window.__SBS_TEST_API.state.project.design);
      expect(design.palette.accent.toLowerCase()).toBe('#1f6f43');
      const result = await legibility(page);
      expect(result.failures).toEqual([]);
    }
  });

  test('shows what it measured, and what it had to move', async ({ page }) => {
    await boot(page);
    await page.locator('[data-step="1"]').click();
    await page.locator('[data-archetype="F"]').click();
    // Six pairings on screen under the swatches, so legibility is not a
    // judgement the strategist has to make by eye.
    await expect(page.locator('.palette-health li')).toHaveCount(6);
    await expect(page.locator('.palette-health__head b')).toHaveText('Every pairing is readable');
    // F ships a near-black band on a near-black page, which the builder lifts.
    await expect(page.locator('.palette-health__note')).toContainText('Adjusted for readability');
    await expect(page.locator('.palette-health__note')).toContainText('hue you chose is intact');
  });
});
