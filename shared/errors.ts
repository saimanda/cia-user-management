export class Auth0OperationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'Auth0OperationError';
  }
}

export class MissingParameterError extends Error {
  constructor(param: string) {
    super(`Missing required parameter: ${param}`);
    this.name = 'MissingParameterError';
  }
}

/**
 * Determines if an Auth0 or AWS error is safely retryable.
 * Rate-limit (429) and server errors (5xx) are retryable.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof Auth0OperationError) return error.retryable;
  if (error instanceof Error) {
    return /429|5\d{2}|rate.?limit|throttl|service.?unavailable/i.test(error.message);
  }
  return false;
}

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
