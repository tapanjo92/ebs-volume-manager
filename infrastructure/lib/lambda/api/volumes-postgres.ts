// lib/lambda/api/volumes-postgres.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { db } from '../utils/db-connection';

const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Credentials': 'true',
  'Content-Type': 'application/json',
};

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    // Extract tenant ID from JWT claims - CRITICAL for security
    const claims = event.requestContext.authorizer?.claims;
    const tenantId = claims?.['custom:tenant_id'] || claims?.tenantId;
    const userRole = claims?.['custom:user_role'] || claims?.userRole || 'user';
    const permissions = claims?.permissions || '';
    
    if (!tenantId) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Unauthorized: Missing tenant ID',
          code: 'MISSING_TENANT_ID' 
        }),
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
      // Check permissions
      if (!permissions.includes('volumes:delete')) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ 
            error: 'Insufficient permissions',
            code: 'FORBIDDEN' 
          }),
        };
      }
      return await deleteVolume(tenantId, volumeId, userRole, event);
    }
    
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Invalid request',
        code: 'BAD_REQUEST' 
      }),
    };
  } catch (error) {
    console.error('Error:', error);
    
    // Don't expose internal errors
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        requestId: event.requestContext.requestId 
      }),
    };
  }
};

async function listVolumes(tenantId: string, queryParams: any) {
  try {
    const limit = Math.min(parseInt(queryParams?.limit || '50'), 100);
    const offset = parseInt(queryParams?.offset || '0');
    const state = queryParams?.state;
    const region = queryParams?.region;
    
    // Build query with filters
    let query = `
      SELECT 
        v.*,
        a.account_alias,
        a.account_id,
        COUNT(*) OVER() as total_count
      FROM ebs_volumes v
      JOIN aws_accounts a ON v.aws_account_id = a.id
      WHERE v.tenant_id = a.tenant_id
    `;
    
    const params: any[] = [];
    let paramIndex = 1;
    
    if (state) {
      query += ` AND v.state = $${paramIndex++}`;
      params.push(state);
    }
    
    if (region) {
      query += ` AND v.region = $${paramIndex++}`;
      params.push(region);
    }
    
    query += ` ORDER BY v.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);
    
    // Execute with tenant isolation
    const volumes = await db.queryWithTenant(tenantId, query, params);
    
    const totalCount = volumes.length > 0 ? volumes[0].total_count : 0;
    
    // Remove total_count from results
    const cleanedVolumes = volumes.map(({ total_count, ...volume }) => volume);
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        volumes: cleanedVolumes,
        pagination: {
          limit,
          offset,
          total: totalCount,
          hasMore: offset + limit < totalCount,
        },
      }),
    };
  } catch (error) {
    console.error('Error listing volumes:', error);
    throw error;
  }
}

async function getVolume(tenantId: string, volumeId: string) {
  try {
    const query = `
      SELECT 
        v.*,
        a.account_alias,
        a.account_id,
        vs.snapshot_id,
        vs.created_at as snapshot_created_at
      FROM ebs_volumes v
      JOIN aws_accounts a ON v.aws_account_id = a.id
      LEFT JOIN volume_snapshots vs ON v.id = vs.volume_id
      WHERE v.volume_id = $1
      ORDER BY vs.created_at DESC
    `;
    
    const results = await db.queryWithTenant(tenantId, query, [volumeId]);
    
    if (results.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Volume not found',
          code: 'NOT_FOUND' 
        }),
      };
    }
    
    // Aggregate snapshots
    const volume = { ...results[0] };
    volume.snapshots = results
      .filter(r => r.snapshot_id)
      .map(r => ({
        snapshot_id: r.snapshot_id,
        created_at: r.snapshot_created_at,
      }));
    
    // Clean up response
    delete volume.snapshot_id;
    delete volume.snapshot_created_at;
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(volume),
    };
  } catch (error) {
    console.error('Error getting volume:', error);
    throw error;
  }
}

async function deleteVolume(tenantId: string, volumeId: string, userRole: string, event: any) {
  try {
    // Additional check for admin role
    if (userRole !== 'admin') {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Only admins can delete volumes',
          code: 'FORBIDDEN' 
        }),
      };
    }
    
    // Use transaction for audit trail
    const result = await db.transactionWithTenant(tenantId, async (client) => {
      // Check if volume exists and belongs to tenant
      const checkResult = await client.query(
        'SELECT id, state FROM ebs_volumes WHERE volume_id = $1',
        [volumeId]
      );
      
      if (checkResult.rows.length === 0) {
        throw new Error('Volume not found');
      }
      
      const volume = checkResult.rows[0];
      
      if (volume.state === 'in-use') {
        throw new Error('Cannot delete volume that is in use');
      }
      
      // Update state to deleting
      await client.query(
        'UPDATE ebs_volumes SET state = $1, updated_at = NOW() WHERE id = $2',
        ['deleting', volume.id]
      );
      
      // Create audit log
      await client.query(
        `INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, details)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          tenantId,
          event.requestContext.authorizer?.claims?.sub,
          'DELETE_VOLUME',
          'EBS_VOLUME',
          volumeId,
          JSON.stringify({ userRole, timestamp: new Date().toISOString() })
        ]
      );
      
      return volume;
    });
    
    // TODO: Trigger actual AWS EBS deletion via SQS
    
    return {
      statusCode: 202,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Volume deletion initiated',
        volumeId,
        status: 'deleting' 
      }),
    };
  } catch (error: any) {
    console.error('Error deleting volume:', error);
    
    if (error.message === 'Volume not found') {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Volume not found',
          code: 'NOT_FOUND' 
        }),
      };
    }
    
    if (error.message.includes('in use')) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: error.message,
          code: 'CONFLICT' 
        }),
      };
    }
    
    throw error;
  }
}
