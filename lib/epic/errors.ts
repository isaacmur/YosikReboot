/** A non-2xx response from an Epic service. */
export class EpicHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly errorCode?: string,
    message?: string,
  ) {
    super(message ?? `Epic responded ${status}${errorCode ? ` (${errorCode})` : ''}`);
    this.name = 'EpicHttpError';
  }
}

/** Epic services usually answer errors with `{ errorCode, errorMessage }`. */
export function parseEpicError(body: unknown): { errorCode?: string; errorMessage?: string } {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    return {
      errorCode: typeof b.errorCode === 'string' ? b.errorCode : undefined,
      errorMessage: typeof b.errorMessage === 'string' ? b.errorMessage : undefined,
    };
  }
  return {};
}

