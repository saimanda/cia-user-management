import { APIGatewayProxyHandler } from 'aws-lambda';
import { getAuth0Client } from '../../shared/auth0-client';
import { buildResponse, successResult, failedResult } from '../../shared/response';
import { isRetryable, extractErrorMessage } from '../../shared/errors';

const OPERATION = 'password_reset';

/**
 * Blocks the user account via management.users.update(), immediately
 * preventing new logins until the user completes a password reset flow.
 * The notifications/password-email endpoint is responsible for sending
 * the reset link.
 *
 * Route: POST /identity/users/{userId}/password/reset
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = event.pathParameters?.userId;

  if (!userId) {
    return buildResponse(400, failedResult(OPERATION, '', 'userId path parameter is required', false));
  }

  try {
    const management = await getAuth0Client();

    await management.users.update({ id: userId }, { blocked: true });

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
