# State Tracking API Client

TypeScript client library for the State Tracking API, designed for VSCode extension integration.

## Installation

### Option 1: Direct Import

Copy the client directory to your project:

```bash
cp -r api/src/client your-project/src/state-tracking-client
```

### Option 2: Build and Install as Package

```bash
# Build the client library
cd api
npm run build:client

# Package it
cd dist/client
npm pack

# Install in your project
cd your-project
npm install path/to/state-tracking-client-0.1.0.tgz
```

## Quick Start

```typescript
import { StateTrackingApiClient } from './state-tracking-client';

const client = new StateTrackingApiClient({
  baseUrl: 'https://your-api-domain.com',
  apiKey: 'your-api-key',
  timeout: 10000, // optional
});

// Create a session
const session = await client.createSession({
  project_id: '123',
  machine_id: 'my-machine',
  metadata: {
    version: '1.0.0',
  },
});

// Update heartbeat
await client.updateSessionHeartbeat(session.session_id);

// Create and track tasks
const task = await client.createTask({
  session_id: session.session_id,
  project_id: '123',
  task_name: 'Example Task',
});

await client.startTask(task.task_id);
await client.completeTask(task.task_id);
```

## API Reference

### Client Configuration

```typescript
interface ApiClientConfig {
  baseUrl: string;        // API base URL
  apiKey: string;         // API authentication key
  timeout?: number;       // Request timeout in ms (default: 10000)
}
```

### Session Methods

- `createSession(data: CreateSessionRequest): Promise<Session>`
- `getSession(sessionId: string): Promise<Session>`
- `listSessions(query?: SessionQueryParams): Promise<Session[]>`
- `updateSession(sessionId: string, data: UpdateSessionRequest): Promise<Session>`
- `deleteSession(sessionId: string): Promise<void>`
- `updateSessionHeartbeat(sessionId: string): Promise<HeartbeatResponse>`
- `getSessionHealth(sessionId: string, threshold?: number): Promise<SessionHealth>`
- `findStaleSessions(threshold?: number): Promise<StaleSession[]>`
- `findActiveSessions(projectId?: string, machineId?: string): Promise<ActiveSession[]>`
- `markSessionFailed(sessionId: string, data: MarkFailedRequest): Promise<Session>`
- `markSessionStalled(sessionId: string, data: MarkStalledRequest): Promise<Session>`
- `recoverSession(sessionId: string, data?: RecoverSessionRequest): Promise<Session>`
- `archiveSession(sessionId: string): Promise<Session>`

### Task Methods

- `createTask(data: CreateTaskRequest): Promise<Task>`
- `getTask(taskId: string): Promise<Task>`
- `listTasks(query?: TaskQueryParams): Promise<Task[]>`
- `updateTask(taskId: string, data: UpdateTaskRequest): Promise<Task>`
- `deleteTask(taskId: string): Promise<void>`
- `startTask(taskId: string): Promise<Task>`
- `completeTask(taskId: string): Promise<Task>`
- `failTask(taskId: string, data: FailTaskRequest): Promise<Task>`
- `getSessionTaskProgress(sessionId: string): Promise<TaskProgress>`

### Machine Methods

- `createMachine(data: CreateMachineRequest): Promise<Machine>`
- `getMachine(machineId: string): Promise<Machine>`
- `listMachines(query?: MachineQueryParams): Promise<Machine[]>`
- `updateMachine(machineId: string, data: UpdateMachineRequest): Promise<Machine>`
- `deleteMachine(machineId: string): Promise<void>`
- `updateMachineHeartbeat(machineId: string): Promise<MachineHeartbeatResponse>`
- `findAvailableMachines(): Promise<MachineAvailability[]>`
- `assignSessionToMachine(machineId: string, sessionId: string, dockerSlot?: number): Promise<Machine>`
- `releaseSessionFromMachine(machineId: string, sessionId: string): Promise<Machine>`

### Health Check

- `checkHealth(): Promise<{ status: string; timestamp: string }>`

## TypeScript Types

All request and response types are fully typed. Import them from the types module:

```typescript
import {
  Session,
  Task,
  Machine,
  SessionStatus,
  TaskStatus,
  MachineStatus,
  CreateSessionRequest,
  UpdateSessionRequest,
  // ... etc
} from './state-tracking-client';
```

## Error Handling

The client throws errors with descriptive messages:

```typescript
try {
  await client.createSession(data);
} catch (error) {
  if (error instanceof Error) {
    console.error('API Error:', error.message);
    // Error message format: "API Error (statusCode): message"
  }
}
```

## Documentation

For complete integration guide and examples, see:
- [VSCode Integration Guide](../../docs/VSCODE_INTEGRATION.md)
- [Complete Example](../../examples/vscode-extension-example.ts)

## License

UNLICENSED
