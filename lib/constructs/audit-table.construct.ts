import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export interface AuditTableProps {
  stage: string;
}

/**
 * DynamoDB table for persisting CIA operation audit records.
 *
 * Partition key : userId  (string)
 * Sort key      : timestamp (string — ISO 8601)
 * TTL attribute : ttl (number — Unix epoch; records expire after 90 days)
 */
export class AuditTableConstruct extends Construct {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: AuditTableProps) {
    super(scope, id);

    this.table = new dynamodb.Table(this, 'AuditTable', {
      tableName: `CIAUserManagement-Audit-${props.stage}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: props.stage === 'prod',
      removalPolicy:
        props.stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    new cdk.CfnOutput(this, 'AuditTableName', {
      value: this.table.tableName,
      exportName: `CIAUserManagement-AuditTableName-${props.stage}`,
    });
  }
}
