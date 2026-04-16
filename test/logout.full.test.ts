import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../handlers/logout/full.handler';

const makeEvent = (userId?: string, body?: object): APIGatewayProxyEvent =>
  ({
    pathParameters: userId ? { userId } : null,
    body: body ? JSON.stringify(body) : null,
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

  // ── Default behaviour (no flags) ─────────────────────────────────────────────
  // sessions → tokens → scramble (ok) → block SKIPPED → email
  // fetch calls: 4

  it('runs full pipeline by default when no flags provided', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch()) as jest.Mock;

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.status).toBe('success');
    expect(body.affectedCount).toBe(4); // sessions, tokens, scramble, email
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it('runs full pipeline when both flags explicitly set to false', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch()) as jest.Mock;

    const response = await handler(
      makeEvent(userId, { skipScramblePassword: false, skipNotification: false }),
      {} as never,
      () => undefined,
    );
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  // ── skipScramblePassword=true ────────────────────────────────────────────────
  // sessions → tokens → scramble SKIPPED → block SKIPPED → email SKIPPED
  // fetch calls: 2

  it('skips scramble, block, and email when skipScramblePassword=true', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch()) as jest.Mock;

    const response = await handler(
      makeEvent(userId, { skipScramblePassword: true }),
      {} as never,
      () => undefined,
    );
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.status).toBe('success');
    expect(body.affectedCount).toBe(2); // sessions, tokens only
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('skipScramblePassword=true still returns 500 if sessions and tokens both fail', async () => {
    global.fetch = jest.fn().mockResolvedValue(failFetch()) as jest.Mock;

    const response = await handler(
      makeEvent(userId, { skipScramblePassword: true }),
      {} as never,
      () => undefined,
    );
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  // ── skipNotification=true ────────────────────────────────────────────────────
  // sessions → tokens → scramble (ok) → block SKIPPED → email SKIPPED
  // fetch calls: 3

  it('skips email only when skipNotification=true and scramble succeeds', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch()) as jest.Mock;

    const response = await handler(
      makeEvent(userId, { skipNotification: true }),
      {} as never,
      () => undefined,
    );
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.status).toBe('success');
    expect(body.affectedCount).toBe(3); // sessions, tokens, scramble
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('skipNotification=true with scramble fail triggers block but still skips email', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      return callCount === 3 ? failFetch('user_scramble_password') : okFetch();
    }) as jest.Mock;

    const response = await handler(
      makeEvent(userId, { skipNotification: true }),
      {} as never,
      () => undefined,
    );
    if (!response) throw new Error('No response');

    // sessions(ok), tokens(ok), scramble(fail), block(ok) — email skipped
    expect(response.statusCode).toBe(207);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.affectedCount).toBe(3); // sessions, tokens, block
    expect(global.fetch).toHaveBeenCalledTimes(4); // email NOT called
  });

  // ── Scramble fails → block fallback (default behaviour) ──────────────────────
  // sessions (ok) → tokens (ok) → scramble (fail) → block (ok) → email (ok)
  // fetch calls: 5

  it('invokes block as fallback when scramble fails, then sends email', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      return callCount === 3 ? failFetch('user_scramble_password', 'connection error') : okFetch();
    }) as jest.Mock;

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(207);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.status).toBe('partial');
    expect(body.affectedCount).toBe(4); // sessions, tokens, block, email
    expect(global.fetch).toHaveBeenCalledTimes(5);
  });

  it('skips email when both scramble and block fail', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      return callCount >= 3 ? failFetch() : okFetch();
    }) as jest.Mock;

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(207);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.affectedCount).toBe(2); // sessions, tokens
    expect(global.fetch).toHaveBeenCalledTimes(4); // email NOT called
  });

  it('returns 500 when all invoked steps fail', async () => {
    global.fetch = jest.fn().mockResolvedValue(failFetch('op', 'downstream error')) as jest.Mock;

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    expect(global.fetch).toHaveBeenCalledTimes(4); // email skipped
  });

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
    expect(body.affectedCount).toBe(3); // tokens, scramble, email
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  // ── Console log summary ───────────────────────────────────────────────────────

  it('logs all invoked steps in summary', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch()) as jest.Mock;

    await handler(makeEvent(userId), {} as never, () => undefined);

    const logArg = (console.log as jest.Mock).mock.calls[0][0] as string;
    expect(logArg).toMatch(/sessions_revoke/);
    expect(logArg).toMatch(/tokens_revoke/);
    expect(logArg).toMatch(/user_scramble_password/);
    expect(logArg).toMatch(/notifications_password_email/);
    expect(logArg).not.toMatch(/user_block/);
  });

  it('logs skipped steps when skipScramblePassword=true', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch()) as jest.Mock;

    await handler(makeEvent(userId, { skipScramblePassword: true }), {} as never, () => undefined);

    const logArg = (console.log as jest.Mock).mock.calls[0][0] as string;
    expect(logArg).toMatch(/skipped/);
    expect(logArg).toMatch(/user_scramble_password/);
    expect(logArg).toMatch(/notifications_password_email/);
  });

  it('logs skipped notification when skipNotification=true', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch()) as jest.Mock;

    await handler(makeEvent(userId, { skipNotification: true }), {} as never, () => undefined);

    const logArg = (console.log as jest.Mock).mock.calls[0][0] as string;
    expect(logArg).toMatch(/skipped/);
    expect(logArg).toMatch(/notifications_password_email/);
  });

  it('handles malformed request body gracefully and uses defaults', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch()) as jest.Mock;

    const event = makeEvent(userId);
    (event as { body: string }).body = 'not-valid-json';

    const response = await handler(event, {} as never, () => undefined);
    if (!response) throw new Error('No response');

    // Falls back to defaults — full pipeline runs
    expect(response.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });
});
