CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);

-- Enable Row Level Security
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE aws_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebs_volumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE volume_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Tenants: Users can only see their own tenant
CREATE POLICY tenant_isolation ON tenants
    FOR ALL
    USING (id = current_setting('app.current_tenant_id')::UUID);

-- Users: Can only see users in their tenant
CREATE POLICY user_tenant_isolation ON users
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- AWS Accounts: Tenant isolation
CREATE POLICY aws_account_tenant_isolation ON aws_accounts
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- EBS Volumes: Tenant isolation
CREATE POLICY volume_tenant_isolation ON ebs_volumes
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Snapshots: Tenant isolation
CREATE POLICY snapshot_tenant_isolation ON volume_snapshots
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Scan History: Tenant isolation
CREATE POLICY scan_tenant_isolation ON scan_history
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Audit Logs: Tenant isolation
CREATE POLICY audit_tenant_isolation ON audit_logs
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Create update trigger for updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_aws_accounts_updated_at BEFORE UPDATE ON aws_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ebs_volumes_updated_at BEFORE UPDATE ON ebs_volumes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to set tenant context
CREATE OR REPLACE FUNCTION set_tenant_context(tenant_id UUID)
RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_tenant_id', tenant_id::text, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create view for volume statistics
CREATE VIEW volume_statistics AS
SELECT 
    tenant_id,
    COUNT(*) as total_volumes,
    SUM(size_gb) as total_size_gb,
    SUM(CASE WHEN state = 'available' THEN 1 ELSE 0 END) as available_volumes,
    SUM(CASE WHEN state = 'in-use' THEN 1 ELSE 0 END) as in_use_volumes,
    SUM(CASE WHEN instance_id IS NULL THEN size_gb ELSE 0 END) as unattached_size_gb,
    SUM(cost_per_month) as total_monthly_cost,
    AVG(utilization_percent) as avg_utilization
FROM ebs_volumes
WHERE state NOT IN ('deleted', 'deleting')
GROUP BY tenant_id;

-- Grant permissions to application role (to be created)
-- This will be run after creating the application database user
