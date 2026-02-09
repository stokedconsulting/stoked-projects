# Product Requirements Document: LLM Activity Status Bar

## 0. Source Context

**Feature Brief:** `./projects/implement-llm-activity-status-bar/pfb.md`
**Repository:** `claude-projects` monorepo
**Target Package:** `apps/code-ext/` (VSCode extension)
**Related Source Files:**
- `apps/code-ext/src/claude-monitor.ts` - Session tracking and signal file parsing
- `apps/code-ext/src/agent-config.ts` - `maxConcurrent` configuration (1-10 range)
- `apps/code-ext/src/projects-view-provider.ts` - Webview provider, uses `countWorkspaceActiveSessions()`
- `apps/code-ext/src/agent-dashboard-provider.ts` - Agent dashboard with session counts
- `apps/code-ext/media/main.js` - Vanilla JS webview frontend
- `apps/code-ext/media/style.css` - Webview styling (existing `.cache-indicator` bottom bar pattern at line 726)

---

## 1. Objectives & Constraints

### Objectives

1. **Always-visible activity counts.** Display `{active}/{allocated}` LLM session counts in a persistent bottom status bar visible across every webview panel (projects list, agent dashboard, settings).
2. **Inline concurrency adjustment.** Allow users to increment/decrement `maxConcurrent` directly from the status bar via hover-revealed +/- controls, without opening settings.
3. **Session breakdown on hover.** After a 1-second hover delay, show a popup listing each active LLM session grouped by provider with task descriptions.
4. **Automatic idle capacity filling.** Poll every 30 seconds; when `active < allocated`, dispatch generic prompts from `~/.claude-projects/generic/` and `{workspace}/.claude-projects/generic/` to fill idle slots.

### Constraints

- **Vanilla JS only.** The webview uses no framework. All UI must be implemented in plain JavaScript and CSS within `media/main.js` (or a shared fragment) and `media/style.css`.
- **In-webview rendering.** The status bar lives inside the sidebar webview, not the native VSCode status bar API (`vscode.window.createStatusBarItem` is not used).
- **Existing config boundaries.** `maxConcurrent` is validated to the range [1, 10] with integer flooring in `agent-config.ts`. The +/- controls must respect these bounds.
- **Signal file convention.** Claude sessions use `.claude-sessions/*.signal` JSON files. Non-Claude providers will follow the same convention via wrapper scripts; until those exist, non-Claude counts are zero.
- **Auto-assignment is opt-in.** The `claudeProjects.autoAssignGenericPrompts` setting defaults to `false`. Users must explicitly enable it.
- **No regression.** Webview render time must not increase by more than 5%.

---

## 2. Execution Phases

---

### Phase 1: LLM Activity Tracker Service

**Purpose:** Build a provider-agnostic backend service that aggregates active LLM session data from signal files across the workspace and all git worktrees, and exposes structured session metadata for the UI layer.

#### 1.1 Create `LlmActivityTracker` Service

**Implementation Details:**
- Create `apps/code-ext/src/llm-activity-tracker.ts` as a new TypeScript class.
- The service wraps and extends `ClaudeMonitor.countWorkspaceActiveSessions()` and `ClaudeMonitor.getWorkspacePaths()` (which will need to be made public or the tracker instantiates its own logic).
- Define an `LlmSessionInfo` interface:
  ```typescript
  interface LlmSessionInfo {
      sessionId: string;
      provider: string;       // 'claude-code' | 'qwen-coder' | string
      state: 'responding' | 'stopped' | 'idle';
      taskDescription: string; // Extracted from signal file or fallback to filename
      workspacePath: string;
      lastUpdated: number;    // epoch ms
  }
  ```
- Scan `.claude-sessions/*.signal` files in the main workspace and all worktree paths.
- Parse each signal file to extract `session_id`, `state`, `event`, and a `provider` field (default `'claude-code'` if absent). Extract task description from `project_update.type` or `event` field, falling back to `"running"`.
- Support a provider-agnostic naming convention: `{provider}-{id}.signal` (e.g., `qwen-abc123.signal`). If the filename starts with a known provider prefix, infer the provider from it.
- Expose methods:
  - `getActiveSessionCount(): number`
  - `getActiveSessions(): LlmSessionInfo[]`
  - `getSessionsByProvider(): Map<string, LlmSessionInfo[]>`
  - `refresh(): void` (manually trigger a re-scan)
- Cache workspace paths with a 60-second TTL to avoid repeated `git worktree list` subprocess calls.

**Acceptance Criteria:**
- AC-1.1.a: Calling `getActiveSessionCount()` returns the count of signal files with `state === 'responding'` or recently modified `stopped`/`idle` files (within 60 seconds), consistent with existing `countWorkspaceActiveSessions()` logic.
- AC-1.1.b: Calling `getActiveSessions()` returns an array of `LlmSessionInfo` objects, one per active signal file, with provider, state, and taskDescription populated.
- AC-1.1.c: Calling `getSessionsByProvider()` returns sessions grouped by provider string (e.g., `{ 'claude-code': [...], 'qwen-coder': [...] }`).
- AC-1.1.d: Workspace paths (including worktrees) are cached for 60 seconds; consecutive calls within the TTL do not spawn a `git worktree list` subprocess.

**Acceptance Tests:**
- Test-1.1.a: Unit test. Create 3 mock signal files (2 `responding`, 1 `idle` within 60s). Assert `getActiveSessionCount()` returns 3. Create 1 stale `idle` file (modified 10 minutes ago). Assert count remains 3.
- Test-1.1.b: Unit test. Create signal files with distinct `session_id` values and `event` fields. Assert `getActiveSessions()` returns matching `LlmSessionInfo` objects with correct `taskDescription`.
- Test-1.1.c: Unit test. Create signal files from two providers (`claude-code` and `qwen-coder`). Assert `getSessionsByProvider()` returns a Map with two keys and correct grouping.
- Test-1.1.d: Unit test. Mock `execSync('git worktree list')`. Call `getActiveSessionCount()` twice within 60 seconds. Assert `execSync` was called only once.

---

#### 1.2 Emit Activity Events to Webview

**Implementation Details:**
- Add a 2-second interval timer in `LlmActivityTracker` that calls `refresh()` and emits an `llmActivityUpdate` event.
- In `projects-view-provider.ts`, instantiate `LlmActivityTracker` and subscribe to its events. Forward updates to the webview via:
  ```typescript
  this._view.webview.postMessage({
      type: 'llmActivityUpdate',
      active: tracker.getActiveSessionCount(),
      allocated: getAgentConfig().maxConcurrent,
      sessions: tracker.getActiveSessions()
  });
  ```
- Similarly wire the same message in `agent-dashboard-provider.ts` so both webviews receive updates.
- On webview `ready` message, send an immediate `llmActivityUpdate` so the status bar renders without waiting for the first interval tick.

**Acceptance Criteria:**
- AC-1.2.a: The webview receives an `llmActivityUpdate` message within 500ms of sending the `ready` message.
- AC-1.2.b: The webview receives periodic `llmActivityUpdate` messages every 2 seconds (+/- 500ms).
- AC-1.2.c: Each `llmActivityUpdate` message contains `active` (number), `allocated` (number), and `sessions` (array of `LlmSessionInfo`).

**Acceptance Tests:**
- Test-1.2.a: Integration test. Mock webview. Send `ready` message, assert `llmActivityUpdate` is posted within 500ms.
- Test-1.2.b: Integration test. Start tracker, wait 5 seconds, assert at least 2 `llmActivityUpdate` messages received.
- Test-1.2.c: Integration test. Create 2 signal files, start tracker. Assert the `llmActivityUpdate` payload has `active === 2`, `allocated` matching config, and `sessions.length === 2`.

---

### Phase 2: Status Bar UI

**Purpose:** Render a persistent bottom status bar in the webview showing the `{active}/{allocated}` LLM count with an AutoAwesome icon, visible across all views.

#### 2.1 Status Bar HTML/CSS Component

**Implementation Details:**
- In `media/style.css`, add a `.llm-status-bar` class following the existing `.cache-indicator` pattern (fixed position, bottom: 0, left: 0, right: 0, z-index 1000+).
- Style with VSCode theme variables: `--vscode-statusBar-background`, `--vscode-statusBar-foreground`, `--vscode-statusBar-border`.
- Layout: flexbox row with `align-items: center`, `gap: 8px`, `padding: 4px 12px`, `font-size: 11px`.
- The bar contains: AutoAwesome SVG icon (16x16, inline), the text `{active}/{allocated}`, and a spacer. The existing `.cache-indicator` (if present) should be integrated into or replaced by this bar to avoid two bottom bars.
- The AutoAwesome icon is an inline SVG matching the Material UI AutoAwesome sparkle design, colored with `currentColor` to inherit the status bar foreground.
- Add a subtle pulse animation on the icon when `active > 0` (CSS `@keyframes` with opacity oscillation, `animation-duration: 2s`).
- Ensure `body` or the main content container has `padding-bottom` of at least the status bar height (approximately 28px) so content is not obscured.

**Acceptance Criteria:**
- AC-2.1.a: The status bar is rendered as a fixed-position element at the bottom of the webview, spanning full width.
- AC-2.1.b: The bar uses VSCode status bar theme variables and visually matches the native VSCode status bar appearance.
- AC-2.1.c: The AutoAwesome icon is visible at 16x16 pixels to the left of the count text.
- AC-2.1.d: When `active > 0`, the icon has a subtle pulse animation. When `active === 0`, the icon is static.
- AC-2.1.e: Page content does not overlap or get obscured by the status bar (adequate bottom padding).

**Acceptance Tests:**
- Test-2.1.a: Visual test. Open the extension sidebar. Verify a bar is anchored to the bottom of the webview.
- Test-2.1.b: Visual test. Switch between light and dark VSCode themes. Verify the bar adapts colors.
- Test-2.1.c: DOM test. Query `.llm-status-bar svg`. Assert the SVG element exists and has width/height of 16.
- Test-2.1.d: DOM test. When `active > 0`, assert the icon element has an `animating` class or equivalent animation style. When `active === 0`, assert no animation class.
- Test-2.1.e: Scroll test. Add enough project cards to overflow. Scroll to bottom. Verify the last card is fully visible above the status bar.

---

#### 2.2 Status Bar Data Binding and Cross-View Persistence

**Implementation Details:**
- In `media/main.js`, add a message handler for `llmActivityUpdate`:
  ```javascript
  case 'llmActivityUpdate':
      updateLlmStatusBar(message.active, message.allocated, message.sessions);
      break;
  ```
- Implement `updateLlmStatusBar(active, allocated, sessions)` that:
  1. Creates the status bar DOM element on first call (lazy initialization).
  2. Updates the count text to `${active}/${allocated}`.
  3. Stores the sessions array in a module-level variable for the hover popup (Phase 3).
  4. Adds/removes the pulse animation class based on `active > 0`.
- Store `{ active, allocated }` in the webview state (`vscode.setState()`) so the status bar renders immediately on webview restore without waiting for the first `postMessage`.
- If an `agent-dashboard.js` exists as a separate file, create a shared `llm-status-bar.js` fragment that both files include, or duplicate the status bar rendering logic in both files.

**Acceptance Criteria:**
- AC-2.2.a: The status bar displays the correct `active/allocated` count immediately after receiving an `llmActivityUpdate` message.
- AC-2.2.b: When the webview is hidden and re-shown (e.g., user clicks away and back), the status bar renders immediately from cached state before the first `postMessage` arrives.
- AC-2.2.c: The status bar is visible on both the projects view and the agent dashboard view (if both exist).
- AC-2.2.d: The count updates in real-time as signal files are created or removed (within the 2-second refresh cadence).

**Acceptance Tests:**
- Test-2.2.a: Functional test. Send `llmActivityUpdate` with `active: 3, allocated: 5`. Assert status bar text reads `3/5`.
- Test-2.2.b: Functional test. Send an update, then simulate webview hide/restore. Assert the status bar shows the last known values immediately.
- Test-2.2.c: Manual test. Open projects view, verify status bar. Switch to agent dashboard, verify status bar.
- Test-2.2.d: Functional test. Create a new signal file. Wait 3 seconds. Assert the status bar `active` count incremented by 1.

---

### Phase 3: Interactive Controls

**Purpose:** Add hover-triggered concurrency adjustment buttons (+/-) and a 1-second-delayed hover popup showing per-provider session breakdown.

#### 3.1 Hover +/- Concurrency Controls

**Implementation Details:**
- Wrap the allocated number in a `<span class="llm-allocated-control">` container.
- On `mouseenter` of this container, inject a `-` button before the number and a `+` button after it. Use VSCode codicon classes or plain text buttons styled as small icon buttons.
- On `mouseleave` (with a 300ms grace period to prevent flicker), remove the buttons.
- Clicking `+` sends a `postMessage({ type: 'adjustConcurrency', delta: +1 })` to the extension host.
- Clicking `-` sends `postMessage({ type: 'adjustConcurrency', delta: -1 })`.
- In `projects-view-provider.ts` (and `agent-dashboard-provider.ts`), handle `adjustConcurrency`:
  ```typescript
  case 'adjustConcurrency': {
      const config = getAgentConfig();
      const newValue = Math.max(1, Math.min(10, config.maxConcurrent + message.delta));
      await vscode.workspace.getConfiguration('claudeProjects.agents')
          .update('maxConcurrent', newValue, vscode.ConfigurationTarget.Workspace);
      // Immediately send updated llmActivityUpdate
      break;
  }
  ```
- Debounce the config write by 300ms so rapid clicks coalesce into a single write. Implement debouncing on the extension host side.
- After the config write, immediately send a new `llmActivityUpdate` message to reflect the changed `allocated` value.

**Acceptance Criteria:**
- AC-3.1.a: Hovering over the allocated number reveals `-` and `+` buttons within 100ms.
- AC-3.1.b: Clicking `+` increments the displayed `allocated` count by 1, up to a maximum of 10.
- AC-3.1.c: Clicking `-` decrements the displayed `allocated` count by 1, down to a minimum of 1.
- AC-3.1.d: The `maxConcurrent` value in VSCode workspace configuration is updated within 500ms of the last click (300ms debounce + write time).
- AC-3.1.e: Moving the cursor away from the allocated area hides the +/- buttons after a 300ms grace period.
- AC-3.1.f: Rapid-clicking `+` five times results in only one config write (debounced).

**Acceptance Tests:**
- Test-3.1.a: DOM test. Simulate `mouseenter` on `.llm-allocated-control`. Assert `-` and `+` button elements appear.
- Test-3.1.b: Functional test. Set `maxConcurrent` to 5. Click `+`. Assert status bar shows `X/6` and config reads 6.
- Test-3.1.c: Functional test. Set `maxConcurrent` to 1. Click `-`. Assert status bar still shows `X/1` (floor at 1).
- Test-3.1.d: Timing test. Click `+`, wait 400ms. Read config. Assert it was written once with the new value.
- Test-3.1.e: DOM test. Simulate `mouseenter` then `mouseleave`. Wait 400ms. Assert buttons are removed.
- Test-3.1.f: Timing test. Click `+` 5 times rapidly (within 200ms). Wait 500ms. Assert `vscode.workspace.getConfiguration().update` was called exactly once with delta of +5 total.

---

#### 3.2 Hover Popup with Session Breakdown

**Implementation Details:**
- Create a `.llm-hover-popup` element: absolutely positioned above the status bar, styled as a tooltip card with `background: var(--vscode-editorWidget-background)`, `border: 1px solid var(--vscode-editorWidget-border)`, `border-radius: 4px`, `padding: 8px 12px`, `box-shadow`, `max-height: 200px`, `overflow-y: auto`.
- Trigger logic: on `mouseenter` of the `.llm-status-bar`, start a 1-second timer. If the cursor remains within the bar for >= 1 second, show the popup. On `mouseleave` from both the bar and the popup, start a 200ms dismiss timer. If the cursor re-enters either element within 200ms, cancel the dismiss.
- Popup content is built from the `sessions` array stored during the last `llmActivityUpdate`:
  - Group sessions by `provider`.
  - For each group, render a line: `{count} {providerLabel}: {taskDescriptions}`.
  - Provider labels: `'claude-code'` displays as `'Claude Code'`, `'qwen-coder'` as `'Qwen Coder'`, etc. Unknown providers display their raw string with title-casing.
  - Task descriptions are comma-separated. If more than 3 in a group, show the first 3 and `+N more`.
- If no sessions are active, the popup shows `"No active LLM sessions"`.
- The popup has a small triangular pointer (CSS `::after` pseudo-element) pointing down toward the status bar.

**Acceptance Criteria:**
- AC-3.2.a: Hovering over the status bar for >= 1 second shows the popup. Hovering for < 1 second and leaving does not.
- AC-3.2.b: The popup displays sessions grouped by provider with correct counts and task descriptions.
- AC-3.2.c: The popup dismisses within 200ms of the cursor leaving both the status bar and the popup.
- AC-3.2.d: Moving the cursor from the status bar directly into the popup does not dismiss it (grace period works).
- AC-3.2.e: When no sessions are active, the popup shows `"No active LLM sessions"`.
- AC-3.2.f: The popup does not exceed 200px in height; overflow content is scrollable.

**Acceptance Tests:**
- Test-3.2.a: Timing test. Simulate `mouseenter` on status bar. Wait 800ms, assert popup not visible. Wait 300ms more (total 1100ms), assert popup is visible.
- Test-3.2.b: Functional test. Provide 2 `claude-code` sessions and 1 `qwen-coder` session. Assert popup contains `"2 Claude Code"` and `"1 Qwen Coder"`.
- Test-3.2.c: Timing test. Show popup. Simulate `mouseleave` from both elements. Wait 250ms. Assert popup is hidden.
- Test-3.2.d: Timing test. Show popup. Move cursor from status bar to popup element within 100ms. Assert popup remains visible.
- Test-3.2.e: Functional test. Set `sessions` to empty array. Trigger popup. Assert text reads `"No active LLM sessions"`.
- Test-3.2.f: DOM test. Provide 15 sessions. Trigger popup. Assert `.llm-hover-popup` has `max-height: 200px` and `overflow-y: auto`.

---

### Phase 4: Auto-Assignment Engine

**Purpose:** Implement a 30-second polling loop that detects idle LLM capacity and automatically dispatches generic prompts from configurable directories to fill unused slots.

#### 4.1 Generic Prompt Discovery

**Implementation Details:**
- Create `apps/code-ext/src/generic-prompt-manager.ts`.
- Define two source directories:
  1. Global: `~/.claude-projects/generic/` (resolve `~` via `os.homedir()`).
  2. Workspace: `{workspaceRoot}/.claude-projects/generic/`.
- On `discoverPrompts()`, read all `.md` files from both directories. Deduplicate by filename (workspace-specific takes precedence over global if filenames collide).
- Exclude files in a `dispatched/` subdirectory and files with a sibling `.dispatched` marker (e.g., `prompt-a.md.dispatched`).
- Return an array of `GenericPrompt` objects:
  ```typescript
  interface GenericPrompt {
      filePath: string;
      filename: string;
      source: 'global' | 'workspace';
      content: string;
  }
  ```
- Implement `markDispatched(prompt: GenericPrompt): void` which creates a `.dispatched` marker file next to the original (e.g., `prompt-a.md.dispatched` containing the dispatch timestamp).
- Implement `getAvailableCount(): number` returning the count of undispatched prompts.
- Handle missing directories gracefully (log and return empty array; do not create directories automatically).

**Acceptance Criteria:**
- AC-4.1.a: `discoverPrompts()` returns `.md` files from both global and workspace directories.
- AC-4.1.b: Files in `dispatched/` subdirectories are excluded from results.
- AC-4.1.c: Files with a sibling `.dispatched` marker are excluded from results.
- AC-4.1.d: When filenames collide between global and workspace, the workspace version is used.
- AC-4.1.e: Missing directories do not cause errors; an empty array is returned.
- AC-4.1.f: `markDispatched()` creates a `.dispatched` marker file next to the prompt file.

**Acceptance Tests:**
- Test-4.1.a: Unit test. Create 2 `.md` files in a mock global dir and 1 in a mock workspace dir. Assert `discoverPrompts()` returns 3 items.
- Test-4.1.b: Unit test. Move one file to `dispatched/` subdirectory. Assert it is excluded.
- Test-4.1.c: Unit test. Create a `.dispatched` marker next to a file. Assert it is excluded.
- Test-4.1.d: Unit test. Create `task.md` in both dirs. Assert only the workspace version is returned.
- Test-4.1.e: Unit test. Point to a non-existent directory. Assert `discoverPrompts()` returns `[]` without throwing.
- Test-4.1.f: Unit test. Call `markDispatched()` on a prompt. Assert the `.dispatched` marker file exists with a timestamp.

---

#### 4.2 Auto-Assignment Polling and Dispatch

**Implementation Details:**
- In `LlmActivityTracker` (or a new `AutoAssignmentEngine` class), implement a 30-second `setInterval` polling loop.
- On each tick:
  1. Read the `claudeProjects.autoAssignGenericPrompts` setting. If `false`, skip.
  2. Compute `idle = allocated - active`. If `idle <= 0`, skip.
  3. Call `genericPromptManager.discoverPrompts()`. If empty, skip.
  4. Select the next prompt using round-robin order (track an index in memory, wrapping around).
  5. Dispatch the prompt by creating a new VSCode integrated terminal and running the Claude CLI command: `claude -p "$(cat {promptFilePath})"`.
  6. Call `markDispatched(prompt)` to prevent re-dispatch.
  7. Create a signal file for the new session so `LlmActivityTracker` picks it up on the next refresh.
  8. Show a transient information notification: `"Auto-assigned: {filename}"`.
- On the very first auto-dispatch in a VSCode session, show a confirmation notification: `"Auto-assignment is launching generic prompts to fill idle LLM capacity. Disable via settings."` with a `"Disable"` action that sets `autoAssignGenericPrompts` to `false`.
- The polling loop is started when the extension activates and stopped on deactivation (`context.subscriptions`).
- Register the `claudeProjects.autoAssignGenericPrompts` configuration setting in `package.json` with default `false`, type `boolean`, and description.

**Acceptance Criteria:**
- AC-4.2.a: When `autoAssignGenericPrompts` is `false` (default), no prompts are dispatched regardless of idle capacity.
- AC-4.2.b: When enabled and `active < allocated`, one prompt is dispatched per polling tick (30 seconds) until capacity is full or prompts are exhausted.
- AC-4.2.c: Dispatched prompts are marked and not re-dispatched in subsequent ticks.
- AC-4.2.d: A new integrated terminal is created for each dispatched prompt with the correct CLI command.
- AC-4.2.e: The first auto-dispatch in a VSCode session shows a one-time confirmation notification with a `"Disable"` action.
- AC-4.2.f: The polling loop does not run when the setting is disabled, minimizing resource usage.
- AC-4.2.g: The `autoAssignGenericPrompts` setting is registered in `package.json` with `default: false`.

**Acceptance Tests:**
- Test-4.2.a: Functional test. Set `autoAssignGenericPrompts: false`. Create idle capacity and generic prompts. Wait 35 seconds. Assert no terminals were created.
- Test-4.2.b: Functional test. Set `autoAssignGenericPrompts: true`, `maxConcurrent: 3`, `active: 1`. Create 2 generic prompts. Wait 65 seconds (2 ticks). Assert 2 terminals were created.
- Test-4.2.c: Functional test. Dispatch a prompt. Wait for next tick. Assert the same prompt file is not dispatched again (`.dispatched` marker present).
- Test-4.2.d: Integration test. Dispatch a prompt. Assert `vscode.window.createTerminal()` was called and `terminal.sendText()` received the correct command string.
- Test-4.2.e: Functional test. Enable auto-assignment. Wait for first dispatch. Assert an information message with `"Disable"` action was shown. Wait for second dispatch. Assert no second confirmation message.
- Test-4.2.f: Functional test. Disable auto-assignment. Assert the interval timer is cleared or the tick exits immediately.
- Test-4.2.g: Schema test. Assert `package.json` contains `claudeProjects.autoAssignGenericPrompts` with type `boolean` and default `false`.

---

#### 4.3 Status Bar Auto-Assignment Indicator

**Implementation Details:**
- When auto-assignment is enabled and idle capacity exists, add a small indicator to the status bar: a subtle `+` badge or a secondary text like `(auto)` after the count.
- When auto-assignment is dispatching (actively launching a prompt), briefly flash the AutoAwesome icon (200ms green tint via CSS class toggle).
- Add a right-click context menu on the status bar with options:
  - `"Enable Auto-Assignment"` / `"Disable Auto-Assignment"` (toggle)
  - `"Open Generic Prompts Folder"` (opens the workspace `.claude-projects/generic/` directory in the file explorer)

**Acceptance Criteria:**
- AC-4.3.a: When auto-assignment is enabled and idle capacity exists, the status bar shows an `(auto)` indicator.
- AC-4.3.b: When auto-assignment is disabled or capacity is full, no `(auto)` indicator is shown.
- AC-4.3.c: During prompt dispatch, the AutoAwesome icon briefly flashes green (200ms).
- AC-4.3.d: Right-clicking the status bar shows a context menu with toggle and folder-open options.
- AC-4.3.e: Selecting `"Disable Auto-Assignment"` from the context menu sets `autoAssignGenericPrompts` to `false` and the indicator disappears.

**Acceptance Tests:**
- Test-4.3.a: DOM test. Enable auto-assignment with idle capacity. Assert `.llm-auto-indicator` element is visible in the status bar.
- Test-4.3.b: DOM test. Disable auto-assignment. Assert `.llm-auto-indicator` is not present.
- Test-4.3.c: Visual test. Trigger a dispatch. Assert the icon element briefly receives a `dispatch-flash` CSS class.
- Test-4.3.d: DOM test. Simulate right-click on status bar. Assert a context menu appears with the expected options.
- Test-4.3.e: Functional test. Select `"Disable Auto-Assignment"` from context menu. Assert config is updated and `(auto)` indicator is removed.

---

## 3. Completion Criteria

The feature is complete when all of the following are true:

1. **Phase 1 complete:** `LlmActivityTracker` service correctly aggregates session data from signal files across workspace and worktrees, emits `llmActivityUpdate` events every 2 seconds, and caches worktree paths with a 60-second TTL.
2. **Phase 2 complete:** A persistent status bar is visible at the bottom of both the projects webview and agent dashboard webview, displaying `{active}/{allocated}` with an AutoAwesome icon that pulses when active > 0, and the bar persists across view switches via cached state.
3. **Phase 3 complete:** Hovering over the allocated count reveals +/- buttons that adjust `maxConcurrent` (debounced 300ms), and hovering over the status bar for >= 1 second shows a popup with sessions grouped by provider and task description.
4. **Phase 4 complete:** A 30-second polling loop dispatches generic prompts from `~/.claude-projects/generic/` and workspace-scoped directories when `active < allocated` and auto-assignment is enabled, with dispatched prompts marked to prevent re-dispatch.
5. **Build passes:** `cd apps/code-ext && pnpm run compile` succeeds with zero errors.
6. **No render regression:** Webview initial render time has not increased by more than 5% compared to baseline.

---

## 4. Rollout & Validation

### Pre-Release Checklist

- [ ] All acceptance tests pass (unit, integration, functional, DOM, visual).
- [ ] `pnpm run compile` succeeds in `apps/code-ext/`.
- [ ] Manual testing: open extension in VSCode with 0 active sessions, verify `0/N` display.
- [ ] Manual testing: start 2 Claude sessions, verify `2/N` display within 4 seconds.
- [ ] Manual testing: hover +/- controls work, config persists after reload.
- [ ] Manual testing: hover popup shows session breakdown after 1 second.
- [ ] Manual testing: enable auto-assignment with 1 prompt file, verify dispatch within 30 seconds.
- [ ] Manual testing: switch between projects view and agent dashboard, verify status bar persists.
- [ ] Performance: measure webview render time before and after, confirm < 5% increase.

### Rollout Plan

1. **Phase 1-2** ship together as the minimum viable feature (activity counts visible).
2. **Phase 3** ships as a fast-follow (interactive controls and popup).
3. **Phase 4** ships behind the `autoAssignGenericPrompts: false` default flag. Users opt in explicitly.
4. Non-Claude LLM provider support is documented via the signal file convention but not actively tested until wrapper scripts for other providers are available.

---

## 5. Open Questions

1. **Non-Claude LLM detection strategy:** The PRD specifies convention-based `.signal` files only. Process scanning (`ps aux | grep`) is deferred. Should we provide a template `llm-session-wrapper.sh` script alongside the feature, or defer that to a separate work item?

2. **Generic prompt dispatch mechanism:** This PRD assumes Claude CLI (`claude -p "..."`) as the dispatch command. Should the dispatch command be configurable per-provider (e.g., `qwen --prompt "..."`)? If so, what is the configuration schema?

3. **Prompt recycling policy:** Once all generic prompts have been dispatched (all have `.dispatched` markers), the auto-assignment loop has nothing to send. Should there be a `"Reset Dispatched Prompts"` command or should `.dispatched` markers auto-expire after a configurable time (e.g., 24 hours)?

4. **Status bar vs. agent dashboard overlap:** The agent dashboard already shows agent counts at the top. This PRD adds a bottom status bar to all views. Should Phase 2 also remove or simplify the top-of-dashboard agent count to avoid redundancy? Decision deferred to implementation.

5. **Worktree detection caching:** The PRD specifies a 60-second cache TTL for worktree paths. Is this sufficient, or should worktree detection be event-driven (triggered by git operations)?

6. **Hover popup for unknown providers:** When a non-Claude provider signal file lacks structured task data, the popup falls back to `"running"`. Should we instead display the prompt filename or signal file event field?
