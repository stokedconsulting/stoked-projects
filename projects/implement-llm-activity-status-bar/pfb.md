# LLM Activity Status Bar

## 1. Feature Overview
**Feature Name:** LLM Activity Status Bar
**Owner:** stoked
**Status:** Draft
**Target Release:** v2.x (next minor)

### Summary
Replace the existing top-of-window LLM activity count display with a persistent status bar anchored to the bottom of the extension webview. The status bar shows a real-time ratio of active LLMs to the allocated concurrency limit, provides inline +/- controls to adjust the allocation on hover, displays a detailed breakdown popup of running LLM sessions after a 1-second hover delay, and automatically assigns generic prompts from configurable directories when active LLM count falls below the allocation ceiling.

---

## 2. Problem Statement

### What problem are we solving?
The current LLM activity indicator sits at the top of the extension window and disappears when navigating between views (projects list, agent dashboard, etc.). Users managing multi-agent workflows need constant, at-a-glance visibility into how many LLMs are actively working, what each one is doing, and how much headroom remains before hitting the concurrency cap. Additionally, there is no mechanism today to automatically backfill idle capacity with queued generic prompts, meaning allocated slots sit unused until the user manually launches a new session.

### Who is affected?
- **Power users** running multiple concurrent LLM agents (Claude Code, Qwen Coder, etc.) across a workspace and its git worktrees.
- **Solo developers** who want hands-free orchestration: set a concurrency target and let the extension keep all slots busy.

### Why now?
The agent dashboard provider (`agent-dashboard-provider.ts`), agent session manager, heartbeat manager, and `claude-monitor.ts` already exist and track Claude Code sessions in real time. The `maxConcurrent` configuration is already validated and exposed through `agent-config.ts`. The infrastructure is in place; what is missing is a persistent, cross-view UX surface and the auto-scheduling logic that turns idle capacity into productive work.

---

## 3. Goals & Success Metrics

### Goals
1. Provide always-visible LLM activity counts that persist across every webview panel in the extension.
2. Allow users to adjust the concurrency allocation directly from the status bar without opening settings.
3. Surface a hover popup that breaks down running sessions by LLM provider and current task description.
4. Automatically detect idle capacity every 30 seconds and assign generic prompts to fill unused slots.

### Success Metrics
| Metric | Target |
|--------|--------|
| Status bar visible on every view (projects, dashboard, settings) | 100% of views |
| Hover popup renders within 1 second of hover start | p95 < 1.2s |
| Auto-assignment fires within 30s of detecting idle capacity | 100% reliability |
| +/- concurrency adjustment reflected in config within 200ms | p95 < 200ms |
| No regression in webview render time | < 5% increase |

---

## 4. User Experience & Scope

### In Scope

**Status Bar Component**
- A fixed-position bar at the bottom of the webview, rendered in `media/main.js` and `media/agent-dashboard.js` (or a shared fragment), styled to match the VSCode status bar (`--vscode-statusBar-background`, `--vscode-statusBar-foreground`, `--vscode-statusBar-border`).
- Displays: `{active}/{allocated} [AutoAwesome icon]` where `active` is the count of currently running LLM sessions across the workspace and associated worktrees, and `allocated` is the `maxConcurrent` value from `agent-config.ts`.
- The AutoAwesome icon is an inline SVG or codicon approximation of the Material UI AutoAwesome sparkle icon.

**Hover Concurrency Controls**
- On hover over the allocated number, a `-` button appears before it and a `+` button appears after it.
- Clicking `+` increments `maxConcurrent` by 1 (capped at 10 per existing validation rules in `agent-config.ts`).
- Clicking `-` decrements by 1 (floored at 1).
- Changes are persisted to the VSCode workspace configuration immediately via `vscode.workspace.getConfiguration('claudeProjects').update('maxConcurrent', newValue)`.

**Hover Popup (Tooltip)**
- After hovering over any part of the status bar LLM section for >= 1 second, a popup panel appears above the status bar.
- The popup lists each active LLM session grouped by provider, e.g.:
  ```
  1 Claude Code: orchestration
  2 Qwen Coder: Phase work items (2.1, 2.2)
  ```
- Data sources:
  - **Claude Code sessions**: read from `.claude-sessions/*.signal` files (existing `ClaudeMonitor.countWorkspaceActiveSessions()` and signal file parsing).
  - **Other LLM providers**: new lightweight process-detection or PID-file convention (see Open Questions).
- The popup auto-dismisses when the cursor leaves the status bar area.

**Auto-Assignment of Generic Prompts**
- A 30-second polling interval checks whether `active < allocated`.
- When idle capacity is detected, the system reads `.md` files from two directories:
  1. `~/.claude-projects/generic/` (global prompts)
  2. `{workspace}/.claude-projects/generic/` (workspace-specific prompts)
- Files are concatenated into a `genericPrompts` list (deduplicated by filename).
- One prompt is selected (round-robin or random) and dispatched to a new terminal session, incrementing the active count.
- A prompt file that has been dispatched is moved to a `dispatched/` subdirectory (or a `.dispatched` marker file is created next to it) to avoid re-sending until the user resets it.

**Real-Time Data Pipeline**
- Extend `ClaudeMonitor` (or create a new `LlmActivityTracker` service) to:
  - Aggregate active session counts across the main workspace and all git worktrees (existing `countWorkspaceActiveSessions` logic).
  - Parse signal files to extract session descriptions/task labels for the hover popup.
  - Emit events to the webview via `postMessage` on a 2-second refresh cadence (matching the existing agent dashboard refresh interval).

### Out of Scope
- Deep integration with non-Claude LLM CLI tools (Qwen, Copilot, Cursor, etc.) beyond PID-file or process-name detection. Full lifecycle management for these tools is deferred.
- Budget or cost tracking integration with the status bar (the existing cost tracker in the agent dashboard remains separate).
- Mobile or remote development host support.
- Prompt authoring UI (users create `.md` files manually for now).

---

## 5. Assumptions & Constraints

1. **Claude Code signal files are the primary data source.** The `.claude-sessions/*.signal` JSON format is stable and will continue to include `state`, `session_id`, and `event` fields.
2. **Non-Claude LLMs will initially be tracked via a convention-based PID file** at `.claude-sessions/{provider}-{pid}.signal` that other tooling (e.g., a Qwen wrapper script analogous to `claude-session-wrapper.sh`) writes. Until those wrappers exist, non-Claude counts will be zero.
3. **The `maxConcurrent` config value (1-10) from `agent-config.ts` is the single source of truth** for the allocated slot count. The +/- buttons modify this same config key.
4. **Generic prompt files are user-authored Markdown.** The extension does not generate or validate prompt content.
5. **The status bar must render inside the webview** (not the native VSCode status bar API) because the extension uses a sidebar webview panel, and the native status bar is shared across all extensions.
6. **The webview does not use a framework.** All UI is vanilla JS in `media/main.js` and related files. The status bar must follow this pattern.

---

## 6. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Non-Claude LLMs have no standard signal/heartbeat mechanism | High | Medium | Define a lightweight `.signal` file convention and provide a template wrapper script (`llm-session-wrapper.sh`) that any CLI tool can use. Document the convention so users can adapt it to their tools. |
| File-system polling for signal files may miss rapid state changes | Medium | Low | Use `fs.watch` on the `.claude-sessions` directory (already done for Claude signals) and fall back to 2-second polling. Accept that sub-second accuracy is not required for a status display. |
| Auto-assignment of generic prompts could launch unwanted sessions | Medium | High | Gate auto-assignment behind an explicit opt-in setting (`claudeProjects.autoAssignGenericPrompts: false` by default). Show a notification before the first auto-launch in a session. |
| Hover popup flickers or is hard to dismiss | Medium | Low | Use a 1-second hover delay before showing, and dismiss on `mouseleave` with a small grace period (200ms) to prevent flicker when moving between the status bar and the popup. |
| +/- buttons cause rapid config writes | Low | Low | Debounce config writes by 300ms so rapid clicks result in a single write. |

---

## 7. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| `agent-config.ts` (`maxConcurrent`) | Internal | Read/write concurrency allocation. Already exists. |
| `claude-monitor.ts` (`ClaudeMonitor`) | Internal | Session counting and signal file parsing. Needs extension for provider-agnostic tracking and task description extraction. |
| `agent-session-manager.ts` | Internal | Existing session lifecycle management. May need minor API additions for the hover popup data. |
| `media/main.js`, `media/style.css` | Internal | Status bar HTML/CSS/JS lives here. Shared fragment needed if agent-dashboard also shows it. |
| `.claude-sessions/` directory convention | File system | Signal files for all LLM providers. |
| `~/.claude-projects/generic/` and `{workspace}/.claude-projects/generic/` | File system | Generic prompt storage. Must be created by the user or by the extension on first activation. |
| VSCode Webview API (`postMessage`) | Platform | Bidirectional communication between extension host and webview. |

---

## 8. Open Questions

1. **Non-Claude LLM detection strategy:** Should we rely solely on convention-based `.signal` files, or should we also scan running processes (`ps aux | grep qwen` etc.) as a fallback? Process scanning is more fragile but requires zero setup from the user.

2. **Generic prompt dispatch mechanism:** Should prompts be sent to a new VSCode integrated terminal (like Claude sessions today), or should we support configurable launch commands per LLM provider (e.g., `qwen --prompt "..."` vs. `claude -p "..."`)?

3. **Prompt recycling policy:** Once all generic prompts have been dispatched, should the system loop back to the beginning, wait for the user to add more, or stop auto-assigning?

4. **Status bar placement in agent dashboard view:** The agent dashboard (`agent-dashboard.js`) already shows agent counts and controls at the top. Should the status bar replace that top section, coexist, or should the agent dashboard defer entirely to the status bar for count display?

5. **Worktree detection frequency:** `getWorkspacePaths()` currently runs `git worktree list` synchronously. Should this be cached with a TTL to avoid repeated subprocess calls on every poll cycle?

6. **Hover popup content for non-Claude LLMs:** What task description should be shown when the LLM provider does not report structured signal data? Should we fall back to the prompt filename or a generic "running" label?

---

## 9. Non-Goals

- **Native VSCode Status Bar Item:** The feature explicitly uses an in-webview status bar, not `vscode.window.createStatusBarItem()`, because the extension operates within a sidebar webview panel.
- **LLM Provider Management UI:** No settings page for adding/removing/configuring LLM providers. Users configure providers through their own CLI tools and wrapper scripts.
- **Prompt Generation or AI-Assisted Prompt Authoring:** The generic prompts directory is manually populated. There is no UI for creating or editing prompts within the extension.
- **Cross-Machine Coordination:** The status bar tracks LLMs on the local machine only. Multi-machine orchestration is handled by the state-tracking API separately.
- **Token Usage or Cost Display in the Status Bar:** Cost tracking remains in the agent dashboard. The status bar focuses solely on activity counts and session identity.

---

## 10. Notes & References

- **Existing agent dashboard:** `apps/code-ext/src/agent-dashboard-provider.ts` and `apps/code-ext/media/agent-dashboard.js` already render agent counts and controls. The status bar should share data sources but provide a more compact, always-visible summary.
- **Claude Monitor implementation:** `apps/code-ext/src/claude-monitor.ts` contains `countWorkspaceActiveSessions()`, `getWorkspacePaths()`, and signal file parsing logic that the status bar will consume.
- **Agent config:** `apps/code-ext/src/agent-config.ts` defines `maxConcurrent` with validation (1-10 range, floor to integer). The +/- controls must respect these same bounds.
- **Session wrapper script:** `apps/code-ext/examples/claude-session-wrapper.sh` is the template for monitoring Claude CLI sessions. A similar wrapper can be created for other LLM CLIs.
- **CSS status bar styling:** `apps/code-ext/media/style.css` already has a cache indicator styled as a bottom status bar (lines 726-735) using `--vscode-statusBar-*` CSS variables. The LLM status bar should follow the same visual pattern.
- **Material UI AutoAwesome icon:** The sparkle/star icon from MUI. For the webview, use an inline SVG path or the closest VSCode codicon (`$(sparkle)` or a custom SVG).
- **Generic prompts directory convention:** `~/.claude-projects/generic/*.md` for global prompts, `{workspace}/.claude-projects/generic/*.md` for workspace-scoped prompts.
