# Deployment Guide - Claude Projects State Tracking API

This guide covers deploying the State Tracking API using SST (Serverless Stack) to AWS Lambda with API Gateway.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Architecture Overview](#architecture-overview)
- [Environment Setup](#environment-setup)
- [Deployment Process](#deployment-process)
- [Custom Domain Configuration](#custom-domain-configuration)
- [Monitoring & Logging](#monitoring--logging)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Tools

1. **Node.js**: Version 18 or 20
2. **pnpm**: Package manager
3. **AWS CLI**: Configured with appropriate credentials
4. **SST CLI**: Installed via dev dependencies

### AWS Account Setup

1. **IAM User/Role**: With permissions for:
   - Lambda function management
   - API Gateway management
   - CloudWatch Logs
   - CloudFormation
   - S3 (for SST state)
   - Route53 (for custom domains)
   - ACM (for SSL certificates)

2. **AWS Profile**: Configure your AWS credentials
   ```bash
   aws configure --profile your-profile-name
   ```

3. **Set AWS Profile** (if not using default):
   ```bash
   export AWS_PROFILE=your-profile-name
   ```

## Architecture Overview

```
┌─────────────────┐
│  API Gateway    │ ← Custom Domain: claude-projects.truapi.com
│   (REST API)    │
└────────┬────────┘
         │
         │ Proxy all requests
         ↓
┌─────────────────┐
│  Lambda Function│
│   (NestJS App)  │
│   Runtime: Node │
│   Memory: 512MB │
│   Timeout: 30s  │
└────────┬────────┘
         │
         │ MongoDB Connection
         ↓
┌─────────────────┐
│ MongoDB Atlas   │
│  (Managed DB)   │
└─────────────────┘
```

## Environment Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Secrets

SST uses secrets for sensitive values like API keys and database URIs.

#### Development Environment

For local development, create a `.env` file:

```bash
cp .env.example .env
# Edit .env with your local MongoDB URI and API keys
```

#### Staging/Production Environments

Use SST Secrets to store sensitive values:

```bash
# Set MongoDB URI for staging
pnpm sst secret set MongoDBUri "mongodb+srv://user:pass@cluster.mongodb.net/db" --stage staging

# Set API Keys for staging (comma-separated)
pnpm sst secret set ApiKeys "key1,key2,key3" --stage staging

# Repeat for production
pnpm sst secret set MongoDBUri "mongodb+srv://user:pass@cluster.mongodb.net/db" --stage production
pnpm sst secret set ApiKeys "prod-key-1,prod-key-2" --stage production
```

#### Using senvn for Production Secrets

For production, retrieve secrets from senvn:

```bash
# Get MongoDB URI from senvn
MONGODB_URI=$(senvn get CLAUDE_PROJECTS_MONGODB_URI)
pnpm sst secret set MongoDBUri "$MONGODB_URI" --stage production

# Get API Keys from senvn
API_KEYS=$(senvn get CLAUDE_PROJECTS_API_KEYS)
pnpm sst secret set ApiKeys "$API_KEYS" --stage production
```

#### Using setup-secrets.sh Script

For convenience, use the provided script:

```bash
# Configure secrets for staging
./scripts/setup-secrets.sh staging

# Configure secrets for production
./scripts/setup-secrets.sh production
```

#### List Configured Secrets

```bash
# View secrets for a stage
pnpm sst secret list --stage staging
```

## Deployment Process

### Development Deployment

Deploy to development environment:

```bash
pnpm deploy:dev
```

This will:
- Build the NestJS application
- Bundle for Lambda with esbuild
- Create/update Lambda function
- Create/update API Gateway
- Output the API endpoint URL

### Staging Deployment

Deploy to staging environment:

```bash
pnpm deploy:staging
```

### Production Deployment

Deploy to production environment:

```bash
pnpm deploy:prod
```

**Important**: Production deployments use the `retain` removal policy, meaning resources won't be deleted if you run `sst remove`.

### Local Development with SST

For local development with hot-reload:

```bash
pnpm sst:dev
```

This starts SST in dev mode, which:
- Deploys your app to AWS
- Creates a local development environment
- Enables Live Lambda Development (test Lambda functions locally)
- Hot-reloads on code changes

### Removing Deployments

To remove a deployment (dev/staging only):

```bash
# Remove dev environment
pnpm remove:dev

# Remove staging environment
pnpm remove:staging
```

**Note**: Production cannot be removed via script due to retention policy.

## Custom Domain Configuration

The production API is configured to use the custom domain `claude-projects.truapi.com`.

### Quick Start

1. Create SSL certificate in ACM (us-east-1)
2. Validate certificate via DNS
3. Deploy to production
4. Verify domain configuration

### Detailed Instructions

For comprehensive custom domain setup, including:
- Creating and validating SSL certificates in ACM
- DNS configuration in Route53
- Troubleshooting domain issues
- Certificate renewal and management

See: [CUSTOM_DOMAIN_SETUP.md](docs/CUSTOM_DOMAIN_SETUP.md)

### Key Domain Details

- **Domain**: `claude-projects.truapi.com`
- **Certificate Region**: `us-east-1` (required for API Gateway)
- **Validation Method**: DNS (automatic with Route53)
- **Active Stage**: Production only

## Monitoring & Logging

### CloudWatch Logs

All Lambda logs are sent to CloudWatch Logs:

```bash
# View logs for production
aws logs tail /aws/lambda/claude-projects-state-api-production --follow

# View API Gateway logs
aws logs tail /aws/apigateway/claude-projects-state-api-production --follow
```

### CloudWatch Alarms

Production environment includes alarms for:

1. **API 5xx Errors**: Triggers when >10 errors in 5 minutes
2. **Lambda Errors**: Triggers when >5 errors in 5 minutes
3. **Lambda Throttles**: Triggers when any throttling occurs

To set up SNS notifications:

1. Create SNS topic:
   ```bash
   aws sns create-topic --name claude-projects-alerts
   ```

2. Subscribe to topic:
   ```bash
   aws sns subscribe \
     --topic-arn arn:aws:sns:us-east-1:ACCOUNT_ID:claude-projects-alerts \
     --protocol email \
     --notification-endpoint your-email@example.com
   ```

3. Update `sst.config.ts` to add alarm actions (uncomment SNS lines)

### Metrics

View metrics in AWS CloudWatch Console:

- API Gateway: Request count, latency, errors
- Lambda: Invocations, duration, errors, throttles
- Custom metrics: Available via CloudWatch Insights

## Verification

### Automated Verification

Use the provided verification script to check deployment health:

```bash
# Verify production deployment
./scripts/verify-deployment.sh production

# Verify staging deployment
./scripts/verify-deployment.sh staging

# Verify dev deployment
./scripts/verify-deployment.sh dev
```

This script checks:
- Prerequisites (AWS CLI, curl, dig)
- AWS resources (API Gateway, Lambda)
- API endpoint accessibility
- HTTPS/TLS configuration
- Health check endpoint
- API authentication
- CloudWatch monitoring
- Production validation suite (smoke tests)
- DNS resolution (production only)
- SSL certificate validity (production only)
- ACM certificate status (production only)

### Production Validation Suite

The production validation includes comprehensive smoke tests:

```bash
# Run smoke tests directly
./scripts/smoke-test.sh https://claude-projects.truapi.com your-api-key

# Run with default credentials (for local testing)
./scripts/smoke-test.sh http://localhost:3000
```

The smoke test suite validates:

1. **Health Endpoints**
   - `/health` returns correct status
   - `/health/ready` confirms readiness

2. **Authentication**
   - Rejects unauthenticated requests (401)
   - Rejects invalid API keys
   - Accepts valid API keys

3. **Session Management**
   - Create sessions
   - Retrieve sessions
   - List sessions with pagination
   - Update session properties

4. **Task Workflow**
   - Create tasks within sessions
   - List tasks
   - Update task status

5. **Heartbeats**
   - Send heartbeats
   - Update session last_heartbeat timestamp

6. **Error Handling**
   - 404 for non-existent resources
   - 400 for invalid requests
   - 401 for authentication failures

7. **Rate Limiting**
   - Health endpoints are not rate limited
   - Rapid requests to API endpoints are handled correctly

8. **Data Consistency**
   - Session data persists across multiple reads
   - Task data maintains integrity

### End-to-End Testing

For comprehensive end-to-end testing, use the production validation test suite:

```bash
# Run the production validation e2e tests
npm run test:e2e -- production-validation.e2e-spec.ts
```

This comprehensive suite validates:

1. **Full Production Workflow**
   - Create session → Add tasks → Send heartbeats → Cleanup
   - All operations complete successfully
   - Data integrity maintained throughout

2. **Authentication & Authorization**
   - Multiple API keys supported
   - Proper 401/403 responses
   - All protected endpoints require authentication

3. **Rate Limiting**
   - Enforced on protected endpoints
   - Bypassed for health checks

4. **Error Handling**
   - Invalid request bodies return 400
   - Non-existent resources return 404
   - Invalid enums return 400
   - Concurrent error scenarios handled gracefully

5. **Data Persistence**
   - Session data persists across API calls
   - Task data consistency maintained
   - Metadata merging works correctly

6. **Concurrent Requests**
   - Multiple concurrent session creations
   - Concurrent reads on same session
   - Mixed concurrent reads and updates

7. **Performance**
   - Health checks respond within 500ms
   - List endpoints respond within 2s
   - Resource creation within 2s

### Manual Verification

Test endpoints manually:

```bash
# Health check
curl https://claude-projects.truapi.com/health

# With API key
curl -H "X-Api-Key: your-api-key" \
  https://claude-projects.truapi.com/api/sessions

# View Swagger docs
open https://claude-projects.truapi.com/api/docs
```

### Checking Deployment Status

```bash
# Get deployment info
pnpm sst info --stage production

# View API Gateway endpoints
aws apigatewayv2 get-apis --region us-east-1

# Get Lambda function details
aws lambda get-function --function-name claude-projects-state-api-production
```

## Troubleshooting

### Common Issues

#### 1. Deployment Fails with "No default AWS profile"

**Solution**: Set AWS profile environment variable:
```bash
export AWS_PROFILE=your-profile-name
```

#### 2. Lambda Times Out

**Symptoms**: 502 errors, timeout messages in logs

**Solutions**:
- Increase Lambda timeout in `sst.config.ts` (current: 30s)
- Check MongoDB connection latency
- Review slow queries/operations
- Consider VPC configuration if using VPC peering

#### 3. Cold Start Performance

**Symptoms**: First request after idle period is slow

**Solutions**:
- Lambda is already configured with 512MB memory (affects CPU)
- Consider provisioned concurrency for production
- Optimize bundle size (check esbuild config)
- Use Lambda layers for common dependencies

#### 4. Environment Variables Not Available

**Symptoms**: App can't read MONGODB_URI or API_KEYS

**Solutions**:
```bash
# Verify secrets are set
pnpm sst secret list --stage production

# Re-set secrets if needed
pnpm sst secret set MongoDBUri "your-uri" --stage production
```

#### 5. Custom Domain Not Working

**Symptoms**: Domain returns 404 or SSL errors

**Solutions**:
- Verify SSL certificate is validated in ACM
- Check Route53 DNS records are created
- Wait for DNS propagation (can take 5-15 minutes)
- Verify certificate is in us-east-1 region
- See: [CUSTOM_DOMAIN_SETUP.md](docs/CUSTOM_DOMAIN_SETUP.md#troubleshooting)

#### 6. CORS Errors

**Symptoms**: Browser shows CORS policy errors

**Solutions**:
- Check CORS configuration in `sst.config.ts`
- Verify allowed origins in production
- Check preflight OPTIONS requests succeed

### Viewing Detailed Logs

```bash
# Get function name
aws lambda list-functions --query 'Functions[?contains(FunctionName, `state-api`)].FunctionName'

# View function configuration
aws lambda get-function --function-name <function-name>

# Get recent errors
aws logs filter-pattern --log-group-name /aws/lambda/<function-name> --filter-pattern "ERROR"
```

### Testing Endpoints

```bash
# Health check
curl https://claude-projects.truapi.com/health

# With API key
curl -H "X-Api-Key: your-api-key" \
  https://claude-projects.truapi.com/api/sessions

# View Swagger docs
open https://claude-projects.truapi.com/api/docs
```

### SST Console

SST provides a web console for managing your app:

```bash
# Open SST console
pnpm sst console --stage production
```

The console shows:
- All resources in your app
- Logs and metrics
- Environment variables and secrets
- Real-time updates

## MongoDB Atlas Configuration

### VPC Peering (Optional)

For enhanced security, configure VPC peering between Lambda and MongoDB Atlas:

1. Create VPC in AWS
2. Set up VPC peering in MongoDB Atlas
3. Update `sst.config.ts` to enable VPC configuration:
   ```typescript
   vpcConfig: {
     subnetIds: ["subnet-xxx", "subnet-yyy"],
     securityGroupIds: ["sg-xxx"],
   }
   ```

### IP Whitelist

If not using VPC peering, whitelist Lambda IPs:

1. In MongoDB Atlas, go to Network Access
2. Add IP addresses or use 0.0.0.0/0 (allow all)
   - Note: 0.0.0.0/0 is less secure but simpler for Lambda

## Performance Optimization

### Bundle Size

Current configuration bundles dependencies with esbuild:

```typescript
nodejs: {
  esbuild: {
    bundle: true,
    minify: stage === "production",
    external: [/* native modules */],
  }
}
```

To reduce bundle size:
- Review and add more external dependencies
- Use Lambda layers for large dependencies
- Enable tree-shaking in esbuild

### Memory Configuration

Current: 512MB

Adjust based on monitoring:
- Higher memory = more CPU power
- Monitor CloudWatch metrics
- Test with different values (256MB, 1024MB)

### Provisioned Concurrency

For production, consider provisioned concurrency to eliminate cold starts:

```typescript
transform: {
  function: {
    reservedConcurrentExecutions: 10, // Limit max concurrent
    // Or use provisioned concurrency
  }
}
```

## Security Best Practices

1. **API Keys**: Rotate regularly, use strong random values
2. **MongoDB**: Use strong passwords, enable authentication
3. **CORS**: Restrict origins in production
4. **Secrets**: Never commit secrets to git
5. **IAM**: Use least-privilege permissions
6. **VPC**: Consider VPC peering for MongoDB
7. **Monitoring**: Set up CloudWatch alarms
8. **SSL/TLS**: Always use HTTPS (enabled by default for custom domain)

## Cost Optimization

- **Lambda**: Pay per request and duration
- **API Gateway**: Pay per request
- **CloudWatch**: Pay for log storage and queries
- **Data Transfer**: Minimize cross-region transfers

Monitor costs in AWS Cost Explorer and set up billing alarms.

## Additional Resources

- [SST Documentation](https://sst.dev/docs)
- [NestJS Serverless](https://docs.nestjs.com/faq/serverless)
- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [MongoDB Atlas AWS Integration](https://www.mongodb.com/docs/atlas/reference/amazon-aws/)
- [Custom Domain Setup Guide](docs/CUSTOM_DOMAIN_SETUP.md)
