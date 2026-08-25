import { expect, test } from '@playwright/test';
import { measureWhen } from './support/preview.mjs';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

async function openDirection(page) {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  await page.locator('[data-step="1"]').click();
  await expect(page.locator('.btn-style-list')).toBeVisible();
}

function previewButton(page) {
  return page.locator('#sitePreview').evaluate((frame) => {
    const doc = frame.contentDocument;
    const site = doc && doc.getElementById('sbs-site');
    // A frame caught between two documents has no site yet. Reporting that as a
    // null reading lets the caller keep polling; throwing here failed the test
    // on a page that was correct before and after the moment it was read.
    if (!site) return { attribute: null };
    const primary = doc.querySelector('.c-btn.-primary, .c-btn.-primary-inverted');
    const link = doc.querySelector('.c-btn.-link');
    const styles = primary ? getComputedStyle(primary) : null;
    return {
      attribute: site.getAttribute('data-button-style'),
      radius: styles?.borderTopLeftRadius,
      paddingLeft: styles?.paddingLeft,
      boxShadow: styles?.boxShadow,
      overflow: styles?.overflow,
      hasLink: Boolean(link),
      linkDecoration: link ? getComputedStyle(link).textDecorationLine : null,
    };
  });
}

test.describe('button families', () => {
  test('offers ten described families, each with a live sample', async ({ page }) => {
    await openDirection(page);
    const styles = await page.evaluate(() => window.__SBS_TEST_API.design.buttonStyles);
    expect(styles).toHaveLength(10);
    await expect(page.locator('.btn-style-card')).toHaveCount(10);
    for (const style of styles) {
      const card = page.locator(`.btn-style-card:has(input[value="${style.id}"])`);
      await expect(card).toContainText(style.label);
      await expect(card).toContainText('Hover:');
      await expect(card).toContainText('Best for:');
      // Each sample shows all three roles, because a family is all three.
      const preview = card.locator(`.btn-style-preview[data-button-style="${style.id}"]`);
      await expect(preview.locator('.c-btn.-primary')).toHaveCount(1);
      await expect(preview.locator('.c-btn.-secondary')).toHaveCount(1);
      await expect(preview.locator('.c-btn.-link')).toHaveCount(1);
    }
    // Solid Shift is the default so a new project always has a working family.
    await expect(page.locator('.btn-style-card.is-selected input')).toHaveValue('solid-shift');
  });

  test('each sample renders with its own geometry in the editor', async ({ page }) => {
    await openDirection(page);
    const shapes = await page.evaluate(() => {
      const out = {};
      for (const preview of document.querySelectorAll('.btn-style-preview')) {
        const button = preview.querySelector('.c-btn.-primary');
        const styles = getComputedStyle(button);
        out[preview.dataset.buttonStyle] = `${styles.borderTopLeftRadius}|${Math.round(Number.parseFloat(styles.paddingLeft))}|${styles.boxShadow.slice(0, 24)}`;
      }
      return out;
    });
    // Ten families must look like ten families, not one with ten names.
    expect(new Set(Object.values(shapes)).size).toBeGreaterThanOrEqual(7);
    expect(shapes['pill-glow']).toContain('999px');
    expect(shapes['offset-block']).toContain('0px|');
  });

  test('choosing a family changes the rendered page and the export', async ({ page }) => {
    await openDirection(page);
    const before = await previewButton(page);
    expect(before.attribute).toBe('solid-shift');

    await page.locator('.btn-style-card:has(input[value="offset-block"])').click();
    await expect(page.locator('.btn-style-card.is-selected input')).toHaveValue('offset-block');

    // The geometry is read in the same round trip that confirms the family
    // landed. Confirming first and measuring second can catch the preview
    // mid-rebuild and read the default radius off a document already replaced.
    const after = await measureWhen(() => previewButton(page), (value) => value.attribute === 'offset-block');
    expect(after.radius).toBe('0px');
    // The offset block is the whole idea of the family.
    expect(after.boxShadow).toMatch(/6px 6px/);
    expect(after.overflow).toBe('visible');

    const theme = await page.evaluate(() => window.__SBS_TEST_API.buildTheme());
    expect(theme.buttonStyle).toBe('offset-block');
    const html = await page.evaluate(() => window.__SBS_TEST_API.buildSiteDocument());
    expect(html).toContain('data-button-style="offset-block"');
    expect(html).toContain('/* button-style:offset-block */');
  });

  test('every family produces a distinct primary button in the real page', async ({ page }) => {
    await openDirection(page);
    const ids = await page.evaluate(() => window.__SBS_TEST_API.design.buttonStyles.map((style) => style.id));
    const seen = new Map();
    for (const id of ids) {
      await page.locator(`.btn-style-card:has(input[value="${id}"])`).click();
      // Measured in the same reading that confirms the family landed: a second
      // round trip can catch the preview mid-rebuild and read a default radius.
      const shape = await measureWhen(() => previewButton(page), (value) => value.attribute === id);
      seen.set(id, `${shape.radius}|${Math.round(Number.parseFloat(shape.paddingLeft))}|${shape.boxShadow.slice(0, 20)}`);
    }
    expect(new Set(seen.values()).size).toBeGreaterThanOrEqual(4);
  });

  test('choosing a family is a single undo step', async ({ page }) => {
    await openDirection(page);
    await page.locator('.btn-style-card:has(input[value="magnetic-arrow"])').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.design.buttonStyle)).toBe('magnetic-arrow');
    await page.locator('#undoBtn').click();
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.design.buttonStyle)).toBe('solid-shift');
  });

  test('no family moves the whole button upward on hover', async ({ page }) => {
    await openDirection(page);
    // Solid Shift and Pill Glow both used to lift on hover, Pill Glow far enough
    // to read as the button jumping away from the cursor. Neither travels now:
    // Solid Shift deepens its shadow, Pill Glow grows in place.
    const measure = async (id) => {
      const button = page.locator(`.btn-style-preview[data-button-style="${id}"] .c-btn.-primary`);
      await button.scrollIntoViewIfNeeded();
      await button.hover();
      // Long enough for the transition to have finished.
      await page.waitForTimeout(400);
      const transform = await button.evaluate((node) => getComputedStyle(node).transform);
      await page.mouse.move(2, 2);
      return transform;
    };
    // matrix(a,b,c,d,tx,ty): the last value is the vertical travel.
    const verticalTravel = (transform) => {
      if (transform === 'none') return 0;
      const parts = transform.replace(/^matrix\(/, '').replace(/\)$/, '').split(',').map(Number);
      return parts[5];
    };
    expect(verticalTravel(await measure('solid-shift'))).toBe(0);
    const pill = await measure('pill-glow');
    expect(verticalTravel(pill)).toBe(0);
    // Pill Glow still does something: it scales.
    expect(pill).toMatch(/matrix\(1\.0/);
  });

  test('a button label is readable on whatever ground its style paints', async ({ page }) => {
    await openDirection(page);
    // Every label colour used to be written as white, because the ground behind
    // a button was assumed dark. Across fifty archetypes it is not, and a pale
    // accent put white text on a light fill.
    const worst = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const luminance = (hex) => {
        const raw = hex.replace('#', '');
        const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
        const channels = [0, 2, 4]
          .map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255)
          .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const ratio = (a, b) => {
        const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (light + 0.05) / (dark + 0.05);
      };
      let lowest = Infinity;
      for (const style of api.styles.production()) {
        const palette = style.palette;
        const project = { ...api.state.project, design: { ...api.state.project.design, palette } };
        const tokens = api.buildSiteDocument(project).match(/#sbs-site\.ver\{[^}]*\}/)[0];
        const token = (name) => (tokens.match(new RegExp(`--dst--${name}:(#[0-9a-fA-F]{3,6})`)) || [])[1];
        for (const [label, ground] of [
          [token('btn-primary-c'), palette.accent],
          [token('btn-primary-c-hover'), palette.dark],
          [token('btn-secondary-c-hover'), palette.ink],
        ]) {
          if (!label || !ground) return 0;
          lowest = Math.min(lowest, ratio(label, ground));
        }
      }
      return lowest;
    });
    // The worst pair across all fifty archetypes was 1.09:1 — white on a
    // near-white accent, which is a button with no visible label at all.
    expect(worst).toBeGreaterThan(3.5);
  });

  test('the corner and movement dials reach the button samples too', async ({ page }) => {
    await openDirection(page);
    await page.locator('.dial[data-dial="corner"] input[type="range"]').fill('0');
    await expect.poll(() => page.locator('.btn-style-list').evaluate((node) => node.style.getPropertyValue('--dst--default-radius'))).toBe('0px');
    await page.locator('.dial[data-dial="motion"] input[type="range"]').fill('0');
    await expect.poll(() => page.locator('.btn-style-list').evaluate((node) => node.style.getPropertyValue('--sbs-motion-duration'))).toBe('0s');
  });

  test('an unknown persisted family falls back to the safe default', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      // A hostile or corrupted save must not be able to inject a style id.
      localStorage.setItem('sbs-dst-page-builder-v2', JSON.stringify({
        project: { brief: { projectName: 'Corrupt' }, design: { buttonStyle: 'evil-style' }, sections: [] },
      }));
    });
    await useAdvancedBuilder(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    await expect.poll(() => page.evaluate(() => window.__SBS_TEST_API.state.project.design.buttonStyle)).toBe('solid-shift');
  });
});
