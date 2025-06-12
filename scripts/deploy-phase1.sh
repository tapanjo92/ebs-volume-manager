#!/bin/bash
set -e

echo "🚀 Starting Phase 1 Deployment..."

# Check prerequisites
command -v aws >/dev/null 2>&1 || { echo "AWS CLI is required but not installed. Aborting." >&2; exit 1; }
command -v cdk >/dev/null 2>&1 || { echo "AWS CDK is required but not installed. Aborting." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js is required but not installed. Aborting." >&2; exit 1; }

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-ap-south-1}

echo "📦 Deploying to Account: $ACCOUNT_ID, Region: $REGION"

# Deploy infrastructure
cd ../infrastructure

echo "📚 Installing dependencies..."
npm install

echo "🔨 Building CDK app..."
npm run build

echo "🏗️  Deploying VPC Stack..."
cdk deploy ebs-volume-manager-vpc-development --require-approval never

echo "🔐 Deploying Cognito Stack..."
cdk deploy ebs-volume-manager-cognito-development --require-approval never --outputs-file ../cognito-outputs.json

echo "💾 Deploying Database Stack..."
cdk deploy ebs-volume-manager-database-development --require-approval never

echo "🔍 Deploying Scanner Stack..."
cdk deploy ebs-volume-manager-scanner-development --require-approval never

echo "🌐 Deploying API Stack..."
cdk deploy ebs-volume-manager-api-development --require-approval never --outputs-file ../api-outputs.json

# Extract outputs
cd ..
USER_POOL_ID=$(jq -r '.["ebs-volume-manager-cognito-development"].UserPoolId' cognito-outputs.json)
USER_POOL_CLIENT_ID=$(jq -r '.["ebs-volume-manager-cognito-development"].UserPoolClientId' cognito-outputs.json)
IDENTITY_POOL_ID=$(jq -r '.["ebs-volume-manager-cognito-development"].IdentityPoolId' cognito-outputs.json)
API_URL=$(jq -r '.["ebs-volume-manager-api-development"].ApiUrl' api-outputs.json)

# Update frontend environment
cd frontend
cat > .env.local << 'ENVEOF'
NEXT_PUBLIC_AWS_REGION=$REGION
NEXT_PUBLIC_USER_POOL_ID=$USER_POOL_ID
NEXT_PUBLIC_USER_POOL_CLIENT_ID=$USER_POOL_CLIENT_ID
NEXT_PUBLIC_IDENTITY_POOL_ID=$IDENTITY_POOL_ID
NEXT_PUBLIC_API_BASE_URL=$API_URL
ENVEOF

echo "🎨 Building frontend..."
npm install
npm run build

echo "✅ Phase 1 Deployment Complete!"
echo ""
echo "🔑 Cognito User Pool ID: $USER_POOL_ID"
echo "🔑 Cognito Client ID: $USER_POOL_CLIENT_ID"
echo "🌐 API URL: $API_URL"
echo ""
echo "📝 Next steps:"
echo "1. Run 'npm run dev' in the frontend directory to start the development server"
echo "2. Create a test user in Cognito User Pool"
echo "3. Configure AWS accounts for scanning"
