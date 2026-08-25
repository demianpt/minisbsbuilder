#!/usr/bin/env node
import 'dotenv/config';
import { createConfig } from '../server/config.mjs';
import { createShutterstockProvider } from '../server/media/shutterstock-provider.mjs';
import { broadeningSearch } from '../shared/brief/media.mjs';

/**
 * Proves the Shutterstock credential works before the editor depends on it.
 *
 * Runs one image search and one video search and prints what came back. It
 * never licenses anything, so running it costs nothing from a subscription.
 *
 *   node scripts/check-shutterstock.mjs "golf course fairway sunrise"
 */

const query = process.argv.slice(2).join(' ').trim() || 'golf course fairway sunrise';

function line(label, value) {
  console.log(`${label.padEnd(22)} ${value}`);
}

const config = createConfig();
const stock = createShutterstockProvider({ config, logger: { warn() {} } });

line('Base URL', config.shutterstockBaseUrl);
line('Credential', config.shutterstockApiToken
  ? 'SHUTTERSTOCK_API_TOKEN (bearer)'
  : config.shutterstockClientId && config.shutterstockClientSecret
    ? 'SHUTTERSTOCK_CLIENT_ID + SECRET (basic)'
    : 'none');
line('Safe search', config.shutterstockSafeSearch ? 'on' : 'off');
line('Query', query);
console.log('');

if (!stock.configured) {
  console.error('No credential found. Set SHUTTERSTOCK_API_TOKEN, or SHUTTERSTOCK_CLIENT_ID and');
  console.error('SHUTTERSTOCK_CLIENT_SECRET, in .env — then run this again.');
  process.exit(1);
}

try {
  // Same widening the editor uses, so this reports what the button will really do.
  const [images, videos] = await Promise.all([
    broadeningSearch((phrase, count) => stock.searchImages({ query: phrase, count }), query, config.mediaImageCount),
    broadeningSearch((phrase, count) => stock.searchVideos({ query: phrase, count }), query, config.mediaVideoCount),
  ]);
  for (const [label, found] of [['image', images], ['video', videos]]) {
    console.log(`✓ ${found.results.length} ${label} preview${found.results.length === 1 ? '' : 's'}${
      found.broadened ? `  (widened to “${found.query}” — the full phrase found nothing)` : ''}`);
    for (const asset of found.results.slice(0, 3)) line(`  #${asset.assetId}`, `${asset.alt.slice(0, 58)} → ${asset.src}`);
  }
  console.log('');
  if (!images.results.length && !videos.results.length) {
    console.log('The credential works, but nothing matched even after widening the phrase.');
    console.log('Try a plainer subject — two or three words naming what is in the picture.');
  } else {
    console.log('Credential works. Start the server and the "Find imagery" button will be live.');
  }
  console.log('These are watermarked previews. Nothing was licensed and nothing was spent.');
} catch (error) {
  console.error(`✗ ${error.code || 'ERROR'}: ${error.message}`);
  if (error.details?.status === 401 || error.details?.status === 403) {
    console.error('');
    console.error('That is an authentication failure, not a network problem. Check that the token');
    console.error('was copied whole, and that the API application it belongs to is approved for');
    console.error('search. If you only have a client id and secret, leave SHUTTERSTOCK_API_TOKEN');
    console.error('empty so the basic-auth path is used instead.');
  }
  process.exit(1);
}
