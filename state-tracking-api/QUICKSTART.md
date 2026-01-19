# Quick Start Guide

Fast-track guide to deploy the Claude Projects State Tracking API.

## 🚀 First-Time Setup

### 1. Prerequisites Check

```bash
# Verify Node.js version (18 or 20)
node --version

# Verify pnpm is installed
pnpm --version

# Verify AWS CLI is configured
aws sts get-caller-identity
```

### 2. Install Dependencies

```bash
cd state-tracking-api
pnpm install
```

### 3. Local Development (Optional)

Test locally before deploying:

```bash
# Create .env file
cp .env.example .env

# Edit .env with local MongoDB URI
# MONGODB_URI=mongodb://localhost:27017/claude-projects-dev
# API_KEYS=dev-key-1,dev-key-2

# Start local server
pnpm start:dev

# Test health endpoint
curl http://localhost:3000/health
```

## ☁️ Deploy to AWS

### Development Environment

```bash
# Set secrets (one-time)
pnpm sst secret set MongoDBUri "mongodb+srv://user:pass@cluster.mongodb.net/dev" --stage dev
pnpm sst secret set ApiKeys "dev-key-1,dev-key-2" --stage dev

# Deploy
pnpm deploy:dev

# Output will show API endpoint:
# ✔  Complete
#    api: https://abc123.execute-api.us-east-1.amazonaws.com
```

### Staging Environment

```bash
# Use helper script to set secrets
./scripts/setup-secrets.sh staging

# Or manually:
pnpm sst secret set MongoDBUri "mongodb+srv://..." --stage staging
pnpm sst secret set ApiKeys "staging-key-1,staging-key-2" --stage staging

# Deploy
pnpm deploy:staging
```

### Production Environment

```bash
# Set secrets from senvn (recommended)
./scripts/setup-secrets.sh production

# Deploy
pnpm deploy:prod

# Production uses custom domain: claude-projects.truapi.com
```

## 🧪 Test Deployment

```bash
# Get your API URL from deployment output
API_URL="https://abc123.execute-api.us-east-1.amazonaws.com"

# Test health endpoint (no auth required)
curl $API_URL/health

# Test authenticated endpoint
curl -H "X-Api-Key: your-api-key" $API_URL/api/sessions

# View Swagger docs
open $API_URL/api/docs
```

## 📊 Monitoring

```bash
# View logs
aws logs tail /aws/lambda/claude-projects-state-api-dev --follow

# Or use SST console
pnpm sst console --stage dev
```

## 🔄 Update Deployment

```bash
# Make code changes, then redeploy
pnpm deploy:dev

# SST will update the existing stack
```

## 🗑️ Remove Deployment

```bash
# Remove dev environment
pnpm remove:dev

# Remove staging environment
pnpm remove:staging

# Production cannot be removed via script (retention policy)
```

## 🔐 Manage Secrets

```bash
# View all secrets for a stage
pnpm sst secret list --stage dev

# Update a secret
pnpm sst secret set MongoDBUri "new-value" --stage dev

# Remove a secret
pnpm sst secret remove MongoDBUri --stage dev
```

## 🐛 Common Issues

### "No AWS credentials found"

```bash
# Configure AWS CLI
aws configure

# Or set AWS_PROFILE
export AWS_PROFILE=your-profile-name
```

### "Secret not found" errors in Lambda

```bash
# Verify secrets are set
pnpm sst secret list --stage dev

# Re-set secrets
pnpm sst secret set MongoDBUri "..." --stage dev
pnpm sst secret set ApiKeys "..." --stage dev
```

### Deployment hangs or fails

```bash
# Check CloudFormation stack status
aws cloudformation describe-stacks \
  --stack-name claude-projects-state-api-dev

# View stack events
aws cloudformation describe-stack-events \
  --stack-name claude-projects-state-api-dev
```

## 📖 Next Steps

For detailed information, see:

- [DEPLOYMENT.md](./DEPLOYMENT.md) - Complete deployment guide
- [README.md](./README.md) - API documentation
- [SST Documentation](https://sst.dev/docs)

## 🎯 Typical Workflow

1. **Develop locally**: `pnpm start:dev`
2. **Deploy to dev**: `pnpm deploy:dev`
3. **Test in dev**: `curl https://dev-api/health`
4. **Deploy to staging**: `pnpm deploy:staging`
5. **Test in staging**: Verify with real data
6. **Deploy to prod**: `pnpm deploy:prod`
7. **Monitor**: Check CloudWatch logs/metrics

## 💡 Tips

- Use `pnpm sst:dev` for live Lambda development (changes deploy instantly)
- Set up AWS profiles for different accounts: `aws configure --profile dev`
- Use `sst console` for a web-based interface to your infrastructure
- Keep dev/staging/prod secrets separate
- Monitor costs in AWS Cost Explorer
- Set up billing alarms to avoid surprises
