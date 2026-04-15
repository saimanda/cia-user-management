# CIAUserManagementStack — Claude Code Context

## Project Purpose
AWS CDK stack for NCA's CIA (Customer Identity & Access) Platform.
Wraps Auth0 Management API and Authentication API user lifecycle operations
as atomic, agent-ready Lambda endpoints. This is the first domain stack
in the CIA Identity Platform agentic architecture.

## Tech Stack
- Runtime: Node.js 18, TypeScript (strict)
- IaC: AWS CDK v2
- Auth0 SDK: auth0 (npm) — ManagementClient
- Testing: Jest
- Linting: ESLint + Prettier

## Architecture Rules (NON-NEGOTIABLE)
1. Every Auth0 Management API operation = its own Lambda handler file
2. Every handler returns the OperationResult interface — no exceptions
3. The Auth0 ManagementClient is NEVER instantiated in a handler — always
   imported from shared/auth0-client.ts
4. Secrets (Auth0 credentials) come from AWS Secrets Manager only — never
   env vars, never hardcoded
5. The /logout/full orchestration endpoint calls the other 4 atomic
   endpoints via HTTP — it does NOT duplicate their Auth0 logic

## OperationResult Interface (MUST use in every handler)
interface OperationResult {
  operation: string;       // snake_case e.g. "sessions_revoke"
  userId: string;
  status: "success" | "failed" | "partial";
  affectedCount?: number;
  retryable?: boolean;     // CRITICAL for agent retry decisions
  reason?: string;         // CRITICAL for agent next-step logic
  timestamp: string;       // ISO 8601
}

## Auth0 Tenant
- Domain: [YOUR_AUTH0_DOMAIN].au.auth0.com
- M2M Client stored in: AWS Secrets Manager /cia/auth0/m2m-credentials
- Secret shape: { clientId: string, clientSecret: string, domain: string }

## AWS Configuration
- Region: ap-southeast-2
- Stage: dev | uat | prod (via CDK context: cdk deploy -c stage=uat)
- Stack naming: CIAUserManagement-{stage}

## API Routes (all under /identity/users/{userId})
POST /sessions/revoke          → handlers/sessions/revoke.handler.ts
POST /tokens/revoke            → handlers/tokens/revoke.handler.ts
POST /account/block            → handlers/user/block.handler.ts
POST /account/scramble-password → handlers/user/scramble-password.handler.ts
POST /notifications/password-email → handlers/notifications/password-email.handler.ts
POST /logout/full              → handlers/logout/full.handler.ts

## File Structure
lib/
  cia-user-management-stack.ts   ← CDK Stack class
  constructs/
    api-gateway.construct.ts
    lambda-layer.construct.ts
    audit-table.construct.ts
  handlers/
    sessions/revoke.handler.ts
    tokens/revoke.handler.ts
    password/reset.handler.ts
    notifications/password-email.handler.ts
    logout/full.handler.ts
shared/
  auth0-client.ts
  response.ts
  errors.ts
bin/
  app.ts
test/
  sessions.revoke.test.ts
  logout.full.test.ts
