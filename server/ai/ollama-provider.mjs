import { BriefBrainError, CancelledError } from '../shared/errors.mjs';

function isLoopbackOllama(baseUrl) {
  const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

function requestHeaders(config) {
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (config.ollamaApiKey) headers.authorization = `Bearer ${config.ollamaApiKey}`;
  return headers;
}

function timeoutSignal(signal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function parseStrictJson(content) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new BriefBrainError('OLLAMA_INVALID_JSON', 'The Ollama model returned an empty response.', { status: 502 });
  }
  try {
    const trimmed = content.trim();
    // Some compliant chat models put their otherwise valid structured result
    // in one complete Markdown JSON fence. Accept only that exact wrapper;
    // prose before or after the object remains invalid.
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    return JSON.parse(fenced ? fenced[1] : trimmed);
  } catch (cause) {
    throw new BriefBrainError('OLLAMA_INVALID_JSON', 'The Ollama model did not return valid JSON.', { status: 502, cause });
  }
}

function validationMessage(error) {
  const issues = error?.issues || error?.errors;
  if (Array.isArray(issues)) {
    return issues.slice(0, 8).map((issue) => `${issue.path?.join('.') || 'root'}: ${issue.message}`).join('; ');
  }
  // A domain rule ("this id is not in the catalog") is the most useful repair
  // hint we have. Forward it verbatim rather than a generic schema complaint.
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  return message ? message.slice(0, 600) : 'The result did not match the required JSON schema.';
}

/** A wait that a cancelled request can interrupt. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const timer = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(new CancelledError()); }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/*
 * What the provider actually said.
 *
 * This used to throw `OLLAMA_UNAVAILABLE` with "Ollama could not complete the
 * request" for every non-2xx and *discard the response body* — which is the one
 * place the reason lives. An operator watching the log saw four identical
 * `OLLAMA_UNAVAILABLE` lines and had nothing to act on: a quota that will clear
 * in a minute, a key without access to the model, and a model name with a typo
 * in it all looked the same.
 *
 * So the body is read, bounded, and carried; and the three cases an operator can
 * actually do something about get their own code and their own sentence.
 */
async function providerRefusal(response, config) {
  let detail = '';
  try {
    // Bounded: an HTML error page from a proxy would otherwise become the message.
    const body = (await response.text()).slice(0, 800).trim();
    if (body) {
      try {
        const parsed = JSON.parse(body);
        detail = typeof parsed?.error === 'string' ? parsed.error : (parsed?.error?.message || parsed?.message || '');
      } catch { detail = body; }
    }
  } catch { /* a body that will not read is not worth failing over */ }
  detail = String(detail).replace(/\s+/g, ' ').slice(0, 300);

  const retryAfter = Number(response.headers?.get?.('retry-after')) || 0;
  const said = detail ? ` The provider said: ${detail}` : '';
  const model = config.ollamaModel;

  if (response.status === 429) {
    return new BriefBrainError('OLLAMA_RATE_LIMITED',
      `Ollama Cloud is rate limiting this key${retryAfter ? `; try again in about ${retryAfter}s` : '; try again shortly'}.${said}`,
      { status: 503, details: { status: 429, retryAfter: retryAfter || undefined, provider: detail || undefined } });
  }
  if (response.status === 401 || response.status === 403) {
    return new BriefBrainError('OLLAMA_FORBIDDEN',
      `Ollama Cloud refused this key for ${model}. Check the key, the subscription, and whether the key has access to that model.${said}`,
      { status: 503, details: { status: response.status, provider: detail || undefined } });
  }
  if (response.status === 404) {
    return new BriefBrainError('OLLAMA_MODEL_NOT_FOUND',
      `Ollama Cloud does not have a model called ${model}. Check OLLAMA_MODEL against the list the account can use.${said}`,
      { status: 503, details: { status: 404, model, provider: detail || undefined } });
  }
  return new BriefBrainError('OLLAMA_UNAVAILABLE',
    `Ollama Cloud answered ${response.status}.${said}`,
    { status: 503, details: { status: response.status, provider: detail || undefined } });
}

/**
 * Sole AI adapter. The browser never chooses a model or receives the API key;
 * every call uses exactly config.ollamaModel.
 */
export function createOllamaProvider({ config, fetchImpl = globalThis.fetch, logger } = {}) {
  if (!config) throw new Error('Ollama provider requires server configuration.');
  const base = config.ollamaBaseUrl.replace(/\/$/, '');

  function assertConfigured() {
    if (!isLoopbackOllama(base) && !config.ollamaApiKey) {
      throw new BriefBrainError('OLLAMA_NOT_CONFIGURED', 'Ollama is not configured on this server.', { status: 503 });
    }
  }

  async function rawRequest(path, init, { signal } = {}) {
    assertConfigured();
    const deadline = timeoutSignal(signal, config.ollamaTimeoutMs);
    try {
      const response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { ...requestHeaders(config), ...init.headers },
        signal: deadline.signal,
      });
      if (!response.ok) throw await providerRefusal(response, config);
      return await response.json();
    } catch (error) {
      if (deadline.timedOut()) throw new BriefBrainError('OLLAMA_TIMEOUT', 'Ollama took too long to respond.', { status: 504, cause: error });
      if (signal?.aborted || error?.name === 'AbortError') throw new CancelledError();
      if (error instanceof BriefBrainError) throw error;
      throw new BriefBrainError('OLLAMA_UNAVAILABLE', 'Ollama could not be reached.', { status: 503, cause: error });
    } finally {
      deadline.dispose();
    }
  }

  async function status() {
    const configured = isLoopbackOllama(base) || Boolean(config.ollamaApiKey);
    if (!configured) return { provider: 'ollama', model: config.ollamaModel, configured: false, available: false };
    try {
      const payload = await rawRequest('/tags', { method: 'GET' });
      const models = Array.isArray(payload.models) ? payload.models : [];
      const names = models.map((model) => model.name).filter(Boolean);
      // Some hosted endpoints do not expose /tags. A successful probe still
      // means the service is reachable; the chat request remains authoritative.
      return {
        provider: 'ollama',
        model: config.ollamaModel,
        configured: true,
        available: true,
        modelAvailable: names.length === 0 || names.includes(config.ollamaModel),
      };
    } catch (error) {
      logger?.warn('ollama_status_unavailable', { code: error.code });
      return { provider: 'ollama', model: config.ollamaModel, configured: true, available: false, modelAvailable: false };
    }
  }

  function numPredict(maxTokens) {
    const requested = Number.isInteger(maxTokens) ? maxTokens : config.ollamaNumPredict;
    if (!Number.isInteger(requested)) return {};
    // A generous ceiling keeps one long page draft from being truncated while
    // still bounding a runaway response.
    return { num_predict: Math.max(256, Math.min(8_192, requested)) };
  }

  async function chatOnce({ systemPrompt, userPrompt, jsonSchema, images = [], maxTokens, signal }) {
    const payload = await rawRequest('/chat', {
      method: 'POST',
      body: JSON.stringify({
        model: config.ollamaModel,
        stream: false,
        format: jsonSchema,
        options: { temperature: 0, ...numPredict(maxTokens) },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt, images: images.map((image) => Buffer.from(image).toString('base64')) },
        ],
      }),
    }, { signal });
    return parseStrictJson(payload?.message?.content ?? payload?.response);
  }

  async function generateJson({ systemPrompt, userPrompt, jsonSchema, images, maxTokens, validate, signal }) {
    let repair = null;
    let lastError;
    for (let attempt = 1; attempt <= config.aiAttempts; attempt += 1) {
      if (signal?.aborted) throw new CancelledError();
      try {
        const prompt = repair
          ? `${userPrompt}\n\nYour previous result failed validation. Return the complete JSON object again, with no markdown. Validation errors: ${repair}`
          : userPrompt;
        const value = await chatOnce({ systemPrompt, userPrompt: prompt, jsonSchema, images, maxTokens, signal });
        return validate ? await validate(value) : value;
      } catch (error) {
        if (error instanceof CancelledError || signal?.aborted) throw new CancelledError();
        lastError = error;
        const malformed = error?.code === 'OLLAMA_INVALID_JSON' || error?.name === 'ZodError' || error?.code === 'SCHEMA_INVALID';
        /*
         * A blip is not a verdict.
         *
         * A single rate-limit or a transient 5xx used to end the whole run: the
         * job degraded to the built-in planner and the operator saw four
         * identical failures for what was a moment's congestion. Those are worth
         * one more try after a wait; a refused key and a missing model are not,
         * because waiting does not fix either.
         */
        const transient = error?.code === 'OLLAMA_RATE_LIMITED'
          || (error?.code === 'OLLAMA_UNAVAILABLE' && Number(error?.details?.status) >= 500);
        if (attempt >= config.aiAttempts || (!malformed && !transient)) break;
        if (transient) {
          const waitMs = Math.min(8_000, (Number(error?.details?.retryAfter) || attempt) * 1_000);
          logger?.warn('ollama_retrying', { code: error.code, status: error?.details?.status, attempt, waitMs });
          await sleep(waitMs, signal);
          repair = null;
          continue;
        }
        repair = validationMessage(error);
      }
    }
    if (lastError?.name === 'ZodError') {
      throw new BriefBrainError('OLLAMA_SCHEMA_INVALID', 'Ollama returned a result outside the required schema.', { status: 502, cause: lastError });
    }
    throw lastError;
  }

  return Object.freeze({
    kind: 'ollama',
    model: config.ollamaModel,
    status,
    generateJson,
  });
}
