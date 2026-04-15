import { APIGatewayProxyHandler } from 'aws-lambda';
import { buildResponse, failedResult, partialResult, successResult, OperationResult } from '../../shared/response';

const OPERATION = 'logout_full';

interface StepResult {
  name: string;
  result: OperationResult;
  ok: boolean;
}

/**
 * Orchestrates a full user logout using a conditional step pipeline.
 *
 * Phase 1 — Sequential (always runs in order):
 *   1. sessions/revoke
 *   2. tokens/revoke
 *   3. account/scramble-password
 *
 * Phase 2 — Fallback (only if scramble-password failed):
 *   4. account/block
 *
 * Phase 3 — Notification (only if scramble-password OR block succeeded):
 *   5. notifications/password-email
 *
 * All invoked step statuses are summarised in a console.log at the end.
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

  // ── Phase 1: Sequential ────────────────────────────────────────────────────
  const sessionsResult = await callStep('sessions_revoke', `${userBase}/sessions/revoke`, userId);
  const tokensResult = await callStep('tokens_revoke', `${userBase}/tokens/revoke`, userId);
  const scrambleResult = await callStep('user_scramble_password', `${userBase}/account/scramble-password`, userId);

  // ── Phase 2: Block is fallback if scramble-password failed ─────────────────
  let blockResult: StepResult | undefined;
  if (!scrambleResult.ok) {
    blockResult = await callStep('user_block', `${userBase}/account/block`, userId);
  }

  // ── Phase 3: Email only if scramble-password OR block succeeded ────────────
  const accountActionOk = scrambleResult.ok || (blockResult?.ok ?? false);
  let emailResult: StepResult | undefined;
  if (accountActionOk) {
    emailResult = await callStep('notifications_password_email', `${userBase}/notifications/password-email`, userId);
  }

  // ── Collect all invoked steps ──────────────────────────────────────────────
  const allResults: StepResult[] = [
    sessionsResult,
    tokensResult,
    scrambleResult,
    ...(blockResult ? [blockResult] : []),
    ...(emailResult ? [emailResult] : []),
  ];

  const succeeded = allResults.filter((r) => r.ok);
  const failed = allResults.filter((r) => !r.ok);

  // ── Summary log ───────────────────────────────────────────────────────────
  const summary = allResults
    .map((r) => `  ${r.ok ? '✓' : '✗'} ${r.name}: ${r.result.status}${r.result.reason ? ` — ${r.result.reason}` : ''}`)
    .join('\n');
  console.log(`[logout/full] userId=${userId} | ${succeeded.length}/${allResults.length} steps succeeded\n${summary}`);

  // ── Response ───────────────────────────────────────────────────────────────
  if (failed.length === 0) {
    return buildResponse(200, successResult(OPERATION, userId, allResults.length));
  }

  if (succeeded.length === 0) {
    const reasons = failed.map((r) => `${r.name}: ${r.result.reason ?? 'unknown'}`).join('; ');
    return buildResponse(500, failedResult(OPERATION, userId, reasons, true));
  }

  const reasons = failed.map((r) => `${r.name}: ${r.result.reason ?? 'unknown'}`).join('; ');
  return buildResponse(207, partialResult(OPERATION, userId, reasons, succeeded.length));
};

async function callStep(name: string, url: string, userId: string): Promise<StepResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const body = (await response.json()) as OperationResult;
    return { name, result: body, ok: response.ok };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { name, result: failedResult(name, userId, reason, true), ok: false };
  }
}
