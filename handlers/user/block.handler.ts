import { APIGatewayProxyHandler } from 'aws-lambda';
import { getAuth0Client } from '../../shared/auth0-client';
import { buildResponse, successResult, failedResult } from '../../shared/response';
import { isRetryable, extractErrorMessage } from '../../shared/errors';

const OPERATION = 'user_block';

/**
 * Blocks a user account by setting blocked: true via the Auth0 Management API.
 * Immediately prevents new logins for the user until the account is unblocked.
 * The notifications/password-email endpoint is responsible for sending
 * the reset link.
 *
 * Designed as an atomic, agent-callable skill — pair with sessions/revoke,
 * tokens/revoke, and notifications/password-email for a full logout sequence.
 *
 * Route: POST /identity/users/{userId}/account/block
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = event.pathParameters?.userId;

  if (!userId) {
    return buildResponse(400, failedResult(OPERATION, '', 'userId path parameter is required', false));
  }

  try {
    const management = await getAuth0Client();

    await management.users.update({ id: userId }, { blocked: true });

    return buildResponse(200, successResult(OPERATION, userId));
  } catch (error) {
    const reason = extractErrorMessage(error);
    const retryable = isRetryable(error);
    return buildResponse(
      retryable ? 503 : 500,
      failedResult(OPERATION, userId, reason, retryable),
    );
  }
};
