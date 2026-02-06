# Orchestration API - Implementation Complete ✅

## Overview

The orchestration control tracks both workspace-specific and global LLM usage across all workspaces. The API has been fully implemented with MongoDB storage and WebSocket real-time notifications.

## Data Model Changes

### Workspace Orchestration

Each workspace needs to track:
- `running`: Number of currently running LLMs in this workspace
- `desired`: Number of desired LLMs for this workspace (user-configurable)

**Workspace Identifier**: Use the workspace's absolute file path as the unique identifier (e.g., `/Users/username/projects/my-repo`)

### Global Orchestration

Track aggregated values across all workspaces:
- `running`: Total number of LLMs running across all workspaces
- `desired`: Total desired LLMs across all workspaces (sum of all workspace desired values)

## API Endpoints Needed

### 1. Update Workspace Orchestration

```
PUT /api/orchestration/workspace/:workspaceId
```

**Request Body:**
```json
{
  "desired": 3
}
```

**Response:**
```json
{
  "workspace": {
    "id": "/Users/username/projects/my-repo",
    "running": 2,
    "desired": 3
  },
  "global": {
    "running": 5,
    "desired": 8
  }
}
```

### 2. Get Workspace Orchestration

```
GET /api/orchestration/workspace/:workspaceId
```

**Response:**
```json
{
  "workspace": {
    "id": "/Users/username/projects/my-repo",
    "running": 2,
    "desired": 3
  },
  "global": {
    "running": 5,
    "desired": 8
  }
}
```

### 3. Update Workspace Running Count (Internal)

This endpoint should be called by the orchestration system when LLMs start/stop:

```
PUT /api/orchestration/workspace/:workspaceId/running
```

**Request Body:**
```json
{
  "running": 2
}
```

## WebSocket Events

### Event: `orchestration.global`

Broadcast to all connected clients when global orchestration values change.

**Event Data:**
```json
{
  "running": 5,
  "desired": 8
}
```

**Triggers:**
- When any workspace's running count changes
- When any workspace's desired count changes

### Event: `orchestration.workspace`

Broadcast to specific workspace clients when their workspace orchestration changes.

**Event Data:**
```json
{
  "workspaceId": "/Users/username/projects/my-repo",
  "running": 2,
  "desired": 3
}
```

## Implementation Notes

1. **Workspace Tracking**: The API should maintain a map of `workspaceId -> { running, desired }`

2. **Global Calculation**: Global values should be calculated by summing all workspace values:
   ```
   global.running = sum(all_workspaces.running)
   global.desired = sum(all_workspaces.desired)
   ```

3. **WebSocket Broadcasting**: When any workspace value changes:
   - Calculate new global values
   - Broadcast `orchestration.global` to all connected clients
   - Broadcast `orchestration.workspace` to clients subscribed to that workspace

4. **Persistence**: Workspace orchestration data should be persisted so that:
   - Desired values survive API restarts
   - Running values can be restored or reset to 0 on API restart

5. **Cleanup**: Implement a cleanup mechanism to remove stale workspace entries (e.g., workspaces that haven't connected in 24 hours)

## Extension Integration

The VSCode extension will:
1. Send workspace updates when users change the "Workspace Desired" value
2. Listen for `orchestration.global` WebSocket events to update the global display
3. Display both workspace and global values in the UI

### UI Layout

```
┌─────────────────────────────────────┐
│ WORKSPACE                           │
│ Running: 2    Desired: [3]          │
├─────────────────────────────────────┤
│ GLOBAL                              │
│ Running: 5    Desired: 8            │
└─────────────────────────────────────┘
```

- Workspace "Desired" is an input field (user can edit)
- All other values are read-only displays
- Global values update in real-time via WebSocket

## Getting Started

### Starting the API

```bash
cd packages/api

# Install dependencies
npm install

# Development mode (with auto-reload)
npm run start:dev

# Production mode
npm run start:prod
```

The API will start on `http://localhost:3000` (or configured port).

The WebSocket server will be available at `ws://localhost:3000/orchestration`.

### WebSocket Connection from VSCode Extension

The extension already has WebSocket client code. To connect to orchestration updates:

```typescript
// In projects-view-provider.ts
// Connect to WebSocket (if not already connected)
await this._wsClient.connect({
  url: 'ws://localhost:3000/orchestration',
  apiKey: apiKey, // from settings
});

// Subscribe to workspace updates
// This is already handled by the extension
```

## Testing Checklist

- [ ] Start the API: `npm run start:dev`
- [ ] Create workspace A, set desired to 3
- [ ] Create workspace B, set desired to 2
- [ ] Verify global desired shows 5
- [ ] Start an LLM in workspace A
- [ ] Verify workspace A running shows 1
- [ ] Verify global running shows 1
- [ ] Start an LLM in workspace B
- [ ] Verify global running shows 2 in both workspace A and B clients
- [ ] Update workspace A desired to 5
- [ ] Verify global desired updates to 7 in all clients

## MongoDB Configuration

Set the following environment variable:

```bash
MONGODB_URI=mongodb://localhost:27017/claude-projects
# or
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/claude-projects
```

The orchestration data will be stored in the `orchestration` collection with a TTL index that automatically removes workspace entries inactive for 7 days.
