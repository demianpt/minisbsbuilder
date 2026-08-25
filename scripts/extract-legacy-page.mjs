/**
 * One-time migration utility for the original Page Builder v4 export.
 *
 * It deliberately copies the catalog and runtime byte-for-byte where possible.
 * Keeping this script makes the migration reproducible if a newer export arrives.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const input = resolve(root, 'legacy', 'page-builder-v4.html');
const source = await readFile(input, 'utf8');

function capture(pattern, label) {
  const match = source.match(pattern);
  if (!match) throw new Error(`Could not extract ${label}. The legacy export may have changed.`);
  return match[1];
}

const appCss = capture(/<style>\n([\s\S]*?)\n<\/style>/, 'application styles');
const appMarkup = capture(/<body>\n([\s\S]*?)\n<script type="application\/json" id="dst-data">/, 'application markup');
const catalog = capture(/<script type="application\/json" id="dst-data">([\s\S]*?)<\/script>\n<script type="text\/plain" id="dst-shared-css">/, 'DST catalog');
const sharedCss = capture(/<script type="text\/plain" id="dst-shared-css">\n([\s\S]*?)\n<\/script>\n<script>/, 'exported-site styles');
const coreRuntime = capture(/<script>\n([\s\S]*?)\n<\/script>\n\n<script id="sbs-builder-v2">/, 'builder runtime')
  .replace(/^const DATA=.*?;\nconst DST_SHARED_CSS=.*?;\n/, '');
const extensionRuntime = capture(/<script id="sbs-builder-v2">\n([\s\S]*?)\n<\/script>\n<\/body>/, 'builder extension runtime');

const files = {
  'src/styles/app.css': appCss,
  'src/styles/dst-shared.css': sharedCss,
  'src/data/dst-data.json': catalog,
  'src/runtime/builder.js': `/**\n * Builder domain runtime. The core and v2 extension share a lexical scope,\n * so they intentionally initialize together behind this single boundary.\n */\nexport function initializeBuilder(DATA, DST_SHARED_CSS) {\n${coreRuntime}\n\n${extensionRuntime}\n}\n`,
  'src/main.js': `import DST_SHARED_CSS from './styles/dst-shared.css?raw';\nimport './styles/app.css';\nimport { initializeBuilder } from './runtime/builder.js';\n\n/** Load the large, rarely changing pattern catalog on demand. */\nasync function bootstrap() {\n  const { default: catalog } = await import('./data/dst-data.json');\n  initializeBuilder(catalog, DST_SHARED_CSS);\n}\n\nbootstrap();\n`,
  'index.html': `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <meta name="description" content="A guided SBS page builder powered by the complete DST concept pattern library." />\n    <title>SBS Page Builder — DST Concept Studio</title>\n    <link rel="preconnect" href="https://fonts.googleapis.com" />\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n    <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&display=swap" rel="stylesheet" />\n  </head>\n  <body>\n${appMarkup}\n    <script type="module" src="/src/main.js"></script>\n  </body>\n</html>\n`,
};

await Promise.all(Object.entries(files).map(async ([path, contents]) => {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}));

console.log(`Migrated ${Object.keys(files).length} application files from the legacy export.`);
