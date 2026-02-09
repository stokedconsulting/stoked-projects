# Session Recovery Workflow

## Overview

The Session Recovery feature allows failed or stalled sessions to be recovered and resumed. This is essential for handling transient failures, network issues, or machine crashes without losing progress.

## Key Concepts

### Recoverable States
Sessions in the following states can be recovered:
- **FAILED**: Session explicitly marked as failed
- **STALLED**: Session that stopped sending heartbeats

### Recovery Limits
- Maximum of **3 recovery attempts** per session
- After 3 attempts, the session is considered permanently failed
- Recovery attempts are tracked in session metadata

### Recovery Metadata
All recovery information is stored in `session.metadata.recovery`:
```typescript
{
  recovery_attempts: number,           // Number of times recovery was attempted
  last_recovery_at: Date,              // Timestamp of last recovery
  recovery_history: RecoveryAttempt[], // Full history of attempts
  recovery_checkpoints: Checkpoint[]   // State snapshots before recovery
}
```

## API Endpoints

### 1. Find Recoverable Sessions
**GET /sessions/recoverable**

Find all sessions eligible for recovery with optional filtering.

**Query Parameters:**
- `project_id` (optional): Filter by project
- `machine_id` (optional): Filter by machine
- `max_age_minutes` (optional): Exclude sessions older than N minutes
- `min_age_minutes` (optional): Exclude sessions newer than N minutes

**Example:**
```bash
GET /sessions/recoverable?project_id=123&max_age_minutes=60
```

**Response:**
```json
[
  {
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "project_id": "123",
    "status": "failed",
    "machine_id": "macbook-pro-m1",
    "docker_slot": 1,
    "current_task_id": "task-uuid-123",
    "recovery_attempts": 1,
    "last_heartbeat": "2024-01-19T11:55:00.000Z",
    "failed_at": "2024-01-19T12:00:00.000Z",
    "minutes_since_heartbeat": 15,
    "can_recover": true
  }
]
```

### 2. Prepare Recovery
**POST /sessions/:id/prepare-recovery**

Create a recovery checkpoint before attempting recovery.

**Purpose:**
- Captures current session state
- Creates a snapshot for rollback
- Validates session can be recovered

**Example:**
```bash
POST /sessions/550e8400-e29b-41d4-a716-446655440000/prepare-recovery
```

**Response:**
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "failed",
  "last_task_id": "task-uuid-123",
  "machine_id": "macbook-pro-m1",
  "docker_slot": 1,
  "recovery_attempts": 1,
  "recovery_checkpoint_at": "2024-01-19T12:05:00.000Z",
  "metadata": {
    "vscode_version": "1.85.0",
    "last_error": "Connection timeout"
  }
}
```

### 3. Recover Session
**POST /sessions/:id/recover**

Attempt to recover a failed or stalled session.

**Request Body:**
```json
{
  "new_machine_id": "macbook-air-m2",      // Optional: assign to different machine
  "new_docker_slot": 2,                     // Optional: use different docker slot
  "resume_from_task_id": "task-uuid-456"   // Optional: resume from specific task
}
```

**Example - Basic Recovery:**
```bash
POST /sessions/550e8400-e29b-41d4-a716-446655440000/recover
{}
```

**Example - Recovery with Machine Reassignment:**
```bash
POST /sessions/550e8400-e29b-41d4-a716-446655440000/recover
{
  "new_machine_id": "macbook-air-m2",
  "new_docker_slot": 3
}
```

**Example - Recovery with Task Resume:**
```bash
POST /sessions/550e8400-e29b-41d4-a716-446655440000/recover
{
  "resume_from_task_id": "task-uuid-456"
}
```

**Response:**
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "project_id": "123",
  "machine_id": "macbook-air-m2",
  "docker_slot": 3,
  "status": "active",
  "last_heartbeat": "2024-01-19T12:10:00.000Z",
  "current_task_id": "task-uuid-456",
  "started_at": "2024-01-19T10:00:00.000Z",
  "metadata": {
    "recovery": {
      "recovery_attempts": 2,
      "last_recovery_at": "2024-01-19T12:10:00.000Z",
      "recovery_history": [...]
    }
  }
}
```

### 4. Get Recovery History
**GET /sessions/:id/recovery-history**

Retrieve complete history of recovery attempts.

**Example:**
```bash
GET /sessions/550e8400-e29b-41d4-a716-446655440000/recovery-history
```

**Response:**
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "total_attempts": 2,
  "successful_attempts": 1,
  "failed_attempts": 1,
  "last_recovery_at": "2024-01-19T12:10:00.000Z",
  "current_status": "active",
  "attempts": [
    {
      "attempted_at": "2024-01-19T12:05:00.000Z",
      "success": true,
      "new_machine_id": "macbook-air-m2",
      "new_docker_slot": 3,
      "resumed_from_task_id": "task-uuid-456"
    },
    {
      "attempted_at": "2024-01-19T11:30:00.000Z",
      "success": false,
      "error": "New machine not available"
    }
  ]
}
```

## Recovery Workflow Examples

### Basic Recovery Workflow

```typescript
// 1. Session fails
POST /sessions/:id/mark-failed
{
  "reason": "Claude process crashed",
  "error_details": {
    "error_code": "ERR_PROCESS_CRASH",
    "exit_code": 1
  }
}

// 2. Find recoverable sessions
GET /sessions/recoverable?project_id=123

// 3. Prepare recovery (optional but recommended)
POST /sessions/:id/prepare-recovery

// 4. Recover the session
POST /sessions/:id/recover
{}

// 5. Check recovery was successful
GET /sessions/:id
// status should be "active"

// 6. Resume normal heartbeat cycle
POST /sessions/:id/heartbeat
```

### Recovery with Machine Migration

```typescript
// 1. Session stalls on machine-1
// (Detected by heartbeat monitoring)

// 2. Find available machine
GET /machines/available

// 3. Prepare recovery checkpoint
POST /sessions/:id/prepare-recovery

// 4. Recover on new machine
POST /sessions/:id/recover
{
  "new_machine_id": "machine-2",
  "new_docker_slot": 1
}

// 5. Update machine assignment
// (Handled automatically by recovery)

// 6. Resume work
POST /sessions/:id/heartbeat
```

### Partial Task Recovery

```typescript
// 1. Session fails mid-task
POST /sessions/:id/mark-failed
{
  "reason": "Network timeout during task execution"
}

// 2. Get session info to find last task
GET /sessions/:id
// Note: current_task_id will show the task that was running

// 3. Get tasks for session to find last completed task
GET /tasks?session_id=:id&status=completed
// Sort by completed_at to find most recent

// 4. Prepare recovery
POST /sessions/:id/prepare-recovery

// 5. Recover and resume from last successful task
POST /sessions/:id/recover
{
  "resume_from_task_id": "last-successful-task-id"
}

// 6. Continue processing remaining tasks
POST /tasks
{
  "session_id": ":id",
  "task_name": "Resume work..."
}
```

## Best Practices

### When to Use Recovery

**Good Use Cases:**
- Transient network failures
- Machine crashes or restarts
- Docker container issues
- Temporary resource exhaustion
- Claude process crashes

**Not Recommended:**
- Permanent infrastructure failures
- Invalid project configuration
- Corrupted session state
- After 3 failed recovery attempts

### Recovery Strategy

1. **Immediate Recovery** (< 5 minutes since failure)
   - Use same machine if available
   - Resume from current task
   - No preparation needed

2. **Delayed Recovery** (5-30 minutes)
   - Prepare recovery checkpoint first
   - Consider machine reassignment
   - Review error details before recovery

3. **Extended Recovery** (> 30 minutes)
   - Check infrastructure status
   - Verify machine availability
   - May need to restart from earlier task

### Monitoring Recovery

Track these metrics:
- Recovery attempt success rate
- Time to recovery
- Frequency of recovery per session
- Common recovery failure reasons

### Recovery Limits

- **Max Attempts**: 3 per session
- **Reason**: Prevents infinite recovery loops
- **After Limit**: Manual intervention required

To reset recovery counter:
```typescript
// Create new session (cannot reset existing session)
POST /sessions
{
  "project_id": "same-project",
  "machine_id": "new-machine"
}
```

## Error Handling

### Common Errors

**400 - Cannot recover completed sessions**
```json
{
  "statusCode": 400,
  "message": "Cannot recover completed sessions"
}
```
Solution: This session finished successfully, no recovery needed.

**400 - Maximum recovery attempts reached**
```json
{
  "statusCode": 400,
  "message": "Maximum recovery attempts (3) reached for this session"
}
```
Solution: Create a new session to continue work.

**404 - Task not found**
```json
{
  "statusCode": 404,
  "message": "Task with ID task-uuid-456 not found"
}
```
Solution: Verify task ID or omit `resume_from_task_id` to resume from last task.

**400 - Task belongs to different session**
```json
{
  "statusCode": 400,
  "message": "Task task-uuid-456 does not belong to session session-uuid-123"
}
```
Solution: Use a task ID from the correct session.

## Integration Examples

### TypeScript/JavaScript
```typescript
import axios from 'axios';

interface RecoveryOptions {
  newMachineId?: string;
  newDockerSlot?: number;
  resumeFromTaskId?: string;
}

async function recoverSession(
  sessionId: string,
  options: RecoveryOptions = {}
): Promise<void> {
  const baseUrl = 'https://api.example.com';
  const apiKey = process.env.API_KEY;

  // 1. Check if session is recoverable
  const recoverableResponse = await axios.get(
    `${baseUrl}/sessions/recoverable`,
    {
      headers: { 'X-API-Key': apiKey },
      params: { session_id: sessionId }
    }
  );

  const session = recoverableResponse.data.find(
    (s: any) => s.session_id === sessionId
  );

  if (!session || !session.can_recover) {
    throw new Error('Session is not recoverable');
  }

  // 2. Prepare recovery
  await axios.post(
    `${baseUrl}/sessions/${sessionId}/prepare-recovery`,
    {},
    { headers: { 'X-API-Key': apiKey } }
  );

  // 3. Recover with options
  const recoveryData: any = {};
  if (options.newMachineId) recoveryData.new_machine_id = options.newMachineId;
  if (options.newDockerSlot) recoveryData.new_docker_slot = options.newDockerSlot;
  if (options.resumeFromTaskId) recoveryData.resume_from_task_id = options.resumeFromTaskId;

  const recoveredSession = await axios.post(
    `${baseUrl}/sessions/${sessionId}/recover`,
    recoveryData,
    { headers: { 'X-API-Key': apiKey } }
  );

  console.log('Session recovered:', recoveredSession.data);

  // 4. Resume heartbeat
  setInterval(async () => {
    await axios.post(
      `${baseUrl}/sessions/${sessionId}/heartbeat`,
      {},
      { headers: { 'X-API-Key': apiKey } }
    );
  }, 60000); // Every 60 seconds
}
```

### Python
```python
import requests
import time
from typing import Optional

def recover_session(
    session_id: str,
    new_machine_id: Optional[str] = None,
    new_docker_slot: Optional[int] = None,
    resume_from_task_id: Optional[str] = None
):
    base_url = 'https://api.example.com'
    api_key = os.getenv('API_KEY')
    headers = {'X-API-Key': api_key}

    # 1. Check recoverability
    response = requests.get(
        f'{base_url}/sessions/recoverable',
        headers=headers
    )
    sessions = response.json()
    session = next((s for s in sessions if s['session_id'] == session_id), None)

    if not session or not session['can_recover']:
        raise ValueError('Session is not recoverable')

    # 2. Prepare recovery
    requests.post(
        f'{base_url}/sessions/{session_id}/prepare-recovery',
        headers=headers
    )

    # 3. Recover with options
    recovery_data = {}
    if new_machine_id:
        recovery_data['new_machine_id'] = new_machine_id
    if new_docker_slot is not None:
        recovery_data['new_docker_slot'] = new_docker_slot
    if resume_from_task_id:
        recovery_data['resume_from_task_id'] = resume_from_task_id

    response = requests.post(
        f'{base_url}/sessions/{session_id}/recover',
        json=recovery_data,
        headers=headers
    )

    print(f'Session recovered: {response.json()}')

    # 4. Resume heartbeat
    while True:
        requests.post(
            f'{base_url}/sessions/{session_id}/heartbeat',
            headers=headers
        )
        time.sleep(60)
```

## Troubleshooting

### Session Not Appearing in Recoverable List

**Check:**
1. Session status is `failed` or `stalled`
2. Session hasn't exceeded max recovery attempts
3. Session isn't completed
4. Filters aren't excluding the session

### Recovery Fails Immediately

**Common Causes:**
1. Invalid machine_id specified
2. Task belongs to different session
3. Session state changed between prepare and recover

**Solution:**
- Re-fetch session state
- Verify all IDs
- Use prepare-recovery to validate before recovery

### Multiple Recovery Attempts Needed

**Indicates:**
- Underlying issue not resolved
- Infrastructure instability
- Configuration problems

**Action:**
- Review recovery history for patterns
- Fix root cause before additional attempts
- Consider creating new session if problem persists

## See Also

- [Session Health Monitoring](./SESSION_HEALTH.md)
- [Failure Tracking](./FAILURE_TRACKING.md)
- [API Reference](./API_REFERENCE.md)
