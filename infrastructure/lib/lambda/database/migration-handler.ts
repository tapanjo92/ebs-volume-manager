import { Handler } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const secretsManager = new SecretsManagerClient({});

interface MigrationEvent {
  secretArn: string;
  proxyEndpoint: string;
  action: 'migrate' | 'rollback';
}

export const handler: Handler<MigrationEvent> = async (event) => {
  console.log('Migration event:', JSON.stringify(event, null, 2));
  
  // Get database credentials
  const credentials = await getDatabaseCredentials(event.secretArn);
  
  // Create database connection
  const client = new Client({
    host: event.proxyEndpoint,
    port: 5432,
    database: 'ebsmanager',
    user: credentials.username,
    password: credentials.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });
  
  try {
    await client.connect();
    console.log('Connected to database');
    
    if (event.action === 'migrate') {
      await runMigrations(client);
    } else if (event.action === 'rollback') {
      await rollbackMigrations(client);
    }
    
    return {
      statusCode: 200,
      message: `Database ${event.action} completed successfully`,
    };
  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  } finally {
    await client.end();
  }
};

async function getDatabaseCredentials(secretArn: string) {
  const response = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );
  
  if (!response.SecretString) {
    throw new Error('Secret value not found');
  }
  
  return JSON.parse(response.SecretString);
}

async function runMigrations(client: Client) {
  // Create migrations table if not exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      executed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Get list of migration files
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).sort();
  
  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    
    const version = file.replace('.sql', '');
    
    // Check if migration already executed
    const result = await client.query(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [version]
    );
    
    if (result.rows.length > 0) {
      console.log(`Migration ${version} already executed, skipping`);
      continue;
    }
    
    console.log(`Running migration ${version}`);
    
    // Read and execute migration
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version]
      );
      await client.query('COMMIT');
      console.log(`Migration ${version} completed`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${version} failed: ${error.message}`);
    }
  }
}

async function rollbackMigrations(client: Client) {
  // Implementation for rollback logic
  console.log('Rollback not implemented yet');
}
