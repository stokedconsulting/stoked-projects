# Claude Projects State Tracking API

Runtime state tracking API for Claude AI project orchestration sessions running in VSCode.

## Features

- **Session Management**: Track active orchestration sessions with heartbeat monitoring
- **Task Monitoring**: Monitor task-level progress within sessions
- **Machine Tracking**: Manage machine/docker slot assignments
- **Health Checks**: Built-in health and readiness endpoints
- **API Documentation**: Auto-generated Swagger documentation

## Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)
- pnpm

## Installation

```bash
pnpm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required environment variables:
- `MONGODB_URI`: MongoDB connection string
- `API_KEYS`: Comma-separated list of valid API keys
- `PORT`: Application port (default: 3000)

## Running the Application

```bash
# Development
pnpm run start:dev

# Production
pnpm run build
pnpm run start:prod
```

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

All endpoints (except `/health`) require API key authentication via:
- `Authorization: Bearer <api-key>` header, or
- `x-api-key: <api-key>` header

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
└── main.ts          # Application entry point
```

## License

UNLICENSED
