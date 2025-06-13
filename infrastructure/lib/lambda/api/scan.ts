import { APIGatewayProxyHandler } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';

const sqs = new SQSClient({});
const queueUrl = process.env.SCAN_QUEUE_URL!;

const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Credentials': 'true',
};

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    // Extract tenant ID from JWT claims
    const claims = event.requestContext.authorizer?.claims;
    const tenantId = claims?.tenantId;
    
    if (!tenantId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        },
        body: JSON.stringify({ error: 'Unauthorized: Missing tenant ID' }),
      };
    }
    
    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { accountId, roleArn, externalId, regions = ['us-east-1'] } = body;
    
    if (!accountId || !roleArn || !externalId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        },
        body: JSON.stringify({ error: 'Missing required parameters' }),
      };
    }
    
    // Create scan request
    const scanId = uuidv4();
    const scanRequest = {
      scanId,
      tenantId,
      accountId,
      roleArn,
      externalId,
      regions,
      requestedAt: new Date().toISOString(),
    };
    
    // Send to SQS
    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(scanRequest),
    }));
    
    return {
      statusCode: 202,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      },
      body: JSON.stringify({
        scanId,
        status: 'queued',
        message: 'Scan request queued successfully',
      }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
