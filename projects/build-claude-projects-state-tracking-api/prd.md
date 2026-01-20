# Product Requirements Document (Sequential)

## 0. Source Context
**Derived From:** Product Feature Brief
**Feature Name:** Claude Projects State Tracking API
**PRD Owner:** TBD
**Last Updated:** 2026-01-19

**Source Feature Brief:** `./pfb.md`

### Feature Brief Summary
A backend API service that provides runtime state tracking for Claude AI project orchestration sessions running in VSCode. The API monitors active sessions through heartbeat mechanisms, detects crashes or stalled sessions, and enables automatic restart/recovery capabilities to ensure projects run to completion. This service complements GitHub Projects (the source of truth for work items) by focusing exclusively on runtime session state and health monitoring.

---

## 1. Objectives & Constraints

### Objectives
- **Enable session crash detection:** Automatically detect when active orchestration sessions stop responding within configurable timeframes (target: <5 minutes)
- **Support automatic recovery:** Provide APIs that enable the VSCode extension to restart failed sessions from their last known state
- **Establish monitoring foundation:** Create infrastructure for tracking session health, machine assignments, and orchestration task progress
- **Ensure data reliability:** Maintain consistent, accurate state information that can be used for recovery decisions with zero state corruption incidents

### Constraints
- **Technical Stack:** Must use NestJS framework (following patterns from ../v3/packages/api reference implementation), MongoDB Atlas as database, SST for deployment infrastructure
- **Database:** MongoDB Atlas with database name "claude-projects" - single database instance for all collections
- **Domain:** Must deploy to claude-projects.truapi.com
- **Authentication:** API key-based authentication only (no OAuth, no user sessions, no complex auth systems)
- **Deployment:** Must use `pnpm deploy:prod` workflow compatible with SST infrastructure-as-code
- **Architecture:** Stateless API design - all state persisted in MongoDB, no in-memory caching initially
- **Scale:** Optimize for tens of concurrent sessions initially, not 1000+ concurrent sessions
- **Single Region:** Deploy to single AWS region initially - no multi-region requirements
- **No Real-time:** HTTP polling only - no WebSocket or Server-Sent Events in initial version

---

## 2. Execution Phases

> Phases below are ordered and sequential.
> A phase cannot begin until all acceptance criteria of the previous phase are met.

---

## Phase 1: Foundation & Database Schema
**Purpose:** Establish the foundational database schema and data models that all subsequent API endpoints and business logic depend on. Without properly designed schemas and indexes, we cannot reliably track session state or enable recovery operations.

### 1.1 MongoDB Schema Design & Models
Design and implement MongoDB schemas for session tracking, task monitoring, and machine/slot assignments.

**Implementation Details**
- **Systems affected:** MongoDB Atlas "claude-projects" database, NestJS data models
- **Collections to create:**
  - `sessions`: Primary collection for orchestration session state
  - `tasks`: Task-level progress within sessions
  - `machines`: Machine/docker slot availability and assignments
- **Session schema fields:**
  - `session_id` (string, unique, indexed): UUID for session identification
  - `project_id` (string, indexed): GitHub Project ID this session is working on
  - `machine_id` (string, indexed): Unique identifier for machine running session
  - `docker_slot` (number, optional): Docker slot number if using containerized execution
  - `status` (enum: "active", "paused", "completed", "failed", "stalled"): Current session state
  - `last_heartbeat` (timestamp, indexed): Last successful heartbeat timestamp
  - `current_task_id` (string, optional): Reference to current task being executed
  - `started_at` (timestamp): Session start time
  - `completed_at` (timestamp, optional): Session completion/failure time
  - `metadata` (object): Additional session context (VSCode version, extension version, etc.)
  - `created_at` (timestamp): Document creation time
  - `updated_at` (timestamp): Last update time
- **Task schema fields:**
  - `task_id` (string, unique, indexed): UUID for task identification
  - `session_id` (string, indexed): Parent session reference
  - `project_id` (string, indexed): GitHub Project ID
  - `github_issue_id` (string, optional): Corresponding GitHub issue ID
  - `task_name` (string): Human-readable task description
  - `status` (enum: "pending", "in_progress", "completed", "failed", "blocked"): Task state
  - `started_at` (timestamp, optional): Task execution start time
  - `completed_at` (timestamp, optional): Task completion time
  - `error_message` (string, optional): Failure reason if status is "failed"
  - `created_at` (timestamp): Document creation time
  - `updated_at` (timestamp): Last update time
- **Machine schema fields:**
  - `machine_id` (string, unique, indexed): Unique machine identifier
  - `hostname` (string): Machine hostname
  - `docker_slots` (array): List of available docker slot numbers
  - `active_sessions` (array): List of active session IDs on this machine
  - `status` (enum: "online", "offline", "maintenance"): Machine availability
  - `last_heartbeat` (timestamp, indexed): Last machine heartbeat
  - `metadata` (object): Machine specs, OS info, etc.
  - `created_at` (timestamp): Document creation time
  - `updated_at` (timestamp): Last update time
- **Indexes to create:**
  - Sessions: compound index on (project_id, status), single indexes on session_id, machine_id, last_heartbeat
  - Tasks: compound index on (session_id, status), single indexes on task_id, project_id
  - Machines: single indexes on machine_id, status, last_heartbeat
- **TTL indexes:** Sessions and Tasks with completed_at > 30 days (configurable retention policy)
- **Data validation:** Use Mongoose schemas with strict validation for required fields and enum values
- **Failure modes:** Schema validation errors, index creation failures, connection timeouts

**Acceptance Criteria**
- AC-1.1.a: When session schema is created → all required fields (session_id, project_id, machine_id, last_heartbeat, status, started_at, created_at, updated_at) are defined with proper types and constraints
- AC-1.1.b: When task schema is created → all required fields (task_id, session_id, project_id, task_name, status, created_at, updated_at) are defined with proper types and constraints
- AC-1.1.c: When machine schema is created → all required fields (machine_id, hostname, docker_slots, active_sessions, status, last_heartbeat, created_at, updated_at) are defined with proper types and constraints
- AC-1.1.d: When status enum values are defined → only valid values ("active", "paused", "completed", "failed", "stalled" for sessions) are accepted by schema validation
- AC-1.1.e: When required indexes are created → queries on session_id, project_id, machine_id, and last_heartbeat use indexes (verified via explain plan)
- AC-1.1.f: When TTL index is configured → documents with completed_at older than 30 days are automatically removed from database

**Acceptance Tests**
- Test-1.1.a: Unit test validates session model schema includes all required fields with correct types and rejects documents missing required fields
- Test-1.1.b: Unit test validates task model schema includes all required fields and rejects invalid status enum values
- Test-1.1.c: Unit test validates machine model schema includes all required fields and validates docker_slots as array type
- Test-1.1.d: Integration test creates session document with invalid status value and receives validation error
- Test-1.1.e: Integration test runs query on last_heartbeat field and verifies index usage via MongoDB explain plan
- Test-1.1.f: Integration test creates completed session with completed_at = 31 days ago and verifies TTL cleanup after configured interval

---

### 1.2 NestJS Project Setup & Structure
Set up NestJS project structure following architectural patterns from v3/packages/api reference implementation.

**Implementation Details**
- **Systems affected:** Project directory structure, module organization, dependency configuration
- **Project location:** Create new directory `packages/state-tracking-api` within claude-projects workspace
- **Core modules to create:**
  - `AppModule`: Root application module with configuration, database connection
  - `SessionsModule`: Session state management endpoints and services
  - `TasksModule`: Task monitoring endpoints and services
  - `MachinesModule`: Machine/docker slot tracking endpoints and services
  - `AuthModule`: API key authentication middleware and guards
  - `HealthModule`: Health check and monitoring endpoints
- **Dependencies to install:**
  - `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`: Core NestJS framework
  - `@nestjs/mongoose`: MongoDB integration
  - `mongoose`: MongoDB ODM
  - `@nestjs/config`: Configuration management
  - `class-validator`, `class-transformer`: Request validation
  - `@nestjs/swagger`: API documentation (OpenAPI)
- **Configuration management:**
  - Use `@nestjs/config` for environment variable loading
  - Create `.env.example` with all required variables (MONGODB_URI, API_KEYS, PORT)
  - Integrate with senvn for secret management in production
- **Directory structure:**
  ```
  packages/state-tracking-api/
  ├── src/
  │   ├── modules/
  │   │   ├── sessions/
  │   │   ├── tasks/
  │   │   ├── machines/
  │   │   ├── auth/
  │   │   └── health/
  │   ├── common/
  │   │   ├── guards/
  │   │   ├── interceptors/
  │   │   └── filters/
  │   ├── config/
  │   └── main.ts
  ├── test/
  ├── package.json
  └── tsconfig.json
  ```
- **TypeScript configuration:** Strict mode enabled, path aliases configured
- **Failure modes:** Module circular dependencies, missing environment variables, database connection failures

**Acceptance Criteria**
- AC-1.2.a: When project is initialized → package.json contains all required NestJS dependencies with compatible versions
- AC-1.2.b: When modules are created → SessionsModule, TasksModule, MachinesModule, AuthModule, HealthModule are properly imported in AppModule
- AC-1.2.c: When application starts → MongoDB connection is established successfully using MONGODB_URI from environment
- AC-1.2.d: When environment variables are missing → application startup fails with clear error message indicating which variables are required
- AC-1.2.e: When TypeScript compilation runs → zero compilation errors and all path aliases resolve correctly
- AC-1.2.f: When Swagger documentation is generated → API documentation is accessible at /api/docs endpoint

**Acceptance Tests**
- Test-1.2.a: Unit test validates package.json includes @nestjs/common, @nestjs/mongoose, mongoose with version constraints
- Test-1.2.b: Integration test starts application and verifies all modules are loaded in dependency injection container
- Test-1.2.c: Integration test starts application with valid MONGODB_URI and confirms database connection via health check
- Test-1.2.d: Integration test starts application without MONGODB_URI environment variable and receives ConfigurationError
- Test-1.2.e: Unit test compiles TypeScript with strict mode and validates zero errors in output
- Test-1.2.f: Integration test makes HTTP GET request to /api/docs and receives 200 status with OpenAPI JSON schema

---

### 1.3 API Key Authentication Implementation
Implement API key-based authentication for machine-to-machine access control.

**Implementation Details**
- **Systems affected:** HTTP request pipeline, authentication middleware, authorization guards
- **Authentication mechanism:**
  - Client sends API key in `X-API-Key` header
  - AuthGuard validates key against configured list of valid keys
  - Request context enriched with authenticated machine/client identifier
- **API key storage:**
  - Store API keys in environment variables (comma-separated list initially)
  - Format: `API_KEYS=key1,key2,key3`
  - Each key should be UUID v4 format (36 characters)
- **Guard implementation:**
  - Create `ApiKeyAuthGuard` implementing `CanActivate` interface
  - Extract API key from request headers
  - Validate key exists in configured key list
  - Reject requests with 401 Unauthorized if key missing or invalid
  - Attach key identifier to request context for logging
- **Protected routes:** All API endpoints except `/health` require authentication
- **Error handling:**
  - Missing API key → 401 with message "API key required"
  - Invalid API key → 401 with message "Invalid API key"
  - Malformed API key → 401 with message "Malformed API key"
- **Logging:** Log all authentication attempts (success and failure) with timestamp and IP address
- **Rate limiting consideration:** Track requests per API key for future rate limiting implementation
- **Failure modes:** Environment variable misconfiguration, header parsing errors, guard registration issues

**Acceptance Criteria**
- AC-1.3.a: When request includes valid API key in X-API-Key header → request proceeds to controller and receives 200/201 response
- AC-1.3.b: When request omits X-API-Key header → request is rejected with 401 status and "API key required" message
- AC-1.3.c: When request includes invalid API key → request is rejected with 401 status and "Invalid API key" message
- AC-1.3.d: When request targets /health endpoint → request succeeds without API key authentication
- AC-1.3.e: When authentication fails → event is logged with timestamp, IP address, and attempted key (masked)
- AC-1.3.f: When API_KEYS environment variable is empty → application startup fails with configuration error

**Acceptance Tests**
- Test-1.3.a: Integration test sends POST /api/sessions request with valid X-API-Key header and receives 201 response
- Test-1.3.b: Integration test sends POST /api/sessions request without X-API-Key header and receives 401 response
- Test-1.3.c: Integration test sends POST /api/sessions request with X-API-Key=invalid-key-123 and receives 401 response
- Test-1.3.d: Integration test sends GET /health request without X-API-Key header and receives 200 response
- Test-1.3.e: Integration test triggers authentication failure and verifies log entry contains timestamp, IP, and masked key
- Test-1.3.f: Unit test starts application with API_KEYS="" and receives ConfigurationError exception

---

### 1.4 SST Infrastructure Configuration
Configure SST deployment infrastructure for AWS Lambda + API Gateway deployment.

**Implementation Details**
- **Systems affected:** AWS infrastructure (Lambda, API Gateway, CloudWatch), deployment pipeline
- **SST stack configuration:**
  - Create `sst.config.ts` in project root
  - Define API construct mapping to NestJS Lambda handler
  - Configure custom domain: claude-projects.truapi.com
  - Set up environment variable injection from senvn
- **Lambda configuration:**
  - Runtime: Node.js 18.x or later
  - Memory: 512MB (adjustable based on load testing)
  - Timeout: 30 seconds
  - Handler: NestJS application wrapped in serverless-express adapter
- **API Gateway configuration:**
  - HTTP API (v2) for lower latency
  - CORS enabled for VSCode extension access
  - Custom domain with SSL certificate
  - Request/response logging to CloudWatch
- **Environment variables:**
  - MONGODB_URI: MongoDB Atlas connection string
  - API_KEYS: Comma-separated list of valid API keys
  - NODE_ENV: production
  - LOG_LEVEL: info
- **Deployment script:**
  - Add `deploy:prod` script to package.json: `sst deploy --stage prod`
  - Add `deploy:dev` script for development environment
  - Add `remove` script for cleanup: `sst remove --stage prod`
- **Monitoring:**
  - Enable CloudWatch Logs for Lambda function
  - Enable API Gateway access logs
  - Set up log retention (30 days)
- **Failure modes:** SST deployment errors, domain configuration issues, environment variable injection failures, Lambda cold start performance

**Acceptance Criteria**
- AC-1.4.a: When `pnpm deploy:prod` is executed → SST successfully deploys Lambda function and API Gateway to AWS
- AC-1.4.b: When deployment completes → API is accessible at https://claude-projects.truapi.com with valid SSL certificate
- AC-1.4.c: When Lambda function starts → MongoDB connection is established using MONGODB_URI from environment
- AC-1.4.d: When API Gateway receives request → CORS headers are present in response allowing VSCode extension origin
- AC-1.4.e: When Lambda function executes → logs are written to CloudWatch Logs with correct log group and retention policy
- AC-1.4.f: When deployment fails → SST provides clear error message indicating failure point (infrastructure, code, configuration)

**Acceptance Tests**
- Test-1.4.a: Deployment test runs `pnpm deploy:prod` and verifies exit code 0 with successful deployment message
- Test-1.4.b: Integration test makes HTTPS request to https://claude-projects.truapi.com/health and receives 200 response with valid SSL
- Test-1.4.c: Integration test triggers Lambda cold start and verifies MongoDB connection succeeds within timeout period
- Test-1.4.d: Integration test sends OPTIONS request to API endpoint and verifies CORS headers (Access-Control-Allow-Origin) in response
- Test-1.4.e: Integration test makes API request and verifies log entry appears in CloudWatch Logs within 60 seconds
- Test-1.4.f: Deployment test runs `pnpm deploy:prod` with invalid sst.config.ts and receives deployment error with diagnostic message

---

## Phase 2: Core Session State Tracking
**Purpose:** Implement the fundamental session state management APIs that enable the VSCode extension to register sessions, send heartbeats, and query session state. Without these endpoints, no session tracking or crash detection is possible.

### 2.1 Session CRUD Endpoints
Implement RESTful endpoints for creating, reading, updating, and deleting session state.

**Implementation Details**
- **Systems affected:** SessionsModule, Sessions collection, API Gateway routes
- **Endpoints to create:**
  - `POST /api/sessions`: Create new session
  - `GET /api/sessions/:sessionId`: Retrieve session by ID
  - `GET /api/sessions`: List sessions (with filters: project_id, machine_id, status)
  - `PATCH /api/sessions/:sessionId`: Update session state
  - `DELETE /api/sessions/:sessionId`: Delete session (cleanup)
- **POST /api/sessions request body:**
  ```json
  {
    "project_id": "string (required)",
    "machine_id": "string (required)",
    "docker_slot": "number (optional)",
    "metadata": "object (optional)"
  }
  ```
- **POST /api/sessions response:**
  - 201 Created with session object including auto-generated session_id, timestamps
  - 400 Bad Request if required fields missing or validation fails
  - 409 Conflict if active session already exists for project_id + machine_id combination
- **GET /api/sessions query parameters:**
  - `project_id`: Filter by project ID
  - `machine_id`: Filter by machine ID
  - `status`: Filter by status (active, paused, completed, failed, stalled)
  - `limit`: Max results (default 50, max 100)
  - `offset`: Pagination offset
- **PATCH /api/sessions/:sessionId request body:**
  ```json
  {
    "status": "enum (optional)",
    "current_task_id": "string (optional)",
    "metadata": "object (optional)"
  }
  ```
- **Validation:**
  - session_id format validation (UUID v4)
  - project_id not empty
  - machine_id not empty
  - status enum value validation
- **Error handling:**
  - 404 Not Found if session_id doesn't exist
  - 400 Bad Request for validation errors
  - 500 Internal Server Error for database errors
- **Failure modes:** Database connection loss during operation, validation errors, concurrent update conflicts

**Acceptance Criteria**
- AC-2.1.a: When POST /api/sessions receives valid request body → session is created in database with auto-generated session_id and returns 201 response
- AC-2.1.b: When POST /api/sessions receives request missing project_id → returns 400 Bad Request with validation error message
- AC-2.1.c: When GET /api/sessions/:sessionId receives valid session_id → returns 200 response with complete session object
- AC-2.1.d: When GET /api/sessions/:sessionId receives non-existent session_id → returns 404 Not Found
- AC-2.1.e: When GET /api/sessions receives query parameter status=active → returns only sessions with status="active"
- AC-2.1.f: When PATCH /api/sessions/:sessionId updates status to "completed" → session status is updated in database and updated_at timestamp is refreshed
- AC-2.1.g: When DELETE /api/sessions/:sessionId is called → session is removed from database and returns 204 No Content

**Acceptance Tests**
- Test-2.1.a: Integration test POSTs /api/sessions with {project_id, machine_id} and verifies 201 response with session_id in body
- Test-2.1.b: Integration test POSTs /api/sessions with {machine_id} (missing project_id) and verifies 400 response with validation error
- Test-2.1.c: Integration test creates session, then GETs /api/sessions/:sessionId and verifies 200 response with matching data
- Test-2.1.d: Integration test GETs /api/sessions/invalid-uuid-123 and verifies 404 response
- Test-2.1.e: Integration test creates 3 sessions (2 active, 1 completed), GETs /api/sessions?status=active and verifies response contains exactly 2 sessions
- Test-2.1.f: Integration test PATCHes /api/sessions/:sessionId with {status: "completed"}, then GETs session and verifies status updated and updated_at changed
- Test-2.1.g: Integration test creates session, DELETEs /api/sessions/:sessionId, receives 204, then GETs session and receives 404

---

### 2.2 Heartbeat Mechanism
Implement heartbeat endpoint for VSCode extension to signal session is still alive and update last_heartbeat timestamp.

**Implementation Details**
- **Systems affected:** SessionsModule, Sessions collection, heartbeat processing logic
- **Endpoint:** `POST /api/sessions/:sessionId/heartbeat`
- **Request body:** Empty or optional metadata object
  ```json
  {
    "current_task_id": "string (optional)",
    "metadata": "object (optional)"
  }
  ```
- **Business logic:**
  - Find session by session_id
  - Update last_heartbeat to current timestamp
  - If current_task_id provided, update session's current_task_id
  - If status is "stalled", automatically change to "active"
  - Return updated session object
- **Response:**
  - 200 OK with updated session object
  - 404 Not Found if session doesn't exist
  - 400 Bad Request if session_id format invalid
- **Performance requirements:**
  - Heartbeat processing must complete in <500ms (p95)
  - Use MongoDB findOneAndUpdate for atomic operation
  - No additional queries or lookups during heartbeat processing
- **Idempotency:** Multiple heartbeats within same second should not cause issues
- **Failure modes:** Database connection timeout during heartbeat, session not found, concurrent heartbeat updates

**Acceptance Criteria**
- AC-2.2.a: When POST /api/sessions/:sessionId/heartbeat is called → last_heartbeat timestamp is updated to current time within 1 second accuracy
- AC-2.2.b: When heartbeat is sent with current_task_id in body → session's current_task_id field is updated to provided value
- AC-2.2.c: When heartbeat is sent for session with status="stalled" → status is automatically changed to "active"
- AC-2.2.d: When heartbeat processing completes → response time is <500ms at p95 (verified via load testing)
- AC-2.2.e: When heartbeat is sent for non-existent session_id → returns 404 Not Found
- AC-2.2.f: When two heartbeats are sent within same second → both succeed without conflict errors

**Acceptance Tests**
- Test-2.2.a: Integration test creates session, POSTs heartbeat, GETs session and verifies last_heartbeat is within 1 second of current time
- Test-2.2.b: Integration test POSTs heartbeat with {current_task_id: "task-123"}, GETs session and verifies current_task_id = "task-123"
- Test-2.2.c: Integration test updates session status to "stalled", POSTs heartbeat, GETs session and verifies status = "active"
- Test-2.2.d: Load test sends 100 concurrent heartbeat requests and verifies p95 response time <500ms
- Test-2.2.e: Integration test POSTs heartbeat to /api/sessions/invalid-uuid/heartbeat and receives 404 response
- Test-2.2.f: Integration test sends 2 heartbeat POSTs within same second and verifies both return 200 with no errors

---

### 2.3 Machine/Docker Slot Tracking
Implement machine registration and docker slot availability tracking to coordinate session assignments.

**Implementation Details**
- **Systems affected:** MachinesModule, Machines collection, session assignment logic
- **Endpoints to create:**
  - `POST /api/machines`: Register machine
  - `GET /api/machines/:machineId`: Get machine details
  - `GET /api/machines`: List machines (filter by status)
  - `PATCH /api/machines/:machineId`: Update machine status
  - `POST /api/machines/:machineId/heartbeat`: Machine-level heartbeat
- **POST /api/machines request body:**
  ```json
  {
    "hostname": "string (required)",
    "docker_slots": "[number] (required, array of slot numbers)",
    "metadata": "object (optional, specs, OS info)"
  }
  ```
- **Business logic:**
  - Auto-generate machine_id if not provided
  - Initialize status to "online"
  - Initialize active_sessions to empty array
  - Set last_heartbeat to current timestamp
- **PATCH /api/machines/:machineId request body:**
  ```json
  {
    "status": "enum (optional: online, offline, maintenance)",
    "docker_slots": "[number] (optional)",
    "metadata": "object (optional)"
  }
  ```
- **Machine heartbeat logic:**
  - Update last_heartbeat timestamp
  - If status is "offline", change to "online"
  - Sync active_sessions list with current sessions in database
- **Session assignment integration:**
  - When session created, add session_id to machine's active_sessions array
  - When session deleted, remove session_id from machine's active_sessions array
  - When session marked completed/failed, remove from active_sessions
- **Failure modes:** Machine registration conflicts, docker slot conflicts, stale active_sessions data

**Acceptance Criteria**
- AC-2.3.a: When POST /api/machines receives valid request → machine is registered with auto-generated machine_id and status="online"
- AC-2.3.b: When machine is registered with docker_slots=[1,2,3] → docker_slots array is stored and retrievable via GET
- AC-2.3.c: When session is created → session_id is added to corresponding machine's active_sessions array
- AC-2.3.d: When session is deleted → session_id is removed from machine's active_sessions array
- AC-2.3.e: When POST /api/machines/:machineId/heartbeat is called → last_heartbeat is updated and status changes from "offline" to "online" if applicable
- AC-2.3.f: When GET /api/machines?status=online is called → returns only machines with status="online"

**Acceptance Tests**
- Test-2.3.a: Integration test POSTs /api/machines with {hostname, docker_slots}, receives 201 with machine_id, and verifies status="online"
- Test-2.3.b: Integration test creates machine with docker_slots=[1,2,3], GETs machine and verifies docker_slots field contains [1,2,3]
- Test-2.3.c: Integration test creates machine, creates session with that machine_id, GETs machine and verifies active_sessions contains session_id
- Test-2.3.d: Integration test creates session, DELETEs session, GETs machine and verifies session_id removed from active_sessions
- Test-2.3.e: Integration test PATCHes machine status to "offline", POSTs heartbeat, GETs machine and verifies status="online"
- Test-2.3.f: Integration test creates 2 machines (1 online, 1 offline), GETs /api/machines?status=online and verifies response contains only online machine

---

### 2.4 Session Health Query Endpoints
Implement endpoints for querying session health status and detecting stalled sessions.

**Implementation Details**
- **Systems affected:** SessionsModule, health check logic, stall detection algorithms
- **Endpoints to create:**
  - `GET /api/sessions/health`: Get health summary across all sessions
  - `GET /api/sessions/stalled`: Get list of stalled sessions
  - `GET /api/sessions/:sessionId/health`: Get individual session health status
- **GET /api/sessions/health response:**
  ```json
  {
    "total_sessions": "number",
    "active_sessions": "number",
    "stalled_sessions": "number",
    "failed_sessions": "number",
    "completed_sessions": "number",
    "last_updated": "timestamp"
  }
  ```
- **Stalled session detection logic:**
  - Session is considered "stalled" if:
    - status = "active" AND
    - last_heartbeat is older than threshold (configurable, default 3 minutes)
  - Threshold calculation: current_time - last_heartbeat > STALL_THRESHOLD_MS
- **GET /api/sessions/stalled response:**
  ```json
  {
    "stalled_sessions": [
      {
        "session_id": "string",
        "project_id": "string",
        "machine_id": "string",
        "last_heartbeat": "timestamp",
        "time_since_heartbeat_ms": "number"
      }
    ],
    "stall_threshold_ms": "number"
  }
  ```
- **GET /api/sessions/:sessionId/health response:**
  ```json
  {
    "session_id": "string",
    "is_healthy": "boolean",
    "status": "enum",
    "last_heartbeat": "timestamp",
    "time_since_heartbeat_ms": "number",
    "is_stalled": "boolean",
    "stall_threshold_ms": "number"
  }
  ```
- **Configuration:** STALL_THRESHOLD_MS environment variable (default 180000 = 3 minutes)
- **Performance:** Health queries must use indexed fields (status, last_heartbeat) for efficient querying
- **Failure modes:** Incorrect time calculations, timezone issues, stale index data

**Acceptance Criteria**
- AC-2.4.a: When GET /api/sessions/health is called → response includes accurate counts for total, active, stalled, failed, and completed sessions
- AC-2.4.b: When session has last_heartbeat older than 3 minutes and status="active" → GET /api/sessions/stalled includes this session in results
- AC-2.4.c: When session has last_heartbeat within 3 minutes → GET /api/sessions/stalled does not include this session
- AC-2.4.d: When GET /api/sessions/:sessionId/health is called → is_healthy=true if last_heartbeat within threshold and status="active"
- AC-2.4.e: When STALL_THRESHOLD_MS environment variable is set to 60000 → stall detection uses 1 minute threshold instead of default 3 minutes
- AC-2.4.f: When health query executes → response time is <1000ms at p95 (verified via query explain plan using indexes)

**Acceptance Tests**
- Test-2.4.a: Integration test creates 5 sessions (2 active, 1 stalled, 1 failed, 1 completed), GETs /api/sessions/health and verifies counts match
- Test-2.4.b: Integration test creates session, sets last_heartbeat to 5 minutes ago, GETs /api/sessions/stalled and verifies session appears in results
- Test-2.4.c: Integration test creates session, sends heartbeat, GETs /api/sessions/stalled and verifies session not in results
- Test-2.4.d: Integration test creates session with recent heartbeat, GETs /api/sessions/:sessionId/health and verifies is_healthy=true
- Test-2.4.e: Integration test sets STALL_THRESHOLD_MS=60000, creates session with 90 second old heartbeat, GETs /api/sessions/stalled and verifies session detected as stalled
- Test-2.4.f: Load test runs 100 concurrent GET /api/sessions/health requests and verifies p95 response time <1000ms

---

## Phase 3: Task Monitoring & Recovery Support
**Purpose:** Extend session tracking to include task-level monitoring and provide APIs for managing session failures and recovery workflows. This enables granular progress tracking and informed recovery decisions.

### 3.1 Task State Tracking
Implement task-level progress tracking within sessions for fine-grained monitoring.

**Implementation Details**
- **Systems affected:** TasksModule, Tasks collection, session-task relationships
- **Endpoints to create:**
  - `POST /api/tasks`: Create new task
  - `GET /api/tasks/:taskId`: Get task details
  - `GET /api/tasks`: List tasks (filter by session_id, project_id, status)
  - `PATCH /api/tasks/:taskId`: Update task status
  - `DELETE /api/tasks/:taskId`: Delete task
- **POST /api/tasks request body:**
  ```json
  {
    "session_id": "string (required)",
    "project_id": "string (required)",
    "github_issue_id": "string (optional)",
    "task_name": "string (required)",
    "metadata": "object (optional)"
  }
  ```
- **Business logic:**
  - Auto-generate task_id (UUID v4)
  - Initialize status to "pending"
  - Set created_at and updated_at timestamps
  - Validate session_id exists in sessions collection
- **PATCH /api/tasks/:taskId request body:**
  ```json
  {
    "status": "enum (optional: pending, in_progress, completed, failed, blocked)",
    "error_message": "string (optional, required if status=failed)",
    "metadata": "object (optional)"
  }
  ```
- **Status transition logic:**
  - pending → in_progress: Set started_at timestamp
  - in_progress → completed: Set completed_at timestamp
  - in_progress → failed: Set completed_at timestamp and require error_message
  - Any status → blocked: Allow with optional metadata explaining blockage
- **GET /api/tasks query parameters:**
  - `session_id`: Filter by session
  - `project_id`: Filter by project
  - `status`: Filter by status
  - `limit`: Max results (default 50, max 200)
  - `offset`: Pagination offset
- **Integration with sessions:**
  - When task status changes to "in_progress", update session's current_task_id
  - When task status changes to "completed" or "failed", clear session's current_task_id if it matches
- **Failure modes:** Session reference invalid, status transition validation errors, concurrent task updates

**Acceptance Criteria**
- AC-3.1.a: When POST /api/tasks receives valid request → task is created with auto-generated task_id, status="pending", and timestamps
- AC-3.1.b: When POST /api/tasks references non-existent session_id → returns 400 Bad Request with error message
- AC-3.1.c: When PATCH /api/tasks/:taskId changes status from "pending" to "in_progress" → started_at timestamp is set to current time
- AC-3.1.d: When PATCH /api/tasks/:taskId changes status to "completed" → completed_at timestamp is set and task is queryable via GET
- AC-3.1.e: When task status changes to "in_progress" → parent session's current_task_id is updated to this task_id
- AC-3.1.f: When GET /api/tasks?session_id=X is called → returns only tasks belonging to session X
- AC-3.1.g: When PATCH /api/tasks/:taskId sets status="failed" without error_message → returns 400 Bad Request requiring error_message

**Acceptance Tests**
- Test-3.1.a: Integration test POSTs /api/tasks with valid body, receives 201 with task_id, and verifies status="pending"
- Test-3.1.b: Integration test POSTs /api/tasks with session_id="invalid-uuid" and receives 400 with validation error
- Test-3.1.c: Integration test creates task, PATCHes status to "in_progress", GETs task and verifies started_at is set
- Test-3.1.d: Integration test PATCHes task status to "completed", GETs task and verifies completed_at timestamp exists
- Test-3.1.e: Integration test PATCHes task to "in_progress", GETs parent session and verifies current_task_id matches task_id
- Test-3.1.f: Integration test creates 3 tasks (2 for session A, 1 for session B), GETs /api/tasks?session_id=A and verifies 2 tasks returned
- Test-3.1.g: Integration test PATCHes task with {status: "failed"} (no error_message) and receives 400 validation error

---

### 3.2 Session Failure Detection & Marking
Implement automated and manual session failure detection and status marking.

**Implementation Details**
- **Systems affected:** SessionsModule, background job scheduler, failure detection logic
- **Endpoints to create:**
  - `POST /api/sessions/:sessionId/mark-failed`: Manually mark session as failed
  - `POST /api/sessions/:sessionId/mark-stalled`: Manually mark session as stalled
  - `POST /api/sessions/detect-failures`: Trigger failure detection scan (admin endpoint)
- **Background job:** Scheduled task runs every 2 minutes to detect stalled sessions
  - Query sessions where status="active" AND last_heartbeat older than STALL_THRESHOLD_MS
  - Update matched sessions to status="stalled"
  - Log each status change with session_id, project_id, machine_id
- **POST /api/sessions/:sessionId/mark-failed request body:**
  ```json
  {
    "error_message": "string (required)",
    "metadata": "object (optional, error context)"
  }
  ```
- **Business logic for mark-failed:**
  - Update session status to "failed"
  - Set completed_at to current timestamp
  - Store error_message in metadata
  - Update all "in_progress" tasks for this session to "failed"
  - Remove session from machine's active_sessions array
- **POST /api/sessions/:sessionId/mark-stalled:**
  - Update session status to "stalled"
  - Do NOT set completed_at (session may recover)
  - Log stall event with timestamp
- **Scheduler implementation:**
  - Use NestJS `@nestjs/schedule` package
  - Create `@Cron` decorated method in SessionsService
  - Run every 2 minutes: `@Cron('*/2 * * * *')`
  - Use distributed lock if multiple API instances deployed (future consideration)
- **Failure modes:** Scheduler stops running, concurrent status updates, background job crashes

**Acceptance Criteria**
- AC-3.2.a: When POST /api/sessions/:sessionId/mark-failed is called → session status changes to "failed" and completed_at is set
- AC-3.2.b: When session is marked failed → all tasks with status="in_progress" are updated to status="failed"
- AC-3.2.c: When background job detects session with last_heartbeat >3 minutes ago → session status automatically changes to "stalled"
- AC-3.2.d: When POST /api/sessions/:sessionId/mark-stalled is called → status changes to "stalled" but completed_at remains null
- AC-3.2.e: When background job runs → failure detection completes within 30 seconds even with 100+ active sessions
- AC-3.2.f: When session is marked failed → session_id is removed from parent machine's active_sessions array

**Acceptance Tests**
- Test-3.2.a: Integration test POSTs /api/sessions/:sessionId/mark-failed with error_message, GETs session and verifies status="failed" and completed_at set
- Test-3.2.b: Integration test creates session with 2 in_progress tasks, marks session failed, GETs tasks and verifies both have status="failed"
- Test-3.2.c: Integration test creates session, sets last_heartbeat to 5 minutes ago, waits for background job cycle, GETs session and verifies status="stalled"
- Test-3.2.d: Integration test POSTs /api/sessions/:sessionId/mark-stalled, GETs session and verifies status="stalled" and completed_at is null
- Test-3.2.e: Load test creates 100 sessions with old heartbeats, triggers background job, and verifies completion within 30 seconds
- Test-3.2.f: Integration test creates machine with session, marks session failed, GETs machine and verifies session_id removed from active_sessions

---

### 3.3 Recovery State Management
Implement APIs for managing session recovery workflows and state snapshots.

**Implementation Details**
- **Systems affected:** SessionsModule, recovery state storage, session lifecycle management
- **Endpoints to create:**
  - `GET /api/sessions/:sessionId/recovery-state`: Get last known state for recovery
  - `POST /api/sessions/:sessionId/prepare-recovery`: Prepare session for restart
  - `POST /api/sessions/:sessionId/recover`: Create new recovery session from failed session
- **GET /api/sessions/:sessionId/recovery-state response:**
  ```json
  {
    "session_id": "string",
    "project_id": "string",
    "last_successful_task": "object (task details)",
    "failed_tasks": "[object] (array of failed tasks)",
    "pending_tasks": "[object] (array of pending tasks)",
    "last_heartbeat": "timestamp",
    "metadata": "object"
  }
  ```
- **Business logic for recovery-state:**
  - Query session by session_id
  - Query all tasks for session, categorized by status
  - Find most recent completed task (highest completed_at timestamp)
  - Return structured recovery context
- **POST /api/sessions/:sessionId/prepare-recovery:**
  - Validate session status is "failed" or "stalled"
  - Update metadata with recovery preparation timestamp
  - Optionally clear machine assignment
  - Return prepared state
- **POST /api/sessions/:sessionId/recover request body:**
  ```json
  {
    "new_machine_id": "string (required)",
    "docker_slot": "number (optional)",
    "reset_failed_tasks": "boolean (default true)"
  }
  ```
- **Business logic for recover:**
  - Create new session with new session_id
  - Copy project_id, metadata from original session
  - Set machine_id to new_machine_id
  - Mark original session as "completed" with metadata indicating recovery
  - If reset_failed_tasks=true, create new pending tasks for previously failed tasks
  - Return new session object
- **Idempotency:** Recovery operations should be idempotent (calling twice doesn't create duplicate sessions)
- **Failure modes:** Original session in invalid state for recovery, machine_id not available, task copying errors

**Acceptance Criteria**
- AC-3.3.a: When GET /api/sessions/:sessionId/recovery-state is called → response includes last_successful_task and categorized task lists
- AC-3.3.b: When POST /api/sessions/:sessionId/prepare-recovery is called for "failed" session → metadata is updated with preparation timestamp
- AC-3.3.c: When POST /api/sessions/:sessionId/recover is called → new session is created with new session_id and status="active"
- AC-3.3.d: When recovery creates new session → original session status is updated to "completed" with recovery metadata
- AC-3.3.e: When recover is called with reset_failed_tasks=true → new pending tasks are created for each failed task from original session
- AC-3.3.f: When POST /api/sessions/:sessionId/prepare-recovery is called for "active" session → returns 400 Bad Request indicating invalid state

**Acceptance Tests**
- Test-3.3.a: Integration test creates session with mixed task statuses, GETs /api/sessions/:sessionId/recovery-state and verifies correct task categorization
- Test-3.3.b: Integration test marks session failed, POSTs /api/sessions/:sessionId/prepare-recovery, GETs session and verifies preparation timestamp in metadata
- Test-3.3.c: Integration test POSTs /api/sessions/:sessionId/recover with new_machine_id, receives 201 with new session_id distinct from original
- Test-3.3.d: Integration test creates recovery session, GETs original session and verifies status="completed" and recovery metadata present
- Test-3.3.e: Integration test creates session with 2 failed tasks, POSTs recover with reset_failed_tasks=true, GETs new session's tasks and verifies 2 pending tasks created
- Test-3.3.f: Integration test POSTs /api/sessions/:sessionId/prepare-recovery for active session and receives 400 validation error

---

### 3.4 Session Cleanup & Archival
Implement cleanup mechanisms for completed sessions and automatic archival policies.

**Implementation Details**
- **Systems affected:** SessionsModule, TasksModule, background cleanup jobs, archival storage
- **Endpoints to create:**
  - `POST /api/sessions/:sessionId/archive`: Manually archive session
  - `DELETE /api/sessions/cleanup`: Cleanup old sessions (admin endpoint)
  - `GET /api/sessions/archived`: List archived sessions
- **Automatic cleanup background job:**
  - Run daily at 2 AM: `@Cron('0 2 * * *')`
  - Query sessions where status IN ("completed", "failed") AND completed_at < (NOW - 30 days)
  - For each matched session:
    - Query and delete associated tasks
    - Delete session document
    - Log deletion with session_id, project_id, completed_at
- **POST /api/sessions/:sessionId/archive:**
  - Validate session status is "completed" or "failed"
  - Add archive flag to metadata: `{archived: true, archived_at: timestamp}`
  - Do NOT delete session (archiving vs deletion distinction)
  - Return archived session object
- **Data retention policy (configurable):**
  - RETENTION_DAYS environment variable (default 30)
  - Completed/failed sessions older than RETENTION_DAYS are deleted
  - Archived sessions exempt from automatic deletion
- **Cascade deletion:**
  - When session deleted, all associated tasks must be deleted
  - Remove session from machine's active_sessions array
  - Use MongoDB transactions to ensure atomicity
- **Manual cleanup endpoint:**
  - POST /api/sessions/cleanup with optional query parameter: `older_than_days`
  - Triggers immediate cleanup job execution
  - Returns count of sessions and tasks deleted
- **Failure modes:** Transaction rollback during cascade delete, partial deletion, background job skipped

**Acceptance Criteria**
- AC-3.4.a: When background cleanup job runs → sessions with completed_at >30 days ago are deleted from database
- AC-3.4.b: When session is deleted → all associated tasks are also deleted in same transaction
- AC-3.4.c: When POST /api/sessions/:sessionId/archive is called → session metadata is updated with archived=true flag
- AC-3.4.d: When session has archived=true in metadata → automatic cleanup job does NOT delete this session
- AC-3.4.e: When POST /api/sessions/cleanup is called → response includes count of deleted sessions and tasks
- AC-3.4.f: When session deletion transaction fails → no partial deletion occurs (session and tasks both remain)

**Acceptance Tests**
- Test-3.4.a: Integration test creates completed session with completed_at=35 days ago, triggers cleanup job, verifies session deleted from database
- Test-3.4.b: Integration test creates session with 3 tasks, deletes session, queries tasks and verifies all deleted
- Test-3.4.c: Integration test POSTs /api/sessions/:sessionId/archive, GETs session and verifies metadata.archived=true
- Test-3.4.d: Integration test creates archived session with old completed_at, runs cleanup job, verifies session NOT deleted
- Test-3.4.e: Integration test creates 5 old sessions, POSTs /api/sessions/cleanup, verifies response contains deleted_sessions=5
- Test-3.4.f: Integration test simulates transaction failure during cascade delete and verifies session and tasks both remain in database

---

## Phase 4: Deployment & Production Readiness
**Purpose:** Deploy the API to production infrastructure, configure domain and SSL, integrate with VSCode extension, and validate end-to-end functionality in production environment.

### 4.1 SST Production Deployment Pipeline
Configure and execute production deployment with proper environment configuration and monitoring.

**Implementation Details**
- **Systems affected:** AWS infrastructure, SST deployment, production environment, CI/CD pipeline
- **Deployment steps:**
  1. Configure production environment variables via senvn
  2. Set up MongoDB Atlas production cluster and database
  3. Configure API keys for production use
  4. Deploy SST stack to production AWS account
  5. Verify Lambda function deployment
  6. Verify API Gateway configuration
- **Environment variables (production):**
  - MONGODB_URI: Production MongoDB Atlas connection string with authentication
  - API_KEYS: Production API keys (rotate from development keys)
  - NODE_ENV=production
  - LOG_LEVEL=info
  - STALL_THRESHOLD_MS=180000
  - RETENTION_DAYS=30
  - AWS_REGION: Target deployment region
- **MongoDB Atlas setup:**
  - Create production cluster (M10 or higher for production workloads)
  - Create "claude-projects" database
  - Configure IP whitelist for Lambda function access
  - Set up database user with read/write permissions
  - Enable backup and point-in-time recovery
- **Deployment command:** `pnpm deploy:prod --stage prod`
- **SST outputs to capture:**
  - API Gateway endpoint URL
  - Lambda function ARN
  - CloudWatch log group name
  - Deployment region
- **Rollback plan:**
  - Keep previous SST deployment state
  - Document rollback command: `sst deploy --stage prod --rollback`
  - Maintain backup of environment variables
- **Failure modes:** SST deployment errors, MongoDB connection failures, API key misconfiguration, Lambda function cold start timeout

**Acceptance Criteria**
- AC-4.1.a: When `pnpm deploy:prod` is executed → SST successfully deploys to production AWS account without errors
- AC-4.1.b: When deployment completes → Lambda function is accessible and responds to health check requests
- AC-4.1.c: When Lambda function starts → MongoDB connection is established to production cluster using MONGODB_URI
- AC-4.1.d: When environment variables are missing → SST deployment fails with clear error indicating missing variables
- AC-4.1.e: When deployment succeeds → CloudWatch Logs contain Lambda startup logs with production environment confirmation
- AC-4.1.f: When rollback is triggered → previous deployment state is restored successfully

**Acceptance Tests**
- Test-4.1.a: Deployment test executes `pnpm deploy:prod` in production environment and verifies exit code 0
- Test-4.1.b: Integration test makes GET request to deployed API endpoint /health and receives 200 response
- Test-4.1.c: Integration test triggers Lambda cold start and verifies MongoDB connection log entry in CloudWatch within 10 seconds
- Test-4.1.d: Deployment test removes MONGODB_URI from environment, runs deploy and verifies deployment failure with configuration error
- Test-4.1.e: Integration test searches CloudWatch Logs for "NODE_ENV=production" log entry and verifies presence
- Test-4.1.f: Deployment test executes rollback command and verifies previous deployment state restored

---

### 4.2 Custom Domain Configuration
Configure custom domain claude-projects.truapi.com with SSL certificate and DNS routing.

**Implementation Details**
- **Systems affected:** Route53 DNS, ACM SSL certificates, API Gateway custom domain mapping
- **Domain setup steps:**
  1. Request SSL certificate via AWS ACM for claude-projects.truapi.com
  2. Validate certificate via DNS (Route53 hosted zone)
  3. Configure API Gateway custom domain mapping
  4. Create Route53 A record pointing to API Gateway
  5. Test HTTPS access to custom domain
- **SST custom domain configuration:**
  ```typescript
  new Api(stack, "Api", {
    customDomain: {
      domainName: "claude-projects.truapi.com",
      hostedZone: "truapi.com"
    }
  })
  ```
- **SSL/TLS requirements:**
  - Minimum TLS 1.2
  - Strong cipher suites only
  - Certificate auto-renewal enabled
  - HSTS header configured
- **DNS configuration:**
  - Create A record: claude-projects.truapi.com → API Gateway alias
  - TTL: 300 seconds
  - Routing policy: Simple
- **Health check verification:**
  - GET https://claude-projects.truapi.com/health returns 200
  - SSL certificate valid and matches domain
  - No certificate warnings in browser/curl
- **Failure modes:** Certificate validation timeout, DNS propagation delay, domain mapping misconfiguration, SSL certificate expiration

**Acceptance Criteria**
- AC-4.2.a: When SSL certificate is requested → certificate is issued and validated via DNS within 30 minutes
- AC-4.2.b: When custom domain is configured → API is accessible at https://claude-projects.truapi.com with valid SSL
- AC-4.2.c: When HTTPS request is made → SSL certificate is valid, not expired, and matches domain name
- AC-4.2.d: When HTTP request is made to custom domain → request is redirected to HTTPS (301 or 307)
- AC-4.2.e: When DNS lookup is performed → claude-projects.truapi.com resolves to API Gateway IP address
- AC-4.2.f: When SSL labs test is run → domain receives A or A+ rating for SSL configuration

**Acceptance Tests**
- Test-4.2.a: Deployment test requests SSL certificate and polls ACM until status=ISSUED (timeout 30 minutes)
- Test-4.2.b: Integration test makes HTTPS request to https://claude-projects.truapi.com/health and receives 200 response
- Test-4.2.c: Integration test validates SSL certificate via OpenSSL and verifies CN=claude-projects.truapi.com and expiry >30 days
- Test-4.2.d: Integration test makes HTTP request to http://claude-projects.truapi.com and verifies redirect to HTTPS
- Test-4.2.e: Integration test performs DNS lookup via `dig claude-projects.truapi.com` and verifies A record resolution
- Test-4.2.f: Manual test runs SSL Labs scan and verifies grade A or A+ (documented in deployment checklist)

---

### 4.3 VSCode Extension Integration
Integrate state tracking API with VSCode extension for session management and heartbeat sending.

**Implementation Details**
- **Systems affected:** VSCode extension codebase, API client configuration, session lifecycle management
- **Integration points:**
  1. API client initialization with base URL and API key
  2. Session creation on orchestration start
  3. Heartbeat sending at regular intervals
  4. Session status updates on task transitions
  5. Failure detection and recovery workflows
- **VSCode extension changes required:**
  - Add API_KEY to extension configuration (user setting or environment variable)
  - Add API_BASE_URL configuration (default: https://claude-projects.truapi.com)
  - Create API client service for HTTP requests
  - Implement heartbeat timer (60 second interval)
  - Add error handling for API failures
- **Session lifecycle integration:**
  - On orchestration start: POST /api/sessions with project_id and machine_id
  - Every 60 seconds: POST /api/sessions/:sessionId/heartbeat
  - On task start: POST /api/tasks with task details
  - On task complete: PATCH /api/tasks/:taskId with status="completed"
  - On orchestration complete: PATCH /api/sessions/:sessionId with status="completed"
  - On orchestration error: POST /api/sessions/:sessionId/mark-failed
- **Machine identification:**
  - Use os.hostname() as primary machine_id
  - Fallback to MAC address or UUID if hostname unavailable
  - Store machine_id in extension workspace state for consistency
- **Error handling:**
  - If API unreachable: Log error, continue orchestration (graceful degradation)
  - If authentication fails: Show error notification to user
  - If session creation fails: Retry up to 3 times with exponential backoff
- **Heartbeat implementation:**
  - Use setInterval to send heartbeat every 60 seconds
  - Clear interval on orchestration completion
  - Include current_task_id in heartbeat payload
- **Failure modes:** API unreachable, network timeouts, authentication failures, stale session state

**Acceptance Criteria**
- AC-4.3.a: When orchestration starts in VSCode extension → POST /api/sessions is called and session_id is stored in extension state
- AC-4.3.b: When orchestration is running → heartbeat is sent every 60 seconds ±5 seconds
- AC-4.3.c: When task begins execution → POST /api/tasks is called with session_id and task details
- AC-4.3.d: When orchestration completes successfully → PATCH /api/sessions/:sessionId updates status to "completed"
- AC-4.3.e: When API authentication fails → user receives error notification with actionable message
- AC-4.3.f: When API is unreachable → orchestration continues without crashing and logs error message

**Acceptance Tests**
- Test-4.3.a: E2E test starts orchestration in VSCode extension, monitors network requests, and verifies POST /api/sessions called
- Test-4.3.b: E2E test runs orchestration for 3 minutes, monitors network requests, and verifies 3 heartbeat POSTs sent
- Test-4.3.c: E2E test starts task execution, monitors network requests, and verifies POST /api/tasks called with correct session_id
- Test-4.3.d: E2E test completes orchestration, queries API for session, and verifies status="completed"
- Test-4.3.e: E2E test configures invalid API key, starts orchestration, and verifies error notification displayed to user
- Test-4.3.f: E2E test starts orchestration with API offline, verifies orchestration continues and error logged to extension output

---

### 4.4 End-to-End Production Validation
Execute comprehensive end-to-end tests in production environment to validate all functionality.

**Implementation Details**
- **Systems affected:** Production API, VSCode extension, MongoDB production database, monitoring systems
- **Test scenarios to execute:**
  1. Full orchestration lifecycle: start, heartbeat, task execution, completion
  2. Session failure detection: stop heartbeat, verify stall detection
  3. Recovery workflow: mark session failed, retrieve recovery state, create recovery session
  4. Machine tracking: register machine, assign sessions, verify active_sessions
  5. Cleanup: trigger cleanup job, verify old sessions deleted
  6. API authentication: test valid and invalid API keys
  7. Health endpoints: verify session health queries
- **E2E test execution plan:**
  - Use production API endpoint: https://claude-projects.truapi.com
  - Use production API key (test key, not primary key)
  - Create isolated test project_id to avoid conflicts
  - Clean up test data after validation
- **Performance validation:**
  - Heartbeat latency: <500ms p95
  - Session creation: <1000ms p95
  - Health query: <1000ms p95
  - API uptime: Monitor for 24 hours, target 99.5%+
- **Monitoring validation:**
  - CloudWatch Logs receiving entries
  - Lambda execution metrics visible
  - Error logs categorized correctly
  - Database connection pool healthy
- **Load testing (basic):**
  - 10 concurrent sessions with heartbeats
  - Verify no errors under sustained load
  - Monitor Lambda concurrency and throttling
- **Failure modes:** Production data corruption, performance degradation, authentication bypass, monitoring gaps

**Acceptance Criteria**
- AC-4.4.a: When E2E test creates session → session is created and retrievable via GET /api/sessions/:sessionId
- AC-4.4.b: When E2E test sends heartbeats for 5 minutes → all heartbeats succeed and last_heartbeat updates correctly
- AC-4.4.c: When E2E test stops heartbeats for 4 minutes → session is automatically marked as "stalled" by background job
- AC-4.4.d: When E2E test creates recovery session → new session_id is generated and original session marked completed
- AC-4.4.e: When load test runs 10 concurrent sessions → all sessions complete without errors and p95 latency <1000ms
- AC-4.4.f: When E2E tests complete → all test sessions and tasks are cleaned up from production database

**Acceptance Tests**
- Test-4.4.a: E2E test script POSTs /api/sessions, receives session_id, GETs session and verifies data matches
- Test-4.4.b: E2E test script sends heartbeat every 60 seconds for 5 minutes, queries session and verifies last_heartbeat within 60 seconds of current time
- Test-4.4.c: E2E test script creates session, sends 2 heartbeats, stops, waits 5 minutes, GETs session and verifies status="stalled"
- Test-4.4.d: E2E test script marks session failed, POSTs /api/sessions/:sessionId/recover, receives new session_id distinct from original
- Test-4.4.e: Load test script creates 10 sessions with concurrent heartbeats running for 2 minutes, verifies all requests succeed with p95 <1000ms
- Test-4.4.f: E2E test cleanup script queries all sessions with test project_id, DELETEs all sessions, verifies count=0 after cleanup

---

## Phase 5: Monitoring, Logging & Production Polish
**Purpose:** Establish production monitoring, structured logging, error handling, and operational documentation to ensure reliable long-term operation and debuggability.

### 5.1 Structured Logging & Observability
Implement structured logging with proper log levels, request tracing, and searchable context.

**Implementation Details**
- **Systems affected:** All modules, logging infrastructure, CloudWatch Logs, log analysis tools
- **Logging library:** Use NestJS built-in Logger or Winston for structured logging
- **Log levels:** ERROR, WARN, INFO, DEBUG
  - ERROR: Unhandled exceptions, database failures, critical issues
  - WARN: Stalled session detection, failed heartbeats, validation errors
  - INFO: Session lifecycle events, API requests (sampled), background job execution
  - DEBUG: Detailed request/response payloads (development only)
- **Structured log format (JSON):**
  ```json
  {
    "timestamp": "ISO 8601",
    "level": "INFO",
    "message": "Session created",
    "context": {
      "session_id": "uuid",
      "project_id": "string",
      "machine_id": "string",
      "endpoint": "/api/sessions",
      "request_id": "uuid"
    }
  }
  ```
- **Request tracing:**
  - Generate request_id for each API request (UUID v4)
  - Include request_id in all logs for that request
  - Return request_id in response header: X-Request-Id
  - Use NestJS interceptor for automatic request_id injection
- **Key events to log:**
  - Session created: session_id, project_id, machine_id
  - Heartbeat received: session_id, last_heartbeat timestamp
  - Session marked failed: session_id, error_message
  - Stalled session detected: session_id, time_since_heartbeat
  - Recovery session created: original_session_id, new_session_id
  - Background job execution: job_name, sessions_affected, duration_ms
- **CloudWatch Logs configuration:**
  - Log group: /aws/lambda/state-tracking-api-prod
  - Retention: 30 days
  - Create metric filters for ERROR logs
  - Create alarms for error rate thresholds
- **Performance:** Logging should add <10ms to request latency
- **Failure modes:** Log overflow, CloudWatch throttling, sensitive data in logs

**Acceptance Criteria**
- AC-5.1.a: When API request is received → request_id is generated and included in all log entries for that request
- AC-5.1.b: When session is created → log entry contains session_id, project_id, machine_id in structured format
- AC-5.1.c: When ERROR level event occurs → log entry is written to CloudWatch within 60 seconds
- AC-5.1.d: When searching CloudWatch Logs for session_id → all log entries for that session are retrievable
- AC-5.1.e: When response is returned → X-Request-Id header contains request_id from logs
- AC-5.1.f: When logging executes → p95 latency increase is <10ms compared to no logging

**Acceptance Tests**
- Test-5.1.a: Integration test makes API request, extracts request_id from response header, searches CloudWatch Logs and verifies matching log entries
- Test-5.1.b: Integration test creates session, searches CloudWatch Logs for session_id and verifies log entry contains project_id and machine_id fields
- Test-5.1.c: Integration test triggers error condition, waits 60 seconds, searches CloudWatch Logs and verifies ERROR log entry present
- Test-5.1.d: Integration test creates session, sends heartbeat, searches CloudWatch Logs by session_id and verifies 2+ log entries returned
- Test-5.1.e: Integration test makes API request, extracts X-Request-Id from response header, and verifies format is valid UUID v4
- Test-5.1.f: Performance test runs 100 requests with and without logging, compares p95 latency and verifies difference <10ms

---

### 5.2 Error Handling & Rate Limiting
Implement comprehensive error handling, validation, and rate limiting for API stability.

**Implementation Details**
- **Systems affected:** All API endpoints, exception filters, validation pipes, rate limiting middleware
- **Global exception filter:**
  - Catch all unhandled exceptions
  - Return consistent error response format
  - Log error with stack trace
  - Mask sensitive information in error messages
- **Error response format:**
  ```json
  {
    "statusCode": "number",
    "error": "string (error type)",
    "message": "string (user-friendly message)",
    "timestamp": "ISO 8601",
    "path": "string (request path)",
    "request_id": "string"
  }
  ```
- **Validation errors:**
  - Use class-validator for DTO validation
  - Return 400 Bad Request with field-level errors
  - Include which fields failed validation
- **Rate limiting:**
  - Implement per-API-key rate limiting
  - Limit: 100 requests/minute per API key (configurable via RATE_LIMIT_PER_MINUTE)
  - Return 429 Too Many Requests with Retry-After header
  - Use in-memory rate limit tracking (Redis for multi-instance deployment)
- **Rate limit headers:**
  - X-RateLimit-Limit: Maximum requests per window
  - X-RateLimit-Remaining: Remaining requests in current window
  - X-RateLimit-Reset: Unix timestamp when limit resets
- **Circuit breaker for MongoDB:**
  - If MongoDB connection fails 5 times in 60 seconds, open circuit
  - Return 503 Service Unavailable during circuit open
  - Retry connection after 30 seconds (half-open state)
- **Timeout handling:**
  - Global request timeout: 29 seconds (1 second buffer before Lambda timeout)
  - Database query timeout: 10 seconds
  - Return 504 Gateway Timeout if exceeded
- **Failure modes:** Validation bypass, rate limit bypass, unhandled exception types, circuit breaker false positives

**Acceptance Criteria**
- AC-5.2.a: When unhandled exception occurs → response contains error object with statusCode, error, message, timestamp, path, request_id
- AC-5.2.b: When validation fails on request body → response is 400 Bad Request with field-level error details
- AC-5.2.c: When API key exceeds 100 requests/minute → response is 429 Too Many Requests with Retry-After header
- AC-5.2.d: When rate limit headers are checked → response includes X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
- AC-5.2.e: When MongoDB connection fails 5 times → circuit breaker opens and subsequent requests receive 503 Service Unavailable
- AC-5.2.f: When request exceeds 29 second timeout → response is 504 Gateway Timeout

**Acceptance Tests**
- Test-5.2.a: Integration test triggers internal server error, verifies response contains all required error fields
- Test-5.2.b: Integration test POSTs /api/sessions with missing project_id, receives 400 with field error indicating project_id required
- Test-5.2.c: Load test sends 110 requests in 60 seconds with same API key, verifies requests 101-110 receive 429 response
- Test-5.2.d: Integration test makes API request, verifies response headers include X-RateLimit-Limit=100 and X-RateLimit-Remaining
- Test-5.2.e: Integration test simulates MongoDB connection failures, verifies 6th request receives 503 with circuit open message
- Test-5.2.f: Integration test makes request with artificially delayed database query (30 seconds), verifies 504 timeout response

---

### 5.3 Health Checks & Monitoring Endpoints
Implement comprehensive health checks and monitoring endpoints for operational visibility.

**Implementation Details**
- **Systems affected:** HealthModule, monitoring infrastructure, alerting systems
- **Endpoints to create:**
  - `GET /health`: Basic health check (unauthenticated)
  - `GET /health/detailed`: Detailed health check with dependencies (authenticated)
  - `GET /metrics`: Prometheus-compatible metrics endpoint (authenticated)
- **GET /health response:**
  ```json
  {
    "status": "ok",
    "timestamp": "ISO 8601",
    "uptime": "number (seconds)"
  }
  ```
- **GET /health/detailed response:**
  ```json
  {
    "status": "ok",
    "timestamp": "ISO 8601",
    "uptime": "number (seconds)",
    "dependencies": {
      "database": {
        "status": "ok",
        "response_time_ms": "number",
        "connected": "boolean"
      },
      "background_jobs": {
        "status": "ok",
        "last_run": "ISO 8601"
      }
    },
    "version": "string (package.json version)",
    "environment": "string (production, development)"
  }
  ```
- **Health check logic:**
  - Database: Attempt simple query (count sessions), timeout 5 seconds
  - Background jobs: Check last execution timestamp, warn if >10 minutes
  - Status values: "ok", "degraded", "error"
  - Overall status: "ok" if all dependencies ok, "degraded" if any degraded, "error" if any error
- **GET /metrics response (Prometheus format):**
  ```
  # HELP api_requests_total Total API requests
  # TYPE api_requests_total counter
  api_requests_total{endpoint="/api/sessions",method="POST",status="201"} 1234

  # HELP active_sessions_count Current active sessions
  # TYPE active_sessions_count gauge
  active_sessions_count 42

  # HELP heartbeat_latency_ms Heartbeat processing latency
  # TYPE heartbeat_latency_ms histogram
  heartbeat_latency_ms_bucket{le="100"} 450
  ```
- **Metrics to expose:**
  - api_requests_total: Counter per endpoint, method, status
  - active_sessions_count: Gauge of current active sessions
  - stalled_sessions_count: Gauge of current stalled sessions
  - heartbeat_latency_ms: Histogram of heartbeat processing time
  - database_query_duration_ms: Histogram of database query latency
- **Monitoring integration:**
  - Configure CloudWatch alarms for health check failures
  - Alert if /health returns non-200 for >2 minutes
  - Alert if detailed health shows database error
- **Failure modes:** Health check timeout, database connection error during check, metrics calculation overhead

**Acceptance Criteria**
- AC-5.3.a: When GET /health is called → response is 200 OK with status="ok" and uptime in seconds
- AC-5.3.b: When GET /health/detailed is called → response includes database status with response_time_ms and connected=true
- AC-5.3.c: When database is unavailable → GET /health/detailed returns status="error" with database.status="error"
- AC-5.3.d: When GET /metrics is called → response includes active_sessions_count metric with current count
- AC-5.3.e: When health check executes → p95 response time is <200ms
- AC-5.3.f: When background job hasn't run in 15 minutes → GET /health/detailed returns status="degraded" with background_jobs.status="degraded"

**Acceptance Tests**
- Test-5.3.a: Integration test GETs /health and verifies 200 response with status="ok" and uptime >0
- Test-5.3.b: Integration test GETs /health/detailed and verifies database.response_time_ms <5000 and database.connected=true
- Test-5.3.c: Integration test stops MongoDB, GETs /health/detailed and verifies status="error" and database.status="error"
- Test-5.3.d: Integration test creates 5 active sessions, GETs /metrics and verifies active_sessions_count=5
- Test-5.3.e: Load test runs 100 concurrent GET /health requests and verifies p95 response time <200ms
- Test-5.3.f: Integration test stops background job scheduler for 16 minutes, GETs /health/detailed and verifies background_jobs.status="degraded"

---

### 5.4 Operational Documentation & Runbooks
Create comprehensive operational documentation for deployment, monitoring, troubleshooting, and maintenance.

**Implementation Details**
- **Systems affected:** Documentation, knowledge base, on-call procedures
- **Documentation to create:**
  1. **README.md:** Project overview, setup instructions, architecture diagram
  2. **DEPLOYMENT.md:** Step-by-step deployment guide, rollback procedures, environment setup
  3. **API.md:** API reference with all endpoints, request/response formats, authentication
  4. **MONITORING.md:** Monitoring setup, CloudWatch dashboards, alerting configuration
  5. **TROUBLESHOOTING.md:** Common issues, debugging steps, FAQ
  6. **RUNBOOKS.md:** Operational procedures for incidents, maintenance tasks
- **README.md contents:**
  - Project purpose and goals
  - Architecture overview with diagram
  - Technology stack
  - Prerequisites and dependencies
  - Local development setup
  - Testing instructions
  - Links to other documentation
- **DEPLOYMENT.md contents:**
  - Environment requirements (Node.js version, pnpm version)
  - MongoDB Atlas setup steps
  - senvn configuration for environment variables
  - SSL certificate setup for custom domain
  - Deployment commands and verification steps
  - Rollback procedure
  - Post-deployment validation checklist
- **API.md contents:**
  - Authentication guide (API key setup)
  - All endpoint documentation with curl examples
  - Request/response schemas
  - Error codes and meanings
  - Rate limiting details
  - Versioning strategy
- **TROUBLESHOOTING.md contents:**
  - "Session not receiving heartbeats" → Check network, API key, extension logs
  - "Stalled sessions not detected" → Verify background job running, check STALL_THRESHOLD_MS
  - "High latency on heartbeat endpoint" → Check MongoDB connection pool, Lambda concurrency
  - "Authentication failures" → Verify API key, check CloudWatch Logs for auth errors
- **RUNBOOKS.md contents:**
  - **Incident: API is down** → Check health endpoint, CloudWatch metrics, Lambda errors, rollback if needed
  - **Incident: Database connection failures** → Check MongoDB Atlas status, IP whitelist, connection string
  - **Maintenance: Rotate API keys** → Update senvn, redeploy, notify extension users
  - **Maintenance: Scale MongoDB** → Upgrade cluster tier, verify connection pool settings
- **Architecture diagram:** Show VSCode Extension → API Gateway → Lambda → MongoDB Atlas with heartbeat flow
- **Failure modes:** Outdated documentation, missing troubleshooting scenarios, incorrect runbook steps

**Acceptance Criteria**
- AC-5.4.a: When README.md is read → developer can understand project purpose and set up local development environment
- AC-5.4.b: When DEPLOYMENT.md is followed → new developer can deploy API to production successfully
- AC-5.4.c: When API.md is consulted → all endpoints are documented with request/response examples
- AC-5.4.d: When production issue occurs → TROUBLESHOOTING.md contains relevant debugging steps
- AC-5.4.e: When on-call engineer responds to incident → RUNBOOKS.md provides step-by-step response procedure
- AC-5.4.f: When architecture needs to be explained → architecture diagram accurately shows all components and data flow

**Acceptance Tests**
- Test-5.4.a: Manual review verifies README.md contains all required sections (purpose, architecture, setup, testing)
- Test-5.4.b: Manual test follows DEPLOYMENT.md steps from scratch and successfully deploys to test environment
- Test-5.4.c: Manual review verifies API.md documents all endpoints from Phase 2 and 3 with curl examples
- Test-5.4.d: Manual review verifies TROUBLESHOOTING.md contains entries for common issues (heartbeat, stall detection, auth)
- Test-5.4.e: Manual review verifies RUNBOOKS.md contains incident response procedures for API down and database failures
- Test-5.4.f: Manual review verifies architecture diagram exists and shows VSCode Extension, API Gateway, Lambda, MongoDB Atlas

---

## 3. Completion Criteria

The project is considered complete when:

1. **All Phase Acceptance Criteria Pass:**
   - All acceptance criteria from Phases 1-5 are met and verified
   - All acceptance tests execute successfully in production environment
   - No P0 (critical) or P1 (high priority) issues remain unresolved

2. **Production Deployment Validated:**
   - API is deployed to https://claude-projects.truapi.com and accessible
   - SSL certificate is valid and configured correctly
   - MongoDB production database is operational with proper indexes and TTL policies
   - CloudWatch monitoring is active and receiving logs

3. **VSCode Extension Integration Functional:**
   - Extension successfully creates sessions, sends heartbeats, and tracks tasks
   - End-to-end orchestration workflow completes successfully with state tracking
   - Recovery workflow has been tested and verified working

4. **Operational Readiness Achieved:**
   - All documentation (README, DEPLOYMENT, API, MONITORING, TROUBLESHOOTING, RUNBOOKS) is complete and reviewed
   - Health check endpoints are operational and monitored
   - Error handling and rate limiting are functioning as designed
   - Background jobs (failure detection, cleanup) are running on schedule

5. **Performance Targets Met:**
   - Heartbeat endpoint p95 latency <500ms
   - Session creation p95 latency <1000ms
   - Health check p95 latency <200ms
   - API uptime >99.5% over 7-day validation period

6. **Success Metrics Baseline Established:**
   - Session recovery rate measurement implemented
   - Time to detect failure tracking operational (target <5 minutes)
   - False positive rate monitoring in place (target <5%)
   - State consistency validation running (target zero corruption incidents)

---

## 4. Rollout & Validation

### Rollout Strategy

**Phase 1: Internal Testing (Week 1)**
- Deploy to production environment
- Enable state tracking for internal development sessions only
- Use test API keys separate from future production keys
- Monitor CloudWatch metrics and logs daily
- Collect feedback on integration experience

**Phase 2: Limited Rollout (Week 2-3)**
- Enable for 2-3 early adopter users
- Provide dedicated support channel for issues
- Monitor session recovery scenarios
- Validate background job execution
- Measure performance metrics against targets

**Phase 3: Full Rollout (Week 4+)**
- Enable for all VSCode extension users
- Publish API documentation externally
- Announce recovery capabilities
- Monitor success metrics weekly
- Iterate on configuration (STALL_THRESHOLD_MS, RETENTION_DAYS) based on data

**Feature Flags (Future Enhancement):**
- Currently no feature flags implemented
- Future consideration: Add feature flag for automatic recovery vs. manual recovery
- Future consideration: Add flag for background job execution frequency

### Post-Launch Validation

**Metrics to Monitor (Daily for first 2 weeks, then weekly):**
- **API Uptime:** Target 99.5%+, measure via health check monitoring
- **Heartbeat Success Rate:** Target 99%+, measure via CloudWatch Logs
- **Session Recovery Rate:** Target 90%+, measure via recovery endpoint usage vs. failed session count
- **Time to Detect Failure:** Target <5 minutes, measure via stall detection timestamp - last heartbeat
- **False Positive Rate:** Target <5%, measure via manually verified false stalls / total stall detections
- **API Latency:**
  - Heartbeat p95 <500ms
  - Session CRUD p95 <1000ms
  - Health check p95 <200ms
- **Error Rate:** Target <1% of requests, measure via 5xx response count / total requests
- **Database Performance:** Query latency p95 <100ms, measure via MongoDB Atlas metrics

**Rollback Triggers (Automatic rollback if any occur):**
- API uptime <95% over 1-hour period
- Error rate >5% of requests over 15-minute period
- Database connection failures >50% of attempts over 5-minute period
- Heartbeat endpoint p95 latency >2000ms over 10-minute period
- State corruption incident detected (session or task data inconsistency)
- Security incident (API key compromise, unauthorized access detected)

**Rollback Procedure:**
1. Execute SST rollback command: `pnpm sst deploy --stage prod --rollback`
2. Verify previous deployment restored via health check
3. Notify VSCode extension users of temporary degradation
4. Investigate root cause in logs and metrics
5. Fix issue in code and redeploy when validated
6. Document incident in post-mortem

**Validation Checklist (Week 1 Post-Launch):**
- [ ] All health checks green for 7 consecutive days
- [ ] At least 10 successful session recovery workflows completed
- [ ] Zero state corruption incidents reported
- [ ] Background jobs executing on schedule (verified via logs)
- [ ] All documentation reviewed and updated based on actual deployment
- [ ] CloudWatch alarms configured and tested
- [ ] Rate limiting triggered and verified working correctly
- [ ] SSL certificate expiry >60 days
- [ ] MongoDB backups verified and restorable

---

## 5. Open Questions

### Configuration & Thresholds
1. **Heartbeat interval:** Is 60 seconds the optimal balance between detection speed and database load? Should this be configurable per session?
   - Proposed: 60 seconds default, test with 30s and 120s variants
   - Decision needed: Allow override via session metadata?

2. **Stall detection threshold:** Is 3 minutes (3 missed heartbeats) appropriate for marking sessions as stalled?
   - Proposed: 3 minutes (180000ms) default
   - Decision needed: Should different project types have different thresholds?

3. **Data retention policy:** Is 30 days the right retention period for completed/failed sessions?
   - Proposed: 30 days for analytics, then delete
   - Decision needed: Should archived sessions be retained indefinitely or have separate retention?

### Rate Limiting & Performance
4. **Rate limiting:** What are appropriate rate limits per API key to prevent abuse without impacting legitimate usage?
   - Proposed: 100 requests/minute per key
   - Decision needed: Different limits for different endpoint types (heartbeat vs. CRUD)?

5. **Auto-cleanup timing:** Should stale sessions be automatically cleaned up after 24 hours of no heartbeat?
   - Proposed: 24 hours auto-cleanup for abandoned sessions
   - Decision needed: Grace period before cleanup? Notification before deletion?

### Recovery & Restart Behavior
6. **Automatic restart:** Should the API automatically trigger session restarts, or just provide state for the extension to decide?
   - Proposed: Extension decides and initiates recovery
   - Decision needed: Future consideration for API-initiated restart?

7. **Concurrent sessions:** Should we enforce one session per project, or allow multiple machines to work on different tasks simultaneously?
   - Proposed: Allow multiple sessions per project initially, monitor for conflicts
   - Decision needed: Add conflict detection in future phase?

### Technical Implementation
8. **Machine ID format:** How should machines be uniquely identified? Hostname, UUID, MAC address?
   - Proposed: os.hostname() with fallback to persistent UUID stored in VSCode workspace
   - Decision needed: Handle hostname collisions across different networks?

9. **Docker slot tracking:** What specific information needs to be tracked about docker slots beyond slot number?
   - Proposed: Slot number + resource limits + availability status
   - Decision needed: Track resource usage (CPU, memory) per slot?

10. **MongoDB connection pooling:** What pool size is optimal for serverless Lambda environment?
    - Proposed: Default Mongoose pool settings initially, tune based on load
    - Decision needed: Monitor and adjust max pool size based on concurrent Lambda instances?

### Monitoring & Alerting
11. **Alert thresholds:** What are appropriate thresholds for CloudWatch alarms to minimize false positives?
    - Proposed: Error rate >5% for 5 minutes, or uptime <95% for 15 minutes
    - Decision needed: Different thresholds for different severity levels?

12. **Logging verbosity:** Should production use INFO or DEBUG level logging? Trade-off between debuggability and cost.
    - Proposed: INFO level production, DEBUG for troubleshooting only
    - Decision needed: Sampling strategy for high-frequency events (heartbeats)?

### Future Enhancements
13. **Real-time updates:** When should WebSocket support be added for real-time session state updates?
    - Proposed: Phase 6 (future), after HTTP polling proven at scale
    - Decision needed: Validate demand from extension team first?

14. **Multi-region deployment:** At what scale should we deploy to multiple AWS regions?
    - Proposed: When single-region Lambda concurrency limits approached
    - Decision needed: Active-active vs. active-passive multi-region strategy?

15. **Session analytics:** What analytics and reporting would be valuable for understanding orchestration patterns?
    - Proposed: Average session duration, task completion rates, common failure reasons
    - Decision needed: Priority vs. other features?

---
