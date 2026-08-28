#!/usr/bin/env node
/**
 * The sixty patterns the contrast check cannot speak for.
 *
 * `audit-pattern-legibility.mjs` measures a text colour against the colour
 * painted behind it, and declines — correctly — when that ground is a
 * photograph: there is no single colour to compare against, and a number
 * invented from the band's fallback would be fiction. But "declined to measure"
 * covers 60 of the 156 patterns, and a dark headline over a dark photograph is
 * precisely the failure being reported.
 *
 * So this measures the ground as rendered. The page is captured twice — once as
 * it stands, once with every text run made invisible — and the second capture is
 * the actual backdrop, photograph and overlay and all. Each text run is then
 * compared against the darkest and lightest pixels it actually sits on, and the
 * worse of the two is the number that counts: type has to survive the whole
 * region it covers, not the average of it.
 *
 * Remote imagery taints a canvas, so the sampling cannot happen in the page that
 * loaded the photographs. The capture is taken by the driver and handed to a
 * clean page to decode, which is allowed to read it.
 *
 *   npm run dev
 *   node scripts/audit-pattern-legibility-pixels.mjs [--json <out>] [--only <id>]
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
const ONLY = flag('only', '');
const WIDTH = 1440, HEIGHT = 1400;

const TEXT_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,.c-heading__pre,.c-heading__sub,.c-block__title,.c-block__description,.dst-list__title,.dst-list__description,.c-btn,figcaption';

const srgb = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 };
const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) };

const browser = await chromium.launch();
const app = await browser.newPage({ viewport: { width: 400, height: 400 } });
await app.addInitScript(() => { try { localStorage.clear() } catch (e) {} });
try {
  await app.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
  await app.waitForFunction(() => Boolean(window.__SBS_TEST_API), null, { timeout: 30000 });
} catch {
  console.error(`Could not reach the builder at ${ORIGIN}. Start it with "npm run dev".`);
  await browser.close();
  process.exit(1);
}

let catalog = await app.evaluate(() => window.__SBS_TEST_API.patterns.map((p) => ({ id: p.id, family: p.family })));
if (ONLY) catalog = catalog.filter((p) => p.id === ONLY);

/* The stage the pattern is rendered on, and the clean room the capture is read in. */
const stage = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
const reader = await browser.newPage();
await reader.goto('about:blank');

const rows = [];
for (const pattern of catalog) {
  const html = await app.evaluate(({ id, family }) => {
    const api = window.__SBS_TEST_API, project = api.state.project, kept = project.sections;
    try {
      project.sections = [api.createSection(family, 0, id)];
      api.ensureProject(project);
      return api.buildSiteDocument(project);
    } finally { project.sections = kept }
  }, pattern);

  await stage.setContent(html, { waitUntil: 'load' });
  await stage.waitForTimeout(500);
  try { await stage.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { timeout: 8000 }) } catch {}

  /* Every text run worth measuring, with the colour it is painted in. */
  const runs = await stage.evaluate((sel) => {
    const out = [];
    document.querySelectorAll('#sbs-site ' + sel).forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.5) return;
      const m = cs.color.match(/[\d.]+/g);
      if (!m) return;
      const alpha = m[3] === undefined ? 1 : Number(m[3]);
      if (alpha < 0.5) return;
      const big = Number.parseFloat(cs.fontSize) >= 24 ||
        (Number.parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700);
      /*
       * The line boxes, not the element box.
       *
       * A block heading's rect is as wide as its container whether the words
       * reach the edge or not, so sampling it measures ground the type never
       * covers — and a bright corner of a photograph two hundred pixels past the
       * last letter would be reported as a contrast failure. A Range over the
       * element's own text returns the boxes the glyphs actually occupy.
       */
      for (const node of el.childNodes) {
        if (node.nodeType !== 3 || !String(node.textContent).trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const b of range.getClientRects()) {
          if (b.width < 8 || b.height < 8) continue;
          if (b.bottom < 0 || b.top > window.innerHeight) continue;
          out.push({
            rgb: [Number(m[0]), Number(m[1]), Number(m[2])],
            big,
            rect: { x: Math.max(0, b.x), y: Math.max(0, b.y), w: b.width, h: b.height },
            text: String(node.textContent).replace(/\s+/g, ' ').trim().slice(0, 48),
          });
        }
        range.detach?.();
      }
    });
    return out;
  }, TEXT_SELECTOR);

  if (!runs.length) { rows.push({ ...pattern, runs: 0, failures: [] }); continue }

  /* The backdrop: the same page with the glyphs made transparent, so every
     surface — including a button's own fill — is still painted. */
  /* Transparent glyphs, not hidden boxes: `visibility:hidden` would take the
     element's own background with it, and a button's fill is exactly the ground
     its label has to clear. */
  /*
   * Blank the glyphs from the element itself, with `!important`, on every node.
   *
   * A stylesheet cannot win this: the tone rules are already `!important` at
   * `#sbs-site .is-style-colors-inverted .c-heading__title`, which outranks any
   * selector general enough to mean "all text". An injected sheet therefore left
   * the headlines painted, and the capture reported a cream headline as the
   * ground a cream headline sits on — 1.02:1, on a hero that reads perfectly.
   * An inline declaration outranks every sheet, `!important` or not.
   */
  await stage.evaluate(() => {
    document.querySelectorAll('#sbs-site, #sbs-site *').forEach((el) => {
      // Transitions first, and this is the whole trick: the theme animates
      // `color`, so setting it merely starts a fade. Read or captured before the
      // fade lands, the type is still fully painted — which is how a hero that
      // reads perfectly was measured at 1.02:1 against its own headline.
      el.style.setProperty('transition', 'none', 'important');
      el.style.setProperty('animation', 'none', 'important');
      el.style.setProperty('color', 'transparent', 'important');
      el.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
      el.style.setProperty('text-shadow', 'none', 'important');
    });
    // Force a reflow so the new values are the ones the capture sees.
    void document.body.offsetHeight;
  });
  await stage.waitForTimeout(200);
  const shot = (await stage.screenshot({ type: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } })).toString('base64');

  const failures = await reader.evaluate(async ({ shot, runs, WIDTH, HEIGHT }) => {
    const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + shot)).blob());
    const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const out = [];
    for (const run of runs) {
      // A line box includes the leading above and below the glyphs; trimming it
      // vertically keeps the sample on the ground the letters actually cross.
      const inx = 1, iny = Math.max(1, Math.round(run.rect.h * 0.18));
      const x = Math.round(run.rect.x) + inx, y = Math.round(run.rect.y) + iny;
      const w = Math.min(Math.round(run.rect.w) - inx * 2, WIDTH - x), h = Math.min(Math.round(run.rect.h) - iny * 2, HEIGHT - y);
      if (w < 2 || h < 2) continue;
      const data = ctx.getImageData(x, y, w, h).data;
      const srgb = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 };
      const lum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
      const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 2000)));
      const px = [];
      for (let py = 0; py < h; py += step) for (let pxi = 0; pxi < w; pxi += step) {
        const i = (py * w + pxi) * 4;
        px.push({ L: lum(data[i], data[i + 1], data[i + 2]), c: [data[i], data[i + 1], data[i + 2]] });
      }
      if (px.length < 4) continue;
      // Percentiles rather than the single darkest and lightest pixel: one stray
      // antialiased edge should not decide whether a headline is readable, but a
      // genuinely two-tone ground still has to clear at both ends.
      px.sort((a, b) => a.L - b.L);
      const dark = px[Math.floor(px.length * 0.10)].c;
      const light = px[Math.floor(px.length * 0.90)].c;
      out.push({ run, dark, light });
    }
    return out;
  }, { shot, runs, WIDTH, HEIGHT });

  const bad = [];
  for (const { run, dark, light } of failures) {
    if (!dark || !light) continue;
    const target = run.big ? 3 : 4.5;
    const worst = Math.min(ratio(run.rgb, dark), ratio(run.rgb, light));
    if (worst < target) bad.push({ ratio: Math.round(worst * 100) / 100, target, text: run.text, color: run.rgb, dark, light });
  }
  rows.push({ ...pattern, runs: runs.length, failures: bad });
}
await browser.close();

const failed = rows.filter((r) => r.failures.length);
console.log(`patterns       ${rows.length}`);
console.log(`text runs      ${rows.reduce((n, r) => n + r.runs, 0)}`);
console.log(`with failures  ${failed.length}\n`);
if (failed.length) {
  console.log('TEXT THAT DOES NOT CLEAR ITS GROUND\n');
  for (const r of failed.sort((a, b) => a.failures[0].ratio - b.failures[0].ratio)) {
    console.log(`  ${r.id}  [${r.family}]`);
    for (const f of r.failures.slice(0, 4)) {
      console.log(`     ${f.ratio.toFixed(2)}:1 (needs ${f.target}) text=rgb(${f.color}) on ground rgb(${f.dark})…rgb(${f.light})`);
      console.log(`       "${f.text}"`);
    }
  }
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2));
process.exitCode = failed.length ? 1 : 0;
