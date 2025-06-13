-- infrastructure/lib/database/migrations/000_initial_tables.sql
-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tenant management
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    subdomain VARCHAR(100) UNIQUE,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User management (linked to Cognito)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    cognito_user_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    status VARCHAR(50) DEFAULT 'active',
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AWS Accounts
CREATE TABLE aws_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    account_id VARCHAR(12) NOT NULL,
    account_alias VARCHAR(255),
    role_arn VARCHAR(512) NOT NULL,
    external_id VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    regions TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, account_id)
);

-- EBS Volumes
CREATE TABLE ebs_volumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    aws_account_id UUID REFERENCES aws_accounts(id),
    volume_id VARCHAR(255) NOT NULL,
    size_gb INTEGER NOT NULL,
    volume_type VARCHAR(50),
    state VARCHAR(50),
    encrypted BOOLEAN DEFAULT false,
    kms_key_id VARCHAR(512),
    region VARCHAR(50) NOT NULL,
    availability_zone VARCHAR(50),
    created_at TIMESTAMP,
    iops INTEGER,
    throughput INTEGER,
    instance_id VARCHAR(255),
    device VARCHAR(50),
    attached_at TIMESTAMP,
    cost_per_month DECIMAL(10, 2),
    utilization_percent INTEGER,
    tags JSONB,
    last_scanned_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, volume_id)
);

-- Volume Snapshots
CREATE TABLE volume_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    volume_id UUID REFERENCES ebs_volumes(id),
    snapshot_id VARCHAR(255) NOT NULL,
    size_gb INTEGER NOT NULL,
    state VARCHAR(50),
    progress VARCHAR(50),
    encrypted BOOLEAN DEFAULT false,
    kms_key_id VARCHAR(512),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    description TEXT,
    tags JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, snapshot_id)
);

-- Scan History
CREATE TABLE scan_history (
    scan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    aws_account_id UUID REFERENCES aws_accounts(id),
    status VARCHAR(50) NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    volumes_found INTEGER DEFAULT 0,
    snapshots_found INTEGER DEFAULT 0,
    error_message TEXT,
    metrics JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit Logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_volumes_tenant_id ON ebs_volumes(tenant_id);
CREATE INDEX idx_volumes_account_id ON ebs_volumes(aws_account_id);
CREATE INDEX idx_volumes_state ON ebs_volumes(state);
CREATE INDEX idx_volumes_region ON ebs_volumes(region);
CREATE INDEX idx_snapshots_volume_id ON volume_snapshots(volume_id);
CREATE INDEX idx_scan_history_tenant_id ON scan_history(tenant_id);
CREATE INDEX idx_scan_history_account_id ON scan_history(aws_account_id);
