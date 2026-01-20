#!/bin/bash

# Main deployment script for State Tracking API
# Usage: ./scripts/deploy.sh [stage]
# Example: ./scripts/deploy.sh production

set -e

STAGE=${1:-dev}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Validate stage
if [[ ! "$STAGE" =~ ^(dev|staging|production)$ ]]; then
  echo "Error: Invalid stage '$STAGE'"
  echo "Usage: ./scripts/deploy.sh [dev|staging|production]"
  exit 1
fi

echo "========================================"
echo "Deploying State Tracking API"
echo "Stage: $STAGE"
echo "========================================"
echo ""

# Check prerequisites
echo "Checking prerequisites..."

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "Error: Node.js version 18 or higher required (current: $(node --version))"
  exit 1
fi
echo "✓ Node.js version: $(node --version)"

# Check pnpm
if ! command -v pnpm &> /dev/null; then
  echo "Error: pnpm is not installed"
  echo "Install with: npm install -g pnpm"
  exit 1
fi
echo "✓ pnpm version: $(pnpm --version)"

# Check AWS CLI
if ! command -v aws &> /dev/null; then
  echo "Error: AWS CLI is not installed"
  echo "Install from: https://aws.amazon.com/cli/"
  exit 1
fi
echo "✓ AWS CLI version: $(aws --version)"

# Verify AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
  echo "Error: AWS credentials not configured or invalid"
  echo "Run: aws configure"
  exit 1
fi
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "✓ AWS Account: $ACCOUNT_ID"
echo ""

# Production safety check
if [ "$STAGE" = "production" ]; then
  echo "⚠️  WARNING: You are about to deploy to PRODUCTION"
  echo ""
  read -p "Are you sure you want to continue? (yes/no): " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Deployment cancelled"
    exit 0
  fi
  echo ""
fi

# Navigate to project root
cd "$PROJECT_ROOT"

# Install dependencies
echo "Installing dependencies..."
pnpm install --frozen-lockfile
echo "✓ Dependencies installed"
echo ""

# Run tests (skip for dev)
if [ "$STAGE" != "dev" ]; then
  echo "Running tests..."
  pnpm test
  echo "✓ Tests passed"
  echo ""
fi

# Check if secrets are configured
echo "Checking SST secrets..."
SECRET_COUNT=$(pnpm sst secret list --stage "$STAGE" 2>/dev/null | grep -c "MongoDBUri\|ApiKeys" || echo "0")
if [ "$SECRET_COUNT" -lt 2 ]; then
  echo "⚠️  Warning: Secrets may not be configured for stage '$STAGE'"
  echo "Run: ./scripts/setup-secrets.sh $STAGE"
  echo ""
  read -p "Continue anyway? (yes/no): " CONTINUE
  if [ "$CONTINUE" != "yes" ]; then
    echo "Deployment cancelled"
    exit 0
  fi
fi
echo "✓ Secrets configured"
echo ""

# Build the application
echo "Building application..."
pnpm build
echo "✓ Build completed"
echo ""

# Deploy with SST
echo "Deploying to AWS..."
echo "Stage: $STAGE"
echo "Region: us-east-1"
echo ""

pnpm sst deploy --stage "$STAGE"

echo ""
echo "========================================"
echo "✅ Deployment completed successfully!"
echo "========================================"
echo ""
echo "Stage: $STAGE"
echo "Region: us-east-1"
echo ""

# Get the API endpoint
echo "Getting API endpoint..."
API_URL=$(pnpm sst deploy --stage "$STAGE" 2>&1 | grep -o 'https://[^[:space:]]*' | head -1 || echo "")
if [ -n "$API_URL" ]; then
  echo "API Endpoint: $API_URL"
else
  echo "API Endpoint: Check SST output or AWS Console"
fi
echo ""

# Next steps
echo "Next steps:"
echo "  1. Verify deployment: ./scripts/verify-deployment.sh $STAGE"
echo "  2. View logs: aws logs tail /aws/lambda/claude-projects-state-api-$STAGE --follow"
echo "  3. Monitor: https://console.aws.amazon.com/cloudwatch/home?region=us-east-1"
echo ""

if [ "$STAGE" = "production" ]; then
  echo "Production deployment checklist:"
  echo "  □ Test health endpoint"
  echo "  □ Verify custom domain (claude-projects.truapi.com)"
  echo "  □ Check CloudWatch alarms"
  echo "  □ Review error logs"
  echo "  □ Monitor for 15 minutes"
  echo ""
fi
