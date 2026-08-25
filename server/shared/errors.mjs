/** Single error shape for every server feature. `code` is the client contract. */
export class BriefBrainError extends Error {
  constructor(code, message, { status = 400, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BriefBrainError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class CancelledError extends BriefBrainError {
  constructor(message = 'The request was cancelled.') {
    super('REQUEST_CANCELLED', message, { status: 409 });
    this.name = 'CancelledError';
  }
}

export function asBriefBrainError(error) {
  if (error instanceof BriefBrainError) return error;
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    return new BriefBrainError(error.code, typeof error.message === 'string' ? error.message : 'The request could not complete.', {
      status: Number.isInteger(error.status) ? error.status : 500,
      details: error.details,
      cause: error,
    });
  }
  if (error?.name === 'AbortError') return new CancelledError();
  return new BriefBrainError('INTERNAL_ERROR', 'The request could not complete.', { status: 500, cause: error });
}

export function errorPayload(error, { exposeDetails = false } = {}) {
  const normalized = asBriefBrainError(error);
  const payload = {
    error: {
      code: normalized.code,
      // A 5xx message can carry provider internals; never forward it verbatim.
      message: normalized.status >= 500 ? 'The request could not complete.' : normalized.message,
    },
  };
  if (exposeDetails && normalized.details !== undefined) payload.error.details = normalized.details;
  return payload;
}
