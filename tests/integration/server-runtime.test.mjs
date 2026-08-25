import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, createBriefServices } from '../../server/index.mjs';
import { createConfig } from '../../server/config.mjs';

/**
 * The deployment contract. Everything here is something an orchestrator, a
 * reverse proxy or a browser cache depends on, and every one of them fails
 * quietly rather than loudly when it is wrong.
 */

function services(env = {}) {
  const config = createConfig({ NODE_ENV: 'test', ...env });
  const provider = {
    async status() { return { provider: 'ollama', model: config.ollamaModel, configured: false, available: false }; },
    async complete() { throw new Error('not used'); },
  };
  return createBriefServices({ config, provider, stock: { configured: false, async status() { return { configured: false, available: false }; } }, brain: {} });
}

describe('liveness and readiness', () => {
  it('answers /healthz without a bundle, without credentials and without touching an upstream', async () => {
    const app = createApp({ services: services(), distDirectory: join(tmpdir(), 'sbs-absent-dist') });
    const response = await request(app).get('/healthz');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    // An operator has to be able to tell which build answered.
    expect(response.body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('fails readiness when the client bundle is missing, and names the fix', async () => {
    const app = createApp({ services: services(), distDirectory: join(tmpdir(), 'sbs-absent-dist') });
    const response = await request(app).get('/readyz');
    // A deploy that skipped `npm run build` must fail its gate rather than
    // serve an API with no site attached.
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: 'unready', bundle: false });
    expect(response.body.reason).toContain('npm run build');
  });
});

describe('serving the built client', () => {
  let distDirectory;
  let app;

  beforeAll(() => {
    distDirectory = mkdtempSync(join(tmpdir(), 'sbs-dist-'));
    mkdirSync(join(distDirectory, 'assets'));
    writeFileSync(join(distDirectory, 'index.html'), '<!doctype html><title>SBS</title>');
    // Vite's real output shape: a content hash in the filename.
    writeFileSync(join(distDirectory, 'assets', 'index-D41oMTVU.js'), `export const filler = "${'x'.repeat(4096)}";`);
    writeFileSync(join(distDirectory, 'assets', 'unhashed.js'), 'export const plain = 1;');
    app = createApp({ services: services(), distDirectory });
  });

  afterAll(() => rmSync(distDirectory, { recursive: true, force: true }));

  it('reports ready and serves the shell', async () => {
    expect((await request(app).get('/readyz')).body).toMatchObject({ status: 'ready', bundle: true });
    expect((await request(app).get('/')).status).toBe(200);
  });

  it('caches hashed assets for a year and never caches the shell that names them', async () => {
    const asset = await request(app).get('/assets/index-D41oMTVU.js');
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    // A file with no hash could change under the same URL, so it must be revalidated.
    const unhashed = await request(app).get('/assets/unhashed.js');
    expect(unhashed.headers['cache-control']).toBe('public, max-age=0, must-revalidate');

    // index.html names this deploy's hashed files. Cached, it would outlive them.
    for (const path of ['/', '/some/deep/builder/route']) {
      const shell = await request(app).get(path);
      expect(shell.status).toBe(200);
      expect(shell.headers['cache-control']).toBe('no-store');
    }
  });

  it('compresses text responses', async () => {
    const response = await request(app)
      .get('/assets/index-D41oMTVU.js')
      .set('Accept-Encoding', 'gzip');
    // The real bundle is ~2.3 MB uncompressed and ~390 KB gzipped.
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.headers.vary).toContain('Accept-Encoding');
  });

  it('sets the response headers a proxy should not have to add, and hides the runtime', async () => {
    const response = await request(app).get('/healthz');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('answers unknown API paths as JSON and unknown page routes as the app', async () => {
    const api = await request(app).get('/api/not-a-route');
    expect(api.status).toBe(404);
    expect(api.body.error.code).toBe('NOT_FOUND');
    expect((await request(app).get('/step/04')).headers['content-type']).toContain('text/html');
  });
});

describe('proxy trust', () => {
  it('is off unless TRUST_PROXY names the proxy', () => {
    // Trusting X-Forwarded-For with nothing in front lets a caller forge the
    // address its rate limit is keyed to.
    expect(createConfig({ NODE_ENV: 'test' }).trustProxy).toBe(false);
    expect(createConfig({ NODE_ENV: 'test', TRUST_PROXY: '' }).trustProxy).toBe(false);
    expect(createConfig({ NODE_ENV: 'test', TRUST_PROXY: 'off' }).trustProxy).toBe(false);
  });

  it('accepts a hop count or a named proxy, as Express does', () => {
    expect(createConfig({ NODE_ENV: 'test', TRUST_PROXY: 'loopback' }).trustProxy).toBe('loopback');
    expect(createConfig({ NODE_ENV: 'test', TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(createConfig({ NODE_ENV: 'test', TRUST_PROXY: 'true' }).trustProxy).toBe(1);
    expect(createConfig({ NODE_ENV: 'test', TRUST_PROXY: '10.0.0.0/8' }).trustProxy).toBe('10.0.0.0/8');
  });

  it('keys the rate limit per visitor only when the proxy is trusted', async () => {
    // The consequence that matters. Behind nginx with TRUST_PROXY unset, every
    // request carries the proxy's own address, so one busy visitor spends the
    // whole site's budget. `[]` is rejected as a body, but only after the
    // limiter has counted the request.
    const post = (app, ip) => request(app).post('/api/brief/understand').set('X-Forwarded-For', ip).send([]);

    const untrusting = createApp({ services: services({ BRIEF_BRAIN_RATE_LIMIT_MAX: '1' }) });
    expect((await post(untrusting, '203.0.113.7')).status).toBe(422);
    expect((await post(untrusting, '198.51.100.4')).status).toBe(429);

    const trusting = createApp({ services: services({ BRIEF_BRAIN_RATE_LIMIT_MAX: '1', TRUST_PROXY: 'loopback' }) });
    expect((await post(trusting, '203.0.113.7')).status).toBe(422);
    expect((await post(trusting, '198.51.100.4')).status).toBe(422);
  });

  it('applies the configured value to Express itself', () => {
    expect(createApp({ services: services() }).get('trust proxy')).toBe(false);
    expect(createApp({ services: services({ TRUST_PROXY: 'loopback' }) }).get('trust proxy')).toBe('loopback');
  });
});
