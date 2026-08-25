#!/usr/bin/env node
/**
 * Deployment preflight. Reads the environment the server would read, reports
 * what is configured and what is missing, and exits non-zero on anything that
 * would make the deployment wrong rather than merely degraded.
 *
 *   npm run check:env            validate configuration only
 *   npm run check:health         also probe a running server
 *
 * It prints no secret values — only whether each one is present.
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createConfig } from '../server/config.mjs';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const probe = process.argv.includes('--probe');
const errors = [];
const warnings = [];
const notes = [];

let config;
try {
  config = createConfig(process.env);
} catch (error) {
  console.error(`FAIL  configuration is invalid: ${error.message}`);
  process.exit(1);
}

const environment = process.env.NODE_ENV || 'development';
const isProduction = environment === 'production';

notes.push(`environment            ${environment}`);
notes.push(`bind                   ${config.host}:${config.port}`);
notes.push(`trust proxy            ${JSON.stringify(config.trustProxy)}`);
notes.push(`public app origin      ${config.publicAppOrigin || '(unset)'}`);
notes.push(`ollama model           ${config.ollamaModel}`);
notes.push(`ollama api key         ${config.ollamaApiKey ? 'present' : 'absent'}`);
notes.push(`shutterstock creds     ${config.shutterstockApiToken || (config.shutterstockClientId && config.shutterstockClientSecret) ? 'present' : 'absent'}`);
notes.push(`rate limit             ${config.maxJobsPerWindow} requests / ${Math.round(config.rateWindowMs / 1000)}s per client`);

// The client bundle. `npm start` serves it; without it the server answers the
// API and nothing else, which looks like a broken site rather than a bad deploy.
if (!existsSync(resolve(projectRoot, 'dist/index.html'))) {
  const message = 'dist/index.html is missing — run `npm run build` before starting the server.';
  if (isProduction) errors.push(message);
  else warnings.push(message);
}

// A container or VM that binds loopback is unreachable from its own proxy.
if (isProduction && (config.host === '127.0.0.1' || config.host === 'localhost')) {
  errors.push('HOST is loopback. Set HOST=0.0.0.0 so the reverse proxy or container network can reach the server.');
}

// PUBLIC_APP_ORIGIN is an allowlist, not a label: enforceOrigin() in
// server/routes/brief.mjs rejects any POST whose Origin header does not match it
// exactly, and browsers send Origin on same-origin POSTs too. A wrong value
// means every Brief Brain job returns 403 while the page itself loads fine.
if (isProduction) {
  if (!config.publicAppOrigin) {
    warnings.push('PUBLIC_APP_ORIGIN is unset, so browser origin checks are disabled. Set it to the exact public URL, scheme included.');
  } else {
    try {
      const origin = new URL(config.publicAppOrigin);
      if (origin.protocol !== 'https:') warnings.push(`PUBLIC_APP_ORIGIN uses ${origin.protocol} — a public deployment should be https.`);
      if (config.publicAppOrigin !== origin.origin) {
        errors.push(`PUBLIC_APP_ORIGIN must be a bare origin with no path or trailing slash. Use ${origin.origin}`);
      }
    } catch {
      errors.push('PUBLIC_APP_ORIGIN is not a valid absolute URL.');
    }
  }
}

// Neither credential is required to boot. Both are required for the features the
// product is demonstrated on, so an unconfigured staging box is called out.
if (!config.ollamaApiKey && new URL(config.ollamaBaseUrl).hostname !== '127.0.0.1') {
  warnings.push('OLLAMA_API_KEY is absent. The builder still works, but every AI job falls back to the built-in planner.');
}
if (!config.shutterstockApiToken && !(config.shutterstockClientId && config.shutterstockClientSecret)) {
  warnings.push('No Shutterstock credential. Stock imagery is disabled and the editor will say so.');
}

async function probeServer() {
  const base = process.env.HEALTH_URL || `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`;
  for (const path of ['/healthz', '/readyz', '/api/brief/status']) {
    const url = `${base}${path}`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const body = await response.json().catch(() => ({}));
      const line = `${response.ok ? 'OK  ' : 'FAIL'}  ${path.padEnd(20)} ${response.status} ${JSON.stringify(body)}`;
      if (!response.ok) errors.push(`${path} answered ${response.status}`);
      console.log(line);
    } catch (error) {
      errors.push(`${path} did not answer: ${error.message}`);
      console.log(`FAIL  ${path.padEnd(20)} ${error.message}`);
    }
  }
}

console.log('\nSBS Page Builder — deployment preflight\n');
for (const note of notes) console.log(`      ${note}`);
if (probe) {
  console.log('');
  await probeServer();
}
for (const warning of warnings) console.log(`\nWARN  ${warning}`);
for (const error of errors) console.log(`\nFAIL  ${error}`);

console.log(
  errors.length
    ? `\n${errors.length} blocking problem${errors.length === 1 ? '' : 's'}.\n`
    : `\nConfiguration is deployable${warnings.length ? ` with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}.\n`,
);
process.exit(errors.length ? 1 : 0);
