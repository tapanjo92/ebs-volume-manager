// infrastructure/lib/stacks/cognito-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { BaseStack, BaseStackProps } from './base-stack';

export class CognitoStack extends BaseStack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: cognito.CfnIdentityPool;
  
  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, props);
    
    // Create User Pool
    this.userPool = this.createUserPool();
    
    // Create User Pool Client
    this.userPoolClient = this.createUserPoolClient();
    
    // Create Identity Pool
    this.identityPool = this.createIdentityPool();
    
    // Create IAM roles for Identity Pool
    this.createIdentityPoolRoles();
    
    // Output important values
    this.createOutputs();
  }
  
  private createUserPool(): cognito.UserPool {
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: this.createResourceName('user-pool'),
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
        username: false,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        fullname: {
          required: true,
          mutable: true,
        },
      },
      customAttributes: {
        tenant_id: new cognito.StringAttribute({
          mutable: false,
          minLen: 1,
          maxLen: 256,
        }),
        user_role: new cognito.StringAttribute({
          mutable: true,
          minLen: 1,
          maxLen: 50,
        }),
        permissions: new cognito.StringAttribute({
          mutable: true,
          minLen: 0,
          maxLen: 2048,
        }),
      },
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: this.config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });
    
    // Add Lambda triggers
    this.addLambdaTriggers(userPool);
    
    return userPool;
  }
  
  private createUserPoolClient(): cognito.UserPoolClient {
    return new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: this.createResourceName('client'),
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: true,
      },
      generateSecret: false,
      refreshTokenValidity: cdk.Duration.days(30),
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          fullname: true,
          emailVerified: true,
        })
        .withCustomAttributes('tenant_id', 'user_role', 'permissions'),
      writeAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          fullname: true,
        }),
    });
  }
  
  private createIdentityPool(): cognito.CfnIdentityPool {
    return new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: this.createResourceName('identity-pool'),
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [{
        clientId: this.userPoolClient.userPoolClientId,
        providerName: this.userPool.userPoolProviderName,
        serverSideTokenCheck: true,
      }],
    });
  }
  
  private createIdentityPoolRoles(): void {
    const authenticatedRole = new iam.Role(this, 'CognitoAuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': this.identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      description: 'Default role for authenticated users',
    });
    
    authenticatedRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'mobileanalytics:PutEvents',
        'cognito-sync:*',
        'cognito-identity:*',
      ],
      resources: ['*'],
    }));
    
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: this.identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });
  }
  
  private addLambdaTriggers(userPool: cognito.UserPool): void {
    // Pre-signup trigger
    const preSignupLambda = new lambda.Function(this, 'PreSignupLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Pre-signup event:', JSON.stringify(event, null, 2));
          
          // Auto-confirm user for development
          if (process.env.ENVIRONMENT === 'development') {
            event.response.autoConfirmUser = true;
            event.response.autoVerifyEmail = true;
          }
          
          // Set default tenant ID if not provided
          if (!event.request.userAttributes['custom:tenant_id']) {
            event.request.userAttributes['custom:tenant_id'] = 'default-tenant';
          }
          
          // Set default role
          event.request.userAttributes['custom:user_role'] = 'user';
          
          return event;
        };
      `),
      environment: {
        ENVIRONMENT: this.config.environment,
      },
      timeout: cdk.Duration.seconds(5),
    });
    
    userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignupLambda);
    
    // Pre-token generation trigger - NOW USING EXTERNAL FILE
    const preTokenGenerationLambda = new lambda.Function(this, 'PreTokenGenerationLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'pre-token-generation.handler',
      code: lambda.Code.fromAsset('lib/lambda/cognito'),
      timeout: cdk.Duration.seconds(5),
      description: 'Adds custom claims to Cognito tokens',
    });
    
    userPool.addTrigger(cognito.UserPoolOperation.PRE_TOKEN_GENERATION, preTokenGenerationLambda);
    
    // Optional: Post-confirmation trigger for user setup
    const postConfirmationLambda = new lambda.Function(this, 'PostConfirmationLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Post-confirmation event:', JSON.stringify(event, null, 2));
          
          // Here you could:
          // 1. Create user record in database
          // 2. Send welcome email
          // 3. Set up default permissions
          
          return event;
        };
      `),
      timeout: cdk.Duration.seconds(5),
    });
    
    userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationLambda);
  }
  
  private createOutputs(): void {
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${this.createResourceName('UserPoolId')}`,
    });
    
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${this.createResourceName('UserPoolClientId')}`,
    });
    
    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPool.ref,
      description: 'Cognito Identity Pool ID',
      exportName: `${this.createResourceName('IdentityPoolId')}`,
    });
    
    new cdk.CfnOutput(this, 'UserPoolDomain', {
      value: `https://cognito-idp.${this.config.region}.amazonaws.com/${this.userPool.userPoolId}`,
      description: 'Cognito User Pool Domain',
    });
  }
}
