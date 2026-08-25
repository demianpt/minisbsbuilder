#!/usr/bin/env node
/**
 * Re-records the WordPress hand-off fixtures from the live builder.
 *
 * `tests/fixtures/wordpress/*` is what `npm run test:wordpress` validates and
 * what `npm run test:bundle` zips. They were recordings, and recordings go
 * stale: they were still describing the export shape from before the media and
 * background fixes, so the PHP importer tests were passing against a page the
 * builder no longer produces. A fixture that does not match the product is worse
 * than no fixture, because it reports success.
 *
 * So they are generated: the real app is loaded in a real browser, the same
 * export functions the Export button calls are called, and the results are
 * written back. Run it after any change to the export.
 *
 *   npm run record:wordpress
 *
 * It needs the dev client on 127.0.0.1:5173 (`npm run dev`), or it starts one.
 */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURES = join(ROOT, 'tests/fixtures/wordpress');
const URL_BASE = process.env.SBS_URL || 'http://127.0.0.1:5173';

async function reachable() {
  try {
    const response = await fetch(URL_BASE, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch { return false; }
}

async function withServer(run) {
  if (await reachable()) return run();
  const child = spawn('npm', ['run', 'dev:client', '--', '--host', '127.0.0.1', '--port', '5173'],
    { cwd: ROOT, stdio: 'ignore', detached: true });
  try {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      if (await reachable()) return await run();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`the dev client never answered on ${URL_BASE}`);
  } finally {
    try { process.kill(-child.pid); } catch { /* already gone */ }
  }
}

const written = await withServer(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch { /* a blocked storage is the harness's problem */ }
  });
  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__SBS_TEST_API), null, { timeout: 30_000 });

  const artifacts = await page.evaluate(() => {
    const api = window.__SBS_TEST_API;
    return {
      page: api.buildPageExport(),
      navigation: api.buildNavigationExport(),
      footer: api.buildFooterExport(),
      complete: api.buildCompleteExport(),
      html: api.buildSiteDocument(),
    };
  });
  await browser.close();

  // `generatedAt` is a timestamp, and a fixture that changes on every recording
  // is a diff nobody can read. Pinned to the release the fixture belongs to.
  const pin = (value) => JSON.parse(JSON.stringify(value), (key, entry) => (key === 'generatedAt' ? '2026-01-01T00:00:00.000Z' : entry));

  const files = [
    ['page.json', `${JSON.stringify(pin(artifacts.page), null, 2)}\n`],
    ['navigation.json', `${JSON.stringify(pin(artifacts.navigation), null, 2)}\n`],
    ['footer.json', `${JSON.stringify(pin(artifacts.footer), null, 2)}\n`],
    ['complete-project.json', `${JSON.stringify(pin(artifacts.complete), null, 2)}\n`],
    ['website.html', artifacts.html],
  ];
  for (const [name, body] of files) await writeFile(join(FIXTURES, name), body);
  return files.map(([name, body]) => `${name} (${body.length} bytes)`);
});

console.log(written.join('\n'));
