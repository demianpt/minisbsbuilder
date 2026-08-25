import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * The registry is generated from a theme, so it has to agree with one.
 *
 * `normalizeExportNode` deletes any attribute the registry does not list, which
 * is the only thing stopping a builder-internal key reaching WordPress — and the
 * only thing that decides whether an imported block is editable in the WordPress
 * editor with the controls the builder used. When the theme is not checked out,
 * these skip rather than fail: the check is about agreement, and there is nothing
 * to agree with.
 */

const THEME = process.env.SBS_THEME
  || join(homedir(), 'sites/minisbssandbox/wp-content/themes/digitalsilk');
const BLOCKS = join(THEME, 'build/blocks');
const available = existsSync(BLOCKS);

function manifests(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) manifests(path, found);
    else if (entry.name === 'block.json') {
      try {
        const manifest = JSON.parse(readFileSync(path, 'utf8'));
        if (manifest.name) found.push(manifest);
      } catch { /* the theme's problem */ }
    }
  }
  return found;
}

const catalog = JSON.parse(readFileSync(new URL('../../src/data/dst-data.json', import.meta.url), 'utf8'));

describe.skipIf(!available)('the component registry agrees with the theme', () => {
  const blocks = manifests(BLOCKS);

  it('knows every block the theme defines', () => {
    const missing = blocks.map((block) => block.name).filter((name) => !catalog.registry[name]);
    expect(missing, `${missing.length} theme blocks are not in the registry`).toEqual([]);
  });

  it('knows every attribute those blocks declare', () => {
    const gaps = [];
    for (const block of blocks) {
      const known = new Set((catalog.registry[block.name]?.attributes || []).map((attribute) => attribute.name));
      for (const name of Object.keys(block.attributes || {})) {
        if (!known.has(name)) gaps.push(`${block.name} :: ${name}`);
      }
    }
    // An attribute the registry does not know is one the export deletes, so the
    // imported block cannot be edited with the control the builder used.
    expect(gaps, `${gaps.length} declared attributes would be deleted on export`).toEqual([]);
  });

  it('carries the footer block family, which the shorthand used to stand in for', () => {
    for (const name of ['ds-blocks/dst-footer', 'ds-blocks/dst-footer-section', 'ds-blocks/dst-footer-slot', 'ds-blocks/dst-site-logo']) {
      expect(catalog.registry[name], name).toBeTruthy();
    }
  });

  it('says where it came from', () => {
    expect(catalog.skill.registrySource).toBeTruthy();
    expect(catalog.skill.registeredComponentCount).toBe(Object.keys(catalog.registry).length);
  });
});

describe.skipIf(!available)('the recorded artifacts only use what the theme has', () => {
  const blocks = new Map(manifests(BLOCKS).map((block) => [block.name, block]));

  /* Same supports→attributes mapping the sync uses; see scripts/sync-dst-registry.mjs. */
  const FROM_SUPPORTS = {
    anchor: ['anchor'],
    dsContainers: ['dsContainer', 'dsContainerCustom', 'dsContainerSideGap', 'dsContainerSideGapMobile', 'dsContainerAlign'],
    dsGapControl: ['dsPadding', 'dsMargin'],
    dsEffects: ['dsEffects'],
    dsDeactivate: ['dsDeactivate'],
    dsClassVariants: ['classVariant'],
    dsClassList: ['class'],
    dsPatternSelector: ['dsPatternAppliedPatternId'],
  };

  function allowed(name) {
    const block = blocks.get(name);
    if (!block) return null;
    const out = new Set(['className', 'lock', 'metadata', ...Object.keys(block.attributes || {})]);
    const supports = block.supports || {};
    for (const [flag, names] of Object.entries(FROM_SUPPORTS)) if (supports[flag]) names.forEach((entry) => out.add(entry));
    if (supports.color) {
      if (supports.color.background !== false) out.add('backgroundColor');
      if (supports.color.gradients) out.add('gradient');
      if (supports.color.text !== false) out.add('textColor');
      out.add('style');
    }
    if (supports.typography) { if (supports.typography.fontSize) out.add('fontSize'); out.add('style'); }
    return out;
  }

  const fixtures = ['page.json', 'navigation.json', 'footer.json', 'complete-project.json']
    .map((name) => new URL(`../fixtures/wordpress/${name}`, import.meta.url))
    .filter((url) => existsSync(url));

  it('has fixtures to check', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it('names no block and no attribute the theme does not have', () => {
    const bad = [];
    let seen = 0;
    const visit = (node) => {
      if (!node || typeof node !== 'object' || !node.component) return;
      seen += 1;
      if (!/^(core\/|gravityforms\/)/.test(node.component)) {
        const known = allowed(node.component);
        if (!known) bad.push(`block ${node.component}`);
        else for (const name of Object.keys(node.attributes || {})) {
          if (!known.has(name)) bad.push(`${node.component} :: ${name}`);
        }
      }
      (node.children || []).forEach(visit);
    };
    for (const url of fixtures) {
      const artifact = JSON.parse(readFileSync(url, 'utf8'));
      (artifact.concept?.page?.sections || []).forEach(visit);
      Object.values(artifact.concept?.global || {}).forEach(visit);
    }
    // WordPress keeps an unknown attribute in the markup and ignores it, which is
    // worse than an error: a setting the strategist made that the page does not
    // have, and nothing anywhere says so.
    expect(seen).toBeGreaterThan(50);
    expect([...new Set(bad)], `${bad.length} exported values this theme would ignore`).toEqual([]);
  });
});
