import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../handlers/sessions/revoke.handler';
import * as auth0Client from '../shared/auth0-client';
import { resetAuth0ClientCache } from '../shared/auth0-client';

jest.mock('../shared/auth0-client');

const mockDeleteSessions = jest.fn();

const mockManagement = {
  users: {
    deleteSessions: mockDeleteSessions,
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
    path: `/identity/users/${userId ?? ''}/sessions/revoke`,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '',
  }) as APIGatewayProxyEvent;

describe('sessions/revoke handler', () => {
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
    expect(body.operation).toBe('sessions_revoke');
    expect(body.status).toBe('failed');
  });

  it('calls deleteSessions with user_id and returns 200 on success', async () => {
    mockDeleteSessions.mockResolvedValueOnce({});

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      operation: string;
      status: string;
      userId: string;
      affectedCount: number;
    };
    expect(body.operation).toBe('sessions_revoke');
    expect(body.status).toBe('success');
    expect(body.userId).toBe('auth0|test-user-123');
    expect(body.affectedCount).toBe(1);
    expect(mockDeleteSessions).toHaveBeenCalledWith({ user_id: 'auth0|test-user-123' });
  });

  it('returns 503 with retryable=true on rate-limit error', async () => {
    mockDeleteSessions.mockRejectedValueOnce(new Error('429 Too Many Requests'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(true);
  });

  it('returns 500 with retryable=false on non-retryable error', async () => {
    mockDeleteSessions.mockRejectedValueOnce(new Error('User not found'));

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    expect(response).toBeDefined();
    if (!response) throw new Error('No response');

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { status: string; retryable: boolean };
    expect(body.status).toBe('failed');
    expect(body.retryable).toBe(false);
  });

  it('response body always includes a timestamp', async () => {
    mockDeleteSessions.mockResolvedValueOnce({});

    const response = await handler(makeEvent('auth0|test-user-123'), {} as never, () => undefined);
    if (!response) throw new Error('No response');
    const body = JSON.parse(response.body) as { timestamp: string };
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
