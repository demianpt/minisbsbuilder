import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * What lands in WordPress has to be what was approved in the preview.
 *
 * A page imported into WordPress came in with its pictures missing, and none of
 * the causes were in the patterns. The export had drifted to a media shape of
 * its own, deleted the background of every section that was not a banner, and
 * dropped the `id` key the importer needs in order to write an attachment id
 * back. Each test below names one of those and fails on it directly.
 *
 * The shapes asserted here are not invented: they are the shapes all 169
 * registered pattern files use, which is the only definition of "what the theme
 * reads" available outside the theme.
 */

async function exported(page) {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
  return page.evaluate(() => window.__SBS_TEST_API.buildCompleteExport());
}

/** Every node of every section, flattened. */
function nodesOf(artifact) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    out.push(node);
    (node.children || []).forEach(walk);
  };
  artifact.concept.page.sections.forEach(walk);
  return out;
}

/** Every object anywhere in the artifact that looks like a media reference. */
function mediaObjects(value, path = '', out = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => mediaObjects(entry, `${path}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    if (typeof value.url === 'string' && /^https?:\/\//.test(value.url)) out.push({ path, object: value });
    Object.keys(value).forEach((key) => mediaObjects(value[key], path ? `${path}.${key}` : key, out));
  }
  return out;
}

test.describe('the exported page carries what the preview showed', () => {
  test('a band whose pattern carries a background keeps it, light or dark', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await useAdvancedBuilder(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));

    // Sixteen patterns in the library put their photograph on a wrapper or a
    // column set rather than on a banner. The export used to delete it outright
    // — and for an inverted band, replace it with a flat token colour — so those
    // arrived in WordPress as plain rectangles whatever the preview had shown.
    const result = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const carrier = api.catalog.all().find((pattern) => {
        const holds = (node) => {
          const layers = (node.attributes || {}).backgroundImage;
          if (Array.isArray(layers) ? layers.length : Boolean(layers)) return true;
          return (node.children || []).some(holds);
        };
        return pattern.tree.component !== 'ds-blocks/dst-banner' && holds(pattern.tree);
      });
      if (!carrier) return { skipped: true };

      const read = (inverted) => {
        const section = api.createSection(carrier.family, 0, carrier.id);
        section.layout.inverted = inverted;
        api.state.project.sections.push(section);
        const artifact = api.buildCompleteExport();
        api.state.project.sections.pop();
        const found = [];
        const walk = (node) => {
          const layers = (node.attributes || {}).backgroundImage;
          if (Array.isArray(layers) && layers.length) found.push({ component: node.component, url: layers[0].desktop?.media?.url || '' });
          (node.children || []).forEach(walk);
        };
        artifact.concept.page.sections.forEach(walk);
        return found;
      };

      return { skipped: false, id: carrier.id, light: read(false), dark: read(true) };
    });

    test.skip(result.skipped, 'no pattern in the library carries a non-banner background');
    expect(result.light.length, `${result.id} lost its background on a light band`).toBeGreaterThan(0);
    expect(result.light[0].url, 'the background layer has no file').toMatch(/^https?:\/\//);
    expect(result.dark.length, `${result.id} lost its background on an inverted band`).toBeGreaterThan(0);
    expect(result.dark[0].url).toMatch(/^https?:\/\//);
  });

  test('every background layer names its file the way the theme reads it', async ({ page }) => {
    const artifact = await exported(page);
    const layers = nodesOf(artifact).flatMap((node) => {
      const value = (node.attributes || {}).backgroundImage;
      return Array.isArray(value) ? value.map((layer) => ({ component: node.component, layer })) : [];
    });
    expect(layers.length).toBeGreaterThan(0);
    const broken = layers.filter(({ layer }) => {
      const desktop = layer.desktop || {};
      const mobile = layer.mobile || {};
      return !desktop.media?.url || !mobile.media?.url
        || !desktop.media?.mime || !desktop.media?.type
        || !Number.isFinite(desktop.focal?.x) || !desktop.size;
    });
    expect(broken.map(({ component, layer }) => `${component}: ${JSON.stringify(layer).slice(0, 120)}`)).toEqual([]);
  });

  test('a media block exports an imagePrimary and a ratio, not a bare src', async ({ page }) => {
    const artifact = await exported(page);
    const blocks = nodesOf(artifact).filter((node) => ['ds-blocks/c-media', 'ds-blocks/l-content-2', 'ds-blocks/c-accordion'].includes(node.component));
    const carrying = blocks.filter((node) => (node.attributes || {}).media && Object.keys(node.attributes.media).length);
    expect(carrying.length, 'no media block carried a picture at all').toBeGreaterThan(0);
    const broken = carrying.filter((node) => {
      const media = node.attributes.media;
      return !media.imagePrimary?.url
        || media.primaryType !== 'image' && media.primaryType !== 'video'
        || !media.style?.desktop
        || media.imagePrimary.id === undefined
        || !media.imagePrimary.mimeType;
    });
    expect(broken.map((node) => `${node.component}: ${JSON.stringify(node.attributes.media).slice(0, 160)}`)).toEqual([]);
  });

  test('a ratio is written the way DST writes it', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await useAdvancedBuilder(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    // `16/9` is the builder's internal spelling; the theme reads `16x9`.
    const ratios = await page.evaluate(() => {
      const ratio = window.__SBS_TEST_API.exportMedia.ratio;
      return ['16/9', '4/3', '1:1', '3x4', '', 'nonsense'].map(ratio);
    });
    expect(ratios).toEqual(['16x9', '4x3', '1x1', '3x4', '', '']);
  });

  test('card media exports as an attachment the importer can fill in', async ({ page }) => {
    const artifact = await exported(page);
    const cards = nodesOf(artifact).filter((node) => node.component === 'ds-blocks/c-card-item');
    const carrying = cards.filter((node) => (node.attributes || {}).media?.url);
    expect(carrying.length).toBeGreaterThan(0);
    const broken = carrying.filter((node) => {
      const media = node.attributes.media;
      return media.id === undefined || !media.mimeType || !media.mediaType || !media.size;
    });
    expect(broken.map((node) => JSON.stringify(node.attributes.media))).toEqual([]);
  });

  test('every media reference keeps an id key, because the importer only fills one that exists', async ({ page }) => {
    const artifact = await exported(page);
    // SBS_Importer_Media writes the new attachment id back with
    // `if ( array_key_exists( 'id', $value ) )`. No key, no id, and a DST block
    // that resolves media by id renders nothing.
    const missing = mediaObjects(artifact.concept.page.sections)
      .filter(({ path, object }) => !Object.prototype.hasOwnProperty.call(object, 'id')
        // A button's link is a URL but not a media reference; the importer skips
        // those by the same reasoning.
        && !/link|button|menu|social/i.test(path))
      .map(({ path }) => path);
    expect(missing.slice(0, 12), `${missing.length} media references cannot receive an attachment id`).toEqual([]);
  });

  test('no exported URL points at a host WordPress cannot fetch', async ({ page }) => {
    const artifact = await exported(page);
    const json = JSON.stringify(artifact);
    const found = json.match(/https?:\/\/[a-z0-9.-]*\.local\/[^"]*/gi) || [];
    expect(found.slice(0, 5), `${found.length} unreachable URLs in the export`).toEqual([]);
  });

  test('a slider pattern still says it is a slider after the export', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await useAdvancedBuilder(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
    const kept = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      // A pattern whose source carries the slider settings the allow-list used
      // to delete, exported on its own.
      const pattern = api.catalog.all().find((entry) => {
        const json = JSON.stringify(entry.tree);
        return json.includes('enableLightSlider') || json.includes('lightSliderSettings');
      });
      if (!pattern) return { skipped: true };
      const section = api.createSection(pattern.family, 0, pattern.id);
      api.state.project.sections.push(section);
      const artifact = api.buildCompleteExport();
      api.state.project.sections.pop();
      const json = JSON.stringify(artifact);
      return { skipped: false, id: pattern.id, slider: json.includes('lightSliderSettings') || json.includes('enableLightSlider') };
    });
    test.skip(kept.skipped, 'no pattern in the library carries slider settings');
    expect(kept.slider, `${kept.id} lost its slider behaviour on the way out`).toBe(true);
  });
});
