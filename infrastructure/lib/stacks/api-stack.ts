// infrastructure/lib/stacks/api-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { BaseStack, BaseStackProps } from './base-stack';

export interface ApiStackProps extends BaseStackProps {
  userPool: cognito.UserPool;
  volumesTable: cdk.aws_dynamodb.Table;
  scanQueue: cdk.aws_sqs.Queue;
  databaseSecret: secretsmanager.Secret;  // ADD THIS
  databaseProxy: rds.DatabaseProxy;       // ADD THIS
}

export class ApiStack extends BaseStack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Create API Gateway
    this.api = this.createApiGateway();

    // Create Cognito authorizer
    const authorizer = this.createCognitoAuthorizer(props.userPool);

    // Create Lambda functions for API endpoints
    const handlers = this.createApiHandlers(props);

    // Create API resources and methods
    this.createApiResources(authorizer, handlers);

    // Create outputs
    this.createOutputs();
  }

  private createApiGateway(): apigateway.RestApi {
    const logGroup = new logs.LogGroup(this, 'ApiLogs', {
      logGroupName: `/aws/apigateway/${this.createResourceName('api')}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: this.config.environment === 'production'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    return new apigateway.RestApi(this, 'Api', {
      restApiName: this.createResourceName('api'),
      description: 'EBS Volume Manager API',
      deployOptions: {
        stageName: this.config.environment,
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
      },
      defaultCorsPreflightOptions: {
        allowOrigins: this.config.environment === 'production'
          ? ['https://your-production-domain.com'] // FIX THIS
          : ['http://localhost:3000'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true,
      },
    });
  }

  private createCognitoAuthorizer(userPool: cognito.UserPool): apigateway.CognitoUserPoolsAuthorizer {
    return new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: this.createResourceName('authorizer'),
      identitySource: 'method.request.header.Authorization',
    });
  }

  private createApiHandlers(props: ApiStackProps): Record<string, lambda.Function> {
    const handlers: Record<string, lambda.Function> = {};

    // Shared Lambda layer with database dependencies
    const dbLayer = new lambda.LayerVersion(this, 'DatabaseLayer', {
      code: lambda.Code.fromAsset('lib/lambda/layers/database'),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: 'PostgreSQL client and utilities',
    });

    // Common database environment variables
    const dbEnvironment = {
      DB_SECRET_ARN: props.databaseSecret.secretArn,
      DB_PROXY_ENDPOINT: props.databaseProxy.endpoint,
    };

    // Volumes handler - USING POSTGRESQL VERSION
    handlers.volumes = new lambda.Function(this, 'VolumesHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'volumes-postgres.handler', // CRITICAL: Use PostgreSQL handler
      code: lambda.Code.fromAsset('lib/lambda/api'),
      environment: {
        ...dbEnvironment,
        ALLOWED_ORIGIN: this.config.environment === 'production'
          ? 'https://your-production-domain.com'
          : 'http://localhost:3000',
      },
      layers: [dbLayer],
      timeout: cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant permissions to read database secret
    props.databaseSecret.grantRead(handlers.volumes);

    // Scan handler
    handlers.scan = new lambda.Function(this, 'ScanHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'scan.handler',
      code: lambda.Code.fromAsset('lib/lambda/api'),
      environment: {
        ...dbEnvironment,
        SCAN_QUEUE_URL: props.scanQueue.queueUrl,
        ALLOWED_ORIGIN: this.config.environment === 'production'
          ? 'https://your-production-domain.com'
          : 'http://localhost:3000',
      },
      layers: [dbLayer],
      timeout: cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
    });

    props.databaseSecret.grantRead(handlers.scan);
    props.scanQueue.grantSendMessages(handlers.scan);

    // Backup handler
    handlers.backup = new lambda.Function(this, 'BackupHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'backup.handler',
      code: lambda.Code.fromAsset('lib/lambda/api'),
      environment: {
        ...dbEnvironment,
        ALLOWED_ORIGIN: this.config.environment === 'production'
          ? 'https://your-production-domain.com'
          : 'http://localhost:3000',
      },
      layers: [dbLayer],
      timeout: cdk.Duration.minutes(5),
      tracing: lambda.Tracing.ACTIVE,
    });

    props.databaseSecret.grantRead(handlers.backup);

    // Add EC2 permissions for backup operations
    handlers.backup.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ec2:CreateSnapshot',
        'ec2:CreateTags',
        'ec2:DescribeSnapshots',
        'sts:AssumeRole', // For cross-account access
      ],
      resources: ['*'],
    }));

    // Analytics handler
    handlers.analytics = new lambda.Function(this, 'AnalyticsHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'analytics.handler',
      code: lambda.Code.fromAsset('lib/lambda/api'),
      environment: {
        ...dbEnvironment,
        ALLOWED_ORIGIN: this.config.environment === 'production'
          ? 'https://your-production-domain.com'
          : 'http://localhost:3000',
      },
      layers: [dbLayer],
      timeout: cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
    });

    props.databaseSecret.grantRead(handlers.analytics);

    return handlers;
  }

  private createApiResources(
    authorizer: apigateway.CognitoUserPoolsAuthorizer,
    handlers: Record<string, lambda.Function>
  ): void {
    // Create /volumes resource
    const volumesResource = this.api.root.addResource('volumes');

    // GET /volumes
    volumesResource.addMethod('GET', new apigateway.LambdaIntegration(handlers.volumes), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /volumes/scan
    const scanResource = volumesResource.addResource('scan');
    scanResource.addMethod('POST', new apigateway.LambdaIntegration(handlers.scan), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /volumes/{volumeId}
    const volumeResource = volumesResource.addResource('{volumeId}');

    // GET /volumes/{volumeId}
    volumeResource.addMethod('GET', new apigateway.LambdaIntegration(handlers.volumes), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /volumes/{volumeId}/backup
    const backupResource = volumeResource.addResource('backup');
    backupResource.addMethod('POST', new apigateway.LambdaIntegration(handlers.backup), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // DELETE /volumes/{volumeId}
    volumeResource.addMethod('DELETE', new apigateway.LambdaIntegration(handlers.volumes), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Create /analytics resource
    const analyticsResource = this.api.root.addResource('analytics');

    // GET /analytics/volumes
    const volumeAnalyticsResource = analyticsResource.addResource('volumes');
    volumeAnalyticsResource.addMethod('GET', new apigateway.LambdaIntegration(handlers.analytics), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /analytics/costs
    const costAnalyticsResource = analyticsResource.addResource('costs');
    costAnalyticsResource.addMethod('GET', new apigateway.LambdaIntegration(handlers.analytics), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
  }

  private createOutputs(): void {
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'API Gateway URL',
      exportName: `${this.createResourceName('ApiUrl')}`,
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.api.restApiId,
      description: 'API Gateway ID',
      exportName: `${this.createResourceName('ApiId')}`,
    });
  }
}
