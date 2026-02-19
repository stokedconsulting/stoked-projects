# Product Requirements Document (Sequential)

## 0. Source Context
**Derived From:** Feature Brief
**Feature Name:** Multi-Agent Autonomous Project Orchestration System
**PRD Owner:** TBD
**Last Updated:** 2026-01-26

### Feature Brief Summary
An autonomous multi-agent system that enables concurrent Claude AI agents to independently execute GitHub Projects, validate completion quality, and self-generate new improvement projects across 21 defined categories. Each workspace configures agent concurrency, with agents working one project at a time through completion, peer review, and iterative refinement. When project queues are empty, agents autonomously ideate and create new projects using category-specific prompts, creating a self-sustaining continuous improvement loop.

**Problem Statement:** Current Claude project orchestration requires manual project creation, sequential execution, and human-driven quality validation. This creates bottlenecks in continuous improvement workflows and limits the scale at which codebases can evolve.

**Success Metrics:**
- Projects completed per agent per day: >2 (target: 3-5)
- Review cycles required per project: <3 average
- Self-generated projects per week per category: >1
- CI/CD pass rate: >95% for agent-completed projects

---

## 1. Objectives & Constraints

### Objectives
- **Enable parallel autonomous execution:** Allow N configurable agents to work concurrently on different projects without manual coordination
- **Establish quality gates:** Implement agent-based peer review with acceptance criteria validation and iterative refinement
- **Create self-sustaining improvement loop:** Agents autonomously generate new projects when queues empty, across all 21 improvement categories
- **Provide visibility and control:** Real-time monitoring of agent activity with manual override capabilities
- **Manage cost and safety:** Configurable spend limits, rate limiting, and emergency stop controls

### Constraints
- **Technical:** Must use existing `.claude-sessions/` file-based IPC; NestJS State Tracking API for session monitoring; VS Code extension for UI
- **Infrastructure:** Local execution initially; file system as state store; one session file per agent
- **Authentication:** Reuse existing GitHub OAuth and VS Code authentication flows
- **Branch strategy:** One branch per agent-project combination; merge to main only after approval
- **Cost limits:** Hard stop when daily/monthly budgets exceeded; no credit-based continuation
- **Concurrent agents:** Maximum 10 agents per workspace to prevent resource exhaustion
- **Category prompts:** 21 pre-defined categories with fixed prompt templates

---

## 2. Execution Phases

> Phases below are ordered and sequential.
> A phase cannot begin until all acceptance criteria of the previous phase are met.

---

## Phase 1: Foundation - Agent State Management & Configuration
**Purpose:** Establish core infrastructure for multi-agent coordination, workspace configuration, and state persistence. All subsequent phases depend on reliable agent session management and configuration.

### 1.1 Workspace Agent Configuration
Add workspace-level settings to control agent concurrency and behavior.

**Implementation Details**
- Systems affected: VS Code extension (`apps/code-ext/src/extension.ts`), workspace settings schema
- Add configuration schema to `package.json`:
  - `claudeProjects.agents.maxConcurrent`: number (1-10, default: 1)
  - `claudeProjects.agents.dailyBudgetUSD`: number (default: 50)
  - `claudeProjects.agents.monthlyBudgetUSD`: number (default: 500)
  - `claudeProjects.agents.enabledCategories`: string array (default: all 21 categories)
- Load configuration on extension activation
- Validate configuration values (max concurrent <= 10, budgets > 0)
- Failure modes: Invalid config values should default to safe minimums with warning notifications

**Acceptance Criteria**
- AC-1.1.a: When workspace settings file is updated with valid `claudeProjects.agents` configuration → settings are loaded successfully within 2 seconds
- AC-1.1.b: When `maxConcurrent` is set to value > 10 → extension displays warning and caps value at 10
- AC-1.1.c: When daily/monthly budgets are set to negative values → extension displays error and uses default values
- AC-1.1.d: When `enabledCategories` contains invalid category names → extension filters out invalid entries and logs warning

**Acceptance Tests**
- Test-1.1.a: Unit test validates schema parsing and default value application
- Test-1.1.b: Integration test verifies configuration reload on workspace settings change
- Test-1.1.c: E2E test confirms extension activation with various config combinations
- Test-1.1.d: Edge case test validates behavior with malformed JSON config

---

### 1.2 Agent Session File Management
Create file-based state tracking for individual agent sessions using `.claude-sessions/` directory.

**Implementation Details**
- Systems affected: New module `apps/code-ext/src/agent-session-manager.ts`, `.claude-sessions/` directory
- File naming convention: `.claude-sessions/agent-{id}.session` where `id` is 1-based integer
- Session file schema (JSON):
  ```json
  {
    "agentId": "agent-1",
    "status": "idle|working|reviewing|ideating|paused",
    "currentProjectNumber": null | number,
    "currentPhase": null | string,
    "branchName": null | string,
    "lastHeartbeat": ISO8601 timestamp,
    "tasksCompleted": number,
    "currentTaskDescription": null | string,
    "errorCount": number,
    "lastError": null | string
  }
  ```
- Atomic file writes using temp file + rename pattern to prevent corruption
- Validation on read with auto-recovery: invalid files recreated with default idle state
- Auto-create directory on first agent spawn
- Failure modes: File system errors should not crash extension; log error and retry with exponential backoff

**Acceptance Criteria**
- AC-1.2.a: When workspace is configured with N agents → N session files are created in `.claude-sessions/` within 5 seconds
- AC-1.2.b: When session file is updated → changes are written atomically without corruption risk
- AC-1.2.c: When session file becomes corrupted or invalid JSON → file is recreated with default idle state and corruption is logged
- AC-1.2.d: When `.claude-sessions/` directory doesn't exist → directory is created automatically before first write
- AC-1.2.e: When file write fails due to permissions → error is logged and retry occurs with 1s, 2s, 4s backoff (max 3 retries)

**Acceptance Tests**
- Test-1.2.a: Unit test validates JSON schema serialization/deserialization
- Test-1.2.b: Integration test simulates concurrent writes to different agent files (no conflicts)
- Test-1.2.c: Stress test validates atomic write behavior under rapid successive updates
- Test-1.2.d: Failure injection test simulates file corruption and validates recovery logic
- Test-1.2.e: Permission test validates behavior with read-only `.claude-sessions/` directory

---

### 1.3 Agent Heartbeat & Health Monitoring
Implement periodic heartbeat updates and health status tracking for all active agents.

**Implementation Details**
- Systems affected: `agent-session-manager.ts`, State Tracking API (`packages/api/src/modules/agents/`)
- Heartbeat interval: Every 30 seconds per agent
- Heartbeat payload includes: `agentId`, `status`, `currentProjectNumber`, `timestamp`, `memoryUsage`, `cpuUsage`
- State Tracking API stores heartbeat history (last 10 heartbeats per agent) in MongoDB
- Health status calculation:
  - **Healthy:** Last heartbeat < 60 seconds ago
  - **Degraded:** Last heartbeat 60-120 seconds ago
  - **Unresponsive:** Last heartbeat > 120 seconds ago
- Extension polls State Tracking API every 10 seconds for agent health summaries
- Failure modes: Network errors during heartbeat should not kill agent; log warning and continue

**Acceptance Criteria**
- AC-1.3.a: When agent is actively working → heartbeat is sent every 30 seconds with current status
- AC-1.3.b: When agent misses heartbeat window → health status transitions to "degraded" after 60s and "unresponsive" after 120s
- AC-1.3.c: When State Tracking API is unreachable → extension displays warning but agents continue working
- AC-1.3.d: When agent crashes → final heartbeat marks status as "crashed" and includes error details
- AC-1.3.e: When extension queries agent health → State Tracking API responds with summary within 500ms

**Acceptance Criteria**
- Test-1.3.a: Unit test validates heartbeat payload structure and serialization
- Test-1.3.b: Integration test verifies heartbeat storage and retrieval from State Tracking API
- Test-1.3.c: E2E test simulates agent lifecycle (start → working → idle → stopped) with heartbeat tracking
- Test-1.3.d: Failure injection test simulates network outage during heartbeat and validates retry logic
- Test-1.3.e: Performance test validates heartbeat processing for 10 concurrent agents

---

### 1.4 Agent Lifecycle Management
Create start, pause, resume, and stop operations for individual agents.

**Implementation Details**
- Systems affected: `agent-session-manager.ts`, new module `apps/code-ext/src/agent-lifecycle.ts`
- Agent spawning: Each agent runs as a separate Claude Code session via `claude-session-wrapper.sh`
- Operations:
  - **Start:** Creates session file, spawns child process, sets status to "idle"
  - **Pause:** Sets session file status to "paused", sends SIGSTOP to process
  - **Resume:** Sets status to "idle", sends SIGCONT to process
  - **Stop:** Sets status to "stopped", sends SIGTERM to process, waits 5s, then SIGKILL if needed
- Session persistence: On stop, save current state to allow resumption
- Cleanup: On extension deactivation, gracefully stop all agents with 10s timeout
- Failure modes: Process spawn failures should log error and mark agent as "failed"

**Acceptance Criteria**
- AC-1.4.a: When "start agent" command is invoked → agent process spawns within 3 seconds and status transitions to "idle"
- AC-1.4.b: When "pause agent" command is invoked on running agent → agent status becomes "paused" and no new tasks are picked up
- AC-1.4.c: When "resume agent" command is invoked on paused agent → agent status returns to "idle" and resumes task pickup
- AC-1.4.d: When "stop agent" command is invoked → agent gracefully stops within 5 seconds or is force-killed
- AC-1.4.e: When extension deactivates with active agents → all agents stop gracefully within 10 seconds total
- AC-1.4.f: When agent process crashes unexpectedly → session file is updated with "crashed" status and error details

**Acceptance Tests**
- Test-1.4.a: Unit test validates state transitions (idle → working → paused → idle → stopped)
- Test-1.4.b: Integration test verifies process spawn and signal handling
- Test-1.4.c: E2E test validates full lifecycle: start → pause → resume → stop
- Test-1.4.d: Failure injection test simulates process spawn failure and validates error handling
- Test-1.4.e: Stress test validates starting/stopping 10 agents concurrently
- Test-1.4.f: Timeout test validates force-kill behavior when graceful stop fails

---

### 1.5 Agent Dashboard UI (Sidebar Webview)
Create VS Code sidebar panel displaying real-time agent status and controls.

**Implementation Details**
- Systems affected: New module `apps/code-ext/src/agent-dashboard-provider.ts`, new webview files `media/agent-dashboard.html`, `media/agent-dashboard.js`, `media/agent-dashboard.css`
- Dashboard layout:
  - Header: Total agents, active count, paused count, stopped count
  - Per-agent card: Agent ID, status badge, current project number, current phase, elapsed time, controls (pause/resume/stop)
  - Footer: "Add Agent" button (if < maxConcurrent), "Emergency Stop All" button
- Status badges: Color-coded (green=working, yellow=idle, blue=reviewing, purple=ideating, gray=paused, red=crashed)
- Auto-refresh: Poll session files every 2 seconds and update UI
- Manual controls: Pause/resume/stop buttons trigger lifecycle operations via postMessage to extension
- Failure modes: UI errors should not crash extension; display error banner in dashboard

**Acceptance Criteria**
- AC-1.5.a: When dashboard is opened → all active agents are displayed with current status within 2 seconds
- AC-1.5.b: When agent status changes → dashboard updates within 2 seconds without manual refresh
- AC-1.5.c: When "pause" button is clicked on running agent → agent pauses and button changes to "resume"
- AC-1.5.d: When "Emergency Stop All" is clicked → all agents stop within 5 seconds and confirmation dialog is shown first
- AC-1.5.e: When agent crashes → status badge turns red and error message is displayed in agent card
- AC-1.5.f: When "Add Agent" is clicked and agent count < maxConcurrent → new agent is created and appears in dashboard within 3 seconds

**Acceptance Tests**
- Test-1.5.a: Unit test validates webview message handling and state synchronization
- Test-1.5.b: Integration test verifies dashboard reflects session file changes
- Test-1.5.c: E2E test validates full user workflow: open dashboard → start agent → pause → resume → stop
- Test-1.5.d: UI test validates layout and styling across different VS Code themes
- Test-1.5.e: Failure injection test simulates session file read error and validates error banner display
- Test-1.5.f: Performance test validates dashboard responsiveness with 10 active agents

---

## Phase 2: Project Execution & Assignment
**Purpose:** Enable agents to claim, execute, and complete GitHub Projects. Cannot start until Phase 1 provides reliable agent session management and health monitoring.

### 2.1 Project Queue Management
Implement project discovery, filtering, and atomic claiming via State Tracking API.

**Implementation Details**
- Systems affected: State Tracking API (`packages/api/src/modules/projects/`), MCP Server (`mcp__stoked-projects__list_issues`)
- Project queue logic:
  - Query all issues in project with `status=todo` or `status=backlog`
  - Filter out issues already claimed by other agents (check `claimedByAgentId` field in State Tracking API)
  - Sort by priority (if available), then by issue number ascending
- Atomic claim operation via State Tracking API:
  - Endpoint: `POST /api/projects/{projectNumber}/issues/{issueNumber}/claim`
  - Request body: `{ "agentId": "agent-1" }`
  - Response: 200 OK with claimed issue details, or 409 Conflict if already claimed
  - Implementation: MongoDB atomic update with `findOneAndUpdate` using `claimedByAgentId: null` condition
- Claim expiration: Claims expire after 8 hours; cron job in State Tracking API releases stale claims
- Failure modes: API errors during claim should retry with exponential backoff (1s, 2s, 4s, max 3 retries)

**Acceptance Criteria**
- AC-2.1.a: When agent queries project queue → only unclaimed issues with status "todo" or "backlog" are returned within 1 second
- AC-2.1.b: When agent attempts to claim issue → claim succeeds atomically and issue is removed from other agents' queues immediately
- AC-2.1.c: When two agents attempt to claim same issue simultaneously → one succeeds (200 OK) and one fails (409 Conflict)
- AC-2.1.d: When agent claim is older than 8 hours and agent is unresponsive → claim is automatically released and issue returns to queue
- AC-2.1.e: When State Tracking API is unreachable during claim → agent retries up to 3 times with exponential backoff before failing

**Acceptance Tests**
- Test-2.1.a: Unit test validates queue filtering logic (excludes claimed, wrong status)
- Test-2.1.b: Integration test verifies atomic claim operation in MongoDB
- Test-2.1.c: Concurrency test simulates 2 agents claiming same issue and validates one fails
- Test-2.1.d: Time-based test validates claim expiration after 8 hours with cron job
- Test-2.1.e: Failure injection test simulates API timeout during claim and validates retry logic
- Test-2.1.f: Performance test validates claim operation completes in < 500ms under load (10 concurrent claims)

---

### 2.2 Agent Project Execution Workflow
Implement agent task loop: claim project → execute `/project-start` → push code → mark complete.

**Implementation Details**
- Systems affected: `agent-lifecycle.ts`, new module `apps/code-ext/src/agent-executor.ts`, Claude session wrapper script
- Execution flow:
  1. Agent in "idle" status queries project queue (via 2.1)
  2. Claim first available issue atomically
  3. Update session file: `status="working"`, `currentProjectNumber={issueNumber}`, `branchName="agent-{id}/project-{issueNumber}"`
  4. Execute Claude Code command: `/project-start {projectNumber}`
  5. Monitor `.claude-sessions/agent-{id}.response.md` for completion signal
  6. Push code to remote branch: `git push origin agent-{id}/project-{issueNumber}`
  7. Update issue status via MCP: `mcp__stoked-projects__update_issue_status` to "in_progress" initially, then to "done" when complete
  8. Update session file: `status="idle"`, `currentProjectNumber=null`, `tasksCompleted++`
- Error handling: On failure, update session file with error details, increment `errorCount`, revert to "idle" status
- Timeout: If execution exceeds 8 hours, kill session and mark issue as "failed"
- Failure modes: Git push failures should retry 3 times; if all fail, escalate to user via notification

**Acceptance Criteria**
- AC-2.2.a: When agent claims issue → agent status transitions to "working" and `/project-start` command is executed within 30 seconds
- AC-2.2.b: When project execution completes successfully → code is pushed to branch `agent-{id}/project-{issueNumber}` within 2 minutes
- AC-2.2.c: When code is pushed → issue status is updated to "done" via MCP within 30 seconds
- AC-2.2.d: When project completes → agent status returns to "idle" and `tasksCompleted` increments
- AC-2.2.e: When execution fails with error → agent status returns to "idle", error is logged, and issue claim is released
- AC-2.2.f: When execution exceeds 8-hour timeout → session is killed, issue status is set to "backlog", and claim is released

**Acceptance Tests**
- Test-2.2.a: Unit test validates execution flow state transitions
- Test-2.2.b: Integration test verifies `/project-start` command invocation and response monitoring
- Test-2.2.c: E2E test validates full workflow: claim → execute → push → mark done → idle
- Test-2.2.d: Failure injection test simulates git push failure and validates retry logic
- Test-2.2.e: Timeout test validates 8-hour execution limit enforcement
- Test-2.2.f: Regression test ensures agent can pick up next project after completion

---

### 2.3 Branch Management & Conflict Detection
Implement per-agent branch creation and pre-merge conflict detection.

**Implementation Details**
- Systems affected: `agent-executor.ts`, new module `apps/code-ext/src/conflict-detector.ts`
- Branch naming: `agent-{agentId}/project-{issueNumber}` (e.g., `agent-1/project-42`)
- Branch creation: Before starting work, create branch from latest `main`: `git checkout -b agent-{id}/project-{issue} origin/main`
- Pre-merge conflict detection:
  1. Before marking issue "done", fetch latest `main`: `git fetch origin main`
  2. Attempt dry-run merge: `git merge --no-commit --no-ff origin/main`
  3. If conflicts detected, abort merge and escalate to user
  4. If clean, push branch and proceed with marking issue done
- Conflict escalation: Update issue with comment listing conflicting files, set label `needs-manual-resolution`, notify user via VS Code notification
- Auto-rebase: If conflicts are minor (< 5 files), attempt automatic rebase with conservative strategy (ours for conflicts)
- Failure modes: Rebase failures should abort and escalate to user; never force-push

**Acceptance Criteria**
- AC-2.3.a: When agent starts work on project → new branch is created from latest `main` within 10 seconds
- AC-2.3.b: When project completes and no conflicts with `main` → code is pushed to agent branch successfully
- AC-2.3.c: When project completes but conflicts exist with `main` → issue is labeled `needs-manual-resolution` and user is notified
- AC-2.3.d: When conflicts involve < 5 files → automatic rebase is attempted before escalation
- AC-2.3.e: When automatic rebase succeeds → branch is pushed and issue proceeds to "done" status
- AC-2.3.f: When automatic rebase fails → rebase is aborted, conflict is escalated, and no force-push occurs

**Acceptance Tests**
- Test-2.3.a: Unit test validates branch name generation and creation command
- Test-2.3.b: Integration test verifies conflict detection logic with simulated `main` changes
- Test-2.3.c: E2E test validates clean merge path: create branch → make changes → push → merge clean
- Test-2.3.d: E2E test validates conflict path: create branch → make changes → simulate main conflict → escalate
- Test-2.3.e: Integration test validates auto-rebase logic with minor conflicts
- Test-2.3.f: Failure injection test ensures rebase failure doesn't corrupt working tree

---

### 2.4 Cost Tracking & Budget Enforcement
Implement per-request cost tracking and automatic shutdown when budgets are exceeded.

**Implementation Details**
- Systems affected: `agent-executor.ts`, State Tracking API (`packages/api/src/modules/cost-tracking/`)
- Cost estimation:
  - Intercept Claude API requests via wrapper script
  - Calculate cost based on model (Sonnet 4.5: $3/MTok input, $15/MTok output)
  - Store in State Tracking API: `POST /api/cost-tracking/log` with `{ "agentId", "projectNumber", "tokens", "costUSD", "timestamp" }`
- Budget checking:
  - Query State Tracking API for daily/monthly totals: `GET /api/cost-tracking/totals?period=daily|monthly`
  - Compare against workspace config limits
  - If exceeded, trigger emergency stop for all agents
- Budget alerts:
  - 50% threshold: VS Code info notification
  - 75% threshold: VS Code warning notification
  - 90% threshold: VS Code error notification + pause new project claims
  - 100% threshold: Emergency stop all agents + error notification
- Dashboard integration: Display current spend and budget limits in agent dashboard header
- Failure modes: Cost tracking failures should log error but not block execution; assume worst-case cost and continue

**Acceptance Criteria**
- AC-2.4.a: When agent executes Claude API request → cost is calculated and logged to State Tracking API within 1 second
- AC-2.4.b: When daily spend reaches 50% of budget → info notification is displayed in VS Code
- AC-2.4.c: When daily spend reaches 90% of budget → warning notification is displayed and new project claims are paused
- AC-2.4.d: When daily spend reaches 100% of budget → all agents are stopped immediately and error notification is shown
- AC-2.4.e: When cost tracking API is unreachable → agent assumes worst-case cost ($0.50 per request) and continues with warning
- AC-2.4.f: When dashboard is opened → current daily/monthly spend is displayed with budget limits

**Acceptance Tests**
- Test-2.4.a: Unit test validates cost calculation for various token counts and models
- Test-2.4.b: Integration test verifies cost logging to State Tracking API
- Test-2.4.c: E2E test validates budget threshold notifications at 50%, 75%, 90%, 100%
- Test-2.4.d: E2E test validates emergency stop trigger when budget is exceeded
- Test-2.4.e: Failure injection test simulates cost tracking API failure and validates fallback behavior
- Test-2.4.f: UI test validates dashboard displays current spend and budget limits correctly

---

### 2.5 Manual Override Controls
Add user controls for pausing agents, reassigning projects, and emergency stop.

**Implementation Details**
- Systems affected: Agent dashboard UI (`media/agent-dashboard.js`), `agent-lifecycle.ts`, `agent-executor.ts`
- Control operations:
  - **Pause Agent:** Sets agent status to "paused", prevents new project claims, current work continues until checkpoint
  - **Pause All:** Pauses all agents simultaneously
  - **Resume Agent:** Sets paused agent back to "idle", resumes project claims
  - **Stop Agent:** Gracefully stops agent (SIGTERM, 5s timeout, then SIGKILL)
  - **Emergency Stop All:** Immediately stops all agents (SIGKILL), shows confirmation dialog first
  - **Reassign Project:** Releases current agent's claim on project, updates State Tracking API, optionally assigns to different agent
- UI controls:
  - Per-agent card: "Pause" / "Resume" button, "Stop" button
  - Dashboard header: "Pause All", "Resume All", "Emergency Stop All" buttons
  - Project reassignment: Right-click context menu on agent card → "Reassign Current Project" → agent picker dropdown
- Confirmation dialogs: Emergency stop and reassignment require user confirmation
- Failure modes: Control operations should be idempotent (pausing already-paused agent is no-op)

**Acceptance Criteria**
- AC-2.5.a: When "Pause Agent" button is clicked → agent status becomes "paused" within 2 seconds and no new projects are claimed
- AC-2.5.b: When "Resume Agent" button is clicked on paused agent → agent status returns to "idle" and resumes claiming projects
- AC-2.5.c: When "Emergency Stop All" is clicked → confirmation dialog appears, and all agents stop within 5 seconds after confirmation
- AC-2.5.d: When "Reassign Project" is selected → current agent's claim is released and project returns to queue (or is assigned to selected agent)
- AC-2.5.e: When agent is paused while actively working → current work continues to next checkpoint (e.g., end of current phase) before pausing
- AC-2.5.f: When control operation is invoked on already-stopped agent → no-op with no error

**Acceptance Tests**
- Test-2.5.a: Unit test validates pause/resume state transitions
- Test-2.5.b: Integration test verifies emergency stop sends correct signals to all agent processes
- Test-2.5.c: E2E test validates user workflow: pause agent → verify no new claims → resume → verify claims resume
- Test-2.5.d: E2E test validates reassignment: agent working on project → reassign → project released to queue
- Test-2.5.e: UI test validates confirmation dialogs appear for destructive operations
- Test-2.5.f: Idempotency test validates repeated pause/resume/stop operations don't cause errors

---

## Phase 3: Review Agent & Quality Validation
**Purpose:** Implement dedicated review agent persona with acceptance criteria validation and iterative refinement workflow. Cannot start until Phase 2 provides project execution and completion mechanisms.

### 3.1 Review Agent Persona & Prompt Template
Create dedicated review agent with distinct persona and quality validation prompt.

**Implementation Details**
- Systems affected: New file `~/.claude/commands/review-agent-prompt.md`, `agent-lifecycle.ts`
- Review agent configuration:
  - Separate session file: `.claude-sessions/review-agent.session`
  - Dedicated agent ID: `review-agent` (not numbered like execution agents)
  - Status values: `idle|reviewing|paused|stopped`
- Prompt template structure:
  ```markdown
  You are a Code Review Specialist agent. Your role is to validate that completed projects meet quality standards and acceptance criteria.

  Project to Review: #{projectNumber}
  Issue Title: {issueTitle}
  Original Description: {issueBody}

  Acceptance Criteria:
  {parsedAcceptanceCriteria}

  Code Changes:
  Branch: {branchName}
  Files Changed: {fileList}

  Your Tasks:
  1. Validate each acceptance criterion is met
  2. Check code quality standards:
     - All tests pass
     - Linting clean
     - No obvious security issues
     - Code documented
  3. Provide specific feedback for any unmet criteria
  4. Approve (mark "done") OR Reject (return to execution agent with feedback)

  Response Format:
  **Status:** APPROVED | REJECTED

  **Acceptance Criteria Review:**
  - [x] Criterion 1: Met (evidence: ...)
  - [ ] Criterion 2: Not met (reason: ...)

  **Code Quality Review:**
  - Tests: PASS | FAIL (details: ...)
  - Linting: PASS | FAIL (details: ...)
  - Security: PASS | FAIL (details: ...)
  - Documentation: PASS | FAIL (details: ...)

  **Feedback for Execution Agent:**
  (Only if rejected - specific, actionable feedback)
  ```
- Persona differences from execution agents:
  - More conservative, quality-focused
  - Different system prompt emphasizing thoroughness over speed
  - No execution permissions, only review and feedback
- Failure modes: If prompt template file is missing, use fallback inline prompt

**Acceptance Criteria**
- AC-3.1.a: When review agent is initialized → dedicated session file is created with `review-agent` ID
- AC-3.1.b: When review task begins → prompt template is loaded from `~/.claude/commands/review-agent-prompt.md` within 1 second
- AC-3.1.c: When prompt template is missing → fallback inline prompt is used and warning is logged
- AC-3.1.d: When review is executed → prompt includes full issue context, acceptance criteria, and code diff
- AC-3.1.e: When review agent response is parsed → status (APPROVED/REJECTED) and criteria checklist are extracted correctly

**Acceptance Tests**
- Test-3.1.a: Unit test validates session file creation for review agent
- Test-3.1.b: Integration test verifies prompt template loading and variable substitution
- Test-3.1.c: E2E test validates full review prompt generation with real issue data
- Test-3.1.d: Parser test validates extraction of APPROVED/REJECTED status from various response formats
- Test-3.1.e: Failure injection test validates fallback prompt behavior when template file is missing

---

### 3.2 Review Queue & Assignment
Implement review queue for completed projects and assignment to review agent.

**Implementation Details**
- Systems affected: State Tracking API (`packages/api/src/modules/reviews/`), `agent-executor.ts`
- Review queue logic:
  - When execution agent completes project (code pushed), update State Tracking API: `POST /api/reviews/enqueue { "projectNumber", "issueNumber", "branchName", "completedByAgentId" }`
  - State Tracking API stores review queue in MongoDB with status: `pending|in_review|approved|rejected`
- Review agent workflow:
  1. Query review queue: `GET /api/reviews/queue` (returns pending reviews sorted by completion time)
  2. Claim review atomically: `POST /api/reviews/{reviewId}/claim { "agentId": "review-agent" }`
  3. Update session file: `status="reviewing"`, `currentProjectNumber={issueNumber}`
  4. Execute review (see 3.3)
- Review claim expiration: Reviews older than 2 hours and unclaimed are flagged for escalation
- Failure modes: If review queue is empty, review agent enters idle state and polls every 60 seconds

**Acceptance Criteria**
- AC-3.2.a: When execution agent completes project → review is enqueued to State Tracking API within 30 seconds
- AC-3.2.b: When review agent queries queue → pending reviews are returned sorted by completion time (oldest first)
- AC-3.2.c: When review agent claims review → claim succeeds atomically and review status becomes "in_review"
- AC-3.2.d: When review queue is empty → review agent status becomes "idle" and polls every 60 seconds
- AC-3.2.e: When review claim is older than 2 hours → escalation notification is sent to user

**Acceptance Tests**
- Test-3.2.a: Unit test validates review enqueue payload and State Tracking API call
- Test-3.2.b: Integration test verifies review queue query and sorting logic
- Test-3.2.c: Concurrency test ensures atomic review claim (no duplicate assignments)
- Test-3.2.d: Time-based test validates review claim expiration after 2 hours
- Test-3.2.e: E2E test validates full flow: project complete → enqueue → review agent claims → status updates

---

### 3.3 Acceptance Criteria Validation
Parse acceptance criteria from issue description and validate against review agent findings.

**Implementation Details**
- Systems affected: New module `apps/code-ext/src/acceptance-criteria-parser.ts`, review agent executor
- Parsing logic:
  - Extract acceptance criteria from issue body using regex: `- \[[ x]\] (.+)` or `AC-\d+\.\d+\.[a-z]: (.+)`
  - Store as structured data: `{ id: string, description: string, status: "pending"|"met"|"not_met" }`
- Validation workflow:
  1. Review agent receives parsed criteria in prompt
  2. Agent responds with checklist indicating met/not met status for each criterion
  3. Parse response and update criteria status
  4. If all criteria met → proceed to approval
  5. If any criteria not met → proceed to rejection (see 3.4)
- Edge cases: If no acceptance criteria found in issue, require manual review (notify user)
- Failure modes: Parser failures should default to manual review mode

**Acceptance Criteria**
- AC-3.3.a: When issue body contains acceptance criteria in checklist format → all criteria are extracted and parsed correctly
- AC-3.3.b: When issue body contains acceptance criteria in AC-X.X.X format → all criteria are extracted and parsed correctly
- AC-3.3.c: When review agent responds with criteria status → parser extracts met/not met status for each criterion
- AC-3.3.d: When all criteria are marked "met" → review proceeds to approval workflow
- AC-3.3.e: When any criterion is marked "not met" → review proceeds to rejection workflow with specific feedback
- AC-3.3.f: When no acceptance criteria are found in issue → user is notified to add criteria or manually approve

**Acceptance Tests**
- Test-3.3.a: Unit test validates parsing of checklist-format acceptance criteria
- Test-3.3.b: Unit test validates parsing of AC-X.X.X-format acceptance criteria
- Test-3.3.c: Parser test validates extraction of met/not met status from review agent response
- Test-3.3.d: Integration test verifies full validation workflow with all criteria met
- Test-3.3.e: Integration test verifies rejection workflow when criteria not met
- Test-3.3.f: Edge case test validates behavior when no criteria are present

---

### 3.4 Code Quality Standards Validation
Implement automated checks for test pass rate, linting, security, and documentation.

**Implementation Details**
- Systems affected: Review agent executor, new module `apps/code-ext/src/quality-checks.ts`
- Quality checks executed automatically before review agent analysis:
  1. **Tests:** Run CI/CD pipeline on branch, check exit code (0 = pass, non-zero = fail)
  2. **Linting:** Run linter on changed files: `npm run lint` or `pnpm run lint`
  3. **Security:** Run security scanner on changed files: `npm audit --audit-level=moderate` (if applicable)
  4. **Documentation:** Check for presence of JSDoc/TSDoc comments on new public functions/classes (simple regex scan)
- Check results included in review agent prompt as pre-validation context
- Minimum passing criteria:
  - Tests: Must pass (blocking)
  - Linting: Must pass (blocking)
  - Security: No high/critical issues (blocking)
  - Documentation: At least 50% of new public APIs documented (warning, not blocking)
- Failure modes: If CI/CD or linting tools are not available, skip check with warning

**Acceptance Criteria**
- AC-3.4.a: When code is pushed to branch → CI/CD pipeline is triggered and test results are collected within 5 minutes
- AC-3.4.b: When linting check is run → exit code and error details are captured and included in review prompt
- AC-3.4.c: When security scan is run → vulnerabilities are categorized by severity (low/moderate/high/critical)
- AC-3.4.d: When documentation check is run → percentage of documented public APIs is calculated
- AC-3.4.e: When any blocking check fails (tests, linting, security) → review is automatically rejected with specific error details
- AC-3.4.f: When non-blocking check fails (documentation) → review proceeds but warning is included in feedback

**Acceptance Tests**
- Test-3.4.a: Integration test verifies CI/CD pipeline execution and result collection
- Test-3.4.b: Unit test validates linting command execution and error parsing
- Test-3.4.c: Integration test verifies security scan execution with various vulnerability scenarios
- Test-3.4.d: Unit test validates documentation coverage calculation
- Test-3.4.e: E2E test validates automatic rejection when test fails
- Test-3.4.f: E2E test validates warning behavior when documentation coverage is low

---

### 3.5 Iterative Refinement Workflow
Implement feedback loop between review agent and execution agent with maximum 3 cycles.

**Implementation Details**
- Systems affected: Review agent executor, execution agent executor, State Tracking API
- Workflow:
  1. **Rejection:** Review agent marks review as "rejected", writes feedback to State Tracking API
  2. **Feedback delivery:** Update issue with comment containing review feedback
  3. **Re-assignment:** Release issue claim, re-enqueue issue with status "in_progress", increment `reviewCycleCount`
  4. **Re-execution:** Execution agent picks up issue again, reads feedback from latest comment, makes improvements
  5. **Re-submission:** Agent pushes updated code, re-enqueues for review
  6. **Cycle limit:** After 3rd rejection, escalate to user with both agents' perspectives
- Feedback format:
  ```markdown
  ## Review Feedback - Cycle {cycleCount}/3

  **Status:** REJECTED

  **Issues Found:**
  - Acceptance Criterion 2 not met: Expected behavior X, observed behavior Y
  - Code quality: Test coverage below threshold (45%, need 80%)

  **Requested Changes:**
  1. Add test case for edge case Z
  2. Update function `foo()` to handle null inputs
  3. Add JSDoc comments to new public API

  **Next Steps:**
  Please address the issues above and re-submit for review.
  ```
- Escalation format: Create GitHub issue comment with tag `@review-escalation` containing summary of disagreement
- Failure modes: If feedback cannot be written to issue, send to State Tracking API and notify user

**Acceptance Criteria**
- AC-3.5.a: When review agent rejects project → feedback is written to issue as comment within 30 seconds
- AC-3.5.b: When feedback is written → execution agent is notified and issue is re-enqueued with status "in_progress"
- AC-3.5.c: When execution agent picks up re-opened issue → latest review feedback is included in execution context
- AC-3.5.d: When project is rejected for 3rd time → user is notified via VS Code notification and issue is labeled `review-escalation`
- AC-3.5.e: When escalation occurs → issue comment contains summary of both review agent and execution agent perspectives
- AC-3.5.f: When review cycle count is tracked → State Tracking API stores cycle count and prevents infinite loops

**Acceptance Tests**
- Test-3.5.a: Integration test validates feedback writing to GitHub issue via MCP
- Test-3.5.b: E2E test validates full refinement loop: complete → reject → re-execute → re-submit → approve
- Test-3.5.c: E2E test validates 3-cycle limit: reject → reject → reject → escalate
- Test-3.5.d: Unit test validates feedback parsing by execution agent
- Test-3.5.e: Integration test verifies escalation notification and issue labeling
- Test-3.5.f: State persistence test validates review cycle count storage and retrieval

---

## Phase 4: Autonomous Ideation & Project Generation
**Purpose:** Enable agents to self-generate new projects when queues are empty, creating a self-sustaining improvement loop. Cannot start until Phase 3 provides quality validation to ensure self-generated projects meet standards.

### 4.1 Category Prompt Template System
Create 21 category-specific prompt templates for project ideation.

**Implementation Details**
- Systems affected: New directory `~/.claude/commands/category-prompts/`, `agent-executor.ts`
- Category prompt files: One Markdown file per category (e.g., `optimization.md`, `security.md`, etc.)
- Template structure:
  ```markdown
  # {Category} Ideation Prompt

  You are a {Category} specialist reviewing {repository_name}.

  **Current Context:**
  - Repository: {owner}/{repo}
  - Recent commits: {last_10_commits}
  - Open issues: {existing_issue_count}
  - Technology stack: {detected_languages_and_frameworks}

  **Your Task:**
  Identify ONE specific, valuable {category} improvement that can be completed in < 8 hours.

  **Requirements:**
  1. Review existing issues to avoid duplicates
  2. Ensure technical feasibility (check dependencies, APIs, architecture)
  3. Scope improvement to be completable by single agent in < 8 hours
  4. Define 3-5 clear, testable acceptance criteria
  5. Consider current architecture and patterns

  **Output Format:**
  **Title:** [Concise improvement title]
  **Description:** [2-3 sentence overview explaining value and impact]
  **Acceptance Criteria:**
  - AC-1.a: [Specific, measurable criterion]
  - AC-1.b: [Specific, measurable criterion]
  - AC-1.c: [Specific, measurable criterion]
  **Technical Approach:** [High-level implementation plan with key steps]
  **Estimated Effort:** [Hours estimate]

  **Important:**
  - If no valuable improvements found in this category, respond with "NO_IDEA_AVAILABLE"
  - Prioritize high-impact, low-risk improvements
  - Ensure acceptance criteria are specific and testable
  ```
- Category list (all 21 from PFB):
  1. Optimization
  2. Innovation
  3. Architecture
  4. Front End Improvements
  5. Back End Improvements
  6. Security
  7. Testing
  8. Documentation
  9. Technical Debt
  10. Developer Experience (DX)
  11. Monitoring & Observability
  12. DevOps/Infrastructure
  13. Accessibility (a11y)
  14. Dependency Management
  15. Data Management
  16. Internationalization (i18n)
  17. Error Handling & Resilience
  18. Code Quality
  19. Compliance & Governance
  20. Scalability
  21. API Evolution
- Template installation: Copy all 21 templates to `~/.claude/commands/category-prompts/` on extension activation
- Failure modes: If template file is missing, skip category and log warning

**Acceptance Criteria**
- AC-4.1.a: When extension activates → all 21 category prompt template files are present in `~/.claude/commands/category-prompts/`
- AC-4.1.b: When ideation is triggered for category → correct template file is loaded within 1 second
- AC-4.1.c: When template is loaded → repository context (recent commits, tech stack, etc.) is injected into placeholders
- AC-4.1.d: When template file is missing → category is skipped and warning is logged to Output panel
- AC-4.1.e: When user disables category in workspace settings → corresponding template is not used during ideation

**Acceptance Tests**
- Test-4.1.a: File system test validates all 21 template files are created on extension activation
- Test-4.1.b: Unit test validates template loading and variable substitution
- Test-4.1.c: Integration test verifies repository context extraction (commits, tech stack, etc.)
- Test-4.1.d: Failure injection test validates behavior when template file is deleted
- Test-4.1.e: Configuration test validates disabled categories are excluded from ideation rotation

---

### 4.2 Category Selection Algorithm
Implement round-robin or least-recently-used category selection for ideation.

**Implementation Details**
- Systems affected: New module `apps/code-ext/src/category-selector.ts`, State Tracking API
- Selection strategy: Least-recently-used (LRU) with fallback to round-robin
- Category usage tracking:
  - State Tracking API stores: `{ "category": "optimization", "lastUsedAt": ISO8601, "projectsGenerated": number }`
  - Endpoint: `GET /api/categories/next` returns next category to use based on LRU
  - Endpoint: `POST /api/categories/{name}/mark-used` updates last used timestamp
- Category filtering:
  - Exclude disabled categories (from workspace settings `enabledCategories`)
  - Exclude categories that returned "NO_IDEA_AVAILABLE" in last 7 days
  - Exclude categories with > 10 open self-generated projects (prevent category flooding)
- Fallback: If all categories exhausted, agent enters idle state and notifies user
- Failure modes: If State Tracking API unreachable, fall back to local round-robin in session file

**Acceptance Criteria**
- AC-4.2.a: When ideation is triggered → next category is selected using LRU strategy (oldest last-used timestamp)
- AC-4.2.b: When category is used → last-used timestamp is updated in State Tracking API within 5 seconds
- AC-4.2.c: When category is disabled in workspace settings → category is excluded from selection
- AC-4.2.d: When category returned "NO_IDEA_AVAILABLE" in last 7 days → category is excluded from selection
- AC-4.2.e: When all categories are exhausted → agent enters idle state and user is notified
- AC-4.2.f: When State Tracking API is unreachable → local round-robin selection is used with warning

**Acceptance Tests**
- Test-4.2.a: Unit test validates LRU selection logic with various timestamps
- Test-4.2.b: Integration test verifies category usage tracking in State Tracking API
- Test-4.2.c: Configuration test validates disabled category filtering
- Test-4.2.d: Time-based test validates exclusion of categories with recent "NO_IDEA_AVAILABLE"
- Test-4.2.e: Exhaustion test validates behavior when all categories are excluded
- Test-4.2.f: Failure injection test validates fallback to local round-robin

---

### 4.3 Ideation Execution & Validation
Execute category prompt, parse output, and validate idea feasibility.

**Implementation Details**
- Systems affected: `agent-executor.ts`, new module `apps/code-ext/src/idea-validator.ts`
- Ideation workflow:
  1. Agent status becomes "ideating"
  2. Select category (via 4.2)
  3. Load category prompt template (via 4.1)
  4. Execute Claude Code session with prompt
  5. Parse response to extract: title, description, acceptance criteria, technical approach, effort estimate
  6. Validate idea:
     - Check for duplicate issues (search GitHub issues by title similarity)
     - Verify effort estimate is reasonable (< 8 hours)
     - Ensure at least 3 acceptance criteria defined
     - Check technical feasibility (no references to non-existent dependencies)
  7. If valid, proceed to project creation (4.4)
  8. If invalid or "NO_IDEA_AVAILABLE", mark category as exhausted and retry with next category
- Parsing logic:
  - Extract sections using regex: `**Title:** (.+)`, `**Description:** (.+)`, `**Acceptance Criteria:**\n(- .+)+`
  - Structure: `{ title: string, description: string, acceptanceCriteria: string[], technicalApproach: string, effort: number }`
- Failure modes: If parsing fails, log error and retry with modified prompt asking for stricter format adherence

**Acceptance Criteria**
- AC-4.3.a: When ideation is executed → category prompt is loaded and Claude session is started within 30 seconds
- AC-4.3.b: When ideation response is received → title, description, and acceptance criteria are parsed correctly
- AC-4.3.c: When parsing succeeds and idea is valid → idea proceeds to project creation workflow
- AC-4.3.d: When response is "NO_IDEA_AVAILABLE" → category is marked exhausted and next category is tried
- AC-4.3.e: When duplicate issue is detected (title similarity > 80%) → idea is rejected and next category is tried
- AC-4.3.f: When effort estimate exceeds 8 hours → idea is rejected and ideation is retried with constraint reminder

**Acceptance Tests**
- Test-4.3.a: Integration test verifies ideation session execution with category prompt
- Test-4.3.b: Parser test validates extraction of title, description, and acceptance criteria from various response formats
- Test-4.3.c: Validation test verifies duplicate detection logic with similar issue titles
- Test-4.3.d: Edge case test validates "NO_IDEA_AVAILABLE" handling
- Test-4.3.e: E2E test validates full ideation flow: select category → execute → parse → validate → create project
- Test-4.3.f: Failure injection test validates parsing retry logic on malformed responses

---

### 4.4 Integration with `/project-create`
Automatically invoke `/project-create` command with validated idea and enqueue new project.

**Implementation Details**
- Systems affected: `agent-executor.ts`, Claude session wrapper, State Tracking API
- Project creation workflow:
  1. Format idea as `/project-create` input:
     ```
     /project-create {category}: {title}

     {description}

     Acceptance Criteria:
     {acceptanceCriteria}

     Technical Approach:
     {technicalApproach}
     ```
  2. Execute `/project-create` command via Claude Code CLI
  3. Parse response to extract created project number
  4. Update State Tracking API: `POST /api/projects/self-generated` with `{ "projectNumber", "category", "ideatedByAgentId", "createdAt" }`
  5. Enqueue new project to work queue (auto-claimable by any execution agent)
  6. Update agent status back to "idle"
- Self-generated project tracking:
  - Label new issues with `agent-generated` and `category:{categoryName}`
  - Track weekly generation rate per category in State Tracking API for metrics
- Failure modes: If `/project-create` fails, log error and retry ideation with different category

**Acceptance Criteria**
- AC-4.4.a: When idea is validated → `/project-create` command is executed with formatted idea within 30 seconds
- AC-4.4.b: When project is created → new issue appears in GitHub with `agent-generated` and `category:{name}` labels
- AC-4.4.c: When project is created → project number is extracted and stored in State Tracking API
- AC-4.4.d: When project is enqueued → any execution agent can claim the project
- AC-4.4.e: When `/project-create` fails → error is logged and ideation retries with different category
- AC-4.4.f: When agent completes project creation → agent status returns to "idle" and can pick up work

**Acceptance Tests**
- Test-4.4.a: Integration test verifies `/project-create` command execution with formatted idea
- Test-4.4.b: E2E test validates full flow: ideate → create project → verify GitHub issue exists with correct labels
- Test-4.4.c: State persistence test validates self-generated project tracking in State Tracking API
- Test-4.4.d: E2E test validates newly created project can be claimed by execution agent
- Test-4.4.e: Failure injection test simulates `/project-create` failure and validates retry logic
- Test-4.4.f: Integration test verifies agent status transitions: ideating → idle after project creation

---

### 4.5 Self-Sustaining Loop Validation
Verify continuous cycle: execute → review → ideate → create → execute.

**Implementation Details**
- Systems affected: All agent executors, State Tracking API
- Loop monitoring:
  - Track agent state transitions in State Tracking API: `idle → working → idle → reviewing → idle → ideating → idle → working`
  - Measure cycle time: Time from project completion to next project start
  - Detect stuck states: If agent in same status for > 30 minutes without progress, trigger alert
- Loop health metrics:
  - **Cycle completeness:** % of agents completing full execute → review → ideate → execute cycle in 24 hours
  - **Category coverage:** % of categories exercised in last 30 days
  - **Queue depth:** Number of pending projects in queue (target: 3-10)
- Auto-balancing:
  - If queue depth < 3, prioritize ideation agents
  - If queue depth > 10, pause ideation and focus on execution
- Failure modes: If loop stalls (no progress in 1 hour), trigger emergency diagnostic and notify user

**Acceptance Criteria**
- AC-4.5.a: When agent completes execution → agent transitions to idle and immediately picks up next task (review or ideation) within 60 seconds
- AC-4.5.b: When review queue is empty and project queue is empty → agent transitions to ideation within 30 seconds
- AC-4.5.c: When new project is created via ideation → project appears in queue and is claimed by execution agent within 2 minutes
- AC-4.5.d: When loop completes full cycle (execute → review → ideate → create → execute) → cycle time is < 4 hours on average
- AC-4.5.e: When all 21 categories are enabled → all categories are exercised within 30 days
- AC-4.5.f: When agent is stuck in same status for > 30 minutes → user is notified and diagnostic information is logged

**Acceptance Tests**
- Test-4.5.a: E2E test validates immediate task pickup after completion (< 60 seconds idle time)
- Test-4.5.b: Integration test verifies transition to ideation when both queues empty
- Test-4.5.c: E2E test validates full loop: project created → claimed → executed → reviewed → new idea → new project
- Test-4.5.d: Performance test measures cycle time over 10 full loops
- Test-4.5.e: Long-running test validates category coverage over 30-day simulation
- Test-4.5.f: Failure injection test simulates stuck agent and validates alert trigger

---

## Phase 5: Integration, Monitoring & Polish
**Purpose:** Add production-ready features for visibility, safety, and user control. Cannot start until Phase 4 provides complete autonomous loop to monitor and control.

### 5.1 Real-Time Agent Activity Dashboard
Enhance agent dashboard with real-time activity feed and progress indicators.

**Implementation Details**
- Systems affected: Agent dashboard UI (`media/agent-dashboard.js`, `media/agent-dashboard.css`)
- New dashboard sections:
  - **Activity Feed:** Scrolling log of recent agent events (last 50 events):
    - "Agent 1 claimed project #42"
    - "Agent 2 completed review of project #38 - APPROVED"
    - "Agent 3 generated new idea: Optimize database queries"
    - Timestamp, agent ID, event type, project link
  - **Per-Agent Progress:** Visual progress bar for current task:
    - Execution: Show current phase (e.g., "Phase 2 of 4 - 50% complete")
    - Review: Show checklist progress (e.g., "3 of 5 criteria validated")
    - Ideation: Show status (e.g., "Analyzing repository...")
  - **Cost Tracker:** Real-time spend display in header:
    - Daily: $12.34 / $50.00 (24.7%) with color-coded progress bar
    - Monthly: $123.45 / $500.00 (24.7%)
- Event streaming: WebSocket connection to State Tracking API for real-time events
- Failure modes: If WebSocket disconnects, fall back to polling every 5 seconds with warning banner

**Acceptance Criteria**
- AC-5.1.a: When dashboard is opened → activity feed displays last 50 agent events within 2 seconds
- AC-5.1.b: When agent event occurs → event appears in activity feed within 5 seconds
- AC-5.1.c: When agent is working on project → progress bar shows current phase and percentage complete
- AC-5.1.d: When cost is updated → cost tracker in header updates within 5 seconds
- AC-5.1.e: When WebSocket connection fails → dashboard falls back to polling with warning banner
- AC-5.1.f: When activity feed exceeds 50 events → oldest events are removed (FIFO)

**Acceptance Tests**
- Test-5.1.a: Unit test validates activity feed rendering with sample events
- Test-5.1.b: Integration test verifies WebSocket event streaming from State Tracking API
- Test-5.1.c: UI test validates progress bar updates during simulated project execution
- Test-5.1.d: Integration test verifies cost tracker updates when cost tracking API logs new costs
- Test-5.1.e: Failure injection test simulates WebSocket disconnect and validates polling fallback
- Test-5.1.f: UI test validates FIFO behavior with > 50 events

---

### 5.2 Health Monitoring & Alerting
Implement proactive health checks and user notifications for agent issues.

**Implementation Details**
- Systems affected: New module `apps/code-ext/src/health-monitor.ts`, State Tracking API
- Health checks (run every 60 seconds):
  - **Agent responsiveness:** Check heartbeat freshness (< 60s = healthy, 60-120s = degraded, > 120s = unresponsive)
  - **Error rate:** Check agent error count (< 3 errors/hour = healthy, 3-10 = degraded, > 10 = critical)
  - **Queue depth:** Check project queue size (3-10 = healthy, < 3 = low, > 10 = high)
  - **Budget status:** Check remaining budget (> 50% = healthy, 25-50% = warning, < 25% = critical)
  - **Stuck detection:** Check if agent in same status for > 30 minutes without heartbeat updates
- Alert levels:
  - **Info:** Low queue depth, 50% budget reached
  - **Warning:** Degraded agent, high queue depth, 75% budget reached
  - **Error:** Unresponsive agent, critical error rate, 90% budget reached
  - **Critical:** Agent stuck, budget exceeded, all agents crashed
- Notification delivery:
  - VS Code notifications (toast) for warning/error/critical
  - Dashboard banner for all alert levels
  - State Tracking API alert log for historical tracking
- Failure modes: Health check failures should not block agent execution; log error and skip check

**Acceptance Criteria**
- AC-5.2.a: When health check runs → all agent health statuses are evaluated within 5 seconds
- AC-5.2.b: When agent becomes unresponsive (heartbeat > 120s ago) → error notification is displayed to user
- AC-5.2.c: When agent error rate exceeds 10 errors/hour → error notification is displayed with details
- AC-5.2.d: When budget reaches 90% → critical notification is displayed and new project claims are paused
- AC-5.2.e: When agent is stuck for > 30 minutes → error notification is displayed with "Restart Agent" action button
- AC-5.2.f: When health check fails due to API error → error is logged and check is skipped without blocking agents

**Acceptance Tests**
- Test-5.2.a: Unit test validates health check logic for various agent states
- Test-5.2.b: Integration test verifies unresponsive agent detection and notification
- Test-5.2.c: Integration test validates error rate calculation and threshold triggering
- Test-5.2.d: E2E test validates budget alert at 50%, 75%, 90%, 100% thresholds
- Test-5.2.e: Time-based test validates stuck agent detection after 30 minutes
- Test-5.2.f: Failure injection test simulates health check API failure and validates graceful degradation

---

### 5.3 Conflict Resolution UI
Add user interface for manually resolving merge conflicts flagged by agents.

**Implementation Details**
- Systems affected: New webview `apps/code-ext/src/conflict-resolver-provider.ts`, `media/conflict-resolver.html`
- Conflict queue:
  - State Tracking API stores conflicts: `{ "projectNumber", "issueNumber", "branchName", "conflictingFiles": [], "status": "pending|resolving|resolved" }`
  - Endpoint: `GET /api/conflicts/queue` returns pending conflicts
- Conflict resolution UI:
  - List view: Shows all pending conflicts with project number, issue title, conflicting file count
  - Detail view: Shows specific conflicting files with diff viewer
  - Actions:
    - "Open in VS Code Merge Editor" (opens VS Code built-in 3-way merge)
    - "Abort and Reassign" (releases claim, returns issue to backlog)
    - "Mark Resolved" (updates State Tracking API, allows agent to proceed)
- Integration with VS Code Merge Editor:
  - Use VS Code API to open merge editor: `vscode.commands.executeCommand('vscode.openMergeEditor', ...)`
  - Pre-populate with agent branch, main branch, and base commit
- Failure modes: If merge editor fails to open, provide fallback git command instructions

**Acceptance Criteria**
- AC-5.3.a: When conflict is detected by agent → conflict appears in conflict queue within 30 seconds
- AC-5.3.b: When user opens conflict resolver → all pending conflicts are displayed with file counts
- AC-5.3.c: When "Open in VS Code Merge Editor" is clicked → merge editor opens with correct branches pre-loaded
- AC-5.3.d: When user resolves conflict in merge editor and clicks "Mark Resolved" → conflict is removed from queue and agent proceeds
- AC-5.3.e: When "Abort and Reassign" is clicked → issue claim is released and issue returns to backlog
- AC-5.3.f: When merge editor fails to open → fallback instructions are displayed with git commands

**Acceptance Tests**
- Test-5.3.a: Integration test verifies conflict enqueue when agent detects merge conflict
- Test-5.3.b: UI test validates conflict queue rendering with multiple conflicts
- Test-5.3.c: Integration test verifies VS Code merge editor opening with correct parameters
- Test-5.3.d: E2E test validates full resolution flow: conflict → open editor → resolve → mark resolved → agent proceeds
- Test-5.3.e: E2E test validates abort flow: conflict → abort → issue returned to backlog
- Test-5.3.f: Failure injection test simulates merge editor failure and validates fallback instructions

---

### 5.4 Agent Performance Metrics
Track and display agent productivity metrics in dashboard.

**Implementation Details**
- Systems affected: State Tracking API, agent dashboard UI
- Metrics tracked per agent:
  - **Tasks completed:** Total count, rolling 24-hour count, rolling 7-day count
  - **Average cycle time:** Time from claim to completion (per project)
  - **Review pass rate:** % of projects approved on first review
  - **Error rate:** Errors per project (rolling average)
  - **Cost per project:** Average cost in USD per completed project
  - **Uptime:** % of time in non-idle status (working/reviewing/ideating)
- Metrics aggregation:
  - State Tracking API calculates metrics via MongoDB aggregation pipeline
  - Endpoint: `GET /api/agents/{agentId}/metrics?period=24h|7d|30d`
  - Dashboard queries metrics every 60 seconds
- Dashboard display:
  - Per-agent metrics card (expandable): Shows all metrics for individual agent
  - Global metrics summary in header: Total projects completed, average cycle time, total cost
  - Comparison view: Side-by-side comparison of all agents (for multi-agent workspaces)
- Failure modes: If metrics calculation fails, display last known values with stale timestamp

**Acceptance Criteria**
- AC-5.4.a: When agent completes project → metrics are updated in State Tracking API within 10 seconds
- AC-5.4.b: When dashboard requests metrics → metrics are calculated and returned within 1 second
- AC-5.4.c: When metrics card is expanded → all tracked metrics are displayed with correct values
- AC-5.4.d: When global metrics summary is displayed → values aggregate across all agents correctly
- AC-5.4.e: When metrics calculation fails → last known values are displayed with stale timestamp indicator
- AC-5.4.f: When comparison view is opened → all agents are displayed side-by-side with color-coded performance indicators

**Acceptance Tests**
- Test-5.4.a: Integration test verifies metrics update after project completion
- Test-5.4.b: Performance test validates metrics query response time (< 1 second)
- Test-5.4.c: Unit test validates metrics calculation logic (averages, percentages, etc.)
- Test-5.4.d: Integration test verifies global aggregation across multiple agents
- Test-5.4.e: Failure injection test simulates metrics calculation error and validates stale data display
- Test-5.4.f: UI test validates comparison view layout and color coding

---

### 5.5 Emergency Controls & Recovery
Implement emergency stop, agent restart, and state recovery mechanisms.

**Implementation Details**
- Systems affected: `agent-lifecycle.ts`, agent dashboard UI, State Tracking API
- Emergency controls:
  - **Emergency Stop All:** Immediately SIGKILL all agents, mark all claims as released, show confirmation dialog first
  - **Restart Agent:** Stop agent gracefully, clear error state, restart with same configuration
  - **Reset Agent State:** Clear session file, reset all metrics, restart from idle
  - **Recover Stuck Projects:** Release stale claims (> 8 hours old), return issues to backlog
  - **Purge Queue:** Clear all pending projects from queue (with confirmation)
- State recovery:
  - On restart, check for orphaned session files (no corresponding process)
  - Offer to recover or delete orphaned sessions
  - Restore agent state from session file if valid
- Confirmation dialogs:
  - All destructive operations require explicit confirmation
  - Dialog shows impact (e.g., "This will stop 3 active agents working on projects #42, #43, #44")
- Audit logging: All emergency operations logged to State Tracking API with user ID and timestamp
- Failure modes: Emergency stop must always succeed, even if graceful stop fails (force SIGKILL)

**Acceptance Criteria**
- AC-5.5.a: When "Emergency Stop All" is clicked → confirmation dialog appears with list of affected agents and projects
- AC-5.5.b: When emergency stop is confirmed → all agents stop within 5 seconds via SIGKILL
- AC-5.5.c: When "Restart Agent" is clicked → agent stops, error state clears, and agent restarts within 10 seconds
- AC-5.5.d: When "Reset Agent State" is clicked → session file is deleted, metrics reset, and agent restarts from idle
- AC-5.5.e: When stale claims are detected (> 8 hours old) → claims are released and issues return to backlog automatically
- AC-5.5.f: When emergency operation is executed → operation is logged to State Tracking API with timestamp and user ID

**Acceptance Tests**
- Test-5.5.a: UI test validates confirmation dialog content for emergency stop
- Test-5.5.b: Integration test verifies emergency stop sends SIGKILL to all agents
- Test-5.5.c: E2E test validates restart flow: stop → clear state → restart → idle
- Test-5.5.d: E2E test validates reset flow: clear session → reset metrics → restart
- Test-5.5.e: Time-based test validates stale claim recovery after 8 hours
- Test-5.5.f: Audit test validates all emergency operations are logged with correct metadata

---

## 3. Completion Criteria

The project is considered complete when:

### Phase 1 Completion
- All acceptance criteria for Phase 1 work items (1.1 - 1.5) are met
- All acceptance tests for Phase 1 are green
- Agent dashboard displays real-time status for all configured agents
- Agents can be started, paused, resumed, and stopped via UI controls
- No P0 or P1 issues related to agent session management or configuration

### Phase 2 Completion
- All acceptance criteria for Phase 2 work items (2.1 - 2.5) are met
- All acceptance tests for Phase 2 are green
- Agents successfully claim projects atomically without conflicts
- Agents execute `/project-start`, push code to branches, and mark issues complete
- Cost tracking operates within configured budget limits and triggers automatic stops
- No P0 or P1 issues related to project execution or branch management

### Phase 3 Completion
- All acceptance criteria for Phase 3 work items (3.1 - 3.5) are met
- All acceptance tests for Phase 3 are green
- Review agent validates acceptance criteria and code quality standards
- Iterative refinement workflow operates with maximum 3 cycles before escalation
- Review feedback is delivered to execution agents and incorporated in re-work
- No P0 or P1 issues related to quality validation or review workflow

### Phase 4 Completion
- All acceptance criteria for Phase 4 work items (4.1 - 4.5) are met
- All acceptance tests for Phase 4 are green
- All 21 category prompt templates are installed and functional
- Agents autonomously generate project ideas when queues are empty
- Self-generated projects are created via `/project-create` and enqueued for execution
- Continuous improvement loop operates without manual intervention
- No P0 or P1 issues related to ideation or project generation

### Phase 5 Completion
- All acceptance criteria for Phase 5 work items (5.1 - 5.5) are met
- All acceptance tests for Phase 5 are green
- Dashboard displays real-time activity feed, progress indicators, and cost tracking
- Health monitoring detects and alerts on agent issues proactively
- Conflict resolution UI enables manual resolution of merge conflicts
- Performance metrics are tracked and displayed for all agents
- Emergency controls provide reliable recovery mechanisms
- No P0 or P1 issues related to monitoring, metrics, or emergency controls

### Overall Project Completion
- All 5 phases are complete with all acceptance criteria met
- Full end-to-end workflow validated: configure agents → execute projects → review → ideate → create → repeat
- Success metrics from Section 1 are on track to be met:
  - Projects completed per agent per day: >2
  - Review cycles per project: <3
  - Self-generated projects per week per category: >1
  - CI/CD pass rate: >95%
- Documentation updated (README, architecture docs, user guides)
- No open P0 or P1 issues across all phases

---

## 4. Rollout & Validation

### Rollout Strategy
**Phase 1: Internal Alpha (Week 1-2)**
- Deploy to development workspace only
- Single agent configuration (maxConcurrent = 1)
- Manual project assignment for validation
- Daily review of agent logs and session files
- Goal: Validate agent lifecycle, session management, and dashboard UI

**Phase 2: Limited Beta (Week 3-4)**
- Deploy to 2-3 test workspaces
- Multi-agent configuration (maxConcurrent = 2-3)
- Enable project execution workflow (Phase 2 features)
- Monitor cost tracking and budget enforcement
- Goal: Validate concurrent execution, cost controls, and branch management

**Phase 3: Extended Beta (Week 5-6)**
- Deploy to 5-10 test workspaces
- Enable review agent workflow (Phase 3 features)
- Monitor review cycles and quality metrics
- Collect feedback on iterative refinement effectiveness
- Goal: Validate quality gates and review workflow

**Phase 4: Controlled Production (Week 7-8)**
- Deploy to all opt-in workspaces
- Enable full autonomous loop (Phase 4 features)
- Monitor category coverage and self-generated project quality
- Collect metrics on loop sustainability (idle time, project generation rate)
- Goal: Validate self-sustaining improvement loop

**Phase 5: General Availability (Week 9+)**
- Deploy to all workspaces (opt-out model)
- Enable all monitoring and emergency controls (Phase 5 features)
- Continuous monitoring of health metrics and user feedback
- Regular review of performance metrics and cost efficiency
- Goal: Achieve production stability and meet success metrics

### Feature Flags
- `enable_multi_agent`: Controls agent concurrency (default: false until Phase 2)
- `enable_review_agent`: Controls review workflow (default: false until Phase 3)
- `enable_ideation`: Controls autonomous project generation (default: false until Phase 4)
- `enable_advanced_monitoring`: Controls Phase 5 features (default: false until Phase 5)

### Progressive Exposure
- Start with maxConcurrent = 1, gradually increase to 3, then 5, then 10
- Start with 5 enabled categories, gradually enable all 21
- Start with high budget limits ($100/day), optimize down based on observed costs

### Post-Launch Validation
**Metrics to Monitor (Daily):**
- Agent uptime and crash rate
- Projects completed per agent per day
- Review approval rate (first attempt)
- Self-generated project acceptance rate (human validation)
- Cost per project (trend over time)
- Error rate per agent
- Queue depth (should remain 3-10)

**Metrics to Monitor (Weekly):**
- Category coverage (% of 21 categories exercised)
- Average cycle time (claim to completion)
- Budget utilization (% of configured limits)
- User satisfaction (via feedback surveys)
- Code quality metrics (test coverage, linting pass rate, security issues)

**Metrics to Monitor (Monthly):**
- Total projects completed across all workspaces
- ROI analysis (cost vs. value of improvements)
- Agent efficiency trends (improving or degrading over time)
- Self-sustaining loop health (% of projects that are self-generated)
- User engagement (% of workspaces actively using feature)

### Rollback Triggers
**Immediate Rollback (within 1 hour):**
- Budget overruns > 200% of configured limits
- Agent crash rate > 50%
- Data corruption in session files or State Tracking API
- Security incident (secrets committed, vulnerabilities introduced)

**Planned Rollback (within 24 hours):**
- Success metrics not trending toward targets after 2 weeks
- Cost per project exceeds $5 (unsustainable economics)
- User satisfaction < 60%
- Code quality regression > 10% (tests failing, linting errors increasing)

**Rollback Procedure:**
1. Disable feature flag for affected phase
2. Stop all active agents gracefully
3. Preserve session state and audit logs for analysis
4. Notify users via VS Code notification and dashboard banner
5. Provide manual fallback instructions (use `/project-start` directly)
6. Root cause analysis within 48 hours
7. Fix deployed within 1 week or feature remains disabled

---

## 5. Open Questions

### Agent Coordination & State Management
- **Q:** How do we prevent race conditions when multiple agents query the project queue simultaneously?
  - **Proposed A:** Use MongoDB atomic operations (`findOneAndUpdate`) with optimistic locking; State Tracking API handles concurrency

- **Q:** What happens if State Tracking API goes down while agents are working?
  - **Proposed A:** Agents continue working with local session file state; sync to API when available; implement exponential backoff retry logic

- **Q:** Should agents share a single review agent or can each execution agent have a dedicated reviewer?
  - **Proposed A:** Start with single shared review agent; evaluate scaling to multiple review agents based on queue depth

### Quality & Review Standards
- **Q:** How do we calibrate "reasonable standard of quality" to avoid overly strict or lenient reviews?
  - **Proposed A:** Start with strict standards (all tests pass, linting clean, no security issues); adjust based on rejection rate (target: <30%)

- **Q:** Should review agents have access to full git history or just the diff?
  - **Proposed A:** Full context including issue, acceptance criteria, diff, test results, and linting output; not full git history (too large)

- **Q:** How do we handle subjective quality disagreements (e.g., code style preferences)?
  - **Proposed A:** Review agent follows repository's existing patterns (learned from codebase analysis); escalate only on functional issues, not style

### Project Ideation & Feasibility
- **Q:** How do we ensure category prompts generate valuable, non-redundant projects?
  - **Proposed A:** Prompts include: "Review existing issues to avoid duplicates" + duplicate detection via title similarity (> 80% = duplicate)

- **Q:** Should agents validate technical feasibility before creating projects (e.g., check API availability)?
  - **Proposed A:** Yes, ideation prompt includes: "Verify technical feasibility" + basic checks (dependency existence, API reachability)

- **Q:** What if all 21 categories are exhausted (no more valuable ideas)?
  - **Proposed A:** Agent enters idle state; user can manually add projects, adjust category prompts, or enable new categories

### Cost & Budget Management
- **Q:** Should spend limits be enforced per-agent or total across all agents?
  - **Proposed A:** Total across all agents (shared budget); prevents budget multiplication with agent scaling

- **Q:** How granular should cost tracking be (per-request vs. per-project vs. daily aggregate)?
  - **Proposed A:** Per-request logging to State Tracking API; dashboard displays per-project and daily aggregates

- **Q:** Should we implement predictive cost estimation to prevent mid-project budget exhaustion?
  - **Proposed A:** Yes, estimate project cost before claiming (based on issue size, historical averages); skip if insufficient budget remains

### Conflict Management & Recovery
- **Q:** What is the maximum acceptable number of pending conflicts before pausing all agents?
  - **Proposed A:** If > 5 conflicts pending, pause new project claims until conflicts resolved; prevents overwhelming user

- **Q:** Should agents attempt automatic conflict resolution or always escalate to user?
  - **Proposed A:** Attempt auto-resolution for minor conflicts (< 5 files, simple merge); escalate complex conflicts to user

- **Q:** How do we handle conflicts in critical files (e.g., package.json, database schemas)?
  - **Proposed A:** Critical file list configured in workspace settings; conflicts in critical files always escalate to user (no auto-resolution)

### Category Rotation & Coverage
- **Q:** Should category selection prioritize high-value categories (e.g., Security, Testing) over others?
  - **Proposed A:** Start with LRU (equal priority); evaluate adding weighted prioritization based on category impact metrics

- **Q:** How do we measure "value" of self-generated projects to adjust category weights?
  - **Proposed A:** Weekly human review assigns value scores (0-10); calculate average per category; disable categories with avg < 5

- **Q:** Should disabled categories be permanently removed or periodically re-evaluated?
  - **Proposed A:** Re-evaluate disabled categories monthly; re-enable if codebase changes make category relevant again

### Monitoring & Alerting Thresholds
- **Q:** What are the optimal thresholds for health alerts (heartbeat timeout, error rate, etc.)?
  - **Proposed A:** Start conservative (60s heartbeat, 3 errors/hour); adjust based on observed agent behavior and false positive rate

- **Q:** Should alerts be configurable per workspace or use global defaults?
  - **Proposed A:** Global defaults initially; add workspace-level overrides in Phase 5 if needed

- **Q:** How do we prevent alert fatigue from too many notifications?
  - **Proposed A:** Rate limiting (max 1 notification per 5 minutes per alert type); consolidate related alerts into single notification

### Scalability & Performance
- **Q:** What is the maximum number of concurrent agents the system can reliably support?
  - **Proposed A:** Hard cap at 10 agents per workspace initially; evaluate scaling to 20-50 based on resource usage and performance metrics

- **Q:** How do we handle resource contention when 10 agents are running simultaneously (CPU, memory, API rate limits)?
  - **Proposed A:** Each agent gets dedicated CPU core (if available); shared rate limit pool; monitor resource usage and throttle if needed

- **Q:** Should agents use different Claude models (Sonnet vs. Opus) based on task complexity?
  - **Proposed A:** Start with Sonnet 4.5 for all agents; evaluate Opus for complex tasks (e.g., Architecture category) based on cost/quality tradeoff

---
