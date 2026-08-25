#!/usr/bin/env node
/**
 * Answers "why did the brief reader degrade?" in one command.
 *
 * The server log says a job degraded and now says why, but that is after the
 * fact and needs somebody watching. This asks the provider directly, in the same
 * order the failures happen, and prints what it found — the configuration, the
 * model list, and a real one-token generation through the actual provider code.
 *
 *   npm run check:ollama
 *
 * It never prints the key. Length only, so "is it set" and "is it truncated" are
 * both answerable without putting a credential in a terminal someone screenshots.
 */
import 'dotenv/config';
import { createConfig } from '../server/config.mjs';
import { createOllamaProvider } from '../server/ai/ollama-provider.mjs';

const started = Date.now();
const out = { checks: [] };
const record = (name, ok, detail) => {
  out.checks.push({ name, ok, detail });
  const mark = ok === true ? 'ok  ' : ok === false ? 'FAIL' : '--  ';
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

let config;
try {
  config = createConfig(process.env);
} catch (error) {
  record('configuration loads', false, error.message);
  console.log('\nFix .env and run this again.');
  process.exit(1);
}

record('configuration loads', true, `base ${config.ollamaBaseUrl} · model ${config.ollamaModel} · timeout ${config.ollamaTimeoutMs}ms`);
record('API key present', Boolean(config.ollamaApiKey), config.ollamaApiKey
  ? `${config.ollamaApiKey.length} characters`
  : 'OLLAMA_API_KEY is empty — every job will degrade to the built-in planner');

/* Cloud only, by policy: a loopback base URL is a misconfiguration to name, not to use. */
const host = new URL(config.ollamaBaseUrl).hostname;
if (['127.0.0.1', 'localhost', '::1'].includes(host)) {
  record('provider is Ollama Cloud', false, `OLLAMA_BASE_URL points at ${host}; this project uses Ollama Cloud only`);
}

const provider = createOllamaProvider({ config });

let status;
try {
  status = await provider.status();
  record('provider reachable', Boolean(status.available), `models listed · configured=${status.configured}`);
  record(`model ${config.ollamaModel} offered to this key`, Boolean(status.modelAvailable),
    status.modelAvailable ? '' : 'the account did not list it — check OLLAMA_MODEL against the models the key can use');
} catch (error) {
  record('provider reachable', false, `${error.code || error.name}: ${error.message}`);
}

try {
  const began = Date.now();
  const value = await provider.generateJson({
    systemPrompt: 'You reply with JSON only. No prose, no markdown.',
    userPrompt: 'Return {"ok": true} and nothing else.',
    jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    maxTokens: 64,
  });
  record('a real generation succeeds', value?.ok === true, `${Date.now() - began}ms · ${JSON.stringify(value)}`);
} catch (error) {
  // This is the line that answers the question. It carries the provider's own
  // status and message, which the old error threw away.
  record('a real generation succeeds', false,
    `${error.code || error.name}: ${error.message}${error.details?.status ? ` [HTTP ${error.details.status}]` : ''}`);
}

const failed = out.checks.filter((check) => check.ok === false);
console.log(`\n${failed.length ? `${failed.length} check(s) failed` : 'all checks passed'} in ${Date.now() - started}ms`);
if (failed.length) {
  console.log('The brief reader will still work — it falls back to the built-in planner — but the copy,');
  console.log('the concepts and the imagery search will not be written by the model until this is fixed.');
}
process.exitCode = failed.length ? 1 : 0;
