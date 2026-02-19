# Product Requirements Document: Desktop Menu Bar Agent Monitor

## 0. Source Context

- **Feature Brief:** `./pfb.md`
- **Feature Name:** Desktop Menu Bar Agent Monitor
- **PRD Owner:** Stoked Consulting
- **Last Updated:** 2026-01-28
- **Version:** 1.0

---

## 1. Objectives & Constraints

### 1.1 Goals

1. **Feature Parity**: Deliver all core monitoring and control capabilities from the VSCode extension in a native menu bar application
2. **Instant Access**: Provide sub-2-second access to agent status and controls from anywhere in the operating system
3. **Shared Core**: Extract 70%+ of business logic into reusable packages consumed by both VSCode extension and menu bar app
4. **Real-Time Updates**: Deliver agent status updates within 5 seconds of state changes
5. **Cross-Platform Architecture**: Support macOS initially, with architecture that enables Windows and Linux in future releases

### 1.2 Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| App launch time | < 2 seconds | Automated performance testing |
| Agent status update latency | < 5 seconds | WebSocket event-to-UI timing |
| Shared code percentage | > 70% | Lines of code analysis (shared packages vs app-specific) |
| User adoption | 50% of VSCode extension users | Analytics tracking |
| Emergency stop response time | < 1 second | Time from click to SIGKILL signal |
| Memory footprint | < 100MB idle | Process monitoring |
| CPU usage (idle) | < 1% | Process monitoring |

### 1.3 Constraints

1. **Framework Limits**: Menu bar apps have constrained UI real estate; design must prioritize information density
2. **Background Process Overhead**: Must maintain minimal resource usage when idle (< 1% CPU, < 100MB RAM)
3. **Native OS Integration**: Different platforms have different system tray APIs and behaviors
4. **Security Model**: Cannot store sensitive tokens in plain text; must use OS keychain/credential store
5. **Startup Time**: Menu bar apps should be ready within 2 seconds of launch
6. **Code Sharing Strategy**: Must define clear boundaries for shared packages vs platform-specific code
7. **Backwards Compatibility**: Changes to shared core must not break existing VSCode extension

### 1.4 Assumptions

1. **Shared File System**: Menu bar app and VSCode extension share access to workspace directories (`.claude-sessions/`, signal files)
2. **Local State Tracking API**: The NestJS State Tracking API (`packages/api/`) is running or reachable
3. **WebSocket Availability**: Real-time updates rely on WebSocket connections to the notification server
4. **GitHub Authentication**: Users have authenticated via existing OAuth flow (tokens stored securely)
5. **Single User**: The app monitors agents for a single authenticated user (not multi-tenant)
6. **Agent Architecture Stability**: The file-based IPC model (`.claude-sessions/{session_id}.signal`) remains stable

---

## 2. Execution Phases

### Phase 1: Foundation - Shared Core Extraction

**Purpose:** Extract platform-agnostic business logic from the VSCode extension into standalone packages that can be consumed by both the VSCode extension and the new menu bar application. This phase must complete first because all subsequent phases depend on the shared packages for core functionality.

#### Work Item 1.1: Extract GitHub API Package

Extract the GitHub GraphQL client and related types into `@stoked-projects/github-api`.

**Implementation Details:**
- **Systems Affected:** `apps/code-ext/src/github-api.ts` (source), new `packages/github-api/` directory
- **Inputs:** Current `GitHubAPI` class with VSCode authentication dependency
- **Outputs:** Platform-agnostic `GitHubAPIClient` class accepting token injection
- **Core Logic:**
  - Remove `vscode.authentication` dependency
  - Create `AuthProvider` interface for token retrieval
  - Preserve all GraphQL queries and mutations
  - Export `Project`, `ProjectItem`, and related interfaces
- **Failure Modes:**
  - Authentication abstraction breaks VSCode extension: Mitigate with adapter pattern
  - Import path changes cause build failures: Mitigate with barrel exports

**Acceptance Criteria:**
- AC-1.1.a: When `github-api.ts` logic is extracted to `@stoked-projects/github-api` package -> import paths update without breaking VSCode extension build (`pnpm run compile` succeeds)
- AC-1.1.b: When `GitHubAPIClient` is instantiated with a token provider -> all existing GraphQL operations (getLinkedProjects, getProjectItems, getOrganizationProjects) return identical results
- AC-1.1.c: When `AuthProvider` interface is implemented for VSCode -> `vscode.authentication.getSession` is called correctly

**Acceptance Tests:**
- Test-1.1.a: Unit test validates `GitHubAPIClient.getLinkedProjects()` returns expected `Project[]` type structure
- Test-1.1.b: Integration test confirms VSCode extension builds successfully with new package import
- Test-1.1.c: Unit test validates AuthProvider interface accepts async token retrieval function

#### Work Item 1.2: Extract Phase Logic Package

Extract phase grouping and status calculation logic into `@stoked-projects/core`.

**Implementation Details:**
- **Systems Affected:** `apps/code-ext/src/phase-logic.ts` (source), new `packages/core/` directory
- **Inputs:** `ProjectItem` interface, phase detection regex patterns
- **Outputs:** `PhaseInfo`, `isPhaseMaster()`, `extractPhaseInfo()`, `groupItemsByPhase()`, `calculatePhaseStatus()` functions
- **Core Logic:**
  - Extract all regex patterns for phase detection (e.g., `[Phase N]`, `[PN-WX]`, `(Phase N.M)`)
  - Preserve master item resolution logic (MASTER keyword priority)
  - Maintain status calculation algorithm (all done -> Done, any in progress -> In Progress)
- **Failure Modes:**
  - Regex changes alter grouping behavior: Mitigate with comprehensive test suite
  - Type mismatches between packages: Mitigate with shared type definitions

**Acceptance Criteria:**
- AC-1.2.a: When phase-logic functions are imported from `@stoked-projects/core` -> phase grouping produces identical results to current implementation
- AC-1.2.b: When `isPhaseMaster()` is called with various title formats -> detection matches current behavior for all patterns (`[Phase N]`, `(Phase N)`, `Phase N:`, `MASTER`)
- AC-1.2.c: When `calculatePhaseStatus()` is called with work items -> status transitions match documented logic

**Acceptance Tests:**
- Test-1.2.a: Unit test validates `groupItemsByPhase()` with 10+ items containing mixed phase formats returns correct groupings
- Test-1.2.b: Unit test validates `isPhaseMaster()` returns true for `[Phase 1] Foundation` and false for `[P1-W1] Setup Database`
- Test-1.2.c: Unit test validates `calculatePhaseStatus()` returns `Done` when all work items have status `Done`

#### Work Item 1.3: Extract Agent Monitor Package

Extract agent session management, heartbeat, and emergency controls into `@stoked-projects/agent-monitor`.

**Implementation Details:**
- **Systems Affected:**
  - `apps/code-ext/src/claude-monitor.ts`
  - `apps/code-ext/src/agent-session-manager.ts`
  - `apps/code-ext/src/agent-heartbeat.ts`
  - `apps/code-ext/src/emergency-controls.ts`
  - `apps/code-ext/src/agent-lifecycle.ts`
- **Inputs:** Workspace root path, file system access
- **Outputs:**
  - `ClaudeMonitor` class for signal file watching
  - `AgentSessionManager` for session CRUD
  - `AgentHeartbeatManager` for health monitoring
  - `EmergencyControls` for stop/restart operations
- **Core Logic:**
  - Remove VSCode-specific UI notifications (replace with event emitters)
  - Abstract terminal interaction behind interface
  - Preserve file-based IPC patterns (`.claude-sessions/*.signal`)
  - Maintain atomic file write patterns (temp file + rename)
- **Failure Modes:**
  - File watcher behavior differs across platforms: Mitigate with fallback polling
  - Process signaling differs across platforms: Mitigate with platform abstraction

**Acceptance Criteria:**
- AC-1.3.a: When `AgentSessionManager` is instantiated with workspace path -> CRUD operations on `.claude-sessions/agent-*.session` files work correctly
- AC-1.3.b: When `ClaudeMonitor` watches signal files -> state changes (`responding`, `stopped`, `idle`) are detected within 5 seconds
- AC-1.3.c: When `EmergencyControls.emergencyStopAllAgents()` is called -> all agent processes receive SIGKILL within 5 seconds

**Acceptance Tests:**
- Test-1.3.a: Unit test validates `AgentSessionManager.createAgentSession()` creates valid JSON file with expected schema
- Test-1.3.b: Integration test validates `ClaudeMonitor` emits event when signal file is modified
- Test-1.3.c: Unit test validates `EmergencyControls` logs actions to `emergency-actions.json`

#### Work Item 1.4: Extract Cost Tracker Package

Extract cost calculation and budget monitoring into `@stoked-projects/cost-tracker`.

**Implementation Details:**
- **Systems Affected:** `apps/code-ext/src/cost-tracker.ts` (source), new `packages/cost-tracker/` directory
- **Inputs:** Token usage data, model pricing, budget configuration
- **Outputs:**
  - `calculateCost()` function
  - `CostEntry`, `BudgetStatus`, `BudgetAlertLevel` types
  - Budget check functions
- **Core Logic:**
  - Preserve model pricing constants (sonnet, opus, haiku)
  - Extract cost log file I/O (atomic writes)
  - Remove VSCode notification dependency (replace with callback)
- **Failure Modes:**
  - Pricing changes require package update: Mitigate with configurable pricing
  - Log file corruption: Mitigate with existing atomic write pattern

**Acceptance Criteria:**
- AC-1.4.a: When `calculateCost()` is called with token usage -> cost matches expected formula (input + output per model pricing)
- AC-1.4.b: When `checkBudget()` is called -> `BudgetStatus` includes daily/monthly spend and remaining amounts
- AC-1.4.c: When spend crosses 50%/75%/90%/100% thresholds -> `BudgetAlertLevel` returns correct level

**Acceptance Tests:**
- Test-1.4.a: Unit test validates Opus model cost: 1M input tokens = $15, 1M output tokens = $75
- Test-1.4.b: Unit test validates `getDailySpend()` sums only entries from current date
- Test-1.4.c: Unit test validates `getBudgetAlertLevel()` returns `warning90` at 90% spend

#### Work Item 1.5: Update VSCode Extension to Use Shared Packages

Refactor the VSCode extension to import from shared packages instead of local files.

**Implementation Details:**
- **Systems Affected:** All files in `apps/code-ext/src/` that import extracted modules
- **Inputs:** Extracted packages from Work Items 1.1-1.4
- **Outputs:** Updated import statements, adapter implementations for VSCode-specific features
- **Core Logic:**
  - Create VSCode-specific `AuthProvider` implementation
  - Create adapters for notification display (use `vscode.window.showInformationMessage`)
  - Update monorepo workspace configuration for cross-package dependencies
  - Ensure `pnpm run compile` and `pnpm run package` succeed
- **Failure Modes:**
  - Circular dependencies: Mitigate with dependency graph analysis
  - Build configuration issues: Mitigate with proper TypeScript project references

**Acceptance Criteria:**
- AC-1.5.a: When VSCode extension builds -> no direct imports from extracted source files remain (all from `@stoked-projects/*` packages)
- AC-1.5.b: When extension is loaded in VSCode -> all existing features work identically to pre-extraction behavior
- AC-1.5.c: When running `pnpm run compile` in `apps/code-ext` -> build succeeds without errors

**Acceptance Tests:**
- Test-1.5.a: Build verification test confirms no imports from `./phase-logic`, `./github-api`, `./cost-tracker`, `./agent-session-manager` in extension source
- Test-1.5.b: Manual test validates Projects view, Agent Dashboard, and Emergency Controls function correctly
- Test-1.5.c: CI pipeline builds and packages extension successfully

---

### Phase 2: Desktop App Shell

**Purpose:** Create the foundational Tauri application with menu bar integration, window management, and basic infrastructure. This phase must complete before feature development because it establishes the runtime environment and UI shell.

#### Work Item 2.1: Initialize Tauri Project

Set up the Tauri application with Rust backend and React frontend.

**Implementation Details:**
- **Systems Affected:** New `apps/menu-bar/` directory, monorepo configuration
- **Inputs:** Project requirements (menu bar app, minimal footprint)
- **Outputs:**
  - Tauri project structure with `src-tauri/` (Rust) and `src/` (React + TypeScript)
  - Build configuration for macOS
  - Development scripts in `package.json`
- **Core Logic:**
  - Use Tauri v2 for system tray support
  - Configure React with TypeScript and Vite
  - Set up hot module replacement for development
  - Configure code signing for macOS
- **Failure Modes:**
  - Rust toolchain issues: Mitigate with detailed setup documentation
  - Tauri v2 API changes: Mitigate with pinned versions

**Acceptance Criteria:**
- AC-2.1.a: When `pnpm run tauri dev` is executed -> development window opens within 10 seconds
- AC-2.1.b: When `pnpm run tauri build` is executed -> macOS `.dmg` is produced
- AC-2.1.c: When app is built -> bundle size is under 15MB

**Acceptance Tests:**
- Test-2.1.a: Build script test validates `tauri dev` starts successfully
- Test-2.1.b: Build script test validates `tauri build` produces valid DMG
- Test-2.1.c: Build artifact size test confirms bundle < 15MB

#### Work Item 2.2: Implement Menu Bar Integration

Create the system tray icon and menu bar panel behavior.

**Implementation Details:**
- **Systems Affected:** `apps/menu-bar/src-tauri/src/main.rs`, `apps/menu-bar/src-tauri/tauri.conf.json`
- **Inputs:** Status indicator requirements (green/yellow/red), panel dimensions
- **Outputs:**
  - System tray icon with status color
  - Popover panel on click (400x600px default)
  - Context menu on right-click
- **Core Logic:**
  - Use Tauri's `SystemTray` API
  - Implement custom icon rendering for status colors
  - Handle click events to show/hide panel
  - Implement window positioning relative to tray icon
- **Failure Modes:**
  - macOS notarization blocks tray: Mitigate with proper entitlements
  - Panel positioning edge cases: Mitigate with screen bounds checking

**Acceptance Criteria:**
- AC-2.2.a: When app launches -> system tray icon appears in macOS menu bar
- AC-2.2.b: When tray icon is clicked -> popover panel appears within 200ms
- AC-2.2.c: When aggregate agent status changes -> icon color updates (green=healthy, yellow=warning, red=error)

**Acceptance Tests:**
- Test-2.2.a: UI test validates tray icon is visible after app launch
- Test-2.2.b: Performance test validates panel open time < 200ms
- Test-2.2.c: Integration test validates icon color changes when status event is emitted

#### Work Item 2.3: Configure Authentication and Secure Storage

Implement GitHub OAuth and secure token storage using macOS Keychain.

**Implementation Details:**
- **Systems Affected:** `apps/menu-bar/src-tauri/src/auth.rs`, `apps/menu-bar/src/auth/`
- **Inputs:** GitHub OAuth app credentials, keychain access requirements
- **Outputs:**
  - OAuth flow implementation
  - Keychain storage/retrieval for access tokens
  - `AuthProvider` implementation for `@stoked-projects/github-api`
- **Core Logic:**
  - Implement OAuth PKCE flow for desktop app
  - Use `keyring` Rust crate for keychain access
  - Implement token refresh logic
  - Handle authentication errors gracefully
- **Failure Modes:**
  - Keychain access denied: Mitigate with clear permission request UI
  - OAuth redirect handling: Mitigate with custom protocol handler

**Acceptance Criteria:**
- AC-2.3.a: When user clicks "Sign in with GitHub" -> OAuth flow completes and token is stored in Keychain
- AC-2.3.b: When app launches with stored token -> user is automatically authenticated
- AC-2.3.c: When token expires -> refresh flow is triggered automatically

**Acceptance Tests:**
- Test-2.3.a: Manual test validates full OAuth flow from unauthenticated state
- Test-2.3.b: Integration test validates token retrieval from Keychain
- Test-2.3.c: Unit test validates token refresh triggers when expiry is within 5 minutes

#### Work Item 2.4: Implement State Management Layer

Set up frontend state management using Zustand with persistence.

**Implementation Details:**
- **Systems Affected:** `apps/menu-bar/src/store/`, `apps/menu-bar/src/hooks/`
- **Inputs:** Data models from shared packages, UI state requirements
- **Outputs:**
  - Zustand stores for projects, agents, settings
  - Custom React hooks for data access
  - State persistence configuration
- **Core Logic:**
  - Create `useProjectsStore` with project list and phase data
  - Create `useAgentsStore` with agent status and health
  - Create `useSettingsStore` with user preferences
  - Implement middleware for state persistence
- **Failure Modes:**
  - State deserialization errors: Mitigate with schema versioning
  - Store initialization race conditions: Mitigate with loading states

**Acceptance Criteria:**
- AC-2.4.a: When projects are fetched -> `useProjectsStore` state updates and triggers re-render
- AC-2.4.b: When agent status changes -> `useAgentsStore` reflects new status within 1 second
- AC-2.4.c: When app restarts -> user preferences persist from previous session

**Acceptance Tests:**
- Test-2.4.a: Unit test validates store updates trigger component re-renders
- Test-2.4.b: Integration test validates real-time state updates from WebSocket
- Test-2.4.c: E2E test validates settings persistence across app restart

---

### Phase 3: Core Features

**Purpose:** Implement the primary user-facing features: projects view, agent dashboard, and session monitoring. This phase depends on the shared packages (Phase 1) and app shell (Phase 2).

#### Work Item 3.1: Implement Projects View

Create the projects list with phase-based organization and status indicators.

**Implementation Details:**
- **Systems Affected:** `apps/menu-bar/src/components/ProjectsView/`, `apps/menu-bar/src/store/projectsStore.ts`
- **Inputs:** `@stoked-projects/github-api` for data, `@stoked-projects/core` for phase logic
- **Outputs:**
  - Projects list component
  - Phase accordion component
  - Work item list component
  - Status badge component
- **Core Logic:**
  - Fetch projects using `GitHubAPIClient`
  - Group items by phase using `groupItemsByPhase()`
  - Display status indicators (Todo, In Progress, Done)
  - Implement expandable/collapsible sections
- **Failure Modes:**
  - Large project lists: Mitigate with virtualization
  - API rate limiting: Mitigate with caching

**Acceptance Criteria:**
- AC-3.1.a: When authenticated user opens Projects view -> linked projects load within 3 seconds
- AC-3.1.b: When project with phases is displayed -> work items are grouped under phase headers
- AC-3.1.c: When work item status is "Done" -> green checkmark indicator is shown

**Acceptance Tests:**
- Test-3.1.a: E2E test validates projects load and display correctly
- Test-3.1.b: Unit test validates phase grouping matches `@stoked-projects/core` output
- Test-3.1.c: Visual regression test validates status indicator colors

#### Work Item 3.2: Implement Agent Dashboard

Create the real-time agent status grid with health indicators and controls.

**Implementation Details:**
- **Systems Affected:** `apps/menu-bar/src/components/AgentDashboard/`, `apps/menu-bar/src/store/agentsStore.ts`
- **Inputs:** `@stoked-projects/agent-monitor` for status data
- **Outputs:**
  - Agent card component
  - Health status indicator
  - Progress bar component
  - Quick action buttons (pause, resume, stop)
- **Core Logic:**
  - Poll agent session files via Rust backend
  - Display health status (healthy/degraded/unresponsive)
  - Show current task and elapsed time
  - Implement action handlers for pause/resume/stop
- **Failure Modes:**
  - Session file not found: Mitigate with graceful error display
  - Action fails: Mitigate with retry mechanism and user feedback

**Acceptance Criteria:**
- AC-3.2.a: When agents are running -> dashboard displays all active agents with status
- AC-3.2.b: When agent health degrades -> indicator changes from green to yellow within 5 seconds
- AC-3.2.c: When "Pause" button is clicked -> agent status changes to paused and UI updates

**Acceptance Tests:**
- Test-3.2.a: Integration test validates agent data loads from session files
- Test-3.2.b: Unit test validates health indicator color mapping
- Test-3.2.c: E2E test validates pause/resume/stop actions work correctly

#### Work Item 3.3: Implement Session Monitoring

Create the active sessions list with auto-continuation status.

**Implementation Details:**
- **Systems Affected:** `apps/menu-bar/src/components/SessionMonitor/`
- **Inputs:** `@stoked-projects/agent-monitor` ClaudeMonitor class
- **Outputs:**
  - Sessions list component
  - Session card with status
  - Response file preview
  - Auto-continuation toggle
- **Core Logic:**
  - List active Claude sessions from `.claude-sessions/`
  - Display session type (execution vs creation)
  - Show last signal state
  - Preview response file content
- **Failure Modes:**
  - Many concurrent sessions: Mitigate with pagination
  - Large response files: Mitigate with truncation

**Acceptance Criteria:**
- AC-3.3.a: When Claude sessions are active -> all sessions appear in list with correct type
- AC-3.3.b: When session state changes -> UI updates within 5 seconds
- AC-3.3.c: When "View Response" is clicked -> response file content is displayed

**Acceptance Tests:**
- Test-3.3.a: Integration test validates session list populates from file system
- Test-3.3.b: E2E test validates real-time status updates
- Test-3.3.c: UI test validates response preview modal opens and displays content

#### Work Item 3.4: Implement Cost Tracking Display

Create the cost and budget monitoring UI.

**Implementation Details:**
- **Systems Affected:** `apps/menu-bar/src/components/CostTracker/`
- **Inputs:** `@stoked-projects/cost-tracker` package
- **Outputs:**
  - Daily/monthly spend display
  - Budget progress bars
  - Alert indicators
  - Per-agent cost breakdown
- **Core Logic:**
  - Read cost log from `.claude-sessions/cost-log.json`
  - Calculate daily and monthly totals
  - Display progress toward budget limits
  - Show alert indicators at thresholds
- **Failure Modes:**
  - Cost log corrupted: Mitigate with fallback display
  - Stale data: Mitigate with refresh mechanism

**Acceptance Criteria:**
- AC-3.4.a: When cost log exists -> daily and monthly spend are displayed correctly
- AC-3.4.b: When spend exceeds 50% of daily budget -> warning indicator is shown
- AC-3.4.c: When viewing per-agent breakdown -> costs are attributed to correct agents

**Acceptance Tests:**
- Test-3.4.a: Unit test validates spend calculation from cost log entries
- Test-3.4.b: Visual test validates warning indicator appears at 50% threshold
- Test-3.4.c: Unit test validates cost aggregation by agent ID

#### Work Item 3.5: Implement Emergency Controls

Create the emergency stop and recovery UI.

**Implementation Details:**
- **Systems Affected:** `apps/menu-bar/src/components/EmergencyControls/`
- **Inputs:** `@stoked-projects/agent-monitor` EmergencyControls class
- **Outputs:**
  - Emergency Stop All button (prominent)
  - Pause All / Resume All controls
  - Recovery options menu
  - Confirmation dialogs
- **Core Logic:**
  - Wire up `emergencyStopAllAgents()` with SIGKILL
  - Implement confirmation flow for destructive actions
  - Display recovery options based on system state
  - Log all emergency actions
- **Failure Modes:**
  - Stop fails: Mitigate with force kill fallback
  - User accidentally triggers: Mitigate with confirmation modal

**Acceptance Criteria:**
- AC-3.5.a: When "Emergency Stop All" is clicked -> confirmation dialog shows affected agents/projects count
- AC-3.5.b: When emergency stop is confirmed -> all agents stop within 5 seconds
- AC-3.5.c: When emergency action is executed -> action is logged with timestamp

**Acceptance Tests:**
- Test-3.5.a: UI test validates confirmation dialog displays correct counts
- Test-3.5.b: Integration test validates SIGKILL is sent to all agent processes
- Test-3.5.c: Unit test validates emergency action log entry is created

---

### Phase 4: Real-time Updates & Integration

**Purpose:** Implement real-time data synchronization via WebSocket connections and file watchers. This phase enhances features built in Phase 3 with live updates.

#### Work Item 4.1: Implement WebSocket Client

Create WebSocket connection to State Tracking API for real-time events.

**Implementation Details:**
- **Systems Affected:** `apps/menu-bar/src/services/websocket.ts`, Rust backend
- **Inputs:** State Tracking API WebSocket endpoint
- **Outputs:**
  - WebSocket connection manager
  - Event subscription system
  - Reconnection logic
- **Core Logic:**
  - Connect to `wss://api.example.com/ws` on app launch
  - Subscribe to agent status, project update events
  - Implement exponential backoff reconnection
  - Surface connection status to UI
- **Failure Modes:**
  - Connection drops: Mitigate with reconnection logic
  - Server unavailable: Mitigate with offline indicator

**Acceptance Criteria:**
- AC-4.1.a: When app launches -> WebSocket connects within 5 seconds
- AC-4.1.b: When connection drops -> reconnection attempts with exponential backoff
- AC-4.1.c: When event is received -> UI updates within 1 second

**Acceptance Tests:**
- Test-4.1.a: Integration test validates WebSocket connection establishment
- Test-4.1.b: Unit test validates reconnection backoff timing (1s, 2s, 4s, 8s...)
- Test-4.1.c: E2E test validates UI update on receiving mock event

#### Work Item 4.2: Implement File System Watchers

Create file watchers for local session and signal files.

**Implementation Details:**
- **Systems Affected:** `apps/menu-bar/src-tauri/src/watcher.rs`, Rust backend
- **Inputs:** Workspace paths to monitor
- **Outputs:**
  - Directory watcher for `.claude-sessions/`
  - Signal file change detection
  - Event bridge to frontend
- **Core Logic:**
  - Use `notify` Rust crate for file watching
  - Watch for `.signal` file modifications
  - Watch for `.session` file changes
  - Emit events to frontend via Tauri commands
- **Failure Modes:**
  - Watcher not triggered: Mitigate with polling fallback
  - Too many events: Mitigate with debouncing

**Acceptance Criteria:**
- AC-4.2.a: When signal file is modified -> frontend receives event within 1 second
- AC-4.2.b: When session file is created -> agent list updates automatically
- AC-4.2.c: When watching fails -> polling fallback activates within 5 seconds

**Acceptance Tests:**
- Test-4.2.a: Integration test validates file change triggers frontend event
- Test-4.2.b: E2E test validates new agent appears when session file is created
- Test-4.2.c: Unit test validates fallback polling mechanism

#### Work Item 4.3: Implement Workspace Discovery

Create workspace discovery to find all monitored directories.

**Implementation Details:**
- **Systems Affected:** `apps/menu-bar/src/services/workspace.ts`, settings UI
- **Inputs:** User-configured workspace paths, auto-discovery options
- **Outputs:**
  - Workspace configuration storage
  - Auto-discovery of `.claude-sessions/` directories
  - Workspace selector UI
- **Core Logic:**
  - Scan configured directories for `.claude-sessions/`
  - Support adding/removing workspace paths
  - Persist workspace configuration
  - Support git worktree detection
- **Failure Modes:**
  - Invalid path: Mitigate with validation
  - Permission denied: Mitigate with clear error message

**Acceptance Criteria:**
- AC-4.3.a: When workspace path is added -> sessions from that path appear in dashboard
- AC-4.3.b: When auto-discover is enabled -> workspaces with `.claude-sessions/` are found
- AC-4.3.c: When workspace is removed -> associated sessions are removed from display

**Acceptance Tests:**
- Test-4.3.a: E2E test validates adding workspace path surfaces sessions
- Test-4.3.b: Integration test validates auto-discovery finds test directories
- Test-4.3.c: UI test validates workspace removal clears associated data

#### Work Item 4.4: Integrate with State Tracking API

Connect to the NestJS State Tracking API for centralized state.

**Implementation Details:**
- **Systems Affected:** `apps/menu-bar/src/services/api.ts`
- **Inputs:** API base URL, authentication token
- **Outputs:**
  - API client wrapper
  - Error handling
  - Request caching
- **Core Logic:**
  - Implement REST client for State Tracking API endpoints
  - Send heartbeats from monitored agents
  - Fetch global agent state
  - Handle API errors gracefully
- **Failure Modes:**
  - API unreachable: Mitigate with local-only mode
  - Rate limiting: Mitigate with request queuing

**Acceptance Criteria:**
- AC-4.4.a: When API is reachable -> agent state syncs bidirectionally
- AC-4.4.b: When API is unreachable -> app continues with local file data
- AC-4.4.c: When agent heartbeat is sent -> API receives and stores correctly

**Acceptance Tests:**
- Test-4.4.a: Integration test validates API state sync
- Test-4.4.b: E2E test validates offline mode functionality
- Test-4.4.c: API test validates heartbeat endpoint receives data

---

### Phase 5: Polish & Platform

**Purpose:** Implement settings, theming, performance optimization, and prepare for release. This phase finalizes the product for end users.

#### Work Item 5.1: Implement Settings Panel

Create the settings/preferences UI.

**Implementation Details:**
- **Systems Affected:** `apps/menu-bar/src/components/Settings/`
- **Inputs:** User preference requirements
- **Outputs:**
  - Settings panel component
  - Workspace configuration UI
  - API endpoint configuration
  - Notification preferences
- **Core Logic:**
  - Group settings by category (Workspaces, API, Notifications, Appearance)
  - Persist settings to local storage
  - Apply settings changes in real-time where possible
  - Export/import settings
- **Failure Modes:**
  - Invalid input: Mitigate with validation
  - Settings corruption: Mitigate with defaults fallback

**Acceptance Criteria:**
- AC-5.1.a: When settings panel opens -> all current values are displayed correctly
- AC-5.1.b: When setting is changed -> change persists after app restart
- AC-5.1.c: When invalid value is entered -> validation error is shown

**Acceptance Tests:**
- Test-5.1.a: UI test validates settings panel displays current values
- Test-5.1.b: E2E test validates settings persistence
- Test-5.1.c: Unit test validates input validation rules

#### Work Item 5.2: Implement Theme Support

Add light/dark mode with system theme following.

**Implementation Details:**
- **Systems Affected:** `apps/menu-bar/src/styles/`, theme configuration
- **Inputs:** System theme preference, user override
- **Outputs:**
  - CSS custom properties for theming
  - Theme toggle in settings
  - System theme detection
- **Core Logic:**
  - Define color tokens for light and dark themes
  - Implement `prefers-color-scheme` media query support
  - Allow user override (light/dark/system)
  - Ensure WCAG 2.1 AA contrast compliance
- **Failure Modes:**
  - Theme flicker on load: Mitigate with SSR or blocking script
  - Inconsistent colors: Mitigate with design tokens

**Acceptance Criteria:**
- AC-5.2.a: When system theme is dark -> app renders in dark mode
- AC-5.2.b: When user selects "Light" override -> app switches to light mode regardless of system
- AC-5.2.c: When theme changes -> all components update without page refresh

**Acceptance Tests:**
- Test-5.2.a: Visual regression test validates dark mode appearance
- Test-5.2.b: E2E test validates theme override setting
- Test-5.2.c: Accessibility test validates color contrast ratios

#### Work Item 5.3: Performance Optimization

Optimize app launch time, memory usage, and rendering performance.

**Implementation Details:**
- **Systems Affected:** Build configuration, React components, Rust backend
- **Inputs:** Performance targets (< 2s launch, < 100MB memory, < 1% idle CPU)
- **Outputs:**
  - Optimized bundle (tree shaking, code splitting)
  - Memory-efficient data structures
  - Render optimization (memoization, virtualization)
- **Core Logic:**
  - Implement React.lazy for route-based code splitting
  - Add virtualization for long lists (agents, projects)
  - Profile and optimize Rust backend operations
  - Minimize background polling frequency
- **Failure Modes:**
  - Code splitting breaks: Mitigate with integration tests
  - Over-optimization: Mitigate with benchmarking

**Acceptance Criteria:**
- AC-5.3.a: When app cold starts -> UI is interactive within 2 seconds
- AC-5.3.b: When app is idle for 5 minutes -> memory usage stays under 100MB
- AC-5.3.c: When app is idle -> CPU usage stays under 1%

**Acceptance Tests:**
- Test-5.3.a: Performance test measures cold start time
- Test-5.3.b: Memory profiling test validates idle memory
- Test-5.3.c: Resource monitoring test validates idle CPU

#### Work Item 5.4: Auto-Update Mechanism

Implement automatic app updates using Tauri's updater.

**Implementation Details:**
- **Systems Affected:** `apps/menu-bar/src-tauri/tauri.conf.json`, update server
- **Inputs:** Update server URL, signing keys
- **Outputs:**
  - Update check on launch
  - Update notification UI
  - Background download and install
- **Core Logic:**
  - Configure Tauri updater with update endpoint
  - Check for updates on app launch and periodically
  - Show update available notification
  - Download and apply update with user consent
- **Failure Modes:**
  - Update fails: Mitigate with rollback mechanism
  - Signature verification fails: Mitigate with clear error

**Acceptance Criteria:**
- AC-5.4.a: When new version is available -> notification appears within 24 hours
- AC-5.4.b: When user accepts update -> download begins and progress is shown
- AC-5.4.c: When update completes -> app restarts with new version

**Acceptance Tests:**
- Test-5.4.a: Integration test validates update check against mock server
- Test-5.4.b: E2E test validates update download flow
- Test-5.4.c: Manual test validates post-update app version

#### Work Item 5.5: Documentation and Release

Prepare documentation and release artifacts.

**Implementation Details:**
- **Systems Affected:** Documentation, CI/CD, distribution
- **Inputs:** Feature documentation needs, release checklist
- **Outputs:**
  - User documentation
  - Developer setup guide
  - macOS DMG with notarization
  - GitHub release
- **Core Logic:**
  - Write user guide with screenshots
  - Document architecture for developers
  - Configure GitHub Actions for release builds
  - Set up notarization for macOS distribution
- **Failure Modes:**
  - Notarization fails: Mitigate with retry and manual submission
  - CI build fails: Mitigate with local build fallback

**Acceptance Criteria:**
- AC-5.5.a: When user downloads DMG -> installation completes without Gatekeeper warnings
- AC-5.5.b: When developer reads setup guide -> they can build app locally within 30 minutes
- AC-5.5.c: When new tag is pushed -> GitHub Action produces signed release artifacts

**Acceptance Tests:**
- Test-5.5.a: Manual test validates DMG installation on clean macOS
- Test-5.5.b: Manual test validates developer setup on clean machine
- Test-5.5.c: CI test validates release workflow produces artifacts

---

## 3. Completion Criteria

The Desktop Menu Bar Agent Monitor is considered complete when all of the following criteria are met:

### 3.1 Functional Completeness

- [ ] All Phase 1-5 work items pass their acceptance tests
- [ ] Feature parity with VSCode extension for monitoring/control use cases
- [ ] Emergency controls function correctly (stop within 5 seconds)

### 3.2 Performance Requirements

- [ ] App launch time < 2 seconds (cold start)
- [ ] Idle memory usage < 100MB
- [ ] Idle CPU usage < 1%
- [ ] Agent status updates within 5 seconds

### 3.3 Code Quality

- [ ] Shared packages extracted with > 70% code reuse
- [ ] VSCode extension builds and functions correctly with shared packages
- [ ] All TypeScript strict mode errors resolved
- [ ] Test coverage > 70% for shared packages

### 3.4 Release Readiness

- [ ] macOS DMG is notarized and installable
- [ ] Auto-update mechanism is functional
- [ ] User documentation is complete
- [ ] No critical or high severity bugs open

---

## 4. Rollout & Validation

### 4.1 Alpha Release (Internal)

**Duration:** 2 weeks

**Participants:** Development team

**Validation:**
- Install on multiple macOS versions (12, 13, 14)
- Use alongside VSCode extension
- Test all emergency controls
- Monitor resource usage over extended periods

**Success Criteria:**
- No crashes over 24-hour period
- All documented features work
- Performance targets met

### 4.2 Beta Release (Limited)

**Duration:** 4 weeks

**Participants:** 10-20 external users (existing VSCode extension users)

**Validation:**
- Daily usage feedback collection
- Performance telemetry (opt-in)
- Bug report triage

**Success Criteria:**
- Net Promoter Score > 7
- < 5 critical bugs reported
- 80% of beta users continue using after 2 weeks

### 4.3 General Availability

**Conditions for GA:**
- All beta feedback addressed
- Documentation reviewed by external user
- 48-hour soak test passed
- Release notes published

**Launch Activities:**
- GitHub release with changelog
- Documentation site update
- Announcement to existing users

---

## 5. Open Questions

### 5.1 Resolved Questions

| Question | Resolution | Date |
|----------|------------|------|
| Electron vs Tauri? | Tauri selected for smaller bundle size (~10MB vs ~100MB) | TBD |

### 5.2 Outstanding Questions

| ID | Question | Owner | Target Resolution Date |
|----|----------|-------|------------------------|
| OQ-1 | Should the menu bar app be able to start new agent sessions? | Product | Phase 3 start |
| OQ-2 | How should multi-workspace be handled in the UI? | Design | Phase 3 start |
| OQ-3 | Should we support Windows/Linux in v1.0 or defer? | Product | Phase 2 end |
| OQ-4 | What analytics/telemetry should be included? | Product | Phase 5 start |
| OQ-5 | Should tokens be shared with VSCode extension via keychain? | Engineering | Phase 2 start |

---

*Document Version: 1.0*
*Generated: 2026-01-28*
*Author: Claude (PRD generated from Product Feature Brief)*
