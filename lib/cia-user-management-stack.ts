import * as path from 'path';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';

import { AuditTableConstruct } from './constructs/audit-table.construct';
import { LambdaLayerConstruct } from './constructs/lambda-layer.construct';
import { ApiGatewayConstruct } from './constructs/api-gateway.construct';

export interface CIAUserManagementStackProps extends cdk.StackProps {
  stage: string;
}

export class CIAUserManagementStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CIAUserManagementStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // ── Infrastructure constructs ────────────────────────────────────────────
    const auditTable = new AuditTableConstruct(this, 'AuditTable', { stage });
    const sharedLayer = new LambdaLayerConstruct(this, 'SharedLayer', { stage });

    // ── IAM policy for Secrets Manager access ────────────────────────────────
    const secretsPolicy = new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [
        `arn:aws:secretsmanager:ap-southeast-2:${this.account}:secret:/cia/auth0/m2m-credentials*`,
      ],
    });

    // ── Shared Lambda configuration ──────────────────────────────────────────
    const commonEnv: Record<string, string> = {
      STAGE: stage,
      AUDIT_TABLE_NAME: auditTable.table.tableName,
      NODE_OPTIONS: '--enable-source-maps',
      AUTH0_CONNECTION:
        (this.node.tryGetContext('auth0Connection') as string | undefined) ?? 'NewsCorp-Australia',
    };

    // ── Lambda runtime — configurable via CDK context ────────────────────────
    // Override: cdk deploy -c nodeVersion=20
    const nodeVersion = (this.node.tryGetContext('nodeVersion') as string | undefined) ?? '22';
    const runtimeMap: Record<string, lambda.Runtime> = {
      '18': lambda.Runtime.NODEJS_18_X,
      '20': lambda.Runtime.NODEJS_20_X,
      '22': lambda.Runtime.NODEJS_22_X,
    };
    const lambdaRuntime = runtimeMap[nodeVersion] ?? lambda.Runtime.NODEJS_22_X;

    const commonBundling: BundlingOptions = {
      // AWS SDK v3 is available in the Lambda runtime — no need to bundle it.
      externalModules: ['@aws-sdk/*'],
      minify: stage === 'prod',
      sourceMap: true,
    };

    const commonFnProps = {
      runtime: lambdaRuntime,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: commonEnv,
      bundling: commonBundling,
      layers: [sharedLayer.layer],
    };

    const handlerDir = path.join(__dirname, '../handlers');

    // ── Atomic Lambda handlers ───────────────────────────────────────────────
    const sessionsRevokeFn = new NodejsFunction(this, 'SessionsRevokeHandler', {
      ...commonFnProps,
      entry: path.join(handlerDir, 'sessions/revoke.handler.ts'),
      functionName: `CIAUserManagement-SessionsRevoke-${stage}`,
    });

    const tokensRevokeFn = new NodejsFunction(this, 'TokensRevokeHandler', {
      ...commonFnProps,
      entry: path.join(handlerDir, 'tokens/revoke.handler.ts'),
      functionName: `CIAUserManagement-TokensRevoke-${stage}`,
    });

    const userBlockFn = new NodejsFunction(this, 'UserBlockHandler', {
      ...commonFnProps,
      entry: path.join(handlerDir, 'user/block.handler.ts'),
      functionName: `CIAUserManagement-UserBlock-${stage}`,
    });

    const scramblePasswordFn = new NodejsFunction(this, 'ScramblePasswordHandler', {
      ...commonFnProps,
      entry: path.join(handlerDir, 'user/scramble-password.handler.ts'),
      functionName: `CIAUserManagement-ScramblePassword-${stage}`,
    });

    const passwordEmailFn = new NodejsFunction(this, 'PasswordEmailHandler', {
      ...commonFnProps,
      entry: path.join(handlerDir, 'notifications/password-email.handler.ts'),
      functionName: `CIAUserManagement-PasswordEmail-${stage}`,
    });

    // Grant each atomic handler access to the Auth0 secret and audit table.
    for (const fn of [
      sessionsRevokeFn,
      tokensRevokeFn,
      userBlockFn,
      scramblePasswordFn,
      passwordEmailFn,
    ]) {
      fn.addToRolePolicy(secretsPolicy);
      auditTable.table.grantWriteData(fn);
    }

    // ── API Gateway (atomic routes) ──────────────────────────────────────────
    const apiConstruct = new ApiGatewayConstruct(this, 'API', {
      stage,
      handlers: {
        sessionsRevoke: sessionsRevokeFn,
        tokensRevoke: tokensRevokeFn,
        userBlock: userBlockFn,
        scramblePassword: scramblePasswordFn,
        passwordEmail: passwordEmailFn,
      },
    });

    // ── Full-logout orchestration handler ────────────────────────────────────
    // Created after the API so its URL (a CloudFormation token) is available.
    const fullLogoutFn = new NodejsFunction(this, 'FullLogoutHandler', {
      ...commonFnProps,
      entry: path.join(handlerDir, 'logout/full.handler.ts'),
      functionName: `CIAUserManagement-FullLogout-${stage}`,
      // Timeout must exceed the sum of worst-case inner call timeouts.
      timeout: cdk.Duration.seconds(120),
      environment: {
        ...commonEnv,
        API_BASE_URL: apiConstruct.api.url,
      },
    });

    auditTable.table.grantWriteData(fullLogoutFn);

    apiConstruct.addFullLogoutRoute(fullLogoutFn);
  }
}
