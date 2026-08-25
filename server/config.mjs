import { URL } from 'node:url';

const DEFAULTS = Object.freeze({
  host: '127.0.0.1',
  port: 4174,
  // Off by default. A server that trusts `X-Forwarded-For` without a proxy in
  // front of it lets any client forge its own rate-limit key.
  trustProxy: false,
  ollamaBaseUrl: 'https://ollama.com/api',
  // Available to free Ollama Cloud API keys and reliable with the strict JSON
  // `format` constraint every Brief Brain job depends on.
  ollamaModel: 'gemma4:31b',
  ollamaNumPredict: 1_024,
  ollamaTimeoutMs: 180_000,
  bodyLimit: '128kb',
  // Per-job answer budgets. Reading a brief is short; drafting a whole page is
  // not, and a truncated draft fails the schema and wastes the whole call.
  briefUnderstandTokens: 1_024,
  briefContentTokens: 4_096,
  briefOutlineTokens: 1_024,
  // Three complete concepts plus a readback and five flows is the largest
  // single answer the brain is asked for.
  briefConceptTokens: 3_072,
  // Search phrases in, then one asset id per media slot out. Both halves of the
  // media job are short answers.
  briefMediaTokens: 2_048,
  // Stock media. Search only — the server never calls a licensing endpoint, so
  // every asset it returns is a watermarked preview and nothing is spent.
  shutterstockBaseUrl: 'https://api.shutterstock.com/v2',
  shutterstockTimeoutMs: 20_000,
  mediaImageCount: 10,
  mediaVideoCount: 2,
  cacheTtlMs: 60 * 60 * 1_000,
  maxJobsPerWindow: 30,
  rateWindowMs: 60 * 1_000,
  aiAttempts: 2,
});

function integerFromEnv(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function durationFromEnv(env, millisecondName, secondName, fallback, limits) {
  if (env[millisecondName] !== undefined && env[millisecondName] !== '') {
    return integerFromEnv(env[millisecondName], fallback, limits);
  }
  if (env[secondName] !== undefined && env[secondName] !== '') {
    const seconds = integerFromEnv(env[secondName], Math.floor(fallback / 1_000), {
      min: Math.ceil(limits.min / 1_000),
      max: Math.floor(limits.max / 1_000),
    });
    return seconds * 1_000;
  }
  return fallback;
}

function validateHttpUrl(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${name} must use http or https.`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function booleanFromEnv(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

/**
 * Express `trust proxy`. Behind nginx on the same host this must be `loopback`
 * (or a hop count) or every request is keyed to the proxy's own address and the
 * Brief Brain rate limit becomes one shared bucket for the whole site.
 */
function trustProxyFromEnv(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const raw = String(value).trim();
  const lowered = raw.toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(lowered)) return false;
  if (['1', 'true', 'yes', 'on'].includes(lowered)) return 1;
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  return raw;
}

/**
 * Reads the server-only configuration. No value returned by this module should
 * be sent to the browser without deliberate sanitisation in a route handler.
 */
export function createConfig(env = process.env) {
  const isTest = env.NODE_ENV === 'test';
  const isProduction = env.NODE_ENV === 'production';
  const ollamaModel = (env.OLLAMA_MODEL || DEFAULTS.ollamaModel).trim();
  if (!ollamaModel) throw new Error('OLLAMA_MODEL must not be empty.');

  return Object.freeze({
    ...DEFAULTS,
    host: env.HOST || DEFAULTS.host,
    port: integerFromEnv(env.PORT, DEFAULTS.port, { min: 1, max: 65_535 }),
    trustProxy: trustProxyFromEnv(env.TRUST_PROXY, DEFAULTS.trustProxy),
    ollamaBaseUrl: validateHttpUrl(env.OLLAMA_BASE_URL || DEFAULTS.ollamaBaseUrl, 'OLLAMA_BASE_URL'),
    ollamaApiKey: env.OLLAMA_API_KEY || '',
    ollamaModel,
    ollamaNumPredict: integerFromEnv(env.OLLAMA_NUM_PREDICT, DEFAULTS.ollamaNumPredict, { min: 256, max: 8_192 }),
    ollamaTimeoutMs: integerFromEnv(env.OLLAMA_TIMEOUT_MS || env.BRIEF_BRAIN_TIMEOUT_MS, DEFAULTS.ollamaTimeoutMs, { min: 5_000, max: 300_000 }),
    bodyLimit: env.BRIEF_BRAIN_BODY_LIMIT || DEFAULTS.bodyLimit,
    briefUnderstandTokens: integerFromEnv(env.BRIEF_BRAIN_UNDERSTAND_TOKENS, DEFAULTS.briefUnderstandTokens, { min: 256, max: 8_192 }),
    briefContentTokens: integerFromEnv(env.BRIEF_BRAIN_CONTENT_TOKENS, DEFAULTS.briefContentTokens, { min: 512, max: 8_192 }),
    briefOutlineTokens: integerFromEnv(env.BRIEF_BRAIN_OUTLINE_TOKENS, DEFAULTS.briefOutlineTokens, { min: 256, max: 8_192 }),
    briefConceptTokens: integerFromEnv(env.BRIEF_BRAIN_CONCEPT_TOKENS, DEFAULTS.briefConceptTokens, { min: 512, max: 8_192 }),
    briefMediaTokens: integerFromEnv(env.BRIEF_BRAIN_MEDIA_TOKENS, DEFAULTS.briefMediaTokens, { min: 512, max: 8_192 }),
    shutterstockBaseUrl: validateHttpUrl(env.SHUTTERSTOCK_BASE_URL || DEFAULTS.shutterstockBaseUrl, 'SHUTTERSTOCK_BASE_URL'),
    // Either credential works for search: an individual API token, or the
    // application's client id + secret over HTTP Basic.
    shutterstockApiToken: env.SHUTTERSTOCK_API_TOKEN || '',
    shutterstockClientId: env.SHUTTERSTOCK_CLIENT_ID || '',
    shutterstockClientSecret: env.SHUTTERSTOCK_CLIENT_SECRET || '',
    // Recorded so an operator can trace which subscription a comp came from.
    // Search does not use it, and this server never licenses an asset.
    shutterstockSubscriptionId: env.SHUTTERSTOCK_SUBSCRIPTION_ID || '',
    shutterstockSafeSearch: booleanFromEnv(env.SHUTTERSTOCK_SAFE_SEARCH, true),
    shutterstockTimeoutMs: integerFromEnv(env.SHUTTERSTOCK_TIMEOUT_MS, DEFAULTS.shutterstockTimeoutMs, { min: 2_000, max: 120_000 }),
    mediaImageCount: integerFromEnv(env.BRIEF_BRAIN_MEDIA_IMAGES, DEFAULTS.mediaImageCount, { min: 1, max: 40 }),
    mediaVideoCount: integerFromEnv(env.BRIEF_BRAIN_MEDIA_VIDEOS, DEFAULTS.mediaVideoCount, { min: 0, max: 10 }),
    cacheTtlMs: durationFromEnv(env, 'BRIEF_BRAIN_CACHE_TTL_MS', 'BRIEF_BRAIN_CACHE_TTL_SECONDS', DEFAULTS.cacheTtlMs, { min: 0, max: 7 * 24 * 60 * 60 * 1_000 }),
    maxJobsPerWindow: integerFromEnv(env.BRIEF_BRAIN_RATE_LIMIT_MAX, DEFAULTS.maxJobsPerWindow, { min: 1, max: 200 }),
    rateWindowMs: integerFromEnv(env.BRIEF_BRAIN_RATE_LIMIT_WINDOW_MS, DEFAULTS.rateWindowMs, { min: 1_000, max: 60 * 60 * 1_000 }),
    publicAppOrigin: env.PUBLIC_APP_ORIGIN || '',
    aiAttempts: integerFromEnv(env.BRIEF_BRAIN_AI_ATTEMPTS, DEFAULTS.aiAttempts, { min: 1, max: 3 }),
    isTest,
    isProduction,
  });
}

export const config = createConfig();

/** Deliberately safe subset for the browser-facing status/config endpoints. */
export function publicConfig(serverConfig = config) {
  return {
    provider: 'ollama',
    model: serverConfig.ollamaModel,
    configured: Boolean(serverConfig.ollamaApiKey) || new URL(serverConfig.ollamaBaseUrl).hostname === '127.0.0.1',
    jobs: ['understand', 'content', 'outline', 'concepts', 'expand', 'media'],
    // Never the token or the secret — only whether one is present, so the
    // editor can disable the button instead of failing the request.
    media: {
      provider: 'shutterstock',
      configured: Boolean(serverConfig.shutterstockApiToken)
        || Boolean(serverConfig.shutterstockClientId && serverConfig.shutterstockClientSecret),
      images: serverConfig.mediaImageCount,
      videos: serverConfig.mediaVideoCount,
    },
  };
}
