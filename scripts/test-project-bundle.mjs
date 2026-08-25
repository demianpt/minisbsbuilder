import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProjectBundle } from '../src/utils/project-bundle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => path.join(root, 'tests', 'fixtures', 'wordpress', name);
/*
 * `--deliver` writes the shipped sample as well as the test artifact.
 *
 * `deliverables/sample-complete-project.zip` had gone stale: it was built before
 * the export fixes and still carried the old media shape and no attachment id
 * keys. Anyone handed it as a sample would import the failures those fixes
 * removed and conclude the plugin was broken. It is produced by this code path so
 * it cannot drift from what the tests check again.
 */
const deliver = process.argv.includes('--deliver');
const outputDir = path.join(root, 'test-results');
await fs.mkdir(outputDir, { recursive: true });
const [navigation, footer, page, websiteHtml] = await Promise.all([
  fs.readFile(fixture('navigation.json'), 'utf8').then(JSON.parse),
  fs.readFile(fixture('footer.json'), 'utf8').then(JSON.parse),
  fs.readFile(fixture('page.json'), 'utf8').then(JSON.parse),
  fs.readFile(fixture('website.html'), 'utf8'),
]);
const blob = await createProjectBundle({ navigation, footer, page, websiteHtml });
const output = path.join(outputDir, 'sbs-complete-project.zip');
const bytes = Buffer.from(await blob.arrayBuffer());
await fs.writeFile(output, bytes);
if (deliver) {
  const { createHash } = await import('node:crypto');
  const deliverables = path.join(root, 'deliverables');
  await fs.mkdir(deliverables, { recursive: true });
  const sample = path.join(deliverables, 'sample-complete-project.zip');
  await fs.writeFile(sample, bytes);
  await fs.writeFile(`${sample}.sha256`, `${createHash('sha256').update(bytes).digest('hex')}  sample-complete-project.zip\n`);
}
const report = {
  passed: blob.type === 'application/zip' && blob.size > 1000,
  output,
  bytes: blob.size,
  expectedEntries: ['navigation.json', 'footer.json', 'page.json', 'website.html'],
  delivered: deliver ? 'deliverables/sample-complete-project.zip' : null,
};
await fs.writeFile(path.join(outputDir, 'project-bundle-test.json'), JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
console.log(JSON.stringify(report, null, 2));
