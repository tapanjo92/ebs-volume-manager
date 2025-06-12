      tracing: lambda.Tracing.ACTIVE,
    });
    
    // Grant permissions
    props.volumesTable.grantReadWriteData(handlers.volumes);
    props.scanQueue.grantSendMessages(handlers.volumes);
    
    // Scan handler
    handlers.scan = new lambda.Function(this, 'ScanHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'scan.handler',
      code: lambda.Code.fromAsset('lib/lambda/api'),
      environment: {
        SCAN_QUEUE_URL: props.scanQueue.queueUrl,
        SCAN_HISTORY_TABLE_NAME: process.env.SCAN_HISTORY_TABLE_NAME || '',
      },
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
    });
    
    props.scanQueue.grantSendMessages(handlers.scan);
    
    // Backup handler
    handlers.backup = new lambda.Function(this, 'BackupHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'backup.handler',
      code: lambda.Code.fromAsset('lib/lambda/api'),
      environment: {
        VOLUMES_TABLE_NAME: props.volumesTable.tableName,
      },
      layers: [sharedLayer],
      timeout: cdk.Duration.minutes(5),
      tracing: lambda.Tracing.ACTIVE,
    });
    
    // Add EC2 permissions for backup operations
    handlers.backup.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ec2:CreateSnapshot',
        'ec2:CreateTags',
        'ec2:DescribeSnapshots',
      ],
      resources: ['*'],
    }));
    
    // Analytics handler
    handlers.analytics = new lambda.Function(this, 'AnalyticsHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'analytics.handler',
      code: lambda.Code.fromAsset('lib/lambda/api'),
      environment: {
        VOLUMES_TABLE_NAME: props.volumesTable.tableName,
      },
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
    });
    
    props.volumesTable.grantReadData(handlers.analytics);
    
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
      authorizationType: apigateway.AuthorizationType.COGNITO_USER_POOLS,
    });
    
    // POST /volumes/scan
    const scanResource = volumesResource.addResource('scan');
    scanResource.addMethod('POST', new apigateway.LambdaIntegration(handlers.scan), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO_USER_POOLS,
    });
    
    // /volumes/{volumeId}
    const volumeResource = volumesResource.addResource('{volumeId}');
    
    // GET /volumes/{volumeId}
    volumeResource.addMethod('GET', new apigateway.LambdaIntegration(handlers.volumes), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO_USER_POOLS,
    });
    
    // POST /volumes/{volumeId}/backup
    const backupResource = volumeResource.addResource('backup');
    backupResource.addMethod('POST', new apigateway.LambdaIntegration(handlers.backup), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO_USER_POOLS,
    });
    
    // DELETE /volumes/{volumeId}
    volumeResource.addMethod('DELETE', new apigateway.LambdaIntegration(handlers.volumes), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO_USER_POOLS,
    });
    
    // Create /analytics resource
    const analyticsResource = this.api.root.addResource('analytics');
    
    // GET /analytics/volumes
    const volumeAnalyticsResource = analyticsResource.addResource('volumes');
    volumeAnalyticsResource.addMethod('GET', new apigateway.LambdaIntegration(handlers.analytics), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO_USER_POOLS,
    });
    
    // GET /analytics/costs
    const costAnalyticsResource = analyticsResource.addResource('costs');
    costAnalyticsResource.addMethod('GET', new apigateway.LambdaIntegration(handlers.analytics), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO_USER_POOLS,
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
