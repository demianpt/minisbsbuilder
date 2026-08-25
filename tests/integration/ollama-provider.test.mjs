import { describe, expect, it } from 'vitest';
import { createOllamaProvider } from '../../server/ai/ollama-provider.mjs';
import { createConfig } from '../../server/config.mjs';
import { BriefBrainError } from '../../server/shared/errors.mjs';

function cloudConfig(overrides = {}) {
  return createConfig({
    NODE_ENV: 'test',
    OLLAMA_BASE_URL: 'https://ollama.com/api',
    OLLAMA_API_KEY: 'not-returned-to-client',
    OLLAMA_MODEL: 'gemma4:31b',
    ...overrides,
  });
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Ollama Brief Brain provider', () => {
  it('uses the one configured model and performs one strict JSON repair retry', async () => {
    const requests = [];
    let calls = 0;
    const provider = createOllamaProvider({
      config: cloudConfig(),
      fetchImpl: async (_url, init) => {
        requests.push(init);
        calls += 1;
        return jsonResponse({ message: { content: calls === 1 ? 'not-json' : '{"valid":true}' } });
      },
    });
    const value = await provider.generateJson({
      systemPrompt: 'Return JSON.',
      userPrompt: 'Read the brief.',
      jsonSchema: { type: 'object', required: ['valid'] },
      validate: (candidate) => {
        if (candidate.valid !== true) throw new BriefBrainError('SCHEMA_INVALID', 'Missing valid field.', { status: 502 });
        return candidate;
      },
    });
    expect(value).toEqual({ valid: true });
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      const body = JSON.parse(request.body);
      expect(body.model).toBe('gemma4:31b');
      expect(body.stream).toBe(false);
      expect(body.options.temperature).toBe(0);
      expect(body.options.num_predict).toBe(1_024);
      expect(body.format).toEqual({ type: 'object', required: ['valid'] });
      expect(request.headers.authorization).toBe('Bearer not-returned-to-client');
    }
    // The repair attempt must carry the reason back to the model.
    expect(JSON.parse(requests[1].body).messages[1].content).toContain('did not return valid JSON');
  });

  it('forwards a domain validation reason to the repair attempt', async () => {
    const requests = [];
    let calls = 0;
    const provider = createOllamaProvider({
      config: cloudConfig(),
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        calls += 1;
        return jsonResponse({ message: { content: calls === 1 ? '{"id":"ZZ9"}' : '{"id":"C3"}' } });
      },
    });
    const value = await provider.generateJson({
      systemPrompt: 's',
      userPrompt: 'Choose a flow.',
      jsonSchema: { type: 'object' },
      validate: (candidate) => {
        if (candidate.id !== 'C3') throw new BriefBrainError('SCHEMA_INVALID', 'flows[].id must be one of A1, C3.', { status: 502 });
        return candidate;
      },
    });
    expect(value).toEqual({ id: 'C3' });
    // Without the real reason the model repeats the same off-catalog answer.
    expect(requests[1].messages[1].content).toContain('must be one of A1, C3');
  });

  it('honours a per-job answer budget so a long page draft is not truncated', async () => {
    const requests = [];
    const provider = createOllamaProvider({
      config: cloudConfig(),
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        return jsonResponse({ message: { content: '{"ok":true}' } });
      },
    });
    await provider.generateJson({ systemPrompt: 's', userPrompt: 'u', jsonSchema: { type: 'object' }, maxTokens: 4_096 });
    await provider.generateJson({ systemPrompt: 's', userPrompt: 'u', jsonSchema: { type: 'object' }, maxTokens: 99_999 });
    expect(requests[0].options.num_predict).toBe(4_096);
    // The ceiling is enforced server-side; a client cannot ask for unbounded output.
    expect(requests[1].options.num_predict).toBe(8_192);
  });

  it('returns a bounded timeout error when Ollama does not respond', async () => {
    const config = { ...cloudConfig(), ollamaTimeoutMs: 10 };
    const provider = createOllamaProvider({
      config,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    });
    await expect(provider.generateJson({
      systemPrompt: 'Return JSON.', userPrompt: 'Read.', jsonSchema: { type: 'object' }, validate: (value) => value,
    })).rejects.toMatchObject({ code: 'OLLAMA_TIMEOUT', status: 504 });
  });

  it('accepts a complete Markdown JSON fence from a compliant cloud model', async () => {
    const provider = createOllamaProvider({
      config: cloudConfig(),
      fetchImpl: async () => jsonResponse({ message: { content: '```json\n{"valid":true}\n```' } }),
    });
    await expect(provider.generateJson({
      systemPrompt: 'Return JSON.', userPrompt: 'Read.', jsonSchema: { type: 'object' }, validate: (value) => value,
    })).resolves.toEqual({ valid: true });
  });

  it('reports an unconfigured cloud endpoint instead of attempting a request', async () => {
    let called = false;
    const provider = createOllamaProvider({
      config: createConfig({ NODE_ENV: 'test', OLLAMA_BASE_URL: 'https://ollama.com/api', OLLAMA_API_KEY: '' }),
      fetchImpl: async () => { called = true; return jsonResponse({}); },
    });
    await expect(provider.generateJson({ systemPrompt: 's', userPrompt: 'u', jsonSchema: { type: 'object' } }))
      .rejects.toMatchObject({ code: 'OLLAMA_NOT_CONFIGURED', status: 503 });
    expect(called).toBe(false);
  });
});
