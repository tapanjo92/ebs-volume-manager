// lib/lambda/utils/db-connection.ts
import { Client, Pool, PoolClient } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsManager = new SecretsManagerClient({});

interface DbCredentials {
  username: string;
  password: string;
  host: string;
  port: number;
  database: string;
}

// Cache credentials in Lambda memory
let cachedCredentials: DbCredentials | null = null;

export class TenantAwareDbConnection {
  private pool: Pool | null = null;
  
  async getCredentials(): Promise<DbCredentials> {
    if (cachedCredentials) return cachedCredentials;
    
    const response = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN! })
    );
    
    if (!response.SecretString) {
      throw new Error('Database credentials not found');
    }
    
    const secret = JSON.parse(response.SecretString);
    cachedCredentials = {
      host: process.env.DB_PROXY_ENDPOINT!,
      port: 5432,
      database: 'ebsmanager',
      username: secret.username,
      password: secret.password,
    };
    
    return cachedCredentials;
  }
  
  async getPool(): Promise<Pool> {
    if (!this.pool) {
      const credentials = await getCredentials();
      this.pool = new Pool({
        ...credentials,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
        ssl: { rejectUnauthorized: false },
      });
    }
    return this.pool;
  }
  
  /**
   * Execute a query with tenant isolation
   * CRITICAL: This ensures RLS policies are enforced
   */
  async queryWithTenant<T = any>(
    tenantId: string,
    query: string,
    params: any[] = []
  ): Promise<T[]> {
    const pool = await this.getPool();
    const client = await pool.connect();
    
    try {
      // CRITICAL: Set tenant context for RLS
      await client.query('SELECT set_config($1, $2, false)', [
        'app.current_tenant_id',
        tenantId
      ]);
      
      const result = await client.query(query, params);
      return result.rows;
    } finally {
      // CRITICAL: Reset tenant context before returning connection
      await client.query("SELECT set_config('app.current_tenant_id', '', false)");
      client.release();
    }
  }
  
  /**
   * Execute a transaction with tenant isolation
   */
  async transactionWithTenant<T = any>(
    tenantId: string,
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const pool = await this.getPool();
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Set tenant context
      await client.query('SELECT set_config($1, $2, false)', [
        'app.current_tenant_id',
        tenantId
      ]);
      
      const result = await callback(client);
      
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await client.query("SELECT set_config('app.current_tenant_id', '', false)");
      client.release();
    }
  }
  
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

// Singleton instance for Lambda reuse
export const db = new TenantAwareDbConnection();
