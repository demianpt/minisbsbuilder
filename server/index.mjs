import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import compression from 'compression';
import express from 'express';
import { createOllamaProvider } from './ai/ollama-provider.mjs';
import { createShutterstockProvider } from './media/shutterstock-provider.mjs';
import { createBriefBrain } from './brief/brief-brain.mjs';
import { config as defaultConfig } from './config.mjs';
import { createBriefRouter } from './routes/brief.mjs';
import { errorPayload } from './shared/errors.mjs';
import { createLogger } from './shared/logger.mjs';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);

/** Reported by `/healthz` so an operator can see which build is answering. */
function readAppVersion() {
  try {
    return JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

const appVersion = readAppVersion();

/**
 * Hashed Vite assets are immutable and safe to cache for a year; `index.html`
 * names them and must never be cached, or a deploy leaves browsers asking for
 * files the new build no longer contains.
 */
const IMMUTABLE_ASSET = /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|otf|svg|png|jpe?g|webp|avif|gif|ico|mp4|webm)$/;

function setStaticHeaders(response, filePath) {
  response.setHeader(
    'Cache-Control',
    IMMUTABLE_ASSET.test(filePath) ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
  );
}

/**
 * The response headers a reverse proxy should not have to add. Deliberately
 * narrow: no CSP is set here because the builder renders author-controlled
 * inline styles into its live preview, and a policy that has to allow
 * `unsafe-inline` for both styles and scripts is a claim, not a control.
 */
function securityHeaders(_request, response, next) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

function safeValidationDetails(value) {
  if (!Array.isArray(value)) return undefined;
  const details = value.slice(0, 12).map((item) => ({
    path: String(item?.path || 'request').slice(0, 160),
    message: String(item?.message || 'Invalid value.').slice(0, 240),
  }));
  return details.length ? details : undefined;
}

export function createBriefServices({
  config = defaultConfig,
  logger = createLogger({ environment: config.isTest ? 'test' : process.env.NODE_ENV }),
  provider,
  stock,
  brain,
} = {}) {
  const resolvedProvider = provider || createOllamaProvider({ config, logger });
  const resolvedStock = stock || createShutterstockProvider({ config, logger });
  const resolvedBrain = brain || createBriefBrain({ provider: resolvedProvider, stock: resolvedStock, config, logger });
  return Object.freeze({
    config,
    logger,
    provider: resolvedProvider,
    stock: resolvedStock,
    brain: resolvedBrain,
    async close() {},
  });
}

export function createApp(options = {}) {
  const services = options.services || createBriefServices(options);
  const app = express();
  app.disable('x-powered-by');
  // `false` unless TRUST_PROXY is set. Behind nginx this must name the proxy, or
  // every caller shares one rate-limit bucket keyed to the proxy's address.
  app.set('trust proxy', services.config.trustProxy);
  app.use(securityHeaders);
  // The client bundle is ~2.3 MB of JS and CSS before compression, and the
  // Brief Brain answers are large JSON documents. Both are text.
  app.use(compression());

  const distDirectory = options.distDirectory || resolve(projectRoot, 'dist');
  const indexFile = resolve(distDirectory, 'index.html');

  // Liveness. No upstream call, no rate limit, no body parsing: an orchestrator
  // probing this every few seconds must not be able to make the app slower, and
  // an Ollama outage must never read as an unhealthy container — the built-in
  // planner answers when the model cannot.
  app.get('/healthz', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.json({ status: 'ok', version: appVersion, uptime: Math.round(process.uptime()) });
  });

  // Readiness. Answers what this process can actually serve right now, so a
  // deploy that forgot `npm run build` fails the gate instead of serving 404s.
  app.get('/readyz', (_request, response) => {
    const bundle = existsSync(indexFile);
    response.setHeader('Cache-Control', 'no-store');
    response.status(bundle ? 200 : 503).json({
      status: bundle ? 'ready' : 'unready',
      version: appVersion,
      bundle,
      ...(bundle ? {} : { reason: 'The client bundle is missing. Run `npm run build` before starting the server.' }),
    });
  });

  app.use(express.json({ limit: services.config.bodyLimit, strict: true }));
  app.use('/api/brief', createBriefRouter(services));

  // API routes take precedence. In production `npm start` serves the Vite
  // bundle, while development continues to use Vite's proxy.
  if (existsSync(indexFile)) {
    app.use(express.static(distDirectory, { index: false, fallthrough: true, setHeaders: setStaticHeaders }));
    app.use((request, response, next) => {
      if (request.method !== 'GET' || request.path.startsWith('/api/')) return next();
      response.setHeader('Cache-Control', 'no-store');
      return response.sendFile(indexFile);
    });
  }

  app.use((request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested server resource was not found.' } });
  });
  app.use((error, _request, response, _next) => {
    const status = error?.type === 'entity.too.large' ? 413 : error?.status || 500;
    const validationDetails = status < 500 && error?.code === 'INVALID_REQUEST'
      ? safeValidationDetails(error.details)
      : undefined;
    const normalized = status === 413
      ? { code: 'BODY_TOO_LARGE', message: 'The request body is too large.', status }
      : { code: error?.code || 'INTERNAL_ERROR', message: error?.message || 'The request could not complete.', status, details: validationDetails };
    services.logger?.warn('brief_brain_server_error', {
      code: normalized.code,
      status,
      ...(validationDetails ? { fields: validationDetails } : {}),
    });
    response.status(status).json(errorPayload(normalized, { exposeDetails: services.config.isTest || Boolean(validationDetails) }));
  });
  app.locals.briefBrain = services;
  return app;
}

export async function startServer({ config = defaultConfig } = {}) {
  const services = createBriefServices({ config });
  const app = createApp({ services });
  const server = await new Promise((resolveServer, reject) => {
    const instance = app.listen(config.port, config.host, () => resolveServer(instance));
    instance.on('error', reject);
  });
  // Longer than a typical reverse proxy's own keep-alive so nginx closes idle
  // sockets first; a proxy that reuses a connection the app is closing turns
  // into a sporadic 502 for the user.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  services.logger.info('brief_brain_server_started', {
    host: config.host,
    port: config.port,
    environment: process.env.NODE_ENV || 'development',
    trustProxy: config.trustProxy,
    publicAppOrigin: config.publicAppOrigin || '(unset: origin checks disabled)',
    ollamaConfigured: Boolean(config.ollamaApiKey),
    ollamaModel: config.ollamaModel,
    stockConfigured: services.stock.configured,
  });
  const shutdown = async ({ graceMs = 10_000 } = {}) => {
    const closed = new Promise((resolveClose) => server.close(resolveClose));
    // Stop accepting work, let in-flight requests finish, then drop whatever is
    // still holding a keep-alive socket so a restart cannot hang the deploy.
    const forced = setTimeout(() => server.closeAllConnections?.(), graceMs);
    try {
      await closed;
    } finally {
      clearTimeout(forced);
    }
    await services.close();
  };
  return { app, services, server, shutdown };
}

const invokedAsScript = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedAsScript) {
  startServer().then(({ shutdown }) => {
    process.once('SIGINT', () => { shutdown().finally(() => process.exit(0)); });
    process.once('SIGTERM', () => { shutdown().finally(() => process.exit(0)); });
  }).catch((error) => {
    // Do not print secrets or request bodies. Startup errors are configuration
    // diagnostics only and fail the process for predictable orchestration.
    console.error(`Brief Brain server failed to start: ${error.message}`);
    process.exitCode = 1;
  });
}
