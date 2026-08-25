import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * The style library, in the builder.
 *
 * Ten families, fifty styles, in Simple and in Advanced. The assertion that
 * matters is the one §86 of the spec turns on: choosing a style must change the
 * *shape* of the page — which of the 154 patterns each band uses, how it is
 * contained, whether it is inverted — and not only its colours.
 */

async function boot(page, { advanced = true } = {}) {
  await page.setViewportSize({ width: 1680, height: 1050 });
  if (advanced) await useAdvancedBuilder(page);
  await page.route('**/api/brief/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
}

/** Everything a client would notice about the page, read off the project. */
function fingerprint(page) {
  return page.evaluate(() => {
    const api = window.__SBS_TEST_API;
    const project = api.state.project;
    return {
      style: api.styles.active() ? api.styles.key(api.styles.active()) : '',
      palette: JSON.stringify(project.design.palette),
      fontDisplay: project.design.fontDisplay,
      radius: project.design.radius,
      buttonStyle: project.design.buttonStyle,
      dials: api.design.dialKeys.map((key) => project.design[key]).join(','),
      patterns: project.sections.map((section) => section.patternId).join(','),
      containers: project.sections.map((section) => section.layout.container).join(','),
      inverted: project.sections.map((section) => (section.layout.inverted ? 1 : 0)).join(''),
      titles: project.sections.map((section) => section.content.title).join('|'),
    };
  });
}

async function chooseStyle(page, familyId, key) {
  await page.locator(`[data-style-family="${familyId}"]`).click();
  await page.locator(`[data-style-key="${key}"]`).click();
  await expect.poll(() => page.evaluate(() => {
    const api = window.__SBS_TEST_API;
    return api.styles.active() ? api.styles.key(api.styles.active()) : '';
  })).toBe(key);
}

test.describe('the style library', () => {
  test('offers ten families of five production styles', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => window.__SBS_TEST_API.styles.counts())).toMatchObject({ families: 10, styles: 50 });
    await page.locator('[data-step="1"]').click();
    await expect(page.locator('.style-family')).toHaveCount(10);
    // A family shows exactly its five styles, and only production ones.
    for (const familyId of ['technology', 'creative-culture', 'experimental']) {
      await page.locator(`[data-style-family="${familyId}"]`).click();
      await expect(page.locator('.style-card'), familyId).toHaveCount(5);
    }
  });

  test('is available in the simple builder too', async ({ page }) => {
    await boot(page, { advanced: false });
    await page.locator('[data-builder-mode="simple"]').click();
    await expect(page.locator('#simple-brief')).toBeVisible();
    await expect(page.locator('.style-family')).toHaveCount(10);
    await chooseStyle(page, 'luxury', 'luxury/quiet-luxury');
    expect(await page.evaluate(() => window.__SBS_TEST_API.state.project.design.fontDisplay)).toBe('Cormorant Garamond');
  });

  test('changes the shape of the page, not only its colours', async ({ page }) => {
    await boot(page);
    await page.locator('[data-step="1"]').click();
    const seen = [];
    for (const [familyId, key] of [
      ['creative-culture', 'creative-culture/art-gallery'],
      ['technology', 'technology/precision-saas'],
      ['automotive-mobility', 'automotive-mobility/performance-machine'],
      ['experimental', 'experimental/neo-brutalist'],
      ['luxury', 'luxury/quiet-luxury'],
    ]) {
      await chooseStyle(page, familyId, key);
      seen.push(await fingerprint(page));
    }
    const axis = (field) => new Set(seen.map((entry) => entry[field])).size;
    // Colour alone would be a palette preset. These are the axes that make it a
    // design language.
    expect(axis('patterns'), 'pattern selection').toBe(seen.length);
    expect(axis('containers'), 'containers').toBe(seen.length);
    expect(axis('dials'), 'design dials').toBe(seen.length);
    expect(axis('palette'), 'palette').toBe(seen.length);
    expect(axis('buttonStyle')).toBeGreaterThanOrEqual(4);
    expect(axis('fontDisplay')).toBeGreaterThanOrEqual(3);
    // And the copy is carried across every pattern swap.
    expect(new Set(seen.map((entry) => entry.titles)).size).toBe(1);
  });

  test('builds V1/V2/V3 from one style, as three interpretations of it', async ({ page }) => {
    await boot(page);
    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('[data-step="1"]').click();
    await chooseStyle(page, 'creative-culture', 'creative-culture/art-gallery');
    await page.locator('[data-style-action="generate"]').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.concepts.generated().length)).toBe(3);

    const concepts = await page.evaluate(() => window.__SBS_TEST_API.concepts.list().map((concept) => ({
      slot: concept.slot,
      variantType: concept.variantType,
      styleKey: `${concept.style.familyId}/${concept.style.styleId}`,
      accentDial: concept.design.accent,
      expressiveness: concept.design.expressiveness,
      headline: concept.design.headline,
      font: concept.design.fontDisplay,
    })));
    expect(concepts.map((concept) => concept.variantType)).toEqual(['core', 'brand-led', 'expressive']);
    // All three are the same design language…
    expect(new Set(concepts.map((concept) => concept.styleKey))).toEqual(new Set(['creative-culture/art-gallery']));
    expect(new Set(concepts.map((concept) => concept.font)).size).toBe(1);
    // …interpreted differently.
    expect(concepts[1].accentDial).toBeGreaterThan(concepts[0].accentDial);
    expect(concepts[2].expressiveness).toBeGreaterThan(concepts[0].expressiveness);
    expect(concepts[2].headline).toBeGreaterThan(concepts[0].headline);
  });

  test('records the style on the concept, and the exports carry it', async ({ page }) => {
    await boot(page);
    await page.locator('[data-step="1"]').click();
    await chooseStyle(page, 'automotive-mobility', 'automotive-mobility/performance-machine');
    const exported = await page.evaluate(() => window.__SBS_TEST_API.buildPageExport().concept.style);
    expect(exported).toMatchObject({
      familyId: 'automotive-mobility',
      styleId: 'performance-machine',
      styleVersion: '1.0.0',
    });
    // And the review step names it rather than an archetype letter.
    await page.locator('[data-step="4"]').click();
    await expect(page.locator('.concept-row').first()).toContainText('Performance Machine');
  });

  test('a style survives a reload, per concept', async ({ page }) => {
    await boot(page);
    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('[data-step="1"]').click();
    await chooseStyle(page, 'editorial', 'editorial/swiss-editorial');
    await page.locator('[data-style-action="generate"]').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.concepts.generated().length)).toBe(3);
    // Give V2 a different style entirely: a concept owns its own style (§26).
    await page.locator('[data-concept-pill="v2"]').click();
    await page.locator('[data-step="1"]').click();
    await chooseStyle(page, 'experimental', 'experimental/retro-future');

    const before = await page.evaluate(() => window.__SBS_TEST_API.concepts.list()
      .map((concept) => `${concept.id}:${concept.style.familyId}/${concept.style.styleId}`).join(' '));
    expect(before).toContain('v1:editorial/swiss-editorial');
    expect(before).toContain('v2:experimental/retro-future');
    expect(before).toContain('v3:editorial/swiss-editorial');

    await expect.poll(() => page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('sbs-builder-v3') || '{}').project?.conceptSet))).toBe(true);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    expect(await page.evaluate(() => window.__SBS_TEST_API.concepts.list()
      .map((concept) => `${concept.id}:${concept.style.familyId}/${concept.style.styleId}`).join(' '))).toBe(before);
  });

  test('an archetype chosen by hand stops the concept claiming a style', async ({ page }) => {
    await boot(page);
    await page.locator('[data-step="1"]').click();
    await chooseStyle(page, 'luxury', 'luxury/dark-prestige');
    await page.locator('[data-archetype="C"]').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.design.archetype)).toBe('C');
    expect(await page.evaluate(() => Boolean(window.__SBS_TEST_API.styles.active()))).toBe(false);
  });
});
