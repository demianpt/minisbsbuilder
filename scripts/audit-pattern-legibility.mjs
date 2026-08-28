#!/usr/bin/env node
/**
 * Every pattern in the catalogue, measured for readable text.
 *
 * The legibility audit already exists and already runs — but only over the bands
 * that happen to be in the open project, which is three or four of a hundred and
 * fifty-six. A pattern with dark copy on a dark ground is therefore not caught
 * when it is written; it is caught when a strategist puts it on a page and
 * cannot read it. Recurring, as reported.
 *
 * This renders each pattern on its own and runs the same check over it, so the
 * failures are known before anyone meets them.
 *
 *   npm run dev
 *   node scripts/audit-pattern-legibility.mjs [--json <out>]
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const ORIGIN = flag('origin', 'http://127.0.0.1:5173/');
const JSON_OUT = flag('json', '');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() => { try { localStorage.clear() } catch (e) {} });
try {
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API), null, { timeout: 30000 });
} catch {
  console.error(`Could not reach the builder at ${ORIGIN}. Start it with "npm run dev".`);
  await browser.close();
  process.exit(1);
}

/* One reusable frame, so 156 renders do not build 156 documents' worth of DOM. */
await page.evaluate(() => {
  const frame = document.createElement('iframe');
  frame.id = 'sbs-audit-frame';
  Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '1440px', height: '1000px', border: '0' });
  document.body.appendChild(frame);
});

const catalog = await page.evaluate(() => window.__SBS_TEST_API.patterns.map((p) => ({ id: p.id, family: p.family })));
const rows = [];

for (const pattern of catalog) {
  const row = await page.evaluate(async ({ id, family }) => {
    const api = window.__SBS_TEST_API;
    const project = api.state ? api.state.project : undefined;
    const kept = project ? project.sections : null;
    try {
      const section = api.createSection(family, 0, id);
      if (project) { project.sections = [section]; api.ensureProject(project); }
      const html = api.buildSiteDocument(project);
      const frame = document.getElementById('sbs-audit-frame');
      await new Promise((resolve) => {
        frame.onload = () => resolve();
        frame.srcdoc = html;
        setTimeout(resolve, 1500);
      });
      await new Promise((r) => setTimeout(r, 60));
      const doc = frame.contentDocument;
      const audit = api.auditDocument(doc);
      /* How many bands the check declined to measure, and why: a band whose
         ground is a photograph has no honest contrast number, but it is also
         where an unreadable headline hides. */
      const bands = doc.querySelectorAll('#sbs-site > section');
      let overImage = 0;
      bands.forEach((b) => { if (b.querySelector('.c-bg img,.c-bg video,.c-bg picture')) overImage += 1; });
      return {
        id, family,
        bands: bands.length,
        checked: audit.legibility.checked,
        overImage,
        failures: audit.legibility.failures.map((f) => ({ ratio: f.ratio, target: f.target, sample: f.sample })),
      };
    } catch (error) {
      return { id, family, error: String(error).slice(0, 160) };
    } finally {
      if (project) project.sections = kept;
    }
  }, pattern);
  rows.push(row);
}
await browser.close();

const failed = rows.filter((r) => r.failures?.length);
const errored = rows.filter((r) => r.error);
const unmeasured = rows.filter((r) => !r.error && !r.checked && r.bands);

console.log(`patterns          ${rows.length}`);
console.log(`with failures     ${failed.length}`);
console.log(`nothing measured  ${unmeasured.length}  (every band's ground is a picture)`);
console.log(`errored           ${errored.length}\n`);

if (failed.length) {
  console.log('UNREADABLE TEXT\n');
  for (const r of failed.sort((a, b) => a.failures[0].ratio - b.failures[0].ratio)) {
    for (const f of r.failures) {
      console.log(`  ${f.ratio.toFixed(2)}:1  (needs ${f.target}:1)  ${r.id}  [${r.family}]`);
      console.log(`         "${f.sample}"`);
    }
  }
}
if (errored.length) {
  console.log('\nERRORED\n');
  errored.forEach((r) => console.log(`  ${r.id}: ${r.error}`));
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ rows, failed, unmeasured, errored }, null, 2));
process.exitCode = failed.length ? 1 : 0;
