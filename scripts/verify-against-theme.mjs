#!/usr/bin/env node
/**
 * Checks a generated artifact against a real theme checkout.
 *
 * This is the question the whole export exists to answer: *would WordPress render
 * this the way the preview did?* The theme is the only authority — it declares
 * which blocks exist, which attributes each one has, and which of those the
 * editor will show. So every block and every attribute in the artifact is looked
 * up in the theme's own `block.json` files, and anything that is not there is
 * reported: WordPress would keep it in the markup and ignore it, which is a
 * setting the strategist made and the page does not have.
 *
 *   npm run verify:export            # records fixtures first, then checks them
 *   node scripts/verify-against-theme.mjs --theme <path> [--file <artifact>]
 */
import { readFileSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const ROOT = new URL('..', import.meta.url).pathname;
const THEME = flag('theme', join(homedir(), 'sites/minisbssandbox/wp-content/themes/digitalsilk'));
const FILES = argv.includes('--file')
  ? [flag('file', '')]
  : ['page.json', 'navigation.json', 'footer.json', 'complete-project.json'].map((name) => join(ROOT, 'tests/fixtures/wordpress', name));

/*
 * The same supports→attributes mapping the registry sync uses. Duplicated on
 * purpose: this script is a *check*, and a check that imports the thing it is
 * checking cannot fail when that thing is wrong.
 */
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

/*
 * Keys the builder puts on a *node*, not on a block. They describe the node for
 * the importer and never become block attributes, so they are not measured.
 */
const NODE_KEYS = new Set(['id', 'component', 'usage', 'confidence', 'attributes', 'children', 'layout',
  'pattern', 'patternMeta', 'role', 'note', 'composed', 'inverted', 'dsEffects', 'decorations',
  'text', 'menus', 'legacyShorthand', 'titleAccents', 'classVariant', 'importerShorthand', 'footer', 'nav', 'linkTypography', 'provenance']);

/* Blocks WordPress or another plugin owns; the theme has no manifest for them. */
const FOREIGN = /^(core\/|gravityforms\/)/;

function attributesOf(manifest) {
  const out = new Set(['className', 'lock', 'metadata', ...Object.keys(manifest.attributes || {})]);
  const supports = manifest.supports || {};
  for (const [flag2, names] of Object.entries(FROM_SUPPORTS)) if (supports[flag2]) names.forEach((n) => out.add(n));
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

const report = { theme: THEME, files: [], unknownBlocks: {}, unknownAttributes: {}, blocks: 0, attributes: 0, nodeKeys: {} };

function visit(node, file) {
  if (!node || typeof node !== 'object' || !node.component) return;
  report.blocks += 1;
  const name = node.component;
  for (const key of Object.keys(node)) {
    if (!NODE_KEYS.has(key)) report.nodeKeys[`${name} :: ${key}`] = (report.nodeKeys[`${name} :: ${key}`] || 0) + 1;
  }
  if (!FOREIGN.test(name)) {
    const known = theme.get(name);
    if (!known) {
      report.unknownBlocks[name] = (report.unknownBlocks[name] || 0) + 1;
    } else {
      for (const attribute of Object.keys(node.attributes || {})) {
        report.attributes += 1;
        if (!known.has(attribute)) {
          const key = `${name} :: ${attribute}`;
          report.unknownAttributes[key] = (report.unknownAttributes[key] || 0) + 1;
        }
      }
    }
  }
  for (const child of node.children || []) visit(child, file);
}

for (const file of FILES) {
  if (!existsSync(file)) { report.files.push(`${file} — missing`); continue; }
  const artifact = JSON.parse(readFileSync(file, 'utf8'));
  report.files.push(file.replace(`${ROOT}`, ''));
  const concept = artifact.concept || {};
  for (const section of concept.page?.sections || []) visit(section, file);
  for (const part of Object.values(concept.global || {})) visit(part, file);
}

const fail = Object.keys(report.unknownBlocks).length + Object.keys(report.unknownAttributes).length;
console.log(JSON.stringify({
  theme: report.theme,
  files: report.files,
  blocksChecked: report.blocks,
  attributesChecked: report.attributes,
  unknownBlocks: report.unknownBlocks,
  unknownAttributes: report.unknownAttributes,
  extraNodeKeys: report.nodeKeys,
  verdict: fail ? 'attributes or blocks this theme does not know' : 'every block and attribute exists in this theme',
}, null, 2));
process.exitCode = fail ? 1 : 0;
