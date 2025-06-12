import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { BaseStack, BaseStackProps } from './base-stack';

export class VpcStack extends BaseStack {
  public readonly vpc: ec2.Vpc;
  
  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, props);
    
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: this.createResourceName('vpc'),
      maxAzs: 2,
      natGateways: this.config.environment === 'production' ? 2 : 1,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      flowLogs: {
        'VpcFlowLogs': {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(),
          trafficType: ec2.FlowLogTrafficType.ALL,
        },
      },
    });
    
    // Create VPC Endpoints for AWS services
    this.createVpcEndpoints();
    
    // Create outputs
    this.createOutputs();
  }
  
  private createVpcEndpoints(): void {
    // S3 Gateway Endpoint
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });
    
    // DynamoDB Gateway Endpoint
    this.vpc.addGatewayEndpoint('DynamoDBEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });
    
    // Interface endpoints for other services
    const interfaceEndpoints = [
      { name: 'SecretsManager', service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER },
      { name: 'RDS', service: ec2.InterfaceVpcEndpointAwsService.RDS },
      { name: 'Lambda', service: ec2.InterfaceVpcEndpointAwsService.LAMBDA },
      { name: 'SQS', service: ec2.InterfaceVpcEndpointAwsService.SQS },
      { name: 'SNS', service: ec2.InterfaceVpcEndpointAwsService.SNS },
      { name: 'CloudWatch', service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS },
    ];
    
    interfaceEndpoints.forEach(({ name, service }) => {
      this.vpc.addInterfaceEndpoint(`${name}Endpoint`, {
        service,
        privateDnsEnabled: true,
        subnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      });
    });
  }
  
  private createOutputs(): void {
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID',
      exportName: `${this.createResourceName('VpcId')}`,
    });
    
    new cdk.CfnOutput(this, 'VpcCidr', {
      value: this.vpc.vpcCidrBlock,
      description: 'VPC CIDR Block',
      exportName: `${this.createResourceName('VpcCidr')}`,
    });
  }
}
