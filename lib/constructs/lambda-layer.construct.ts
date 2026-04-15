import * as path from 'path';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export interface LambdaLayerProps {
  stage: string;
}

/**
 * Lambda Layer containing shared runtime dependencies (auth0 SDK and
 * supporting packages) pre-installed under nodejs/node_modules/.
 *
 * To rebuild the layer contents before deploying:
 *   cd layer && npm install
 *
 * The layer is mounted at /opt/nodejs/node_modules in the Lambda runtime.
 * Handlers that use this layer should mark bundled deps as external so
 * esbuild does not duplicate them.
 */
export class LambdaLayerConstruct extends Construct {
  public readonly layer: lambda.LayerVersion;

  constructor(scope: Construct, id: string, props: LambdaLayerProps) {
    super(scope, id);

    this.layer = new lambda.LayerVersion(this, 'SharedLayer', {
      layerVersionName: `CIAUserManagement-SharedLayer-${props.stage}`,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../layer')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
      description: 'CIA User Management — shared runtime deps (auth0)',
    });
  }
}
