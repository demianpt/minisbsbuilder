#!/usr/bin/env node
/**
 * What the theme can be told, and what the export actually says.
 *
 * `verify-catalog-against-theme.mjs` asks the safety question — is anything we
 * emit unknown to the theme — and the answer has been yes-clean for a while. It
 * cannot see the opposite failure, which is the one that makes an imported page
 * look unlike the preview: an attribute the theme *does* register, that carries a
 * real design decision, and that the export never mentions. The block then falls
 * back to its own default and the section arrives subtly wrong in a way no
 * warning describes.
 *
 * So this walks the same exports and reports, per block, the registered
 * attributes that never once appear. Silence is not proof of a bug — plenty of
 * attributes should stay at their defaults — but it is where the differences
 * between preview and import have to live.
 *
 *   npm run dev
 *   node scripts/audit-export-coverage.mjs [--theme <path>] [--json <out>]
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

/* Attributes nothing should be expected to set: WordPress's own, and the
   editor-only bookkeeping the theme keeps on a block. */
const NOT_DESIGN = new Set(['lock', 'metadata', 'className', 'anchor', 'templateLock', 'allowedBlocks',
  'isInitialized', 'blockSelectedIndex', 'isActiveSelected', 'currentBlockIndex', 'specialModeColumnsSnapshot',
  'dstSliderEditorPreview', 'dsPatternAppliedPatternId', 'dsDeactivate']);

async function manifests(dir, found = new Map()) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') await manifests(path, found);
    else if (entry.name === 'block.json') {
      try {
        const m = JSON.parse(readFileSync(path, 'utf8'));
        if (m.name && m.attributes) found.set(m.name, new Set(Object.keys(m.attributes)));
      } catch { /* the theme's problem */ }
    }
  }
  return found;
}

if (!existsSync(THEME)) { console.error(`No theme at ${THEME}`); process.exit(2); }
const registered = await manifests(join(THEME, 'modules/gutenberg/blocks'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => { try { localStorage.clear() } catch (e) {} });
try {
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API), null, { timeout: 30000 });
} catch {
  console.error(`Could not reach the builder at ${ORIGIN}. Start it with "npm run dev".`);
  await browser.close();
  process.exit(1);
}

const catalog = await page.evaluate(() => window.__SBS_TEST_API.patterns.map((p) => ({ id: p.id, family: p.family })));

/** Attribute keys this block was seen carrying, anywhere. */
const seen = {};
const note = (node) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach(note);
  if (node.component) {
    seen[node.component] ||= {};
    for (const key of Object.keys(node.attributes || {})) seen[node.component][key] = true;
  }
  (node.children || []).forEach(note);
};

/* The header and footer are one tree each, not per-pattern. */
note(await page.evaluate(() => window.__SBS_TEST_API.buildNavigationExport().concept.global.navigation));
note(await page.evaluate(() => window.__SBS_TEST_API.buildFooterExport().concept.global.footer));

for (const pattern of catalog) {
  let exported;
  try {
    exported = await page.evaluate(({ id, family }) => {
      const api = window.__SBS_TEST_API;
      const project = api.state ? api.state.project : undefined;
      const target = project || undefined;
      const kept = target ? target.sections : null;
      const section = api.createSection(family, 0, id);
      if (target) { target.sections = [section]; api.ensureProject(target); }
      const out = api.buildPageExport(target);
      if (target) target.sections = kept;
      return out;
    }, pattern);
  } catch { continue }
  note(exported.concept.page.sections);
}
await browser.close();

const report = {};
let totalRegistered = 0, totalSeen = 0;
for (const [block, attrs] of [...registered].sort()) {
  const design = [...attrs].filter((a) => !NOT_DESIGN.has(a));
  if (!design.length) continue;
  const emitted = seen[block];
  if (!emitted) continue; // the export never uses this block at all
  const missing = design.filter((a) => !emitted[a]).sort();
  totalRegistered += design.length;
  totalSeen += design.length - missing.length;
  if (missing.length) report[block] = { registered: design.length, emitted: design.length - missing.length, never: missing };
}

const ranked = Object.entries(report).sort((a, b) => b[1].never.length - a[1].never.length);
console.log(`theme        ${THEME}`);
console.log(`blocks used  ${Object.keys(seen).length}`);
console.log(`coverage     ${totalSeen}/${totalRegistered} design attributes emitted at least once\n`);
for (const [block, data] of ranked) {
  console.log(`${block}  —  ${data.emitted}/${data.registered} emitted, ${data.never.length} never set`);
  console.log(`   ${data.never.join(', ')}\n`);
}
if (errors.length) console.log('page errors:\n  ' + errors.slice(0, 5).join('\n  '));
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ theme: THEME, totalRegistered, totalSeen, blocks: report }, null, 2));
