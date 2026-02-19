# Product Requirements Document: Centralized GitHub Service Layer

## 0. Source Context
**Derived From:** Feature Brief - `./pfb.md`
**Feature Name:** Centralize GitHub CLI Through Unified Service Layer
**PRD Owner:** Engineering Team / Infrastructure
**Last Updated:** 2026-01-24

### Feature Brief Summary
Create a unified service layer that centralizes all GitHub CLI interactions across the codebase. The service will expose GitHub operations through both an HTTP API (for the VSCode extension) and an MCP server (for Claude/LLM interactions), replacing scattered `gh` CLI command usage with a consistent, auditable, and maintainable architecture.

**Current Problem:** GitHub CLI commands are scattered across VSCode extension (TypeScript GraphQL wrappers), shell scripts (direct `gh` CLI), and project creation tools. No centralized error handling, logging, rate limiting, or auditability. Inconsistent authentication approaches make testing and debugging difficult.

**Proposed Solution:** Build a unified service layer with:
- NestJS HTTP REST API for VSCode extension
- MCP Server for Claude/LLM operations
- Shared GitHub client wrapper with auth abstraction
- Centralized logging, error handling, and rate limiting
- Gradual migration path without breaking existing functionality

---

## 1. Objectives & Constraints

### Objectives
- **Centralization:** Route 100% of GitHub CLI interactions through unified service (from scattered across 5+ files → single service layer)
- **Reliability:** Achieve >99.5% service uptime with <500ms response time (95th percentile)
- **Observability:** Log 100% of GitHub operations with type, user, timestamp, and outcome
- **Testability:** Enable comprehensive testing with >80% code coverage
- **Extensibility:** Provide consistent API for both UI (VSCode extension) and LLM (Claude via MCP)
- **Migration Safety:** Enable gradual migration without breaking existing functionality

### Constraints

**Technical:**
- Must maintain backward compatibility during migration period (existing shell scripts and extension continue working)
- GitHub GraphQL API limitations require some operations via REST API
- Rate limiting: 5,000 requests/hour for authenticated users
- Token scopes must be carefully managed (repo, read:org, read:project, project)

**Security:**
- GitHub tokens must NEVER be stored in code or version control
- Must use VSCode Secrets API and environment variables
- Audit logging required for compliance

**Performance:**
- API response time must be <500ms for 95th percentile operations
- Cache strategy needed to minimize GitHub API calls
- Connection pooling required for high availability

**Timeline:**
- Sequential execution: Each phase depends on previous completion
- Estimated 4-6 weeks for full implementation and migration

---

## 2. Execution Phases

> Phases below are ordered and sequential.
> A phase cannot begin until all acceptance criteria of the previous phase are met.

---

## Phase 1: Foundation - Core Service Infrastructure
**Purpose:** Establish the foundational service architecture, GitHub client abstraction, and shared infrastructure that all subsequent phases will build upon. This phase must complete first to ensure consistent patterns for API and MCP implementations.

### 1.1 GitHub Client Abstraction Layer

Create a unified GitHub client wrapper that abstracts both GraphQL and REST API interactions, replacing scattered `gh` CLI calls and direct API usage.

**Implementation Details**
- **Systems affected:** New `packages/api/src/github/` module
- **Inputs:**
  - GitHub PAT token (from auth service)
  - Operation type (query/mutation)
  - GraphQL query or REST endpoint
  - Variables/parameters
- **Outputs:**
  - Normalized response format (success/error)
  - Typed response data
  - Error objects with retry metadata
- **Core logic:**
  - Use Octokit SDK as underlying client
  - Support both GraphQL (`@octokit/graphql`) and REST (`@octokit/rest`)
  - Implement connection pooling (max 10 concurrent connections)
  - Auto-detect operation type based on input
  - Normalize error responses from different API types
- **Failure modes:**
  - Network timeout → retry with exponential backoff (3 attempts)
  - Rate limit exceeded → queue request with delay
  - Authentication failure → return specific error code
  - API deprecation → log warning and attempt fallback

**Acceptance Criteria**
- AC-1.1.a: When client receives valid GraphQL query → executes via Octokit and returns typed response within 2 seconds
- AC-1.1.b: When client receives valid REST endpoint → executes via Octokit REST and returns normalized response
- AC-1.1.c: When GitHub API returns rate limit error → client queues request and retries after rate limit window
- AC-1.1.d: When network timeout occurs → client retries 3 times with exponential backoff (1s, 2s, 4s)
- AC-1.1.e: When authentication fails → client returns `GITHUB_AUTH_FAILED` error code without retry
- AC-1.1.f: When API deprecation warning received → client logs warning and continues operation

**Acceptance Tests**
- Test-1.1.a: Unit test verifies GraphQL query execution returns correct typed response
- Test-1.1.b: Unit test verifies REST API call returns normalized response matching GraphQL format
- Test-1.1.c: Integration test simulates rate limit (429 response) and verifies request queuing behavior
- Test-1.1.d: Integration test simulates network timeout and verifies 3 retry attempts with correct delays
- Test-1.1.e: Unit test verifies authentication failure returns specific error code and skips retry
- Test-1.1.f: Unit test verifies deprecation warnings are logged to monitoring system

---

### 1.2 Authentication Abstraction Service

Create a flexible authentication service that supports multiple token sources (VSCode API, environment variables, configuration) with automatic refresh and validation.

**Implementation Details**
- **Systems affected:** New `packages/api/src/github/auth/` module
- **Dependencies:** 1.1 (GitHub Client uses this service)
- **Inputs:**
  - Token source type (vscode|env|config)
  - Token value (for env/config sources)
  - Required scopes array
- **Outputs:**
  - Validated GitHub PAT token
  - Token metadata (scopes, expiration)
  - Refresh status
- **Core logic:**
  - Support multiple token sources via strategy pattern
  - VSCode source: Extract token from VSCode authentication session
  - Environment source: Read from `GITHUB_TOKEN` env var
  - Config source: Read from configuration service
  - Validate token scopes against required scopes
  - Cache valid tokens (5-minute TTL)
  - Auto-refresh expired tokens when possible
- **Failure modes:**
  - Token missing → return `AUTH_TOKEN_NOT_FOUND` error
  - Insufficient scopes → return `AUTH_INSUFFICIENT_SCOPES` with required vs. actual
  - Token expired → attempt refresh, return `AUTH_TOKEN_EXPIRED` if refresh fails
  - Multiple sources conflict → prefer VSCode > config > env (documented precedence)

**Acceptance Criteria**
- AC-1.2.a: When VSCode authentication session exists → auth service extracts and validates token with required scopes
- AC-1.2.b: When token validation succeeds → service caches token for 5 minutes to avoid repeated validation calls
- AC-1.2.c: When token has insufficient scopes → service returns specific error listing required vs. actual scopes
- AC-1.2.d: When cached token expires → service auto-refreshes from source before next operation
- AC-1.2.e: When multiple token sources configured → service uses VSCode > config > env precedence order
- AC-1.2.f: When no valid token found → service returns clear error with remediation steps

**Acceptance Tests**
- Test-1.2.a: Integration test mocks VSCode session and verifies token extraction and scope validation
- Test-1.2.b: Unit test verifies token caching behavior with 5-minute TTL
- Test-1.2.c: Unit test verifies insufficient scope error includes required and actual scope lists
- Test-1.2.d: Integration test verifies token refresh after cache expiration (mock 6-minute delay)
- Test-1.2.e: Integration test verifies precedence order when multiple sources provide tokens
- Test-1.2.f: Unit test verifies error message includes actionable remediation steps

---

### 1.3 Logging and Monitoring Infrastructure

Implement centralized logging with structured formats, request tracing, and monitoring integration for all GitHub operations.

**Implementation Details**
- **Systems affected:** New `packages/api/src/github/logging/` module
- **Dependencies:** 1.1, 1.2 (logs all client and auth operations)
- **Inputs:**
  - Log level (debug|info|warn|error)
  - Operation type (graphql_query|rest_call|auth_validate)
  - Request ID (for tracing)
  - User identifier (when available)
  - GitHub operation metadata (query/endpoint, variables)
  - Response metadata (status, duration, error)
- **Outputs:**
  - Structured JSON log entries
  - Metrics for monitoring (Prometheus format)
  - Audit trail entries (for compliance)
- **Core logic:**
  - Extend existing `LoggingModule` from `packages/api/src/common/logging/`
  - Use Winston for structured logging
  - Format: `{ timestamp, level, requestId, userId, operation, duration, status, error }`
  - Sensitive data filtering (never log tokens or full auth headers)
  - Separate audit log stream for compliance (all mutations logged)
  - Metrics export: request count, error rate, latency percentiles
  - Integration with `RequestIdInterceptor` for request tracing
- **Failure modes:**
  - Logging failure → log to stderr but don't block operation
  - Monitoring endpoint down → buffer metrics locally (max 1000 entries)
  - Disk full → rotate logs and continue with warning

**Acceptance Criteria**
- AC-1.3.a: When any GitHub operation executes → logs structured JSON with timestamp, requestId, operation, duration, and status
- AC-1.3.b: When operation contains sensitive data (tokens, auth headers) → logger redacts sensitive fields before writing
- AC-1.3.c: When GitHub mutation occurs (create, update, delete) → audit log captures full operation details with user identifier
- AC-1.3.d: When monitoring metrics requested → service exposes Prometheus-compatible metrics endpoint with request counts and latency percentiles
- AC-1.3.e: When logging subsystem fails → operation continues successfully and logs to stderr fallback
- AC-1.3.f: When log volume exceeds threshold → log rotation occurs automatically with warning notification

**Acceptance Tests**
- Test-1.3.a: Integration test verifies all GitHub operations produce structured JSON logs with required fields
- Test-1.3.b: Unit test verifies token redaction in logs (searches log output for token patterns)
- Test-1.3.c: Integration test verifies mutation operations write to separate audit log stream
- Test-1.3.d: Integration test queries `/metrics` endpoint and verifies Prometheus format with expected labels
- Test-1.3.e: Unit test simulates logging failure and verifies operation completes with stderr fallback
- Test-1.3.f: Integration test generates high log volume and verifies rotation behavior

---

### 1.4 Error Handling and Retry Logic

Implement comprehensive error handling with categorization, retry strategies, and circuit breaker patterns for GitHub API failures.

**Implementation Details**
- **Systems affected:** New `packages/api/src/github/errors/` module
- **Dependencies:** 1.1, 1.3 (client uses error handler, all errors logged)
- **Inputs:**
  - Raw error from GitHub API (GraphQL or REST)
  - Operation context (type, attempt count, user)
- **Outputs:**
  - Categorized error type (rate_limit|auth|network|validation|server|unknown)
  - Retry decision (should_retry: boolean, delay_ms: number)
  - User-friendly error message
  - Technical error details (for logging)
- **Core logic:**
  - Error categorization:
    - 401/403 → `GITHUB_AUTH_ERROR` (no retry)
    - 429 → `GITHUB_RATE_LIMIT` (retry after reset time)
    - 500/502/503 → `GITHUB_SERVER_ERROR` (retry with backoff)
    - Network timeout → `GITHUB_NETWORK_ERROR` (retry with backoff)
    - 400/422 → `GITHUB_VALIDATION_ERROR` (no retry)
  - Retry strategy:
    - Rate limit: wait until reset time (from response headers)
    - Server errors: exponential backoff (1s, 2s, 4s, 8s, max 3 retries)
    - Network errors: exponential backoff (1s, 2s, 4s, max 3 retries)
    - Auth/validation: no retry (immediate failure)
  - Circuit breaker: open after 5 consecutive failures, half-open after 30s, close after 3 successes
  - User-friendly messages: map technical errors to actionable guidance
- **Failure modes:**
  - Unknown error type → categorize as `GITHUB_UNKNOWN_ERROR`, log full details, retry once
  - Circuit breaker open → fast-fail with `SERVICE_UNAVAILABLE` (no GitHub call)
  - Retry limit exceeded → return last error with retry history

**Acceptance Criteria**
- AC-1.4.a: When GitHub returns 429 rate limit → error handler waits until rate limit reset time and retries operation
- AC-1.4.b: When GitHub returns 500/502/503 server error → handler retries 3 times with exponential backoff (1s, 2s, 4s)
- AC-1.4.c: When GitHub returns 401/403 auth error → handler returns error immediately without retry
- AC-1.4.d: When 5 consecutive failures occur → circuit breaker opens and fast-fails subsequent requests for 30 seconds
- AC-1.4.e: When circuit breaker in half-open state → allows 1 test request, closes after 3 consecutive successes
- AC-1.4.f: When error occurs → handler maps to user-friendly message with actionable remediation steps

**Acceptance Criteria**
- Test-1.4.a: Integration test simulates 429 response with reset header and verifies wait and retry
- Test-1.4.b: Integration test simulates 500 errors and verifies 3 retries with correct delays (mock timer)
- Test-1.4.c: Unit test verifies 401/403 errors return immediately without retry attempts
- Test-1.4.d: Integration test triggers 5 consecutive failures and verifies circuit breaker opens (fast-fail)
- Test-1.4.e: Integration test verifies circuit breaker half-open behavior and closure after successes
- Test-1.4.f: Unit test verifies error message mapping produces user-friendly actionable text

---

### 1.5 Rate Limiting and Request Queue

Implement intelligent rate limiting and request queuing to stay within GitHub API limits while maximizing throughput.

**Implementation Details**
- **Systems affected:** New `packages/api/src/github/queue/` module
- **Dependencies:** 1.1, 1.3, 1.4 (client uses queue, queue logs operations and handles errors)
- **Inputs:**
  - GitHub operation request (query/mutation)
  - Priority level (high|normal|low)
  - User context (for per-user rate limits)
- **Outputs:**
  - Queued operation promise
  - Queue status (position, estimated wait time)
  - Rate limit status (remaining, reset time)
- **Core logic:**
  - Track GitHub rate limits: 5,000 requests/hour (GraphQL), separate REST limits
  - Maintain request queue with priority levels (high → normal → low)
  - Per-user rate limit tracking (for multi-user scenarios)
  - Proactive throttling: slow down when approaching limits (80% threshold)
  - Queue capacity: max 1,000 pending requests
  - Stale request cleanup: remove requests >2 minutes old
  - Rate limit headers parsing: track remaining, reset time from responses
  - Adaptive throttling: adjust request rate based on observed limits
- **Failure modes:**
  - Queue full (>1,000 requests) → reject new requests with `QUEUE_FULL` error
  - Request timeout (>2 minutes in queue) → reject with `QUEUE_TIMEOUT` error
  - Rate limit exceeded → pause queue until reset time
  - Priority inversion → high-priority requests bypass queue (max 10% of traffic)

**Acceptance Criteria**
- AC-1.5.a: When request received with remaining quota → executes immediately and updates rate limit tracking
- AC-1.5.b: When rate limit at 80% threshold → queue throttles requests to 50% rate to prevent limit breach
- AC-1.5.c: When rate limit exceeded → queue pauses all requests until reset time (from response headers)
- AC-1.5.d: When high-priority request received with queue backlog → request bypasses queue (max 10% bypass rate)
- AC-1.5.e: When request in queue >2 minutes → request removed with timeout error notification
- AC-1.5.f: When queue reaches 1,000 pending requests → new requests rejected with clear error message

**Acceptance Tests**
- Test-1.5.a: Integration test verifies immediate execution when quota available and rate limit tracking updates
- Test-1.5.b: Integration test simulates 80% quota usage and verifies throttling to 50% request rate
- Test-1.5.c: Integration test simulates rate limit exceeded (429) and verifies queue pause until reset
- Test-1.5.d: Integration test verifies high-priority bypass with enforcement of 10% max bypass rate
- Test-1.5.e: Integration test verifies request timeout after 2 minutes with proper cleanup
- Test-1.5.f: Load test fills queue to 1,000 requests and verifies rejection of new requests

---

## Phase 2: API Implementation - NestJS HTTP Endpoints
**Purpose:** Build the NestJS REST API layer that exposes GitHub operations to the VSCode extension. This phase depends on Phase 1's foundation (client, auth, logging) and provides the HTTP interface that Phase 4's migration will consume.

### 2.1 GitHub Projects API Endpoints

Implement REST endpoints for GitHub Projects v2 operations (create, update, list, link/unlink).

**Implementation Details**
- **Systems affected:** New `packages/api/src/modules/github/` module
- **Dependencies:** Phase 1 (all foundation services)
- **Endpoints:**
  - `GET /api/github/projects/:owner/:repo` - List repo-linked projects
  - `GET /api/github/projects/:owner` - List org projects
  - `POST /api/github/projects` - Create new project
  - `PATCH /api/github/projects/:projectId` - Update project
  - `POST /api/github/projects/:projectId/link` - Link project to repo
  - `DELETE /api/github/projects/:projectId/link` - Unlink project from repo
- **Inputs:**
  - Auth header: `Authorization: Bearer <token>`
  - Path params: owner, repo, projectId
  - Body params (create): title, description, repositoryId
  - Body params (update): title, description, status
  - Body params (link/unlink): repositoryId
- **Outputs:**
  - Success: `{ success: true, data: Project }` (200/201)
  - Error: `{ success: false, error: { code, message, details } }` (4xx/5xx)
  - Project schema: `{ id, number, title, url, isRepoLinked, items[] }`
- **Core logic:**
  - Use GitHub client from 1.1 for all GitHub operations
  - GraphQL queries for list operations (optimized)
  - GraphQL mutations for create/update/link operations
  - Response transformation to match current extension schema
  - Caching: 5-minute TTL for list operations (invalidate on mutations)
  - Validation: DTOs with class-validator decorators
  - Authorization: verify token scopes before operations
- **Failure modes:**
  - Invalid auth → 401 with `GITHUB_AUTH_REQUIRED`
  - Insufficient scopes → 403 with `GITHUB_INSUFFICIENT_SCOPES`
  - Project not found → 404 with `PROJECT_NOT_FOUND`
  - Validation error → 400 with field-specific errors
  - GitHub API error → map to appropriate HTTP status with details

**Acceptance Criteria**
- AC-2.1.a: When GET `/api/github/projects/:owner/:repo` with valid auth → returns array of repo-linked projects with correct schema
- AC-2.1.b: When POST `/api/github/projects` with valid data → creates project in GitHub and returns project object within 3 seconds
- AC-2.1.c: When POST `/api/github/projects/:projectId/link` → links project to repo via GraphQL mutation and returns success
- AC-2.1.d: When request has invalid/missing auth token → returns 401 with clear error message
- AC-2.1.e: When request has insufficient scopes → returns 403 with required vs. actual scope comparison
- AC-2.1.f: When list operation succeeds → response cached for 5 minutes, subsequent requests served from cache

**Acceptance Tests**
- Test-2.1.a: Integration test queries list endpoint with mocked GitHub response, verifies response schema matches extension expectations
- Test-2.1.b: Integration test creates project via API, verifies GitHub mutation called with correct params and response format
- Test-2.1.c: Integration test links project to repo, verifies GraphQL linkProjectV2ToRepository mutation executed
- Test-2.1.d: Integration test sends request without auth header, verifies 401 response with error code
- Test-2.1.e: Integration test sends request with token missing `project` scope, verifies 403 with scope details
- Test-2.1.f: Integration test verifies cache behavior (first request hits GitHub, second serves from cache)

---

### 2.2 GitHub Issues API Endpoints

Implement REST endpoints for GitHub Issues operations (create, update, close, list, link to projects).

**Implementation Details**
- **Systems affected:** `packages/api/src/modules/github/` module (extend 2.1)
- **Dependencies:** 2.1 (shares controller and service structure)
- **Endpoints:**
  - `GET /api/github/issues/:owner/:repo` - List repo issues
  - `GET /api/github/issues/:owner/:repo/:number` - Get specific issue
  - `POST /api/github/issues` - Create issue
  - `PATCH /api/github/issues/:owner/:repo/:number` - Update issue
  - `POST /api/github/issues/:owner/:repo/:number/close` - Close issue
  - `POST /api/github/issues/:owner/:repo/:number/link` - Link issue to project
- **Inputs:**
  - Auth header: `Authorization: Bearer <token>`
  - Path params: owner, repo, number
  - Body params (create): title, body, labels[], assignees[]
  - Body params (update): title, body, state, labels[]
  - Body params (link): projectId, statusFieldId, statusValue
- **Outputs:**
  - Success: `{ success: true, data: Issue }` (200/201)
  - Error: `{ success: false, error: { code, message, details } }` (4xx/5xx)
  - Issue schema: `{ id, number, title, body, state, url, labels[], assignees[], projectItems[] }`
- **Core logic:**
  - GraphQL queries for list/get operations
  - GraphQL mutations for create/update/close
  - Project linking via `addProjectV2ItemById` mutation
  - Status update via `updateProjectV2ItemFieldValue` mutation
  - Response includes project link status
  - Validation: issue number must be positive integer, state must be open/closed
  - Caching: no cache for individual issues (always fresh), 2-minute cache for lists
- **Failure modes:**
  - Issue not found → 404 with `ISSUE_NOT_FOUND`
  - Project link fails → 200 for issue creation but error details in response.warnings
  - Invalid state transition → 400 with valid state options
  - Duplicate issue title (if configured) → 409 with existing issue reference

**Acceptance Criteria**
- AC-2.2.a: When POST `/api/github/issues` with valid data → creates issue in GitHub and returns issue object with number
- AC-2.2.b: When POST `/api/github/issues/:owner/:repo/:number/close` → closes issue via state update mutation and returns updated issue
- AC-2.2.c: When POST `/api/github/issues/:owner/:repo/:number/link` with projectId → links issue to project and optionally updates status field
- AC-2.2.d: When GET `/api/github/issues/:owner/:repo/:number` → returns fresh issue data (no cache) with current state and labels
- AC-2.2.e: When issue link to project fails → issue creation still succeeds, response includes warning in warnings array
- AC-2.2.f: When GET `/api/github/issues/:owner/:repo` → returns paginated issue list cached for 2 minutes

**Acceptance Tests**
- Test-2.2.a: Integration test creates issue via API, verifies GitHub mutation and response includes issue number
- Test-2.2.b: Integration test closes issue, verifies state update mutation called with state: "closed"
- Test-2.2.c: Integration test links issue to project, verifies addProjectV2ItemById and updateProjectV2ItemFieldValue mutations
- Test-2.2.d: Integration test queries specific issue twice, verifies both requests hit GitHub (no cache)
- Test-2.2.e: Integration test simulates project link failure, verifies issue created successfully with warning
- Test-2.2.f: Integration test queries issue list twice within 2 minutes, verifies second request served from cache

---

### 2.3 Repository and Organization Query Endpoints

Implement REST endpoints for repository and organization metadata queries.

**Implementation Details**
- **Systems affected:** `packages/api/src/modules/github/` module (extend 2.1, 2.2)
- **Dependencies:** 2.1, 2.2 (shares service layer)
- **Endpoints:**
  - `GET /api/github/repos/:owner/:repo` - Get repo metadata
  - `GET /api/github/orgs/:owner` - Get org metadata
  - `GET /api/github/repos/:owner/:repo/linked-projects` - Get projects linked to repo (optimized version of 2.1.a)
- **Inputs:**
  - Auth header: `Authorization: Bearer <token>`
  - Path params: owner, repo
  - Query params: `include_projects=true` (optional, includes project list)
- **Outputs:**
  - Repo schema: `{ id, name, owner, description, url, defaultBranch, isPrivate }`
  - Org schema: `{ id, login, name, description, url, projectsV2Count }`
  - Linked projects: `{ repositoryId, projects[] }` (same as 2.1.a)
- **Core logic:**
  - GraphQL queries for all operations
  - Repo query includes projectsV2 connection when `include_projects=true`
  - Org query includes organization fields and project count
  - Caching: 10-minute TTL for repo metadata (rarely changes), 5-minute for org metadata
  - Validation: owner and repo must match GitHub naming rules (alphanumeric, hyphens, underscores)
- **Failure modes:**
  - Repo not found → 404 with `REPOSITORY_NOT_FOUND`
  - Org not found → 404 with `ORGANIZATION_NOT_FOUND`
  - Private repo without access → 404 (not 403, to avoid leaking existence)
  - OAuth restrictions → 403 with organization settings URL

**Acceptance Criteria**
- AC-2.3.a: When GET `/api/github/repos/:owner/:repo` → returns repo metadata with id, name, owner, description, url, defaultBranch
- AC-2.3.b: When GET `/api/github/repos/:owner/:repo?include_projects=true` → returns repo metadata plus linked projects array
- AC-2.3.c: When GET `/api/github/orgs/:owner` → returns org metadata with projectsV2Count
- AC-2.3.d: When repo metadata queried → response cached for 10 minutes to minimize GitHub API calls
- AC-2.3.e: When private repo queried without access → returns 404 (not 403) to avoid leaking repo existence
- AC-2.3.f: When org has OAuth restrictions → returns 403 with actionable error message including org settings URL

**Acceptance Tests**
- Test-2.3.a: Integration test queries repo metadata, verifies schema and required fields present
- Test-2.3.b: Integration test queries repo with `include_projects=true`, verifies projects array included
- Test-2.3.c: Integration test queries org metadata, verifies projectsV2Count field present
- Test-2.3.d: Integration test queries repo metadata twice within 10 minutes, verifies cache hit on second request
- Test-2.3.e: Integration test queries private repo without auth, verifies 404 response (not 403)
- Test-2.3.f: Integration test simulates OAuth restriction error, verifies 403 with org settings URL in message

---

### 2.4 API Documentation and OpenAPI Specification

Create comprehensive API documentation with OpenAPI 3.0 specification and interactive Swagger UI.

**Implementation Details**
- **Systems affected:** `packages/api/src/` (add Swagger module)
- **Dependencies:** 2.1, 2.2, 2.3 (documents all endpoints)
- **Outputs:**
  - OpenAPI 3.0 specification at `/api/docs/openapi.json`
  - Swagger UI at `/api/docs` (interactive documentation)
  - Markdown documentation at `docs/api-reference.md`
- **Core logic:**
  - Use `@nestjs/swagger` for automatic spec generation
  - Decorate DTOs with `@ApiProperty()` for schema documentation
  - Decorate controllers with `@ApiOperation()`, `@ApiResponse()` for endpoint docs
  - Include authentication requirements (`@ApiBearerAuth()`)
  - Example requests/responses for all endpoints
  - Error code reference section
  - Rate limiting documentation
  - Versioning strategy (start with v1)
- **Documentation sections:**
  - Getting Started (authentication, base URL)
  - Authentication (token requirements, scopes)
  - Endpoints (grouped by resource: projects, issues, repos, orgs)
  - Schemas (all DTOs and response types)
  - Error Codes (comprehensive list with remediation)
  - Rate Limiting (limits, headers, best practices)
  - Examples (common workflows)

**Acceptance Criteria**
- AC-2.4.a: When GET `/api/docs` → Swagger UI loads with all endpoints documented and grouped by resource
- AC-2.4.b: When viewing endpoint documentation → includes example requests and responses for success and error cases
- AC-2.4.c: When OpenAPI spec queried at `/api/docs/openapi.json` → returns valid OpenAPI 3.0 JSON with all endpoints, schemas, and auth requirements
- AC-2.4.d: When markdown docs viewed at `docs/api-reference.md` → includes getting started guide, auth instructions, and all endpoint details
- AC-2.4.e: When error occurs → error code documented with description, causes, and remediation steps
- AC-2.4.f: When API versioned → spec includes version number and changelog

**Acceptance Tests**
- Test-2.4.a: Integration test loads `/api/docs` and verifies Swagger UI renders without errors
- Test-2.4.b: Unit test verifies all endpoints have `@ApiOperation()` decorator with examples
- Test-2.4.c: Integration test validates `/api/docs/openapi.json` against OpenAPI 3.0 schema
- Test-2.4.d: CI test verifies `docs/api-reference.md` exists and contains all endpoint signatures
- Test-2.4.e: Unit test verifies all error codes documented with remediation steps
- Test-2.4.f: Unit test verifies API version included in OpenAPI spec info section

---

## Phase 3: MCP Server - Model Context Protocol Implementation
**Purpose:** Build the MCP server that exposes GitHub operations to Claude and LLM agents. This phase depends on Phase 1's foundation but runs parallel to Phase 2 (both consume the same foundation services). The MCP server provides the LLM interface that complements the HTTP API.

### 3.1 MCP Server Core Implementation

Implement the Model Context Protocol server with GitHub operation tools following MCP specification.

**Implementation Details**
- **Systems affected:** New `packages/mcp-server/` package (separate from NestJS API)
- **Dependencies:** Phase 1 (uses GitHub client, auth, logging from Phase 1)
- **Architecture:**
  - Standalone Node.js process (not part of NestJS app)
  - Uses `@modelcontextprotocol/sdk` for MCP protocol
  - Imports shared services from `packages/api/src/github/`
  - Stdio transport (standard MCP communication method)
  - Tool-based interface (no resources or prompts in v1)
- **MCP Tools (initial set):**
  - `github_create_project` - Create GitHub project
  - `github_create_issue` - Create issue
  - `github_update_issue` - Update issue status/fields
  - `github_close_issue` - Close issue
  - `github_link_issue_to_project` - Link issue to project
  - `github_list_projects` - List projects (repo or org)
  - `github_list_project_items` - List items in project
- **Tool schemas:**
  - JSON Schema for all tool inputs
  - Typed responses matching API schemas
  - Error handling via MCP error responses
- **Core logic:**
  - Tool handler delegates to GitHub client (1.1)
  - Auth via environment variable `GITHUB_TOKEN`
  - All operations logged via logging service (1.3)
  - Errors mapped to MCP error format with details
  - Request validation against JSON schemas
- **Failure modes:**
  - Tool schema validation fails → MCP error response with field details
  - GitHub operation fails → MCP error with GitHub error details
  - Server crash → stdio transport reports error to client

**Acceptance Criteria**
- AC-3.1.a: When MCP client calls `github_create_project` tool → creates project in GitHub and returns project ID and URL
- AC-3.1.b: When MCP client calls `github_create_issue` tool → creates issue and returns issue number and URL
- AC-3.1.c: When MCP client calls `github_link_issue_to_project` → links issue to project and updates status field if provided
- AC-3.1.d: When tool input fails schema validation → returns MCP error with specific field validation details
- AC-3.1.e: When GitHub operation fails → returns MCP error with GitHub error code, message, and retry guidance
- AC-3.1.f: When server receives list tools request → returns all 7 tool definitions with complete JSON schemas

**Acceptance Tests**
- Test-3.1.a: Integration test calls `github_create_project` via MCP, verifies project created and response format
- Test-3.1.b: Integration test calls `github_create_issue` via MCP, verifies issue created with correct fields
- Test-3.1.c: Integration test calls `github_link_issue_to_project`, verifies both link mutation and status update
- Test-3.1.d: Unit test sends invalid tool input, verifies MCP error response with field-level validation errors
- Test-3.1.e: Integration test simulates GitHub API error, verifies MCP error format with retry information
- Test-3.1.f: Integration test queries tools list, verifies all 7 tools present with valid JSON schemas

---

### 3.2 MCP Tool Schemas and Validation

Define comprehensive JSON schemas for all MCP tools with validation and documentation.

**Implementation Details**
- **Systems affected:** `packages/mcp-server/src/tools/schemas/` module
- **Dependencies:** 3.1 (tools use these schemas)
- **Tool Schemas:**
  - `github_create_project`:
    - Required: title (string, 1-100 chars), owner (string)
    - Optional: description (string), repositoryId (string), isOrgProject (boolean)
  - `github_create_issue`:
    - Required: owner (string), repo (string), title (string)
    - Optional: body (string), labels (string[]), assignees (string[])
  - `github_update_issue`:
    - Required: owner, repo, number (integer)
    - Optional: title, body, state (enum: open|closed), labels
  - `github_close_issue`:
    - Required: owner, repo, number
  - `github_link_issue_to_project`:
    - Required: owner, repo, issueNumber, projectId
    - Optional: statusFieldId, statusValue
  - `github_list_projects`:
    - Required: owner (string)
    - Optional: repo (string, omit for org projects), includeItems (boolean)
  - `github_list_project_items`:
    - Required: projectId (string)
    - Optional: filterByStatus (string)
- **Validation logic:**
  - Use Zod for runtime schema validation
  - Validate before GitHub operations
  - Provide detailed error messages for failed validation
  - Document all fields with descriptions and examples
- **Error responses:**
  - Invalid input → `{ error: { code: "INVALID_INPUT", message: "...", details: {...} } }`
  - Detailed field-level errors for debugging

**Acceptance Criteria**
- AC-3.2.a: When tool receives valid input matching schema → validation passes and tool executes
- AC-3.2.b: When tool receives invalid input (missing required field) → validation fails with specific field error
- AC-3.2.c: When tool receives input with invalid type (e.g., string for number) → validation fails with type error and expected type
- AC-3.2.d: When tool receives input outside constraints (e.g., title >100 chars) → validation fails with constraint details
- AC-3.2.e: When validation errors occur → error response includes field name, issue, and valid options/format
- AC-3.2.f: When MCP client queries tool schema → receives JSON Schema with descriptions and examples for all fields

**Acceptance Tests**
- Test-3.2.a: Unit test sends valid input to each tool schema, verifies validation success
- Test-3.2.b: Unit test omits required field from each schema, verifies validation error with field name
- Test-3.2.c: Unit test sends wrong type (string instead of number), verifies type error with expected type
- Test-3.2.d: Unit test sends title with 101 characters, verifies constraint violation error
- Test-3.2.e: Unit test verifies validation error format includes field, issue, and remediation
- Test-3.2.f: Integration test queries tool schemas, verifies descriptions and examples present

---

### 3.3 MCP Server Configuration and Deployment

Configure MCP server for local development and production deployment with proper authentication and monitoring.

**Implementation Details**
- **Systems affected:** `packages/mcp-server/` package configuration
- **Dependencies:** 3.1, 3.2
- **Configuration:**
  - Environment variables:
    - `GITHUB_TOKEN` - GitHub PAT (required)
    - `LOG_LEVEL` - debug|info|warn|error (default: info)
    - `ENABLE_METRICS` - boolean (default: false)
    - `METRICS_PORT` - number (default: 9090)
  - Configuration file: `mcp-server.config.json`
    - Default rate limits
    - Retry configuration
    - Cache settings
  - Secrets management:
    - Use dotenv for local development
    - Use AWS Secrets Manager for production (future)
- **Deployment options:**
  - Local: Run as stdio process for Claude Code
  - Systemd: Service configuration for Linux servers
  - Docker: Containerized deployment (optional)
- **Monitoring:**
  - Health check endpoint (when metrics enabled)
  - Prometheus metrics on `/metrics` (when enabled)
  - Structured logging to stdout (JSON format)
- **Documentation:**
  - Setup guide at `packages/mcp-server/README.md`
  - MCP configuration for Claude Code at `examples/mcp-config.json`

**Acceptance Criteria**
- AC-3.3.a: When MCP server starts with valid `GITHUB_TOKEN` → initializes successfully and accepts tool calls
- AC-3.3.b: When MCP server starts without `GITHUB_TOKEN` → fails with clear error message indicating missing token
- AC-3.3.c: When metrics enabled (`ENABLE_METRICS=true`) → exposes Prometheus metrics on configured port
- AC-3.3.d: When log level set to debug → outputs detailed operation logs including GitHub API calls
- AC-3.3.e: When MCP server deployed as systemd service → restarts automatically on failure with backoff
- AC-3.3.f: When Claude Code configured with MCP server → successfully discovers and calls all GitHub tools

**Acceptance Tests**
- Test-3.3.a: Integration test starts server with token, verifies successful initialization and tool availability
- Test-3.3.b: Integration test starts server without token, verifies exit with error message
- Test-3.3.c: Integration test enables metrics, queries `/metrics` endpoint, verifies Prometheus format
- Test-3.3.d: Integration test sets `LOG_LEVEL=debug`, verifies detailed logs include GitHub API calls
- Test-3.3.e: System test deploys as systemd service, kills process, verifies automatic restart
- Test-3.3.f: Integration test configures Claude Code with MCP server config, verifies tool discovery

---

## Phase 4: Migration - Transition Extension and Scripts
**Purpose:** Migrate existing GitHub CLI usage to the new service layer without breaking functionality. This phase depends on Phase 2 (HTTP API) and Phase 3 (MCP server) being complete. It's the critical transition phase that moves all scattered GitHub operations to the centralized service.

### 4.1 VSCode Extension Migration to HTTP API

Migrate VSCode extension from direct GraphQL calls to HTTP API endpoints.

**Implementation Details**
- **Systems affected:**
  - `apps/code-ext/src/github-api.ts` - Replace direct GraphQL with HTTP API client
  - `apps/code-ext/src/projects-view-provider.ts` - Update to use new API client
- **Migration strategy:**
  - Create new `api-client.ts` wrapper for HTTP API
  - Implement same interface as current `github-api.ts` (drop-in replacement)
  - Feature flag: `USE_API_SERVICE` (default: false initially)
  - Gradual rollout: enable for internal testing, then all users
  - Fallback mechanism: if API unavailable, use existing GraphQL client
- **API client implementation:**
  - Base URL from configuration (default: `http://localhost:8167/api`)
  - Auth: Extract token from VSCode session, pass as Bearer token
  - Request/response types match existing interfaces (Project, ProjectItem)
  - Error handling: map HTTP errors to existing error patterns
  - Caching: Remove local cache logic (API handles caching)
  - Timeout: 10-second request timeout with retry
- **Compatibility:**
  - All existing extension functionality must work identically
  - Response schemas must match current GraphQL responses
  - Error messages should be equivalent or better
  - Performance must be equal or better (<500ms for lists)
- **Testing:**
  - Regression test suite for all extension features
  - Side-by-side comparison: GraphQL vs. API responses
  - Error scenario testing (network failures, auth errors)

**Acceptance Criteria**
- AC-4.1.a: When extension uses API client with `USE_API_SERVICE=true` → all project operations work identically to current GraphQL implementation
- AC-4.1.b: When API request succeeds → response transforms to match existing extension schemas (no UI changes needed)
- AC-4.1.c: When API service unavailable → extension falls back to direct GraphQL client automatically
- AC-4.1.d: When list projects called via API → completes within 500ms (same or better than current GraphQL)
- AC-4.1.e: When API returns error → extension shows equivalent or better error message with remediation
- AC-4.1.f: When feature flag disabled → extension continues using existing GraphQL client (no changes)

**Acceptance Tests**
- Test-4.1.a: E2E test runs full extension workflow (list, create, update, link) with API client, verifies success
- Test-4.1.b: Integration test compares API responses to GraphQL responses, verifies schema match
- Test-4.1.c: Integration test simulates API down (503), verifies fallback to GraphQL client
- Test-4.1.d: Performance test measures list operation latency, verifies <500ms p95
- Test-4.1.e: Integration test simulates various API errors, verifies error message quality
- Test-4.1.f: Integration test with `USE_API_SERVICE=false`, verifies GraphQL client still works

---

### 4.2 Shell Scripts Migration to MCP Tools

Migrate shell scripts from direct `gh` CLI commands to MCP tool calls.

**Implementation Details**
- **Systems affected:**
  - `examples/update-project.sh` - Migrate to MCP API calls
  - `apps/code-ext/src/github-project-creator.ts` - Migrate to MCP tools
- **Migration strategy:**
  - Create `examples/mcp-helpers.sh` - Bash functions for MCP tool calls
  - Update `update-project.sh` to use MCP helpers instead of `gh` CLI
  - Update `github-project-creator.ts` to use MCP Node.js client
  - Deprecation warnings: existing scripts show migration notice
  - Parallel running: both old and new approaches work during transition
  - Cutover date: 90 days after migration tools available
- **MCP helper functions:**
  - `mcp_create_project()` - Wrapper for `github_create_project` tool
  - `mcp_create_issue()` - Wrapper for `github_create_issue` tool
  - `mcp_update_issue()` - Wrapper for `github_update_issue` tool
  - `mcp_close_issue()` - Wrapper for `github_close_issue` tool
  - `mcp_link_issue()` - Wrapper for `github_link_issue_to_project` tool
  - Error handling: parse MCP errors and return appropriate exit codes
- **Project creator migration:**
  - Replace `execAsync('gh ...')` calls with MCP client calls
  - Use `@modelcontextprotocol/sdk` client library
  - Maintain same retry logic and error handling
  - Progress callbacks continue working identically
  - Validation remains the same (delegate to MCP schemas)
- **Documentation:**
  - Migration guide: `docs/mcp-migration-guide.md`
  - Examples: `examples/mcp-tools/` directory with sample usage
  - Deprecation timeline in all shell scripts

**Acceptance Criteria**
- AC-4.2.a: When `update-project.sh` migrated to MCP → all operations work identically with improved error messages
- AC-4.2.b: When `github-project-creator.ts` uses MCP client → project creation success rate matches or exceeds current `gh` CLI approach
- AC-4.2.c: When MCP helper function called → executes corresponding MCP tool and returns result or error with correct exit code
- AC-4.2.d: When legacy `gh` CLI script runs → shows deprecation warning with migration guide link
- AC-4.2.e: When MCP client encounters error → retries with same strategy as current implementation (3 attempts, exponential backoff)
- AC-4.2.f: When migration guide followed → developer successfully migrates script from `gh` CLI to MCP in <30 minutes

**Acceptance Tests**
- Test-4.2.a: Integration test runs migrated `update-project.sh`, verifies all operations succeed
- Test-4.2.b: E2E test creates full project via migrated `github-project-creator.ts`, verifies success rate ≥95%
- Test-4.2.c: Integration test calls each MCP helper function, verifies tool execution and exit codes
- Test-4.2.d: Integration test runs legacy script, verifies deprecation warning displayed
- Test-4.2.e: Integration test simulates MCP errors, verifies retry behavior matches current implementation
- Test-4.2.f: User acceptance test times migration of sample script following guide

---

### 4.3 Cache Strategy Alignment

Align caching behavior between API service and extension to prevent inconsistencies.

**Implementation Details**
- **Systems affected:**
  - `apps/code-ext/src/cache-manager.ts` - Update or remove based on API caching
  - `packages/api/src/github/` - Centralized cache implementation
- **Caching decision:**
  - Option A: API handles all caching, extension removes local cache
  - Option B: Two-tier caching (API + extension with cache coordination)
  - **Recommended: Option A** (simpler, single source of truth)
- **API cache implementation:**
  - Use Redis for distributed caching (future) or in-memory for MVP
  - TTLs: projects list (5 min), repo metadata (10 min), issues (2 min)
  - Cache keys: `github:projects:${owner}:${repo}`, `github:issue:${owner}:${repo}:${number}`
  - Cache invalidation: on mutations (create, update, delete)
  - Cache headers: include `X-Cache: HIT/MISS` for debugging
- **Extension changes:**
  - Remove `cache-manager.ts` local caching (API provides caching)
  - Remove stale cache UI indicators (API always returns fresh or valid cache)
  - Remove cache refresh button (replaced with forced refresh parameter)
  - Add `force_refresh` parameter to API calls when user clicks refresh
- **Migration:**
  - Phase 1: Dual cache (both extension and API cache)
  - Phase 2: Disable extension cache, rely on API cache
  - Phase 3: Remove extension cache code

**Acceptance Criteria**
- AC-4.3.a: When extension requests data from API → API cache serves response if valid, reducing GitHub API calls
- AC-4.3.b: When user clicks refresh in extension → extension passes `force_refresh=true` to API, bypassing cache
- AC-4.3.c: When mutation occurs via API → related cache entries invalidated automatically
- AC-4.3.d: When API serves from cache → response includes `X-Cache: HIT` header for debugging
- AC-4.3.e: When extension cache removed → all extension features continue working without stale data issues
- AC-4.3.f: When cache invalidation fails → API logs warning but operation succeeds (graceful degradation)

**Acceptance Tests**
- Test-4.3.a: Integration test makes two identical requests, verifies second is cache hit (via header)
- Test-4.3.b: Integration test calls API with `force_refresh=true`, verifies cache bypassed (GitHub API called)
- Test-4.3.c: Integration test creates project, verifies project list cache invalidated
- Test-4.3.d: Integration test verifies all cached responses include `X-Cache` header
- Test-4.3.e: Regression test suite runs with extension cache removed, verifies all features work
- Test-4.3.f: Integration test simulates cache invalidation failure, verifies operation succeeds with warning log

---

### 4.4 Error Message Consistency

Standardize error messages across API, MCP server, and extension for better user experience.

**Implementation Details**
- **Systems affected:**
  - `packages/api/src/github/errors/` - Error message templates
  - `packages/mcp-server/src/tools/` - MCP error responses
  - `apps/code-ext/src/` - Extension error display
- **Error message format:**
  - User-friendly message (shown in UI)
  - Error code (for logging and debugging)
  - Technical details (for developers)
  - Remediation steps (actionable guidance)
- **Error categories and messages:**
  - `GITHUB_AUTH_REQUIRED`:
    - Message: "GitHub authentication required. Please sign in to continue."
    - Action: "Click 'Sign in with GitHub' to authenticate."
  - `GITHUB_INSUFFICIENT_SCOPES`:
    - Message: "Missing required GitHub permissions."
    - Details: "Required: project, read:org. Current: repo, read:org."
    - Action: "Sign out and sign in again to grant required permissions."
  - `GITHUB_RATE_LIMIT`:
    - Message: "GitHub API rate limit reached. Please try again later."
    - Details: "Rate limit resets at 2:30 PM."
    - Action: "Wait 15 minutes or use a different GitHub account."
  - `PROJECT_NOT_FOUND`:
    - Message: "Project not found or access denied."
    - Action: "Verify project exists and you have access."
  - `GITHUB_SERVER_ERROR`:
    - Message: "GitHub is experiencing issues. Please try again."
    - Action: "Check GitHub status: https://githubstatus.com"
- **Consistency requirements:**
  - Same error code → same message across API, MCP, extension
  - All errors include remediation steps
  - Errors logged with full technical details
  - User sees simplified message with action

**Acceptance Criteria**
- AC-4.4.a: When auth error occurs in API, MCP, or extension → user sees identical error message with same remediation steps
- AC-4.4.b: When error displayed to user → includes actionable remediation step (not just "error occurred")
- AC-4.4.c: When error logged → includes error code, technical details, user context, and timestamp
- AC-4.4.d: When rate limit error occurs → message includes specific reset time from GitHub API
- AC-4.4.e: When server error occurs → message includes link to GitHub status page
- AC-4.4.f: When error code documentation queried → includes message template, causes, and remediation for all error codes

**Acceptance Tests**
- Test-4.4.a: Integration test triggers auth error in API and MCP, verifies identical user-facing messages
- Test-4.4.b: Unit test verifies all error messages include remediation steps (regex check for action words)
- Test-4.4.c: Integration test verifies error logs include all required fields (code, details, context, timestamp)
- Test-4.4.d: Integration test simulates rate limit, verifies message includes reset time from response
- Test-4.4.e: Integration test simulates server error, verifies message includes GitHub status link
- Test-4.4.f: Documentation test verifies error code reference includes all fields for all error codes

---

## Phase 5: Deprecation & Cleanup - Remove Direct CLI Usage
**Purpose:** Complete the transition by removing direct `gh` CLI usage and cleaning up deprecated code. This phase depends on Phase 4's successful migration and ensures the codebase only uses the centralized service layer going forward.

### 5.1 Remove Direct GitHub CLI Calls

Remove all direct `gh` CLI command usage from codebase after migration complete.

**Implementation Details**
- **Systems affected:**
  - `apps/code-ext/src/github-project-creator.ts` - Remove or archive
  - `examples/update-project.sh` - Mark as deprecated, add removal date
  - Any remaining `execAsync('gh ...')` calls
- **Removal strategy:**
  - Grep codebase for `gh ` patterns (shell commands)
  - Grep for `execAsync` and `exec` calls (child_process usage)
  - Verify each usage is either migrated or intentionally kept
  - Archive deprecated scripts to `examples/deprecated/` directory
  - Update documentation to remove CLI references
- **Files to remove/archive:**
  - `apps/code-ext/src/github-project-creator.ts` → delete (replaced by MCP)
  - `examples/update-project.sh` → archive to `examples/deprecated/`
  - Any helper scripts that call `gh` CLI
- **Files to update:**
  - Remove `gh` CLI installation instructions from README
  - Update CLAUDE.md to reference API/MCP instead of CLI
  - Remove CLI-related dependencies from package.json
- **Safety checks:**
  - Run full test suite to verify no broken dependencies
  - Grep for any remaining CLI usage
  - Verify extension still works in production
  - Verify MCP tools still work for Claude Code

**Acceptance Criteria**
- AC-5.1.a: When codebase searched for `gh ` CLI commands → no active usage found (only deprecated examples)
- AC-5.1.b: When deprecated scripts executed → show clear deprecation notice with migration guide and removal date
- AC-5.1.c: When `github-project-creator.ts` removed → all project creation flows work via MCP tools
- AC-5.1.d: When documentation reviewed → no references to direct `gh` CLI usage (only API/MCP references)
- AC-5.1.e: When full test suite runs → all tests pass without CLI dependencies
- AC-5.1.f: When extension and MCP server deployed to production → operate successfully without CLI installed

**Acceptance Tests**
- Test-5.1.a: Automated grep test searches codebase for `gh ` patterns, verifies only deprecated directory matches
- Test-5.1.b: Integration test executes deprecated script, verifies deprecation notice displayed
- Test-5.1.c: E2E test creates project without CLI, verifies success via MCP tools
- Test-5.1.d: Documentation linter verifies no CLI installation instructions in active docs
- Test-5.1.e: CI test suite runs all tests, verifies 100% pass rate
- Test-5.1.f: Production smoke test runs extension and MCP server on system without CLI

---

### 5.2 Monitoring and Alerting Setup

Implement comprehensive monitoring and alerting for the GitHub service layer.

**Implementation Details**
- **Systems affected:**
  - `packages/api/src/` - Add monitoring middleware
  - `packages/mcp-server/src/` - Add monitoring for MCP operations
- **Metrics to track:**
  - Request rate (requests/minute by endpoint)
  - Error rate (errors/minute by error type)
  - Latency (p50, p95, p99 by endpoint)
  - GitHub API quota usage (remaining, reset time)
  - Cache hit rate (hits/misses)
  - Circuit breaker state (open/closed/half-open)
  - Queue depth (pending requests)
- **Monitoring stack:**
  - Prometheus for metrics collection
  - Grafana for dashboards (optional, future)
  - CloudWatch for AWS-deployed API (existing infrastructure)
  - Structured logs to stdout (JSON format)
- **Alerts to configure:**
  - Error rate >5% for 5 minutes → PagerDuty alert
  - API latency p95 >1s for 5 minutes → Slack alert
  - GitHub quota <20% remaining → Slack warning
  - Circuit breaker open → Slack alert
  - API down (health check fails) → PagerDuty alert
  - MCP server crash → Email notification
- **Dashboards:**
  - API overview: request rate, error rate, latency
  - GitHub operations: quota usage, rate limits, operation types
  - Cache performance: hit rate, evictions, size
  - Error analysis: error codes, frequency, affected users
- **Health checks:**
  - `/health` endpoint: simple liveness check
  - `/health/ready` endpoint: readiness check (includes DB, GitHub API test)
  - MCP server: periodic self-test of tools

**Acceptance Criteria**
- AC-5.2.a: When API receives requests → Prometheus metrics updated in real-time with request rate, latency, and status
- AC-5.2.b: When error rate exceeds 5% for 5 minutes → alert triggered to PagerDuty or configured channel
- AC-5.2.c: When GitHub quota drops below 20% → warning alert sent to Slack with quota details and reset time
- AC-5.2.d: When circuit breaker opens → alert sent immediately with affected operations and estimated recovery time
- AC-5.2.e: When health check queried → returns 200 OK with status details (API version, uptime, GitHub connectivity)
- AC-5.2.f: When metrics dashboard viewed → displays request rate, error rate, latency, and quota usage in real-time

**Acceptance Tests**
- Test-5.2.a: Integration test sends requests, queries Prometheus `/metrics`, verifies metric updates
- Test-5.2.b: Integration test simulates high error rate, verifies alert triggered after 5-minute threshold
- Test-5.2.c: Integration test simulates low quota (mocked), verifies warning alert sent
- Test-5.2.d: Integration test triggers circuit breaker open, verifies immediate alert delivery
- Test-5.2.e: Integration test queries `/health` and `/health/ready`, verifies response format and status checks
- Test-5.2.f: Manual test loads Grafana/CloudWatch dashboard, verifies all panels display correct data

---

### 5.3 Documentation Updates and Developer Guides

Update all documentation to reflect new service layer architecture and remove CLI references.

**Implementation Details**
- **Systems affected:**
  - `CLAUDE.md` - Update architecture and workflow sections
  - `README.md` - Update setup and development instructions
  - `docs/api-reference.md` - Keep updated with API changes (from 2.4)
  - `docs/mcp-integration.md` - Update MCP server documentation
  - `docs/development-guide.md` - Create new guide for contributing
- **Documentation updates needed:**
  - CLAUDE.md:
    - Update "Architecture Overview" to show service layer
    - Update "Development Rules" to reference API/MCP instead of CLI
    - Update "Common Development Workflows" with API examples
    - Remove CLI installation requirements
  - README.md:
    - Update "Requirements" section (remove GitHub CLI)
    - Update "Setup" with API service configuration
    - Add MCP server setup instructions
    - Update architecture diagram
  - New developer guide:
    - How to add new GitHub operations (API endpoint + MCP tool)
    - How to test GitHub integrations (mocking strategies)
    - How to handle GitHub API changes
    - Troubleshooting common issues
- **Migration guides:**
  - `docs/mcp-migration-guide.md` - Already created in 4.2
  - `docs/cli-to-api-migration.md` - Extension migration guide
  - `docs/troubleshooting.md` - Common issues and solutions
- **Code examples:**
  - `examples/api-usage/` - HTTP API examples (curl, TypeScript)
  - `examples/mcp-tools/` - MCP tool usage examples (already from 4.2)
  - Remove or archive `examples/update-project.sh` to deprecated

**Acceptance Criteria**
- AC-5.3.a: When developer reads CLAUDE.md → understands new architecture without CLI references, sees API/MCP as primary integration points
- AC-5.3.b: When new developer follows README setup → can run extension and MCP server without installing GitHub CLI
- AC-5.3.c: When developer adds new GitHub operation → follows guide to implement both API endpoint and MCP tool
- AC-5.3.d: When migration guide followed → existing CLI-based script successfully migrated to API/MCP in <1 hour
- AC-5.3.e: When troubleshooting guide consulted → common issues documented with step-by-step resolution
- AC-5.3.f: When API reference accessed → all endpoints documented with examples, schemas, and error codes (from 2.4)

**Acceptance Tests**
- Test-5.3.a: Documentation review verifies CLAUDE.md contains no CLI references, includes service layer architecture
- Test-5.3.b: New developer onboarding test follows README, verifies successful setup without CLI installation
- Test-5.3.c: Developer test adds mock GitHub operation following guide, verifies both API and MCP implementation
- Test-5.3.d: Timed test migrates sample script following guide, verifies completion in <1 hour
- Test-5.3.e: Documentation review verifies troubleshooting guide covers top 10 issues from support tickets
- Test-5.3.f: Automated test verifies API reference completeness (all endpoints have examples and schemas)

---

## 3. Completion Criteria

The project is considered complete when:
- **All phase acceptance criteria pass:** Every AC from Phase 1-5 validated and documented
- **All acceptance tests green:** Test suite runs successfully with 100% pass rate
- **No open P0 or P1 issues:** Critical and high-priority bugs resolved
- **Migration complete:** 100% of GitHub operations use service layer (no direct CLI usage)
- **Production deployment:** API and MCP server deployed and operational in production
- **Documentation current:** All docs updated, migration guides published, examples working
- **Monitoring active:** Dashboards live, alerts configured and tested
- **Team trained:** Developers onboarded on new architecture, able to add features independently

---

## 4. Rollout & Validation

### Rollout Strategy

**Phase 1 (Foundation):**
- Deploy to development environment
- Internal team testing only
- No production exposure

**Phase 2 (API Implementation):**
- Deploy API to staging environment behind feature flag
- Internal testing with VSCode extension (feature flag enabled)
- Performance and load testing
- Enable for 10% of internal users
- Enable for 50% of internal users
- Enable for 100% of internal users
- Public beta (opt-in for external users)

**Phase 3 (MCP Server):**
- Deploy MCP server to local development first
- Test with Claude Code integration
- Deploy to production as separate service
- Enable for Claude Code users via configuration

**Phase 4 (Migration):**
- Week 1-2: Extension migration with feature flag (default OFF)
- Week 3-4: Enable feature flag for 25% of users
- Week 5-6: Enable for 75% of users
- Week 7: Enable for 100% of users, mark GraphQL client as deprecated
- Week 8: Monitor for regressions, address issues
- Week 9-12: Shell script migration, deprecation warnings added

**Phase 5 (Cleanup):**
- 90 days after Phase 4 completion
- Remove deprecated code after confirming zero usage
- Final documentation update
- Public announcement of architecture change

### Post-Launch Validation

**Metrics to Monitor (30 days):**
- API uptime: Target >99.5% (measure: CloudWatch uptime)
- API latency p95: Target <500ms (measure: Prometheus histogram)
- Error rate: Target <1% (measure: error count / total requests)
- GitHub quota usage: Target <80% of limit (measure: remaining quota tracking)
- Cache hit rate: Target >60% (measure: cache hits / total requests)
- MCP tool success rate: Target >95% (measure: successful tool calls / total calls)
- User-reported issues: Target <5 GitHub-related bugs/week

**Rollback Triggers:**
- API uptime <95% for 24 hours → rollback to GraphQL client
- Error rate >5% for 1 hour → rollback to previous version
- P0 bug affecting >25% of users → immediate rollback
- GitHub API quota exceeded repeatedly → pause rollout, investigate
- User complaints >10/day about GitHub features → pause rollout, investigate

**Success Indicators (90 days):**
- Zero direct `gh` CLI usage in codebase
- >80% cache hit rate (reduced GitHub API calls)
- <500ms p95 latency maintained
- Zero regressions vs. previous architecture
- 100% of new GitHub features implemented via service layer
- Developer velocity: New GitHub features ship 50% faster (measure: story points or time to merge)

---

## 5. Open Questions

**Technical Questions:**
1. Should MCP server be a separate microservice or integrated into NestJS API? (Recommendation: Separate for independence)
2. What caching backend for production: Redis vs. in-memory? (Recommendation: In-memory for MVP, Redis for scale)
3. Should we support multiple GitHub accounts/organizations simultaneously? (Deferred to future phase)
4. How should we handle GitHub GraphQL API schema changes and deprecations? (Answer: Implement adapter pattern with version detection)
5. What monitoring stack integration: CloudWatch-only vs. Prometheus+Grafana? (Recommendation: CloudWatch for MVP, add Prometheus later)

**Product Questions:**
6. What is the expected request volume per hour for capacity planning? (Need input from product team)
7. Do we need webhooks for real-time project/issue updates in the future? (Answer: Yes, but deferred to Phase 6)
8. Should we expose the API publicly or keep it internal only? (Recommendation: Internal only for MVP, evaluate public API later)
9. What is the priority order for migrating existing components? (Answered in Phase 4: Extension first, then scripts)

**Operational Questions:**
10. What is the SLA for API uptime? (Proposed: 99.5% based on success metrics)
11. Who is on-call for API/MCP server issues? (Need to define on-call rotation)
12. What is the incident response process for GitHub service failures? (Need to document runbook)
13. How should we handle GitHub API outages? (Recommendation: Circuit breaker + fallback with user notification)

**Timeline Questions:**
14. What is the target completion date for Phase 1? (Estimate: 1 week)
15. What is the acceptable migration timeline for Phase 4? (Proposed: 8-12 weeks gradual rollout)
16. When should deprecated CLI code be removed? (Proposed: 90 days after migration complete)

---

**End of Product Requirements Document**

*This PRD is a living document. As implementation progresses, update this document with decisions, changes, and lessons learned. Each phase should be reviewed and signed off before proceeding to the next phase.*
