import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import { BaseStack, BaseStackProps } from './base-stack';

export interface ScannerStackProps extends BaseStackProps {
  vpc: ec2.Vpc;
  databaseSecret: secretsmanager.Secret;
  databaseProxy: rds.DatabaseProxy;
}

export class ScannerStack extends BaseStack {
  public readonly scanQueue: sqs.Queue;
  public readonly volumesTable: dynamodb.Table;
  public readonly snapshotsTable: dynamodb.Table;
  public readonly scanHistoryTable: dynamodb.Table;
  
  constructor(scope: Construct, id: string, props: ScannerStackProps) {
    super(scope, id, props);
    
    // Create DynamoDB tables (keeping for transition period)
    this.volumesTable = this.createVolumesTable();
    this.snapshotsTable = this.createSnapshotsTable();
    this.scanHistoryTable = this.createScanHistoryTable();
    
    // Create SQS queue for scan requests
    this.scanQueue = this.createScanQueue();
    
    // Create Lambda function for scanning with PostgreSQL
    const scannerLambda = this.createScannerLambda(props);
    
    // Create scheduled scan rule
    this.createScheduledScanRule(scannerLambda);
    
    // Create outputs
    this.createOutputs();
  }
  
  private createVolumesTable(): dynamodb.Table {
    return new dynamodb.Table(this, 'VolumesTable', {
      tableName: this.createResourceName('volumes'),
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'volumeId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: this.config.environment === 'production'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });
  }
  
  private createSnapshotsTable(): dynamodb.Table {
    return new dynamodb.Table(this, 'SnapshotsTable', {
      tableName: this.createResourceName('snapshots'),
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'snapshotId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: this.config.environment === 'production'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });
  }
  
  private createScanHistoryTable(): dynamodb.Table {
    const table = new dynamodb.Table(this, 'ScanHistoryTable', {
      tableName: this.createResourceName('scan-history'),
      partitionKey: {
        name: 'scanId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: this.config.environment === 'production'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });
    
    // Add GSI for tenant queries
    table.addGlobalSecondaryIndex({
      indexName: 'TenantIndex',
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });
    
    return table;
  }
  
  private createScanQueue(): sqs.Queue {
    const dlq = new sqs.Queue(this, 'ScanDLQ', {
      queueName: this.createResourceName('scan-dlq'),
      retentionPeriod: cdk.Duration.days(14),
    });
    
    return new sqs.Queue(this, 'ScanQueue', {
      queueName: this.createResourceName('scan-queue'),
      visibilityTimeout: cdk.Duration.minutes(15),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
      encryption: sqs.QueueEncryption.KMS_MANAGED,
    });
  }
  
  private createScannerLambda(props: ScannerStackProps): lambda.Function {
    const scannerRole = new iam.Role(this, 'ScannerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });
    
    // Add permissions to assume cross-account roles
    scannerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: ['arn:aws:iam::*:role/EBSVolumeManager-CustomerRole'], // Fixed pattern
      conditions: {
        StringLike: {
          'sts:ExternalId': '*',
        },
      },
    }));
    
    // Database layer
    const dbLayer = new lambda.LayerVersion(this, 'ScannerDbLayer', {
      code: lambda.Code.fromAsset('lib/lambda/layers/database'),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: 'PostgreSQL client for scanner',
    });
    
    const scannerLambda = new lambda.Function(this, 'ScannerLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'secure-ebs-scanner.handler', // CRITICAL: Use secure scanner
      code: lambda.Code.fromAsset('lib/lambda/scanner'),
      role: scannerRole,
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment: {
        DB_SECRET_ARN: props.databaseSecret.secretArn,
        DB_PROXY_ENDPOINT: props.databaseProxy.endpoint,
        EXTERNAL_ID_SECRET: process.env.EXTERNAL_ID_SECRET || 'change-me-in-production',
        VOLUMES_TABLE_NAME: this.volumesTable.tableName, // Keep for transition
        SNAPSHOTS_TABLE_NAME: this.snapshotsTable.tableName,
        SCAN_HISTORY_TABLE_NAME: this.scanHistoryTable.tableName,
      },
      layers: [dbLayer],
      tracing: lambda.Tracing.ACTIVE,
    });
    
    // Grant permissions
    props.databaseSecret.grantRead(scannerLambda);
    this.volumesTable.grantReadWriteData(scannerLambda);
    this.snapshotsTable.grantReadWriteData(scannerLambda);
    this.scanHistoryTable.grantReadWriteData(scannerLambda);
    
    // Add SQS event source
    scannerLambda.addEventSource(new SqsEventSource(this.scanQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(30),
    }));
    
    return scannerLambda;
  }
  
  private createScheduledScanRule(targetLambda: lambda.Function): void {
    // Create rule for daily scans
    const rule = new events.Rule(this, 'DailyScanRule', {
      ruleName: this.createResourceName('daily-scan'),
      schedule: events.Schedule.rate(cdk.Duration.days(1)),
      description: 'Trigger daily EBS volume scans',
    });
    
    // Add Lambda target
    rule.addTarget(new targets.LambdaFunction(targetLambda));
  }
  
  private createOutputs(): void {
    new cdk.CfnOutput(this, 'ScanQueueUrl', {
      value: this.scanQueue.queueUrl,
      description: 'URL of the scan request queue',
      exportName: `${this.createResourceName('ScanQueueUrl')}`,
    });
    
    new cdk.CfnOutput(this, 'VolumesTableName', {
      value: this.volumesTable.tableName,
      description: 'Name of the volumes DynamoDB table',
      exportName: `${this.createResourceName('VolumesTableName')}`,
    });
  }
}
