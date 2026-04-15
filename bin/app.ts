#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CIAUserManagementStack } from '../lib/cia-user-management-stack';

const app = new cdk.App();

const stage = (app.node.tryGetContext('stage') as string | undefined) ?? 'dev';

if (!['dev', 'uat', 'prod'].includes(stage)) {
  throw new Error(`Invalid stage "${stage}". Must be one of: dev, uat, prod`);
}

new CIAUserManagementStack(app, `CIAUserManagement-${stage}`, {
  stage,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-southeast-2',
  },
  tags: {
    Project: 'CIAIdentityPlatform',
    Domain: 'UserManagement',
    Stage: stage,
    ManagedBy: 'CDK',
  },
});
