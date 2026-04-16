import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../handlers/user/scramble-password.handler';
import * as auth0Client from '../shared/auth0-client';
import { resetAuth0ClientCache } from '../shared/auth0-client';

jest.mock('../shared/auth0-client');

const mockUsersUpdate = jest.fn();

const mockManagement = {
  users: {
    update: mockUsersUpdate,
  },
};

const makeEvent = (userId?: string): APIGatewayProxyEvent =>
  ({
    pathParameters: userId ? { userId } : null,
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: `/identity/users/${userId ?? ''}/account/scramble-password`,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '',
  }) as APIGatewayProxyEvent;

describe('user/scramble-password handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetAuth0ClientCache();
    jest.spyOn(auth0Client, 'getAuth0Client').mockResolvedValue(mockManagement as never);
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetAllMocks();
  });

  it('returns 400 when userId is missing', async () => {
    const response = await handler(makeEvent(), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { operation: string; status: string };
    expect(body.operation).toBe('user_scramble_password');
    expect(body.status).toBe('failed');
  });

  it('calls users.update with a random password and default connection, returns 200', async () => {
    delete process.env.AUTH0_CONNECTION;
    mockUsersUpdate.mockResolvedValueOnce({});

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      operation: string;
      status: string;
      userId: string;
      affectedCount?: number;
    };
    expect(body.operation).toBe('user_scramble_password');
    expect(body.status).toBe('success');
    expect(body.userId).toBe('auth0|test-user-123');
    expect(body.affectedCount).toBeUndefined();

    expect(mockUsersUpdate).toHaveBeenCalledTimes(1);
    const [pathParam, bodyParam] = mockUsersUpdate.mock.calls[0] as [
      { id: string },
      { password: string; connection: string },
    ];
    expect(pathParam).toEqual({ id: 'auth0|test-user-123' });
    expect(bodyParam.connection).toBe('NewsCorp-Australia');
    // Password must be a non-empty string — random, so just validate shape
    expect(typeof bodyParam.password).toBe('string');
    expect(bodyParam.password.length).toBeGreaterThan(0);
  });

  it('uses AUTH0_CONNECTION env var when set', async () => {
    process.env.AUTH0_CONNECTION = 'NewsCorp-Dev';
    mockUsersUpdate.mockResolvedValueOnce({});

    await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);

    const [, bodyParam] = mockUsersUpdate.mock.calls[0] as [
      { id: string },
      { password: string; connection: string },
    ];
    expect(bodyParam.connection).toBe('NewsCorp-Dev');
  });

  it('generates a different password on each invocation', async () => {
    mockUsersUpdate.mockResolvedValue({});

    await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);

    const pass1 = (mockUsersUpdate.mock.calls[0] as [{ id: string }, { password: string }])[1]
      .password;
    const pass2 = (mockUsersUpdate.mock.calls[1] as [{ id: string }, { password: string }])[1]
      .password;
    expect(pass1).not.toBe(pass2);
  });

  it('returns 500 with retryable=false on 400 invalid request body error', async () => {
    mockUsersUpdate.mockRejectedValueOnce(new Error('400 Invalid request body'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(false);
  });

  it('returns 500 with retryable=false on 401 invalid token error', async () => {
    mockUsersUpdate.mockRejectedValueOnce(new Error('401 Invalid token'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(false);
  });

  it('returns 500 with retryable=false on 403 insufficient scope error', async () => {
    mockUsersUpdate.mockRejectedValueOnce(
      new Error('403 Insufficient scope; expected any of: update:users,update:users_app_metadata'),
    );

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(false);
  });

  it('returns 500 with retryable=false on 404 user not found error', async () => {
    mockUsersUpdate.mockRejectedValueOnce(new Error('User not found'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(false);
  });

  it('returns 503 with retryable=true on 429 rate-limit error', async () => {
    mockUsersUpdate.mockRejectedValueOnce(new Error('429 Too Many Requests'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(true);
  });

  it('returns 503 with retryable=true on 5xx server error', async () => {
    mockUsersUpdate.mockRejectedValueOnce(new Error('503 Service Unavailable'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(true);
  });

  it('response body always includes a timestamp', async () => {
    mockUsersUpdate.mockResolvedValueOnce({});

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    if (!response) throw new Error('No response');
    const body = JSON.parse(response.body) as { timestamp: string };
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
