import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { BaseStack, BaseStackProps } from './base-stack';

export interface DatabaseStackProps extends BaseStackProps {
  vpc: ec2.Vpc;
}

export class DatabaseStack extends BaseStack {
  public readonly database: rds.DatabaseInstance;
  public readonly databaseSecret: secretsmanager.Secret;
  public readonly proxy: rds.DatabaseProxy;
  
  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);
    
    // Create database secret
    this.databaseSecret = this.createDatabaseSecret();
    
    // Create security group
    const dbSecurityGroup = this.createSecurityGroup(props.vpc);
    
    // Create RDS instance
    this.database = this.createDatabase(props.vpc, dbSecurityGroup);
    
    // Create RDS Proxy for connection pooling
    this.proxy = this.createDatabaseProxy(props.vpc, dbSecurityGroup);
    
    // Create outputs
    this.createOutputs();
  }
  
  private createDatabaseSecret(): secretsmanager.Secret {
    return new secretsmanager.Secret(this, 'DatabaseSecret', {
      secretName: this.createResourceName('db-secret'),
      description: 'RDS PostgreSQL database credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: 'dbadmin',
        }),
        generateStringKey: 'password',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
        passwordLength: 32,
      },
    });
  }
  
  private createSecurityGroup(vpc: ec2.Vpc): ec2.SecurityGroup {
    const sg = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'Security group for RDS database',
      allowAllOutbound: false,
    });
    
    // Add tags
    cdk.Tags.of(sg).add('Name', this.createResourceName('db-sg'));
    
    return sg;
  }
  
  private createDatabase(vpc: ec2.Vpc, securityGroup: ec2.SecurityGroup): rds.DatabaseInstance {
    const db = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15_3,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.SMALL
      ),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [securityGroup],
      allocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: this.config.environment === 'production',
      autoMinorVersionUpgrade: true,
      backupRetention: cdk.Duration.days(
        this.config.environment === 'production' ? 30 : 7
      ),
      deletionProtection: this.config.environment === 'production',
      removalPolicy: this.config.environment === 'production'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      credentials: rds.Credentials.fromSecret(this.databaseSecret),
      databaseName: 'ebsmanager',
      cloudwatchLogsExports: ['postgresql'],
      monitoringInterval: cdk.Duration.seconds(60),
      enablePerformanceInsights: true,
      performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
    });
    
    return db;
  }
  
  private createDatabaseProxy(vpc: ec2.Vpc, securityGroup: ec2.SecurityGroup): rds.DatabaseProxy {
    const proxy = new rds.DatabaseProxy(this, 'DatabaseProxy', {
      proxyTarget: rds.ProxyTarget.fromInstance(this.database),
      secrets: [this.databaseSecret],
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [securityGroup],
      requireTLS: true,
      idleClientTimeout: cdk.Duration.minutes(30),
      maxConnectionsPercent: 100,
      maxIdleConnectionsPercent: 50,
      borrowTimeout: cdk.Duration.seconds(30),
      sessionPinningFilters: [],
      initQuery: 'SET search_path TO public',
    });
    
    return proxy;
  }
  
  private createOutputs(): void {
    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.database.dbInstanceEndpointAddress,
      description: 'RDS Database Endpoint',
      exportName: `${this.createResourceName('DatabaseEndpoint')}`,
    });
    
    new cdk.CfnOutput(this, 'DatabaseProxyEndpoint', {
      value: this.proxy.endpoint,
      description: 'RDS Proxy Endpoint',
      exportName: `${this.createResourceName('DatabaseProxyEndpoint')}`,
    });
    
    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: this.databaseSecret.secretArn,
      description: 'Database Secret ARN',
      exportName: `${this.createResourceName('DatabaseSecretArn')}`,
    });
  }
}
