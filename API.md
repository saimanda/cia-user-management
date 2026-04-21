# CIA User Management — API Documentation

Base URL: `https://{host}/tools`

All endpoints require the `x-api-key` header.

---

## Authentication

| Header | Required | Description |
|---|---|---|
| `x-api-key` | **Yes** | API key created during CDK deployment |

Requests without a valid `x-api-key` receive a `403 Forbidden` response from API Gateway.

---

## Common Response Contract

Every endpoint returns the `OperationResult` JSON structure:

```json
{
  "operation": "string",
  "userId": "string",
  "status": "success | failed | partial",
  "affectedCount": 1,
  "retryable": false,
  "reason": "string",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

| Field | Type | Always Present | Description |
|---|---|---|---|
| `operation` | string | Yes | Operation name in snake_case (e.g. `sessions_revoke`) |
| `userId` | string | Yes | Auth0 user ID (may be empty on validation errors) |
| `status` | string | Yes | `success`, `failed`, or `partial` |
| `affectedCount` | number | No | Number of successful operations (omitted on 202 async responses) |
| `retryable` | boolean | No | `true` if the caller should retry (429 / 5xx from Auth0) |
| `reason` | string | No | Error description (present only on `failed` / `partial`) |
| `timestamp` | string | Yes | ISO 8601 timestamp |

### HTTP Status Code Mapping

| HTTP Status | Meaning | `status` | `retryable` |
|---|---|---|---|
| `200` | Operation completed | `success` | — |
| `202` | Accepted (Auth0 processes asynchronously) | `success` | — |
| `207` | Partial success (Full Logout only) | `partial` | `true` |
| `400` | Missing required parameter | `failed` | `false` |
| `404` | User not found | `failed` | `false` |
| `500` | Non-retryable Auth0 error (400/401/403/404 from Auth0) | `failed` | `false` |
| `503` | Retryable error (429/5xx from Auth0) | `failed` | `true` |

---

## Endpoints

### 1. Get User Profile

Looks up a user by email via the Auth0 Management API.

```
GET /identity/users/profile?email={email}
```

#### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `email` | query | string | **Yes** | User's email address |

#### Success Response — `200 OK`

```json
{
  "operation": "get_user_profile",
  "status": "success",
  "data": {
    "user_id": "auth0|69e02d1e2db86cbf0b897b7d",
    "email": "user@example.com",
    "name": "John Doe",
    "blocked": false
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

#### Error Responses

| Status | Condition | Example `reason` |
|---|---|---|
| `400` | Missing `email` query param | `email query parameter is required` |
| `404` | No Auth0 user found for email | `No user found for email: user@example.com` |
| `500` | Auth0 API error (non-retryable) | Auth0 error message |
| `503` | Auth0 rate limit / server error | Auth0 error message |

#### Example

```bash
curl -X GET \
  'https://sit.commerceapi.news.com.au/tools/identity/users/profile?email=user@example.com' \
  -H 'x-api-key: <api-key>'
```

---

### 2. Revoke Sessions

Revokes all active browser sessions for a user. Auth0 processes this asynchronously.

```
POST /identity/users/{userId}/sessions/revoke
```

#### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `userId` | path | string | **Yes** | URL-encoded Auth0 user ID (e.g. `auth0%7C69e02d1e...`) |

#### Success Response — `202 Accepted`

```json
{
  "operation": "sessions_revoke",
  "userId": "auth0%7C69e02d1e2db86cbf0b897b7d",
  "status": "success",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

> No `affectedCount` — Auth0 responds with an empty body for session deletions.

#### Error Responses

| Status | Condition | Example `reason` |
|---|---|---|
| `400` | Missing `userId` path param | `userId path parameter is required` |
| `500` | Auth0 API error (non-retryable) | Auth0 error message |
| `503` | Auth0 rate limit / server error | Auth0 error message |

#### Example

```bash
curl -X POST \
  'https://sit.commerceapi.news.com.au/tools/identity/users/auth0%7C69e02d1e2db86cbf0b897b7d/sessions/revoke' \
  -H 'x-api-key: <api-key>'
```

---

### 3. Revoke Refresh Tokens

Revokes all refresh tokens for a user. Auth0 processes this asynchronously.

```
POST /identity/users/{userId}/tokens/revoke
```

#### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `userId` | path | string | **Yes** | URL-encoded Auth0 user ID |

#### Success Response — `202 Accepted`

```json
{
  "operation": "tokens_revoke",
  "userId": "auth0%7C69e02d1e2db86cbf0b897b7d",
  "status": "success",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

> No `affectedCount` — Auth0 responds with an empty body for token deletions.

#### Error Responses

| Status | Condition | Example `reason` |
|---|---|---|
| `400` | Missing `userId` path param | `userId path parameter is required` |
| `500` | Auth0 API error (non-retryable) | Auth0 error message |
| `503` | Auth0 rate limit / server error | Auth0 error message |

#### Example

```bash
curl -X POST \
  'https://sit.commerceapi.news.com.au/tools/identity/users/auth0%7C69e02d1e2db86cbf0b897b7d/tokens/revoke' \
  -H 'x-api-key: <api-key>'
```

---

### 4. Block User

Blocks a user account by setting `blocked: true` in Auth0. Immediately prevents new logins.

```
POST /identity/users/{userId}/account/block
```

#### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `userId` | path | string | **Yes** | URL-encoded Auth0 user ID |

#### Success Response — `200 OK`

```json
{
  "operation": "user_block",
  "userId": "auth0%7C69e02d1e2db86cbf0b897b7d",
  "status": "success",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

#### Error Responses

| Status | Condition | Example `reason` |
|---|---|---|
| `400` | Missing `userId` path param | `userId path parameter is required` |
| `500` | Auth0 API error (non-retryable) | Auth0 error message |
| `503` | Auth0 rate limit / server error | Auth0 error message |

#### Example

```bash
curl -X POST \
  'https://sit.commerceapi.news.com.au/tools/identity/users/auth0%7C69e02d1e2db86cbf0b897b7d/account/block' \
  -H 'x-api-key: <api-key>'
```

---

### 5. Scramble Password

Sets a cryptographically random password on the user's Auth0 account, effectively locking them out until a password reset is completed. The generated password is never stored or logged.

```
POST /identity/users/{userId}/account/scramble-password
```

#### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `userId` | path | string | **Yes** | URL-encoded Auth0 user ID |

#### Success Response — `200 OK`

```json
{
  "operation": "user_scramble_password",
  "userId": "auth0%7C69e02d1e2db86cbf0b897b7d",
  "status": "success",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

#### Error Responses

| Status | Condition | Example `reason` |
|---|---|---|
| `400` | Missing `userId` path param | `userId path parameter is required` |
| `500` | Auth0 API error (non-retryable) | Auth0 error message |
| `503` | Auth0 rate limit / server error | Auth0 error message |

#### Notes

- Uses `crypto.randomBytes(32)` encoded as base64url (43 characters)
- Requires the `AUTH0_CONNECTION` environment variable (default: `NewsCorp-Australia`)
- The password exists only in Lambda memory for the duration of the Auth0 PATCH call

#### Example

```bash
curl -X POST \
  'https://sit.commerceapi.news.com.au/tools/identity/users/auth0%7C69e02d1e2db86cbf0b897b7d/account/scramble-password' \
  -H 'x-api-key: <api-key>'
```

---

### 6. Send Password Reset Email

Sends a password reset email to the user via the Auth0 Authentication API `POST /dbconnections/change_password`.

```
POST /identity/users/notifications/password-email
```

#### Parameters

This endpoint does not use path parameters. All input is provided via the request body.

#### Request Body

```json
{
  "email": "user@example.com",
  "connection": "NewsCorp-Australia"
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `email` | string | **Yes** | — | User's email address |
| `connection` | string | No | `NewsCorp-Australia` | Auth0 database connection name |

> The `client_id` is resolved internally from Secrets Manager — callers do not need to provide it.

#### Success Response — `200 OK`

```json
{
  "operation": "notifications_password_email",
  "userId": "auth0%7C69e02d1e2db86cbf0b897b7d",
  "status": "success",
  "affectedCount": 1,
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

#### Error Responses

| Status | Condition | Example `reason` |
|---|---|---|
| `400` | Missing `email` in body | `email is required in the request body` |
| `500` | Auth0 change_password error (non-retryable) | `Auth0 change_password failed: ...` |
| `503` | Auth0 rate limit / server error | `Auth0 change_password failed: ...` |

#### Example

```bash
curl -X POST \
  'https://sit.commerceapi.news.com.au/tools/identity/users/notifications/password-email' \
  -H 'x-api-key: <api-key>' \
  -H 'Content-Type: application/json' \
  -d '{ "email": "user@example.com", "connection": "NewsCorp-Australia" }'
```

---

### 7. Full Logout

Orchestrates a complete user logout by resolving the Auth0 user ID from an email address and sequentially invoking the atomic endpoints above.

```
POST /identity/users/logout/full?email={email}
```

#### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `email` | query | string | **Yes** | User email to resolve Auth0 user ID |

#### Request Body (optional)

```json
{
  "skipBlockUser": true,
  "skipNotification": true
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `skipBlockUser` | boolean | `true` | Set `false` to invoke `user_block` after sessions/tokens revocation |
| `skipNotification` | boolean | `true` | Set `false` to send password reset email after scramble |

#### Pipeline

The pipeline runs **sequentially**. Step 1 is a hard gate — if it fails, no further steps execute.

| Step | Operation | Condition | Auth0 API |
|---|---|---|---|
| 1 | `get_user_profile` | **Always** (hard gate) | `GET /v2/users-by-email` |
| 2 | `sessions_revoke` | Always | `DELETE /v2/users/{id}/sessions` |
| 3 | `tokens_revoke` | Always | `DELETE /v2/users/{id}/refresh-tokens` |
| 4 | `user_block` | Only if `skipBlockUser=false` | `PATCH /v2/users/{id}` |
| 5 | `user_scramble_password` | Always | `PATCH /v2/users/{id}` |
| 6 | `notifications_password_email` | Only if `skipNotification=false` | Auth0 Auth API `POST /dbconnections/change_password` |

#### Hard Gate (Step 1)

The profile lookup must:
- Return a successful response
- Contain a `user_id` field starting with `auth0|`

If either condition fails, the pipeline stops immediately and returns the error. No downstream steps are invoked.

#### Success Response — `200 OK` (all steps succeeded)

```json
{
  "operation": "logout_full",
  "userId": "auth0|69e02d1e2db86cbf0b897b7d",
  "status": "success",
  "get_user_profile": "success",
  "sessions_revoke": "success",
  "tokens_revoke": "success",
  "user_scramble_password": "success",
  "user_block": "skipped",
  "notifications_password_email": "skipped",
  "affectedCount": 4,
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

#### Partial Response — `207 Multi-Status` (some steps failed)

```json
{
  "operation": "logout_full",
  "userId": "auth0|69e02d1e2db86cbf0b897b7d",
  "status": "partial",
  "get_user_profile": "success",
  "sessions_revoke": "success",
  "tokens_revoke": "success",
  "user_scramble_password": "failed",
  "user_block": "skipped",
  "notifications_password_email": "skipped",
  "reason": "user_scramble_password: Auth0 error message",
  "affectedCount": 3,
  "retryable": true,
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

#### Failed Response — profile lookup fails (pipeline stops)

```json
{
  "operation": "logout_full",
  "userId": "",
  "status": "failed",
  "get_user_profile": "failed",
  "reason": "get_user_profile failed: No user found for email: user@example.com",
  "retryable": false,
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

#### Error Responses

| Status | Condition | Example `reason` |
|---|---|---|
| `400` | Missing `email` query param | `email query parameter is required` |
| `404` | User not found or `user_id` missing `auth0\|` prefix | `get_user_profile failed: No user found for email: ...` |
| `500` | All steps failed / internal error | Step-level reasons joined by `;` |

#### Step Execution by Scenario

| Flags | Steps invoked | Response |
|---|---|---|
| defaults — all succeed | profile, sessions, tokens, scramble | `200` affectedCount: 4 |
| defaults — scramble fails | profile, sessions, tokens, scramble | `207` affectedCount: 3 |
| `skipBlockUser=false, skipNotification=false` — all succeed | profile, sessions, tokens, block, scramble, email | `200` affectedCount: 6 |
| `skipNotification=false` — all succeed | profile, sessions, tokens, scramble, email | `200` affectedCount: 5 |
| profile fails (user not found) | profile | `404` failed |
| profile returns non-`auth0\|` user_id | profile | `404` failed |

#### Console Log Output

Every invocation emits a structured summary to CloudWatch:

```
[logout/full] email=user@example.com userId=auth0|xyz | 4/4 steps succeeded [skipped: user_block, notifications_password_email]
  ✓ get_user_profile: success
  ✓ sessions_revoke: success
  ✓ tokens_revoke: success
  ✓ user_scramble_password: success
  - user_block: skipped
  - notifications_password_email: skipped
```

#### Examples

Default (sessions + tokens + scramble):

```bash
curl -X POST \
  'https://sit.commerceapi.news.com.au/tools/identity/users/logout/full?email=user@example.com' \
  -H 'x-api-key: <api-key>' \
  -H 'Content-Type: application/json'
```

With block and notification enabled:

```bash
curl -X POST \
  'https://sit.commerceapi.news.com.au/tools/identity/users/logout/full?email=user@example.com' \
  -H 'x-api-key: <api-key>' \
  -H 'Content-Type: application/json' \
  -d '{ "skipBlockUser": false, "skipNotification": false }'
```

---

## Endpoint Summary

| # | Method | Path | Operation | HTTP Response |
|---|---|---|---|---|
| 1 | GET | `/identity/users/profile?email=...` | `get_user_profile` | `200` |
| 2 | POST | `/identity/users/{userId}/sessions/revoke` | `sessions_revoke` | `202` |
| 3 | POST | `/identity/users/{userId}/tokens/revoke` | `tokens_revoke` | `202` |
| 4 | POST | `/identity/users/{userId}/account/block` | `user_block` | `200` |
| 5 | POST | `/identity/users/{userId}/account/scramble-password` | `user_scramble_password` | `200` |
| 6 | POST | `/identity/users/notifications/password-email` | `notifications_password_email` | `200` |
| 7 | POST | `/identity/users/logout/full?email=...` | `logout_full` | `200` / `207` / `500` |

---

## Notes

- The `{userId}` path parameter must be **URL-encoded**. Auth0 user IDs contain the `|` character (e.g. `auth0|abc123`), which must be sent as `auth0%7Cabc123` in the URL.
- Each atomic handler decodes the userId via `decodeURIComponent()` before passing it to Auth0.
- The Full Logout endpoint calls the atomic endpoints internally via HTTP — it does not duplicate Auth0 logic.
- Rate limiting is enforced at the API Gateway level: 100 requests/second sustained, 200 burst.
