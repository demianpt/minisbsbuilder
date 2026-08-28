#!/usr/bin/env node
/**
 * Does an imported page look like the preview that was approved?
 *
 * Every other check in this repo asks a structural question — is this block
 * registered, is this attribute known, does the bundle convert. All of them
 * passed while the live page rendered every heading at 77% of its size, put
 * two sections in an 850px column and dropped a slider. They were right about
 * what they measured; nobody was measuring the thing the client actually looks
 * at.
 *
 * So this renders a project in the builder, exports it, imports it into a real
 * WordPress install through the real plugin, renders that, and compares the
 * computed styles of the same text on both sides.
 *
 *   npm run dev                       # in another terminal
 *   node scripts/qa-parity.mjs [--patterns a,b,c] [--all] [--json out.json]
 *
 * The WordPress side is left as it was found: the design tokens are saved and
 * restored, and the page it creates is deleted.
 */
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const SITE = flag('site', join(homedir(), 'sites/minisbssandbox'));
const ORIGIN = flag('origin', 'http://127.0.0.1:5173/');
const BASE = flag('base', 'https://minisbssandbox.test');
const JSON_OUT = flag('json', '');
const WIDTH = Number(flag('width', 1440));

const wp = (code) => {
  const file = join(SITE, 'qa-parity-tmp.php');
  writeFileSync(file, `<?php\n${code}\n`);
  try {
    return execFileSync('wp', ['eval-file', 'qa-parity-tmp.php'], { cwd: SITE, encoding: 'utf8' })
      .split('\n').filter((l) => !/^(Deprecated|Warning|$)/.test(l.trim())).join('\n').trim();
  } finally { if (existsSync(file)) unlinkSync(file) }
};

/* What a reader can see. Colour and geometry come along because a size that is
   right in a band that is the wrong width is still the wrong page. */
const PROBE = (rootSelector) => {
  const root = document.querySelector(rootSelector) || document.body;
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  // The header and the footer are template parts, imported separately; a page
  // import is not expected to produce them, and counting them as missing text
  // would bury the differences that matter.
  const CHROME = '.site-header, .sbs-footer, .site-footer, header, footer';
  const rows = [];
  for (const el of root.querySelectorAll('*')) {
    if (el.closest(CHROME)) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ');
    const text = norm(own);
    if (text.length < 4) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const cs = getComputedStyle(el);
    const before = getComputedStyle(el, '::before');
    rows.push({
      key: text.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32),
      text: text.slice(0, 48),
      fontSize: cs.fontSize,
      fontFamily: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      fontWeight: cs.fontWeight,
      letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform,
      // `start` and `left` are the same instruction in a left-to-right page;
      // reporting them as a difference would be noise, and noise is what let
      // the real ones hide.
      textAlign: { start: 'left', end: 'right' }[cs.textAlign] || cs.textAlign,
      color: cs.color,
      lineHeight: (() => {
        const lh = parseFloat(cs.lineHeight), fs = parseFloat(cs.fontSize);
        return lh && fs ? (lh / fs).toFixed(2) : cs.lineHeight;
      })(),
      width: Math.round(box.width),
      left: Math.round(box.left),
      rule: before.content === 'none' ? 'none' : `${before.width}x${before.height}`,
    });
  }
  const bands = [...root.children].map((el) => {
    const box = el.getBoundingClientRect();
    return { cls: el.className.toString().slice(0, 70), left: Math.round(box.left), width: Math.round(box.width) };
  });
  /*
   * Pictures, counted.
   *
   * The comparison above only ever looked at text, and said a page was a
   * near-perfect match while five photographs were missing from it — the
   * `c-media` block rendered a correctly classed, correctly sized, completely
   * empty `<figure>`. A check that cannot see an absent image will keep
   * approving pages that have lost them.
   */
  const pictures = [...root.querySelectorAll('img, video')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 })
    .map((el) => (el.getAttribute('alt') || el.currentSrc || el.src || '').split('/').pop().slice(0, 60));
  const emptyFigures = [...root.querySelectorAll('figure')]
    .filter((el) => !el.querySelector('img, video, svg, picture source'))
    .map((el) => el.className.toString().slice(0, 70));
  return { rows, bands, pictures, emptyFigures };
};

const browser = await chromium.launch();

/* ---- 1. the preview, and the bundle it exports ---- */
const builder = await browser.newPage({ viewport: { width: WIDTH, height: 1000 } });
await builder.addInitScript(() => { try { localStorage.clear() } catch (e) {} });
try {
  await builder.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
  await builder.waitForFunction(() => Boolean(window.__SBS_TEST_API), null, { timeout: 30000 });
} catch {
  console.error(`Could not reach the builder at ${ORIGIN}. Start it with "npm run dev".`);
  await browser.close(); process.exit(1);
}

const wanted = flag('patterns', '');
const plan = await builder.evaluate((wantedCsv) => {
  const api = window.__SBS_TEST_API, project = api.state.project;
  const byId = new Map(api.patterns.map((p) => [p.id, p]));
  const ids = wantedCsv ? wantedCsv.split(',').map((s) => s.trim()).filter((id) => byId.has(id)) : null;
  const picked = ids && ids.length ? ids.map((id) => byId.get(id))
    : [...new Map(api.patterns.map((p) => [p.family, p])).values()];
  project.sections = picked.map((p, i) => api.createSection(p.family, i, p.id));
  api.ensureProject(project);
  return picked.map((p) => p.id);
}, wanted);

await builder.waitForTimeout(1200);
/* The export button measures the preview before it writes the file. Skipping
   that here would check an artifact no client ever receives. */
const measured = await builder.evaluate(() => window.__SBS_TEST_API.refreshTypography());
const bundle = await builder.evaluate(() => window.__SBS_TEST_API.buildCompleteExport(window.__SBS_TEST_API.state.project));
if (!measured) console.warn('note: the preview could not be measured; typography was exported as written');
/*
 * The preview is an iframe fed by `srcdoc`, sized to whatever pane the builder
 * gives it. Measuring inside it would compare a 900px column against a 1440px
 * page. `buildSiteDocument` is the same document — it is literally what the
 * "open preview" button saves — so it is rendered here at the width the client
 * will look at.
 */
const document_html = await builder.evaluate(() => window.__SBS_TEST_API.buildSiteDocument(window.__SBS_TEST_API.state.project));
await builder.close();
const previewPath = join(process.cwd(), 'qa-parity-preview.html');
writeFileSync(previewPath, document_html);
const previewPage = await browser.newPage({ viewport: { width: WIDTH, height: 1000 } });
await previewPage.goto(`file://${previewPath}`, { waitUntil: 'networkidle', timeout: 90000 });
await previewPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await previewPage.waitForTimeout(1500);
await previewPage.evaluate(() => window.scrollTo(0, 0));
await previewPage.waitForTimeout(600);
const preview = await previewPage.evaluate(PROBE, '#sbs-site');
await previewPage.close();

/* ---- 2. through the plugin, into WordPress ---- */
const bundlePath = join(SITE, 'qa-parity-bundle.json');
writeFileSync(bundlePath, JSON.stringify(bundle));
const saved = wp(`echo json_encode(array('data'=>get_option('sbs_imported_theme_data',array()),'css'=>get_option('sbs_imported_theme_css','')));`);
/*
 * Put WordPress back, whatever happens next.
 *
 * This check imports into a real site: it overwrites the stored design tokens
 * and creates a page. An early `process.exit` on a failed import used to skip
 * the restore, and the site was left wearing the sample project's typography
 * with nothing to say so. Registering the undo the moment the backup is taken
 * means every exit path goes through it.
 */
let restored = false;
const restore = (pageId) => {
  if (restored) return;
  restored = true;
  try {
    wp(`
$s = json_decode(file_get_contents(ABSPATH . 'qa-parity-saved.json'), true);
update_option('sbs_imported_theme_data', $s['data'], false);
update_option('sbs_imported_theme_css', $s['css'], false);
${pageId ? `wp_delete_post(${pageId}, true);` : ''}
echo 'restored';
`);
  } catch (error) { console.error('could not restore the site:', error.message) }
  for (const path of [bundlePath, join(SITE, 'qa-parity-saved.json')]) {
    if (existsSync(path)) { try { unlinkSync(path) } catch (e) {} }
  }
};
writeFileSync(join(SITE, 'qa-parity-saved.json'), saved);
process.on('exit', () => restore(null));
const created = wp(`
$b = json_decode(file_get_contents(ABSPATH . 'qa-parity-bundle.json'), true);
$warn = array();
$split = SBS_Importer_Package::split_artifacts($b, $warn);
if (is_wp_error($split)) { echo json_encode(array('error'=>$split->get_error_message())); return; }
/*
 * Media is sideloaded before conversion, exactly as the admin screen does it.
 * Skipping it made this check pass on pages whose every photograph was missing:
 * the media component will not draw a picture without the attachment sizes, and
 * those do not exist until the file has been brought into WordPress.
 */
require_once WP_PLUGIN_DIR . '/sbs-website-importer/includes/class-sbs-importer-media.php';
$media = new SBS_Importer_Media();
$warn = array_merge($warn, $media->sideload_artifacts($split));
$conv = new SBS_Importer_Block_Converter();
$out = $conv->page_to_content($split['page']);
if (!is_array($out)) { echo json_encode(array('error'=>'conversion failed')); return; }
/* wp_insert_post unslashes what it is given, and a block comment is JSON:
   without this every \\u0026 in an attribute loses its backslash and the page
   renders "FEDERAL u0026 DEFENSE". The plugin already does this; the harness
   has to as well, or it reports its own bug as the product's. */
$id = wp_insert_post(array('post_type'=>'page','post_title'=>'QA parity','post_status'=>'publish','post_content'=>wp_slash($out['content'])));
$theme = SBS_Importer_Services::artifact_theme(array('page'=>$split['page']));
if ($theme) SBS_Importer_Theme::save($theme);
echo json_encode(array('id'=>$id,'blocks'=>$out['blocks'],'warnings'=>array_merge($warn, $out['warnings'])));
`);
let made;
try { made = JSON.parse(created) } catch { made = { error: created.slice(0, 400) } }
if (made.error) { console.error('WordPress import failed:', made.error); restore(null); await browser.close(); process.exit(1) }

const site = await browser.newPage({ viewport: { width: WIDTH, height: 1000 }, ignoreHTTPSErrors: true });
await site.goto(`${BASE}/?page_id=${made.id}`, { waitUntil: 'networkidle', timeout: 90000 });
await site.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await site.waitForTimeout(1500);
await site.evaluate(() => window.scrollTo(0, 0));
await site.waitForTimeout(600);
const imported = await site.evaluate(PROBE, 'main.site-content');
await site.close();
await browser.close();

/* ---- 3. put WordPress back ---- */
restore(made.id);
if (!JSON_OUT && existsSync(previewPath)) unlinkSync(previewPath);

/* ---- 4. the comparison ---- */
const FIELDS = ['fontSize', 'fontFamily', 'fontWeight', 'letterSpacing', 'textTransform', 'textAlign', 'lineHeight', 'rule'];
const index = (rows) => { const m = new Map(); for (const r of rows) if (!m.has(r.key)) m.set(r.key, r); return m };
const a = index(preview.rows), b = index(imported.rows);
const matched = [...a.keys()].filter((k) => b.has(k));
const findings = [];
for (const k of matched) {
  const differs = FIELDS.filter((f) => a.get(k)[f] !== b.get(k)[f]);
  if (differs.length) findings.push({ text: a.get(k).text, differs, preview: a.get(k), imported: b.get(k) });
}
/* Only bands this import produced. The share widget a third-party plugin
   appends to every page is narrow because it chose to be. */
const OURS = /\b(dst-|ds-|wp-block-ds-blocks-)/;
const clamped = imported.bands.filter((band) => OURS.test(band.cls) && band.width > 0 && band.width < WIDTH * 0.75);
const missing = [...a.keys()].filter((k) => !b.has(k)).map((k) => a.get(k).text);

const byField = {};
for (const f of FIELDS) byField[f] = findings.filter((x) => x.differs.includes(f)).length;

/* An image is identified by its alt text, which survives the sideload; the file
   name does not, because WordPress renames and resizes what it stores. */
const pictureKey = (name) => name.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 28);
const previewPictures = preview.pictures.map(pictureKey).filter(Boolean);
const importedPictures = new Set(imported.pictures.map(pictureKey).filter(Boolean));
const lostPictures = previewPictures.filter((k) => !importedPictures.has(k));

const report = {
  patterns: plan, blocks: made.blocks, importWarnings: made.warnings,
  previewPictures: preview.pictures.length,
  importedPictures: imported.pictures.length,
  picturesNotFound: lostPictures.length,
  emptyFigures: imported.emptyFigures,
  previewText: a.size, importedText: b.size, matched: matched.length,
  identical: matched.length - findings.length,
  differingByProperty: byField,
  narrowBands: clamped,
  textNotFoundInWordPress: missing,
  findings,
  // Both sides in full, so a mismatch that turns out to be the harness's own
  // fault can be seen for what it is without another instrumented run.
  previewRows: preview.rows,
  importedRows: imported.rows,
  previewBands: preview.bands,
  importedBands: imported.bands,
};
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));

console.log(`patterns        ${plan.length}  (${plan.join(', ').slice(0, 110)}${plan.join(', ').length > 110 ? '…' : ''})`);
console.log(`blocks imported ${made.blocks}   import warnings ${made.warnings.length}`);
console.log(`text matched    ${matched.length} of ${a.size} in the preview`);
console.log(`pictures        ${imported.pictures.length} of ${preview.pictures.length} in the preview${imported.emptyFigures.length ? `   (${imported.emptyFigures.length} empty figures)` : ''}`);
console.log(`identical       ${report.identical}/${matched.length}`);
console.log(`\ndifferences by property`);
for (const [f, n] of Object.entries(byField)) if (n) console.log(`  ${f.padEnd(15)} ${n}`);
if (clamped.length) {
  console.log(`\nBANDS NARROWER THAN THE PAGE (${clamped.length})`);
  clamped.forEach((c) => console.log(`  ${String(c.width).padStart(5)}px at x${c.left}  ${c.cls}`));
}
if (missing.length) {
  console.log(`\nTEXT IN THE PREVIEW THAT WORDPRESS DID NOT RENDER (${missing.length})`);
  missing.slice(0, 12).forEach((t) => console.log(`  ${t}`));
  if (missing.length > 12) console.log(`  …and ${missing.length - 12} more`);
}
if (findings.length) {
  console.log(`\nDIFFERENCES (${findings.length})`);
  for (const f of findings.slice(0, 40)) {
    const shown = f.differs.map((d) => `${d}: ${f.preview[d]} -> ${f.imported[d]}`).join('   ');
    console.log(`  ${f.text.slice(0, 34).padEnd(36)} ${shown}`);
  }
  if (findings.length > 40) console.log(`  …and ${findings.length - 40} more`);
}
if (lostPictures.length || imported.emptyFigures.length) {
  console.log(`\nPICTURES THE PREVIEW SHOWS AND WORDPRESS DOES NOT (${lostPictures.length})`);
  imported.emptyFigures.forEach((cls) => console.log(`  empty figure: ${cls}`));
}
const clean = findings.length === 0 && clamped.length === 0 && missing.length === 0
  && lostPictures.length === 0 && imported.emptyFigures.length === 0;
console.log(`\n${clean ? 'the imported page matches the preview' : `${findings.length + clamped.length + missing.length} differences between the preview and the imported page`}`);
process.exit(clean ? 0 : 1);
