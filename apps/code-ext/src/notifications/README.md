# WebSocket Notification Client

This directory contains the WebSocket client implementation for real-time notifications from the MCP notification server.

## Overview

The WebSocket client provides:
- Automatic connection on extension activation
- Authentication with API key from extension settings
- Subscription to active project numbers
- Event batching to prevent excessive UI updates (500ms window)
- Automatic reconnection with exponential backoff (1s, 2s, 4s, 8s, 16s, max 30s)
- Graceful cleanup on extension deactivation

## Configuration

The following settings are available in VSCode settings (File > Preferences > Settings):

### `claudeProjects.notifications.websocketUrl`
- **Type**: string
- **Default**: `ws://localhost:8080/notifications`
- **Description**: WebSocket URL for the MCP notification server

### `claudeProjects.notifications.enabled`
- **Type**: boolean
- **Default**: `true`
- **Description**: Enable/disable real-time notifications

### `claudeProjects.mcp.apiKey`
- **Type**: string
- **Default**: `""`
- **Description**: API key for MCP server authentication (used for both HTTP API and WebSocket)
- **Note**: Not required for localhost connections (`ws://localhost` or `ws://127.0.0.1`). Only needed for remote servers.

## Event Types

The client handles the following event types:

1. **`issue.created`** - New issue created in a subscribed project
2. **`issue.updated`** - Issue updated (status, title, body, etc.)
3. **`issue.deleted`** - Issue deleted from a project
4. **`project.updated`** - Project metadata updated (title, description, etc.)
5. **`phase.updated`** - Phase structure or status updated

## Usage

The WebSocket client is automatically initialized and managed by the extension. No manual setup is required.

### Connection Lifecycle

1. **Extension activation**: Client is created and event handlers are registered
2. **Projects loaded**: Client connects to WebSocket server and subscribes to active projects
3. **Events received**: Batched and dispatched to handlers, UI is updated
4. **Extension deactivation**: Client disconnects gracefully

### Debugging

To debug WebSocket connections:

1. Open the Output panel: View > Output
2. Select "Claude Projects - Notifications" from the dropdown
3. All WebSocket events are logged with `[WebSocket]` prefix

## Architecture

```
extension.ts
  ├─> Creates WebSocketNotificationClient
  └─> Passes to ProjectsViewProvider

ProjectsViewProvider
  ├─> Registers event handlers (setupWebSocketHandlers)
  ├─> Connects when projects are loaded (connectWebSocket)
  └─> Handles events (handleWebSocketUpdate)

WebSocketNotificationClient
  ├─> Manages WebSocket connection lifecycle
  ├─> Handles authentication and subscriptions
  ├─> Batches events to prevent excessive updates
  └─> Implements exponential backoff for reconnection
```

## Testing

To test the WebSocket client:

1. Start the MCP notification server (work item 4.2)
2. Configure API key in VSCode settings
3. Open a workspace with a GitHub repository
4. Open the Claude Projects panel
5. Create/update/delete an issue via Claude Code
6. Verify the extension UI updates automatically within 2 seconds

## Error Handling

### Invalid WebSocket URL
If the WebSocket URL is invalid, the extension will:
1. Log error to Output panel
2. Show error message with "Open Settings" button
3. Not retry connection until settings are updated

### No API Key (Remote Connections Only)
If no API key is configured for a **remote** connection:
1. Log warning to Output panel
2. Show warning message
3. Not attempt connection

**Note**: API key is not required for localhost connections. Local development works without authentication.

### Connection Dropped
If the connection drops:
1. Attempt reconnection with exponential backoff
2. Show "Reconnecting..." message to user
3. Resubscribe to projects when reconnected
4. Max backoff delay: 30 seconds
