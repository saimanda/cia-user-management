import { APIGatewayProxyHandler } from 'aws-lambda';
import { getAuth0Client } from '../../shared/auth0-client';
import { buildResponse, successResult, failedResult } from '../../shared/response';
import { isRetryable, extractErrorMessage } from '../../shared/errors';

const OPERATION = 'notifications_password_email';

/**
 * Creates an email-verification ticket for the user via
 * management.tickets.verifyEmail(). Auth0 sends the email using the
 * tenant's configured email provider.
 *
 * Route: POST /identity/users/{userId}/notifications/password-email
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = event.pathParameters?.userId;

  if (!userId) {
    return buildResponse(
      400,
      failedResult(OPERATION, '', 'userId path parameter is required', false),
    );
  }

  try {
    const management = await getAuth0Client();

    await management.tickets.verifyEmail({ user_id: userId });

    return buildResponse(200, successResult(OPERATION, userId, 1));
  } catch (error) {
    const reason = extractErrorMessage(error);
    const retryable = isRetryable(error);
    return buildResponse(retryable ? 503 : 500, failedResult(OPERATION, userId, reason, retryable));
  }
};
