import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = process.env.VOLUMES_TABLE_NAME!;

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
    
    // Route based on HTTP method and path
    const method = event.httpMethod;
    const volumeId = event.pathParameters?.volumeId;
    
    if (method === 'GET' && !volumeId) {
      return await listVolumes(tenantId, event.queryStringParameters);
    } else if (method === 'GET' && volumeId) {
      return await getVolume(tenantId, volumeId);
    } else if (method === 'DELETE' && volumeId) {
      return await deleteVolume(tenantId, volumeId);
    }
    
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      },
      body: JSON.stringify({ error: 'Invalid request' }),
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

async function listVolumes(tenantId: string, queryParams: any) {
  const params = {
    TableName: tableName,
    KeyConditionExpression: 'tenantId = :tenantId',
    ExpressionAttributeValues: {
      ':tenantId': tenantId,
    },
    Limit: queryParams?.limit ? parseInt(queryParams.limit) : 100,
  };
  
  if (queryParams?.nextToken) {
    params['ExclusiveStartKey'] = JSON.parse(Buffer.from(queryParams.nextToken, 'base64').toString());
  }
  
  const response = await dynamodb.send(new QueryCommand(params));
  
  const result: any = {
    volumes: response.Items || [],
  };
  
  if (response.LastEvaluatedKey) {
    result.nextToken = Buffer.from(JSON.stringify(response.LastEvaluatedKey)).toString('base64');
  }
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    },
    body: JSON.stringify(result),
  };
}

async function getVolume(tenantId: string, volumeId: string) {
  const response = await dynamodb.send(new GetCommand({
    TableName: tableName,
    Key: {
      tenantId,
      volumeId,
    },
  }));
  
  if (!response.Item) {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      },
      body: JSON.stringify({ error: 'Volume not found' }),
    };
  }
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    },
    body: JSON.stringify(response.Item),
  };
}

async function deleteVolume(tenantId: string, volumeId: string) {
  // In production, this would trigger actual EBS volume deletion
  // For now, just mark as deleted in DynamoDB
  
  await dynamodb.send(new DeleteCommand({
    TableName: tableName,
    Key: {
      tenantId,
      volumeId,
    },
  }));
  
  return {
    statusCode: 204,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    },
    body: '',
  };
}
