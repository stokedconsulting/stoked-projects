# Orchestration Synchronization Implementation Complete

## Overview

Implemented real-time synchronization of orchestration state (running/desired LLM counts) across all VSCode extension instances using WebSocket communication. This ensures that when any IDE instance updates their workspace desired count, all other instances (on the same or different machines) immediately see the updated global state.

## Architecture

### API Side (Already Existed)

The `packages/api` already had the infrastructure in place:

1. **Orchestration Service** (`orchestration.service.ts`):
   - Tracks workspace-level `running` and `desired` counts
   - Calculates global totals by aggregating all workspace values
   - MongoDB schema with workspace_id as unique identifier

2. **Orchestration Gateway** (`orchestration.gateway.ts`):
   - WebSocket server on `/orchestration` path
   - Broadcasts two types of events:
     - `orchestration.global` - sent to ALL connected clients
     - `orchestration.workspace` - sent to workspace-specific room

3. **Orchestration Controller** (`orchestration.controller.ts`):
   - HTTP endpoints for updating workspace desired/running counts
   - **Already broadcasts** global and workspace updates via WebSocket

### Extension Side (Newly Implemented)

Created a new WebSocket client specifically for orchestration synchronization:

#### 1. OrchestrationWebSocketClient (`orchestration-websocket-client.ts`)

**Purpose**: Dedicated WebSocket client for receiving orchestration updates

**Features**:
- Connects to `/orchestration` endpoint using Socket.io client
- Subscribes to workspace-specific updates
- Automatic reconnection with exponential backoff
- Separate from project notification WebSocket (different endpoint, different purpose)

**Events Handled**:
- `orchestration.global` - Updates global running/desired counts
- `orchestration.workspace` - Updates workspace-specific counts
- `subscribed` - Confirmation of successful subscription

**Configuration**:
```typescript
{
  url: string,           // Base API URL (e.g., 'https://claude-projects.truapi.com')
  apiKey?: string,       // GitHub token (optional for localhost)
  workspaceId: string    // Absolute path to workspace directory
}
```

#### 2. Integration in ProjectsViewProvider

**Initialization** (line 355-475):
- Fetches initial orchestration state via HTTP API
- Initializes WebSocket connection after initial fetch
- Registers event handlers:
  - Global updates → Update global running/desired in UI
  - Workspace updates → Update workspace running/desired in UI

**Cleanup** (line 2704-2716):
- Added `dispose()` method to disconnect WebSocket
- Called from extension.ts on deactivation

#### 3. Extension Lifecycle (extension.ts)

Updated to properly clean up orchestration WebSocket:
```typescript
context.subscriptions.push({
  dispose: () => {
    wsClient.disconnect();
    provider.dispose(); // Disconnects orchestration WebSocket
  },
});
```

## Data Flow

### 1. Workspace Desired Update (User Action)

```
User in IDE A → Updates desired to 1
  ↓
APIClient.updateWorkspaceDesired()
  ↓
HTTP PUT /api/orchestration/workspace/{id}/desired
  ↓
OrchestrationController.updateWorkspaceDesired()
  ↓
OrchestrationService (updates MongoDB + calculates global totals)
  ↓
OrchestrationGateway broadcasts:
  - orchestration.global → ALL connected clients
  - orchestration.workspace → workspace-specific room
  ↓
All IDE instances receive global update via WebSocket
  ↓
ProjectsViewProvider.setOrchestrationData()
  ↓
UI updates in all instances
```

### 2. Cross-Instance Synchronization Example

**Scenario**: 3 IDEs on machine A, 2 IDEs on machine B

1. **Initial State**:
   - All workspaces: desired = 0
   - Global: desired = 0

2. **IDE 1 (Machine B) sets desired = 1**:
   - Workspace B/IDE1: desired = 1
   - Global: desired = 1 (sum of all workspaces)
   - All 5 IDEs receive global update and show desired = 1

3. **IDE 2 (Machine A) sets desired = 1**:
   - Workspace A/IDE2: desired = 1
   - Global: desired = 2 (1 from B/IDE1 + 1 from A/IDE2)
   - All 5 IDEs receive global update and show desired = 2

4. **IDE 3 (Machine A) sets desired = 2**:
   - Workspace A/IDE3: desired = 2
   - Global: desired = 4 (1 from B/IDE1 + 1 from A/IDE2 + 2 from A/IDE3)
   - All 5 IDEs receive global update and show desired = 4

## Key Implementation Details

### WebSocket vs HTTP

**Why separate WebSocket client?**
- Project notifications use `/notifications` endpoint (issue/project events)
- Orchestration uses `/orchestration` endpoint (running/desired state)
- Different event schemas and subscription models
- Cleaner separation of concerns

### Authentication

**Localhost**: No authentication required
**Remote API**: Uses GitHub token from VSCode authentication

```typescript
const isLocalhost = apiBaseUrl.includes('localhost');
if (!isLocalhost) {
  const session = await vscode.authentication.getSession(...);
  apiKey = session?.accessToken;
}
```

### State Management

**Persistence**: Orchestration data stored in VSCode's `workspaceState`
**Updates**: Trigger both state update and webview notification
```typescript
this._context.workspaceState.update('orchestrationData', this._orchestrationData);
this._view?.webview.postMessage({ type: 'orchestrationData', data });
```

## Files Modified

### New Files
1. `apps/code-ext/src/orchestration-websocket-client.ts` - WebSocket client for orchestration

### Modified Files
1. `apps/code-ext/src/projects-view-provider.ts`:
   - Added `_orchestrationWsClient` property
   - Added `initializeOrchestrationWebSocket()` method
   - Added event handlers for global/workspace updates
   - Added `dispose()` method for cleanup

2. `apps/code-ext/src/extension.ts`:
   - Updated cleanup handler to call `provider.dispose()`

3. `apps/code-ext/package.json`:
   - Added `socket.io-client` dependency

## Testing

### Manual Testing Steps

1. **Start two VSCode instances** with the same API endpoint
2. **In Instance 1**: Update workspace desired to 1
   - Verify global desired shows 1 in both instances
3. **In Instance 2**: Update workspace desired to 2
   - Verify global desired shows 3 in both instances (1 + 2)
4. **Close Instance 1** (or set desired to 0)
   - Verify global desired updates to 2 in Instance 2

### Debug Logging

Check VSCode Output panel → "Claude Projects":
```
[OrchestrationSync] WebSocket connected and handlers registered
[OrchestrationSync] Global update received: running=0, desired=3
[OrchestrationSync] Workspace update received: running=0, desired=1
```

## Benefits

1. **Real-time Sync**: All IDE instances see the same global state instantly
2. **Multi-machine Support**: Works across different machines connected to same API
3. **Automatic Reconnection**: Handles network interruptions gracefully
4. **Clean Architecture**: Separate WebSocket client for orchestration vs projects
5. **State Persistence**: Orchestration state survives VSCode restarts

## Future Enhancements

1. **Running Count Updates**: Currently only desired is user-editable. Running count could be updated by:
   - File-based monitoring of active Claude sessions
   - Process monitoring via system APIs
   - Integration with Claude Code CLI

2. **Conflict Resolution**: Currently last-write-wins. Could add:
   - Optimistic locking
   - Conflict notification to user

3. **Historical Data**: Track orchestration state changes over time for analytics

## Configuration

No additional configuration required. Uses existing settings:
- `claudeProjects.apiBaseUrl` - API endpoint
- `claudeProjects.mcp.apiKey` - API authentication (optional for localhost)

## Dependencies Added

- `socket.io-client@^4.8.1` - WebSocket client library for real-time communication

---

**Status**: ✅ Implementation complete and tested
**Build**: ✅ Compiles successfully
**Date**: 2026-01-26
