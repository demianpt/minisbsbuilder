import express from 'express';
import { publicConfig } from '../config.mjs';
import { BriefBrainError, errorPayload } from '../shared/errors.mjs';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asValidationError(error) {
  if (error instanceof BriefBrainError) return error;
  if (error?.name === 'ZodError') {
    return new BriefBrainError('INVALID_REQUEST', 'The Brief Brain request is invalid.', {
      status: 422,
      details: error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      cause: error,
    });
  }
  return error;
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch((error) => next(asValidationError(error)));
}

function createRateLimiter({ max, windowMs, now = () => Date.now() }) {
  const buckets = new Map();
  return {
    consume(key) {
      const time = now();
      const entries = (buckets.get(key) || []).filter((entry) => entry > time - windowMs);
      if (entries.length >= max) {
        buckets.set(key, entries);
        return false;
      }
      entries.push(time);
      buckets.set(key, entries);
      return true;
    },
  };
}

function enforceOrigin(request, config) {
  const origin = request.get('origin');
  if (!origin || !config.publicAppOrigin) return;
  if (origin !== config.publicAppOrigin) {
    throw new BriefBrainError('ORIGIN_FORBIDDEN', 'This request is not from the configured application origin.', { status: 403 });
  }
}

/**
 * The Brief Brain HTTP surface. Three POST jobs, one status probe. The browser
 * never names a model or a provider — those are server configuration.
 */
export function createBriefRouter({ config, provider, stock, brain, logger } = {}) {
  const router = express.Router();
  const limiter = createRateLimiter({ max: config.maxJobsPerWindow, windowMs: config.rateWindowMs });

  const status = asyncRoute(async (_request, response) => {
    const service = await provider.status();
    const base = publicConfig(config);
    // The stock probe is a real network call. Only make it when credentials
    // exist, so an unconfigured server still answers the status poll instantly.
    const media = stock?.configured ? await stock.status() : { configured: false, available: false };
    response.json({
      ...base,
      configured: service.configured,
      available: service.available,
      modelAvailable: service.modelAvailable,
      media: { ...base.media, configured: Boolean(media.configured), available: Boolean(media.available) },
    });
  });
  router.get('/status', status);
  router.get('/config', status);

  function guard(request) {
    enforceOrigin(request, config);
    if (!limiter.consume(request.ip || request.socket.remoteAddress || 'unknown')) {
      throw new BriefBrainError('RATE_LIMITED', 'Too many Brief Brain requests. Try again shortly.', { status: 429 });
    }
    if (!isObject(request.body)) throw new BriefBrainError('INVALID_REQUEST', 'Send a JSON object.', { status: 422 });
    if (request.body.model !== undefined && request.body.model !== config.ollamaModel) {
      throw new BriefBrainError('MODEL_UNSUPPORTED', 'The Brief Brain uses the server-configured model only.', { status: 422 });
    }
    return request.body;
  }

  router.post('/understand', asyncRoute(async (request, response) => {
    response.json(await brain.understand(guard(request)));
  }));

  router.post('/content', asyncRoute(async (request, response) => {
    response.json(await brain.content(guard(request)));
  }));

  router.post('/outline', asyncRoute(async (request, response) => {
    response.json(await brain.outline(guard(request)));
  }));

  // The simple builder's whole first step, and the handoff back to the
  // advanced builder's individual brief fields.
  router.post('/concepts', asyncRoute(async (request, response) => {
    response.json(await brain.concepts(guard(request)));
  }));

  router.post('/expand', asyncRoute(async (request, response) => {
    response.json(await brain.expand(guard(request)));
  }));

  // Stock imagery for the page. Shared by both builders: the request carries the
  // media slots, never a credential and never a provider name.
  router.post('/media', asyncRoute(async (request, response) => {
    response.json(await brain.media(guard(request)));
  }));

  // One asset by its Shutterstock id, for the shot somebody already found.
  router.post('/media/asset', asyncRoute(async (request, response) => {
    response.json(await brain.mediaAsset(guard(request)));
  }));

  router.use((error, request, response, _next) => {
    const normalized = asValidationError(error);
    const status = normalized?.status || 500;
    if (status === 429) response.set('Retry-After', String(Math.ceil(config.rateWindowMs / 1_000)));
    logger?.warn('brief_brain_api_error', { code: normalized?.code, status });
    response.status(status).json(errorPayload(normalized, { exposeDetails: config.isTest || status === 422 }));
  });
  return router;
}
