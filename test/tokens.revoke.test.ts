import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../handlers/tokens/revoke.handler';
import * as auth0Client from '../shared/auth0-client';
import { resetAuth0ClientCache } from '../shared/auth0-client';

jest.mock('../shared/auth0-client');

const mockDeleteRefreshTokens = jest.fn();

const mockManagement = {
  users: {
    deleteRefreshTokens: mockDeleteRefreshTokens,
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
    path: `/identity/users/${userId ?? ''}/tokens/revoke`,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '',
  }) as APIGatewayProxyEvent;

describe('tokens/revoke handler', () => {
  beforeEach(() => {
    resetAuth0ClientCache();
    jest.spyOn(auth0Client, 'getAuth0Client').mockResolvedValue(mockManagement as never);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns 400 when userId is missing', async () => {
    const response = await handler(makeEvent(), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { operation: string; status: string };
    expect(body.operation).toBe('tokens_revoke');
    expect(body.status).toBe('failed');
  });

  it('calls deleteRefreshTokens with user_id and returns 202 on success', async () => {
    mockDeleteRefreshTokens.mockResolvedValueOnce({});

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    // Auth0 Management API returns 202 Accepted (async deletion)
    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body) as {
      operation: string;
      status: string;
      userId: string;
      affectedCount?: number;
    };
    expect(body.operation).toBe('tokens_revoke');
    expect(body.status).toBe('success');
    expect(body.userId).toBe('auth0|test-user-123');
    // API returns no body — affectedCount must not be present
    expect(body.affectedCount).toBeUndefined();
    expect(mockDeleteRefreshTokens).toHaveBeenCalledWith({ user_id: 'auth0|test-user-123' });
  });

  it('returns 503 with retryable=true on rate-limit error (429)', async () => {
    mockDeleteRefreshTokens.mockRejectedValueOnce(new Error('429 Too Many Requests'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(true);
  });

  it('returns 500 with retryable=false on 400 invalid request error', async () => {
    mockDeleteRefreshTokens.mockRejectedValueOnce(new Error('400 Invalid request URI'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(false);
  });

  it('returns 500 with retryable=false on 401 invalid token error', async () => {
    mockDeleteRefreshTokens.mockRejectedValueOnce(new Error('401 Invalid token'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(false);
  });

  it('returns 500 with retryable=false on 403 insufficient scope error', async () => {
    mockDeleteRefreshTokens.mockRejectedValueOnce(
      new Error('403 Insufficient scope; expected: delete:refresh_tokens'),
    );

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(false);
  });

  it('returns 500 with retryable=false on 404 user not found error', async () => {
    mockDeleteRefreshTokens.mockRejectedValueOnce(new Error('User not found'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(false);
  });

  it('returns 503 with retryable=true on 5xx server error', async () => {
    mockDeleteRefreshTokens.mockRejectedValueOnce(new Error('503 Service Unavailable'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(true);
  });

  it('response body always includes a timestamp', async () => {
    mockDeleteRefreshTokens.mockResolvedValueOnce({});

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    if (!response) throw new Error('No response');
    const body = JSON.parse(response.body) as { timestamp: string };
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
