#!/usr/bin/env node
/**
 * Packages the WordPress importer from source into `deliverables/`.
 *
 * The plugin used to exist only as a zip, which meant every change to it was a
 * change nobody could review and nobody could repeat. The source is now in
 * `wordpress-plugin/` and this builds the artifact from it.
 *
 *   npm run build:plugin
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync, crc32 } from 'node:zlib';

const ROOT = new URL('..', import.meta.url).pathname;
const SOURCE = join(ROOT, 'wordpress-plugin/sbs-website-importer');
const OUT_DIR = join(ROOT, 'deliverables');
const OUT = join(OUT_DIR, 'sbs-website-importer.zip');

/* Nothing generated, nothing hidden, and no secrets: §112. */
const SKIP = new Set(['.DS_Store', 'node_modules', '.git', '.env']);

async function walk(dir, base = dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.env')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, base, out);
    else out.push(path);
  }
  return out;
}

const u16 = (value) => Buffer.from([value & 0xff, (value >> 8) & 0xff]);
const u32 = (value) => Buffer.from([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]);

const files = (await walk(SOURCE)).sort();
if (!files.length) {
  console.error(`No plugin source at ${SOURCE}`);
  process.exit(1);
}

const locals = [];
const central = [];
let offset = 0;

for (const path of files) {
  // Forward slashes and the plugin folder as the archive root, which is what
  // WordPress expects to unpack into `wp-content/plugins/`.
  const name = `sbs-website-importer/${relative(SOURCE, path).split(sep).join('/')}`;
  const body = await readFile(path);
  const deflated = deflateRawSync(body, { level: 9 });
  const sum = crc32(body) >>> 0;
  const nameBytes = Buffer.from(name, 'utf8');
  const header = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(sum), u32(deflated.length), u32(body.length),
    u16(nameBytes.length), u16(0), nameBytes,
  ]);
  locals.push(header, deflated);
  central.push(Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(sum), u32(deflated.length), u32(body.length),
    u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes,
  ]));
  offset += header.length + deflated.length;
}

const centralBody = Buffer.concat(central);
const archive = Buffer.concat([
  ...locals,
  centralBody,
  Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralBody.length), u32(offset), u16(0)]),
]);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT, archive);
const digest = createHash('sha256').update(archive).digest('hex');
await writeFile(`${OUT}.sha256`, `${digest}  sbs-website-importer.zip\n`);

const version = (await readFile(join(SOURCE, 'sbs-website-importer.php'), 'utf8')).match(/Version:\s*([0-9.]+)/)?.[1] || '';
console.log(JSON.stringify({ output: OUT, version, files: files.length, bytes: archive.length, sha256: digest }, null, 2));
