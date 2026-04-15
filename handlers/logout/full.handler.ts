import { APIGatewayProxyHandler } from 'aws-lambda';
import { buildResponse, failedResult, partialResult, successResult, OperationResult } from '../../shared/response';

const OPERATION = 'logout_full';

interface StepResult {
  name: string;
  result: OperationResult;
  ok: boolean;
}

/**
 * Orchestrates a full user logout by calling the four atomic endpoints
 * over HTTP. Each step is attempted independently so a single failure
 * does not abort the remaining steps.
 *
 * Steps (in order):
 *  1. sessions/revoke
 *  2. tokens/revoke
 *  3. password/reset
 *  4. notifications/password-email
 *
 * Route: POST /identity/users/{userId}/logout/full
 *
 * Environment variable required:
 *   API_BASE_URL — base URL of this API Gateway stage
 *                  e.g. https://abc123.execute-api.ap-southeast-2.amazonaws.com/prod/
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = event.pathParameters?.userId;

  if (!userId) {
    return buildResponse(400, failedResult(OPERATION, '', 'userId path parameter is required', false));
  }

  const apiBaseUrl = process.env.API_BASE_URL;
  if (!apiBaseUrl) {
    return buildResponse(500, failedResult(OPERATION, userId, 'API_BASE_URL environment variable is not set', false));
  }

  const base = apiBaseUrl.replace(/\/$/, '');
  const userBase = `${base}/identity/users/${encodeURIComponent(userId)}`;

  const steps: Array<{ name: string; url: string }> = [
    { name: 'sessions_revoke', url: `${userBase}/sessions/revoke` },
    { name: 'tokens_revoke', url: `${userBase}/tokens/revoke` },
    { name: 'password_reset', url: `${userBase}/password/reset` },
    { name: 'notifications_password_email', url: `${userBase}/notifications/password-email` },
  ];

  const results: StepResult[] = await Promise.all(
    steps.map(async (step) => {
      try {
        const response = await fetch(step.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        const body = (await response.json()) as OperationResult;
        return { name: step.name, result: body, ok: response.ok };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          name: step.name,
          result: failedResult(step.name, userId, reason, true),
          ok: false,
        };
      }
    }),
  );

  const failed = results.filter((r) => !r.ok);
  const succeeded = results.filter((r) => r.ok);

  if (failed.length === 0) {
    return buildResponse(200, {
      ...successResult(OPERATION, userId, steps.length),
      reason: undefined,
    });
  }

  if (succeeded.length === 0) {
    const reasons = failed.map((r) => `${r.name}: ${r.result.reason ?? 'unknown'}`).join('; ');
    return buildResponse(500, failedResult(OPERATION, userId, reasons, true));
  }

  const reasons = failed.map((r) => `${r.name}: ${r.result.reason ?? 'unknown'}`).join('; ');
  return buildResponse(207, partialResult(OPERATION, userId, reasons, succeeded.length));
};
