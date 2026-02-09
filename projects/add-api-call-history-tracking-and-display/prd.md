# Product Requirements Document: Add API Call History Tracking and Display

## Section 0: Source Context

**Feature Brief:** `./projects/add-api-call-history-tracking-and-display/pfb.md`
**Project Title:** Add API Call History Tracking and Display
**Status:** Draft
**Target Release:** Next minor release

This PRD translates the feature brief into a phased execution plan with work items, acceptance criteria, and acceptance tests. The feature instruments all GitHub API calls and MCP tool executions with structured history tracking and surfaces the history through the existing Task History button in the VSCode extension webview.

---

## Section 1: Objectives & Constraints

### Objectives

1. **Instrument all API call paths** -- Every outgoing GitHub API call through `GitHubAPI.fetchGraphQL()`, `APIClient.request()`, and MCP tool executions consumed at the extension level must be recorded with a structured summary.
2. **Display history in the webview** -- The existing Task History button toggles the main content area between the project cards view and a history cards view, while preserving the sticky header (toolbar, search bar, orchestration controls).
3. **Make history searchable and filterable** -- The existing search bar filters history entries when the history view is active. The Org/Repo toggle filters history entries by scope.
4. **Zero-regression, zero-performance-impact implementation** -- History tracking must not degrade API call performance (< 1ms overhead), must not introduce failures in the critical path, and must not break existing extension functionality.

### Constraints

- **No external dependencies.** In-memory data structures only. No new npm packages.
- **No breaking changes.** All existing API call signatures remain unchanged. Tracking is transparent to callers.
- **Vanilla JavaScript webview.** No React/Vue. All UI uses DOM manipulation in `media/main.js`.
- **Performance budget.** Tracking overhead < 1ms per API call. History view renders 500 entries in < 100ms.
- **Session-scoped storage.** History does not persist across VSCode restarts. In-memory array with 500-entry FIFO cap.
- **Build requirement.** All changes must pass `pnpm run compile` in `apps/code-ext`.

---

## Section 2: Execution Phases

### Phase 1: Foundation -- History Data Model and Storage

**Purpose:** Establish the `HistoryTracker` class with the data model, in-memory storage, FIFO eviction, and query/filter methods. This is the standalone foundation that all subsequent phases depend on.

#### Work Item 1.1: Define History Entry Interface and HistoryTracker Class

**File:** `apps/code-ext/src/history-tracker.ts` (new file)

**Implementation Details:**

1. Define a `HistoryEntry` TypeScript interface with these fields:
   - `id: number` -- Incrementing integer (simpler than UUID, sufficient for session scope)
   - `timestamp: string` -- ISO 8601 datetime of call initiation
   - `source: 'graphql' | 'api-client' | 'mcp-tool'` -- Which client made the call
   - `operation: string` -- Human-readable operation name (e.g., `"getLinkedProjects"`, `"updateIssueStatus"`, `"create_issue"`)
   - `scope: 'repo' | 'org' | 'unknown'` -- Context scope, determined from call parameters
   - `projectNumber?: number` -- Associated project number, if applicable
   - `issueNumber?: number` -- Associated issue number, if applicable
   - `status: 'success' | 'error'` -- Outcome of the call
   - `durationMs: number` -- Elapsed time in milliseconds
   - `summary: string` -- Human-readable summary (e.g., "Fetched 3 linked projects for owner/repo")
   - `errorMessage?: string` -- Error details if status is `'error'`
   - `requestParams?: Record<string, any>` -- Sanitized input parameters (no tokens, secrets, or Authorization headers)
   - `responsePreview?: string` -- Truncated response summary (max 200 characters)

2. Implement `HistoryTracker` class with:
   - Private `_entries: HistoryEntry[]` array
   - Private `_nextId: number` counter starting at 1
   - Private `_maxEntries: number` defaulting to 500
   - Constructor accepting optional `maxEntries` parameter
   - `record(entry: Omit<HistoryEntry, 'id'>): HistoryEntry` -- Assigns ID, pushes to array, evicts oldest if over cap, returns the created entry
   - `getEntries(): HistoryEntry[]` -- Returns entries in reverse chronological order (newest first)
   - `getFilteredEntries(options: { scope?: 'repo' | 'org'; searchQuery?: string }): HistoryEntry[]` -- Filters by scope and/or searches across `operation`, `summary`, `projectNumber` (toString), `issueNumber` (toString), and `errorMessage`
   - `clear(): void` -- Resets entries array and ID counter
   - `getCount(): number` -- Returns current entry count
   - `onEntryAdded?: (entry: HistoryEntry) => void` -- Optional callback for real-time push to webview

3. Implement `sanitizeParams(params: any): Record<string, any>` as a static utility method that strips fields containing `token`, `authorization`, `secret`, `password`, `apikey`, `api_key`, `auth` (case-insensitive) and replaces values with `"***REDACTED***"`.

4. Implement `truncateResponse(response: any, maxLength?: number): string` as a static utility that converts response to a string summary (JSON.stringify for objects, String() for primitives) and truncates to `maxLength` (default 200) characters with `"..."` suffix.

**Acceptance Criteria:**
- AC-1.1.a: `HistoryEntry` interface includes all 13 fields specified in the PFB schema.
- AC-1.1.b: `HistoryTracker.record()` assigns sequential IDs and returns the created entry.
- AC-1.1.c: FIFO eviction removes the oldest entry when `_maxEntries` is exceeded.
- AC-1.1.d: `getEntries()` returns entries in reverse chronological order.
- AC-1.1.e: `getFilteredEntries()` correctly filters by scope and searches across specified fields.
- AC-1.1.f: `sanitizeParams()` redacts sensitive fields without modifying the original object.
- AC-1.1.g: `truncateResponse()` truncates to 200 chars by default with `"..."` suffix.
- AC-1.1.h: `clear()` resets both the entries array and the ID counter.
- AC-1.1.i: File compiles without errors via `pnpm run compile` in `apps/code-ext`.

**Acceptance Tests:**
- Test-1.1.a: Create a `HistoryTracker` with `maxEntries=3`. Record 5 entries. Verify only 3 entries remain (IDs 3, 4, 5). Verify `getEntries()` returns them in order [5, 4, 3].
- Test-1.1.b: Record entries with `scope: 'repo'` and `scope: 'org'`. Call `getFilteredEntries({ scope: 'repo' })`. Verify only repo-scoped entries are returned.
- Test-1.1.c: Record entries with various operation names and summaries. Call `getFilteredEntries({ searchQuery: 'linked' })`. Verify only entries containing "linked" in operation or summary are returned.
- Test-1.1.d: Call `sanitizeParams({ owner: 'test', accessToken: 'ghp_secret123' })`. Verify output is `{ owner: 'test', accessToken: '***REDACTED***' }`.
- Test-1.1.e: Call `truncateResponse({ data: 'x'.repeat(300) })`. Verify output is a string of exactly 203 characters (200 + "...").
- Test-1.1.f: Call `clear()` after recording entries. Verify `getCount()` returns 0 and next `record()` assigns ID 1.

#### Work Item 1.2: Wire HistoryTracker into ProjectsViewProvider

**File:** `apps/code-ext/src/projects-view-provider.ts`

**Implementation Details:**

1. Import `HistoryTracker` and `HistoryEntry` from `./history-tracker`.
2. Add private member `_historyTracker: HistoryTracker` to `ProjectsViewProvider`.
3. Initialize `_historyTracker = new HistoryTracker()` in the constructor.
4. Set `_historyTracker.onEntryAdded` callback to push individual entries to the webview via `this._view.webview.postMessage({ type: 'historyEntry', entry })`.
5. Add a public getter `get historyTracker(): HistoryTracker` to expose the tracker for instrumentation by `GitHubAPI` and `APIClient`.
6. Add message handler cases in the `resolveWebviewView` message switch:
   - `'getHistory'`: Respond with `postMessage({ type: 'historyData', entries: this._historyTracker.getEntries() })`.
   - `'clearHistory'`: Call `this._historyTracker.clear()` and respond with `postMessage({ type: 'historyData', entries: [] })`.
   - `'toggleHistoryView'`: Store a `_historyViewActive` boolean, respond with `postMessage({ type: 'historyData', entries: this._historyTracker.getEntries() })` when toggling on.
   - `'filterHistory'`: Accept `{ scope?, searchQuery? }` and respond with `postMessage({ type: 'historyData', entries: this._historyTracker.getFilteredEntries(data) })`.
7. Modify the existing `'openTaskHistory'` handler to use the new `'toggleHistoryView'` flow instead of the old overlay approach. Remove the `showTaskHistory` postMessage and instead send the full history data.

**Acceptance Criteria:**
- AC-1.2.a: `ProjectsViewProvider` has a `_historyTracker` member initialized in the constructor.
- AC-1.2.b: `getHistory` message returns the full history entries array to the webview.
- AC-1.2.c: `clearHistory` message empties the history and notifies the webview.
- AC-1.2.d: `toggleHistoryView` message sends history data when toggling on.
- AC-1.2.e: `filterHistory` message applies scope and search filters and returns filtered entries.
- AC-1.2.f: `onEntryAdded` callback pushes individual entries to the webview in real-time.
- AC-1.2.g: The old `showTaskHistory` overlay-based flow is replaced with data-driven history.
- AC-1.2.h: File compiles without errors via `pnpm run compile` in `apps/code-ext`.

**Acceptance Tests:**
- Test-1.2.a: Send `{ type: 'getHistory' }` message to the webview. Verify the webview receives a `historyData` message with an `entries` array.
- Test-1.2.b: Record 3 entries via the tracker, then send `{ type: 'clearHistory' }`. Verify the webview receives `historyData` with an empty array.
- Test-1.2.c: Record entries with mixed scopes. Send `{ type: 'filterHistory', scope: 'org' }`. Verify only org-scoped entries are returned.

---

### Phase 2: API Instrumentation -- Wrap All Call Paths

**Purpose:** Instrument the three API call paths (`GitHubAPI.fetchGraphQL`, `APIClient.request`, and MCP tool consumption at extension level) with history tracking wrappers. Each wrapper records timing, parameters, results, and errors without altering the call behavior.

#### Work Item 2.1: Instrument GitHubAPI.fetchGraphQL()

**File:** `apps/code-ext/src/github-api.ts`

**Implementation Details:**

1. Add an optional `historyTracker?: HistoryTracker` property to `GitHubAPI`, settable via a public `setHistoryTracker(tracker: HistoryTracker)` method. This avoids constructor changes and maintains backward compatibility.
2. Create a private method `private trackCall(operationName: string, scope: 'repo' | 'org' | 'unknown', params: { projectNumber?: number; issueNumber?: number; owner?: string; repo?: string }, callFn: () => Promise<any>): Promise<any>` that:
   - Records `Date.now()` as start time
   - Calls `callFn()` in a try/catch/finally
   - On success: records entry with `status: 'success'`, generates summary, captures `responsePreview`
   - On error: records entry with `status: 'error'`, captures `errorMessage`
   - Always: calculates `durationMs`, calls `this.historyTracker.record()` if tracker is set
   - Returns the original result (or re-throws the error) so callers are unaffected
3. Wrap each public method in `GitHubAPI` with `trackCall()`:
   - `getLinkedProjects(owner, repo)` -- source: `"graphql"`, operation: `"getLinkedProjects"`, scope: `"repo"`, summary: `"Fetched linked projects for {owner}/{repo}"`
   - `getOrganizationProjects(owner)` -- source: `"graphql"`, operation: `"getOrganizationProjects"`, scope: `"org"`, summary: `"Fetched organization projects for {owner}"`
   - `getProjectItems(projectId)` -- source: `"graphql"`, operation: `"getProjectItems"`, scope: `"unknown"`, summary: `"Fetched items for project {projectId}"`
   - `getProjectFields(projectId)` -- source: `"graphql"`, operation: `"getProjectFields"`, scope: `"unknown"`, summary: `"Fetched fields for project {projectId}"`
   - `updateItemFieldValue(...)` -- source: `"graphql"`, operation: `"updateItemFieldValue"`, scope: `"unknown"`, summary: `"Updated field value in project {projectId}"`
   - `deleteProjectItem(projectId, itemId)` -- source: `"graphql"`, operation: `"deleteProjectItem"`, scope: `"unknown"`, summary: `"Deleted item from project {projectId}"`
   - `deleteProject(projectId)` -- source: `"graphql"`, operation: `"deleteProject"`, scope: `"unknown"`, summary: `"Deleted project {projectId}"`
   - `linkProjectToRepository(...)` -- source: `"graphql"`, operation: `"linkProjectToRepository"`, scope: `"repo"`, summary: `"Linked project to repository"`
   - `unlinkProjectFromRepository(...)` -- source: `"graphql"`, operation: `"unlinkProjectFromRepository"`, scope: `"repo"`, summary: `"Unlinked project from repository"`
   - `getRepositoryId(owner, repo)` -- source: `"graphql"`, operation: `"getRepositoryId"`, scope: `"repo"`, summary: `"Fetched repository ID for {owner}/{repo}"`
   - `closeIssue(owner, repo, issueNumber)` -- source: `"graphql"`, operation: `"closeIssue"`, scope: `"repo"`, summary: `"Closed issue #{issueNumber} in {owner}/{repo}"`, issueNumber populated
   - `getAuthenticatedUser()` -- source: `"graphql"`, operation: `"getAuthenticatedUser"`, scope: `"unknown"`, summary: `"Fetched authenticated user info"`
   - `checkRepoExists(owner, name)` -- source: `"graphql"`, operation: `"checkRepoExists"`, scope: `"repo"`, summary: `"Checked if repo {owner}/{name} exists"`
   - `createRepository(name, org, isPrivate)` -- source: `"graphql"`, operation: `"createRepository"`, scope: org ? `"org"` : `"repo"`, summary: `"Created repository {name}"`
4. Sanitize `requestParams` using `HistoryTracker.sanitizeParams()` before recording. Never include `accessToken` or `Authorization` headers.
5. Generate `responsePreview` using `HistoryTracker.truncateResponse()` with key result fields (e.g., project count, success/failure boolean).

**Acceptance Criteria:**
- AC-2.1.a: Every public method in `GitHubAPI` records a history entry when a `HistoryTracker` is set.
- AC-2.1.b: When no `HistoryTracker` is set, all methods behave identically to before (no errors, no tracking).
- AC-2.1.c: Each entry has the correct `source` (`"graphql"`), `operation`, `scope`, and populated `summary`.
- AC-2.1.d: Failed API calls record `status: 'error'` with `errorMessage` populated.
- AC-2.1.e: `durationMs` accurately reflects the time taken for each call.
- AC-2.1.f: `requestParams` never contains `accessToken`, `Authorization`, or other sensitive values.
- AC-2.1.g: Exceptions in the tracking code itself are caught and logged, never propagated to the caller.
- AC-2.1.h: File compiles without errors via `pnpm run compile` in `apps/code-ext`.

**Acceptance Tests:**
- Test-2.1.a: Create a `GitHubAPI` instance with a `HistoryTracker`. Call `getLinkedProjects('owner', 'repo')`. Verify the tracker contains one entry with `source: 'graphql'`, `operation: 'getLinkedProjects'`, `scope: 'repo'`.
- Test-2.1.b: Create a `GitHubAPI` instance without a `HistoryTracker`. Call any method. Verify no errors occur and the result is unchanged.
- Test-2.1.c: Simulate a GraphQL error response. Verify the recorded entry has `status: 'error'` and `errorMessage` is populated.
- Test-2.1.d: Verify `requestParams` in the recorded entry does not contain `accessToken`.

#### Work Item 2.2: Instrument APIClient.request()

**File:** `apps/code-ext/src/api-client.ts`

**Implementation Details:**

1. Add an optional `historyTracker?: HistoryTracker` property to `APIClient`, settable via a public `setHistoryTracker(tracker: HistoryTracker)` method.
2. Instrument the private `request()` method directly (since all public methods flow through it):
   - Before the fetch call: record start time
   - After the fetch call: record end time, compute `durationMs`
   - On success: record entry with `status: 'success'`
   - On error: record entry with `status: 'error'`, populate `errorMessage`
   - Determine `operation` from the calling public method name. Since `request()` is private and called by public methods, pass an `operationName` parameter or use a wrapper approach.
3. Preferred approach: Add an `operationName` parameter to the `request()` method signature (private, so no breaking change):
   ```typescript
   private async request<T>(method: string, path: string, body?: any, operationName?: string): Promise<...>
   ```
   Each public method passes its name as `operationName`.
4. Determine `scope` from the path:
   - Paths containing `/org/` -> `"org"`
   - Paths containing `/repos/` or `/linked/` or `/repo/` -> `"repo"`
   - Orchestration paths (`/orchestration/`) -> `"unknown"`
   - Default: `"unknown"`
5. Extract `projectNumber` and `issueNumber` from path segments where possible (e.g., `/issues/5/close` -> issueNumber: 5).
6. Generate `summary` from method + path (e.g., `"GET /api/github/projects/linked/owner/repo"` -> `"Fetched linked projects for owner/repo"`).
7. Sanitize request body using `HistoryTracker.sanitizeParams()`. Never include `x-api-key` or `Authorization` headers.

**Acceptance Criteria:**
- AC-2.2.a: Every public method in `APIClient` records a history entry when a `HistoryTracker` is set.
- AC-2.2.b: When no `HistoryTracker` is set, all methods behave identically to before.
- AC-2.2.c: Each entry has `source: 'api-client'` and correct `operation`, `scope`, and `summary`.
- AC-2.2.d: Failed HTTP requests record `status: 'error'` with `errorMessage` containing the HTTP status and message.
- AC-2.2.e: Timeout errors are recorded with `errorMessage: 'Request timeout'`.
- AC-2.2.f: `requestParams` never contains `x-api-key`, `Authorization`, or other sensitive headers.
- AC-2.2.g: File compiles without errors via `pnpm run compile` in `apps/code-ext`.

**Acceptance Tests:**
- Test-2.2.a: Create an `APIClient` with a `HistoryTracker`. Call `getLinkedProjects('owner', 'repo')`. Verify the tracker contains one entry with `source: 'api-client'`, `operation: 'getLinkedProjects'`, `scope: 'repo'`.
- Test-2.2.b: Simulate an HTTP 500 error. Verify the recorded entry has `status: 'error'` and `errorMessage` contains "500".
- Test-2.2.c: Simulate a timeout. Verify the recorded entry has `status: 'error'` and `errorMessage` is `"Request timeout"`.

#### Work Item 2.3: Track MCP Tool Executions at Extension Level

**File:** `apps/code-ext/src/projects-view-provider.ts`

**Implementation Details:**

The PFB recommends tracking MCP tool calls at the extension level where results are consumed, rather than modifying the MCP server package. This keeps history centralized and avoids cross-package coupling.

1. Identify where MCP tool results are consumed in `ProjectsViewProvider`. The extension uses the MCP client (via `@modelcontextprotocol/sdk`) to call tools. The relevant integration points are in `projects-view-provider.ts` where WebSocket events from MCP operations trigger data refreshes.
2. Add a helper method `private recordMCPToolExecution(toolName: string, params: any, result: any, durationMs: number, isError: boolean)` that creates a history entry with:
   - `source: 'mcp-tool'`
   - `operation: toolName` (e.g., `"create_issue"`, `"read_project"`, `"health_check"`)
   - `scope`: Determined from `params.projectNumber` context (if available, check if it maps to repo or org project; default to `"unknown"`)
   - `projectNumber`: Extracted from `params.projectNumber` if present
   - `issueNumber`: Extracted from `params.issueNumber` if present
   - `summary`: Generated from tool name and key params (e.g., `"Created issue 'Fix bug' in Project #70"`)
   - `status`, `durationMs`, `errorMessage`, `requestParams`, `responsePreview` populated as appropriate
3. Wrap the WebSocket event handlers (`issue.created`, `issue.updated`, `issue.deleted`, `project.created`) to record history entries for MCP-originated events. These events indicate that an MCP tool executed an action.
4. If the extension directly invokes MCP tools (via tool call protocol), wrap those call sites with timing and history recording.

**Acceptance Criteria:**
- AC-2.3.a: MCP tool executions that result in WebSocket events are recorded in the history.
- AC-2.3.b: Each MCP entry has `source: 'mcp-tool'` and the correct `operation` (tool name).
- AC-2.3.c: `projectNumber` and `issueNumber` are populated when available in the event data.
- AC-2.3.d: History recording does not interfere with existing WebSocket event handling or UI refresh logic.
- AC-2.3.e: File compiles without errors via `pnpm run compile` in `apps/code-ext`.

**Acceptance Tests:**
- Test-2.3.a: Simulate a WebSocket `issue.created` event. Verify the history tracker contains an entry with `source: 'mcp-tool'`, `operation: 'issue.created'`.
- Test-2.3.b: Simulate a WebSocket `project.created` event with `projectNumber: 70`. Verify the entry has `projectNumber: 70`.

#### Work Item 2.4: Connect HistoryTracker to API Clients on Initialization

**File:** `apps/code-ext/src/projects-view-provider.ts`

**Implementation Details:**

1. After creating `_githubAPI` and `_orchestrationClient` in the constructor, call `setHistoryTracker(this._historyTracker)` on each client that supports it.
2. For `GitHubAPI` instances: `(this._githubAPI as GitHubAPI).setHistoryTracker(this._historyTracker)` -- check if the instance is `GitHubAPI` (not `APIClient` used as `IUnifiedGitHubClient`) before calling.
3. For `APIClient` instances: Always call `setHistoryTracker()` since both the main GitHub client (when `useAPIService` is true) and the orchestration client are `APIClient` instances.
4. Handle the case where `_githubAPI` could be either `GitHubAPI` or `APIClient` depending on configuration. Use a type guard or check `instanceof`.

**Acceptance Criteria:**
- AC-2.4.a: The `HistoryTracker` is connected to all active API client instances during `ProjectsViewProvider` construction.
- AC-2.4.b: When `useAPIService` is `true`, the `APIClient` used for GitHub operations has the tracker set.
- AC-2.4.c: When `useAPIService` is `false`, the `GitHubAPI` used for GraphQL operations has the tracker set.
- AC-2.4.d: The orchestration `APIClient` always has the tracker set.
- AC-2.4.e: File compiles without errors via `pnpm run compile` in `apps/code-ext`.

**Acceptance Tests:**
- Test-2.4.a: With `useAPIService: false`, verify that calling `getLinkedProjects` on the `GitHubAPI` instance records a history entry.
- Test-2.4.b: With `useAPIService: true`, verify that calling `getLinkedProjects` on the `APIClient` instance records a history entry.
- Test-2.4.c: Verify that calling `getWorkspaceOrchestration` on the orchestration client records a history entry.

---

### Phase 3: Webview History Display -- Render History Cards and Toggle Views

**Purpose:** Replace the placeholder Task History overlay with a full history view rendered in the main content area. Implement the view toggle, history card rendering, and clear functionality.

#### Work Item 3.1: Replace Task History Overlay with In-Content History View

**File:** `apps/code-ext/media/main.js`

**Implementation Details:**

1. Remove or repurpose the existing `#task-history` overlay div. The history view will render inside `#content` (alongside project cards, not as an overlay).
2. Add a `state.historyViewActive` boolean (default `false`) to the webview state object.
3. Modify the Task History button (`taskHistoryButton`) onclick handler:
   - Toggle `state.historyViewActive`
   - If activating: send `{ type: 'toggleHistoryView', active: true }` to extension and add `active` CSS class to the button
   - If deactivating: send `{ type: 'toggleHistoryView', active: false }` to extension, remove `active` class, and re-render project cards
   - Save state with `vscode.setState(state)`
4. Add message handlers for new message types:
   - `'historyData'`: Receive `{ entries: HistoryEntry[] }` and call `renderHistoryView(entries)` if `state.historyViewActive` is true
   - `'historyEntry'`: Receive a single `{ entry: HistoryEntry }` and prepend it to the history view if active (for real-time updates)
5. Implement `renderHistoryView(entries)`:
   - Clear all `.project-card` elements from `#content` (but preserve `.sticky-header`)
   - Create a history container div with class `history-view`
   - Add a history header bar with:
     - "API Call History" title
     - Entry count badge (e.g., "47 entries")
     - "Clear History" button that sends `{ type: 'clearHistory' }` to extension
   - For each entry, call `createHistoryCard(entry)` and append to the container
   - If entries is empty, show an empty state message: "No API calls recorded yet."
6. Implement `createHistoryCard(entry)`:
   - Outer div with class `history-card` and data attributes `data-scope`, `data-operation`
   - Top row: timestamp (relative, e.g., "2m ago") with `title` attribute for full ISO datetime, status icon (green checkmark or red X), operation name in bold
   - Middle row: summary text
   - Bottom row: duration badge (e.g., "124ms"), source badge (e.g., "GraphQL", "HTTP", "MCP"), scope badge (e.g., "repo", "org")
   - Expandable details section (collapsed by default): shows `requestParams` as formatted JSON and `responsePreview` as preformatted text. Toggle via click on a "Details" button.
7. Implement `formatRelativeTime(isoString)` helper that returns human-readable relative times ("just now", "1m ago", "5m ago", "1h ago", etc.).
8. When deactivating history view, remove the `.history-view` container and restore project cards (re-render from `state.lastData`).

**Acceptance Criteria:**
- AC-3.1.a: Clicking the Task History button toggles between project view and history view.
- AC-3.1.b: The sticky header (toolbar, search bar, orchestration controls) remains visible in history view.
- AC-3.1.c: Each history card displays timestamp, status icon, operation name, summary, duration badge, source badge, and scope badge.
- AC-3.1.d: History cards are displayed in reverse chronological order (newest first).
- AC-3.1.e: The "Clear History" button empties the history view and resets the tracker.
- AC-3.1.f: An empty state message appears when no history entries exist.
- AC-3.1.g: The expandable details section shows sanitized request params and response preview.
- AC-3.1.h: Returning to project view restores the project cards from cached data.
- AC-3.1.i: The Task History button shows an active/highlighted state when the history view is open.

**Acceptance Tests:**
- Test-3.1.a: Click the Task History button. Verify project cards are replaced by history cards. Click again. Verify project cards are restored.
- Test-3.1.b: With 10 history entries, verify all 10 cards are rendered with correct data.
- Test-3.1.c: Click "Clear History". Verify all cards are removed and the empty state message appears.
- Test-3.1.d: Click a "Details" toggle on a history card. Verify the details section expands showing request params.
- Test-3.1.e: Verify the Task History button has an `active` class when history view is shown.

#### Work Item 3.2: Update HTML Template and Remove Overlay

**File:** `apps/code-ext/src/projects-view-provider.ts` (HTML template in `resolveWebviewView`)

**Implementation Details:**

1. In the `resolveWebviewView` method, locate the HTML template that defines the `#task-history` overlay div (around line 2752-2760).
2. Remove or simplify the `#task-history` overlay div. The history UI is now rendered dynamically by `main.js` inside `#content`, so the static HTML overlay is no longer needed.
3. Remove the `task-history-close-btn` button and its event listener wiring.
4. Keep the `#task-history` div ID available but empty (or remove entirely), since `main.js` references `document.getElementById('task-history')` at the top.
5. Update the existing `handleOpenTaskHistory()` method to send history data instead of the `showTaskHistory` message:
   ```typescript
   private async handleOpenTaskHistory() {
     if (this._view) {
       this._view.webview.postMessage({
         type: 'historyData',
         entries: this._historyTracker.getEntries()
       });
     }
   }
   ```

**Acceptance Criteria:**
- AC-3.2.a: The `#task-history` overlay HTML is removed or emptied from the template.
- AC-3.2.b: The `handleOpenTaskHistory()` method sends `historyData` instead of `showTaskHistory`.
- AC-3.2.c: No JavaScript errors from orphaned references to removed HTML elements.
- AC-3.2.d: File compiles without errors via `pnpm run compile` in `apps/code-ext`.

**Acceptance Tests:**
- Test-3.2.a: Reload the extension. Verify no JavaScript errors in the webview developer console related to `task-history` elements.
- Test-3.2.b: Click the Task History button. Verify `historyData` message is received by the webview (inspect via console log).

#### Work Item 3.3: Add History Card Styles

**File:** `apps/code-ext/media/style.css`

**Implementation Details:**

1. Add styles for the history view container (`.history-view`):
   - `padding: 0 8px`
   - Same scrolling behavior as the project cards area
2. Add styles for the history header bar (`.history-header`):
   - Flex row with space-between alignment
   - Title on the left, count badge and clear button on the right
   - Bottom border for visual separation
3. Add styles for history cards (`.history-card`):
   - Match the existing `.project-card` aesthetic (background, border-radius, padding, margin)
   - Use VSCode theme variables (`var(--vscode-editor-background)`, `var(--vscode-foreground)`, etc.)
   - Compact layout: less vertical padding than project cards
4. Add styles for status indicators:
   - `.history-status-success`: green color (`var(--vscode-testing-iconPassed)` or `#4caf50`)
   - `.history-status-error`: red color (`var(--vscode-testing-iconFailed)` or `#f44336`)
5. Add styles for badges (`.history-badge`):
   - Small pill-shaped inline elements
   - Variants: `.badge-duration` (neutral), `.badge-source` (blue tint), `.badge-scope` (subtle background)
6. Add styles for expandable details (`.history-details`):
   - Collapsed by default (`display: none`)
   - When expanded (`.history-details.expanded`): `display: block`
   - Monospace font for request params and response preview
   - Subtle background to distinguish from the card body
7. Add active state for the Task History button:
   - `.task-history-button.active`: highlighted background, border, or color change to indicate the view is active
8. Remove or update old overlay styles (`.task-history-overlay`, `.task-history-header`, `.task-history-content`, `.task-history-close`) since the overlay is being replaced.

**Acceptance Criteria:**
- AC-3.3.a: History cards visually match the existing project card aesthetic.
- AC-3.3.b: Status indicators use appropriate colors (green for success, red for error).
- AC-3.3.c: Badges are readable and properly spaced.
- AC-3.3.d: Expandable details section has a monospace font and distinct background.
- AC-3.3.e: Active state on the Task History button is visible and distinct.
- AC-3.3.f: All colors use VSCode theme CSS variables for light/dark theme compatibility.

**Acceptance Tests:**
- Test-3.3.a: Switch between light and dark VSCode themes. Verify history cards remain readable in both.
- Test-3.3.b: Verify the Task History button has a visually distinct active state when history view is shown.
- Test-3.3.c: Expand a history card details section. Verify request params are displayed in monospace font.

---

### Phase 4: Search and Filtering Integration -- Full History UX

**Purpose:** Connect the existing search bar and Org/Repo toggle to filter history entries when the history view is active. Add real-time updates and UI polish for the complete user experience.

#### Work Item 4.1: Search Bar Integration for History View

**File:** `apps/code-ext/media/main.js`

**Implementation Details:**

1. Modify the `applySearchFilter()` function to branch based on `state.historyViewActive`:
   - If `state.historyViewActive` is `true`: filter history cards instead of project cards
   - If `false`: existing behavior (filter project cards)
2. When filtering history cards:
   - Get the search query from `state.searchQuery`
   - For each `.history-card` element, check if the query matches (case-insensitive) against:
     - The `operation` text (from a `data-operation` attribute or inner element)
     - The summary text
     - The `projectNumber` text (if displayed)
     - The `issueNumber` text (if displayed)
     - The `errorMessage` text (if present)
   - Show matching cards, hide non-matching ones (same `display: none` pattern as project filtering)
3. Alternatively, for a more robust approach, send a `{ type: 'filterHistory', searchQuery: state.searchQuery, scope: state.showOrgProjects ? 'org' : 'repo' }` message to the extension and re-render from the filtered response. This leverages `HistoryTracker.getFilteredEntries()` server-side.
   - Recommended: Use client-side filtering for < 50ms responsiveness (avoids message round-trip)
4. Update the search bar placeholder text when history view is active:
   - When `state.historyViewActive` is `true`: set `input.placeholder = 'Search history...'`
   - When `false`: restore `input.placeholder = 'Search projects...'`
5. When toggling between views, re-apply the search filter to ensure consistency.

**Acceptance Criteria:**
- AC-4.1.a: Typing in the search bar filters history cards in real-time (< 50ms response).
- AC-4.1.b: Search matches against operation name, summary, project number, issue number, and error message.
- AC-4.1.c: Clearing the search (Escape key or clear button) shows all history entries.
- AC-4.1.d: The search bar placeholder changes to "Search history..." when in history view.
- AC-4.1.e: Switching back to project view restores "Search projects..." placeholder and filters project cards.

**Acceptance Tests:**
- Test-4.1.a: In history view with 20 entries, type "getLinked". Verify only entries with "getLinkedProjects" operation are visible.
- Test-4.1.b: Type a project number (e.g., "70"). Verify only entries related to Project #70 are visible.
- Test-4.1.c: Press Escape in the search bar. Verify all entries become visible again.
- Test-4.1.d: Activate history view. Verify the placeholder reads "Search history...". Deactivate. Verify it reads "Search projects...".

#### Work Item 4.2: Org/Repo Toggle Filtering for History View

**File:** `apps/code-ext/media/main.js`

**Implementation Details:**

1. Modify the Org/Repo toggle button handler (the `orgToggleButton` in `createToolbar()`):
   - When toggled while `state.historyViewActive` is `true`: filter history entries by scope
   - `state.showOrgProjects === true` (Org mode): show only entries with `scope: 'org'` or `scope: 'unknown'`
   - `state.showOrgProjects === false` (Repo mode): show only entries with `scope: 'repo'` or `scope: 'unknown'`
   - Entries with `scope: 'unknown'` are shown in both views (they are not scope-specific)
2. Apply scope filtering alongside search filtering. Both filters should compose:
   - A history card is visible only if it matches both the scope filter AND the search query.
3. When the toggle changes while in history view, immediately re-filter the displayed cards without requesting new data from the extension.
4. Store scope filter state in `data-scope` attributes on each `.history-card` element for efficient DOM-based filtering.

**Acceptance Criteria:**
- AC-4.2.a: In history view, toggling to "Org" shows only org-scoped and unknown-scoped entries.
- AC-4.2.b: In history view, toggling to "Repo" shows only repo-scoped and unknown-scoped entries.
- AC-4.2.c: Scope filtering composes with search filtering (both must match for a card to be visible).
- AC-4.2.d: Entries with `scope: 'unknown'` appear in both Org and Repo views.
- AC-4.2.e: The "Show/Hide Completed" toggle has no effect on history view (only affects project items).

**Acceptance Tests:**
- Test-4.2.a: Record 5 repo-scoped and 5 org-scoped entries. In history view, toggle to "Org". Verify only org-scoped entries are visible.
- Test-4.2.b: Toggle to "Repo". Verify only repo-scoped entries are visible.
- Test-4.2.c: Search for "getLinked" while in Repo mode. Verify only repo-scoped entries matching "getLinked" are visible.
- Test-4.2.d: Record an entry with `scope: 'unknown'`. Verify it appears in both Org and Repo views.

#### Work Item 4.3: Real-Time History Updates and UI Polish

**File:** `apps/code-ext/media/main.js`, `apps/code-ext/media/style.css`

**Implementation Details:**

1. Handle the `'historyEntry'` message (single new entry pushed from extension):
   - If `state.historyViewActive` is `true`:
     - Create a new history card via `createHistoryCard(entry)`
     - Prepend it to the `.history-view` container (after the header)
     - Apply current search and scope filters to determine if the new card should be visible
     - Update the entry count badge
     - Add a brief CSS animation (`@keyframes slideIn`) to highlight the new card
   - If history view is not active: do nothing (entries are stored in the tracker and will be fetched on toggle)
2. Update the entry count badge dynamically as entries are added or cleared.
3. Add a subtle animation for new history cards appearing (slide-in from top, brief background highlight).
4. Ensure relative timestamps update. Options:
   - Simple approach: timestamps are set at render time and do not update (acceptable for v1)
   - Enhanced approach: set a `setInterval` to re-format timestamps every 60 seconds (defer to future if not needed)
5. Handle edge case: if history view is active and 500 entries exist, adding a new entry should also remove the last card from the DOM to maintain the FIFO visual.
6. Ensure the search bar clear button (`clearButton.style.display`) properly reflects state when switching between views.

**Acceptance Criteria:**
- AC-4.3.a: New history entries appear in real-time at the top of the history view when it is active.
- AC-4.3.b: New entries respect the current search and scope filters (hidden if they do not match).
- AC-4.3.c: The entry count badge updates as entries are added or cleared.
- AC-4.3.d: New entries have a brief slide-in animation.
- AC-4.3.e: The FIFO visual limit is maintained (last card removed when count exceeds 500).
- AC-4.3.f: No memory leaks from orphaned DOM elements or event listeners.

**Acceptance Tests:**
- Test-4.3.a: Open history view. Trigger an API call (e.g., refresh projects). Verify a new card appears at the top with animation.
- Test-4.3.b: Set a search filter. Trigger an API call that does not match the filter. Verify the new card is hidden.
- Test-4.3.c: Verify the entry count badge increments after each new entry.
- Test-4.3.d: Fill history to 500 entries, then add one more. Verify the oldest card is removed from the DOM.

---

## Section 3: Completion Criteria

The feature is complete when:

1. **All API call paths are instrumented.** Every call through `GitHubAPI.fetchGraphQL()`, `APIClient.request()`, and MCP tool events records a structured history entry with all 13 schema fields populated.
2. **History view is functional.** The Task History button toggles between project view and history view. History cards display correctly with all visual elements (timestamp, status, operation, summary, duration, source, scope, expandable details).
3. **Search and filtering work.** The search bar filters history entries by operation, summary, project number, issue number, and error message. The Org/Repo toggle filters by scope. Both filters compose.
4. **Real-time updates work.** New entries appear in the history view as they are recorded, with proper filtering and animation.
5. **No regressions.** All existing extension functionality (project display, caching, refresh, status updates, orchestration controls) continues to work without changes in behavior.
6. **Build passes.** `pnpm run compile` in `apps/code-ext` completes without errors.
7. **Performance meets budget.** History tracking adds < 1ms overhead per API call. History view renders 500 entries in < 100ms. Search filtering responds in < 50ms.

---

## Section 4: Rollout & Validation

### Validation Steps

1. **Unit validation:** Create a `HistoryTracker` instance and manually verify `record()`, `getEntries()`, `getFilteredEntries()`, `clear()`, `sanitizeParams()`, and `truncateResponse()` behave as specified.
2. **Integration validation:** Load the extension in VSCode, open a workspace with a GitHub repo. Perform several operations (refresh, toggle org/repo, expand project, change status). Open history view and verify all operations are recorded.
3. **Search validation:** With 20+ entries, use the search bar to filter by operation name, project number, and error messages. Verify results are correct and responsive.
4. **Scope filtering validation:** Toggle between Org and Repo views in history mode. Verify entries are correctly filtered.
5. **Real-time validation:** Keep history view open, trigger a refresh. Verify the new entry appears at the top with animation.
6. **Performance validation:** Record 500 entries (programmatically or by rapid refreshing). Verify history view loads in < 100ms and search responds in < 50ms.
7. **Regression validation:** After all changes, verify project cards, caching, orchestration controls, search in project view, and all toolbar buttons work as before.
8. **Theme validation:** Switch between light and dark VSCode themes. Verify history cards are readable in both.

### Rollout Plan

- Phase 1 and Phase 2 can be developed and merged independently (backend-only, no UI changes).
- Phase 3 and Phase 4 should be developed sequentially (Phase 3 provides the rendering foundation that Phase 4 extends).
- Each phase should be verified with `pnpm run compile` before merging.

---

## Section 5: Open Questions

1. **MCP tool tracking granularity:** The PFB recommends tracking at the extension level. If future requirements demand tracking at the MCP server level (to capture calls from non-extension clients), the `ToolRegistry.executeTool()` method in `packages/mcp-server/src/tools/registry.ts` already has logging infrastructure that could be extended with a callback pattern. Deferred for now.

2. **Raw GraphQL query text:** The PFB recommends excluding full query strings. This PRD follows that recommendation -- only the operation name and sanitized variables are stored. If debugging needs arise, the existing Output channel logging remains available.

3. **Pagination/virtual scrolling:** With a 500-entry cap and simple DOM rendering, pagination is deferred. If performance testing during Phase 3 reveals issues, a virtual scrolling approach can be added as a follow-up work item.

4. **Clear Cache vs. Clear History:** These are kept separate per the PFB recommendation. The Clear Cache button (trash icon) in the toolbar clears GitHub data cache. The Clear History button (in the history view header) clears only the API call history.

5. **Time range filtering:** Deferred per the PFB recommendation. The search bar and scope toggle provide sufficient filtering for v1.

6. **Relative timestamp updates:** This PRD specifies timestamps as static at render time (v1). A future enhancement could add a periodic update interval. The `formatRelativeTime()` function is designed to support re-rendering.
