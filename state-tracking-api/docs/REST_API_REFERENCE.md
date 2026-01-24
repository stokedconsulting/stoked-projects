# Claude Projects State Tracking API - REST API Reference

Complete reference for the Claude Projects State Tracking API including all endpoints, request/response examples, authentication, schemas, and error codes.

**API Version**: 0.1.0
**Base URL**: `http://localhost:3000` (development) or your deployment URL
**Documentation UI**: `/api/docs` (Swagger)
**OpenAPI Spec**: `/api/docs/openapi.json`

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Authentication](#authentication)
3. [Rate Limiting](#rate-limiting)
4. [Endpoints](#endpoints)
   - [Health](#health)
   - [Sessions](#sessions)
   - [Tasks](#tasks)
   - [Machines](#machines)
5. [Schemas](#schemas)
6. [Error Codes](#error-codes)
7. [Common Workflows](#common-workflows)
8. [API Versioning](#api-versioning)

---

## Getting Started

### Base URL

```
http://localhost:3000
```

### Swagger UI

Interactive API documentation is available at:
```
GET /api/docs
```

### OpenAPI Specification

Machine-readable OpenAPI 3.0 specification:
```
GET /api/docs/openapi.json
```

### Quick Test

```bash
# Check if API is running
curl http://localhost:3000/health

# Check readiness
curl http://localhost:3000/health/ready

# Check liveness
curl http://localhost:3000/health/live
```

---

## Authentication

All endpoints except `/health`, `/health/ready`, and `/health/live` require authentication.

### Two Authentication Methods

#### 1. Bearer Token (Recommended)

Include your API key in the `Authorization` header as a bearer token:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/sessions
```

#### 2. X-API-Key Header

Alternatively, include your API key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: YOUR_API_KEY" \
  http://localhost:3000/sessions
```

### Getting an API Key

API keys are issued on a per-integration basis. Contact your system administrator or:

1. **Local Development**: Set via environment variables (see `.env.dev`)
2. **AWS Deployment**: Use AWS Secrets Manager

### Authentication Errors

| Status | Error | Remedy |
|--------|-------|--------|
| 401 | `unauthorized` | Missing or invalid API key. Verify key is correct and hasn't expired. |
| 403 | `forbidden` | API key valid but insufficient permissions. Contact admin to grant access. |

---

## Rate Limiting

The API implements rate limiting to protect against abuse.

### Rate Limit Tiers

| Endpoint | Requests per Minute | Requests per Hour |
|----------|-------------------|------------------|
| Most endpoints | 60 | 1000 |
| Heartbeat endpoints | 120 | 3000 |
| Health endpoints | Unlimited | Unlimited |

### Rate Limit Headers

Responses include these headers:

```
X-RateLimit-Limit: 60           # Max requests per minute
X-RateLimit-Remaining: 45       # Requests remaining
X-RateLimit-Reset: 1674156060   # Unix timestamp when limit resets
```

### When Rate Limited

When you exceed the limit, you'll receive:

```
HTTP 429 Too Many Requests

{
  "statusCode": 429,
  "error": "rate_limit_exceeded",
  "message": "Too many requests - rate limit exceeded",
  "request_id": "req-12345",
  "timestamp": "2026-01-19T12:00:00.000Z",
  "path": "/sessions"
}

Headers:
Retry-After: 23          # Seconds to wait before retrying
X-RateLimit-Reset: 1674156083
```

### Remedies

1. **Implement exponential backoff**: Wait 2^n seconds with jitter
2. **Use heartbeat throttle**: Keep heartbeat requests to ~1 per minute
3. **Batch operations**: Use bulk cleanup endpoint instead of individual deletes
4. **Contact support**: For legitimate high-volume needs, request increased limits

---

## Endpoints

### Health

Public endpoints for health monitoring. No authentication required.

#### Check Health

```
GET /health
```

Returns general health status.

**Response (200 OK)**:
```json
{
  "status": "ok",
  "timestamp": "2026-01-19T12:00:00.000Z",
  "uptime": 3600,
  "database": "connected",
  "latency": 5
}
```

**Error Responses**:
- `500 Internal Server Error`: Database unavailable

---

#### Check Readiness

```
GET /health/ready
```

Kubernetes-style readiness probe. Returns 200 if ready to accept traffic, 503 if not.

**Response (200 OK)**:
```json
{
  "ready": true,
  "timestamp": "2026-01-19T12:00:00.000Z",
  "database": "connected"
}
```

**Response (503 Service Unavailable)**:
```json
{
  "ready": false,
  "timestamp": "2026-01-19T12:00:00.000Z",
  "database": "disconnected"
}
```

---

#### Check Liveness

```
GET /health/live
```

Kubernetes-style liveness probe. Checks if process is alive and responsive.

**Response (200 OK)**:
```json
{
  "alive": true,
  "timestamp": "2026-01-19T12:00:00.000Z",
  "uptime": 3600
}
```

---

#### Detailed Health

```
GET /health/detailed
```

Comprehensive health information with system metrics.

**Response (200 OK)**:
```json
{
  "status": "ok",
  "timestamp": "2026-01-19T12:00:00.000Z",
  "uptime": 3600,
  "database": {
    "status": "connected",
    "latency": 5
  },
  "metrics": {
    "uptime": 3600,
    "memoryUsage": {
      "heapUsed": 52428800,
      "heapTotal": 104857600
    },
    "cpuUsage": {
      "user": 120000,
      "system": 30000
    },
    "activeSessionCount": 5,
    "errorRate": 0.001,
    "averageResponseTime": 45,
    "databaseLatency": 5,
    "version": "0.1.0"
  },
  "checks": {
    "memory": "ok",
    "database": "ok",
    "responseTime": "ok"
  }
}
```

---

#### System Information

```
GET /health/system
```

Detailed system information including Node.js version, platform, CPU, and memory.

**Response (200 OK)**:
```json
{
  "uptime": 3600,
  "nodeVersion": "v20.10.6",
  "platform": "darwin",
  "arch": "arm64",
  "cpus": 8,
  "totalMemory": 17179869184,
  "freeMemory": 8589934592,
  "heapUsed": 52428800,
  "heapTotal": 104857600,
  "external": 5242880,
  "rss": 209715200
}
```

---

### Sessions

Session state management endpoints. **Requires authentication**.

#### List Sessions

```
GET /sessions
```

Retrieve all sessions with optional filtering and pagination.

**Query Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | No | Filter by status (active, paused, stalled, completed, failed) |
| `project_id` | string | No | Filter by GitHub Project ID |
| `machine_id` | string | No | Filter by machine ID |
| `limit` | number | No | Results per page (default: 20, max: 100) |
| `offset` | number | No | Pagination offset (default: 0) |

**Example Request**:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3000/sessions?status=active&project_id=123&limit=10"
```

**Response (200 OK)**:
```json
[
  {
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "project_id": "123",
    "machine_id": "macbook-pro-m1",
    "docker_slot": 1,
    "status": "active",
    "started_at": "2026-01-19T11:00:00.000Z",
    "completed_at": null,
    "last_heartbeat": "2026-01-19T12:00:00.000Z",
    "current_task_id": "task-uuid-456",
    "recovery_attempts": 0,
    "metadata": {
      "vscode_version": "1.85.0",
      "extension_version": "0.1.0"
    }
  }
]
```

**Error Responses**:
- `400 Bad Request`: Invalid query parameters
- `401 Unauthorized`: Missing/invalid API key

---

#### Get Session by ID

```
GET /sessions/:id
```

Retrieve a single session by its unique session_id.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Session identifier |

**Example Request**:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/sessions/550e8400-e29b-41d4-a716-446655440000
```

**Response (200 OK)**:
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "project_id": "123",
  "machine_id": "macbook-pro-m1",
  "docker_slot": 1,
  "status": "active",
  "started_at": "2026-01-19T11:00:00.000Z",
  "completed_at": null,
  "last_heartbeat": "2026-01-19T12:00:00.000Z",
  "current_task_id": "task-uuid-456",
  "recovery_attempts": 0,
  "metadata": {
    "vscode_version": "1.85.0",
    "extension_version": "0.1.0"
  }
}
```

**Error Responses**:
- `404 Not Found`: Session not found

---

#### Create Session

```
POST /sessions
```

Create a new session. Session ID (UUID v4) is auto-generated.

**Request Body** (application/json):
```json
{
  "project_id": "123",
  "machine_id": "macbook-pro-m1",
  "docker_slot": 1,
  "metadata": {
    "vscode_version": "1.85.0",
    "extension_version": "0.1.0"
  }
}
```

**Example Request**:
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "123",
    "machine_id": "macbook-pro-m1",
    "docker_slot": 1
  }' \
  http://localhost:3000/sessions
```

**Response (201 Created)**:
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "project_id": "123",
  "machine_id": "macbook-pro-m1",
  "docker_slot": 1,
  "status": "active",
  "started_at": "2026-01-19T12:00:00.000Z",
  "completed_at": null,
  "last_heartbeat": "2026-01-19T12:00:00.000Z",
  "current_task_id": null,
  "recovery_attempts": 0,
  "metadata": {
    "vscode_version": "1.85.0",
    "extension_version": "0.1.0"
  }
}
```

**Error Responses**:
- `400 Bad Request`: Missing required fields or validation error
- `404 Not Found`: Machine or project not found

---

#### Update Session

```
PUT /sessions/:id
```

Update session fields. Immutable fields (session_id, project_id, machine_id, started_at) cannot be updated.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Session identifier |

**Request Body** (application/json):
```json
{
  "status": "paused",
  "current_task_id": "task-uuid-456",
  "metadata": {
    "notes": "Pausing for lunch break"
  }
}
```

**Example Request**:
```bash
curl -X PUT -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "paused",
    "metadata": {
      "notes": "Pausing for lunch break"
    }
  }' \
  http://localhost:3000/sessions/550e8400-e29b-41d4-a716-446655440000
```

**Response (200 OK)**:
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "project_id": "123",
  "machine_id": "macbook-pro-m1",
  "docker_slot": 1,
  "status": "paused",
  "started_at": "2026-01-19T11:00:00.000Z",
  "completed_at": null,
  "last_heartbeat": "2026-01-19T12:00:00.000Z",
  "current_task_id": "task-uuid-456",
  "recovery_attempts": 0,
  "metadata": {
    "notes": "Pausing for lunch break"
  }
}
```

**Error Responses**:
- `400 Bad Request`: Invalid update or immutable field change attempt
- `404 Not Found`: Session not found

---

#### Delete Session (Soft Delete)

```
DELETE /sessions/:id
```

Soft delete a session by setting status to "completed" and completed_at to current timestamp.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Session identifier |

**Example Request**:
```bash
curl -X DELETE -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/sessions/550e8400-e29b-41d4-a716-446655440000
```

**Response (204 No Content)**:
No response body.

**Error Responses**:
- `404 Not Found`: Session not found

---

#### Update Session Heartbeat

```
POST /sessions/:id/heartbeat
```

Update last_heartbeat timestamp. If session is stalled, it will be reactivated.

**Rate Limit**: 120 requests/minute (higher than standard endpoints)

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Session identifier |

**Example Request**:
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/sessions/550e8400-e29b-41d4-a716-446655440000/heartbeat
```

**Response (200 OK)**:
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "active",
  "last_heartbeat": "2026-01-19T12:00:15.000Z",
  "message": "Heartbeat updated successfully"
}
```

**Error Responses**:
- `404 Not Found`: Session not found
- `400 Bad Request`: Cannot update heartbeat for completed/failed session
- `429 Too Many Requests`: Rate limit exceeded

---

#### Find Stale Sessions

```
GET /sessions/stale
```

Find sessions where last_heartbeat is older than the threshold (default: 300 seconds).

**Query Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `threshold` | number | No | Threshold in seconds (default: 300) |

**Example Request**:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3000/sessions/stale?threshold=600"
```

**Response (200 OK)**:
```json
[
  {
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "project_id": "123",
    "machine_id": "macbook-pro-m1",
    "status": "active",
    "last_heartbeat": "2026-01-19T11:00:00.000Z",
    "seconds_since_heartbeat": 3600,
    "is_stale": true
  }
]
```

---

#### Find Active Sessions

```
GET /sessions/active
```

Find all sessions with status="active". Supports filtering by project_id and machine_id.

**Query Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | No | Filter by project ID |
| `machine_id` | string | No | Filter by machine ID |

**Example Request**:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3000/sessions/active?project_id=123"
```

**Response (200 OK)**:
```json
[
  {
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "project_id": "123",
    "machine_id": "macbook-pro-m1",
    "status": "active",
    "started_at": "2026-01-19T11:00:00.000Z",
    "current_task_id": "task-uuid-456"
  }
]
```

---

#### Get Session Health

```
GET /sessions/:id/health
```

Comprehensive health information for a session including staleness check and recommendations.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Session identifier |

**Query Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `threshold` | number | No | Stale threshold in seconds (default: 300) |

**Example Request**:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3000/sessions/550e8400-e29b-41d4-a716-446655440000/health"
```

**Response (200 OK)**:
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "active",
  "is_stale": false,
  "last_heartbeat": "2026-01-19T12:00:00.000Z",
  "seconds_since_heartbeat": 15,
  "health_score": 95,
  "recommendations": []
}
```

---

#### Get Sessions by Project

```
GET /sessions/by-project/:projectId
```

Get all sessions for a GitHub Project, grouped by status with summary statistics.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | string | Yes | GitHub Project ID |

**Example Request**:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/sessions/by-project/123
```

**Response (200 OK)**:
```json
{
  "project_id": "123",
  "total_sessions": 5,
  "by_status": {
    "active": {
      "count": 3,
      "sessions": [...]
    },
    "completed": {
      "count": 2,
      "sessions": [...]
    }
  }
}
```

---

#### Mark Session as Failed

```
POST /sessions/:id/mark-failed
```

Manually mark a session as failed with a reason and optional error details.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Session identifier |

**Request Body** (application/json):
```json
{
  "reason": "Claude process crashed unexpectedly",
  "error_details": {
    "error_code": "ERR_CLAUDE_CRASH",
    "exit_code": 1,
    "stack_trace": "Error: Process exited with code 1"
  }
}
```

**Example Request**:
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Claude process crashed",
    "error_details": {
      "error_code": "ERR_CRASH",
      "exit_code": 1
    }
  }' \
  http://localhost:3000/sessions/550e8400-e29b-41d4-a716-446655440000/mark-failed
```

**Response (200 OK)**:
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "failed",
  "completed_at": "2026-01-19T12:00:30.000Z",
  "metadata": {
    "failure_reason": "Claude process crashed unexpectedly"
  }
}
```

---

#### Get Failure Information

```
GET /sessions/:id/failure-info
```

Get detailed failure information including reason, error details, and recovery recommendations.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Session identifier |

**Example Request**:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/sessions/550e8400-e29b-41d4-a716-446655440000/failure-info
```

**Response (200 OK)**:
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "failure_reason": "Claude process crashed unexpectedly",
  "error_details": {
    "error_code": "ERR_CLAUDE_CRASH",
    "exit_code": 1
  },
  "failed_at": "2026-01-19T12:00:30.000Z",
  "last_successful_task_id": "task-uuid-455",
  "recovery_recommendations": [
    "Check machine resources (CPU, memory)",
    "Review Claude logs for errors",
    "Attempt recovery with new machine"
  ]
}
```

---

#### Archive Session

```
POST /sessions/:id/archive
```

Archive a completed session. Archived sessions are excluded from normal queries.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Session identifier |

**Example Request**:
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/sessions/550e8400-e29b-41d4-a716-446655440000/archive
```

**Response (200 OK)**:
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "archived",
  "archived_at": "2026-01-19T12:00:45.000Z"
}
```

---

#### Purge Session (Hard Delete)

```
DELETE /sessions/:id/purge
```

Permanently delete a session and all associated tasks. Cannot be undone.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Session identifier |

**Request Body** (application/json):
```json
{
  "confirm": true
}
```

**Example Request**:
```bash
curl -X DELETE -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"confirm": true}' \
  http://localhost:3000/sessions/550e8400-e29b-41d4-a716-446655440000/purge
```

**Response (200 OK)**:
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "purged": true,
  "tasks_deleted": 5
}
```

---

#### Recover Session

```
POST /sessions/:id/recover
```

Attempt to recover a failed or stalled session. Can optionally assign to a new machine.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Session identifier |

**Request Body** (application/json, optional):
```json
{
  "new_machine_id": "macbook-air-m2",
  "new_docker_slot": 2,
  "resume_from_task_id": "task-uuid-456"
}
```

**Example Request**:
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "new_machine_id": "macbook-air-m2"
  }' \
  http://localhost:3000/sessions/550e8400-e29b-41d4-a716-446655440000/recover
```

**Response (200 OK)**:
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "active",
  "recovery_attempts": 1,
  "machine_id": "macbook-air-m2",
  "docker_slot": 2
}
```

---

### Tasks

Task monitoring endpoints. **Requires authentication**.

#### List Tasks

```
GET /tasks
```

Get all tasks with optional filtering by session, status, or project.

**Query Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | No | Filter by session ID |
| `status` | string | No | Filter by status (pending, in_progress, completed, failed) |
| `project_id` | string | No | Filter by project ID |
| `limit` | number | No | Results per page (default: 20, max: 100) |
| `offset` | number | No | Pagination offset (default: 0) |

**Example Request**:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3000/tasks?session_id=550e8400-e29b-41d4-a716-446655440000&status=in_progress"
```

**Response (200 OK)**:
```json
[
  {
    "task_id": "task-uuid-456",
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "project_id": "123",
    "status": "in_progress",
    "github_issue_id": "456",
    "started_at": "2026-01-19T12:00:00.000Z",
    "completed_at": null,
    "error_message": null,
    "metadata": {}
  }
]
```

---

#### Create Task

```
POST /tasks
```

Create a new task with pending status.

**Request Body** (application/json):
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "project_id": "123",
  "github_issue_id": "456"
}
```

**Example Request**:
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "project_id": "123",
    "github_issue_id": "456"
  }' \
  http://localhost:3000/tasks
```

**Response (201 Created)**:
```json
{
  "task_id": "task-uuid-456",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "project_id": "123",
  "status": "pending",
  "github_issue_id": "456",
  "created_at": "2026-01-19T12:00:00.000Z",
  "started_at": null,
  "completed_at": null,
  "error_message": null,
  "metadata": {}
}
```

---

#### Start Task

```
POST /tasks/:id/start
```

Transition task from pending to in_progress.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Task identifier |

**Example Request**:
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/tasks/task-uuid-456/start
```

**Response (200 OK)**:
```json
{
  "task_id": "task-uuid-456",
  "status": "in_progress",
  "started_at": "2026-01-19T12:00:15.000Z"
}
```

---

#### Complete Task

```
POST /tasks/:id/complete
```

Mark task as completed.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Task identifier |

**Example Request**:
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/tasks/task-uuid-456/complete
```

**Response (200 OK)**:
```json
{
  "task_id": "task-uuid-456",
  "status": "completed",
  "completed_at": "2026-01-19T12:00:30.000Z"
}
```

---

#### Fail Task

```
POST /tasks/:id/fail
```

Mark task as failed with error message.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Task identifier |

**Request Body** (application/json):
```json
{
  "error_message": "GitHub API rate limit exceeded"
}
```

**Example Request**:
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"error_message": "GitHub API rate limit exceeded"}' \
  http://localhost:3000/tasks/task-uuid-456/fail
```

**Response (200 OK)**:
```json
{
  "task_id": "task-uuid-456",
  "status": "failed",
  "completed_at": "2026-01-19T12:00:30.000Z",
  "error_message": "GitHub API rate limit exceeded"
}
```

---

#### Get Session Task Progress

```
GET /sessions/:id/tasks
```

Get all tasks for a session grouped by status with progress statistics.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | Session identifier |

**Example Request**:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/sessions/550e8400-e29b-41d4-a716-446655440000/tasks
```

**Response (200 OK)**:
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "total_tasks": 10,
  "completed_tasks": 7,
  "failed_tasks": 1,
  "progress_percentage": 70,
  "by_status": {
    "pending": { "count": 2, "tasks": [...] },
    "in_progress": { "count": 0, "tasks": [] },
    "completed": { "count": 7, "tasks": [...] },
    "failed": { "count": 1, "tasks": [...] }
  }
}
```

---

### Machines

Machine/docker slot tracking endpoints. **Requires authentication**.

#### List Machines

```
GET /machines
```

Get all registered machines with optional filtering.

**Query Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | No | Filter by status (online, offline, maintenance) |
| `hostname` | string | No | Filter by hostname |

**Example Request**:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3000/machines?status=online"
```

**Response (200 OK)**:
```json
[
  {
    "machine_id": "macbook-pro-m1",
    "hostname": "macbook.local",
    "status": "online",
    "docker_slots": [1, 2, 3, 4],
    "assigned_sessions": {
      "1": "550e8400-e29b-41d4-a716-446655440000",
      "2": null,
      "3": null,
      "4": null
    },
    "last_heartbeat": "2026-01-19T12:00:00.000Z",
    "created_at": "2026-01-19T10:00:00.000Z"
  }
]
```

---

#### Find Available Machines

```
GET /machines/available
```

Find machines with status="online", including available docker slot count.

**Example Request**:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/machines/available
```

**Response (200 OK)**:
```json
[
  {
    "machine_id": "macbook-pro-m1",
    "hostname": "macbook.local",
    "available_slots": 3,
    "total_slots": 4,
    "assigned_sessions": 1
  }
]
```

---

#### Create Machine

```
POST /machines
```

Register a new machine with docker slots.

**Request Body** (application/json):
```json
{
  "machine_id": "macbook-pro-m1",
  "hostname": "macbook.local",
  "docker_slots": [1, 2, 3, 4]
}
```

**Example Request**:
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "machine_id": "macbook-pro-m1",
    "hostname": "macbook.local",
    "docker_slots": [1, 2, 3, 4]
  }' \
  http://localhost:3000/machines
```

**Response (201 Created)**:
```json
{
  "machine_id": "macbook-pro-m1",
  "hostname": "macbook.local",
  "status": "online",
  "docker_slots": [1, 2, 3, 4],
  "assigned_sessions": {},
  "last_heartbeat": "2026-01-19T12:00:00.000Z",
  "created_at": "2026-01-19T12:00:00.000Z"
}
```

---

#### Update Machine Heartbeat

```
POST /machines/:id/heartbeat
```

Update last_heartbeat timestamp. If machine is offline, it will be brought back online.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Machine identifier |

**Example Request**:
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/machines/macbook-pro-m1/heartbeat
```

**Response (200 OK)**:
```json
{
  "machine_id": "macbook-pro-m1",
  "status": "online",
  "last_heartbeat": "2026-01-19T12:00:15.000Z",
  "message": "Heartbeat updated successfully"
}
```

---

#### Assign Session to Machine

```
POST /machines/:id/assign-session
```

Assign a session to a machine slot.

**Path Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Machine identifier |

**Request Body** (application/json):
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "docker_slot": 1
}
```

**Example Request**:
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "docker_slot": 1
  }' \
  http://localhost:3000/machines/macbook-pro-m1/assign-session
```

**Response (200 OK)**:
```json
{
  "machine_id": "macbook-pro-m1",
  "assigned_sessions": {
    "1": "550e8400-e29b-41d4-a716-446655440000",
    "2": null,
    "3": null,
    "4": null
  }
}
```

---

---

## Schemas

### Session Schema

```json
{
  "session_id": "string (UUID)",
  "project_id": "string",
  "machine_id": "string",
  "docker_slot": "number (nullable)",
  "status": "string (active|paused|stalled|completed|failed|archived)",
  "started_at": "string (ISO 8601)",
  "completed_at": "string (ISO 8601, nullable)",
  "last_heartbeat": "string (ISO 8601)",
  "current_task_id": "string (nullable)",
  "recovery_attempts": "number",
  "metadata": "object"
}
```

### Task Schema

```json
{
  "task_id": "string",
  "session_id": "string (UUID)",
  "project_id": "string",
  "status": "string (pending|in_progress|completed|failed)",
  "github_issue_id": "string (nullable)",
  "created_at": "string (ISO 8601)",
  "started_at": "string (ISO 8601, nullable)",
  "completed_at": "string (ISO 8601, nullable)",
  "error_message": "string (nullable)",
  "metadata": "object"
}
```

### Machine Schema

```json
{
  "machine_id": "string",
  "hostname": "string",
  "status": "string (online|offline|maintenance)",
  "docker_slots": "array of numbers",
  "assigned_sessions": "object (slot -> session_id mapping)",
  "last_heartbeat": "string (ISO 8601)",
  "created_at": "string (ISO 8601)"
}
```

---

## Error Codes

### Standard HTTP Status Codes

| Status | Error Code | Description | Remedy |
|--------|-----------|-------------|--------|
| 400 | `validation_error` | Request validation failed (invalid input, missing required fields) | Check request body format and required fields |
| 401 | `unauthorized` | Missing or invalid API key | Verify API key is correct and hasn't expired |
| 403 | `forbidden` | API key valid but insufficient permissions | Contact admin to grant access |
| 404 | `not_found` | Requested resource not found | Verify the resource ID and that it exists |
| 409 | `conflict` | Resource conflict (e.g., duplicate entry, slot occupied) | Check for existing resources or try a different slot |
| 429 | `rate_limit_exceeded` | Too many requests - rate limit exceeded | Implement exponential backoff and retry |
| 500 | `internal_error` | Unexpected internal server error | Check logs and retry; contact support if persistent |
| 503 | `service_unavailable` | Service is not ready | Wait and retry; check system status |
| 504 | `timeout` | Request or database operation timed out | Retry with shorter timeout or check database |

### Common Error Responses

#### Validation Error (400)

```json
{
  "statusCode": 400,
  "error": "validation_error",
  "message": "Validation failed",
  "details": [
    "project_id should not be empty",
    "docker_slot must be a number"
  ],
  "request_id": "req-123",
  "timestamp": "2026-01-19T12:00:00.000Z",
  "path": "/sessions"
}
```

**Remedy**: Verify all required fields are provided and formatted correctly.

---

#### Not Found Error (404)

```json
{
  "statusCode": 404,
  "error": "not_found",
  "message": "Session with ID abc-123 not found",
  "request_id": "req-124",
  "timestamp": "2026-01-19T12:00:00.000Z",
  "path": "/sessions/abc-123"
}
```

**Remedy**: Verify the session ID exists and is correctly formatted.

---

#### Unauthorized Error (401)

```json
{
  "statusCode": 401,
  "error": "unauthorized",
  "message": "Invalid API key",
  "request_id": "req-125",
  "timestamp": "2026-01-19T12:00:00.000Z",
  "path": "/sessions"
}
```

**Remedy**: Check that your API key is correct and include it in the Authorization header or X-API-Key header.

---

#### Rate Limit Error (429)

```json
{
  "statusCode": 429,
  "error": "rate_limit_exceeded",
  "message": "Too many requests - rate limit exceeded",
  "request_id": "req-126",
  "timestamp": "2026-01-19T12:00:00.000Z",
  "path": "/sessions",
  "retry_after": 23
}
```

Headers:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1674156083
Retry-After: 23
```

**Remedy**: Implement exponential backoff. Wait the number of seconds indicated by `Retry-After` before retrying.

---

---

## Common Workflows

### 1. Create and Monitor a Session

**Scenario**: Start a new Claude project session on a machine.

```bash
# 1. Create session
SESSION=$(curl -s -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "123",
    "machine_id": "macbook-pro-m1",
    "docker_slot": 1
  }' \
  http://localhost:3000/sessions | jq -r '.session_id')

echo "Created session: $SESSION"

# 2. Send heartbeat every 60 seconds
while true; do
  curl -s -X POST \
    -H "Authorization: Bearer YOUR_API_KEY" \
    "http://localhost:3000/sessions/$SESSION/heartbeat"
  sleep 60
done
```

---

### 2. Handle Session Failure and Recovery

**Scenario**: Detect failed session and attempt recovery.

```bash
# 1. Check session health
curl -s -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3000/sessions/$SESSION/health" | jq

# 2. If failed, get failure info
curl -s -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3000/sessions/$SESSION/failure-info" | jq

# 3. Prepare recovery
curl -s -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3000/sessions/$SESSION/prepare-recovery" | jq

# 4. Recover with new machine
curl -s -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "new_machine_id": "macbook-air-m2",
    "new_docker_slot": 2
  }' \
  "http://localhost:3000/sessions/$SESSION/recover" | jq
```

---

### 3. Track Task Progress

**Scenario**: Monitor task execution within a session.

```bash
# 1. Create task
TASK=$(curl -s -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "'$SESSION'",
    "project_id": "123",
    "github_issue_id": "456"
  }' \
  http://localhost:3000/tasks | jq -r '.task_id')

# 2. Start task
curl -s -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3000/tasks/$TASK/start" | jq

# 3. Complete task
curl -s -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3000/tasks/$TASK/complete" | jq

# 4. Get session progress
curl -s -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3000/sessions/$SESSION/tasks" | jq
```

---

### 4. Manage Machine Capacity

**Scenario**: Find available machines and assign sessions.

```bash
# 1. Find available machines
MACHINE=$(curl -s -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/machines/available | jq -r '.[0].machine_id')

# 2. Assign session to machine
curl -s -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "'$SESSION'",
    "docker_slot": 2
  }' \
  "http://localhost:3000/machines/$MACHINE/assign-session" | jq

# 3. Update machine heartbeat
curl -s -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3000/machines/$MACHINE/heartbeat" | jq
```

---

## API Versioning

The API version is included in all responses and the OpenAPI specification.

**Current Version**: 0.1.0

### Version Information

- **Semantic Versioning**: `MAJOR.MINOR.PATCH`
  - `MAJOR`: Breaking changes
  - `MINOR`: Backwards-compatible new features
  - `PATCH`: Bug fixes and patches

### Checking API Version

```bash
# From Swagger UI
GET /api/docs

# From OpenAPI spec
GET /api/docs/openapi.json

# From health endpoint
GET /health/system
```

### Deprecation Policy

- Deprecated endpoints will include `Deprecated: true` in Swagger documentation
- Deprecation notices will be added 2 versions before removal
- Security patches may require immediate updates

---

## Support

For issues, questions, or feature requests:

1. Check the [Troubleshooting Guide](./TROUBLESHOOTING.md)
2. Review the [Error Handling documentation](./ERROR_HANDLING.md)
3. Check the [Runbooks](./RUNBOOKS.md) for operational procedures
4. Contact your system administrator

---

**Last Updated**: 2026-01-19
**API Version**: 0.1.0
**Status**: Active
