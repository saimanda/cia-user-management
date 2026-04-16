import { randomBytes } from 'crypto';
import { APIGatewayProxyHandler } from 'aws-lambda';
import { getAuth0Client } from '../../shared/auth0-client';
import { buildResponse, successResult, failedResult } from '../../shared/response';
import { isRetryable, extractErrorMessage } from '../../shared/errors';

const OPERATION = 'user_scramble_password';

/**
 * Scrambles a user's password by setting a cryptographically random value
 * via the Auth0 Management API (PATCH /v2/users/{id}).
 *
 * The generated password is never stored or logged — the user cannot derive
 * it, effectively locking them out until a password reset flow is completed.
 *
 * Designed as an atomic, agent-callable skill — pair with sessions/revoke,
 * tokens/revoke, account/block, and notifications/password-email for a full
 * logout sequence.
 *
 * Configuration:
 *   AUTH0_CONNECTION — Auth0 database connection name (default: NewsCorp-Australia)
 *
 * Route: POST /identity/users/{userId}/account/scramble-password
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = event.pathParameters?.userId;

  if (!userId) {
    return buildResponse(
      400,
      failedResult(OPERATION, '', 'userId path parameter is required', false),
    );
  }

  const connection = process.env.AUTH0_CONNECTION ?? 'NewsCorp-Australia';
  const password = generatePassword();

  try {
    const management = await getAuth0Client();

    await management.users.update({ id: userId }, { password, connection });

    return buildResponse(200, successResult(OPERATION, userId));
  } catch (error) {
    const reason = extractErrorMessage(error);
    const retryable = isRetryable(error);
    return buildResponse(retryable ? 503 : 500, failedResult(OPERATION, userId, reason, retryable));
  }
};

/**
 * Generates a cryptographically random password.
 * 32 random bytes encoded as base64url produces a 43-character string
 * containing A–Z, a–z, 0–9, '-', '_' — satisfies Auth0 password complexity.
 * A fresh value is produced on every Lambda invocation.
 */
function generatePassword(): string {
  return randomBytes(32).toString('base64url');
}
