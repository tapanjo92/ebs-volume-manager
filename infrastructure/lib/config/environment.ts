export interface EnvironmentConfig {
  readonly account: string;
  readonly region: string;
  readonly environment: 'development' | 'staging' | 'production';
  readonly projectName: string;
  readonly domainName?: string;
  readonly certificateArn?: string;
}

export const getEnvironmentConfig = (): EnvironmentConfig => {
  const environment = process.env.ENVIRONMENT || 'development';
  
  const configs: Record<string, EnvironmentConfig> = {
    development: {
      account: process.env.CDK_DEFAULT_ACCOUNT || '',
      region: process.env.CDK_DEFAULT_REGION || 'ap-south-1',
      environment: 'development',
      projectName: 'ebs-volume-manager',
    },
    staging: {
      account: process.env.CDK_DEFAULT_ACCOUNT || '',
      region: process.env.CDK_DEFAULT_REGION || 'ap-south-1',
      environment: 'staging',
      projectName: 'ebs-volume-manager',
      domainName: process.env.DOMAIN_NAME,
      certificateArn: process.env.CERTIFICATE_ARN,
    },
    production: {
      account: process.env.CDK_DEFAULT_ACCOUNT || '',
      region: process.env.CDK_DEFAULT_REGION || 'ap-south-1',
      environment: 'production',
      projectName: 'ebs-volume-manager',
      domainName: process.env.DOMAIN_NAME,
      certificateArn: process.env.CERTIFICATE_ARN,
    },
  };
  
  return configs[environment];
};
