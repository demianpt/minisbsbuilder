import { expect, test } from '@playwright/test';
import { useAdvancedBuilder } from './support/builder-mode.mjs';

/**
 * The header and the footer, as real block trees.
 *
 * They used to be shorthand: one `dst-navigation` node with a `nav: {logo, menu,
 * cta}` object hanging off it, and the importer expanded that into whatever it
 * guessed the navigation family looked like. Nobody was reading the theme, which
 * is why an imported header never matched the preview.
 *
 * The theme ships the answer — `parts/header.html` and `parts/footer.html` in the
 * digitalsilk theme are the canonical trees — and these assert the export builds
 * the same shape, with the same attribute names, in the same nesting.
 */

async function boot(page) {
  await page.addInitScript(() => localStorage.clear());
  await useAdvancedBuilder(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API));
}

/** The exported tree as `component` paths, so nesting is asserted, not just presence. */
const treeOf = (page, which) => page.evaluate((part) => {
  const api = window.__SBS_TEST_API;
  const artifact = part === 'navigation' ? api.buildNavigationExport() : api.buildFooterExport();
  const root = artifact.concept.global[part];
  const paths = [];
  const walk = (node, trail) => {
    const here = [...trail, node.component];
    paths.push(here.join(' > '));
    (node.children || []).forEach((child) => walk(child, here));
  };
  walk(root, []);
  return paths;
}, which);

const nodeAt = (page, which, path) => page.evaluate(({ part, wanted }) => {
  const api = window.__SBS_TEST_API;
  const artifact = part === 'navigation' ? api.buildNavigationExport() : api.buildFooterExport();
  let found = null;
  const walk = (node, trail) => {
    const here = [...trail, node.component];
    if (!found && here.join(' > ') === wanted) found = node;
    (node.children || []).forEach((child) => walk(child, here));
  };
  walk(artifact.concept.global[part], []);
  return found;
}, { part: which, wanted: path });

test.describe('the header exports as the theme builds it', () => {
  test('the canonical navigation tree, nesting and all', async ({ page }) => {
    await boot(page);
    const paths = await treeOf(page, 'navigation');
    // Straight off `parts/header.html`.
    for (const path of [
      'ds-blocks/dst-navigation',
      'ds-blocks/dst-navigation > ds-blocks/dst-navigation-top',
      'ds-blocks/dst-navigation > ds-blocks/dst-navigation-main',
      'ds-blocks/dst-navigation > ds-blocks/dst-navigation-main > ds-blocks/dst-navigation-content',
      'ds-blocks/dst-navigation > ds-blocks/dst-navigation-main > ds-blocks/dst-navigation-content > ds-blocks/dst-site-logo',
      'ds-blocks/dst-navigation > ds-blocks/dst-navigation-main > ds-blocks/dst-navigation-content > ds-blocks/dst-navigation-menu',
      'ds-blocks/dst-navigation > ds-blocks/dst-navigation-main > ds-blocks/dst-navigation-content > ds-blocks/dst-navigation-search',
      'ds-blocks/dst-navigation > ds-blocks/dst-navigation-mobile',
      'ds-blocks/dst-navigation > ds-blocks/dst-navigation-mobile > ds-blocks/dst-navigation-content > ds-blocks/dst-site-logo',
      'ds-blocks/dst-navigation > ds-blocks/dst-navigation-mobile > ds-blocks/dst-navigation-mobile-dropdown > ds-blocks/dst-navigation-menu',
      'ds-blocks/dst-navigation > ds-blocks/dst-navigation-bottom',
    ]) expect(paths, path).toContain(path);
    // And it is not shorthand any more.
    const root = await nodeAt(page, 'navigation', 'ds-blocks/dst-navigation');
    expect(root.importerShorthand).toBeUndefined();
    expect(root.children.length).toBeGreaterThan(3);
  });

  test('the three navigation areas are named the way the theme names them', async ({ page }) => {
    await boot(page);
    const areas = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const nav = api.buildNavigationExport().concept.global.navigation;
      const out = [];
      const walk = (node) => {
        if (node.component === 'ds-blocks/dst-navigation-content') {
          out.push({ area: node.attributes.navigationArea, className: node.attributes.className });
        }
        (node.children || []).forEach(walk);
      };
      walk(nav);
      return out;
    });
    expect(areas).toEqual([
      { area: 'logo', className: 'site-header__col -left' },
      { area: 'menu', className: 'site-header__col -center' },
      { area: 'search', className: 'site-header__col -right' },
      { area: 'logo', className: 'site-header__widget' },
    ]);
  });

  test('the mobile takeover is exported, not lost', async ({ page }) => {
    await boot(page);
    const styles = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const read = () => api.buildNavigationExport().concept.global.navigation.attributes.className;
      const before = read();
      api.state.project.header.mobileMenu = 'aurora';
      return { before, after: read() };
    });
    // The takeover style has no DST attribute behind it, so it travels as a class
    // the theme's stylesheet can hook — losing it silently is what used to happen.
    expect(styles.before).toMatch(/mobile-menu--/);
    expect(styles.after).toContain('mobile-menu--aurora');
  });

  test('the menu is bound by location, and the links travel for the importer to build it', async ({ page }) => {
    await boot(page);
    const bound = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const nav = api.buildNavigationExport().concept.global.navigation;
      const menus = [];
      const walk = (node) => {
        if (node.component === 'ds-blocks/dst-navigation-menu') menus.push(node.attributes);
        (node.children || []).forEach(walk);
      };
      walk(nav);
      return { menus, plan: nav.menus };
    });
    // The theme's block reads a location, not a list of links and not a menu id.
    for (const menu of bound.menus) {
      expect(menu.menuSource).toBe('location');
      expect(menu.menuLocation).toBeTruthy();
      expect(menu.menuContext).toBeTruthy();
    }
    // And the links are in the artifact, so the importer can build that menu and
    // point the location at it. Without this the header imports empty.
    expect(bound.plan.length).toBeGreaterThan(0);
    const primary = bound.plan.find((entry) => entry.location === 'primary-menu');
    expect(primary.items.length).toBeGreaterThan(1);
    expect(primary.items[0]).toHaveProperty('label');
    expect(primary.items[0]).toHaveProperty('url');
  });
});

test.describe('the footer exports as the theme builds it', () => {
  test('three sections, each naming its own area', async ({ page }) => {
    await boot(page);
    const areas = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const footer = api.buildFooterExport().concept.global.footer;
      const out = { root: footer.component, rows: footer.attributes.enabledRows, sections: [] };
      (footer.children || []).forEach((child) => out.sections.push({
        component: child.component,
        area: child.attributes.sectionArea,
        slots: (child.children || []).filter((slot) => slot.component === 'ds-blocks/dst-footer-slot').length,
      }));
      return out;
    });
    expect(areas.root).toBe('ds-blocks/dst-footer');
    expect(areas.rows).toEqual({ top: true, middle: true, bottom: true });
    expect(areas.sections.map((section) => section.component))
      .toEqual(['ds-blocks/dst-footer-section', 'ds-blocks/dst-footer-section', 'ds-blocks/dst-footer-section']);
    expect(areas.sections.map((section) => section.area)).toEqual(['top', 'middle', 'bottom']);
    // Brand column plus the menu columns.
    expect(areas.sections[1].slots).toBeGreaterThan(2);
  });

  test('a link column is anchors, because a list item has no link attribute', async ({ page }) => {
    await boot(page);
    // `c-list-item` looks like the right block and is not: it has `listTitle`,
    // `listSubTitle`, `heroText` and `icon`, and no link. A column built from
    // list items imports as unclickable words.
    const columns = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const footer = api.buildFooterExport().concept.global.footer;
      const found = { listItems: 0, anchors: 0 };
      const walk = (node) => {
        if (node.component === 'ds-blocks/c-list-item') found.listItems += 1;
        if (node.component === 'core/paragraph' && /<a href=/.test(node.text || '')) found.anchors += 1;
        (node.children || []).forEach(walk);
      };
      walk(footer);
      return found;
    });
    expect(columns.listItems).toBe(0);
    expect(columns.anchors).toBeGreaterThan(0);
  });

  test('the footer is not shorthand any more', async ({ page }) => {
    await boot(page);
    const footer = await page.evaluate(() => window.__SBS_TEST_API.buildFooterExport().concept.global.footer);
    expect(footer.importerShorthand).toBeUndefined();
    // Kept beside the tree, so a 1.0 plugin degrades to the old behaviour rather
    // than importing nothing.
    expect(footer.legacyShorthand).toBeTruthy();
  });
});

test.describe('an overlay strength survives the crossing', () => {
  test('the strength is folded into the colour, because the block has no opacity attribute', async ({ page }) => {
    await boot(page);
    const folded = await page.evaluate(() => {
      const api = window.__SBS_TEST_API;
      const section = api.state.project.sections.find((entry) => entry.family === 'hero');
      const fidelity = api.state.project.sections.find((entry) => entry.id === section.id).fidelity;
      fidelity.surface.overlayEnabled = true;
      fidelity.surface.overlay = '#112233';
      fidelity.surface.overlayOpacity = 0.6;
      api.state.project.sections.forEach((entry) => entry);
      const artifact = api.buildCompleteExport();
      const out = { colour: '', opacity: 'absent' };
      const walk = (node) => {
        const attrs = node.attributes || {};
        if (attrs.backgroundOverlay && !out.colour) {
          out.colour = attrs.backgroundOverlay;
          if ('backgroundOverlayOpacity' in attrs) out.opacity = attrs.backgroundOverlayOpacity;
        }
        (node.children || []).forEach(walk);
      };
      artifact.concept.page.sections.forEach(walk);
      return out;
    });
    // 60% of #112233 is #11223399. Exported as a separate number it landed at
    // full strength and the photograph vanished behind a solid band of ink.
    expect(folded.colour.toLowerCase()).toBe('#11223399');
    expect(folded.opacity).toBe('absent');
  });
});
