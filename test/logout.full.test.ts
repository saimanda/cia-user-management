import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../handlers/logout/full.handler';

const makeEvent = (userId?: string): APIGatewayProxyEvent =>
  ({
    pathParameters: userId ? { userId } : null,
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: `/identity/users/${userId ?? ''}/logout/full`,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '',
  }) as APIGatewayProxyEvent;

const okFetch = (operation = 'op') =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        operation,
        userId: 'auth0|test-user-123',
        status: 'success',
        timestamp: new Date().toISOString(),
      }),
  });

const failFetch = (operation = 'op', reason = 'error') =>
  Promise.resolve({
    ok: false,
    json: () =>
      Promise.resolve({
        operation,
        userId: 'auth0|test-user-123',
        status: 'failed',
        reason,
        retryable: true,
        timestamp: new Date().toISOString(),
      }),
  });

describe('logout/full handler', () => {
  const API_BASE_URL = 'https://test.execute-api.ap-southeast-2.amazonaws.com/dev/';
  const userId = 'auth0|test-user-123';

  beforeEach(() => {
    process.env.API_BASE_URL = API_BASE_URL;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.API_BASE_URL;
    jest.restoreAllMocks();
  });

  // ── Guard rails ─────────────────────────────────────────────────────────────

  it('returns 400 when userId is missing', async () => {
    const response = await handler(makeEvent(), {} as never, () => undefined);
    if (!response) throw new Error('No response');
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { status: string };
    expect(body.status).toBe('failed');
  });

  it('returns 500 when API_BASE_URL is not set', async () => {
    delete process.env.API_BASE_URL;
    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    if (!response) throw new Error('No response');
    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { reason: string };
    expect(body.reason).toMatch(/API_BASE_URL/);
  });

  // ── Happy path ───────────────────────────────────────────────────────────────
  // sessions → tokens → scramble (ok) → block SKIPPED → email
  // fetch calls: 4

  it('returns 200 when all steps succeed; block is skipped when scramble succeeds', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch()) as jest.Mock;

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { operation: string; status: string; affectedCount: number };
    expect(body.operation).toBe('logout_full');
    expect(body.status).toBe('success');
    expect(body.affectedCount).toBe(4); // sessions, tokens, scramble, email (block skipped)
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  // ── Scramble fails → block fallback ─────────────────────────────────────────
  // sessions (ok) → tokens (ok) → scramble (fail) → block (ok) → email (ok)
  // fetch calls: 5

  it('invokes block as fallback when scramble-password fails, then sends email', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      // call 3 = scramble-password → fail; all others succeed
      return callCount === 3 ? failFetch('user_scramble_password', 'connection error') : okFetch();
    }) as jest.Mock;

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(207);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.status).toBe('partial');
    // sessions, tokens, block, email succeeded (4); scramble failed (1)
    expect(body.affectedCount).toBe(4);
    expect(global.fetch).toHaveBeenCalledTimes(5); // all 5 invoked
  });

  // ── Scramble fails, block also fails → email skipped ────────────────────────
  // sessions (ok) → tokens (ok) → scramble (fail) → block (fail) → email SKIPPED
  // fetch calls: 4

  it('skips email when both scramble-password and block fail', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      // calls 3 (scramble) and 4 (block) fail; sessions and tokens succeed
      return callCount >= 3 ? failFetch() : okFetch();
    }) as jest.Mock;

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(207);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.status).toBe('partial');
    expect(body.affectedCount).toBe(2); // sessions, tokens
    expect(global.fetch).toHaveBeenCalledTimes(4); // email NOT called
  });

  // ── All steps fail → 500 ─────────────────────────────────────────────────────
  // sessions (fail) → tokens (fail) → scramble (fail) → block (fail) → email SKIPPED
  // fetch calls: 4

  it('returns 500 when all invoked steps fail', async () => {
    global.fetch = jest.fn().mockResolvedValue(failFetch('op', 'downstream error')) as jest.Mock;

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(4); // email skipped
  });

  // ── Network error on sessions → partial ──────────────────────────────────────
  // sessions (network error) → tokens (ok) → scramble (ok) → block SKIPPED → email (ok)
  // fetch calls: 4

  it('handles a network error on sessions gracefully and continues', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('Network failure'));
      return okFetch();
    }) as jest.Mock;

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(207);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.status).toBe('partial');
    expect(body.affectedCount).toBe(3); // tokens, scramble, email
    expect(global.fetch).toHaveBeenCalledTimes(4); // block skipped (scramble ok)
  });

  // ── Console log summary ───────────────────────────────────────────────────────

  it('logs a summary of all invoked steps', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch()) as jest.Mock;

    await handler(makeEvent(userId), {} as never, () => undefined);

    expect(console.log).toHaveBeenCalledTimes(1);
    const logArg = (console.log as jest.Mock).mock.calls[0][0] as string;
    expect(logArg).toMatch(/logout\/full/);
    expect(logArg).toMatch(/sessions_revoke/);
    expect(logArg).toMatch(/tokens_revoke/);
    expect(logArg).toMatch(/user_scramble_password/);
    expect(logArg).toMatch(/notifications_password_email/);
    // block was skipped (scramble succeeded)
    expect(logArg).not.toMatch(/user_block/);
  });

  it('logs user_block in summary when scramble-password fails', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      return callCount === 3 ? failFetch('user_scramble_password') : okFetch();
    }) as jest.Mock;

    await handler(makeEvent(userId), {} as never, () => undefined);

    const logArg = (console.log as jest.Mock).mock.calls[0][0] as string;
    expect(logArg).toMatch(/user_block/);
  });
});
