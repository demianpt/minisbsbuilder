import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { createOllamaProvider } from './ai/ollama-provider.mjs';
import { createShutterstockProvider } from './media/shutterstock-provider.mjs';
import { createBriefBrain } from './brief/brief-brain.mjs';
import { config as defaultConfig } from './config.mjs';
import { createBriefRouter } from './routes/brief.mjs';
import { errorPayload } from './shared/errors.mjs';
import { createLogger } from './shared/logger.mjs';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);

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
  app.set('trust proxy', false);
  app.use(express.json({ limit: services.config.bodyLimit, strict: true }));
  app.use('/api/brief', createBriefRouter(services));

  // API routes take precedence. In production `npm start` can serve the Vite
  // bundle, while development continues to use Vite's proxy.
  const distDirectory = options.distDirectory || resolve(projectRoot, 'dist');
  const indexFile = resolve(distDirectory, 'index.html');
  if (existsSync(indexFile)) {
    app.use(express.static(distDirectory, { index: false, fallthrough: true }));
    app.use((request, response, next) => {
      if (request.method !== 'GET' || request.path.startsWith('/api/')) return next();
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
  services.logger.info('brief_brain_server_started', {
    host: config.host,
    port: config.port,
    ollamaConfigured: Boolean(config.ollamaApiKey),
    ollamaModel: config.ollamaModel,
    stockConfigured: services.stock.configured,
  });
  const shutdown = async () => {
    await new Promise((resolveClose) => server.close(resolveClose));
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
