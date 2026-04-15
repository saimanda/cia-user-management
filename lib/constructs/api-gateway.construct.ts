import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export interface ApiGatewayHandlers {
  sessionsRevoke: lambda.IFunction;
  tokensRevoke: lambda.IFunction;
  userBlock: lambda.IFunction;
  scramblePassword: lambda.IFunction;
  passwordEmail: lambda.IFunction;
}

export interface ApiGatewayProps {
  stage: string;
  handlers: ApiGatewayHandlers;
}

/**
 * REST API Gateway for the CIA User Management domain.
 *
 * All routes live under /identity/users/{userId}.
 * The full-logout route is added separately via addFullLogoutRoute() because
 * that Lambda depends on this construct's URL (resolved at deploy time).
 */
export class ApiGatewayConstruct extends Construct {
  public readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: ApiGatewayProps) {
    super(scope, id);

    this.api = new apigw.RestApi(this, 'RestApi', {
      restApiName: `CIAUserManagement-${props.stage}`,
      description: 'CIA Identity Platform — User Management API',
      deployOptions: {
        stageName: props.stage,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
      },
    });

    // /identity/users/{userId}
    const identity = this.api.root.addResource('identity');
    const users = identity.addResource('users');
    const user = users.addResource('{userId}');

    // POST /sessions/revoke
    user
      .addResource('sessions')
      .addResource('revoke')
      .addMethod('POST', new apigw.LambdaIntegration(props.handlers.sessionsRevoke));

    // POST /tokens/revoke
    user
      .addResource('tokens')
      .addResource('revoke')
      .addMethod('POST', new apigw.LambdaIntegration(props.handlers.tokensRevoke));

    // POST /account/block and POST /account/scramble-password share the /account resource
    const account = user.addResource('account');

    account
      .addResource('block')
      .addMethod('POST', new apigw.LambdaIntegration(props.handlers.userBlock));

    account
      .addResource('scramble-password')
      .addMethod('POST', new apigw.LambdaIntegration(props.handlers.scramblePassword));

    // POST /notifications/password-email
    user
      .addResource('notifications')
      .addResource('password-email')
      .addMethod('POST', new apigw.LambdaIntegration(props.handlers.passwordEmail));

    // Store the {userId} resource so addFullLogoutRoute() can attach to it
    this._userResource = user;

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      exportName: `CIAUserManagement-ApiUrl-${props.stage}`,
    });
  }

  private _userResource: apigw.IResource;

  /** Adds POST /logout/full after the full-logout Lambda has been created. */
  public addFullLogoutRoute(fn: lambda.IFunction): void {
    this._userResource
      .addResource('logout')
      .addResource('full')
      .addMethod('POST', new apigw.LambdaIntegration(fn));
  }
}
