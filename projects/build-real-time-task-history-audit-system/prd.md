# Build Real-Time Task History Audit System - Product Requirements Document

## 0. Source Context

**Feature Brief:** `projects/build-real-time-task-history-audit-system/pfb.md`
**Repository:** `stoked-projects` monorepo
**Target Release:** Q1 2026
**Owner:** stokedconsulting

### Codebase References

| Component | Path | Role |
|-----------|------|------|
| NestJS API | `packages/api/` | Backend API with MongoDB (Mongoose), Socket.io WebSocket gateway |
| VSCode Extension | `apps/code-ext/` | Extension with webview, OrchestrationWebSocketClient |
| MCP Server | `packages/mcp-server/` | MCP server with `api-client.ts` for GitHub API operations |
| App Module | `packages/api/src/app.module.ts` | NestJS root module, registers all modules and global interceptors |
| Logging Interceptor | `packages/api/src/common/interceptors/logging.interceptor.ts` | Pattern for audit interceptor (global, request/response logging) |
| Task Schema | `packages/api/src/schemas/task.schema.ts` | Existing task MongoDB schema with TTL indexes |
| Session Schema | `packages/api/src/schemas/session.schema.ts` | Existing session MongoDB schema |
| Project Event Types | `packages/api/src/modules/project-events/project-event.types.ts` | Union type for `ProjectEventType`, event data interfaces |
| Project Events Controller | `packages/api/src/modules/project-events/project-events.controller.ts` | `POST /api/events/project` endpoint, buffers and broadcasts events |
| Orchestration Gateway | `packages/api/src/modules/orchestration/orchestration.gateway.ts` | Socket.io gateway at `/orchestration`, room-based subscriptions |
| Task History Manager | `apps/code-ext/src/task-history-manager.ts` | Local `workspaceState`-based task history (client-only) |
| Task History View | `apps/code-ext/src/task-history-view-provider.ts` | Webview rendering task history entries |
| Orchestration WS Client | `apps/code-ext/src/orchestration-websocket-client.ts` | Socket.io client subscribing to workspace and project events |
| Extension API Client | `apps/code-ext/src/api-client.ts` | HTTP client for API calls from extension |
| MCP API Client | `packages/mcp-server/src/api-client.ts` | HTTP client for API calls from MCP server |
| Project Start Command | `apps/code-ext/commands/project-start.md` | Orchestrator prompt template for parallel subagent execution |

---

## 1. Objectives & Constraints

### Objectives

1. **Comprehensive API audit trail:** Every state-changing API call (POST, PUT, PATCH, DELETE) writes an audit record to a persistent MongoDB `audit_history` collection, capturing workspace ID, worktree path, project number, task ID, session ID, operation type, request summary, response status, duration, and actor context.

2. **Orchestrator instrumentation:** The `/project-start` orchestrator emits structured task progress events (`task.started`, `task.completed`, `task.failed`, `phase.started`, `phase.completed`, `orchestration.progress`) through the existing `POST /api/events/project` endpoint, which broadcasts them via Socket.io to subscribed clients.

3. **Real-time Task History UI:** The VSCode extension's Task History webview receives live updates over the existing `OrchestrationWebSocketClient` connection and renders them immediately. When a subagent completes a work item, the Task History view updates within 3 seconds without manual refresh.

4. **Workspace-scoped filtering:** The Task History view shows only audit entries and progress events relevant to the current workspace and its associated worktrees.

5. **Backward compatibility:** Existing API endpoints, task lifecycle operations, and the current `TaskHistoryManager` local storage continue to function unchanged. The audit system is additive.

### Constraints

1. **No new infrastructure.** The `audit_history` collection lives in the same MongoDB instance (`stoked-projects` database) used by sessions and tasks.
2. **Performance budget.** Audit writes must add less than 50ms overhead (p99) to API responses via async fire-and-forget pattern.
3. **Socket.io payload limits.** Event payloads must stay under 1MB. Request/response bodies in audit records are truncated to a sanitized summary.
4. **Webview sandboxing.** The Task History webview communicates exclusively via `postMessage`. No direct database access.
5. **Backward compatibility.** API clients that do not send `X-Workspace-Id` / `X-Worktree-Path` headers still function; audit records store `null` for missing context fields.

### Success Metrics

| Metric | Target |
|--------|--------|
| Audit record written per state-changing API call | 100% coverage |
| Latency overhead of audit writes on API responses | < 50ms (p99) |
| Time from orchestrator event to Task History UI update | < 3 seconds |
| Task History view updates without manual refresh | Yes (zero-refresh) |
| Audit entries include workspace + worktree context | 100% when headers provided |
| No regression in existing API response times | < 10% increase |
| Audit history retention | 90 days (configurable via TTL) |

---

## Phase 1: Audit Foundation

This phase establishes the MongoDB audit collection, the global NestJS interceptor that writes audit records, and REST endpoints for querying audit history. All server-side, no extension changes.

### 1.1 Create Audit History MongoDB Schema

Define the `AuditHistory` Mongoose schema and register it as a new collection in the `stoked-projects` database. This schema stores one document per state-changing API call with full context.

**Implementation Details**

- **Systems affected:** `packages/api/src/schemas/` (new file: `audit-history.schema.ts`), `packages/api/src/schemas/index.ts` (export)
- **Inputs / outputs:** Schema definition with fields listed below; outputs a Mongoose model registered via `MongooseModule.forFeature()`.
- **Core logic:**
  - Schema fields: `audit_id` (UUID, unique, indexed), `timestamp` (Date, indexed, default: `Date.now`), `api_endpoint` (string), `http_method` (string, enum: POST/PUT/PATCH/DELETE), `workspace_id` (string, nullable, indexed), `worktree_path` (string, nullable), `project_number` (number, nullable, indexed), `task_id` (string, nullable), `session_id` (string, nullable), `operation_type` (string, e.g., `task.started`, `issue.updated`), `request_summary` (Object, sanitized payload -- max 4KB), `response_status` (number), `duration_ms` (number), `actor` (string, nullable -- API key identifier or agent ID), `metadata` (Object, default: `{}`), `request_id` (string, nullable -- from `RequestIdInterceptor`).
  - TTL index on `timestamp` with `expireAfterSeconds: 90 * 24 * 60 * 60` (90 days).
  - Compound indexes: `{ workspace_id: 1, timestamp: -1 }`, `{ project_number: 1, timestamp: -1 }`, `{ operation_type: 1, timestamp: -1 }`.
  - Collection name: `audit_history`.
- **Failure modes:** If MongoDB is unavailable at startup, the schema registration fails and the app will not boot (same behavior as existing schemas). No special handling needed -- existing health checks cover this.

**Acceptance Criteria**

- AC-1.1.a: When the API starts, a `audit_history` collection exists in the `stoked-projects` database with the defined indexes.
- AC-1.1.b: The TTL index automatically removes documents older than 90 days (verified via index inspection).
- AC-1.1.c: All schema fields are defined as specified, with `workspace_id`, `worktree_path`, `project_number`, `task_id`, `session_id`, and `actor` nullable.
- AC-1.1.d: The schema exports `AuditHistory`, `AuditHistoryDocument`, and `AuditHistorySchema` from `packages/api/src/schemas/audit-history.schema.ts`.

**Acceptance Tests**

- Test-1.1.a: Unit test -- import the schema, create a model instance with all fields populated, validate it passes Mongoose validation. Create a model instance with only required fields (audit_id, timestamp, api_endpoint, http_method, response_status, duration_ms), validate it passes.
- Test-1.1.b: Unit test -- create a model instance with `workspace_id` set to `null`, validate it passes. Create one with `project_number` set to `null`, validate it passes.
- Test-1.1.c: Integration test -- connect to test MongoDB, insert an audit record, verify it can be queried by `audit_id`, `workspace_id`, and `project_number`.
- Test-1.1.d: Integration test -- verify the TTL index exists on the `timestamp` field with `expireAfterSeconds` of `7776000` (90 days).

---

### 1.2 Create Audit History NestJS Module

Create the `AuditHistoryModule` that registers the schema, provides the `AuditHistoryService` for writing and querying records, and exports the service for use by the interceptor and controller.

**Implementation Details**

- **Systems affected:** `packages/api/src/modules/audit-history/` (new directory: `audit-history.module.ts`, `audit-history.service.ts`)
- **Inputs / outputs:** The service exposes `writeAuditRecord(data)` (async, fire-and-forget), `findByWorkspace(workspaceId, options)`, `findByProject(projectNumber, options)`, `findById(auditId)`, `findAll(options)`.
- **Core logic:**
  - `AuditHistoryService` injects the `AuditHistory` Mongoose model and `AppLoggerService`.
  - `writeAuditRecord(data)`: Generates a UUID for `audit_id`, writes to MongoDB. This method does NOT await the write; it fires and catches errors internally, logging failures via `AppLoggerService`. Returns `void`.
  - Query methods accept pagination (`limit`, `offset`), time range (`startTime`, `endTime`), and sorting (`sort: 'asc' | 'desc'`, default `desc`).
  - `findByWorkspace` also accepts optional `operationType` filter.
  - `findByProject` also accepts optional `operationType` and `workspaceId` filters.
  - Internal retry buffer: If a write fails, store the record in an in-memory array (max 100 entries). On the next successful write, flush the buffer. This prevents silent data loss during transient MongoDB issues.
- **Failure modes:** Write failures logged via `AppLoggerService` but never thrown. Buffer overflow (>100 entries) drops oldest entries. Query failures throw standard NestJS exceptions (the caller handles).
- **Module registration:** `AuditHistoryModule` imports `MongooseModule.forFeature([{ name: AuditHistory.name, schema: AuditHistorySchema }])` and `LoggingModule`. Exports `AuditHistoryService`.

**Acceptance Criteria**

- AC-1.2.a: `AuditHistoryService.writeAuditRecord()` writes a document to the `audit_history` collection without blocking the caller.
- AC-1.2.b: If MongoDB write fails, the record is buffered in memory (up to 100 entries) and retried on the next successful write.
- AC-1.2.c: `findByWorkspace(workspaceId)` returns audit records filtered by `workspace_id`, sorted by `timestamp` descending, with pagination.
- AC-1.2.d: `findByProject(projectNumber)` returns audit records filtered by `project_number`, sorted by `timestamp` descending, with pagination.
- AC-1.2.e: `findAll()` returns paginated audit records with optional filters for `operationType`, `workspaceId`, `projectNumber`, and time range.

**Acceptance Tests**

- Test-1.2.a: Unit test -- mock the Mongoose model, call `writeAuditRecord()`, verify `.create()` is called with correct data and the method returns immediately (does not await).
- Test-1.2.b: Unit test -- simulate a MongoDB write failure, verify the record is buffered. Simulate a subsequent successful write, verify the buffer is flushed.
- Test-1.2.c: Unit test -- call `findByWorkspace('ws-1', { limit: 10, offset: 0 })`, verify the Mongoose query applies `{ workspace_id: 'ws-1' }` filter, `.sort({ timestamp: -1 })`, `.limit(10)`, `.skip(0)`.
- Test-1.2.d: Integration test -- insert 5 audit records with different workspace IDs, query by a specific workspace ID, verify only matching records are returned in descending timestamp order.
- Test-1.2.e: Integration test -- insert 15 audit records, query with `limit: 5, offset: 5`, verify exactly 5 records returned starting from the 6th most recent.

---

### 1.3 Implement Global Audit Interceptor

Create a NestJS interceptor that hooks into every HTTP request and writes an audit record for state-changing operations (POST, PUT, PATCH, DELETE). Applied globally alongside the existing `LoggingInterceptor`.

**Implementation Details**

- **Systems affected:** `packages/api/src/common/interceptors/audit.interceptor.ts` (new file), `packages/api/src/app.module.ts` (register as `APP_INTERCEPTOR`)
- **Inputs / outputs:** Input is the HTTP request context (method, URL, body, headers). Output is the unchanged response (interceptor is transparent). Side effect: writes an audit record asynchronously.
- **Core logic:**
  - Implements `NestInterceptor`. In `intercept()`:
    1. Extract `method`, `url`, `body`, and headers (`X-Workspace-Id`, `X-Worktree-Path`, `X-API-Key` or `Authorization`) from the request.
    2. If `method` is GET or OPTIONS, pass through without auditing.
    3. Record `startTime = Date.now()`.
    4. Extract `request_id` from `request[REQUEST_ID_KEY]` (set by `RequestIdInterceptor`).
    5. In the `tap()` operator (both `next` and `error` callbacks), compute `duration_ms`, determine `response_status`, and call `AuditHistoryService.writeAuditRecord()`.
    6. Derive `operation_type` from the URL pattern (e.g., `/api/tasks/:id/start` maps to `task.started`, `/api/events/project` maps to `project.event`, `/api/sessions` POST maps to `session.created`). Use a static mapping table with a fallback of `{method}.{path_segment}`.
    7. Derive `project_number` from the request body if present (e.g., `body.data?.projectNumber` for project events, or URL path parameter for project-scoped endpoints).
    8. Sanitize `request_summary`: include only the first 4KB of the JSON-stringified body, redacting fields named `password`, `token`, `secret`, `apiKey`, `authorization`.
  - Register in `app.module.ts` as `APP_INTERCEPTOR` after `LoggingInterceptor` (order: RequestId, Logging, Audit, CacheHeaders).
  - The interceptor depends on `AuditHistoryService`, so it must be provided via a module import. Use `@Injectable()` with constructor injection and register via `APP_INTERCEPTOR` with `useClass`.
- **Failure modes:** If `AuditHistoryService.writeAuditRecord()` fails (should not, since it catches internally), the interceptor catches any unexpected error and logs it. The API response is never affected.

**Acceptance Criteria**

- AC-1.3.a: Every POST, PUT, PATCH, DELETE request to the API results in an audit record written to the `audit_history` collection.
- AC-1.3.b: GET and OPTIONS requests do NOT produce audit records.
- AC-1.3.c: The audit record includes `workspace_id` and `worktree_path` extracted from `X-Workspace-Id` and `X-Worktree-Path` request headers.
- AC-1.3.d: If the workspace/worktree headers are missing, the audit record stores `null` for those fields (no error thrown).
- AC-1.3.e: The API response time increases by less than 50ms (p99) due to the audit interceptor.
- AC-1.3.f: The `request_summary` field redacts sensitive fields (`password`, `token`, `secret`, `apiKey`, `authorization`) and is truncated to 4KB.
- AC-1.3.g: The `operation_type` field is derived from the URL pattern and HTTP method, providing a human-readable identifier (e.g., `task.started`, `session.created`, `issue.updated`).

**Acceptance Tests**

- Test-1.3.a: Unit test -- mock `AuditHistoryService`, send a POST request through the interceptor, verify `writeAuditRecord()` is called with the correct `api_endpoint`, `http_method`, `response_status`, and `duration_ms`.
- Test-1.3.b: Unit test -- send a GET request through the interceptor, verify `writeAuditRecord()` is NOT called.
- Test-1.3.c: Unit test -- send a POST request with `X-Workspace-Id: ws-123` and `X-Worktree-Path: /tmp/worktree`, verify the audit record includes `workspace_id: 'ws-123'` and `worktree_path: '/tmp/worktree'`.
- Test-1.3.d: Unit test -- send a POST request without workspace headers, verify the audit record includes `workspace_id: null` and `worktree_path: null`.
- Test-1.3.e: Unit test -- send a POST request with a body containing `{ token: 'secret123', data: { name: 'test' } }`, verify the `request_summary` has `token` redacted.
- Test-1.3.f: Integration test -- start the API, send a POST to `/api/tasks`, verify an audit record appears in the `audit_history` collection with all expected fields.
- Test-1.3.g: Integration test -- send a POST to `/api/events/project` with `{ type: 'issue.updated', data: { projectNumber: 42 } }`, verify the audit record has `operation_type: 'project.event'` and `project_number: 42`.

---

### 1.4 Create Audit History REST Endpoints

Expose REST API endpoints for querying the audit history. These endpoints support paginated queries with filters for workspace, project, time range, and operation type.

**Implementation Details**

- **Systems affected:** `packages/api/src/modules/audit-history/audit-history.controller.ts` (new file), `packages/api/src/modules/audit-history/dto/` (new DTOs)
- **Inputs / outputs:**
  - `GET /api/audit-history` -- Query params: `workspaceId?`, `projectNumber?`, `operationType?`, `startTime?`, `endTime?`, `limit?` (default 50, max 200), `offset?` (default 0). Returns: `{ items: AuditHistoryEntry[], total: number, limit: number, offset: number }`.
  - `GET /api/audit-history/:auditId` -- Path param: `auditId`. Returns: single `AuditHistoryEntry` or 404.
  - `GET /api/audit-history/workspace/:workspaceId` -- Path param: `workspaceId`. Query params: `operationType?`, `startTime?`, `endTime?`, `limit?`, `offset?`. Returns: paginated list.
  - `GET /api/audit-history/project/:projectNumber` -- Path param: `projectNumber` (ParseIntPipe). Query params: `workspaceId?`, `operationType?`, `startTime?`, `endTime?`, `limit?`, `offset?`. Returns: paginated list.
- **Core logic:**
  - Controller uses `@Controller('api/audit-history')` decorator.
  - All endpoints delegate to `AuditHistoryService` methods.
  - DTOs validate query parameters using `class-validator` decorators (IsOptional, IsString, IsInt, Min, Max, IsDateString).
  - `limit` is capped at 200 to prevent excessive result sets.
- **Failure modes:** Invalid query parameters return 400 (handled by NestJS validation pipe). Non-existent `auditId` returns 404 via `NotFoundException`.

**Acceptance Criteria**

- AC-1.4.a: `GET /api/audit-history` returns a paginated list of audit records with `items`, `total`, `limit`, `offset` fields.
- AC-1.4.b: `GET /api/audit-history/:auditId` returns a single audit record by its `audit_id`, or 404 if not found.
- AC-1.4.c: `GET /api/audit-history/workspace/:workspaceId` returns audit records filtered by workspace, sorted by timestamp descending.
- AC-1.4.d: `GET /api/audit-history/project/:projectNumber` returns audit records filtered by project number, sorted by timestamp descending.
- AC-1.4.e: The `limit` parameter is capped at 200. Requests with `limit > 200` are silently clamped to 200.
- AC-1.4.f: Time range filters (`startTime`, `endTime`) correctly constrain the `timestamp` field using `$gte` and `$lte`.

**Acceptance Tests**

- Test-1.4.a: Integration test -- insert 10 audit records, call `GET /api/audit-history?limit=5`, verify response has 5 items, `total: 10`, `limit: 5`, `offset: 0`.
- Test-1.4.b: Integration test -- insert an audit record with known `audit_id`, call `GET /api/audit-history/:auditId`, verify all fields are returned correctly. Call with a non-existent ID, verify 404 response.
- Test-1.4.c: Integration test -- insert audit records for two different workspaces, call `GET /api/audit-history/workspace/ws-1`, verify only `ws-1` records are returned.
- Test-1.4.d: Integration test -- insert audit records for projects 42 and 99, call `GET /api/audit-history/project/42`, verify only project 42 records are returned.
- Test-1.4.e: Unit test -- send request with `limit=500`, verify the controller clamps to 200.
- Test-1.4.f: Integration test -- insert records spanning multiple days, query with `startTime` and `endTime` covering a single day, verify only records within that day are returned.

---

### 1.5 Register Audit History Module in App Module

Wire the `AuditHistoryModule` into the application root module and ensure the audit interceptor has access to the `AuditHistoryService`.

**Implementation Details**

- **Systems affected:** `packages/api/src/app.module.ts` (import `AuditHistoryModule`, register `AuditInterceptor` as `APP_INTERCEPTOR`)
- **Inputs / outputs:** No new inputs/outputs; this is a wiring task.
- **Core logic:**
  - Import `AuditHistoryModule` in the `imports` array of `AppModule`.
  - Register `AuditInterceptor` as an `APP_INTERCEPTOR` provider. Place it after `LoggingInterceptor` in the providers array: RequestId, Logging, Audit, CacheHeaders.
  - The `AuditInterceptor` needs `AuditHistoryService` injected, which is exported from `AuditHistoryModule`. Since `AuditHistoryModule` is imported into `AppModule`, the service is available for injection into global providers.
- **Failure modes:** If `AuditHistoryModule` is not imported, the interceptor will fail to resolve `AuditHistoryService` at boot time, crashing the app. This is caught by the integration test.

**Acceptance Criteria**

- AC-1.5.a: The API boots successfully with `AuditHistoryModule` imported and `AuditInterceptor` registered globally.
- AC-1.5.b: The interceptor executes after `LoggingInterceptor` and before `CacheHeadersInterceptor` in the request pipeline.
- AC-1.5.c: The audit history REST endpoints are accessible at `/api/audit-history/*`.

**Acceptance Tests**

- Test-1.5.a: Integration test -- boot the NestJS application, verify it starts without errors and the health endpoint responds.
- Test-1.5.b: Integration test -- send a POST request to any existing endpoint (e.g., `/api/tasks`), verify an audit record is created in the `audit_history` collection.
- Test-1.5.c: Integration test -- call `GET /api/audit-history`, verify it responds with 200 and the expected paginated structure.

---

## Phase 2: Orchestrator Instrumentation

This phase adds new event types for task and phase lifecycle, instruments the `/project-start` orchestrator to emit progress events at each lifecycle transition, and updates the MCP server to forward workspace context.

### 2.1 Extend Project Event Types

Add new event types to the `ProjectEventType` union and define corresponding data interfaces for task and phase lifecycle events.

**Implementation Details**

- **Systems affected:** `packages/api/src/modules/project-events/project-event.types.ts`
- **Inputs / outputs:** New union members and interfaces added to the existing type definitions file.
- **Core logic:**
  - Add to `ProjectEventType` union: `'task.started'`, `'task.completed'`, `'task.failed'`, `'phase.started'`, `'phase.completed'`, `'orchestration.progress'`.
  - New interfaces:
    - `TaskStartedData`: `{ projectNumber: number; phaseNumber: number; workItemId: string; workItemTitle: string; agentId?: string; workspaceId?: string; worktreePath?: string; }`.
    - `TaskCompletedData`: `{ projectNumber: number; phaseNumber: number; workItemId: string; workItemTitle: string; agentId?: string; result?: string; filesChanged?: string[]; workspaceId?: string; worktreePath?: string; }`.
    - `TaskFailedData`: `{ projectNumber: number; phaseNumber: number; workItemId: string; workItemTitle: string; agentId?: string; error: string; workspaceId?: string; worktreePath?: string; }`.
    - `PhaseStartedData`: `{ projectNumber: number; phaseNumber: number; phaseName: string; totalItems: number; workspaceId?: string; }`.
    - `PhaseCompletedData`: `{ projectNumber: number; phaseNumber: number; phaseName: string; completedItems: number; totalItems: number; workspaceId?: string; }`.
    - `OrchestrationProgressData`: `{ projectNumber: number; totalPhases: number; completedPhases: number; totalItems: number; completedItems: number; inProgressItems: number; failedItems: number; workspaceId?: string; }`.
  - Update `ProjectEventData` union to include all new interfaces.
  - Ensure `ProjectEvent` interface remains unchanged (it already accepts any `ProjectEventType`).
- **Failure modes:** None -- this is a type-only change. Invalid event types sent to the API will be handled by the validation in work item 2.2.

**Acceptance Criteria**

- AC-2.1.a: The `ProjectEventType` union includes `task.started`, `task.completed`, `task.failed`, `phase.started`, `phase.completed`, `orchestration.progress`.
- AC-2.1.b: Each new event type has a corresponding TypeScript interface with the fields listed above.
- AC-2.1.c: The `ProjectEventData` union includes all new interfaces.
- AC-2.1.d: Existing event types (`issue.created`, `issue.updated`, etc.) are unchanged and continue to compile.

**Acceptance Tests**

- Test-2.1.a: Unit test (compile-time) -- create a `ProjectEvent` object with `type: 'task.started'` and `data` conforming to `TaskStartedData`, verify TypeScript compiles without errors.
- Test-2.1.b: Unit test (compile-time) -- create a `ProjectEvent` object with `type: 'issue.created'` (existing type), verify TypeScript still compiles without errors.
- Test-2.1.c: Unit test -- verify that all new event type string literals are members of the `ProjectEventType` type via a runtime assertion against a known list.

---

### 2.2 Add Server-Side Event Validation

Enhance the `ProjectEventsController` to validate incoming events against the known event types and log/drop invalid ones gracefully. Also add an audit history write for every project event received.

**Implementation Details**

- **Systems affected:** `packages/api/src/modules/project-events/project-events.controller.ts`, `packages/api/src/modules/project-events/project-events.module.ts`
- **Inputs / outputs:** Input is the existing `POST /api/events/project` body. Output is unchanged (202 Accepted). Side effect: validation logging and audit record writing.
- **Core logic:**
  - Import the `ProjectEventType` values as a runtime constant array for validation.
  - In `handleProjectEvent()`, validate `event.type` against the known event types. If unknown, log a warning and return `{ accepted: false, error: 'Unknown event type' }` with 400 status.
  - After broadcasting the event, write an audit record via `AuditHistoryService.writeAuditRecord()` with `operation_type: event.type`, `project_number: projectNumber`, and workspace/worktree context extracted from the event data (the new event types include `workspaceId` and `worktreePath` fields).
  - Import `AuditHistoryModule` into `ProjectEventsModule`.
- **Failure modes:** Invalid event types return 400. Audit write failures are fire-and-forget (logged, not thrown). Broadcast failures are already handled by the gateway.

**Acceptance Criteria**

- AC-2.2.a: Events with valid `ProjectEventType` values are accepted (202) and broadcast.
- AC-2.2.b: Events with unknown `type` values are rejected with 400 and a descriptive error message.
- AC-2.2.c: Every accepted project event produces an audit record in the `audit_history` collection with `operation_type` set to the event type.
- AC-2.2.d: Workspace and worktree context from the event data is included in the audit record when present.

**Acceptance Tests**

- Test-2.2.a: Integration test -- POST a `task.started` event to `/api/events/project`, verify 202 response and event is broadcast via Socket.io.
- Test-2.2.b: Integration test -- POST an event with `type: 'invalid.type'`, verify 400 response with error message.
- Test-2.2.c: Integration test -- POST a `task.completed` event, verify an audit record exists in `audit_history` with `operation_type: 'task.completed'`.
- Test-2.2.d: Integration test -- POST a `phase.completed` event with `workspaceId: 'ws-1'`, verify the audit record has `workspace_id: 'ws-1'`.

---

### 2.3 Update MCP Server API Client with Workspace Context

Enhance the MCP server's `APIClient` to accept and forward workspace and worktree context on every API request via custom headers.

**Implementation Details**

- **Systems affected:** `packages/mcp-server/src/api-client.ts`
- **Inputs / outputs:** The `APIClient` constructor accepts optional `workspaceId` and `worktreePath` in the config. The `postProjectEvent` method accepts optional `workspaceId` and `worktreePath` in the event data.
- **Core logic:**
  - Add `workspaceId?: string` and `worktreePath?: string` to `APIClientConfig`.
  - In the `request()` method, add `X-Workspace-Id` and `X-Worktree-Path` headers if the config values are set. Read from config first, then fall back to environment variables `WORKSPACE_ID` and `WORKTREE_PATH`.
  - Update `postProjectEvent()` to merge `workspaceId` and `worktreePath` into the event `data` object if they are set in the config or the event data does not already contain them.
  - Ensure the headers are included in the `sanitizeHeaders()` output (they are not sensitive, no redaction needed).
- **Failure modes:** If the environment variables are not set and config values are not provided, the headers are simply omitted. The API accepts requests without these headers (backward compatible).

**Acceptance Criteria**

- AC-2.3.a: When `WORKSPACE_ID` and `WORKTREE_PATH` environment variables are set, every MCP server API request includes `X-Workspace-Id` and `X-Worktree-Path` headers.
- AC-2.3.b: When the environment variables are not set and config values are not provided, the headers are omitted (no error).
- AC-2.3.c: `postProjectEvent()` includes `workspaceId` and `worktreePath` in the event data when available.
- AC-2.3.d: Config values take precedence over environment variables for `workspaceId` and `worktreePath`.

**Acceptance Tests**

- Test-2.3.a: Unit test -- create `APIClient` with `{ workspaceId: 'ws-1', worktreePath: '/tmp/wt' }` in config, mock fetch, call `post()`, verify request includes `X-Workspace-Id: ws-1` and `X-Worktree-Path: /tmp/wt` headers.
- Test-2.3.b: Unit test -- create `APIClient` without workspace config and without environment variables, mock fetch, call `post()`, verify request does NOT include `X-Workspace-Id` or `X-Worktree-Path` headers.
- Test-2.3.c: Unit test -- call `postProjectEvent({ type: 'task.started', data: { projectNumber: 42 } })` with `workspaceId: 'ws-1'` in config, verify the POST body includes `data.workspaceId: 'ws-1'`.
- Test-2.3.d: Unit test -- create `APIClient` with config `workspaceId: 'config-ws'` and set `process.env.WORKSPACE_ID = 'env-ws'`, verify the header value is `config-ws` (config takes precedence).

---

### 2.4 Instrument Orchestrator Prompt for Event Emission

Update the `/project-start` command template (`apps/code-ext/commands/project-start.md`) to instruct the orchestrator to call `POST /api/events/project` at each task lifecycle transition point, emitting the new event types.

**Implementation Details**

- **Systems affected:** `apps/code-ext/commands/project-start.md`
- **Inputs / outputs:** The prompt template is modified to include instructions for event emission. No code changes; this is a prompt engineering change that instructs the orchestrator LLM.
- **Core logic:**
  - Add a new section `## REAL-TIME PROGRESS EVENTS` to the orchestrator prompt.
  - Instruct the orchestrator to call `POST /api/events/project` (via MCP `postProjectEvent` tool or direct HTTP) at these points:
    1. **Phase start:** Emit `phase.started` with `projectNumber`, `phaseNumber`, `phaseName`, `totalItems`.
    2. **Work item start (before spawning subagent):** Emit `task.started` with `projectNumber`, `phaseNumber`, `workItemId`, `workItemTitle`.
    3. **Work item completion (after validation passes):** Emit `task.completed` with `projectNumber`, `phaseNumber`, `workItemId`, `workItemTitle`, `filesChanged`.
    4. **Work item failure (after validation fails):** Emit `task.failed` with `projectNumber`, `phaseNumber`, `workItemId`, `workItemTitle`, `error`.
    5. **Phase completion:** Emit `phase.completed` with `projectNumber`, `phaseNumber`, `phaseName`, `completedItems`, `totalItems`.
    6. **Periodic progress (after each item completes):** Emit `orchestration.progress` with overall stats.
  - Provide curl examples in the prompt for each event type so the orchestrator knows the exact API call format.
  - Include a note that event emission is fire-and-forget: if the API is unreachable, the orchestrator should log a warning and continue.
- **Failure modes:** If the orchestrator fails to emit events (API down, prompt misunderstood), the orchestration continues normally. Events are optional enhancements, not gates.

**Acceptance Criteria**

- AC-2.4.a: The orchestrator prompt includes a `## REAL-TIME PROGRESS EVENTS` section with instructions for emitting events at phase start, task start, task completion, task failure, phase completion, and periodic progress.
- AC-2.4.b: Each event instruction includes a curl example with the correct event type, data fields, and endpoint.
- AC-2.4.c: The prompt explicitly instructs the orchestrator that event emission is fire-and-forget and should not block orchestration.
- AC-2.4.d: The prompt instructs the orchestrator to include `workspaceId` and `worktreePath` in event data when available (from the worktree setup step).

**Acceptance Tests**

- Test-2.4.a: Manual review -- read the updated `project-start.md`, verify the `## REAL-TIME PROGRESS EVENTS` section exists with all 6 event types documented.
- Test-2.4.b: Manual review -- verify each curl example is syntactically correct and targets `POST /api/events/project` with the expected JSON body structure.
- Test-2.4.c: Manual review -- verify the prompt explicitly states event emission is non-blocking and failure-tolerant.
- Test-2.4.d: Integration test (end-to-end) -- run the orchestrator against a test project, verify at least `phase.started`, `task.started`, and `task.completed` events appear in the `audit_history` collection.

---

## Phase 3: Real-Time Extension Integration

This phase connects the extension's WebSocket client to the new task history events, updates the Task History webview to display live entries, and wires the components together.

### 3.1 Extend OrchestrationWebSocketClient for Task History Events

Add a dedicated event handler and handler registration method for task history events on the extension's WebSocket client.

**Implementation Details**

- **Systems affected:** `apps/code-ext/src/orchestration-websocket-client.ts`
- **Inputs / outputs:** New handler type `TaskHistoryEventHandler` that receives task lifecycle events. New registration methods `onTaskHistoryEvent()` and `offTaskHistoryEvent()`.
- **Core logic:**
  - Define a `TaskHistoryEvent` interface: `{ type: 'task.started' | 'task.completed' | 'task.failed' | 'phase.started' | 'phase.completed' | 'orchestration.progress'; data: Record<string, any>; timestamp?: string; }`.
  - Add `private taskHistoryHandlers: TaskHistoryEventHandler[] = []` member.
  - In the existing `handleProjectEvent()` method, check if `event.type` starts with `task.` or `phase.` or equals `orchestration.progress`. If so, route the event to `taskHistoryHandlers` in addition to (not instead of) `projectEventHandlers`.
  - Add `onTaskHistoryEvent(handler)`, `offTaskHistoryEvent(handler)` methods mirroring the existing pattern.
  - In `disconnect()`, clear `taskHistoryHandlers`.
- **Failure modes:** Handler errors are caught and logged to the output channel (same pattern as existing `handleProjectEvent`). A failing handler does not prevent other handlers from executing.

**Acceptance Criteria**

- AC-3.1.a: Task lifecycle events (`task.started`, `task.completed`, `task.failed`, `phase.started`, `phase.completed`, `orchestration.progress`) received via `project.event` are routed to registered `taskHistoryHandlers`.
- AC-3.1.b: Existing `projectEventHandlers` continue to receive ALL events (including the new task lifecycle events) -- no regression.
- AC-3.1.c: `onTaskHistoryEvent()` and `offTaskHistoryEvent()` methods correctly add and remove handlers.
- AC-3.1.d: Handler errors are caught and logged, not propagated.

**Acceptance Tests**

- Test-3.1.a: Unit test -- register a task history handler, simulate a `project.event` with `type: 'task.completed'`, verify the handler is called with the event data.
- Test-3.1.b: Unit test -- register both a project event handler and a task history handler, simulate a `project.event` with `type: 'task.started'`, verify BOTH handlers are called.
- Test-3.1.c: Unit test -- register a task history handler, simulate a `project.event` with `type: 'issue.created'` (existing type), verify the task history handler is NOT called (only project event handlers are called).
- Test-3.1.d: Unit test -- register a task history handler that throws an error, simulate a `task.completed` event, verify the error is caught and logged.

---

### 3.2 Update TaskHistoryViewProvider for Live WebSocket Updates

Enhance the `TaskHistoryViewProvider` to accept real-time events from the WebSocket client and render them in the webview without requiring a manual refresh.

**Implementation Details**

- **Systems affected:** `apps/code-ext/src/task-history-view-provider.ts`
- **Inputs / outputs:** Input: task history events via a new `handleLiveEvent(event)` public method. Output: `postMessage` to the webview with new entries.
- **Core logic:**
  - Add a public method `handleLiveEvent(event: TaskHistoryEvent)` that transforms the event into an `AuditHistoryEntry` display object and sends it to the webview via `postMessage({ type: 'liveEntry', entry })`.
  - Maintain an in-memory array `liveEntries` (max 500 entries) to track entries received since the last full refresh.
  - On `resolveWebviewView`, register a task history handler with the WebSocket client (passed via constructor or setter).
  - Add a new message type `fetchHistory` from the webview that triggers an API call to `GET /api/audit-history/workspace/:workspaceId` to load historical entries on initial view load.
  - Update the constructor to accept an optional `apiBaseUrl` and `workspaceId` for fetching historical data.
  - Add a `setWebSocketClient(client: OrchestrationWebSocketClient)` method for late binding (since the WS client may not be available at construction time).
- **Failure modes:** If the webview is not visible (e.g., user hasn't opened the panel), events are buffered in `liveEntries`. When the webview becomes visible, the buffer is flushed. If the buffer exceeds 500 entries, the oldest entries are dropped.

**Acceptance Criteria**

- AC-3.2.a: When a `task.started` event is received via WebSocket, a new entry appears in the Task History webview within 3 seconds.
- AC-3.2.b: When a `task.completed` event is received, the corresponding entry in the webview updates its status indicator (from in-progress spinner to completed checkmark).
- AC-3.2.c: When the webview is first opened, it fetches recent history from the API endpoint `GET /api/audit-history/workspace/:workspaceId` and renders it.
- AC-3.2.d: The in-memory live entry buffer is capped at 500 entries.
- AC-3.2.e: Events received while the webview is hidden are buffered and flushed when the webview becomes visible.

**Acceptance Tests**

- Test-3.2.a: Unit test -- call `handleLiveEvent({ type: 'task.started', data: { projectNumber: 42, workItemId: '1.1', workItemTitle: 'Create schema' } })`, verify `postMessage` is called with `{ type: 'liveEntry', entry: { ... } }`.
- Test-3.2.b: Unit test -- add 501 entries via `handleLiveEvent()`, verify only 500 are retained in the buffer.
- Test-3.2.c: Unit test -- simulate webview not resolved (no `_view`), call `handleLiveEvent()` 3 times, then resolve the webview, verify all 3 buffered entries are flushed to the webview.
- Test-3.2.d: Integration test -- with a running API and WebSocket connection, emit a `task.completed` event via `POST /api/events/project`, verify the webview receives a `liveEntry` message.

---

### 3.3 Enhance Task History Webview HTML with Live Rendering

Update the inline HTML/JS in the Task History webview to support live entry insertion, status animations, project/phase grouping, and filter controls.

**Implementation Details**

- **Systems affected:** `apps/code-ext/src/task-history-view-provider.ts` (the `_getHtmlForWebview()` method)
- **Inputs / outputs:** Input: `postMessage` events (`historyData`, `liveEntry`). Output: DOM updates in the webview.
- **Core logic:**
  - **Live entry insertion:** Handle `message.type === 'liveEntry'` by creating a new DOM element and prepending it to the history list with a CSS highlight animation (fade-in from a highlight color over 2 seconds).
  - **Status indicators:** Render status badges with icons: `task.started` shows a spinning CSS animation (pulsing dot), `task.completed` shows a green checkmark, `task.failed` shows a red X, `phase.started` shows a blue arrow, `phase.completed` shows a blue checkmark.
  - **Entry grouping:** Group entries by `projectNumber` and then by `phaseNumber`. Each project gets a collapsible section header. Each phase gets a sub-header within the project section.
  - **Filter controls:** Add a filter bar above the entry list with:
    - Project dropdown (populated from unique project numbers in the data).
    - Phase dropdown (filtered by selected project).
    - Status checkboxes (started, completed, failed, all).
    - Time range buttons (Last 1 hour, Last 24 hours, All).
  - **Entry format:** Each entry displays: `[timestamp] [status icon] [operation type] [work item title] [phase N.X] [duration if completed]`.
  - **Update existing entries:** When a `task.completed` or `task.failed` event arrives, find the existing `task.started` entry for the same `workItemId` and update its status indicator in-place rather than creating a duplicate. Use a `data-work-item-id` attribute on DOM elements for lookup.
  - **Orchestration progress bar:** When an `orchestration.progress` event arrives, update a progress bar at the top of the view showing `completedItems / totalItems` with a percentage.
- **Failure modes:** If an event references a `workItemId` that has no existing DOM entry (e.g., the `task.started` event was missed), create a new entry. This handles out-of-order delivery gracefully.

**Acceptance Criteria**

- AC-3.3.a: New entries appear at the top of the list with a highlight animation that fades over 2 seconds.
- AC-3.3.b: Each entry displays a status icon (spinner for started, checkmark for completed, X for failed).
- AC-3.3.c: Entries are grouped by project number and phase number, with collapsible section headers.
- AC-3.3.d: Filter controls allow filtering by project, phase, status, and time range.
- AC-3.3.e: When a `task.completed` event arrives for an existing `task.started` entry, the status icon updates in-place (no duplicate entry created).
- AC-3.3.f: An orchestration progress bar at the top shows `completedItems / totalItems` and updates in real time.
- AC-3.3.g: Entries received out of order (e.g., `task.completed` before `task.started`) are handled gracefully by creating a new entry.

**Acceptance Tests**

- Test-3.3.a: Manual test -- open the Task History webview, emit a `task.started` event, verify a new entry appears with a spinning status indicator and a highlight animation.
- Test-3.3.b: Manual test -- after a `task.started` entry is visible, emit a `task.completed` event for the same `workItemId`, verify the spinner changes to a green checkmark (no new entry created).
- Test-3.3.c: Manual test -- emit events for two different projects, verify entries are grouped under separate project headers.
- Test-3.3.d: Manual test -- use the project dropdown filter to select a single project, verify only that project's entries are visible.
- Test-3.3.e: Manual test -- emit an `orchestration.progress` event with `completedItems: 3, totalItems: 10`, verify the progress bar shows 30%.

---

### 3.4 Wire Task History Components in Extension Entry Point

Connect the `TaskHistoryViewProvider`, `OrchestrationWebSocketClient`, and `APIClient` in the extension's `extension.ts` to enable live task history updates.

**Implementation Details**

- **Systems affected:** `apps/code-ext/src/extension.ts`
- **Inputs / outputs:** No new user-facing commands; this is internal wiring.
- **Core logic:**
  - After the `OrchestrationWebSocketClient` is created and connected, pass it to `TaskHistoryViewProvider` via `setWebSocketClient()`.
  - Register a task history event handler on the WebSocket client that calls `taskHistoryProvider.handleLiveEvent(event)`.
  - Pass the `workspaceId` (already computed in extension.ts for orchestration subscriptions) and `apiBaseUrl` (from settings) to the `TaskHistoryViewProvider`.
  - Ensure the handler is unregistered when the extension is deactivated (add to disposables).
  - Add the workspace ID to the extension's API client headers for all requests (so audit records capture workspace context from extension-initiated API calls).
- **Failure modes:** If the WebSocket client is not connected (e.g., API is down), the Task History view falls back to the local `TaskHistoryManager` data (existing behavior). When the WebSocket reconnects, live updates resume.

**Acceptance Criteria**

- AC-3.4.a: When the extension activates and the WebSocket connects, the Task History view receives live events.
- AC-3.4.b: When the extension deactivates, the task history event handler is unregistered from the WebSocket client.
- AC-3.4.c: If the WebSocket is not connected, the Task History view still works using local `TaskHistoryManager` data (graceful degradation).
- AC-3.4.d: All API requests from the extension include `X-Workspace-Id` header with the current workspace ID.

**Acceptance Tests**

- Test-3.4.a: Integration test -- activate the extension with a running API, emit a task event, verify the Task History view receives it.
- Test-3.4.b: Unit test -- mock the WebSocket client, activate the extension, verify `onTaskHistoryEvent()` is called with a handler.
- Test-3.4.c: Unit test -- deactivate the extension, verify `offTaskHistoryEvent()` is called.
- Test-3.4.d: Unit test -- verify the extension's API client includes `X-Workspace-Id` header in requests.

---

## Phase 4: Polish & Production Readiness

This phase adds workspace-scoped filtering, configurable retention, comprehensive error handling, performance optimization, and end-to-end testing.

### 4.1 Implement Workspace-Scoped Event Filtering

Ensure the Task History view only shows events relevant to the current workspace. Events from other workspaces or global events without workspace context are filtered out.

**Implementation Details**

- **Systems affected:** `apps/code-ext/src/task-history-view-provider.ts` (filtering logic), `apps/code-ext/src/orchestration-websocket-client.ts` (optional server-side filtering)
- **Inputs / outputs:** Input: all task history events from WebSocket. Output: only events matching the current workspace ID are rendered.
- **Core logic:**
  - In `handleLiveEvent()`, check if `event.data.workspaceId` matches the provider's `workspaceId`. If it does, render the event. If it does not and `event.data.workspaceId` is present, skip it. If `event.data.workspaceId` is absent, render it (assume it is relevant to the local workspace -- this handles backward compatibility).
  - For worktree correlation: if `event.data.worktreePath` is set, check if it is a child of the current workspace folder path or the workspace's known worktree paths. This handles the case where the orchestrator creates a worktree (`/v3-project-N`) and events from that worktree should be visible in the original workspace.
  - On initial history fetch from the API, use `GET /api/audit-history/workspace/:workspaceId` to only retrieve workspace-scoped records.
  - Add a toggle in the filter bar: "Show all workspaces" checkbox (default unchecked). When checked, show all events regardless of workspace.
- **Failure modes:** If the workspace ID is not available (e.g., no folder open), show all events and display a notice: "Open a folder to enable workspace filtering."

**Acceptance Criteria**

- AC-4.1.a: Events with a different `workspaceId` than the current workspace are not displayed in the Task History view by default.
- AC-4.1.b: Events without a `workspaceId` are displayed (backward compatible).
- AC-4.1.c: Events from a worktree that is a child of the current workspace are displayed.
- AC-4.1.d: The "Show all workspaces" toggle disables workspace filtering when checked.
- AC-4.1.e: When no workspace folder is open, all events are shown with a notice about workspace filtering.

**Acceptance Tests**

- Test-4.1.a: Unit test -- set workspace ID to `ws-1`, call `handleLiveEvent()` with `workspaceId: 'ws-2'`, verify the event is NOT sent to the webview.
- Test-4.1.b: Unit test -- set workspace ID to `ws-1`, call `handleLiveEvent()` with `workspaceId: 'ws-1'`, verify the event IS sent to the webview.
- Test-4.1.c: Unit test -- set workspace ID to `ws-1`, call `handleLiveEvent()` with no `workspaceId` in the data, verify the event IS sent to the webview.
- Test-4.1.d: Unit test -- enable "Show all workspaces" mode, call `handleLiveEvent()` with `workspaceId: 'ws-2'`, verify the event IS sent to the webview.

---

### 4.2 Add Extension API Client Workspace Headers

Update the extension's `APIClient` (`apps/code-ext/src/api-client.ts`) to include `X-Workspace-Id` and `X-Worktree-Path` headers on every request.

**Implementation Details**

- **Systems affected:** `apps/code-ext/src/api-client.ts`
- **Inputs / outputs:** The `APIClient` accepts a `workspaceId` and `worktreePath` via a new `setWorkspaceContext(workspaceId, worktreePath)` method. All subsequent requests include these as headers.
- **Core logic:**
  - Add private members `workspaceId?: string` and `worktreePath?: string`.
  - Add public method `setWorkspaceContext(workspaceId: string, worktreePath?: string)` that sets both values.
  - In the `request()` method, conditionally add `X-Workspace-Id` and `X-Worktree-Path` headers if the values are set.
  - Call `setWorkspaceContext()` in `extension.ts` during activation, passing the workspace folder name (or a hash of it) as the workspace ID and the workspace folder path as the worktree path.
- **Failure modes:** If `setWorkspaceContext()` is never called, no headers are sent (backward compatible). The API interceptor handles missing headers gracefully.

**Acceptance Criteria**

- AC-4.2.a: After calling `setWorkspaceContext('ws-1', '/path/to/workspace')`, all subsequent API requests include `X-Workspace-Id: ws-1` and `X-Worktree-Path: /path/to/workspace` headers.
- AC-4.2.b: Before `setWorkspaceContext()` is called, no workspace headers are sent.
- AC-4.2.c: The workspace context is set during extension activation in `extension.ts`.

**Acceptance Tests**

- Test-4.2.a: Unit test -- create `APIClient`, call `setWorkspaceContext('ws-1', '/path')`, mock fetch, call `request()`, verify headers include `X-Workspace-Id: ws-1` and `X-Worktree-Path: /path`.
- Test-4.2.b: Unit test -- create `APIClient` without calling `setWorkspaceContext()`, mock fetch, call `request()`, verify headers do NOT include `X-Workspace-Id` or `X-Worktree-Path`.
- Test-4.2.c: Integration test -- activate the extension with a workspace folder, make an API call, verify the audit record in the API includes the workspace ID.

---

### 4.3 Add Configurable Retention Period

Make the audit history TTL configurable via the API configuration, with a default of 90 days.

**Implementation Details**

- **Systems affected:** `packages/api/src/config/configuration.ts` (add `audit.retentionDays`), `packages/api/src/schemas/audit-history.schema.ts` (dynamic TTL)
- **Inputs / outputs:** Configuration value `AUDIT_RETENTION_DAYS` environment variable (default: 90). Schema TTL index uses this value.
- **Core logic:**
  - Add `audit: { retentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS || '90', 10) }` to the configuration module.
  - The TTL index on the schema is defined statically at schema creation time. To make it configurable, define the TTL index in the `AuditHistoryModule` using `connection.collection('audit_history').createIndex()` after module initialization, reading the value from `ConfigService`. Alternatively, since MongoDB TTL indexes cannot be dynamically changed after creation without dropping and recreating, use a static default of 90 days in the schema and document that changing the retention period requires re-indexing.
  - For simplicity: use the static TTL index in the schema definition (90 days). Add a comment documenting how to change it. Add a `reindex` admin endpoint or CLI command as a future enhancement (out of scope for this PRD).
- **Failure modes:** Invalid `AUDIT_RETENTION_DAYS` values (non-numeric, negative) fall back to 90 days.

**Acceptance Criteria**

- AC-4.3.a: The default TTL index expires audit records after 90 days.
- AC-4.3.b: The `AUDIT_RETENTION_DAYS` environment variable is documented in the API configuration.
- AC-4.3.c: The configuration module reads and validates the retention period value.

**Acceptance Tests**

- Test-4.3.a: Unit test -- verify the schema's TTL index is set to `7776000` seconds (90 days).
- Test-4.3.b: Unit test -- set `AUDIT_RETENTION_DAYS=30` in environment, verify the configuration module returns `{ retentionDays: 30 }`.
- Test-4.3.c: Unit test -- set `AUDIT_RETENTION_DAYS=invalid` in environment, verify the configuration falls back to 90.

---

### 4.4 Add Reconnection Backfill Logic

When the WebSocket client reconnects after a disconnection, fetch missed audit entries from the API to backfill the Task History view.

**Implementation Details**

- **Systems affected:** `apps/code-ext/src/orchestration-websocket-client.ts` (reconnect handler), `apps/code-ext/src/task-history-view-provider.ts` (backfill method)
- **Inputs / outputs:** On reconnection, the extension calls `GET /api/audit-history/workspace/:workspaceId?startTime=:lastSeenTimestamp&limit=100` to fetch missed entries.
- **Core logic:**
  - In `OrchestrationWebSocketClient.handleConnect()`, after re-subscribing to workspace and projects, emit a custom event or call a callback to notify the extension of reconnection.
  - Add a `onReconnect(callback)` method that fires when the client reconnects (not on initial connection -- track via a `hasConnectedBefore` flag).
  - In `extension.ts`, register a reconnect handler that calls `taskHistoryProvider.backfill()`.
  - `TaskHistoryViewProvider.backfill()` calls the API with `startTime` set to the timestamp of the most recent entry in the `liveEntries` buffer. If the buffer is empty, use `Date.now() - 5 * 60 * 1000` (last 5 minutes) as a reasonable backfill window.
  - Received entries are deduplicated against existing `liveEntries` by `audit_id` before rendering.
- **Failure modes:** If the API is unreachable during backfill, log a warning and skip. The view will have a gap but will resume receiving live events.

**Acceptance Criteria**

- AC-4.4.a: After a WebSocket disconnection and reconnection, missed audit entries are fetched from the API and rendered in the Task History view.
- AC-4.4.b: Backfilled entries are deduplicated against existing entries (no duplicates in the view).
- AC-4.4.c: The backfill uses the timestamp of the most recent entry as the `startTime` parameter.
- AC-4.4.d: If the API is unreachable during backfill, the error is logged and the view continues with live updates.

**Acceptance Tests**

- Test-4.4.a: Unit test -- simulate reconnection (`hasConnectedBefore = true`), verify the reconnect callback is invoked.
- Test-4.4.b: Unit test -- mock the API response for backfill, call `backfill()`, verify new entries are added to the view and duplicates are skipped.
- Test-4.4.c: Unit test -- set `liveEntries` with latest timestamp of `T`, call `backfill()`, verify the API is called with `startTime=T`.
- Test-4.4.d: Unit test -- mock the API to throw an error, call `backfill()`, verify the error is logged and no entries are added.

---

### 4.5 End-to-End Integration Testing

Create comprehensive end-to-end tests that validate the entire audit trail pipeline: API call -> audit record written -> event broadcast via WebSocket -> extension receives event.

**Implementation Details**

- **Systems affected:** `tests/integration/` (new test file: `audit-history-e2e.test.ts`)
- **Inputs / outputs:** Tests use the running API, MongoDB, and Socket.io connection.
- **Core logic:**
  - **Test 1: Audit interceptor write.** Make a POST request to `/api/tasks` with workspace headers. Verify an audit record appears in the `audit_history` collection within 1 second.
  - **Test 2: Project event audit.** POST a `task.completed` event to `/api/events/project`. Verify the event is stored in `audit_history` with correct `operation_type` and `project_number`.
  - **Test 3: WebSocket broadcast.** Connect a Socket.io client, subscribe to a project, POST a `task.started` event, verify the client receives a `project.event` message with the correct type and data within 3 seconds.
  - **Test 4: Workspace filtering.** Insert audit records for two workspaces. Query `GET /api/audit-history/workspace/ws-1`, verify only `ws-1` records are returned.
  - **Test 5: Pagination.** Insert 25 audit records. Query with `limit=10, offset=10`, verify exactly 10 records returned with correct offset.
  - **Test 6: End-to-end latency.** Measure the time from POST event to WebSocket delivery. Verify it is under 3 seconds.
- **Failure modes:** Tests require a running MongoDB and API. If not available, tests are skipped with a descriptive message.

**Acceptance Criteria**

- AC-4.5.a: All 6 end-to-end tests pass when run against a running API with MongoDB.
- AC-4.5.b: The latency test confirms event delivery within 3 seconds.
- AC-4.5.c: Tests clean up after themselves (delete test audit records).

**Acceptance Tests**

- Test-4.5.a: The test file `tests/integration/audit-history-e2e.test.ts` contains all 6 tests and they pass.
- Test-4.5.b: Running `npm test -- --testPathPattern=audit-history-e2e` succeeds with all tests passing.

---

## 3. Completion Criteria

The feature is complete when:

1. **Audit trail coverage:** Every POST, PUT, PATCH, DELETE request to the API produces an audit record in the `audit_history` MongoDB collection with all specified fields.
2. **Orchestrator events:** The `/project-start` orchestrator emits `task.started`, `task.completed`, `task.failed`, `phase.started`, `phase.completed`, and `orchestration.progress` events during execution.
3. **Real-time rendering:** The Task History webview updates within 3 seconds of an event being emitted, without manual refresh.
4. **Workspace scoping:** The Task History view shows only events for the current workspace by default, with an option to show all.
5. **API endpoints:** `GET /api/audit-history`, `GET /api/audit-history/:auditId`, `GET /api/audit-history/workspace/:workspaceId`, `GET /api/audit-history/project/:projectNumber` are functional with pagination and filtering.
6. **Backward compatibility:** Existing API clients, task lifecycle, session management, and local `TaskHistoryManager` all function without regression.
7. **Performance:** Audit writes add less than 50ms (p99) overhead to API response times.
8. **Retention:** Audit records are automatically purged after 90 days via TTL index.
9. **Build health:** `pnpm run compile` in `apps/code-ext` and `npm run build` in `packages/api` both succeed without errors.
10. **Tests pass:** All unit tests, integration tests, and end-to-end tests pass.

---

## 4. Rollout & Validation

### Phase 1 Validation (Audit Foundation)

1. Deploy the API with the new `AuditHistoryModule` and `AuditInterceptor`.
2. Verify the `audit_history` collection is created with correct indexes via MongoDB shell.
3. Make several API calls (create task, update session, post project event) and verify corresponding audit records appear.
4. Query `GET /api/audit-history` and verify paginated results.
5. Verify API response times are not significantly degraded (run a basic load test with `wrk` or `ab`).

### Phase 2 Validation (Orchestrator Instrumentation)

1. Run the `/project-start` orchestrator against a test project (2-3 work items).
2. Monitor the `audit_history` collection during execution for `task.started`, `task.completed`, and `phase.completed` events.
3. Verify events include `projectNumber`, `phaseNumber`, and `workItemId` fields.
4. Verify MCP server API calls include `X-Workspace-Id` headers when environment variables are set.

### Phase 3 Validation (Real-Time Extension)

1. Open the VSCode extension with the Task History panel visible.
2. Run the orchestrator against a test project.
3. Verify entries appear in the Task History view in real time (within 3 seconds of each event).
4. Verify status indicators update (spinner to checkmark) as tasks complete.
5. Verify the progress bar updates with each `orchestration.progress` event.
6. Disconnect the WebSocket (kill the API briefly), reconnect, verify backfill works.

### Phase 4 Validation (Production Readiness)

1. Open the Task History view in a workspace, run orchestration in a different workspace, verify events from the other workspace are NOT shown.
2. Toggle "Show all workspaces" and verify cross-workspace events appear.
3. Verify filters (project, phase, status, time range) work correctly.
4. Run the full test suite: unit tests, integration tests, and end-to-end tests.
5. Review MongoDB collection size and query performance with production-like data volume.

---

## 5. Open Questions

1. **Audit retention per organization:** Should the 90-day TTL be configurable per organization or workspace? Current design uses a global TTL. Per-org TTL would require a more complex schema (no TTL index, manual cleanup job).

2. **Audit data sensitivity:** The current design stores a sanitized summary of request bodies (redacting `password`, `token`, `secret`, `apiKey`, `authorization`). Should additional fields be redacted? Should there be a configuration option for custom redaction rules?

3. **Event replay depth on reconnect:** The current design backfills the last 5 minutes of events on WebSocket reconnection. Is this sufficient, or should the backfill window be configurable? Longer backfill windows increase the API load on reconnection.

4. **Workspace ID canonicalization:** The extension currently uses the workspace folder name as the workspace ID. Should this be a hash of the folder path for consistency across machines? The `OrchestrationWebSocketClient` already uses a `workspaceId` concept -- should the audit system reuse the same identifier?

5. **Orchestrator event granularity:** The current design emits events at the outcome level (started, completed, failed). Should the orchestrator also emit events at the subagent instruction level (spawning, waiting, validating)? More granular events increase volume but provide better visibility.

6. **Local vs. server authority:** With server-side audit history, should the local `TaskHistoryManager` be deprecated in a future release, or should it remain as an offline cache that syncs with the server?

7. **Multi-worktree correlation:** When the orchestrator creates a worktree (`/v3-project-N`), events from that worktree include the `worktreePath`. The current design checks if the worktree path is a child of the workspace folder. Should there be an explicit "parent workspace" field in the event data for more reliable correlation?

8. **Audit read rate limiting:** Should the `GET /api/audit-history` endpoints have separate rate limits from the global 100 req/min limit? Heavy audit queries could consume the rate limit budget for operational API calls.
