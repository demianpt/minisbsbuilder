import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * The catalogue, the patterns and the export have to agree.
 *
 * Three separate descriptions of the same 154 patterns had drifted apart: the
 * `counts` and `flags` each pattern ships, the one-line `look` shown in the UI,
 * and the component registry the export validates against. None of that is
 * cosmetic — pattern *selection* reads the flags and counts, and the export
 * deletes any attribute the registry does not list.
 *
 * These tests assert the agreement rather than a snapshot of it, so a pattern
 * added or re-ingested later cannot reintroduce the drift.
 */

async function boot(page) {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
}

test.describe('every pattern describes itself truthfully', () => {
  test('declared counts match the tree, for all of them', async ({ page }) => {
    await boot(page);
    const wrong = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      return api.patterns.map((entry) => entry.id).map((id) => {
        const pattern = api.catalog.all().find((p) => p.id === id);
        const derived = api.catalog.counts(api.catalog.nodes(pattern.tree));
        const declared = pattern.counts;
        const off = Object.keys(derived).filter((key) => Number(declared[key]) !== derived[key]);
        return off.length ? { id, off, declared, derived } : null;
      }).filter(Boolean);
    });
    expect(wrong, `${wrong.length} patterns declare counts their tree contradicts`).toEqual([]);
  });

  test('declared flags match the tree, for all of them', async ({ page }) => {
    await boot(page);
    const wrong = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      return api.catalog.all().map((pattern) => {
        const derived = api.catalog.flags(api.catalog.nodes(pattern.tree));
        const off = Object.keys(derived).filter((key) => Boolean(pattern.flags[key]) !== derived[key]);
        return off.length ? { id: pattern.id, off } : null;
      }).filter(Boolean);
    });
    expect(wrong, `${wrong.length} patterns declare flags their tree contradicts`).toEqual([]);
  });

  test('the default hero is not described as photograph-free', async ({ page }) => {
    await boot(page);
    // This was the sharpest symptom: `sbs-hero-p5-v3` is the hero every page
    // opens with, it carries a background image, and it declared media:false —
    // so a concept asking for dominant imagery scored its own default hero down.
    const hero = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const id = api.catalog.defaults().hero;
      const pattern = api.catalog.all().find((entry) => entry.id === id);
      return { id, media: pattern.flags.media, mediaLed: pattern.flags.mediaLed };
    });
    expect(hero.media).toBe(true);
    expect(hero.mediaLed, 'a hero band is a photograph, not a grid with pictures in it').toBe(true);
  });

  test('a look that names a count names the right one', async ({ page }) => {
    await boot(page);
    const wrong = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const words = { card: 'cards', cards: 'cards', item: 'listItems', items: 'listItems',
        column: 'columns', columns: 'columns', tab: 'tabs', tabs: 'tabs' };
      return api.catalog.all().map((pattern) => {
        const match = /(\d+)\s+(cards?|items?|columns?|tabs?)/.exec(pattern.look || '');
        if (!match) return null;
        const actual = pattern.counts[words[match[2]]];
        if (!actual) return null;
        return Number(match[1]) === actual ? null : { id: pattern.id, look: pattern.look, actual };
      }).filter(Boolean);
    });
    expect(wrong, `${wrong.length} patterns state a count they do not hold`).toEqual([]);
  });

  test('no pattern media points at a hostname that cannot resolve', async ({ page }) => {
    await boot(page);
    // `.local` is reserved for mDNS. WordPress cannot fetch it, so the importer
    // leaves a dead URL in the page — which looks filled until it ships.
    const bad = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const found = [];
      api.catalog.all().forEach((pattern) => {
        const json = JSON.stringify(pattern.tree);
        if (/https?:\/\/[a-z0-9.-]*\.local\//i.test(json)) found.push(pattern.id);
      });
      if (/https?:\/\/[a-z0-9.-]*\.local\//i.test(JSON.stringify(api.mediaLibrary()))) found.push('DATA.media');
      return found;
    });
    expect(bad, `${bad.length} patterns carry an unreachable media host`).toEqual([]);
  });

  test('every attribute the patterns use is one the export is allowed to keep', async ({ page }) => {
    await boot(page);
    const stripped = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const registry = api.registry();
      const out = {};
      api.catalog.all().forEach((pattern) => {
        api.catalog.nodes(pattern.tree).forEach((node) => {
          const entry = registry[node.component];
          if (!entry || node.component === 'gravityforms/form' || node.component.startsWith('core/')) return;
          const allowed = new Set((entry.attributes || []).map((attribute) => attribute.name));
          Object.keys(node.attributes || {}).forEach((key) => {
            if (!allowed.has(key)) out[`${node.component} :: ${key}`] = (out[`${node.component} :: ${key}`] || 0) + 1;
          });
        });
      });
      return out;
    });
    // Slider settings, a card overlay strength and `c-heading.description` — copy,
    // not styling — were all being deleted on the way out.
    expect(stripped, 'the export allow-list still deletes attributes the patterns use').toEqual({});
  });

  test('no family defaults to a pattern that is not in the registered library', async ({ page }) => {
    await boot(page);
    const bad = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const defaults = api.catalog.defaults();
      const placeholder = api.catalog.unregistered();
      return Object.keys(defaults).filter((family) => placeholder[defaults[family]])
        .map((family) => `${family}: ${defaults[family]}`);
    });
    expect(bad, 'a generated page opens with a pattern nobody can point at in the library').toEqual([]);
  });
});
