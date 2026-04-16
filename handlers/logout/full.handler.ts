import { APIGatewayProxyHandler } from 'aws-lambda';
import { buildResponse, failedResult, partialResult, successResult, OperationResult } from '../../shared/response';

const OPERATION = 'logout_full';

interface StepResult {
  name: string;
  result: OperationResult;
  ok: boolean;
}

interface LogoutRequestBody {
  /** Skip the scramble-password step (and its block fallback and notification).
   *  Default: false — scramble-password runs. */
  skipScramblePassword?: boolean;
  /** Skip the notifications/password-email step.
   *  Default: false — notification is sent when account action succeeded.
   *  Ignored (email always skipped) when skipScramblePassword is true. */
  skipNotification?: boolean;
}

/**
 * Orchestrates a full user logout using a conditional step pipeline.
 *
 * Runtime flags (optional request body — all default to false / on):
 *   skipScramblePassword — skips scramble-password, block fallback, and email
 *   skipNotification     — skips notifications/password-email only
 *
 * Phase 1 — Sequential (always runs in order):
 *   1. sessions/revoke
 *   2. tokens/revoke
 *   3. account/scramble-password  (skipped if skipScramblePassword=true)
 *
 * Phase 2 — Fallback (only if scramble-password was run and failed):
 *   4. account/block
 *
 * Phase 3 — Notification (only if scramble ran, account action succeeded,
 *            and skipNotification=false):
 *   5. notifications/password-email
 *
 * All invoked/skipped step statuses are summarised in a console.log at the end.
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

  // ── Parse runtime flags ────────────────────────────────────────────────────
  const { skipScramblePassword = false, skipNotification = false } = parseBody(event.body);

  const base = apiBaseUrl.replace(/\/$/, '');
  const userBase = `${base}/identity/users/${encodeURIComponent(userId)}`;

  // ── Phase 1: Sequential ────────────────────────────────────────────────────
  const sessionsResult = await callStep('sessions_revoke', `${userBase}/sessions/revoke`, userId);
  const tokensResult = await callStep('tokens_revoke', `${userBase}/tokens/revoke`, userId);

  let scrambleResult: StepResult | undefined;
  if (!skipScramblePassword) {
    scrambleResult = await callStep('user_scramble_password', `${userBase}/account/scramble-password`, userId);
  }

  // ── Phase 2: Block fallback — only if scramble was run and failed ──────────
  let blockResult: StepResult | undefined;
  if (!skipScramblePassword && scrambleResult && !scrambleResult.ok) {
    blockResult = await callStep('user_block', `${userBase}/account/block`, userId);
  }

  // ── Phase 3: Notification — skipped if password phase was skipped or
  //             skipNotification=true or no account action succeeded ──────────
  const accountActionOk = (scrambleResult?.ok ?? false) || (blockResult?.ok ?? false);
  let emailResult: StepResult | undefined;
  if (!skipScramblePassword && !skipNotification && accountActionOk) {
    emailResult = await callStep('notifications_password_email', `${userBase}/notifications/password-email`, userId);
  }

  // ── Collect all invoked steps ──────────────────────────────────────────────
  const invokedResults: StepResult[] = [
    sessionsResult,
    tokensResult,
    ...(scrambleResult ? [scrambleResult] : []),
    ...(blockResult ? [blockResult] : []),
    ...(emailResult ? [emailResult] : []),
  ];

  const succeeded = invokedResults.filter((r) => r.ok);
  const failed = invokedResults.filter((r) => !r.ok);

  // ── Summary log ───────────────────────────────────────────────────────────
  const skipped: string[] = [];
  if (skipScramblePassword) skipped.push('user_scramble_password', 'user_block', 'notifications_password_email');
  else if (skipNotification) skipped.push('notifications_password_email');

  const invokedLines = invokedResults.map(
    (r) => `  ${r.ok ? '✓' : '✗'} ${r.name}: ${r.result.status}${r.result.reason ? ` — ${r.result.reason}` : ''}`,
  );
  const skippedLines = skipped.map((s) => `  - ${s}: skipped`);

  console.log(
    `[logout/full] userId=${userId} | ${succeeded.length}/${invokedResults.length} steps succeeded` +
    (skipped.length ? ` [skipped: ${skipped.join(', ')}]` : '') +
    '\n' + [...invokedLines, ...skippedLines].join('\n'),
  );

  // ── Response ───────────────────────────────────────────────────────────────
  if (failed.length === 0) {
    return buildResponse(200, successResult(OPERATION, userId, invokedResults.length));
  }

  if (succeeded.length === 0) {
    const reasons = failed.map((r) => `${r.name}: ${r.result.reason ?? 'unknown'}`).join('; ');
    return buildResponse(500, failedResult(OPERATION, userId, reasons, true));
  }

  const reasons = failed.map((r) => `${r.name}: ${r.result.reason ?? 'unknown'}`).join('; ');
  return buildResponse(207, partialResult(OPERATION, userId, reasons, succeeded.length));
};

function parseBody(raw: string | null): LogoutRequestBody {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as LogoutRequestBody;
  } catch {
    return {};
  }
}

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
