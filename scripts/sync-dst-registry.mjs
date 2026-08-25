#!/usr/bin/env node
/**
 * Rebuilds the DST component registry from a real theme checkout.
 *
 * The registry is what the export validates against: `normalizeExportNode`
 * deletes any attribute the registry does not list, which is the only thing
 * stopping a builder-internal key reaching WordPress. Until now it was a
 * *snapshot*, and a snapshot drifts — it was deleting slider settings and
 * `c-heading.description`, and it had never heard of the footer block family at
 * all. So it is generated.
 *
 * A block's real attribute set is not just what `block.json` declares. WordPress
 * adds attributes for the `supports` a block opts into, and the theme's own HOCs
 * add more — the container control, the gap control, the effects panel, the class
 * list, the variant picker, the pattern selector. Those are the attributes the
 * *editor* shows, which is the set that matters: an imported block has to be
 * editable in WordPress with every control the builder used.
 *
 *   node scripts/sync-dst-registry.mjs [--theme <path>] [--check]
 *
 * Defaults to ~/sites/minisbssandbox. Print-only with --check.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { homedir } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = join(ROOT, 'src/data/dst-data.json');
const argv = process.argv.slice(2);
const at = argv.indexOf('--theme');
const THEME = at >= 0 && argv[at + 1]
  ? argv[at + 1]
  : join(homedir(), 'sites/minisbssandbox/wp-content/themes/digitalsilk');
const CHECK = argv.includes('--check');

/*
 * What each `supports` flag adds to a block's attributes.
 *
 * Read out of the theme's own HOC bundles rather than guessed: every name below
 * appears in `build/blocks/hoc-components/*​/index.js`. The WordPress core ones
 * (`anchor`, `className`, the colour and typography sets, `style`) come from
 * core's `supports` handling.
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

/** Attributes core adds to every block that does not opt out. */
const ALWAYS = ['className', 'lock', 'metadata'];

const TYPE_DEFAULTS = { string: '', number: 0, boolean: false, array: [], object: {}, integer: 0 };

function supportsAttributes(supports = {}) {
  const out = new Set(ALWAYS);
  for (const [flag, names] of Object.entries(FROM_SUPPORTS)) {
    if (supports[flag]) names.forEach((name) => out.add(name));
  }
  if (supports.customClassName === false) out.delete('className');
  const colour = supports.color;
  if (colour) {
    if (colour.background !== false) out.add('backgroundColor');
    if (colour.gradients) out.add('gradient');
    if (colour.text !== false) out.add('textColor');
    out.add('style');
  }
  if (supports.typography) {
    if (supports.typography.fontSize) out.add('fontSize');
    out.add('style');
  }
  if (supports.spacing) out.add('style');
  return out;
}

/*
 * Attributes the builder authors itself, which no block.json declares.
 *
 * The overlay *strength* is the interesting one. This theme build expresses an
 * overlay's opacity inside the colour — `#333333b0` — while the pattern library,
 * exported from a DST install of a different vintage, carries a separate
 * `backgroundOverlayOpacity`. Both are kept: the strength is baked into the
 * colour on export so it survives either way, and the attribute rides along for
 * the install that reads it.
 */
const BUILDER_WRITES = {
  'ds-blocks/dst-wrapper': ['backgroundOverlayOpacity', 'htmlTag'],
  'ds-blocks/dst-banner': ['backgroundOverlayOpacity'],
  'ds-blocks/dst-banner-slide': ['backgroundOverlayOpacity'],
  'ds-blocks/ds-columns': ['backgroundOverlayOpacity'],
  'ds-blocks/l-content-2': ['backgroundOverlayOpacity'],
  'ds-blocks/c-cards': ['backgroundOverlayOpacity', 'mediaOverlayOpacity'],
  'ds-blocks/c-list': ['backgroundOverlayOpacity', 'mediaOverlayOpacity'],
  // The sticky-media marker, and the class list on blocks whose build in this
  // theme has not opted into `dsClassList` yet.
  'ds-blocks/ds-column': ['class'],
};

/**
 * Every attribute name the registered patterns actually put on this component.
 *
 * The pattern library is 169 exports from a live DST install, so an attribute
 * appearing there is one the theme wrote — even when this particular theme build
 * does not declare it. Dropping those would delete real values on the way out,
 * which is the failure the allow-list exists to prevent, mirrored.
 */
function observedAttributes(patterns) {
  const seen = new Map();
  const walk = (node) => {
    if (!node || !node.component) return;
    const set = seen.get(node.component) || new Set();
    Object.keys(node.attributes || {}).forEach((name) => set.add(name));
    seen.set(node.component, set);
    (node.children || []).forEach(walk);
  };
  patterns.forEach((pattern) => walk(pattern.tree));
  return seen;
}

/** One registry entry, in the shape the builder already reads. */
function entryFor(manifest, previous, observed) {
  const declared = manifest.attributes || {};
  const names = new Set([
    ...Object.keys(declared),
    ...supportsAttributes(manifest.supports || {}),
    ...(observed.get(manifest.name) || []),
    ...(BUILDER_WRITES[manifest.name] || []),
  ]);
  const attributes = [...names].sort().map((name) => {
    const spec = declared[name] || {};
    const type = Array.isArray(spec.type) ? spec.type[0] : spec.type;
    const hasDefault = Object.prototype.hasOwnProperty.call(spec, 'default');
    return {
      name,
      type: type || 'string',
      enum: Array.isArray(spec.enum) ? spec.enum : null,
      // A declared default is the block's own; anything the *supports* added has
      // no declared default, and giving it one would write a value into every
      // exported block that WordPress would otherwise leave alone.
      default: hasDefault ? spec.default : (name in declared ? (TYPE_DEFAULTS[type] ?? null) : null),
      hasDefault: true,
    };
  });
  return {
    id: manifest.name,
    title: manifest.title || previous?.title || manifest.name,
    description: manifest.description || previous?.description || '',
    // The builder's own taxonomy, which the theme has no opinion about. Kept from
    // the previous registry so a re-sync does not throw away the pattern-scoring
    // vocabulary, and defaulted for a block the builder has not seen before.
    role: previous?.role || (manifest.parent ? 'child' : 'section'),
    componentRole: previous?.componentRole || (manifest.parent ? 'child' : 'layout'),
    bestFor: previous?.bestFor || [],
    avoidFor: previous?.avoidFor || [],
    mandatoryAttributes: previous?.mandatoryAttributes || [],
    attributes,
  };
}

async function manifests(dir, found = []) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await manifests(path, found);
    else if (entry.name === 'block.json') {
      try {
        const manifest = JSON.parse(readFileSync(path, 'utf8'));
        if (manifest.name) found.push({ manifest, path });
      } catch { /* a manifest that will not parse is the theme's problem */ }
    }
  }
  return found;
}

const blocksDir = join(THEME, 'build/blocks');
if (!existsSync(blocksDir)) {
  console.error(`No built blocks at ${blocksDir}.\nPass --theme /path/to/wp-content/themes/digitalsilk`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(DATA, 'utf8'));
const before = data.registry;
const found = await manifests(blocksDir);
const observed = observedAttributes(data.patterns);
const report = { theme: THEME, blocks: 0, added: [], attributesAdded: 0, attributesRemoved: 0, kept: [] };

const next = {};
for (const { manifest } of found) {
  const previous = before[manifest.name];
  const entry = entryFor(manifest, previous, observed);
  const had = new Set((previous?.attributes || []).map((attribute) => attribute.name));
  const now = new Set(entry.attributes.map((attribute) => attribute.name));
  for (const name of now) if (!had.has(name)) report.attributesAdded += 1;
  for (const name of had) if (!now.has(name)) report.attributesRemoved += 1;
  if (!previous) report.added.push(manifest.name);
  next[manifest.name] = entry;
  report.blocks += 1;
}

/*
 * Blocks the theme does not define but the export legitimately emits.
 *
 * `gravityforms/form` is another plugin's block and `core/*` are WordPress's own.
 * Dropping them would make the export delete every attribute on a paragraph.
 */
for (const [name, entry] of Object.entries(before)) {
  if (next[name]) continue;
  if (name.startsWith('core/') || !name.startsWith('ds-blocks/')) { next[name] = entry; report.kept.push(name); continue; }
  report.kept.push(`${name} (not in this theme — kept)`);
  next[name] = entry;
}

data.registry = Object.fromEntries(Object.keys(next).sort().map((name) => [name, next[name]]));
data.skill = {
  ...data.skill,
  registeredComponentCount: Object.keys(data.registry).length,
  registeredAttributeCount: Object.values(data.registry).reduce((sum, entry) => sum + entry.attributes.length, 0),
  registrySource: 'digitalsilk theme build/blocks',
};

if (!CHECK) writeFileSync(DATA, `${JSON.stringify(data, null, 2)}\n`);
console.log(JSON.stringify({ ...report, components: Object.keys(data.registry).length, attributes: data.skill.registeredAttributeCount, wrote: !CHECK }, null, 2));
