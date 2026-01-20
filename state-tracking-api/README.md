# Claude Projects State Tracking API

Runtime state tracking API for Claude AI project orchestration sessions running in VSCode.

## Features

- **Session Management**: Track active orchestration sessions with heartbeat monitoring
- **Task Monitoring**: Monitor task-level progress within sessions
- **Machine Tracking**: Manage machine/docker slot assignments
- **Health Checks**: Built-in health and readiness endpoints
- **API Documentation**: Auto-generated Swagger documentation

## Prerequisites

- Node.js 18 or 20
- MongoDB (local or Atlas)
- pnpm package manager
- AWS account (for deployment)
- AWS CLI configured

## Installation

```bash
pnpm install
```

## Configuration

### Local Development

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required environment variables:
- `MONGODB_URI`: MongoDB connection string
- `API_KEYS`: Comma-separated list of valid API keys
- `PORT`: Application port (default: 3000)

### Production/Staging

For deployed environments, secrets are managed via SST Secrets. See [DEPLOYMENT.md](./DEPLOYMENT.md) for details.

## Running the Application

### Local Development

```bash
# Traditional development mode
pnpm run start:dev

# SST development mode (deploys to AWS, runs locally with hot reload)
pnpm sst:dev

# Production build (local)
pnpm run build
pnpm run start:prod
```

### Deployment to AWS

```bash
# Deploy to development environment
pnpm deploy:dev

# Deploy to staging environment
pnpm deploy:staging

# Deploy to production environment
pnpm deploy:prod
```

For detailed deployment instructions, infrastructure setup, and troubleshooting, see [DEPLOYMENT.md](./DEPLOYMENT.md).

## API Documentation

Once running, access Swagger documentation at:
```
http://localhost:3000/api/docs
```

## Endpoints

### Health
- `GET /health` - Health check
- `GET /health/ready` - Readiness check

### Sessions
- `GET /sessions` - List all sessions
- `GET /sessions/:id` - Get session by ID
- `POST /sessions` - Create new session
- `PUT /sessions/:id` - Update session
- `DELETE /sessions/:id` - Delete session

### Tasks
- `GET /tasks` - List all tasks
- `GET /tasks?session_id=xxx` - Filter tasks by session
- `GET /tasks/:id` - Get task by ID
- `POST /tasks` - Create new task
- `PUT /tasks/:id` - Update task
- `DELETE /tasks/:id` - Delete task

### Machines
- `GET /machines` - List all machines
- `GET /machines/:id` - Get machine by ID
- `POST /machines` - Create new machine
- `PUT /machines/:id` - Update machine
- `DELETE /machines/:id` - Delete machine

## Authentication

All endpoints (except `/health` and `/health/ready`) require API key authentication.

### Setup

1. Generate API keys (UUID v4 format recommended):
   ```bash
   # macOS/Linux
   uuidgen

   # Node.js
   node -e "console.log(crypto.randomUUID())"
   ```

2. Add keys to `.env` file:
   ```bash
   API_KEYS=550e8400-e29b-41d4-a716-446655440000,6ba7b810-9dad-11d1-80b4-00c04fd430c8
   ```

### Using API Keys

Include your API key in one of two header formats:

**Option 1: Bearer Token (recommended)**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" http://localhost:3000/sessions
```

**Option 2: X-API-Key Header**
```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/sessions
```

### Authentication Behavior

- **Protected Endpoints**: All `/sessions`, `/tasks`, and `/machines` endpoints require authentication
- **Public Endpoints**: `/health` and `/health/ready` are publicly accessible
- **Development Mode**: When `NODE_ENV=development` and no API keys are configured, authentication is bypassed
- **Production Mode**: API keys are always required in production environments
- **Header Priority**: If both headers are provided, `Authorization: Bearer` takes precedence

### Security Best Practices

1. Use UUID v4 format for API keys (36 characters)
2. Never commit API keys to version control
3. Rotate API keys regularly
4. Use different keys for different environments
5. Monitor API key usage through request logs

## VSCode Extension Integration

This API includes a TypeScript client library for easy integration with VSCode extensions.

### Quick Start

```typescript
import { StateTrackingApiClient } from './state-tracking-client';

const client = new StateTrackingApiClient({
  baseUrl: 'https://your-api-domain.com',
  apiKey: 'your-api-key',
});

const session = await client.createSession({
  project_id: '123',
  machine_id: 'my-machine',
});
```

### Building the Client Library

```bash
# Build standalone client library
pnpm run build:client

# Output will be in dist/client/
```

### Documentation

- [VSCode Integration Guide](./docs/VSCODE_INTEGRATION.md) - Complete integration guide with examples
- [Client Library README](./src/client/README.md) - Client API reference
- [Complete Example](./examples/vscode-extension-example.ts) - Full working example

## Testing

```bash
# Unit tests
pnpm run test

# E2E tests
pnpm run test:e2e

# Test coverage
pnpm run test:cov
```

## Project Structure

```
src/
├── modules/          # Feature modules
│   ├── sessions/    # Session management
│   ├── tasks/       # Task monitoring
│   ├── machines/    # Machine tracking
│   ├── auth/        # Authentication
│   └── health/      # Health checks
├── schemas/         # MongoDB schemas
├── common/          # Shared utilities
│   ├── guards/      # Auth guards
│   ├── filters/     # Exception filters
│   └── interceptors/
├── config/          # Configuration
├── main.ts          # Application entry point (local)
└── lambda.ts        # Lambda handler (AWS deployment)
```

## Infrastructure

This API is deployed using [SST (Serverless Stack)](https://sst.dev) to AWS Lambda with API Gateway.

### Architecture

- **Runtime**: AWS Lambda (Node.js 20)
- **API Gateway**: REST API with custom domain support
- **Database**: MongoDB Atlas
- **Memory**: 512MB
- **Timeout**: 30 seconds
- **Monitoring**: CloudWatch Logs and Alarms
- **Custom Domain**: claude-projects.truapi.com (production)

### Configuration Files

- `sst.config.ts` - SST infrastructure configuration
- `src/lambda.ts` - Lambda handler for serverless deployment
- `DEPLOYMENT.md` - Comprehensive deployment guide
- `.env.dev`, `.env.staging`, `.env.production` - Environment-specific configs

---

## Documentation

Complete operational documentation is available in the `docs/` directory:

### For Operations & DevOps

| Document | Purpose | Read When |
|----------|---------|-----------|
| **[RUNBOOKS.md](./docs/RUNBOOKS.md)** | Operational procedures and incident response | Performing deployments, handling incidents, or routine maintenance |
| **[MONITORING.md](./docs/MONITORING.md)** | Monitoring setup, dashboards, and alerts | Setting up CloudWatch, configuring alerts, or investigating performance |
| **[TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)** | Common issues and solutions | Debugging problems or investigating errors |

### For Developers & DevOps

| Document | Purpose | Read When |
|----------|---------|-----------|
| **[DEPLOYMENT.md](./DEPLOYMENT.md)** | Deployment process and infrastructure setup | Setting up environments or deploying code changes |
| **[QUICKSTART.md](./QUICKSTART.md)** | Quick start guide for local development | Getting started with local development |
| **[IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)** | Technical architecture and implementation details | Understanding system design and component interactions |

### For API Consumers

| Document | Purpose |
|----------|---------|
| **Swagger Documentation** | Access at `/api/docs` when running locally or on deployed instance |
| **[ERROR_HANDLING.md](./docs/ERROR_HANDLING.md)** | Error response formats and error codes |
| **[SESSION_HEALTH_ENDPOINTS.md](./docs/SESSION_HEALTH_ENDPOINTS.md)** | Session health monitoring endpoints |

### Quick Links

- **Getting Help**: See [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md#getting-help)
- **Emergency Procedures**: See [RUNBOOKS.md](./docs/RUNBOOKS.md#emergency-procedures)
- **Incident Response**: See [RUNBOOKS.md](./docs/RUNBOOKS.md#incident-response)
- **Database Troubleshooting**: See [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md#database-issues)
- **Performance Issues**: See [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md#performance-problems)

---

## Monitoring & Operations

### Real-Time Monitoring

```bash
# Watch production logs
aws logs tail /aws/lambda/claude-projects-state-api-production --follow

# Watch for errors
aws logs tail /aws/lambda/claude-projects-state-api-production \
  --follow \
  --filter-pattern "ERROR"

# Quick health check
curl -H "X-Api-Key: $API_KEY" \
  https://claude-projects.truapi.com/health
```

### CloudWatch Dashboards

Access monitoring dashboards:
- **Main Dashboard**: AWS Console → CloudWatch → Dashboards → "Claude-Projects-State-API-Production"
- **Database Metrics**: MongoDB Atlas Console → Cluster → Metrics

### Alert Configuration

Production includes automated alerts for:
- Lambda error rate > 1%
- API latency > 2 seconds
- Lambda throttling detected
- Database connection issues

See [MONITORING.md](./docs/MONITORING.md#alert-configuration) for setup instructions.

---

## Troubleshooting Quick Reference

**API not responding?**
```bash
# Check Lambda logs
aws logs tail /aws/lambda/claude-projects-state-api-production --since 10m

# Check health endpoint
curl https://claude-projects.truapi.com/health
```

**High error rate?**
See [RUNBOOKS.md - High Error Rates](./docs/RUNBOOKS.md#high-error-rates)

**Performance degradation?**
See [RUNBOOKS.md - Performance Degradation](./docs/RUNBOOKS.md#performance-degradation)

**Database connection error?**
See [TROUBLESHOOTING.md - MongoDB Connection Refused](./docs/TROUBLESHOOTING.md#issue-mongodb-connection-refused)

**Need to rollback?**
See [RUNBOOKS.md - Deployment Rollback](./docs/RUNBOOKS.md#deployment-rollback)

For more issues and solutions, see [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md).

---

## Operations Checklist

### Daily Operations
- [ ] Check CloudWatch dashboard for anomalies
- [ ] Review error rates (should be < 0.1%)
- [ ] Monitor API latency (should be < 200ms average)
- [ ] Check database connection pool utilization

### Weekly Maintenance
- [ ] Review performance trends
- [ ] Check for slow queries in MongoDB
- [ ] Verify backup status
- [ ] Review access logs

### Monthly Tasks
- [ ] Update dependencies (`pnpm update`)
- [ ] Run security audit (`npm audit`)
- [ ] Review and update documentation
- [ ] Plan capacity scaling if needed

### Quarterly Tasks
- [ ] Rotate API keys (see [RUNBOOKS.md](./docs/RUNBOOKS.md#rotating-api-keys))
- [ ] Rotate database credentials
- [ ] Test disaster recovery procedures
- [ ] Update runbooks based on learnings

---

## Support & Escalation

**For issues related to:**

- **Code/Features**: Check [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
- **Deployment**: Check [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Operations**: Check [RUNBOOKS.md](./docs/RUNBOOKS.md)
- **Monitoring**: Check [MONITORING.md](./docs/MONITORING.md)
- **Debugging**: Check [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)

**Escalation path:**
1. Check relevant documentation
2. Review CloudWatch logs
3. Run diagnostics from [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)
4. Contact infrastructure team if issue persists

---

## License

UNLICENSED
