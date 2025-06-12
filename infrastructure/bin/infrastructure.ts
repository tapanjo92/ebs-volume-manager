#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CognitoStack } from '../lib/stacks/cognito-stack';
import { VpcStack } from '../lib/stacks/vpc-stack';
import { DatabaseStack } from '../lib/stacks/database-stack';
import { ScannerStack } from '../lib/stacks/scanner-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { getEnvironmentConfig } from '../lib/config/environment';

const app = new cdk.App();
const config = getEnvironmentConfig();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1',
};

// Create VPC Stack
const vpcStack = new VpcStack(app, `${config.projectName}-vpc-${config.environment}`, {
  config,
  env,
  description: 'EBS Volume Manager VPC Stack',
});

// Create Cognito Stack
const cognitoStack = new CognitoStack(app, `${config.projectName}-cognito-${config.environment}`, {
  config,
  env,
  description: 'EBS Volume Manager Cognito Authentication Stack',
});

// Create Database Stack
const databaseStack = new DatabaseStack(app, `${config.projectName}-database-${config.environment}`, {
  config,
  env,
  vpc: vpcStack.vpc,
});

// Create Scanner Stack
const scannerStack = new ScannerStack(app, `${config.projectName}-scanner-${config.environment}`, {
  config,
  env,
});

// Create API Stack
const apiStack = new ApiStack(app, `${config.projectName}-api-${config.environment}`, {
  config,
  env,
  userPool: cognitoStack.userPool,
  volumesTable: scannerStack.volumesTable,
  scanQueue: scannerStack.scanQueue,
});

app.synth();
