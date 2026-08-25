import { describe, expect, it, vi } from 'vitest';
import { createOllamaProvider } from '../../server/ai/ollama-provider.mjs';

/**
 * What the provider says when the provider says no.
 *
 * Every non-2xx used to become `OLLAMA_UNAVAILABLE` with "Ollama could not
 * complete the request", and the response body — the only place the reason lives
 * — was discarded. An operator watching four identical lines in the log had
 * nothing to act on: a quota that clears in a minute, a key without access to the
 * model, and a typo in the model name all looked the same.
 */

const config = {
  ollamaBaseUrl: 'https://ollama.com/api',
  ollamaApiKey: 'test-key-not-a-real-credential',
  ollamaModel: 'gemma4:31b',
  ollamaTimeoutMs: 5_000,
  ollamaNumPredict: 512,
  aiAttempts: 1,
};

/** A fetch that answers once with the given status and body. */
function answering(status, body, headers = {}) {
  return vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  }));
}

const ask = (provider) => provider.generateJson({
  systemPrompt: 'x', userPrompt: 'y', jsonSchema: { type: 'object' }, maxTokens: 64,
});

async function refusal(status, body, headers) {
  const provider = createOllamaProvider({ config, fetchImpl: answering(status, body, headers) });
  try {
    await ask(provider);
    throw new Error('the call should not have succeeded');
  } catch (error) { return error; }
}

describe('a provider refusal names its own cause', () => {
  it('a rate limit is a rate limit, with the wait', async () => {
    const error = await refusal(429, { error: 'rate limit exceeded for this key' }, { 'retry-after': '42' });
    expect(error.code).toBe('OLLAMA_RATE_LIMITED');
    expect(error.message).toContain('42s');
    // The provider's own words, so the log line is actionable.
    expect(error.message).toContain('rate limit exceeded for this key');
    expect(error.details).toMatchObject({ status: 429, retryAfter: 42 });
  });

  it('a refused key is not a timeout', async () => {
    const error = await refusal(401, { error: 'invalid api key' });
    expect(error.code).toBe('OLLAMA_FORBIDDEN');
    expect(error.message).toContain('gemma4:31b');
    expect(error.message).toContain('invalid api key');
  });

  it('a model that does not exist says which one', async () => {
    const error = await refusal(404, { error: "model 'gemma4:31b' not found" });
    expect(error.code).toBe('OLLAMA_MODEL_NOT_FOUND');
    expect(error.message).toContain('gemma4:31b');
    expect(error.details).toMatchObject({ status: 404, model: 'gemma4:31b' });
  });

  it('anything else carries the status and the body', async () => {
    const error = await refusal(502, 'upstream connect error');
    expect(error.code).toBe('OLLAMA_UNAVAILABLE');
    expect(error.message).toContain('502');
    expect(error.message).toContain('upstream connect error');
  });

  it('an HTML error page is bounded rather than becoming the message', async () => {
    const error = await refusal(503, `<html><body>${'x'.repeat(4_000)}</body></html>`);
    expect(error.code).toBe('OLLAMA_UNAVAILABLE');
    expect(error.message.length).toBeLessThan(400);
  });

  it('never carries the API key', async () => {
    const error = await refusal(401, { error: 'invalid api key' });
    expect(JSON.stringify({ message: error.message, details: error.details }))
      .not.toContain('test-key-not-a-real-credential');
  });
});

describe('a blip is not a verdict', () => {
  it('retries a rate limit once, then succeeds', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ error: 'slow down' }), { status: 429, headers: { 'retry-after': '0' } });
      }
      return new Response(JSON.stringify({ message: { content: '{"ok":true}' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    const provider = createOllamaProvider({ config: { ...config, aiAttempts: 2 }, fetchImpl });
    await expect(ask(provider)).resolves.toEqual({ ok: true });
    expect(call).toBe(2);
  });

  it('does not retry a refused key, because waiting does not fix it', async () => {
    const fetchImpl = answering(403, { error: 'no access' });
    const provider = createOllamaProvider({ config: { ...config, aiAttempts: 3 }, fetchImpl });
    await expect(ask(provider)).rejects.toMatchObject({ code: 'OLLAMA_FORBIDDEN' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads a fenced JSON reply, because the model returns one', async () => {
    // `format: <schema>` is sent, and this model answers with a ```json fence
    // anyway. Refusing that would degrade every job on a working provider.
    const fetchImpl = answering(200, { message: { content: '```json\n{"ok":true}\n```' } });
    const provider = createOllamaProvider({ config, fetchImpl });
    await expect(ask(provider)).resolves.toEqual({ ok: true });
  });
});
