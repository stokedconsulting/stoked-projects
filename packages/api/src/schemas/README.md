# MongoDB Schemas for State Tracking API

This directory contains the Mongoose schemas for tracking Claude AI orchestration sessions, tasks, and machine assignments.

## Schemas Overview

### 1. Session Schema (`session.schema.ts`)

Tracks active Claude AI orchestration sessions with machine assignments.

**Collection Name:** `sessions`

**Fields:**
- `session_id` (string, required, unique, indexed) - Unique session identifier (UUID)
- `project_id` (string, required, indexed) - GitHub Project ID this session is working on
- `machine_id` (string, required, indexed) - Machine identifier running this session
- `docker_slot` (number, optional) - Docker slot number (if using containerized execution)
- `status` (enum, required, indexed) - Current session state
  - Values: `active`, `paused`, `completed`, `failed`, `stalled`
- `last_heartbeat` (Date, required, indexed) - Last successful heartbeat timestamp
- `current_task_id` (string, optional) - Reference to current task being executed
- `started_at` (Date, required) - Session start time
- `completed_at` (Date, optional) - Session completion or failure time
- `metadata` (object) - Additional session context (VSCode version, extension version, etc.)
- `created_at` (Date, auto) - Document creation timestamp
- `updated_at` (Date, auto) - Document last update timestamp

**Indexes:**
- Single field indexes: `session_id` (unique), `project_id`, `machine_id`, `status`, `last_heartbeat`
- Compound indexes:
  - `{ project_id: 1, status: 1 }` - Query sessions by project and status
  - `{ machine_id: 1, status: 1 }` - Query sessions by machine and status
- TTL index: `{ completed_at: 1 }` with 30-day expiration
  - Only applies to completed/failed sessions with `completed_at` set
  - Partial filter: `{ completed_at: { $exists: true }, status: { $in: ['completed', 'failed'] } }`

### 2. Task Schema (`task.schema.ts`)

Tracks individual tasks within sessions.

**Collection Name:** `tasks`

**Fields:**
- `task_id` (string, required, unique, indexed) - Unique task identifier (UUID)
- `session_id` (string, required, indexed) - Parent session reference
- `project_id` (string, required, indexed) - GitHub Project ID
- `github_issue_id` (string, optional) - Corresponding GitHub issue ID
- `task_name` (string, required) - Human-readable task description
- `status` (enum, required, indexed) - Task state
  - Values: `pending`, `in_progress`, `completed`, `failed`, `blocked`
- `started_at` (Date, optional) - Task execution start time
- `completed_at` (Date, optional) - Task completion time
- `error_message` (string, optional) - Failure reason if status is failed
- `created_at` (Date, auto) - Document creation timestamp
- `updated_at` (Date, auto) - Document last update timestamp

**Indexes:**
- Single field indexes: `task_id` (unique), `session_id`, `project_id`, `status`
- Compound indexes:
  - `{ session_id: 1, status: 1 }` - Query tasks by session and status
  - `{ project_id: 1, status: 1 }` - Query tasks by project and status
- TTL index: `{ completed_at: 1 }` with 30-day expiration
  - Only applies to completed/failed tasks with `completed_at` set
  - Partial filter: `{ completed_at: { $exists: true }, status: { $in: ['completed', 'failed'] } }`

### 3. Machine Schema (`machine.schema.ts`)

Tracks available machines and their Docker slot allocations.

**Collection Name:** `machines`

**Fields:**
- `machine_id` (string, required, unique, indexed) - Unique machine identifier
- `hostname` (string, required) - Machine hostname
- `docker_slots` (array of numbers, default: []) - List of available docker slot numbers
- `active_sessions` (array of strings, default: []) - List of active session IDs on this machine
- `status` (enum, required, indexed) - Machine availability status
  - Values: `online`, `offline`, `maintenance`
- `last_heartbeat` (Date, required, indexed) - Last machine heartbeat timestamp
- `metadata` (object) - Machine specifications and OS information
- `created_at` (Date, auto) - Document creation timestamp
- `updated_at` (Date, auto) - Document last update timestamp

**Indexes:**
- Single field indexes: `machine_id` (unique), `status`, `last_heartbeat`
- No TTL index - machines should persist indefinitely

## Enum Values

### SessionStatus
```typescript
enum SessionStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  STALLED = 'stalled',
}
```

### TaskStatus
```typescript
enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  BLOCKED = 'blocked',
}
```

### MachineStatus
```typescript
enum MachineStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  MAINTENANCE = 'maintenance',
}
```

## Automatic Cleanup (TTL Indexes)

Both Sessions and Tasks have TTL (Time-To-Live) indexes configured to automatically delete documents after 30 days of completion:

- **Sessions**: Automatically deleted 30 days after `completed_at` timestamp (only if status is 'completed' or 'failed')
- **Tasks**: Automatically deleted 30 days after `completed_at` timestamp (only if status is 'completed' or 'failed')
- **Machines**: No automatic cleanup - persist indefinitely

The partial filter expressions ensure that only completed/failed documents with a `completed_at` timestamp are eligible for deletion.

## Usage

Import schemas in your NestJS module:

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Session, SessionSchema } from './schemas/session.schema';
import { Task, TaskSchema } from './schemas/task.schema';
import { Machine, MachineSchema } from './schemas/machine.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Session.name, schema: SessionSchema },
      { name: Task.name, schema: TaskSchema },
      { name: Machine.name, schema: MachineSchema },
    ]),
  ],
})
export class AppModule {}
```

## Testing

Schema validation tests should verify:

1. **Field Validation**
   - Required fields are enforced
   - Optional fields work correctly
   - Enum values are validated
   - Unique constraints are enforced

2. **Timestamps**
   - `created_at` and `updated_at` are automatically managed
   - Timestamps use custom field names (not camelCase)

3. **Indexes**
   - All required indexes are created
   - Compound indexes exist for optimized queries
   - TTL indexes are configured correctly with partial filters

4. **Data Integrity**
   - Duplicate unique fields are rejected
   - Invalid enum values are rejected
   - Metadata objects store arbitrary data

Run tests with:
```bash
pnpm test
```

## Index Verification

To verify indexes are created in MongoDB:

```javascript
// In MongoDB shell
db.sessions.getIndexes()
db.tasks.getIndexes()
db.machines.getIndexes()
```

Expected indexes for each collection are documented above in their respective schema sections.
