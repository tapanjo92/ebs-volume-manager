#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CognitoStack } from '../lib/stacks/cognito-stack';
import { VpcStack } from '../lib/stacks/vpc-stack';
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

app.synth();
