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

### Monitoring

Production includes CloudWatch alarms for:
- API 5xx errors
- Lambda function errors
- Lambda throttling

See [DEPLOYMENT.md](./DEPLOYMENT.md) for monitoring and troubleshooting details.

## License

UNLICENSED
