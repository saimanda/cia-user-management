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
  // skipBlockUser=true, skipNotification=false
  // steps: sessions & tokens (parallel) → scramble → email
  // fetch calls: 4

  it('runs full pipeline by default when no flags provided', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch());

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.status).toBe('success');
    expect(body.affectedCount).toBe(4); // sessions, tokens, scramble, email
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it('runs full pipeline when skipNotification explicitly set to false', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch());

    const response = await handler(
      makeEvent(userId, { skipNotification: false }),
      {} as never,
      () => undefined,
    );
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  // ── skipBlockUser=false — block runs FIRST ────────────────────────────────────
  // steps: block → sessions & tokens (parallel) → scramble → email
  // fetch calls: 5

  it('runs block as step 0 when skipBlockUser=false, then full pipeline', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch());

    const response = await handler(
      makeEvent(userId, { skipBlockUser: false }),
      {} as never,
      () => undefined,
    );
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.status).toBe('success');
    expect(body.affectedCount).toBe(5); // block, sessions, tokens, scramble, email
    expect(global.fetch).toHaveBeenCalledTimes(5);
  });

  it('continues pipeline even if block step fails when skipBlockUser=false', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1 ? failFetch('user_block', 'block failed') : okFetch();
    });

    const response = await handler(
      makeEvent(userId, { skipBlockUser: false }),
      {} as never,
      () => undefined,
    );
    if (!response) throw new Error('No response');

    // block(fail), sessions(ok), tokens(ok), scramble(ok), email(ok) → partial
    expect(response.statusCode).toBe(207);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.status).toBe('partial');
    expect(body.affectedCount).toBe(4); // sessions, tokens, scramble, email
    expect(global.fetch).toHaveBeenCalledTimes(5);
  });

  // ── skipNotification=true ────────────────────────────────────────────────────
  // steps: sessions & tokens (parallel) → scramble (ok) — email skipped
  // fetch calls: 3

  it('skips email only when skipNotification=true and scramble succeeds', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch());

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

  it('skips email when skipNotification=true and scramble fails', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      // calls 1+2 are sessions+tokens (parallel), call 3 is scramble
      return callCount === 3 ? failFetch('user_scramble_password', 'connection error') : okFetch();
    });

    const response = await handler(
      makeEvent(userId, { skipNotification: true }),
      {} as never,
      () => undefined,
    );
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(207);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.affectedCount).toBe(2); // sessions, tokens
    expect(global.fetch).toHaveBeenCalledTimes(3); // email NOT called
  });

  // ── Scramble fails — email skipped ────────────────────────────────────────────
  // sessions & tokens (parallel, ok) → scramble (fail) → email skipped
  // fetch calls: 3

  it('skips email when scramble fails', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      return callCount === 3 ? failFetch('user_scramble_password', 'connection error') : okFetch();
    });

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(207);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.status).toBe('partial');
    expect(body.affectedCount).toBe(2); // sessions, tokens
    expect(global.fetch).toHaveBeenCalledTimes(3); // no email
  });

  // ── All steps fail ────────────────────────────────────────────────────────────
  // sessions(fail) & tokens(fail) → scramble(fail) → email skipped
  // fetch calls: 3

  it('returns 500 when all invoked steps fail', async () => {
    global.fetch = jest.fn().mockResolvedValue(failFetch('op', 'downstream error'));

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    expect(global.fetch).toHaveBeenCalledTimes(3); // email skipped (scramble failed)
  });

  it('handles a network error on sessions gracefully and continues', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('Network failure'));
      return okFetch();
    });

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(207);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.affectedCount).toBe(3); // tokens, scramble, email
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  // ── Console log summary ───────────────────────────────────────────────────────

  it('logs all invoked steps and user_block as skipped by default', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch());

    await handler(makeEvent(userId), {} as never, () => undefined);

    const logArg = ((console.log as jest.Mock).mock.calls as string[][])[0][0];
    expect(logArg).toMatch(/sessions_revoke/);
    expect(logArg).toMatch(/tokens_revoke/);
    expect(logArg).toMatch(/user_scramble_password/);
    expect(logArg).toMatch(/notifications_password_email/);
    expect(logArg).toMatch(/user_block.*skipped/);
  });

  it('logs block as invoked when skipBlockUser=false', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch());

    await handler(makeEvent(userId, { skipBlockUser: false }), {} as never, () => undefined);

    const logArg = ((console.log as jest.Mock).mock.calls as string[][])[0][0];
    expect(logArg).toMatch(/user_block/);
    expect(logArg).not.toMatch(/user_block.*skipped/);
  });

  it('logs skipped notification when skipNotification=true', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch());

    await handler(makeEvent(userId, { skipNotification: true }), {} as never, () => undefined);

    const logArg = ((console.log as jest.Mock).mock.calls as string[][])[0][0];
    expect(logArg).toMatch(/skipped/);
    expect(logArg).toMatch(/notifications_password_email/);
  });

  it('handles malformed request body gracefully and uses defaults', async () => {
    global.fetch = jest.fn().mockResolvedValue(okFetch());

    const event = makeEvent(userId);
    (event as { body: string }).body = 'not-valid-json';

    const response = await handler(event, {} as never, () => undefined);
    if (!response) throw new Error('No response');

    // Falls back to defaults — block skipped, scramble+email run
    expect(response.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });
});
