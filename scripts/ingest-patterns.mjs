#!/usr/bin/env node
/**
 * Re-ingests named SBS patterns from `patternsSBS/` into `src/data/dst-data.json`.
 *
 * This is deliberately not the legacy migration: it touches only the pattern
 * entries it is asked for, leaves every other byte of the data file alone, and
 * prints what it changed. It exists because two things were wrong in the shipped
 * library and both are a re-read of a file that was always correct:
 *
 *   * `sbs-pricing-p26-v1` held 77 of its 137 blocks — 26 of 44 card items, 12 of
 *     24 list items — so the second tab of a two-tab pricing table was half
 *     empty.
 *   * `sbs-hero-p30-v2` and `sbs-hero-p30-v4` were never ingested at all, while
 *     their siblings v1 and v3 were.
 *
 * The node shape is copied from the 154 trees already in the file rather than
 * invented: `{id, component, usage, confidence, attributes, children, layout}`,
 * with `layout.container`/`layout.padding` lifted out of `dsContainer`/`dsPadding`
 * and `classVariant` lifted to the node. `usage` comes from a component→usage
 * map read out of the existing trees, so a re-ingested pattern is
 * indistinguishable in shape from its neighbours.
 *
 *   node scripts/ingest-patterns.mjs                     # the three above
 *   node scripts/ingest-patterns.mjs sbs-faq-p1-v1 …     # or any named pattern
 *   node scripts/ingest-patterns.mjs --check             # report, write nothing
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = join(ROOT, 'src/data/dst-data.json');
const SOURCE = join(ROOT, 'patternsSBS');

/** Files whose name does not match the pattern id they define. */
const FILE_ALIASES = { 'sbs-faq-p1-v4': 'sbs-fqa-p1-v4', 'sbs-faq-p3-v2': 'sbs-fqa-p3-v2' };

const DEFAULT_TARGETS = [
  { id: 'sbs-pricing-p26-v1' },
  {
    id: 'sbs-hero-p30-v2',
    family: 'hero',
    category: 'hero',
    title: 'SBS Hero p30 v2',
    look: 'Photo-backed banner with a logo marquee beneath.',
    bestFor: 'An opening that has to name recognisable clients immediately.',
    avoidFor: 'A launch with no logos worth showing yet.',
  },
  {
    id: 'sbs-hero-p30-v4',
    family: 'hero',
    category: 'hero',
    title: 'SBS Hero p30 v4',
    look: 'Photo-backed banner with a logo marquee beneath.',
    bestFor: 'An opening that has to name recognisable clients immediately.',
    avoidFor: 'A launch with no logos worth showing yet.',
  },
];

/* ---------------------------------------------------------------- *
 * Reading a WordPress block-comment document
 * ---------------------------------------------------------------- */

const BLOCK = /<!--\s*(\/)?wp:([a-z0-9\-/]+)\s*(\{[\s\S]*?\})?\s*(\/)?-->/g;

/**
 * The `u002d` escapes.
 *
 * WordPress writes block attributes as JSON inside an HTML comment, so a `-`
 * that would end the comment is escaped. `var(--dst--h1-fs)` arrives as
 * `var(u002du002ddstu002du002dh1-fs)` and is meaningless until it is put back.
 */
function unescapeAttributes(value) {
  if (typeof value === 'string') return value.replace(/u002d/g, '-').replace(/u003c/g, '<').replace(/u003e/g, '>').replace(/u0026/g, '&');
  if (Array.isArray(value)) return value.map(unescapeAttributes);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = unescapeAttributes(entry);
    return out;
  }
  return value;
}

/** The block-comment document as a tree of `{name, attributes, children}`. */
function parseBlocks(content) {
  const root = { name: '', attributes: {}, children: [] };
  const stack = [root];
  BLOCK.lastIndex = 0;
  let match = BLOCK.exec(content);
  while (match) {
    const [, closing, name, raw, selfClosing] = match;
    if (closing) {
      if (stack.length > 1) stack.pop();
    } else {
      let attributes = {};
      if (raw) {
        try { attributes = unescapeAttributes(JSON.parse(raw)); }
        catch (error) { throw new Error(`unreadable attributes on wp:${name}: ${error.message}`); }
      }
      const node = { name, attributes, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
    }
    match = BLOCK.exec(content);
  }
  return root.children;
}

/* ---------------------------------------------------------------- *
 * Writing the builder's own node shape
 * ---------------------------------------------------------------- */

function containerOf(value, fallback = 'default') {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  if (['container-alt', 'alt'].includes(text)) return 'alt';
  if (['container-fluid', 'full', 'no-container'].includes(text)) return 'full';
  if (['container-wide', 'wide'].includes(text)) return 'wide';
  return 'default';
}

function paddingOf(value) {
  if (!value || typeof value !== 'object') return null;
  const side = (name) => {
    const entry = value[name];
    if (entry && typeof entry === 'object') return entry.type || entry.desktop || 'default';
    return typeof entry === 'string' && entry ? entry : 'default';
  };
  return { top: side('top'), bottom: side('bottom') };
}

/**
 * The attribute keys the ingested library does not carry.
 *
 * `metadata` names the WordPress pattern or reusable block a section came from.
 * Carrying it into an export would ask the target site to resolve a
 * `core/block/2475` that does not exist there, and every other pattern in the
 * library already drops it — so a re-ingest that kept it would be the odd one
 * out rather than the faithful one.
 */
const DROP_ATTRIBUTES = new Set(['metadata']);

function normalizeName(name) {
  return name.includes('/') ? name : `core/${name}`;
}

function build(node, patternId, usageFor, counter) {
  const component = normalizeName(node.name);
  const attributes = {};
  for (const [key, value] of Object.entries(node.attributes)) {
    if (DROP_ATTRIBUTES.has(key)) continue;
    attributes[key] = value;
  }
  const layout = { container: containerOf(attributes.dsContainer) };
  const padding = paddingOf(attributes.dsPadding);
  const out = {
    id: `${patternId}-b${counter.next++}`,
    component,
    usage: usageFor(component),
    confidence: 'confirmed',
    attributes,
    children: [],
    layout: padding ? { padding, container: layout.container } : layout,
  };
  if (typeof attributes.classVariant === 'string' && attributes.classVariant) out.classVariant = attributes.classVariant;
  out.children = node.children.map((child) => build(child, patternId, usageFor, counter));
  return out;
}

/* ---------------------------------------------------------------- *
 * Driving it
 * ---------------------------------------------------------------- */

function usageMap(patterns) {
  const seen = new Map();
  const walk = (node) => {
    if (!node) return;
    const tally = seen.get(node.component) || new Map();
    tally.set(node.usage || '', (tally.get(node.usage || '') || 0) + 1);
    seen.set(node.component, tally);
    (node.children || []).forEach(walk);
  };
  patterns.forEach((pattern) => walk(pattern.tree));
  const out = new Map();
  for (const [component, tally] of seen) {
    out.set(component, [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  }
  return out;
}

function countNodes(node) {
  return 1 + (node.children || []).reduce((total, child) => total + countNodes(child), 0);
}

function tallyComponents(node, out = new Map()) {
  out.set(node.component, (out.get(node.component) || 0) + 1);
  (node.children || []).forEach((child) => tallyComponents(child, out));
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const named = argv.filter((entry) => !entry.startsWith('--'));
  const targets = named.length ? named.map((id) => ({ id })) : DEFAULT_TARGETS;

  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  const usageFor = (() => {
    const map = usageMap(data.patterns);
    return (component) => map.get(component) || '';
  })();

  const report = [];
  for (const target of targets) {
    const file = join(SOURCE, `${FILE_ALIASES[target.id] || target.id}.json`);
    let source;
    try { source = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) { throw new Error(`no source pattern for ${target.id} (${file})`); }

    const blocks = parseBlocks(source.content || '');
    if (blocks.length !== 1) throw new Error(`${target.id} has ${blocks.length} root blocks; a pattern must have exactly one`);
    const tree = build(blocks[0], target.id, usageFor, { next: 1 });

    const existing = data.patterns.find((pattern) => pattern.id === target.id);
    const before = existing ? countNodes(existing.tree) : 0;
    const after = countNodes(tree);
    const components = [...tallyComponents(tree).keys()].map((name) => name.replace(/^ds-blocks\//, '')).sort();

    if (existing) {
      tree.pattern = existing.tree.pattern;
      tree.patternMeta = existing.tree.patternMeta;
      tree.role = existing.tree.role;
      existing.tree = tree;
      existing.components = components;
      existing.container = tree.component.replace(/^ds-blocks\//, '');
      report.push(`${target.id}: re-ingested, ${before} -> ${after} blocks`);
    } else {
      if (!target.family) throw new Error(`${target.id} is new, so it needs family/category/title in the script`);
      tree.pattern = target.id;
      tree.role = target.family;
      tree.patternMeta = { family: target.family, category: target.category, title: target.title, look: target.look };
      data.patterns.push({
        id: target.id,
        category: target.category,
        family: target.family,
        title: target.title,
        look: target.look,
        bestFor: target.bestFor,
        avoidFor: target.avoidFor,
        container: tree.component.replace(/^ds-blocks\//, ''),
        components,
        // Both are re-derived at boot from the tree, so these are a starting
        // point rather than a claim.
        counts: { cards: 0, listItems: 0, accordionItems: 0, tabs: 0, columns: 0 },
        flags: { form: false, slider: false, tabs: false, accordion: false, cards: false, media: false },
        tree,
      });
      report.push(`${target.id}: added, ${after} blocks`);
    }
  }

  // Deliberately not sorted: the file's order is the order it was written in, and
  // re-sorting 154 untouched entries would bury a three-pattern change in a
  // rewrite of the whole library.
  data.skill = { ...data.skill, patternCount: data.patterns.length, registeredComponentCount: Object.keys(data.registry).length };

  if (!check) writeFileSync(DATA, `${JSON.stringify(data, null, 2)}\n`);
  report.forEach((line) => console.log(check ? `would ${line}` : line));
  console.log(`${data.patterns.length} patterns${check ? ' (nothing written)' : ' written'}`);
}

main();
