import { APIGatewayProxyHandler } from 'aws-lambda';
import { getAuth0Client } from '../../shared/auth0-client';
import { buildResponse, successResult, failedResult } from '../../shared/response';
import { isRetryable, extractErrorMessage } from '../../shared/errors';

const OPERATION = 'tokens_revoke';

/**
 * Revokes all refresh tokens for a user in a single Management API call
 * via management.users.deleteRefreshTokens().
 *
 * Route: POST /identity/users/{userId}/tokens/revoke
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = event.pathParameters?.userId;

  if (!userId) {
    return buildResponse(400, failedResult(OPERATION, '', 'userId path parameter is required', false));
  }

  try {
    const management = await getAuth0Client();

    await management.users.deleteRefreshTokens({ user_id: userId });

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
