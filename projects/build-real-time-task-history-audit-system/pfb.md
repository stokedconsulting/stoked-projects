# Build Real-Time Task History Audit System

## 1. Feature Overview

**Feature Name:** Real-Time Task History Audit System
**Owner:** stokedconsulting
**Status:** Proposed
**Target Release:** Q1 2026

### Summary

The Real-Time Task History Audit System introduces a persistent audit trail for every API call made through the system, capturing workspace context, worktree state, and task metadata into a dedicated MongoDB history collection. In addition, the `/project-start` orchestrator will be instrumented to emit real-time task progress events over the existing Socket.io WebSocket channel, enabling the VSCode extension's Task History webview to display live updates as subagents complete work items -- all without manual refreshes.

---

## 2. Problem Statement

### What problem are we solving?

Currently, the system has two separate and incomplete approaches to tracking task activity:

1. **Client-side only history (`TaskHistoryManager`):** The existing `task-history-manager.ts` in the VSCode extension stores task history entries in `workspaceState`, which is purely local, ephemeral, and not shared across workspaces or machines. It tracks commands the user runs but has no visibility into what the `/project-start` orchestrator and its parallel subagents are actually doing.

2. **Server-side tasks without audit trail (`TasksService`):** The NestJS API has a `TasksModule` with a MongoDB-backed `tasks` collection that tracks task lifecycle (pending, in_progress, completed, failed). However, there is no audit log of API calls themselves, no workspace/worktree context recorded on task updates, and no mechanism to push granular progress updates back to the extension in real time.

3. **No real-time orchestration visibility:** When the `/project-start` orchestrator spawns parallel subagents to complete work items, there is no feedback loop to the Task History UI in the workspace where the work is happening. The user has no way to see which items are in progress, which just completed, or what errors occurred without manually refreshing or checking GitHub directly.

The result is a fragmented experience: the developer cannot see what their automated orchestration is doing in real time, audit what API calls were made, or correlate task progress with specific workspaces and worktrees.

### Who is affected?

- **Developers using the VSCode extension** who run `/project-start` to orchestrate parallel subagent work and need real-time visibility into progress.
- **Team leads and auditors** who need a reliable history of what actions were taken, when, and in which workspace/worktree context.
- **The system itself** -- without audit trails, debugging failed orchestration runs requires manual log trawling across multiple services.

### Why now?

The orchestration system (`/project-start`) is actively being used with parallel subagents. The existing WebSocket infrastructure (Socket.io via `OrchestrationGateway`) and the project event broadcasting system (`ProjectEventsController`) are already in place and proven. The `TaskHistoryViewProvider` webview exists but is fed by local-only data. All the building blocks are ready -- the missing piece is the connective tissue: audit writes on every API call, orchestrator instrumentation for real-time progress events, and WebSocket-driven live updates to the Task History UI.

---

## 3. Goals & Success Metrics

### Goals

1. **Comprehensive API audit trail:** Every API call that modifies state (task creation, status changes, issue updates, session lifecycle) writes an audit record to a persistent MongoDB `audit_history` collection, including workspace ID, worktree path, project number, and the operation performed.

2. **Orchestrator instrumentation:** The `/project-start` orchestrator emits structured task progress events (item started, item completed, item failed, phase completed, project completed) through the existing `POST /api/events/project` endpoint, which broadcasts them via Socket.io.

3. **Real-time Task History UI:** The VSCode extension's Task History webview receives live updates over the existing `OrchestrationWebSocketClient` connection and renders them immediately -- no manual refresh needed. When a subagent completes a work item, the Task History view updates within seconds.

4. **Workspace-scoped filtering:** The Task History view shows only audit entries and progress events relevant to the current workspace and its associated worktrees, not global noise from other workspaces.

5. **Backward compatibility:** Existing API endpoints, task lifecycle operations, and the current `TaskHistoryManager` local storage continue to function. The audit system is additive, not destructive.

### Success Metrics

| Metric | Target |
|--------|--------|
| Audit record written per state-changing API call | 100% coverage |
| Latency overhead of audit writes on API responses | < 50ms (p99) |
| Time from orchestrator event to Task History UI update | < 3 seconds |
| Task History view updates without manual refresh | Yes (zero-refresh) |
| Audit entries include workspace + worktree context | 100% of entries |
| No regression in existing API response times | < 10% increase |
| Audit history retention period | 90 days (configurable) |

---

## 4. User Experience & Scope

### In Scope

1. **Audit History MongoDB Collection & Schema**
   - New `audit_history` collection in the `stoked-projects` database.
   - Schema fields: `audit_id`, `timestamp`, `api_endpoint`, `http_method`, `workspace_id`, `worktree_path`, `project_number`, `task_id`, `session_id`, `operation_type` (e.g., `task.started`, `task.completed`, `issue.updated`), `request_summary` (sanitized payload), `response_status`, `duration_ms`, `actor` (API key identifier or agent ID), `metadata`.
   - TTL index for automatic cleanup after retention period.

2. **API Audit Interceptor**
   - NestJS interceptor applied globally (similar to existing `LoggingInterceptor`) that writes an audit record for every state-changing request (POST, PUT, PATCH, DELETE).
   - Extracts workspace ID and worktree path from request headers (new `X-Workspace-Id` and `X-Worktree-Path` headers) or request body.
   - Writes audit record asynchronously (fire-and-forget) to avoid blocking the response.

3. **Orchestrator Task Progress Events**
   - New `ProjectEventType` entries: `task.started`, `task.completed`, `task.failed`, `phase.started`, `phase.completed`, `orchestration.progress`.
   - The `/project-start` command prompt instrumented to call `POST /api/events/project` at each task lifecycle transition.
   - MCP server `postProjectEvent` method enhanced to include workspace and worktree context.
   - Events include: project number, phase number, work item identifier, agent ID, status, timestamp, and optional error details.

4. **Real-Time Task History WebSocket Integration**
   - `OrchestrationWebSocketClient` in the extension subscribes to task progress events for the current workspace's active projects.
   - New event handler on the client: `task.history` events that contain audit-style entries.
   - `TaskHistoryViewProvider` updated to receive WebSocket messages and append new entries to the webview in real time via `postMessage`.

5. **Enhanced Task History Webview**
   - Live-updating entry list: new entries appear at the top with a brief highlight animation.
   - Entries grouped by project and phase for better organization.
   - Status indicators (in-progress spinner, completed checkmark, failed X) update in real time.
   - Filter controls: by project, by phase, by status, by time range.
   - Workspace-scoped: only shows entries for the current workspace/worktree.

6. **API Endpoints for Audit History**
   - `GET /api/audit-history` -- paginated list with filters (workspace, project, time range, operation type).
   - `GET /api/audit-history/:auditId` -- single entry detail.
   - `GET /api/audit-history/workspace/:workspaceId` -- workspace-scoped history.
   - `GET /api/audit-history/project/:projectNumber` -- project-scoped history.

7. **MCP Server Instrumentation**
   - Every MCP tool call that hits the API includes workspace and worktree context in headers.
   - MCP `api-client.ts` updated to accept and forward workspace context.

### Out of Scope

- **Full-text search over audit entries** -- deferred to a future enhancement; basic filtering is sufficient for the initial release.
- **Audit entry editing or deletion by users** -- the audit trail is append-only and immutable from the user's perspective.
- **Cross-workspace aggregated dashboards** -- the initial release focuses on per-workspace views; a global dashboard is a future feature.
- **Alerting or notification triggers based on audit patterns** -- out of scope for this feature.
- **Audit of read-only (GET) API calls** -- only state-changing operations are audited to keep volume manageable.
- **Migration of existing `TaskHistoryManager` local data to the server** -- the local store will coexist and may be deprecated in a future release.
- **Authentication/authorization changes** -- the audit system uses existing API key guards.

---

## 5. Assumptions & Constraints

### Assumptions

1. **WebSocket connection is reliable for real-time delivery.** The existing `OrchestrationWebSocketClient` with Socket.io provides automatic reconnection and message buffering. If the client disconnects temporarily, it will catch up when reconnected (the `ProjectEventsController` already buffers recent events per project).

2. **The `/project-start` orchestrator can be modified to emit events.** Since `project-start.md` is a Claude command template, instrumentation will be added via instructions in the prompt that call `POST /api/events/project` at lifecycle transitions. The MCP server's `postProjectEvent` method already exists for this purpose.

3. **MongoDB can handle the audit write volume.** Based on current usage patterns (tens of orchestration runs per day, each with 5-50 work items), the audit collection will grow at a manageable rate. A TTL index ensures automatic cleanup.

4. **Extension clients will send workspace and worktree context.** The `APIClient` in the extension and the `api-client.ts` in the MCP server will be updated to include `X-Workspace-Id` and `X-Worktree-Path` headers on every request.

5. **Audit writes are non-blocking.** The interceptor writes asynchronously -- if the write fails, the API response is not affected. Failures are logged but not surfaced to the caller.

6. **The Task History webview is already registered and functional.** `TaskHistoryViewProvider` is wired into `extension.ts` and renders a webview. This feature enhances it rather than building from scratch.

### Constraints

1. **No new infrastructure.** The audit collection lives in the same MongoDB instance used by sessions and tasks. No new database or service is introduced.

2. **Backward compatibility.** Existing API clients that do not send workspace/worktree headers must still work. The audit interceptor treats missing context as optional fields (nullable in the schema).

3. **Performance budget.** Audit writes must add less than 50ms overhead (p99) to API responses. This is achievable with async fire-and-forget writes.

4. **Socket.io event size limits.** Audit/progress event payloads must stay under 1MB per event. Request/response bodies in audit records should be truncated or summarized.

5. **Extension webview limitations.** The Task History webview runs in a sandboxed iframe with limited APIs. All data must be passed via `postMessage`. No direct database access from the webview.

---

## 6. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Audit write failures cause data loss silently** | Medium | Medium | Implement a local fallback buffer in the interceptor. If MongoDB write fails, buffer up to 100 entries in memory and retry on next successful write. Log all failures to the application logger. |
| **High audit volume degrades MongoDB performance** | Low | High | Use a capped collection or TTL index (90-day default). Index on `workspace_id`, `project_number`, and `timestamp` for efficient queries. Monitor collection size via existing Prometheus metrics. |
| **WebSocket events arrive out of order** | Medium | Low | Include monotonically increasing sequence numbers and timestamps in events. The Task History view sorts by timestamp. Out-of-order arrivals self-correct on render. |
| **Orchestrator prompt changes break event emission** | Medium | Medium | Define a strict event schema and validate events server-side in `ProjectEventsController`. Invalid events are logged and dropped gracefully. Include integration tests for the event contract. |
| **Extension webview memory grows unbounded with live entries** | Low | Medium | Cap the in-memory entry list at 500 entries in the webview. Older entries are available via pagination from the API but not held in memory. |
| **Workspace ID not available in all contexts** | Medium | Low | Make `workspace_id` optional in the audit schema. Use a fallback of `"unknown"` when the header is not provided. Log a warning for missing workspace context to encourage adoption. |
| **MCP server does not have workspace context** | Medium | Medium | Pass workspace context through MCP tool arguments or environment variables. The MCP server's `APIClient` already reads config from environment; add `WORKSPACE_ID` and `WORKTREE_PATH` variables. |

---

## 7. Dependencies

### Internal Dependencies

| Dependency | Component | Status | Notes |
|-----------|-----------|--------|-------|
| MongoDB (stoked-projects database) | `packages/api` | Available | Existing database, new collection needed |
| `OrchestrationGateway` (Socket.io) | `packages/api` | Available | Already broadcasts project events |
| `ProjectEventsController` | `packages/api` | Available | Already handles `POST /api/events/project` |
| `OrchestrationWebSocketClient` | `apps/code-ext` | Available | Already connected and receiving events |
| `TaskHistoryViewProvider` | `apps/code-ext` | Available | Webview registered, needs enhancement |
| `TaskHistoryManager` | `apps/code-ext` | Available | Local storage, will coexist |
| `LoggingInterceptor` | `packages/api` | Available | Pattern for the new audit interceptor |
| MCP Server `api-client.ts` | `packages/mcp-server` | Available | Needs workspace context forwarding |
| `/project-start` command | `apps/code-ext/commands` | Available | Needs event emission instructions |

### External Dependencies

| Dependency | Status | Notes |
|-----------|--------|-------|
| MongoDB Atlas / local MongoDB | Required | Already configured in `packages/api` |
| Socket.io (npm package) | Required | Already a dependency |
| VSCode Extension API | Required | Already used |

---

## 8. Open Questions

1. **Audit retention policy:** The PFB assumes 90 days with a TTL index. Should this be configurable per workspace or per organization? What is the expected storage cost at scale?

2. **Audit data sensitivity:** Should request/response bodies in audit entries be redacted or hashed for security? The current plan is to store a sanitized summary, but the exact redaction rules need definition.

3. **Event replay on reconnect:** When the WebSocket client reconnects after a disconnection, should it fetch missed audit entries from the API to backfill the Task History view, or is the existing `ProjectEventsController` buffer (50 events per project) sufficient?

4. **Workspace ID format:** The `OrchestrationWebSocketClient` already uses a `workspaceId` concept. Should the audit system use the same identifier, or should it derive a canonical ID from the VSCode workspace folder path?

5. **Orchestrator event granularity:** Should the orchestrator emit events at the subagent instruction level (spawning, waiting) or only at the outcome level (started, completed, failed)? More granular events provide better visibility but increase volume.

6. **Local vs. server authority for Task History:** With server-side audit history, should the local `TaskHistoryManager` (`workspaceState`) be deprecated, or should it remain as a fast offline cache that syncs with the server?

7. **Multi-worktree correlation:** When the orchestrator creates a worktree (`/v3-project-N`), how should audit entries from that worktree be correlated back to the original workspace that launched the orchestration?

8. **Rate limiting for audit reads:** Should the `GET /api/audit-history` endpoints have separate rate limits from the existing global 100 req/min limit to prevent audit queries from consuming the budget?

---

## 9. Non-Goals

- **Replacing the existing `TasksModule`:** The audit history is complementary to the task lifecycle tracking in `TasksService`. Tasks are the operational state; audit entries are the historical record. They serve different purposes and will coexist.

- **Building a full observability platform:** This is not an APM or distributed tracing system. It is a purpose-built audit trail for task and orchestration activity within the stoked-projects ecosystem.

- **Real-time collaboration features:** While multiple extension instances may see the same audit events via WebSocket, this feature does not enable collaborative editing, chat, or shared cursors.

- **Audit of GitHub API calls themselves:** The audit system tracks calls to the stoked-projects API, not the downstream GitHub GraphQL calls. GitHub API activity is already logged by `GitHubLoggerService`.

- **Custom audit event definitions by users:** The event types are system-defined. Users cannot create custom audit event types in this release.

- **Mobile or web dashboard:** The audit history is consumed exclusively through the VSCode extension webview and the REST API. No standalone web UI is planned.

---

## 10. Notes & References

### Problem Description Source

The original problem description is captured in: `.claude-sessions/project-input-1771322200828.md`

Full text:
> "every api call should write an audit to a history table that tracks the workspace, worktree, task in order to populate the task history.. in addition to this we need to instrument the /project-start orchestrator so that each of the tasks accomplished while completing a given project should update the task history in real time as it is being worked.. and this data should show in real time without refreshes in the workspace task history where the work is being done"

### Key Existing Components

| File | Path | Role |
|------|------|------|
| Task History Manager | `apps/code-ext/src/task-history-manager.ts` | Local task history storage (workspaceState) |
| Task History View | `apps/code-ext/src/task-history-view-provider.ts` | Webview for displaying task history |
| Orchestration WS Client | `apps/code-ext/src/orchestration-websocket-client.ts` | Socket.io client for real-time events |
| Extension API Client | `apps/code-ext/src/api-client.ts` | HTTP client for API calls |
| Orchestration Gateway | `packages/api/src/modules/orchestration/orchestration.gateway.ts` | Socket.io server for broadcasting |
| Project Events Controller | `packages/api/src/modules/project-events/project-events.controller.ts` | HTTP endpoint for project events |
| Project Event Types | `packages/api/src/modules/project-events/project-event.types.ts` | Event type definitions |
| Tasks Service | `packages/api/src/modules/tasks/tasks.service.ts` | Server-side task lifecycle |
| Task Schema | `packages/api/src/schemas/task.schema.ts` | MongoDB task document schema |
| Session Schema | `packages/api/src/schemas/session.schema.ts` | MongoDB session document schema |
| MCP API Client | `packages/mcp-server/src/api-client.ts` | MCP server HTTP client |
| Project Start Command | `apps/code-ext/commands/project-start.md` | Orchestrator prompt template |
| App Module | `packages/api/src/app.module.ts` | NestJS root module (registers all modules) |
| Logging Interceptor | `packages/api/src/common/interceptors/logging.interceptor.ts` | Pattern for audit interceptor |

### Architecture Decision: Async Fire-and-Forget Audit Writes

The audit interceptor will use an async, non-blocking write pattern. This means:
- The API response is returned to the caller immediately.
- The audit record is written to MongoDB in the background.
- If the write fails, it is logged but does not affect the caller.
- This mirrors the pattern used in `ProjectEventsController.handleProjectEvent()` and `APIClient.updateWorktreeStatus()` which are already fire-and-forget.

### Architecture Decision: Reuse Existing WebSocket Channel

Rather than introducing a new WebSocket endpoint or protocol, this feature reuses the existing `/orchestration` Socket.io path and the `project.event` emission channel. New event types (e.g., `task.started`, `task.completed`) are added to the `ProjectEventType` union. The extension's `OrchestrationWebSocketClient` already has a `onProjectEvent` handler that can be extended to route task history events to the `TaskHistoryViewProvider`.

### Architecture Decision: Server as Source of Truth

The server-side `audit_history` collection becomes the authoritative source of task history. The existing client-side `TaskHistoryManager` (which stores in `workspaceState`) will continue to function as a fast local cache but the webview will primarily be driven by WebSocket events from the server. On initial load, the webview will fetch recent history from `GET /api/audit-history/workspace/:workspaceId` and then receive live updates via WebSocket.
