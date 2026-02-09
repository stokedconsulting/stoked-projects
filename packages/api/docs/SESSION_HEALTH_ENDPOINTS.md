# Session Health Query Endpoints

This document describes the specialized query endpoints for session health monitoring and analysis.

## Overview

The Session Health Query Endpoints provide efficient ways to monitor and analyze the health of Claude sessions across your infrastructure. These endpoints are optimized with MongoDB indexes and aggregation pipelines for fast queries.

## Authentication

All endpoints require authentication via API key:
- Header: `X-API-Key: <your-api-key>`
- Or: `Authorization: Bearer <your-api-key>`

## Endpoints

### 1. Find Stale Sessions

**GET** `/sessions/stale`

Returns sessions where `last_heartbeat` is older than the threshold.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| threshold | number | No | 300 | Threshold in seconds (default: 300 = 5 minutes) |

#### Response

```json
[
  {
    "session_id": "session-123",
    "project_id": "project-456",
    "machine_id": "machine-789",
    "docker_slot": 1,
    "status": "active",
    "last_heartbeat": "2026-01-19T10:30:00.000Z",
    "current_task_id": "task-101",
    "time_since_heartbeat": 420,
    "started_at": "2026-01-19T09:00:00.000Z"
  }
]
```

#### Example

```bash
# Find sessions with no heartbeat for over 5 minutes (default)
curl -H "X-API-Key: your-key" \
  http://localhost:3000/sessions/stale

# Find sessions with no heartbeat for over 10 minutes
curl -H "X-API-Key: your-key" \
  http://localhost:3000/sessions/stale?threshold=600
```

---

### 2. Find Active Sessions

**GET** `/sessions/active`

Returns all sessions with `status="active"`.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | string | No | Filter by GitHub Project ID |
| machine_id | string | No | Filter by machine ID |

#### Response

```json
[
  {
    "session_id": "session-123",
    "project_id": "project-456",
    "machine_id": "machine-789",
    "docker_slot": 1,
    "status": "active",
    "last_heartbeat": "2026-01-19T11:45:00.000Z",
    "current_task_id": "task-101",
    "started_at": "2026-01-19T09:00:00.000Z",
    "time_since_heartbeat": 45
  }
]
```

#### Examples

```bash
# Get all active sessions
curl -H "X-API-Key: your-key" \
  http://localhost:3000/sessions/active

# Get active sessions for a specific project
curl -H "X-API-Key: your-key" \
  http://localhost:3000/sessions/active?project_id=project-456

# Get active sessions on a specific machine
curl -H "X-API-Key: your-key" \
  http://localhost:3000/sessions/active?machine_id=machine-789

# Get active sessions for a project on a specific machine
curl -H "X-API-Key: your-key" \
  "http://localhost:3000/sessions/active?project_id=project-456&machine_id=machine-789"
```

---

### 3. Get Sessions by Project

**GET** `/sessions/by-project/:projectId`

Returns all sessions for a GitHub Project, grouped by status with summary statistics.

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| projectId | string | GitHub Project ID |

#### Response

```json
{
  "project_id": "project-456",
  "sessions": {
    "active": [
      {
        "session_id": "session-123",
        "machine_id": "machine-789",
        "status": "active",
        ...
      }
    ],
    "paused": [],
    "stalled": [],
    "completed": [
      {
        "session_id": "session-122",
        "machine_id": "machine-789",
        "status": "completed",
        ...
      }
    ],
    "failed": []
  },
  "stats": {
    "total": 2,
    "active": 1,
    "paused": 0,
    "stalled": 0,
    "completed": 1,
    "failed": 0
  }
}
```

#### Example

```bash
curl -H "X-API-Key: your-key" \
  http://localhost:3000/sessions/by-project/project-456
```

---

### 4. Get Sessions by Machine

**GET** `/sessions/by-machine/:machineId`

Returns all sessions for a specific machine, including docker slot assignments.

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| machineId | string | Machine ID |

#### Response

```json
[
  {
    "session_id": "session-123",
    "project_id": "project-456",
    "machine_id": "machine-789",
    "docker_slot": 1,
    "status": "active",
    "last_heartbeat": "2026-01-19T11:45:00.000Z",
    "current_task_id": "task-101",
    "started_at": "2026-01-19T09:00:00.000Z"
  },
  {
    "session_id": "session-124",
    "project_id": "project-457",
    "machine_id": "machine-789",
    "docker_slot": 2,
    "status": "completed",
    "last_heartbeat": "2026-01-19T10:30:00.000Z",
    "started_at": "2026-01-19T09:00:00.000Z",
    "completed_at": "2026-01-19T10:30:00.000Z"
  }
]
```

#### Example

```bash
curl -H "X-API-Key: your-key" \
  http://localhost:3000/sessions/by-machine/machine-789
```

---

### 5. Get Session Health Status

**GET** `/sessions/:id/health`

Returns comprehensive health information for a session.

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| id | string | Session ID |

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| threshold | number | No | 300 | Stale threshold in seconds |

#### Response

```json
{
  "session_id": "session-123",
  "project_id": "project-456",
  "machine_id": "machine-789",
  "docker_slot": 1,
  "status": "active",
  "last_heartbeat": "2026-01-19T11:45:00.000Z",
  "current_task_id": "task-101",
  "is_stale": false,
  "time_since_heartbeat": 45,
  "recommendations": [
    "Session is healthy and active"
  ],
  "started_at": "2026-01-19T09:00:00.000Z",
  "completed_at": null
}
```

#### Health Recommendations

The endpoint provides actionable recommendations based on session state:

| Scenario | Recommendations |
|----------|-----------------|
| Healthy active session | "Session is healthy and active" |
| Stale active session (> threshold) | "Session may have crashed - no heartbeat received"<br>"Consider marking session as stalled or failed" |
| Very stale session (> 10 min) | "Session has been unresponsive for over 10 minutes" |
| Stalled session | "Session is in stalled state"<br>"Review session logs and consider recovery or cleanup" |
| Failed session | "Session has failed"<br>"Review error logs and failure reason" |
| Stale paused session | "Paused session has not sent heartbeat"<br>"Session may need to be resumed or cleaned up" |

#### Examples

```bash
# Get health for a session
curl -H "X-API-Key: your-key" \
  http://localhost:3000/sessions/session-123/health

# Get health with custom stale threshold (10 minutes)
curl -H "X-API-Key: your-key" \
  http://localhost:3000/sessions/session-123/health?threshold=600
```

#### Error Responses

**404 Not Found**
```json
{
  "statusCode": 404,
  "message": "Session with ID session-999 not found",
  "error": "Not Found"
}
```

---

### 6. Find Available Machines

**GET** `/machines/available`

Returns machines with `status="online"`, including available docker slot count. Results are sorted by most available slots.

#### Response

```json
[
  {
    "machine_id": "machine-789",
    "hostname": "worker-01.example.com",
    "status": "online",
    "total_slots": 4,
    "occupied_slots": 1,
    "available_slots": 3,
    "available_slot_numbers": [2, 3, 4],
    "active_sessions": ["session-123"],
    "last_heartbeat": "2026-01-19T11:45:00.000Z"
  },
  {
    "machine_id": "machine-790",
    "hostname": "worker-02.example.com",
    "status": "online",
    "total_slots": 2,
    "occupied_slots": 0,
    "available_slots": 2,
    "available_slot_numbers": [1, 2],
    "active_sessions": [],
    "last_heartbeat": "2026-01-19T11:45:00.000Z"
  }
]
```

#### Example

```bash
curl -H "X-API-Key: your-key" \
  http://localhost:3000/machines/available
```

---

## Query Optimization

All health query endpoints are optimized with:

### MongoDB Indexes

- `last_heartbeat` - For stale session detection
- `status` - For filtering by session status
- `project_id + status` - Compound index for project queries
- `machine_id + status` - Compound index for machine queries
- `session_id` - Unique index for fast lookups

### Query Features

- **Efficient filtering**: Uses MongoDB query operators for fast filtering
- **Sorted results**: Results are pre-sorted for optimal performance
- **Aggregation pipelines**: Summary statistics use MongoDB aggregation for server-side processing
- **Pagination support**: Built-in support for limiting result sets (can be added via query params)

## Default Thresholds

| Threshold | Value | Description |
|-----------|-------|-------------|
| Stale session | 300 seconds (5 minutes) | Time without heartbeat before session is considered stale |
| Very stale session | 600 seconds (10 minutes) | Time without heartbeat before additional warnings |

## Error Responses

### 401 Unauthorized

Missing or invalid API key:
```json
{
  "statusCode": 401,
  "message": "API key is missing",
  "error": "Unauthorized"
}
```

### 404 Not Found

Resource not found:
```json
{
  "statusCode": 404,
  "message": "Session with ID session-999 not found",
  "error": "Not Found"
}
```

## Use Cases

### 1. Monitoring Dashboard

Use these endpoints to build a real-time monitoring dashboard:

```javascript
// Get overview of all projects
const projects = await getActiveProjects();
for (const project of projects) {
  const summary = await fetch(`/sessions/by-project/${project.id}`);
  displayProjectStats(summary);
}

// Check for stale sessions
const stale = await fetch('/sessions/stale');
if (stale.length > 0) {
  alertStaleSessions(stale);
}

// Find available capacity
const available = await fetch('/machines/available');
displayAvailableCapacity(available);
```

### 2. Health Check Automation

Regularly check session health and take action:

```javascript
// Run every 5 minutes
setInterval(async () => {
  const stale = await fetch('/sessions/stale');

  for (const session of stale) {
    const health = await fetch(`/sessions/${session.session_id}/health`);

    if (health.time_since_heartbeat > 600) {
      // Mark as stalled after 10 minutes
      await updateSession(session.session_id, { status: 'stalled' });
      notifyAdmins(session);
    }
  }
}, 5 * 60 * 1000);
```

### 3. Capacity Planning

Find the best machine for a new session:

```javascript
const available = await fetch('/machines/available');
const bestMachine = available[0]; // Already sorted by most available slots

if (bestMachine.available_slots > 0) {
  const slot = bestMachine.available_slot_numbers[0];
  await createSession({
    machine_id: bestMachine.machine_id,
    docker_slot: slot,
    ...
  });
}
```

### 4. Project Status Report

Generate a status report for a project:

```javascript
const projectId = 'project-456';
const summary = await fetch(`/sessions/by-project/${projectId}`);

console.log(`Project ${projectId} Status:`);
console.log(`- Total sessions: ${summary.stats.total}`);
console.log(`- Active: ${summary.stats.active}`);
console.log(`- Completed: ${summary.stats.completed}`);
console.log(`- Failed: ${summary.stats.failed}`);

// Check for stale sessions in this project
const activeSessions = await fetch(`/sessions/active?project_id=${projectId}`);
const stale = activeSessions.filter(s => s.time_since_heartbeat > 300);
console.log(`- Stale sessions: ${stale.length}`);
```

## Swagger Documentation

All endpoints are documented in Swagger/OpenAPI. Access the interactive documentation at:

```
http://localhost:3000/api
```

The Swagger UI provides:
- Interactive API testing
- Request/response schemas
- Example requests and responses
- Authentication testing

## Performance Considerations

1. **Index Usage**: All queries are optimized to use MongoDB indexes
2. **Sorting**: Results are sorted at the database level for efficiency
3. **Aggregation**: Summary statistics use MongoDB aggregation pipelines
4. **Connection Pooling**: MongoDB connection pool handles concurrent requests
5. **Caching**: Consider adding Redis caching for frequently accessed data

## Testing

The implementation includes comprehensive tests:

### Unit Tests
- `session-health.service.spec.ts` - Health calculation logic (18 tests)
- `machine-health.service.spec.ts` - Machine availability logic (10 tests)

### Integration Tests
- `session-health.e2e-spec.ts` - End-to-end endpoint tests

Run tests:
```bash
# Unit tests
npm test

# Integration tests
npm run test:e2e
```
