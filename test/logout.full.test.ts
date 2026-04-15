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

const successBody = (operation: string, userId: string) =>
  JSON.stringify({ operation, userId, status: 'success', affectedCount: 1, timestamp: new Date().toISOString() });

const failedBody = (operation: string, userId: string, reason: string) =>
  JSON.stringify({ operation, userId, status: 'failed', reason, retryable: true, timestamp: new Date().toISOString() });

describe('logout/full handler', () => {
  const API_BASE_URL = 'https://test.execute-api.ap-southeast-2.amazonaws.com/dev/';
  const userId = 'auth0|test-user-123';

  beforeEach(() => {
    process.env.API_BASE_URL = API_BASE_URL;
  });

  afterEach(() => {
    delete process.env.API_BASE_URL;
    jest.restoreAllMocks();
  });

  it('returns 400 when userId is missing', async () => {
    const response = await handler(makeEvent(), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { status: string };
    expect(body.status).toBe('failed');
  });

  it('returns 500 when API_BASE_URL env var is not set', async () => {
    delete process.env.API_BASE_URL;

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');
    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { reason: string };
    expect(body.reason).toMatch(/API_BASE_URL/);
  });

  it('returns 200 when all 4 inner calls succeed', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(JSON.parse(successBody('sessions_revoke', userId))),
    }) as jest.Mock;

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { operation: string; status: string; affectedCount: number };
    expect(body.operation).toBe('logout_full');
    expect(body.status).toBe('success');
    expect(body.affectedCount).toBe(4);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it('returns 207 partial when some inner calls fail', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(JSON.parse(successBody('op', userId))),
        });
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve(JSON.parse(failedBody('op', userId, 'error'))),
      });
    }) as jest.Mock;

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(207);
    const body = JSON.parse(response.body) as { status: string; affectedCount: number };
    expect(body.status).toBe('partial');
    expect(body.affectedCount).toBe(2);
  });

  it('returns 500 when all inner calls fail', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve(JSON.parse(failedBody('op', userId, 'downstream error'))),
    }) as jest.Mock;

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(true);
  });

  it('handles fetch network errors gracefully (partial)', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('Network failure'));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(JSON.parse(successBody('op', userId))),
      });
    }) as jest.Mock;

    const response = await handler(makeEvent(userId), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(207);
    const body = JSON.parse(response.body) as { status: string };
    expect(body.status).toBe('partial');
  });
});
