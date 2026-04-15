import { APIGatewayProxyHandler } from 'aws-lambda';
import { getAuth0Client } from '../../shared/auth0-client';
import { buildResponse, successResult, failedResult } from '../../shared/response';
import { isRetryable, extractErrorMessage } from '../../shared/errors';

const OPERATION = 'sessions_revoke';

/**
 * Revokes all active sessions for a user by invalidating remember-browser
 * device cookies via the Auth0 Management API.
 *
 * Route: POST /identity/users/{userId}/sessions/revoke
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = event.pathParameters?.userId;

  if (!userId) {
    return buildResponse(400, failedResult(OPERATION, '', 'userId path parameter is required', false));
  }

  try {
    const management = await getAuth0Client();
    await management.users.deleteSessions({ user_id: userId });

    return buildResponse(200, successResult(OPERATION, userId, 1));
  } catch (error) {
    const reason = extractErrorMessage(error);
    const retryable = isRetryable(error);
    return buildResponse(
      retryable ? 503 : 500,
      failedResult(OPERATION, userId, reason, retryable),
    );
  }
};
