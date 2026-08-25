import { describe, expect, it } from 'vitest';
import { createConfig, publicConfig } from '../../server/config.mjs';

describe('Brief Brain server configuration', () => {
  it('uses the single configured Ollama model and keeps credentials server-only', () => {
    const config = createConfig({
      NODE_ENV: 'test',
      OLLAMA_API_KEY: 'super-secret-key',
      OLLAMA_MODEL: 'gemma4:31b',
      OLLAMA_BASE_URL: 'https://ollama.com/api',
    });
    expect(config.ollamaModel).toBe('gemma4:31b');
    expect(config.ollamaApiKey).toBe('super-secret-key');
    expect(publicConfig(config)).toEqual(expect.objectContaining({
      provider: 'ollama',
      model: 'gemma4:31b',
      configured: true,
      jobs: ['understand', 'content', 'outline', 'concepts', 'expand', 'media'],
    }));
    expect(JSON.stringify(publicConfig(config))).not.toContain('super-secret-key');
    expect(JSON.stringify(publicConfig(config))).not.toContain('ollama.com/api');
  });

  it('reports whether stock media is configured without exposing the credential', () => {
    const withToken = createConfig({ NODE_ENV: 'test', SHUTTERSTOCK_API_TOKEN: 'v2/stock-secret' });
    expect(publicConfig(withToken).media).toEqual({ provider: 'shutterstock', configured: true, images: 10, videos: 2 });
    expect(JSON.stringify(publicConfig(withToken))).not.toContain('v2/stock-secret');

    // Client credentials are the other accepted form; one half of a pair is not
    // a credential and must not read as configured.
    const withBasic = createConfig({ NODE_ENV: 'test', SHUTTERSTOCK_CLIENT_ID: 'id', SHUTTERSTOCK_CLIENT_SECRET: 'secret' });
    expect(publicConfig(withBasic).media.configured).toBe(true);
    expect(publicConfig(createConfig({ NODE_ENV: 'test', SHUTTERSTOCK_CLIENT_ID: 'id' })).media.configured).toBe(false);
    expect(publicConfig(createConfig({ NODE_ENV: 'test' })).media.configured).toBe(false);
    expect(() => createConfig({ NODE_ENV: 'test', SHUTTERSTOCK_BASE_URL: 'file:///etc/passwd' })).toThrow(/SHUTTERSTOCK_BASE_URL/);
  });

  it('applies per-job answer budgets and rejects unsafe base URLs', () => {
    const config = createConfig({
      NODE_ENV: 'test',
      BRIEF_BRAIN_CACHE_TTL_SECONDS: '120',
      OLLAMA_TIMEOUT_MS: '120000',
    });
    expect(config.cacheTtlMs).toBe(120_000);
    expect(config.ollamaTimeoutMs).toBe(120_000);
    // Drafting a whole page needs a far larger budget than reading a brief.
    expect(config.briefContentTokens).toBeGreaterThan(config.briefUnderstandTokens);
    expect(createConfig({ NODE_ENV: 'test', BRIEF_BRAIN_CONTENT_TOKENS: '6144' }).briefContentTokens).toBe(6_144);
    // Out-of-range values fall back to the default instead of being clamped in.
    expect(createConfig({ NODE_ENV: 'test', BRIEF_BRAIN_CONTENT_TOKENS: '999999' }).briefContentTokens).toBe(4_096);
    expect(() => createConfig({ OLLAMA_BASE_URL: 'file:///private/model' })).toThrow(/OLLAMA_BASE_URL/);
  });
});
