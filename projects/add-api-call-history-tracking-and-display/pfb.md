# Add API Call History Tracking and Display

## 1. Feature Overview
**Feature Name:** API Call History Tracking and Display
**Owner:** TBD
**Status:** Draft
**Target Release:** Next minor release

### Summary
Add an instrumentation layer around all GitHub API calls (both direct GraphQL via `GitHubAPI` and HTTP via `APIClient`) and MCP server tool invocations to automatically record a structured summary of each call into an in-memory history table. Surface this history through the existing Task History button in the webview toolbar, replacing the current placeholder content with a searchable, filterable list that respects the Org/Repo toggle and search bar already present in the UI.

---

## 2. Problem Statement

### What problem are we solving?
Users and developers of the Claude Projects VSCode extension have no visibility into what API calls the extension is making on their behalf. When debugging issues, diagnosing slow operations, or understanding what happened during a Claude session, there is no audit trail of GitHub API interactions. The Task History button already exists in the toolbar but currently shows only a placeholder message ("Task history will be displayed here..."), making it a dead-end in the UI.

### Who is affected?
- **Extension users** who want to understand what operations were performed on their GitHub Projects (issue creation, status updates, phase changes, project reads).
- **Developers** debugging the extension or MCP server integration who need to trace API call sequences.
- **Claude session operators** who want to review what actions autonomous agents took against their projects.

### Why now?
The Task History button is already in the UI, creating an expectation of functionality that does not exist. The extension has matured to the point where it supports multiple API pathways (direct GraphQL, HTTP API client, MCP server tools), making a unified history view increasingly valuable. As autonomous Claude sessions perform more project management operations, audit trail visibility becomes essential.

---

## 3. Goals & Success Metrics

### Goals
1. **Instrument all API calls** -- Every outgoing GitHub API call (GraphQL queries/mutations via `GitHubAPI.fetchGraphQL`, HTTP requests via `APIClient`, and MCP tool executions via `ToolRegistry.executeTool`) should be tracked with a summary record.
2. **Display history in the webview** -- The Task History button opens a history view in the main content area (replacing project cards, keeping the sticky header with toolbar, search bar, and action buttons).
3. **Make history searchable** -- The existing search bar filters history entries by tool name, operation type, project title, issue title, or status.
4. **Respect Org/Repo toggle** -- When the user switches between Org and Repo views, history entries are filtered to show only calls relevant to the active scope.
5. **Non-intrusive implementation** -- History tracking must not degrade API call performance or introduce failures in the critical path.

### Success Metrics
- 100% of GitHub API calls (read and write) are captured in the history table.
- History view loads in under 100ms for up to 500 entries.
- Search filters history entries in real-time (under 50ms keystroke response).
- Org/Repo toggle correctly filters history entries.
- Zero regressions in existing extension functionality (project display, caching, refresh).

---

## 4. User Experience & Scope

### In Scope

#### 4.1 API Call Tracking Layer
- **Decorator/wrapper pattern** for `GitHubAPI.fetchGraphQL()`, `APIClient` HTTP methods, and `ToolRegistry.executeTool()` that captures:
  - `id` -- Unique identifier (UUID or incrementing integer)
  - `timestamp` -- ISO 8601 datetime of when the call was initiated
  - `source` -- Which client made the call: `"graphql"`, `"api-client"`, or `"mcp-tool"`
  - `operation` -- Human-readable name (e.g., `"getLinkedProjects"`, `"updateIssueStatus"`, `"create_issue"`)
  - `scope` -- `"repo"` or `"org"` based on the context of the call (determined from parameters like `owner`/`repo`)
  - `projectNumber` -- Associated project number, if applicable
  - `issueNumber` -- Associated issue number, if applicable
  - `status` -- `"success"` or `"error"`
  - `durationMs` -- Time taken in milliseconds
  - `summary` -- Short human-readable summary (e.g., "Updated issue #5 status to Done in Project #70")
  - `errorMessage` -- Error details if the call failed
  - `requestParams` -- Sanitized input parameters (no tokens/secrets)
  - `responsePreview` -- Truncated response summary (first 200 chars or key fields)

- **In-memory storage** using an array in the `ProjectsViewProvider` class, with a configurable max size (default: 500 entries, FIFO eviction).
- History persists for the duration of the VSCode session. It does NOT persist across restarts (keeping scope minimal).

#### 4.2 History Display in Webview
- Clicking the Task History button toggles between the **project view** (default) and the **history view**.
- The history view replaces the project cards area while keeping the sticky header (toolbar, search bar, orchestration controls) intact.
- Each history entry is rendered as a compact card showing:
  - Timestamp (relative, e.g., "2 min ago") with full datetime on hover
  - Operation name with an icon indicating type (read/write/error)
  - Summary text
  - Duration badge
  - Status indicator (green checkmark for success, red X for error)
  - Expandable details section showing request params and response preview
- History entries are displayed in reverse chronological order (newest first).
- A "Clear History" button in the history view header allows users to reset the history.
- The Task History button in the toolbar shows an active/highlighted state when the history view is open.

#### 4.3 Search and Filtering
- The existing search bar filters history entries when the history view is active. It matches against: operation name, summary text, project number, and issue number.
- The Org/Repo toggle filters history to show only entries matching the selected scope (`"org"` or `"repo"`).
- The "Show/Hide Completed" toggle has no effect on history view (it only applies to project items).

#### 4.4 Communication Protocol
- New message types between extension and webview:
  - `historyData` -- Extension sends full history array to webview
  - `historyEntry` -- Extension pushes a single new entry (for real-time updates)
  - `clearHistory` -- Webview requests history reset
  - `toggleHistoryView` -- Webview notifies extension that history view was toggled
- History data is sent as a serializable JSON array.

### Out of Scope
- Persisting history across VSCode sessions (localStorage, workspaceState, or file-based storage).
- Exporting history to a file (CSV, JSON).
- Tracking non-GitHub API calls (e.g., internal VSCode API calls, file system operations).
- Rate limit tracking or quota display.
- Network-level request/response capture (we track at the application layer only).
- History for operations performed outside the extension (e.g., direct GitHub web UI changes).

---

## 5. Assumptions & Constraints

### Assumptions
- All GitHub API operations flow through one of three entry points: `GitHubAPI.fetchGraphQL()`, `APIClient` HTTP methods, or `ToolRegistry.executeTool()`. No API calls bypass these layers.
- The existing webview message passing infrastructure (`postMessage`/`onMessage`) can handle the additional history data volume without performance issues.
- 500 entries is a reasonable maximum for a single session; users are unlikely to exceed this in normal usage.
- The search bar in the webview already has event listeners; we can extend its behavior based on the active view (projects vs. history).

### Constraints
- **No external dependencies** -- History tracking must use only in-memory data structures. No new npm packages for storage.
- **No breaking changes** -- All existing API call signatures must remain unchanged. The tracking layer must be transparent to callers.
- **Webview technology** -- The webview uses vanilla JavaScript (no React/Vue). All UI must be implemented with DOM manipulation.
- **Performance budget** -- Adding history tracking must not add more than 1ms overhead per API call.
- **VSCode API limitations** -- Webview communication is asynchronous and message-based. Large history payloads should be paginated or chunked if needed.

---

## 6. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Memory growth from unbounded history | Medium | Medium | FIFO eviction at 500 entries; configurable limit. |
| Tracking wrapper introduces bugs in API calls | Low | High | Wrapper is a pure observer pattern (try/finally); exceptions in tracking code are caught and logged, never propagated to the caller. |
| Performance degradation from serializing large history payloads to webview | Low | Medium | Send incremental updates (`historyEntry`) for real-time; full `historyData` only on view toggle. Truncate `responsePreview` to 200 chars. |
| Scope detection (org vs repo) is inaccurate for some calls | Medium | Low | Default to `"repo"` scope when ambiguous. Allow manual scope override in the tracking decorator. |
| Search bar behavior change confuses users | Low | Low | Visual indicator showing search context (e.g., placeholder text changes to "Search history..." when in history view). |

---

## 7. Dependencies

### Internal Dependencies
- **`apps/code-ext/src/github-api.ts`** -- Must be modified to wrap `fetchGraphQL` and each public method with history tracking.
- **`apps/code-ext/src/api-client.ts`** -- Must be modified to wrap HTTP request methods with history tracking.
- **`apps/code-ext/src/projects-view-provider.ts`** -- Hosts the history store, handles new message types, sends history data to webview.
- **`apps/code-ext/media/main.js`** -- Must implement history view rendering, search filtering in history mode, and view toggling.
- **`apps/code-ext/media/style.css`** -- Must add styles for history entry cards, status indicators, and active state for the history button.
- **`packages/mcp-server/src/tools/registry.ts`** -- Optionally modified to emit history events (or tracked at the extension level where MCP results are consumed).

### External Dependencies
- None. All functionality uses existing VSCode APIs and in-memory JavaScript data structures.

---

## 8. Open Questions

1. **Should MCP tool calls be tracked at the MCP server level or at the extension level?** Tracking at the extension level (where MCP results are consumed) is simpler and keeps history centralized, but tracking at the MCP server level captures calls from all clients. Recommendation: Track at the extension level for this iteration.

2. **Should history entries include the raw GraphQL query text?** This could be useful for debugging but adds storage overhead and may expose implementation details. Recommendation: Include only the operation name and sanitized variables, not the full query string.

3. **Should the history view support pagination or virtual scrolling for large histories?** With a 500-entry cap, simple DOM rendering should suffice. Recommendation: Defer virtual scrolling unless performance testing shows issues.

4. **Should the Clear Cache toolbar button also clear history?** These are conceptually different (cache = GitHub data, history = operation log). Recommendation: Keep them separate; add a dedicated "Clear History" button in the history view.

5. **Should history be filterable by time range?** This adds UI complexity. Recommendation: Defer to a future iteration; the search bar and scope toggle provide sufficient filtering for v1.

---

## 9. Non-Goals

- **Real-time streaming of API responses** -- History captures summaries, not live response streams.
- **Undo/replay functionality** -- History is read-only; users cannot re-execute or undo past operations from the history view.
- **Cross-session history** -- History resets when VSCode restarts. Persistent storage is a future enhancement.
- **GitHub webhook integration** -- We do not track inbound events, only outbound API calls initiated by the extension.
- **Performance profiling** -- While we capture `durationMs`, the history view is not a performance profiling tool. No flame graphs, waterfall charts, or aggregated metrics.

---

## 10. Notes & References

### Existing Code Touchpoints
- **Task History button**: Already wired in `media/main.js` (line ~444-470) with an `onclick` handler. Currently opens a placeholder overlay (`#task-history` div).
- **Task History overlay**: HTML defined in `projects-view-provider.ts` (line ~2752-2758) with placeholder content.
- **Search bar**: Already implemented in `media/main.js` via `createSearchBar()` function. Filters project cards based on `state.searchQuery`.
- **Org/Repo toggle**: Controlled by `state.showOrgProjects` boolean in the webview state. Filters project display via `toggleOrgProjectsVisibility()`.
- **MCP tool registry**: `ToolRegistry.executeTool()` in `packages/mcp-server/src/tools/registry.ts` already logs tool invocations (line ~187). This can be extended to emit structured history events.
- **Output channel logging**: Both `GitHubAPI` and `APIClient` already log to a VSCode output channel. History tracking supplements (does not replace) this logging.

### Implementation Approach (Suggested)
1. Create a `HistoryTracker` class in `apps/code-ext/src/history-tracker.ts` that manages the in-memory history array, provides `record()` and `getHistory()` methods, and handles FIFO eviction.
2. Add a wrapper method or decorator in `GitHubAPI` and `APIClient` that calls `HistoryTracker.record()` with timing and result data in a `try/finally` block around each API call.
3. Wire `HistoryTracker` into `ProjectsViewProvider` as a dependency. Add message handlers for `toggleHistoryView`, `clearHistory`, and `getHistory`.
4. In `media/main.js`, replace the placeholder overlay with a full history view that renders in the main content area. Reuse the search bar filtering logic with a history-specific matcher.
5. Add CSS styles for history cards that match the existing project card aesthetic.

### Related Files
- `/Users/stoked/work/claude-projects/apps/code-ext/src/projects-view-provider.ts`
- `/Users/stoked/work/claude-projects/apps/code-ext/src/github-api.ts`
- `/Users/stoked/work/claude-projects/apps/code-ext/src/api-client.ts`
- `/Users/stoked/work/claude-projects/apps/code-ext/media/main.js`
- `/Users/stoked/work/claude-projects/apps/code-ext/media/style.css`
- `/Users/stoked/work/claude-projects/packages/mcp-server/src/tools/registry.ts`
