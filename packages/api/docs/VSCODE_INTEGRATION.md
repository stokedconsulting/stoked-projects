# VSCode Extension Integration Guide

This guide explains how to integrate the State Tracking API into your VSCode extension using the TypeScript client library.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Session Lifecycle](#session-lifecycle)
- [Task Tracking](#task-tracking)
- [Machine Management](#machine-management)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)
- [Complete Example](#complete-example)

## Installation

### Option 1: Direct File Import

Copy the client library files to your VSCode extension:

```bash
cp -r api/src/client your-extension/src/state-tracking-client
```

### Option 2: Build as Standalone Package

```bash
cd api
npm run build:client
npm pack
# Then install in your extension
cd your-extension
npm install ../api/state-tracking-client-0.1.0.tgz
```

## Quick Start

```typescript
import { StateTrackingApiClient, SessionStatus } from './state-tracking-client';

// Initialize the client
const apiClient = new StateTrackingApiClient({
  baseUrl: 'https://your-api-domain.com', // or http://localhost:3000 for development
  apiKey: process.env.STATE_TRACKING_API_KEY!,
  timeout: 10000, // Optional: request timeout in ms (default: 10000)
});

// Create a session when extension activates
const session = await apiClient.createSession({
  project_id: '123',
  machine_id: 'macbook-pro-m1',
  metadata: {
    vscode_version: vscode.version,
    extension_version: '0.1.0',
  },
});

console.log('Session created:', session.session_id);
```

## Configuration

### Environment Variables

Store your API configuration in environment variables:

```bash
# .env file
STATE_TRACKING_API_URL=https://your-api-domain.com
STATE_TRACKING_API_KEY=your-secret-api-key
```

### VSCode Extension Settings

Allow users to configure the API endpoint:

```typescript
// package.json
{
  "contributes": {
    "configuration": {
      "title": "State Tracking",
      "properties": {
        "stateTracking.apiUrl": {
          "type": "string",
          "default": "https://your-api-domain.com",
          "description": "State Tracking API URL"
        },
        "stateTracking.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable state tracking"
        }
      }
    }
  }
}
```

```typescript
// Get configuration in your extension
const config = vscode.workspace.getConfiguration('stateTracking');
const apiUrl = config.get<string>('apiUrl');
const enabled = config.get<boolean>('enabled');
```

## Session Lifecycle

### 1. Create Session on Extension Activation

```typescript
import * as vscode from 'vscode';
import { StateTrackingApiClient } from './state-tracking-client';

let apiClient: StateTrackingApiClient;
let currentSessionId: string | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

export async function activate(context: vscode.ExtensionContext) {
  // Initialize API client
  apiClient = new StateTrackingApiClient({
    baseUrl: process.env.STATE_TRACKING_API_URL!,
    apiKey: process.env.STATE_TRACKING_API_KEY!,
  });

  // Get machine ID (unique identifier for this machine)
  const machineId = await getMachineId(context);

  try {
    // Create session
    const session = await apiClient.createSession({
      project_id: getCurrentProjectId(),
      machine_id: machineId,
      metadata: {
        vscode_version: vscode.version,
        workspace: vscode.workspace.name,
      },
    });

    currentSessionId = session.session_id;
    console.log('Session started:', currentSessionId);

    // Start heartbeat
    startHeartbeat();

    // Store session ID for cleanup
    context.globalState.update('currentSessionId', currentSessionId);
  } catch (error) {
    console.error('Failed to create session:', error);
  }
}
```

### 2. Maintain Heartbeat

Send heartbeat every 60 seconds to keep session alive:

```typescript
function startHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  heartbeatInterval = setInterval(async () => {
    if (!currentSessionId) return;

    try {
      await apiClient.updateSessionHeartbeat(currentSessionId);
      console.log('Heartbeat sent');
    } catch (error) {
      console.error('Heartbeat failed:', error);
      // Optionally: attempt to recover session
      await attemptSessionRecovery();
    }
  }, 60000); // Every 60 seconds
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}
```

### 3. Clean Up on Deactivation

```typescript
export async function deactivate() {
  // Stop heartbeat
  stopHeartbeat();

  // Mark session as completed
  if (currentSessionId) {
    try {
      await apiClient.updateSession(currentSessionId, {
        status: SessionStatus.COMPLETED,
      });
      console.log('Session completed:', currentSessionId);
    } catch (error) {
      console.error('Failed to complete session:', error);
    }
  }
}
```

## Task Tracking

### Create and Track Tasks

```typescript
async function executeProjectTask(taskName: string, githubIssueId?: string) {
  if (!currentSessionId) {
    throw new Error('No active session');
  }

  let task;

  try {
    // Create task
    task = await apiClient.createTask({
      session_id: currentSessionId,
      project_id: getCurrentProjectId(),
      task_name: taskName,
      github_issue_id: githubIssueId,
    });

    console.log('Task created:', task.task_id);

    // Start task
    await apiClient.startTask(task.task_id);
    console.log('Task started:', taskName);

    // Execute your task logic here
    await performTaskWork(taskName);

    // Complete task
    await apiClient.completeTask(task.task_id);
    console.log('Task completed:', taskName);

    return task;
  } catch (error) {
    // Mark task as failed
    if (task) {
      await apiClient.failTask(task.task_id, {
        error_message: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}
```

### Track Task Progress

```typescript
async function showTaskProgress() {
  if (!currentSessionId) return;

  try {
    const progress = await apiClient.getSessionTaskProgress(currentSessionId);

    vscode.window.showInformationMessage(
      `Tasks: ${progress.completed}/${progress.total_tasks} completed ` +
      `(${progress.in_progress} in progress, ${progress.failed} failed)`
    );
  } catch (error) {
    console.error('Failed to get task progress:', error);
  }
}
```

## Machine Management

### Register Machine on First Run

```typescript
async function ensureMachineRegistered(context: vscode.ExtensionContext): Promise<string> {
  const machineId = await getMachineId(context);

  try {
    // Check if machine exists
    await apiClient.getMachine(machineId);
    console.log('Machine already registered:', machineId);
  } catch (error) {
    // Machine doesn't exist, register it
    console.log('Registering new machine:', machineId);

    const os = require('os');
    await apiClient.createMachine({
      machine_id: machineId,
      hostname: os.hostname(),
      docker_slots: [1, 2, 3, 4], // Configure based on your setup
      metadata: {
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
        total_memory: os.totalmem(),
      },
    });
  }

  return machineId;
}

async function getMachineId(context: vscode.ExtensionContext): Promise<string> {
  // Try to get existing machine ID
  let machineId = context.globalState.get<string>('machineId');

  if (!machineId) {
    // Generate new machine ID
    const os = require('os');
    const crypto = require('crypto');

    // Use hostname and network interfaces to generate stable ID
    const hostname = os.hostname();
    const networkInterfaces = os.networkInterfaces();
    const macAddresses = Object.values(networkInterfaces)
      .flat()
      .filter((iface: any) => iface?.mac && iface.mac !== '00:00:00:00:00:00')
      .map((iface: any) => iface.mac);

    const uniqueString = `${hostname}-${macAddresses.join('-')}`;
    machineId = crypto.createHash('sha256').update(uniqueString).digest('hex').substring(0, 16);

    // Store for future use
    await context.globalState.update('machineId', machineId);
  }

  return machineId;
}
```

### Send Machine Heartbeats

```typescript
function startMachineHeartbeat(machineId: string) {
  setInterval(async () => {
    try {
      await apiClient.updateMachineHeartbeat(machineId);
      console.log('Machine heartbeat sent');
    } catch (error) {
      console.error('Machine heartbeat failed:', error);
    }
  }, 60000); // Every 60 seconds
}
```

## Error Handling

### Handling API Errors

```typescript
async function safeApiCall<T>(
  operation: () => Promise<T>,
  fallback?: T
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error) {
      // Check for specific error types
      if (error.message.includes('404')) {
        console.log('Resource not found');
      } else if (error.message.includes('400')) {
        console.error('Invalid request:', error.message);
      } else if (error.message.includes('429')) {
        console.error('Rate limit exceeded');
      } else if (error.message.includes('timeout')) {
        console.error('Request timeout');
      } else {
        console.error('API error:', error.message);
      }
    }
    return fallback;
  }
}

// Usage
const session = await safeApiCall(() =>
  apiClient.createSession({
    project_id: '123',
    machine_id: machineId,
  })
);
```

### Session Recovery

```typescript
async function attemptSessionRecovery() {
  if (!currentSessionId) return;

  try {
    // Check session health
    const health = await apiClient.getSessionHealth(currentSessionId);

    if (health.is_stale) {
      console.log('Session is stale, attempting recovery...');

      // Mark as stalled first
      await apiClient.markSessionStalled(currentSessionId, {
        reason: 'Heartbeat failed, attempting recovery',
      });

      // Attempt recovery
      const recovered = await apiClient.recoverSession(currentSessionId);
      console.log('Session recovered:', recovered.session_id);

      // Restart heartbeat
      startHeartbeat();
    }
  } catch (error) {
    console.error('Session recovery failed:', error);

    // Create new session if recovery fails
    await createNewSession();
  }
}

async function createNewSession() {
  stopHeartbeat();

  try {
    const session = await apiClient.createSession({
      project_id: getCurrentProjectId(),
      machine_id: await getMachineId(context),
      metadata: {
        recovered_from: currentSessionId,
      },
    });

    currentSessionId = session.session_id;
    startHeartbeat();
    console.log('New session created:', currentSessionId);
  } catch (error) {
    console.error('Failed to create new session:', error);
  }
}
```

## Best Practices

### 1. Graceful Degradation

Always ensure your extension works even if the API is unavailable:

```typescript
const trackingEnabled = process.env.STATE_TRACKING_API_KEY ? true : false;

async function trackSession(operation: () => Promise<void>) {
  if (!trackingEnabled) {
    console.log('State tracking disabled');
    return;
  }

  try {
    await operation();
  } catch (error) {
    console.warn('State tracking failed (non-fatal):', error);
    // Continue extension operation
  }
}
```

### 2. Batch Operations

Minimize API calls by batching task creation:

```typescript
async function createMultipleTasks(taskNames: string[]) {
  const tasks = await Promise.all(
    taskNames.map(name =>
      apiClient.createTask({
        session_id: currentSessionId!,
        project_id: getCurrentProjectId(),
        task_name: name,
      })
    )
  );

  console.log(`Created ${tasks.length} tasks`);
  return tasks;
}
```

### 3. Use Metadata for Context

Store useful information in metadata:

```typescript
await apiClient.createSession({
  project_id: getCurrentProjectId(),
  machine_id: machineId,
  metadata: {
    vscode_version: vscode.version,
    workspace_path: vscode.workspace.workspaceFolders?.[0].uri.fsPath,
    user: process.env.USER,
    started_at_local: new Date().toISOString(),
    git_branch: await getCurrentGitBranch(),
  },
});
```

### 4. Monitor Session Health

Periodically check session health:

```typescript
async function monitorSessionHealth() {
  if (!currentSessionId) return;

  const health = await apiClient.getSessionHealth(currentSessionId);

  if (health.is_stale) {
    vscode.window.showWarningMessage(
      `Session is stale (${health.seconds_since_heartbeat}s since last heartbeat)`
    );
  }

  // Show recommendations
  health.recommendations.forEach(rec => {
    console.log('Recommendation:', rec);
  });
}
```

## Complete Example

See [vscode-extension-example.ts](../examples/vscode-extension-example.ts) for a complete working example that demonstrates:

- Extension activation and deactivation
- Session lifecycle management
- Heartbeat maintenance
- Task tracking
- Error recovery
- Machine registration

## API Reference

For complete API documentation, see:

- [Session Health Endpoints](./SESSION_HEALTH_ENDPOINTS.md)
- [Recovery Workflow](./RECOVERY_WORKFLOW.md)
- [Error Handling](./ERROR_HANDLING.md)
- [API Documentation](./README.md)

## Troubleshooting

### Connection Issues

```typescript
// Test API connectivity
async function testApiConnection() {
  try {
    const health = await apiClient.checkHealth();
    console.log('API is healthy:', health);
    return true;
  } catch (error) {
    console.error('API connection failed:', error);
    return false;
  }
}
```

### Session Not Found

If you get 404 errors, the session may have been cleaned up:

```typescript
// Check if session still exists
try {
  await apiClient.getSession(currentSessionId!);
} catch (error) {
  if (error instanceof Error && error.message.includes('404')) {
    console.log('Session no longer exists, creating new one');
    await createNewSession();
  }
}
```

### Rate Limiting

The heartbeat endpoint has a higher rate limit (120 requests/minute), but other endpoints are limited to 60 requests/minute:

```typescript
// Implement exponential backoff
async function apiCallWithRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Error && error.message.includes('429')) {
        const delay = Math.pow(2, i) * 1000; // Exponential backoff
        console.log(`Rate limited, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}
```

## Support

For issues or questions:
- API Documentation: See docs in this repository
- Extension Integration: Refer to this guide
- API Endpoint Reference: Check the OpenAPI/Swagger documentation at `/api`
