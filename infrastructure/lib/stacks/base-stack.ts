import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environment';

export interface BaseStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
}

export abstract class BaseStack extends cdk.Stack {
  protected readonly config: EnvironmentConfig;
  
  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, props);
    this.config = props.config;
    
    // Apply tags to all resources in stack
    cdk.Tags.of(this).add('Project', this.config.projectName);
    cdk.Tags.of(this).add('Environment', this.config.environment);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }
  
  protected createResourceName(resourceType: string): string {
    return `${this.config.projectName}-${resourceType}-${this.config.environment}`;
  }
}
