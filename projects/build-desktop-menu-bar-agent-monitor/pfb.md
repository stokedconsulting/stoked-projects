# Desktop Menu Bar Agent Monitor

## 1. Feature Overview

**Feature Name:** Desktop Menu Bar Agent Monitor
**Owner:** Stoked Consulting
**Status:** Proposed
**Target Release:** Q2 2026

### Summary

A native desktop menu bar application that provides system-wide access to GitHub Projects management and Claude AI agent orchestration, mirroring the functionality of the existing VSCode extension (`apps/code-ext/`). This enables developers to monitor agent status, control autonomous workflows, and track costs without requiring VSCode to be open. Both products will be maintained in parallel, sharing a common core logic layer to maximize code reuse and ensure consistent behavior.

---

## 2. Problem Statement

### What problem are we solving?

Developers using Claude AI for autonomous project execution currently must have VSCode open to monitor and control their agents. This creates friction when:
- Working in other IDEs or editors (JetBrains, Vim, etc.)
- Performing non-coding tasks while agents run
- Needing quick status checks without context-switching to VSCode
- Monitoring multiple workspaces or agents across different projects
- Requiring emergency controls when VSCode is not immediately accessible

The existing VSCode extension provides comprehensive agent management (session monitoring, cost tracking, emergency controls, project queue management), but these capabilities are locked within the VSCode ecosystem.

### Who is affected?

1. **Primary Users**: Developers and teams using Claude AI for autonomous project execution who need quick, system-wide access to agent status and controls
2. **Secondary Users**: Engineering managers monitoring team-wide agent usage and costs
3. **Power Users**: Developers running multiple concurrent agents across multiple workspaces who need centralized monitoring

### Why now?

1. **Growing autonomous agent adoption**: As multi-agent orchestration matures (the VSCode extension now supports 1-10 concurrent agents), users need lightweight monitoring outside VSCode
2. **Cost management concerns**: With models like Claude Opus costing $15/M input tokens and $75/M output tokens, budget visibility is critical - users need instant access to cost tracking
3. **Emergency control requirements**: The existing emergency stop functionality (SIGKILL all agents, recovery mechanisms) must be accessible without opening VSCode
4. **Code maturity**: The VSCode extension codebase is now mature enough (agent-dashboard-provider, claude-monitor, cost-tracker, emergency-controls) to extract into a shared core

---

## 3. Goals & Success Metrics

### Goals

1. **Feature Parity**: Deliver all core monitoring and control capabilities from the VSCode extension in a native menu bar application
2. **Instant Access**: Provide sub-2-second access to agent status and controls from anywhere in the operating system
3. **Shared Core**: Extract 70%+ of business logic into reusable packages consumed by both VSCode extension and menu bar app
4. **Real-Time Updates**: Deliver agent status updates within 5 seconds of state changes
5. **Cross-Platform**: Support macOS initially, with architecture that enables Windows and Linux in future releases

### Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| App launch time | < 2 seconds | Automated performance testing |
| Agent status update latency | < 5 seconds | WebSocket event-to-UI timing |
| Shared code percentage | > 70% | Lines of code analysis (shared packages vs app-specific) |
| User adoption | 50% of VSCode extension users | Analytics tracking |
| Emergency stop response time | < 1 second | Time from click to SIGKILL signal |
| Memory footprint | < 100MB idle | Process monitoring |
| CPU usage (idle) | < 1% | Process monitoring |

---

## 4. User Experience & Scope

### In Scope

**Core Features (MVP)**
1. **Menu Bar Icon with Status Indicator**
   - System tray icon showing aggregate agent status (all idle, working, error)
   - Color-coded badge: green (healthy), yellow (warning), red (error/stopped)
   - Click to open main panel

2. **Projects View**
   - List of GitHub Projects linked to configured workspaces
   - Phase-based organization with work item grouping (mirrors `phase-logic.ts`)
   - Status indicators per project (Todo, In Progress, Done)
   - Quick actions: view on GitHub, refresh

3. **Agent Dashboard**
   - Real-time agent status grid (mirroring `agent-dashboard-provider.ts`)
   - Per-agent details: status, current task, elapsed time, progress
   - Health status indicators (healthy, degraded, unresponsive)
   - Quick actions: pause, resume, stop individual agents

4. **Session Monitoring**
   - Active Claude sessions list (based on `claude-monitor.ts`)
   - Session type indicators (execution vs creation)
   - Response file preview
   - Auto-continuation status

5. **Cost Tracking Display**
   - Daily and monthly spend totals (from `cost-tracker.ts`)
   - Budget status (remaining, percentage used)
   - Per-agent cost breakdown
   - Alert indicators at 50%, 75%, 90% thresholds

6. **Emergency Controls**
   - Emergency Stop All button (prominent, always accessible)
   - Pause All / Resume All controls
   - Recovery options menu (from `emergency-controls.ts`)

7. **Settings & Configuration**
   - Workspace configuration (paths to monitor)
   - API endpoint configuration
   - Notification preferences
   - Theme (light/dark, follows system)

**Platform Support**
- macOS: Native menu bar integration via Electron or Tauri
- Future: Windows system tray, Linux app indicator

### Out of Scope

1. **Full Project Management**: Creating/editing GitHub issues, managing project boards (use VSCode extension or GitHub web UI)
2. **Code Editing**: No integrated code editor or diff viewer
3. **Agent Spawning**: Starting new agent sessions (use VSCode extension or CLI)
4. **Detailed Analytics**: Historical charts, trend analysis (future enhancement)
5. **Mobile Apps**: iOS/Android versions
6. **Windows/Linux for MVP**: Cross-platform support will follow macOS release
7. **MCP Server Operations**: Direct GitHub API mutations (handled by MCP Server layer)

---

## 5. Assumptions & Constraints

### Assumptions

1. **Shared File System**: Menu bar app and VSCode extension share access to workspace directories (`.claude-sessions/`, signal files)
2. **Local State Tracking API**: The NestJS State Tracking API (`packages/api/`) is running or reachable
3. **WebSocket Availability**: Real-time updates rely on WebSocket connections to the notification server
4. **GitHub Authentication**: Users have authenticated via existing OAuth flow (tokens stored securely)
5. **Single User**: The app monitors agents for a single authenticated user (not multi-tenant)
6. **Agent Architecture Stability**: The file-based IPC model (`.claude-sessions/{session_id}.signal`) remains stable

### Constraints

1. **Electron/Tauri Framework Limits**: Menu bar apps have constrained UI real estate; design must prioritize information density
2. **Background Process Overhead**: Must maintain minimal resource usage when idle (< 1% CPU, < 100MB RAM)
3. **Native OS Integration**: Different platforms have different system tray APIs and behaviors
4. **Security Model**: Cannot store sensitive tokens in plain text; must use OS keychain/credential store
5. **Startup Time**: Menu bar apps should be ready within 2 seconds of launch
6. **Code Sharing Strategy**: Must define clear boundaries for shared packages vs platform-specific code
7. **Backwards Compatibility**: Changes to shared core must not break existing VSCode extension

---

## 6. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Electron bundle size too large** | High - 100MB+ download, slow launch | Medium | Consider Tauri (Rust-based) for smaller footprint; lazy-load non-critical features |
| **Shared code extraction breaks VSCode extension** | High - regression in primary product | Medium | Comprehensive test suite; feature flags; parallel testing of both apps during development |
| **File-based IPC unreliable across apps** | Medium - missed status updates | Low | Add fallback polling mechanism; validate file watcher behavior on all platforms |
| **WebSocket connection instability** | Medium - stale data displayed | Medium | Implement reconnection logic with exponential backoff; show connection status indicator |
| **macOS security restrictions** | High - app may be blocked/limited | Medium | Proper code signing and notarization; request minimal permissions |
| **Cross-platform complexity delays release** | Medium - extended timeline | High (for Windows/Linux) | Release macOS first; design abstraction layer from start |
| **User confusion between two apps** | Low - unclear which to use when | Medium | Clear documentation; complementary positioning; consistent branding |
| **Memory leaks from long-running process** | Medium - degraded performance over time | Medium | Memory profiling; periodic restart mechanism; leak detection in CI |

---

## 7. Dependencies

### Internal Dependencies

1. **Shared Core Packages** (to be extracted)
   - `@claude-projects/core` - Business logic, state management
   - `@claude-projects/github-api` - GitHub GraphQL client
   - `@claude-projects/agent-monitor` - Agent lifecycle, heartbeat, session management
   - `@claude-projects/cost-tracker` - Budget and cost calculations
   - `@claude-projects/phase-logic` - Phase grouping and status calculations

2. **State Tracking API** (`packages/api/`)
   - Must be running for real-time agent state sync
   - Required for WebSocket notifications

3. **Existing Infrastructure**
   - `.claude-sessions/` directory structure
   - Signal file format (`{session_id}.signal`)
   - Cost log format (`cost-log.json`)

### External Dependencies

1. **Framework**
   - Electron (preferred for VSCode ecosystem familiarity) OR Tauri (for smaller bundle)

2. **Runtime**
   - Node.js 18+ (if Electron)
   - Rust toolchain (if Tauri)

3. **OS APIs**
   - macOS: NSStatusItem, NSMenu
   - Windows: System Tray API (future)
   - Linux: AppIndicator/StatusNotifierItem (future)

4. **GitHub API**
   - GraphQL API for project data
   - OAuth tokens for authentication

---

## 8. Open Questions

1. **Electron vs Tauri**: Which framework provides the best balance of development speed, bundle size, and performance?
   - Electron: Familiar tech stack (TypeScript/Node), larger bundle (~100MB)
   - Tauri: Smaller bundle (~10MB), Rust backend, steeper learning curve

2. **Code Extraction Strategy**: How do we extract shared packages without disrupting active VSCode extension development?
   - Option A: Extract into monorepo packages, update imports
   - Option B: Create adapter layer, gradual migration

3. **Authentication Flow**: How does the menu bar app authenticate with GitHub?
   - Reuse tokens from VSCode extension storage?
   - Independent OAuth flow in menu bar app?
   - Shared credential store (OS keychain)?

4. **Workspace Discovery**: How does the app know which workspaces to monitor?
   - Manual configuration in settings?
   - Scan for `.claude-sessions/` directories?
   - Sync with VSCode workspace settings?

5. **Update Mechanism**: How will the menu bar app receive updates?
   - Auto-update via Electron/Tauri mechanisms?
   - Manual download from GitHub Releases?
   - App Store distribution (macOS)?

6. **Agent Spawning**: Should the menu bar app be able to start new agent sessions?
   - MVP excludes this, but users may expect it
   - Could delegate to CLI commands

7. **Multi-Workspace Support**: How to handle users with multiple workspaces/projects?
   - Unified view across all workspaces?
   - Workspace selector/tabs?

---

## 9. Non-Goals

1. **Replace VSCode Extension**: The menu bar app is complementary, not a replacement; VSCode extension remains the primary interface for active development
2. **Full IDE Functionality**: No code editing, syntax highlighting, or integrated terminal
3. **Agent Execution Engine**: The menu bar app monitors and controls agents but does not execute Claude sessions itself
4. **Offline Operation**: The app requires network connectivity for GitHub API and State Tracking API
5. **Enterprise Features**: No SSO, team management, or audit logging (beyond local emergency action logs)
6. **Historical Analytics**: No time-series charts, trend analysis, or data export (future enhancement)
7. **Push Notifications**: No OS-level notifications (though alerts will appear in-app); future enhancement
8. **Custom Scripting**: No plugin system or user-defined automation

---

## 10. Notes & References

### Related Documents

- **Existing Codebase**: `/Users/stoked/work/claude-projects/apps/code-ext/`
- **Problem Description**: `/Users/stoked/work/claude-projects/projects/build-desktop-menu-bar-agent-monitor/problem-description-full.md`
- **CLAUDE.md Architecture Guide**: `/Users/stoked/work/claude-projects/CLAUDE.md`

### Key Source Files to Extract/Share

| Current Location | Proposed Package | Description |
|------------------|------------------|-------------|
| `src/agent-dashboard-provider.ts` | `@claude-projects/agent-monitor` | Agent status UI data provider |
| `src/agent-session-manager.ts` | `@claude-projects/agent-monitor` | Session state management |
| `src/agent-heartbeat.ts` | `@claude-projects/agent-monitor` | Health monitoring |
| `src/agent-lifecycle.ts` | `@claude-projects/agent-monitor` | Start/stop/pause operations |
| `src/claude-monitor.ts` | `@claude-projects/agent-monitor` | File-based IPC and signal handling |
| `src/cost-tracker.ts` | `@claude-projects/cost-tracker` | Budget and cost calculations |
| `src/emergency-controls.ts` | `@claude-projects/agent-monitor` | Emergency stop and recovery |
| `src/github-api.ts` | `@claude-projects/github-api` | GraphQL client |
| `src/phase-logic.ts` | `@claude-projects/core` | Phase grouping algorithms |
| `src/cache-manager.ts` | `@claude-projects/core` | Caching layer |
| `src/diff-calculator.ts` | `@claude-projects/core` | Change detection |

### Technology Recommendations

**Recommended Stack (subject to Open Questions resolution):**
- **Framework**: Tauri (Rust + Web frontend) for minimal footprint, with Electron as fallback
- **Frontend**: React or Vue with TypeScript (consistent with potential future VSCode webview modernization)
- **State Management**: Zustand or Jotai (lightweight, TypeScript-friendly)
- **Build System**: Turborepo (already likely in use for monorepo)
- **Packaging**: `@tauri-apps/cli` or `electron-builder`

### Design Principles

1. **Glanceable**: Users should understand system status within 2 seconds of opening the panel
2. **Non-Intrusive**: Minimal CPU/memory when idle; no unsolicited notifications (initially)
3. **Consistent**: Same terminology, status colors, and workflows as VSCode extension
4. **Accessible**: Keyboard navigation support; WCAG 2.1 AA compliance for contrast
5. **Resilient**: Graceful degradation when backend services are unavailable

### Competitive Analysis

| Product | Strengths | Weaknesses |
|---------|-----------|------------|
| **GitHub Desktop** | Native feel, tight GitHub integration | No agent monitoring, not a menu bar app |
| **Raycast** | Fast, extensible, menu bar presence | Requires custom extension development |
| **Docker Desktop** | Container monitoring, system tray | Different domain, heavy resource usage |

The menu bar agent monitor occupies a unique niche: lightweight, always-available AI agent orchestration controls.

---

*Document Version: 1.0*
*Last Updated: 2026-01-28*
*Author: Claude (generated from problem description and codebase analysis)*
