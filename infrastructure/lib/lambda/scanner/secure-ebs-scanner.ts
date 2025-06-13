// lib/lambda/scanner/secure-ebs-scanner.ts
import { Handler, SQSEvent } from 'aws-lambda';
import { EC2Client, DescribeVolumesCommand } from '@aws-sdk/client-ec2';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { db } from '../utils/db-connection';
import crypto from 'crypto';

interface ScanRequest {
  scanId: string;
  tenantId: string;
  accountId: string;
  roleArn: string;
  externalId: string;
  regions: string[];
}

export const handler: Handler<SQSEvent> = async (event) => {
  console.log('Scanner event:', JSON.stringify(event, null, 2));
  
  for (const record of event.Records) {
    const scanRequest: ScanRequest = JSON.parse(record.body);
    
    try {
      await processScanRequest(scanRequest);
    } catch (error) {
      console.error('Error processing scan:', error);
      await updateScanStatus(scanRequest.scanId, 'failed', error.message);
      throw error;
    }
  }
};

async function processScanRequest(request: ScanRequest) {
  // CRITICAL: Validate the account belongs to the tenant
  const isValid = await validateAccountOwnership(
    request.tenantId,
    request.accountId,
    request.roleArn,
    request.externalId
  );
  
  if (!isValid) {
    throw new Error('Invalid account credentials or ownership');
  }
  
  // Update scan status
  await updateScanStatus(request.scanId, 'in-progress');
  
  // Get AWS account internal ID
  const accountInternalId = await getAccountInternalId(request.tenantId, request.accountId);
  
  // Assume role with validation
  const credentials = await assumeRoleSecurely(
    request.roleArn,
    request.externalId,
    request.scanId
  );
  
  let totalVolumes = 0;
  const errors: string[] = [];
  
  // Scan each region
  for (const region of request.regions) {
    try {
      console.log(`Scanning region ${region} for account ${request.accountId}`);
      
      const volumes = await scanVolumesInRegion(
        credentials,
        region,
        request.tenantId,
        accountInternalId
      );
      
      totalVolumes += volumes.length;
      
      // Store volumes in PostgreSQL
      await storeVolumes(volumes, request.tenantId, accountInternalId);
      
    } catch (error: any) {
      console.error(`Error scanning region ${region}:`, error);
      errors.push(`${region}: ${error.message}`);
    }
  }
  
  // Update scan completion
  await updateScanStatus(request.scanId, 'completed', null, {
    volumesFound: totalVolumes,
    errors: errors.length > 0 ? errors : undefined,
  });
}

async function validateAccountOwnership(
  tenantId: string,
  accountId: string,
  roleArn: string,
  externalId: string
): Promise<boolean> {
  try {
    const query = `
      SELECT id, role_arn, external_id, is_active
      FROM aws_accounts
      WHERE account_id = $1
    `;
    
    const results = await db.queryWithTenant(tenantId, query, [accountId]);
    
    if (results.length === 0) {
      console.error(`Account ${accountId} not found for tenant ${tenantId}`);
      return false;
    }
    
    const account = results[0];
    
    // Validate account is active
    if (!account.is_active) {
      console.error(`Account ${accountId} is not active`);
      return false;
    }
    
    // Validate role ARN matches
    if (account.role_arn !== roleArn) {
      console.error(`Role ARN mismatch for account ${accountId}`);
      return false;
    }
    
    // Validate external ID
    const expectedExternalId = generateExternalId(tenantId, accountId);
    if (account.external_id !== externalId || externalId !== expectedExternalId) {
      console.error(`External ID mismatch for account ${accountId}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error validating account ownership:', error);
    return false;
  }
}

function generateExternalId(tenantId: string, accountId: string): string {
  // Generate deterministic external ID based on tenant and account
  const secret = process.env.EXTERNAL_ID_SECRET || 'default-secret';
  return crypto
    .createHmac('sha256', secret)
    .update(`${tenantId}:${accountId}`)
    .digest('hex')
    .substring(0, 32);
}

async function assumeRoleSecurely(
  roleArn: string,
  externalId: string,
  sessionName: string
) {
  const sts = new STSClient({});
  
  // Validate role ARN format
  const roleArnPattern = /^arn:aws:iam::\d{12}:role\/EBSVolumeManager-CustomerRole$/;
  if (!roleArnPattern.test(roleArn)) {
    throw new Error('Invalid role ARN format');
  }
  
  const command = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: `EBSScanner-${sessionName}`,
    ExternalId: externalId,
    DurationSeconds: 3600,
    Policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: [
            'ec2:DescribeVolumes',
            'ec2:DescribeSnapshots',
            'ec2:DescribeInstances',
          ],
          Resource: '*',
        },
      ],
    }),
  });
  
  const response = await sts.send(command);
  
  if (!response.Credentials) {
    throw new Error('Failed to assume role');
  }
  
  return response.Credentials;
}

async function scanVolumesInRegion(
  credentials: any,
  region: string,
  tenantId: string,
  accountInternalId: string
) {
  const ec2 = new EC2Client({
    region,
    credentials: {
      accessKeyId: credentials.AccessKeyId!,
      secretAccessKey: credentials.SecretAccessKey!,
      sessionToken: credentials.SessionToken!,
    },
  });
  
  const volumes = [];
  let nextToken: string | undefined;
  
  do {
    const command = new DescribeVolumesCommand({
      NextToken: nextToken,
      MaxResults: 100,
    });
    
    const response = await ec2.send(command);
    
    if (response.Volumes) {
      for (const volume of response.Volumes) {
        // Calculate monthly cost
        const monthlyHours = 730;
        const gbMonth = (volume.Size || 0);
        const iops = volume.Iops || 0;
        
        let costPerMonth = 0;
        switch (volume.VolumeType) {
          case 'gp3':
            costPerMonth = gbMonth * 0.08 + Math.max(0, iops - 3000) * 0.005;
            break;
          case 'gp2':
            costPerMonth = gbMonth * 0.10;
            break;
          case 'io1':
          case 'io2':
            costPerMonth = gbMonth * 0.125 + iops * 0.065;
            break;
          case 'st1':
            costPerMonth = gbMonth * 0.045;
            break;
          case 'sc1':
            costPerMonth = gbMonth * 0.025;
            break;
        }
        
        volumes.push({
          tenantId,
          accountInternalId,
          volumeId: volume.VolumeId,
          size: volume.Size || 0,
          volumeType: volume.VolumeType || 'unknown',
          state: volume.State || 'unknown',
          encrypted: volume.Encrypted || false,
          kmsKeyId: volume.KmsKeyId,
          region,
          availabilityZone: volume.AvailabilityZone,
          createTime: volume.CreateTime,
          iops: volume.Iops,
          throughput: volume.Throughput,
          instanceId: volume.Attachments?.[0]?.InstanceId,
          device: volume.Attachments?.[0]?.Device,
          attachTime: volume.Attachments?.[0]?.AttachTime,
          costPerMonth,
          tags: volume.Tags || [],
          scannedAt: new Date(),
        });
      }
    }
    
    nextToken = response.NextToken;
  } while (nextToken);
  
  return volumes;
}

async function storeVolumes(volumes: any[], tenantId: string, accountInternalId: string) {
  if (volumes.length === 0) return;
  
  await db.transactionWithTenant(tenantId, async (client) => {
    for (const volume of volumes) {
      await client.query(
        `INSERT INTO ebs_volumes (
          tenant_id, aws_account_id, volume_id, size_gb, volume_type,
          state, encrypted, kms_key_id, region, availability_zone,
          created_at, iops, throughput, instance_id, device,
          attached_at, cost_per_month, tags, last_scanned_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        ON CONFLICT (tenant_id, volume_id) 
        DO UPDATE SET
          state = EXCLUDED.state,
          instance_id = EXCLUDED.instance_id,
          device = EXCLUDED.device,
          attached_at = EXCLUDED.attached_at,
          cost_per_month = EXCLUDED.cost_per_month,
          tags = EXCLUDED.tags,
          last_scanned_at = EXCLUDED.last_scanned_at,
          updated_at = NOW()`,
        [
          tenantId,
          accountInternalId,
          volume.volumeId,
          volume.size,
          volume.volumeType,
          volume.state,
          volume.encrypted,
          volume.kmsKeyId,
          volume.region,
          volume.availabilityZone,
          volume.createTime,
          volume.iops,
          volume.throughput,
          volume.instanceId,
          volume.device,
          volume.attachTime,
          volume.costPerMonth,
          JSON.stringify(volume.tags),
          volume.scannedAt,
        ]
      );
    }
  });
}

async function getAccountInternalId(tenantId: string, accountId: string): Promise<string> {
  const results = await db.queryWithTenant(
    tenantId,
    'SELECT id FROM aws_accounts WHERE account_id = $1',
    [accountId]
  );
  
  if (results.length === 0) {
    throw new Error(`Account ${accountId} not found`);
  }
  
  return results[0].id;
}

async function updateScanStatus(
  scanId: string,
  status: string,
  error?: string,
  metrics?: any
) {
  const query = `
    UPDATE scan_history 
    SET status = $2, 
        error_message = $3,
        metrics = $4,
        completed_at = CASE WHEN $2 IN ('completed', 'failed') THEN NOW() ELSE NULL END,
        updated_at = NOW()
    WHERE scan_id = $1
  `;
  
  // Note: scan_history might not have tenant_id as PK, so we can't use queryWithTenant
  // This needs to be fixed in the schema
  await db.queryWithTenant(
    'system', // or extract from scan record
    query,
    [scanId, status, error, metrics ? JSON.stringify(metrics) : null]
  );
}
