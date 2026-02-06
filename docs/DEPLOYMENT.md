# Deployment Guide

Comprehensive deployment guide for all components of the Claude Projects system.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [VSCode Extension Deployment](#vscode-extension-deployment)
- [State Tracking API Deployment](#api-deployment)
- [MCP Server Deployment](#mcp-server-deployment)
- [Monitoring & Maintenance](#monitoring--maintenance)
- [Scaling](#scaling)
- [Security](#security)
- [Rollback Procedures](#rollback-procedures)

## Overview

The Claude Projects system consists of three independently deployable components:

1. **VSCode Extension** - Distributed via VSIX package or marketplace
2. **State Tracking API** - Deployed as serverless (AWS Lambda) or containerized (Docker)
3. **MCP Server** - Deployed locally (Claude Desktop) or centrally (Docker)

### Deployment Matrix

| Component | Environment | Deployment Method | Hosting |
|-----------|-------------|-------------------|---------|
| VSCode Extension | Local | VSIX Install | User's VSCode |
| State Tracking API | Production | AWS Lambda | AWS |
| State Tracking API | Staging | Docker | AWS EC2 / ECS |
| MCP Server | Production | Docker | User's Machine |
| MCP Server | Shared | Docker | Central Server |

## Architecture

### Production Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Users & Clients                          │
├─────────────────────────────────────────────────────────────┤
│  VSCode Extensions  │  MCP Servers  │  Claude Desktop       │
└──────────┬───────────┴────────┬──────┴─────────────┬────────┘
           │                    │                     │
           └────────────────────┼─────────────────────┘
                                │
                         HTTPS / API Gateway
                                │
           ┌────────────────────┴────────────────────┐
           │      State Tracking API (Lambda)         │
           │  ┌─────────────────────────────────────┐│
           │  │  GitHub Service Layer                ││
           │  │  - Auth, Projects, Issues            ││
           │  │  - Rate Limiting, Caching            ││
           │  └─────────────────────────────────────┘│
           └────────────────────┬────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
              ┌─────▼──────┐         ┌─────▼──────┐
              │  MongoDB    │         │  GitHub    │
              │  (Atlas)    │         │  API       │
              └─────────────┘         └────────────┘
```

## Prerequisites

### For All Deployments

- **Node.js** 18+ (LTS recommended)
- **pnpm** 8+ (monorepo package manager)
- **Git** 2.30+
- **GitHub CLI** (`gh`) authenticated
- **GitHub Personal Access Token** with scopes: `repo`, `read:org`, `read:project`, `project`

### For State Tracking API (AWS Lambda)

- **AWS CLI** configured
- **AWS Account** with appropriate permissions
- **MongoDB Atlas** account (or MongoDB instance)
- **Serverless Framework** (`npm install -g serverless`)

### For Docker Deployments

- **Docker** 20+
- **Docker Compose** 1.29+
- Container registry access (Docker Hub, ECR, etc.)

### For VSCode Extension Distribution

- **VSCode** 1.96+
- **vsce** (VSCode Extension Manager): `npm install -g @vscode/vsce`
- VSCode Marketplace publisher account (for public distribution)

## Environment Setup

### Shared Environment Variables

Create a master `.env` file or use environment-specific files:

```bash
# .env.production
NODE_ENV=production

# GitHub Authentication
GITHUB_TOKEN=ghp_your_production_token

# MongoDB
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/claude-projects

# API Authentication
API_KEY=your_secure_api_key_here

# Logging
LOG_LEVEL=info

# State Tracking API
STATE_TRACKING_API_URL=https://api.claude-projects.example.com
STATE_TRACKING_API_KEY=your_api_key

# WebSocket (MCP Server)
WS_API_KEY=your_ws_api_key
WS_PORT=8080

# Caching
CACHE_TTL=300  # 5 minutes
ENABLE_QUERY_CACHE=true

# Rate Limiting
GITHUB_API_RATE_LIMIT=5000
GITHUB_GRAPHQL_RATE_LIMIT=5000
```

### Environment-Specific Configurations

**Development:**
```bash
NODE_ENV=development
LOG_LEVEL=debug
STATE_TRACKING_API_URL=http://localhost:3000
MONGODB_URI=mongodb://localhost:27017/claude-projects-dev
```

**Staging:**
```bash
NODE_ENV=staging
LOG_LEVEL=debug
STATE_TRACKING_API_URL=https://staging-api.claude-projects.example.com
MONGODB_URI=mongodb+srv://user:pass@staging-cluster.mongodb.net/claude-projects-staging
```

**Production:**
```bash
NODE_ENV=production
LOG_LEVEL=info
STATE_TRACKING_API_URL=https://api.claude-projects.example.com
MONGODB_URI=mongodb+srv://user:pass@prod-cluster.mongodb.net/claude-projects
```

## VSCode Extension Deployment

### Building the Extension

1. **Install dependencies:**

```bash
cd apps/code-ext
pnpm install
```

2. **Build the extension:**

```bash
pnpm run build
```

3. **Package the extension:**

```bash
# Create VSIX package
pnpm run package

# Output: claude-projects-1.0.0.vsix
```

### Local Installation

```bash
# Install from VSIX
code --install-extension claude-projects-1.0.0.vsix

# Or from Extension Marketplace (if published)
code --install-extension publisher.claude-projects
```

### Publishing to VSCode Marketplace

1. **Create publisher account:**
   - Go to https://marketplace.visualstudio.com/manage
   - Create publisher ID

2. **Login with vsce:**

```bash
vsce login publisher-name
```

3. **Publish extension:**

```bash
cd apps/code-ext

# Bump version (follows semver)
npm version patch  # or minor, major

# Publish
vsce publish
```

4. **Verify publication:**
   - Check marketplace: https://marketplace.visualstudio.com/items?itemName=publisher.claude-projects

### Private Distribution

For internal/private distribution:

```bash
# Package extension
pnpm run package

# Host VSIX on internal server
cp claude-projects-1.0.0.vsix /var/www/extensions/

# Users install via URL
code --install-extension https://internal.company.com/extensions/claude-projects-1.0.0.vsix
```

### Configuration for Deployed API

Update extension to use production API:

```json
// package.json
{
  "contributes": {
    "configuration": {
      "properties": {
        "claudeProjects.apiUrl": {
          "type": "string",
          "default": "https://api.claude-projects.example.com",
          "description": "State Tracking API URL"
        }
      }
    }
  }
}
```

## State Tracking API Deployment

### AWS Lambda Deployment (Recommended for Production)

**1. Configure AWS credentials:**

```bash
aws configure
# Enter: Access Key ID, Secret Access Key, Region
```

**2. Install Serverless Framework:**

```bash
npm install -g serverless
```

**3. Configure serverless.yml:**

```yaml
# packages/api/serverless.yml
service: claude-projects-api

provider:
  name: aws
  runtime: nodejs18.x
  region: us-east-1
  stage: ${opt:stage, 'dev'}
  environment:
    MONGODB_URI: ${env:MONGODB_URI}
    GITHUB_TOKEN: ${env:GITHUB_TOKEN}
    API_KEY: ${env:API_KEY}
    LOG_LEVEL: ${env:LOG_LEVEL, 'info'}

functions:
  api:
    handler: src/lambda.handler
    events:
      - http:
          path: /{proxy+}
          method: ANY
          cors: true
    timeout: 30
    memorySize: 512

resources:
  Resources:
    # API Gateway custom domain, CloudWatch logs, etc.
```

**4. Deploy to AWS:**

```bash
cd packages/api

# Deploy to staging
serverless deploy --stage staging

# Deploy to production
serverless deploy --stage production

# Output will show API endpoint:
# https://abc123.execute-api.us-east-1.amazonaws.com/production
```

**5. Configure custom domain (optional):**

```bash
# Add custom domain via AWS Console or Serverless
serverless create_domain --stage production
serverless deploy --stage production
```

**6. Test deployment:**

```bash
# Health check
curl https://api.claude-projects.example.com/health

# Test endpoint
curl -H "X-API-Key: your_api_key" \
  "https://api.claude-projects.example.com/api/github/health"
```

### Docker Deployment (Alternative)

**1. Build Docker image:**

```bash
cd packages/api

# Build
docker build -t claude-projects-api:latest .

# Or with specific tag
docker build -t claude-projects-api:1.0.0 .
```

**2. Test locally:**

```bash
docker run -p 3000:3000 \
  -e MONGODB_URI="mongodb://host.docker.internal:27017/claude-projects" \
  -e GITHUB_TOKEN="ghp_token" \
  -e API_KEY="api_key" \
  claude-projects-api:latest

# Test
curl http://localhost:3000/health
```

**3. Push to container registry:**

```bash
# Docker Hub
docker tag claude-projects-api:latest username/claude-projects-api:latest
docker push username/claude-projects-api:latest

# AWS ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789.dkr.ecr.us-east-1.amazonaws.com

docker tag claude-projects-api:latest \
  123456789.dkr.ecr.us-east-1.amazonaws.com/claude-projects-api:latest

docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/claude-projects-api:latest
```

**4. Deploy to ECS/Fargate:**

Create ECS task definition:

```json
{
  "family": "claude-projects-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "123456789.dkr.ecr.us-east-1.amazonaws.com/claude-projects-api:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "LOG_LEVEL", "value": "info"}
      ],
      "secrets": [
        {"name": "MONGODB_URI", "valueFrom": "arn:aws:secretsmanager:..."},
        {"name": "GITHUB_TOKEN", "valueFrom": "arn:aws:secretsmanager:..."},
        {"name": "API_KEY", "valueFrom": "arn:aws:secretsmanager:..."}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/claude-projects-api",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

Create and run service:

```bash
# Create cluster
aws ecs create-cluster --cluster-name claude-projects

# Register task definition
aws ecs register-task-definition --cli-input-json file://task-definition.json

# Create service
aws ecs create-service \
  --cluster claude-projects \
  --service-name api \
  --task-definition claude-projects-api:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-abc123],securityGroups=[sg-abc123],assignPublicIp=ENABLED}"
```

### MongoDB Setup

**Using MongoDB Atlas (Recommended):**

1. Create cluster at https://cloud.mongodb.com
2. Create database user
3. Whitelist API server IP addresses
4. Get connection string
5. Update `MONGODB_URI` in environment

**Using Self-Hosted MongoDB:**

```bash
# Deploy MongoDB with Docker
docker run -d \
  --name mongodb \
  -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=password \
  -v mongodb_data:/data/db \
  mongo:latest

# Create application database and user
mongosh mongodb://admin:password@localhost:27017/admin

use claude-projects
db.createUser({
  user: "api-user",
  pwd: "secure-password",
  roles: [{ role: "readWrite", db: "claude-projects" }]
})
```

## MCP Server Deployment

See [MCP Server Deployment Guide](../deployment/DEPLOYMENT.md) for detailed instructions.

**Quick deployment:**

```bash
# Build MCP server
cd packages/mcp-server
pnpm install
pnpm build

# Configure Claude Desktop
# Edit: ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "claude-projects": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/packages/mcp-server",
      "env": {
        "STATE_TRACKING_API_URL": "https://api.claude-projects.example.com",
        "STATE_TRACKING_API_KEY": "your_api_key"
      }
    }
  }
}

# Restart Claude Desktop
```

## Monitoring & Maintenance

### Health Checks

**API Health Endpoints:**

```bash
# Basic health check
curl https://api.claude-projects.example.com/health

# Detailed health check
curl https://api.claude-projects.example.com/health/detailed

# Response:
{
  "status": "healthy",
  "timestamp": "2026-01-24T10:30:00Z",
  "uptime": 86400,
  "services": {
    "mongodb": "healthy",
    "github": "healthy"
  },
  "metrics": {
    "requests": 12345,
    "errors": 5,
    "avgResponseTime": 234
  }
}
```

**Monitoring Endpoints:**

```bash
# Metrics (Prometheus format)
curl https://api.claude-projects.example.com/metrics

# Rate limit status
curl -H "X-API-Key: key" \
  https://api.claude-projects.example.com/api/github/rate-limit
```

### Logging

**CloudWatch Logs (AWS Lambda):**

```bash
# View logs
aws logs tail /aws/lambda/claude-projects-api --follow

# Query logs
aws logs filter-log-events \
  --log-group-name /aws/lambda/claude-projects-api \
  --filter-pattern "ERROR"
```

**Docker Logs:**

```bash
# Follow logs
docker-compose logs -f api

# View last 100 lines
docker-compose logs --tail=100 api

# Export logs
docker-compose logs api > api.log
```

### Metrics & Alerts

**CloudWatch Alarms:**

```bash
# Create alarm for error rate
aws cloudwatch put-metric-alarm \
  --alarm-name claude-api-errors \
  --alarm-description "Alert when error rate > 5%" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1
```

**Custom Metrics:**

```typescript
// In API code
import { MetricsService } from './common/metrics/metrics.service';

@Injectable()
export class MyService {
  constructor(private metrics: MetricsService) {}

  async someMethod() {
    this.metrics.increment('api.requests');
    const startTime = Date.now();

    try {
      // Do work
      this.metrics.increment('api.success');
    } catch (error) {
      this.metrics.increment('api.errors');
      throw error;
    } finally {
      this.metrics.timing('api.response_time', Date.now() - startTime);
    }
  }
}
```

## Scaling

### Horizontal Scaling

**AWS Lambda:**
- Automatic scaling based on requests
- Configure reserved concurrency if needed
- Monitor cold starts

**ECS/Fargate:**

```bash
# Update service desired count
aws ecs update-service \
  --cluster claude-projects \
  --service api \
  --desired-count 5
```

**Auto Scaling:**

```json
// ECS auto-scaling configuration
{
  "ServiceName": "api",
  "MinCapacity": 2,
  "MaxCapacity": 10,
  "TargetValue": 70.0,  // CPU utilization
  "ScaleOutCooldown": 60,
  "ScaleInCooldown": 300
}
```

### Vertical Scaling

**Lambda Memory:**

```yaml
# serverless.yml
functions:
  api:
    memorySize: 1024  # Increase from 512
    timeout: 60       # Increase from 30
```

**ECS Task:**

```json
{
  "cpu": "1024",     // Increase from 512
  "memory": "2048"   // Increase from 1024
}
```

### Database Scaling

**MongoDB Atlas:**
- Enable auto-scaling in cluster settings
- Add read replicas for read-heavy workloads
- Use cluster tier with more resources

## Security

### Secrets Management

**AWS Secrets Manager:**

```bash
# Store secret
aws secretsmanager create-secret \
  --name claude-projects/github-token \
  --secret-string "ghp_token_here"

# Retrieve in Lambda
const secret = await secretsManager.getSecretValue({
  SecretId: 'claude-projects/github-token'
}).promise();
```

**Environment Variables Encryption:**

```yaml
# serverless.yml
provider:
  environment:
    # Plain text (not recommended for secrets)
    LOG_LEVEL: info

    # Reference to Secrets Manager
    GITHUB_TOKEN: ${ssm:/claude-projects/github-token~true}
    API_KEY: ${ssm:/claude-projects/api-key~true}
```

### API Security

**API Key Rotation:**

```bash
# Generate new API key
openssl rand -base64 32

# Update in Secrets Manager
aws secretsmanager update-secret \
  --secret-id claude-projects/api-key \
  --secret-string "new_key_here"

# Update clients with new key
# Deploy updated configuration
```

**Rate Limiting:**

```typescript
// Already implemented in RateLimitService
// Configure in .env:
RATE_LIMIT_WINDOW_MS=60000      // 1 minute
RATE_LIMIT_MAX_REQUESTS=100     // 100 requests per window
```

### Network Security

**VPC Configuration (ECS):**

```bash
# Deploy API in private subnet
# Use NAT Gateway for outbound connections
# Restrict security group to only necessary ports
```

**API Gateway (Lambda):**

```yaml
# serverless.yml
functions:
  api:
    events:
      - http:
          path: /{proxy+}
          method: ANY
          cors:
            origin: 'https://allowed-domain.com'
            headers:
              - Content-Type
              - X-API-Key
```

## Rollback Procedures

### Extension Rollback

```bash
# Uninstall current version
code --uninstall-extension publisher.claude-projects

# Install previous version
code --install-extension claude-projects-1.0.0.vsix
```

### API Rollback (Lambda)

```bash
# List versions
serverless deploy list --stage production

# Rollback to previous version
serverless rollback --timestamp <timestamp> --stage production

# Or rollback via AWS Console:
# Lambda → Functions → claude-projects-api → Versions → Promote to $LATEST
```

### API Rollback (Docker)

```bash
# Tag previous version as latest
docker tag claude-projects-api:1.0.0 claude-projects-api:latest
docker push username/claude-projects-api:latest

# Update ECS service
aws ecs update-service \
  --cluster claude-projects \
  --service api \
  --force-new-deployment

# Or use docker-compose
docker-compose pull
docker-compose up -d
```

### Database Rollback

```bash
# Restore from backup
mongorestore --uri="$MONGODB_URI" --drop /path/to/backup

# Or MongoDB Atlas:
# Cluster → Backup → Restore to point in time
```

## Deployment Checklist

### Pre-Deployment

- [ ] All tests passing
- [ ] Code reviewed and approved
- [ ] Environment variables configured
- [ ] Secrets stored securely
- [ ] Database migrations tested
- [ ] Backup created

### Deployment

- [ ] Deploy in staging first
- [ ] Run smoke tests in staging
- [ ] Deploy to production
- [ ] Verify health checks pass
- [ ] Monitor logs for errors
- [ ] Test critical user flows

### Post-Deployment

- [ ] Monitor error rates
- [ ] Check performance metrics
- [ ] Verify all integrations working
- [ ] Update documentation
- [ ] Notify users of changes
- [ ] Document any issues

## Additional Resources

- [Architecture Documentation](./ARCHITECTURE.md)
- [Developer Guide](./DEVELOPER_GUIDE.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)
- [API Reference](./api-reference.md)
- [MCP Deployment Guide](../deployment/DEPLOYMENT.md)

---

**Last Updated**: 2026-01-24
