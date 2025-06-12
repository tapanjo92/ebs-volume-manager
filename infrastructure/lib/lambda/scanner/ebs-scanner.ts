import { Handler, SQSEvent } from 'aws-lambda';
import { EC2Client, DescribeVolumesCommand, DescribeSnapshotsCommand } from '@aws-sdk/client-ec2';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const sts = new STSClient({});
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cloudwatch = new CloudWatchClient({});

interface ScanRequest {
  tenantId: string;
  accountId: string;
  roleArn: string;
  externalId: string;
  regions: string[];
  scanId: string;
}

export const handler: Handler<SQSEvent> = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  for (const record of event.Records) {
    const scanRequest: ScanRequest = JSON.parse(record.body);
    
    try {
      await processScanRequest(scanRequest);
    } catch (error) {
      console.error('Error processing scan request:', error);
      // Update scan status to failed
      await updateScanStatus(scanRequest.scanId, 'failed', error.message);
      throw error;
    }
  }
};

async function processScanRequest(request: ScanRequest) {
  console.log(`Processing scan for tenant ${request.tenantId}, account ${request.accountId}`);
  
  // Update scan status to in-progress
  await updateScanStatus(request.scanId, 'in-progress');
  
  // Assume role in target account
  const credentials = await assumeRole(request.roleArn, request.externalId);
  
  let totalVolumes = 0;
  let totalSnapshots = 0;
  
  // Scan each region
  for (const region of request.regions) {
    console.log(`Scanning region ${region}`);
    
    const ec2 = new EC2Client({
      region,
      credentials: {
        accessKeyId: credentials.AccessKeyId!,
        secretAccessKey: credentials.SecretAccessKey!,
        sessionToken: credentials.SessionToken!,
      },
    });
    
    // Scan volumes
    const volumes = await scanVolumes(ec2, request.tenantId, request.accountId, region);
    totalVolumes += volumes.length;
    
    // Scan snapshots
    const snapshots = await scanSnapshots(ec2, request.tenantId, request.accountId, region);
    totalSnapshots += snapshots.length;
    
    // Store results
    await storeVolumeData(volumes, request.tenantId);
    await storeSnapshotData(snapshots, request.tenantId);
  }
  
  // Update scan status to completed
  await updateScanStatus(request.scanId, 'completed', null, {
    volumesFound: totalVolumes,
    snapshotsFound: totalSnapshots,
  });
  
  // Send metrics
  await sendMetrics(request.tenantId, totalVolumes, totalSnapshots);
}

async function assumeRole(roleArn: string, externalId: string) {
  const command = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: `EBSScanner-${Date.now()}`,
    ExternalId: externalId,
    DurationSeconds: 3600,
  });
  
  const response = await sts.send(command);
  
  if (!response.Credentials) {
    throw new Error('Failed to assume role');
  }
  
  return response.Credentials;
}

async function scanVolumes(ec2: EC2Client, tenantId: string, accountId: string, region: string) {
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
        volumes.push({
          tenantId,
          accountId,
          region,
          volumeId: volume.VolumeId,
          size: volume.Size,
          volumeType: volume.VolumeType,
          state: volume.State,
          encrypted: volume.Encrypted,
          kmsKeyId: volume.KmsKeyId,
          createTime: volume.CreateTime?.toISOString(),
          availabilityZone: volume.AvailabilityZone,
          iops: volume.Iops,
          throughput: volume.Throughput,
          attachments: volume.Attachments?.map(a => ({
            instanceId: a.InstanceId,
            device: a.Device,
            state: a.State,
            attachTime: a.AttachTime?.toISOString(),
          })),
          tags: volume.Tags?.reduce((acc, tag) => {
            acc[tag.Key!] = tag.Value!;
            return acc;
          }, {} as Record<string, string>),
          discoveredAt: new Date().toISOString(),
        });
      }
    }
    
    nextToken = response.NextToken;
  } while (nextToken);
  
  return volumes;
}

async function scanSnapshots(ec2: EC2Client, tenantId: string, accountId: string, region: string) {
  const snapshots = [];
  let nextToken: string | undefined;
  
  do {
    const command = new DescribeSnapshotsCommand({
      OwnerIds: [accountId],
      NextToken: nextToken,
      MaxResults: 100,
    });
    
    const response = await ec2.send(command);
    
    if (response.Snapshots) {
      for (const snapshot of response.Snapshots) {
        snapshots.push({
          tenantId,
          accountId,
          region,
          snapshotId: snapshot.SnapshotId,
          volumeId: snapshot.VolumeId,
          size: snapshot.VolumeSize,
          state: snapshot.State,
          progress: snapshot.Progress,
          encrypted: snapshot.Encrypted,
          kmsKeyId: snapshot.KmsKeyId,
          startTime: snapshot.StartTime?.toISOString(),
          description: snapshot.Description,
          tags: snapshot.Tags?.reduce((acc, tag) => {
            acc[tag.Key!] = tag.Value!;
            return acc;
          }, {} as Record<string, string>),
          discoveredAt: new Date().toISOString(),
        });
      }
    }
    
    nextToken = response.NextToken;
  } while (nextToken);
  
  return snapshots;
}

async function storeVolumeData(volumes: any[], tenantId: string) {
  const tableName = process.env.VOLUMES_TABLE_NAME!;
  
  for (const volume of volumes) {
    await dynamodb.send(new PutCommand({
      TableName: tableName,
      Item: volume,
    }));
  }
}

async function storeSnapshotData(snapshots: any[], tenantId: string) {
  const tableName = process.env.SNAPSHOTS_TABLE_NAME!;
  
  for (const snapshot of snapshots) {
    await dynamodb.send(new PutCommand({
      TableName: tableName,
      Item: snapshot,
    }));
  }
}

async function updateScanStatus(
  scanId: string,
  status: string,
  error?: string,
  metrics?: Record<string, number>
) {
  const tableName = process.env.SCAN_HISTORY_TABLE_NAME!;
  
  const updateExpression = ['SET #status = :status', 'updatedAt = :updatedAt'];
  const expressionAttributeNames: Record<string, string> = { '#status': 'status' };
  const expressionAttributeValues: Record<string, any> = {
    ':status': status,
    ':updatedAt': new Date().toISOString(),
  };
  
  if (error) {
    updateExpression.push('errorMessage = :error');
    expressionAttributeValues[':error'] = error;
  }
  
  if (metrics) {
    updateExpression.push('metrics = :metrics');
    expressionAttributeValues[':metrics'] = metrics;
  }
  
  if (status === 'completed' || status === 'failed') {
    updateExpression.push('completedAt = :completedAt');
    expressionAttributeValues[':completedAt'] = new Date().toISOString();
  }
  
  await dynamodb.send(new UpdateCommand({
    TableName: tableName,
    Key: { scanId },
    UpdateExpression: updateExpression.join(', '),
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}

async function sendMetrics(tenantId: string, volumeCount: number, snapshotCount: number) {
  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: 'EBSManager',
    MetricData: [
      {
        MetricName: 'VolumesDiscovered',
        Value: volumeCount,
        Unit: 'Count',
        Dimensions: [{ Name: 'TenantId', Value: tenantId }],
        Timestamp: new Date(),
      },
      {
        MetricName: 'SnapshotsDiscovered',
        Value: snapshotCount,
        Unit: 'Count',
        Dimensions: [{ Name: 'TenantId', Value: tenantId }],
        Timestamp: new Date(),
      },
    ],
  }));
}
