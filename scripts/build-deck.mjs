#!/usr/bin/env node
/**
 * Prints the technical deck to a landscape PDF.
 *
 * The deck is an HTML page whose slide box *is* its printed page — `@page { size:
 * 1280px 720px }` — so the PDF is the deck at 16:9 rather than a document
 * reflowed onto A4 with the slides broken across page boundaries.
 * `preferCSSPageSize` is what makes the browser honour that.
 *
 *   npm run build:deck
 */
import { chromium } from 'playwright';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const SOURCE = join(ROOT, 'docs/sbs-simple-builder-deck.html');
const OUT = join(ROOT, 'docs/SBS-Simple-Builder.pdf');

const html = await readFile(SOURCE, 'utf8');
const slides = (html.match(/<section class="slide/g) || []).length;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // A `file://` load rather than a data URL, so the Google Fonts link resolves
  // and the deck prints in the faces it was designed in rather than a fallback.
  await page.goto(pathToFileURL(SOURCE).href, { waitUntil: 'load' });
  // Fonts are the one asynchronous thing on the page, and a PDF printed before
  // they arrive is set in the fallback stack — same layout, wrong voice.
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await writeFile(OUT, pdf);
} finally {
  await browser.close();
}

const { size } = await stat(OUT);
console.log(JSON.stringify({ source: 'docs/sbs-simple-builder-deck.html', output: 'docs/SBS-Simple-Builder.pdf', slides, bytes: size }, null, 2));
