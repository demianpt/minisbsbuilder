const BASE = '/api/brief';

export class BriefBrainApiError extends Error {
  constructor(code, message, { status = 0, details } = {}) {
    super(message);
    this.name = 'BriefBrainApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Plain-language messages. A strategist never needs to read an error code. */
const MESSAGES = Object.freeze({
  OLLAMA_NOT_CONFIGURED: 'The AI model is not set up on this machine. The built-in planner will answer instead.',
  OLLAMA_UNAVAILABLE: 'The AI model could not be reached. Check the connection, or use the built-in planner.',
  OLLAMA_TIMEOUT: 'The AI model took too long. Try again, or use the built-in planner.',
  RATE_LIMITED: 'Too many requests in a row. Wait a moment and try again.',
  CATALOG_REQUIRED: 'The builder could not send its pattern catalog. Reload the page and try again.',
  FAMILIES_REQUIRED: 'Choose a page flow first, then generate the content.',
  OUTLINE_REQUIRED: 'Type the sections you want before building the flow.',
  BRIEF_REQUIRED: 'Write a little more about the project — a few sentences is enough.',
  MODEL_UNSUPPORTED: 'This build cannot choose a model. Reload the page.',
  STOCK_NOT_CONFIGURED: 'Stock imagery is not set up on this machine. Add the Shutterstock credentials to .env and restart the server.',
  STOCK_UNAVAILABLE: 'Shutterstock could not complete the search. Try again in a moment.',
  STOCK_RATE_LIMITED: "Shutterstock's request limit for this account is used up. Nothing is wrong with the setup — it resets on the hour.",
  STOCK_DENIED: 'Shutterstock refused these credentials. Check the API token, or the client id and secret, in .env and restart the server.',
  STOCK_TIMEOUT: 'Shutterstock took too long to answer. Try again in a moment.',
  STOCK_EMPTY: 'The stock library found nothing for this brief. Name the subject more plainly in the brief — what would actually be in the photograph.',
  STOCK_ID_INVALID: 'That is not a Shutterstock id. Paste the number from the asset page or the whole page URL.',
  STOCK_ID_NOT_FOUND: 'Shutterstock has no image or clip with that id. Check the number on the asset page.',
  SLOTS_REQUIRED: 'This page has no picture slots to fill yet. Add a section that carries an image first.',
  ORIGIN_FORBIDDEN: 'The builder is running on an unexpected address. Start it with the documented command.',
  BODY_TOO_LARGE: 'The brief is too long to send. Shorten the internal notes.',
  NETWORK: 'The builder could not reach its local server. Start it with `npm run dev`.',
});

/*
 * Codes whose server message carries a fact this file cannot know — the hour a
 * spent quota resets, for instance. Everywhere else the map above wins, because
 * that is the whole point of it: a strategist reads plain language, not whatever
 * wording the provider happened to use. From 500 up the payload has already
 * replaced the text anyway.
 */
const SERVER_MESSAGE_CODES = new Set(['STOCK_RATE_LIMITED']);

export function normalizeApiError(error) {
  if (error instanceof BriefBrainApiError) {
    const specific = SERVER_MESSAGE_CODES.has(error.code) && error.message ? error.message : '';
    return { code: error.code, message: specific || MESSAGES[error.code] || error.message, status: error.status };
  }
  // Anything else is a fault in this build, not a network condition. Reporting
  // it as "start the server" sends the user to fix the wrong thing and hides the
  // real cause, so say what it is and log the stack.
  if (error instanceof Error && error.name !== 'TypeError') {
    console.error('Brief Brain failed', error);
    return { code: 'UNEXPECTED', message: `Something went wrong in the builder: ${error.message}`, status: 0 };
  }
  if (error instanceof Error) console.error('Brief Brain failed', error);
  return { code: 'NETWORK', message: MESSAGES.NETWORK, status: 0 };
}

async function post(path, body, { signal } = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause;
    throw new BriefBrainApiError('NETWORK', MESSAGES.NETWORK, { status: 0 });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload?.error || {};
    throw new BriefBrainApiError(error.code || 'REQUEST_FAILED', error.message || 'The request failed.', {
      status: response.status,
      details: error.details,
    });
  }
  return payload;
}

export function createBriefBrainApi({ fetchImpl } = {}) {
  const request = fetchImpl ? (path, body, options) => fetchImpl(path, body, options) : post;
  return Object.freeze({
    async status() {
      try {
        const response = await fetch(`${BASE}/status`);
        if (!response.ok) return { configured: false, available: false, model: '', media: { configured: false, available: false } };
        return await response.json();
      } catch {
        return { configured: false, available: false, model: '', media: { configured: false, available: false } };
      }
    },
    understand(payload, options) { return request('/understand', payload, options); },
    content(payload, options) { return request('/content', payload, options); },
    outline(payload, options) { return request('/outline', payload, options); },
    concepts(payload, options) { return request('/concepts', payload, options); },
    expand(payload, options) { return request('/expand', payload, options); },
    media(payload, options) { return request('/media', payload, options); },
    mediaAsset(payload, options) { return request('/media/asset', payload, options); },
  });
}

export const briefBrainApi = createBriefBrainApi();
