import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../handlers/user/block.handler';
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
    path: `/identity/users/${userId ?? ''}/account/block`,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '',
  }) as APIGatewayProxyEvent;

describe('user/block handler', () => {
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
    expect(body.operation).toBe('user_block');
    expect(body.status).toBe('failed');
  });

  it('calls users.update with blocked:true and returns 200 on success', async () => {
    mockUsersUpdate.mockResolvedValueOnce({});

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    // Auth0 Management API returns 200 User successfully updated
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      operation: string;
      status: string;
      userId: string;
      affectedCount?: number;
    };
    expect(body.operation).toBe('user_block');
    expect(body.status).toBe('success');
    expect(body.userId).toBe('auth0|test-user-123');
    // API returns the updated user object, not a count
    expect(body.affectedCount).toBeUndefined();
    expect(mockUsersUpdate).toHaveBeenCalledWith(
      { id: 'auth0|test-user-123' },
      { blocked: true },
    );
  });

  it('returns 500 with retryable=false on 400 invalid request body error', async () => {
    mockUsersUpdate.mockRejectedValueOnce(new Error('400 Invalid request body'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(false);
  });

  it('returns 500 with retryable=false on 401 invalid token error', async () => {
    mockUsersUpdate.mockRejectedValueOnce(new Error('401 Invalid token'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(false);
  });

  it('returns 500 with retryable=false on 401 client is not global error', async () => {
    mockUsersUpdate.mockRejectedValueOnce(new Error('401 Client is not global'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(false);
  });

  it('returns 500 with retryable=false on 403 insufficient scope error', async () => {
    mockUsersUpdate.mockRejectedValueOnce(
      new Error('403 Insufficient scope; expected any of: update:users,update:users_app_metadata,update:current_user_metadata'),
    );

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(false);
  });

  it('returns 500 with retryable=false on 403 subject mismatch error', async () => {
    mockUsersUpdate.mockRejectedValueOnce(
      new Error('403 User to be acted on does not match subject in bearer token'),
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
    mockUsersUpdate.mockRejectedValueOnce(new Error('User not found'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(false);
  });

  it('returns 503 with retryable=true on 429 rate-limit error', async () => {
    mockUsersUpdate.mockRejectedValueOnce(new Error('429 Too Many Requests'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(true);
  });

  it('returns 503 with retryable=true on 5xx server error', async () => {
    mockUsersUpdate.mockRejectedValueOnce(new Error('503 Service Unavailable'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
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
