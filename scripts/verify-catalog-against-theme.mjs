#!/usr/bin/env node
/**
 * Checks *every pattern in the catalogue* against a real theme checkout.
 *
 * `verify-against-theme.mjs` checks recorded fixtures, and it reported a clean
 * bill of health while a slider was importing as a plain grid. It was right
 * about what it measured: the four fixtures are one sample project, and the
 * attribute that broke — `enableLightSlider` — appears in none of them. Coverage
 * was the bug, not the check.
 *
 * So this exports all 156 patterns, one section at a time, and looks up every
 * block and every attribute in the theme's own `block.json` files. It needs the
 * dev server, because the export lives in the browser runtime.
 *
 *   npm run dev            # in another terminal
 *   node scripts/verify-catalog-against-theme.mjs [--theme <path>] [--json <out>]
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const ROOT = new URL('..', import.meta.url).pathname;
const THEME = flag('theme', join(homedir(), 'sites/minisbssandbox/wp-content/themes/digitalsilk'));
const ORIGIN = flag('origin', 'http://127.0.0.1:5173/');
const JSON_OUT = flag('json', '');

/* Duplicated from the fixture check on purpose: a check that imports the thing
   it is checking cannot fail when that thing is wrong. */
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

const NODE_KEYS = new Set(['id', 'component', 'usage', 'confidence', 'attributes', 'children', 'layout',
  'pattern', 'patternMeta', 'role', 'note', 'composed', 'inverted', 'dsEffects', 'decorations',
  'text', 'menus', 'legacyShorthand', 'titleAccents', 'classVariant', 'importerShorthand', 'footer',
  'nav', 'linkTypography', 'provenance']);

const FOREIGN = /^(core\/|gravityforms\/)/;

function attributesOf(manifest) {
  const out = new Set(['className', 'lock', 'metadata', ...Object.keys(manifest.attributes || {})]);
  const supports = manifest.supports || {};
  for (const [name, keys] of Object.entries(FROM_SUPPORTS)) if (supports[name]) keys.forEach((k) => out.add(k));
  if (supports.customClassName === false) out.delete('className');
  if (supports.color) {
    if (supports.color.background !== false) out.add('backgroundColor');
    if (supports.color.gradients) out.add('gradient');
    if (supports.color.text !== false) out.add('textColor');
    out.add('style');
  }
  if (supports.typography) { if (supports.typography.fontSize) out.add('fontSize'); out.add('style'); }
  if (supports.spacing) out.add('style');
  return out;
}

async function manifests(dir, found = new Map()) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await manifests(path, found);
    else if (entry.name === 'block.json') {
      try {
        const manifest = JSON.parse(readFileSync(path, 'utf8'));
        if (manifest.name) found.set(manifest.name, attributesOf(manifest));
      } catch { /* the theme's problem */ }
    }
  }
  return found;
}

const blocksDir = join(THEME, 'build/blocks');
if (!existsSync(blocksDir)) {
  console.error(`No built blocks at ${blocksDir}. Pass --theme /path/to/wp-content/themes/digitalsilk`);
  process.exit(1);
}
const theme = await manifests(blocksDir);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => { try { localStorage.clear() } catch (e) {} });
try {
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API), null, { timeout: 30000 });
} catch (error) {
  console.error(`Could not reach the builder at ${ORIGIN}. Start it with "npm run dev".`);
  await browser.close();
  process.exit(1);
}

const catalog = await page.evaluate(() => window.__SBS_TEST_API.patterns.map((p) => ({ id: p.id, family: p.family })));

/* Where a bad attribute came from, so a fix has somewhere to go. */
const unknownAttributes = new Map();
const unknownBlocks = new Map();
const strayNodeKeys = new Map();
let blocksChecked = 0;
let attributesChecked = 0;
const failures = [];

const note = (map, key, pattern) => {
  if (!map.has(key)) map.set(key, { count: 0, patterns: new Set() });
  const entry = map.get(key);
  entry.count += 1;
  entry.patterns.add(pattern);
};

for (const pattern of catalog) {
  let exported;
  try {
    exported = await page.evaluate(({ id, family }) => {
      const api = window.__SBS_TEST_API;
      const project = api.state.project;
      const kept = project.sections;
      const section = api.createSection(family, 0, id);
      project.sections = [section];
      api.ensureProject(project);
      const page2 = api.buildPageExport(project);
      project.sections = kept;
      return page2;
    }, pattern);
  } catch (error) {
    failures.push({ pattern: pattern.id, error: String(error).slice(0, 200) });
    continue;
  }

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (node.component) {
      blocksChecked += 1;
      for (const key of Object.keys(node)) {
        if (!NODE_KEYS.has(key)) note(strayNodeKeys, `${node.component} :: ${key}`, pattern.id);
      }
      if (!FOREIGN.test(node.component)) {
        const known = theme.get(node.component);
        if (!known) note(unknownBlocks, node.component, pattern.id);
        else {
          for (const attribute of Object.keys(node.attributes || {})) {
            attributesChecked += 1;
            if (!known.has(attribute)) note(unknownAttributes, `${node.component} :: ${attribute}`, pattern.id);
          }
        }
      }
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') visit(value);
    }
  };
  visit(exported);
}

await browser.close();

const rows = (map) => [...map.entries()]
  .sort((a, b) => b[1].count - a[1].count)
  .map(([key, entry]) => ({ key, count: entry.count, patterns: [...entry.patterns] }));

const report = {
  theme: THEME,
  patternsChecked: catalog.length,
  blocksChecked,
  attributesChecked,
  unknownBlocks: rows(unknownBlocks),
  unknownAttributes: rows(unknownAttributes),
  strayNodeKeys: rows(strayNodeKeys),
  exportFailures: failures,
};

if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));

console.log(`theme            ${THEME}`);
console.log(`patterns checked ${report.patternsChecked}`);
console.log(`blocks checked   ${report.blocksChecked}`);
console.log(`attrs checked    ${report.attributesChecked}`);
if (failures.length) console.log(`export failures  ${failures.length}`);

const show = (title, list) => {
  console.log(`\n${title} (${list.length})`);
  for (const row of list) {
    const where = row.patterns.length > 4
      ? `${row.patterns.slice(0, 4).join(', ')} +${row.patterns.length - 4} more`
      : row.patterns.join(', ');
    console.log(`  ${String(row.count).padStart(4)}x  ${row.key.padEnd(52)} ${where}`);
  }
};
show('BLOCKS THIS THEME DOES NOT HAVE', report.unknownBlocks);
show('ATTRIBUTES THIS THEME DOES NOT REGISTER', report.unknownAttributes);
show('NODE KEYS THE IMPORTER IS NOT TOLD ABOUT', report.strayNodeKeys);

const bad = report.unknownBlocks.length + report.unknownAttributes.length;
console.log(`\n${bad === 0 ? 'every block and attribute exists in this theme' : `${bad} kinds of setting would be ignored by WordPress`}`);
process.exit(bad === 0 ? 0 : 1);
