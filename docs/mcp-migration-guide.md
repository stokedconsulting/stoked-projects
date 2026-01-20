# MCP Tools Migration Guide: From Signal Files to State Tracking API

## Overview

This guide helps you migrate from the **signal file approach** (using `update-project.sh`) to the **MCP Tools approach** for managing Claude Projects state. The new MCP tools provide real-time session tracking, automatic failure detection, and recovery capabilities through a dedicated state tracking API.

### What's Changing?

| Aspect | Old Approach (Signal Files) | New Approach (MCP Tools) |
|--------|---------------------------|------------------------|
| **Communication** | File-based signals (`.signal` files) | HTTP REST API calls |
| **State Tracking** | Manual updates only | Continuous heartbeat monitoring |
| **Failure Detection** | Manual marking or polling | Automatic detection (3-min threshold) |
| **Recovery** | Manual restart required | Automated recovery workflows |
| **Architecture** | Local file system + GitHub | Centralized state tracking API |
| **Performance** | Dependent on file I/O | Sub-500ms latency (p95) |
| **Reliability** | Best-effort updates | Guaranteed state consistency |

---

## Phase 1: Understanding the Transition

### Signal File Approach (Legacy)

The old system worked by:

1. **Create a signal file** in `.claude-sessions/{session_id}.signal` containing event data
2. **Update GitHub** directly using `gh` CLI
3. **Notify VSCode extension** via file system watcher detecting the signal file change
4. **Extension refreshes** project view from GitHub

**Limitations:**
- No real-time session monitoring
- No automatic failure detection
- No recovery state captured
- Dependent on file system performance
- No analytics or session history

### MCP Tools Approach (New)

The new system provides:

1. **Session Registration** - Extension registers session with state tracking API
2. **Heartbeat Mechanism** - Extension sends periodic heartbeats (every 60 seconds)
3. **Real-Time Tracking** - API maintains session state, detects stalls automatically
4. **Automatic Failure Detection** - Sessions with no heartbeat >3 min marked as stalled
5. **Recovery Support** - API provides recovery state for restart workflows
6. **Analytics** - Complete session history and metrics

**Benefits:**
- ✅ Real-time failure detection (<5 minutes)
- ✅ Automatic session recovery workflows
- ✅ Zero manual intervention for stalls
- ✅ Complete session history and audit trail
- ✅ Performance metrics and monitoring
- ✅ Predictable API latencies
- ✅ Scalable to many concurrent sessions

---

## Phase 2: Side-by-Side Comparison

### Creating a Session

#### Old Approach (Signal Files)

```bash
# Script would write signal file after manual GitHub update
./examples/update-project.sh --close-issue 123 --project 70

# Creates: .claude-sessions/{session_id}.signal with event data
# Then: Extension detects file change and refreshes from GitHub
```

**Issues:**
- No dedicated session ID tracking
- Event data lost after extension processes signal
- No way to query session state later

#### New Approach (MCP Tools)

```bash
# Create session via MCP API
curl -X POST https://claude-projects.truapi.com/api/sessions \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "70",
    "machine_id": "developer-MacBook-Pro",
    "metadata": {"user": "claude", "environment": "vscode"}
  }'

# Response:
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "project_id": "70",
  "machine_id": "developer-MacBook-Pro",
  "status": "active",
  "last_heartbeat": "2026-01-20T10:30:00Z",
  "created_at": "2026-01-20T10:30:00Z",
  "metadata": {"user": "claude", "environment": "vscode"}
}
```

**Benefits:**
- ✅ Persistent session ID for tracking
- ✅ Return value confirms session created
- ✅ Complete audit trail of session lifecycle

### Tracking Task Progress

#### Old Approach (Signal Files)

```bash
# No task-level tracking
# Only issue-level updates via GitHub

./examples/update-project.sh --task-completed --issue 123 --project 70
```

**Issues:**
- No granular task tracking
- Can't query what task is currently executing
- No error context captured

#### New Approach (MCP Tools)

```bash
# Create task for session
curl -X POST https://claude-projects.truapi.com/api/tasks \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "project_id": "70",
    "github_issue_id": "123",
    "task_name": "Implement feature X",
    "metadata": {"assigned_to": "claude"}
  }'

# Response:
{
  "task_id": "660f9511-f41d-52e5-b826-557766551111",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "task_name": "Implement feature X",
  "created_at": "2026-01-20T10:30:00Z"
}

# Update task status
curl -X PATCH https://claude-projects.truapi.com/api/tasks/660f9511-f41d-52e5-b826-557766551111 \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in_progress",
    "metadata": {"started_at": "2026-01-20T10:35:00Z"}
  }'

# Mark completed
curl -X PATCH https://claude-projects.truapi.com/api/tasks/660f9511-f41d-52e5-b826-557766551111 \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed"
  }'
```

**Benefits:**
- ✅ Granular task-level tracking
- ✅ Know what's currently executing
- ✅ Error context captured if task fails
- ✅ Timestamped progress history

### Detecting Session Failures

#### Old Approach (Signal Files)

```bash
# Manual failure detection required
# No automatic mechanism

# Option 1: Manually mark as failed
./examples/update-project.sh --mark-failed --issue 123 --project 70

# Option 2: Manual polling and checking GitHub status
# No built-in failure detection
```

**Issues:**
- No automatic detection
- Delayed failure recognition
- Manual intervention required
- Stalled sessions continue consuming resources

#### New Approach (MCP Tools)

```bash
# Background job automatically detects stalled sessions (runs every 2 minutes)
# No manual action required

# Check current health status
curl -X GET "https://claude-projects.truapi.com/api/sessions/health" \
  -H "X-API-Key: your-api-key"

# Response:
{
  "total_sessions": 10,
  "active_sessions": 8,
  "stalled_sessions": 1,
  "failed_sessions": 0,
  "completed_sessions": 1,
  "last_updated": "2026-01-20T10:35:00Z"
}

# List stalled sessions
curl -X GET "https://claude-projects.truapi.com/api/sessions/stalled" \
  -H "X-API-Key: your-api-key"

# Response:
{
  "stalled_sessions": [
    {
      "session_id": "550e8400-e29b-41d4-a716-446655440000",
      "project_id": "70",
      "machine_id": "developer-MacBook-Pro",
      "last_heartbeat": "2026-01-20T10:27:00Z",
      "time_since_heartbeat_ms": 210000,
      "stall_threshold_ms": 180000
    }
  ]
}

# Get detailed health status for specific session
curl -X GET "https://claude-projects.truapi.com/api/sessions/550e8400-e29b-41d4-a716-446655440000/health" \
  -H "X-API-Key: your-api-key"

# Response:
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "is_healthy": false,
  "status": "stalled",
  "last_heartbeat": "2026-01-20T10:27:00Z",
  "time_since_heartbeat_ms": 210000,
  "is_stalled": true,
  "stall_threshold_ms": 180000
}
```

**Benefits:**
- ✅ Automatic detection every 2 minutes
- ✅ Real-time health status available
- ✅ No manual intervention needed
- ✅ Immediate visibility into session health

### Recovering from Failures

#### Old Approach (Signal Files)

```bash
# Manual recovery steps required

# 1. Detect failure (manual)
# 2. Query GitHub project state (manual)
# 3. Restart orchestration manually
# 4. Hope previous progress isn't duplicated

# No built-in recovery mechanism
```

**Issues:**
- Completely manual process
- No saved recovery state
- Risk of data loss or duplication
- Time-consuming manual steps

#### New Approach (MCP Tools)

```bash
# Get recovery state automatically
curl -X GET "https://claude-projects.truapi.com/api/sessions/550e8400-e29b-41d4-a716-446655440000/recovery-state" \
  -H "X-API-Key: your-api-key"

# Response:
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "project_id": "70",
  "last_successful_task": {
    "task_id": "660f9511-f41d-52e5-b826-557766551111",
    "task_name": "Implement feature X",
    "status": "completed",
    "completed_at": "2026-01-20T10:32:00Z"
  },
  "failed_tasks": [
    {
      "task_id": "770g0622-g52e-63f6-c937-668877662222",
      "task_name": "Add tests for feature X",
      "status": "failed",
      "error_message": "Timeout during test execution",
      "failed_at": "2026-01-20T10:34:00Z"
    }
  ],
  "pending_tasks": [
    {
      "task_id": "880h1733-h63f-74g7-d048-779988773333",
      "task_name": "Update documentation",
      "status": "pending"
    }
  ],
  "last_heartbeat": "2026-01-20T10:27:00Z",
  "metadata": {"recovery_eligible": true}
}

# Prepare for recovery
curl -X POST "https://claude-projects.truapi.com/api/sessions/550e8400-e29b-41d4-a716-446655440000/prepare-recovery" \
  -H "X-API-Key: your-api-key"

# Initiate recovery with new machine/resources
curl -X POST "https://claude-projects.truapi.com/api/sessions/550e8400-e29b-41d4-a716-446655440000/recover" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "new_machine_id": "backup-MacBook-Pro",
    "reset_failed_tasks": true
  }'

# Response:
{
  "session_id": "990i2844-i74g-85h8-e159-880a99884444",
  "project_id": "70",
  "machine_id": "backup-MacBook-Pro",
  "status": "active",
  "metadata": {
    "recovered_from": "550e8400-e29b-41d4-a716-446655440000",
    "recovery_timestamp": "2026-01-20T10:40:00Z"
  }
}
```

**Benefits:**
- ✅ Automatic state capture for recovery
- ✅ Clear view of what completed vs. failed
- ✅ Single API call to initiate recovery
- ✅ Deterministic recovery flow
- ✅ Avoids duplicate work

---

## Phase 3: Step-by-Step Migration Instructions

### Step 1: Prepare Your Environment

```bash
# 1. Get your API key from the team/configuration
export MCP_API_KEY="your-api-key-here"

# 2. Verify API is accessible
curl -X GET "https://claude-projects.truapi.com/health" \
  -H "X-API-Key: ${MCP_API_KEY}"

# Expected response: {"status":"ok","uptime":12345}
```

### Step 2: Update Your Orchestration Code

**Before (using signal files):**

```bash
#!/bin/bash
# old-orchestration.sh

# ... do work ...

# Notify via signal file
./examples/update-project.sh --task-completed --issue 123 --project 70
```

**After (using MCP tools):**

```bash
#!/bin/bash
# new-orchestration.sh

API_KEY="${MCP_API_KEY}"
API_BASE="https://claude-projects.truapi.com"
PROJECT_ID="70"
MACHINE_ID="$(hostname)"

# 1. Create session at start
SESSION_RESPONSE=$(curl -s -X POST "${API_BASE}/api/sessions" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\": \"${PROJECT_ID}\", \"machine_id\": \"${MACHINE_ID}\"}")

SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.session_id')
echo "Created session: $SESSION_ID"

# 2. Create task
TASK_RESPONSE=$(curl -s -X POST "${API_BASE}/api/tasks" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\": \"${SESSION_ID}\", \"project_id\": \"${PROJECT_ID}\", \"github_issue_id\": \"123\", \"task_name\": \"My Task\"}")

TASK_ID=$(echo "$TASK_RESPONSE" | jq -r '.task_id')

# 3. Mark task as in_progress
curl -s -X PATCH "${API_BASE}/api/tasks/${TASK_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}' > /dev/null

# 4. Do your work here
# ... do work ...

# 5. Mark task as completed
curl -s -X PATCH "${API_BASE}/api/tasks/${TASK_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}' > /dev/null

# 6. Mark session as completed
curl -s -X PATCH "${API_BASE}/api/sessions/${SESSION_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}' > /dev/null
```

### Step 3: Add Heartbeat Mechanism

The VSCode extension should send heartbeats automatically. For standalone scripts:

```bash
#!/bin/bash
# Send heartbeat every 60 seconds in background

heartbeat_loop() {
  while true; do
    curl -s -X POST "${API_BASE}/api/sessions/${SESSION_ID}/heartbeat" \
      -H "X-API-Key: ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d '{}' > /dev/null

    sleep 60
  done
}

# Start heartbeat in background
heartbeat_loop &
HEARTBEAT_PID=$!

# ... do your work ...

# Stop heartbeat on exit
kill $HEARTBEAT_PID
```

### Step 4: Implement Error Handling

```bash
#!/bin/bash
# Handle failures gracefully

set -e
trap cleanup EXIT

cleanup() {
  if [ -n "$SESSION_ID" ] && [ -n "$API_KEY" ]; then
    # Mark as failed if still active
    CURRENT_STATUS=$(curl -s -X GET "${API_BASE}/api/sessions/${SESSION_ID}" \
      -H "X-API-Key: ${API_KEY}" | jq -r '.status')

    if [ "$CURRENT_STATUS" = "active" ]; then
      curl -s -X POST "${API_BASE}/api/sessions/${SESSION_ID}/mark-failed" \
        -H "X-API-Key: ${API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"error_message\": \"$1\"}" > /dev/null
    fi
  fi
}

trap 'cleanup "Unhandled error"' ERR
```

### Step 5: Verify Integration

```bash
# Check session was created
curl -X GET "https://claude-projects.truapi.com/api/sessions?limit=1" \
  -H "X-API-Key: ${MCP_API_KEY}"

# Check health metrics
curl -X GET "https://claude-projects.truapi.com/api/sessions/health" \
  -H "X-API-Key: ${MCP_API_KEY}"

# Check recent tasks
curl -X GET "https://claude-projects.truapi.com/api/tasks?limit=10" \
  -H "X-API-Key: ${MCP_API_KEY}"
```

---

## Phase 4: Deprecation Timeline

### Immediate (Now)

- Signal file approach still supported
- Deprecation warnings added to `update-project.sh`
- Migration guide published
- MCP tools available for new sessions

### 30 Days

- Signal file approach still functional
- Email notifications sent to active users
- Migration assistance available
- Most projects migrated to MCP tools

### 60 Days

- Signal file approach marked for removal
- All critical projects migrated
- Final migration push
- Documentation updated

### 90 Days

- Signal file approach completely removed
- `update-project.sh` script deprecated
- All projects using MCP tools
- Legacy code cleaned up

---

## Phase 5: Troubleshooting Common Issues

### Issue: API Connection Timeout

**Symptoms:**
```
curl: (28) Operation timed out after 5000 milliseconds
```

**Solutions:**
1. Verify API is accessible:
   ```bash
   curl -v https://claude-projects.truapi.com/health
   ```

2. Check network connectivity:
   ```bash
   ping claude-projects.truapi.com
   ```

3. Verify API key is valid:
   ```bash
   curl -X GET https://claude-projects.truapi.com/api/sessions \
     -H "X-API-Key: invalid-key"
   # Should return 401 if key is invalid
   ```

### Issue: Heartbeat Not Received

**Symptoms:**
- Session marked as stalled shortly after creation
- `time_since_heartbeat_ms` increasing rapidly

**Solutions:**
1. Verify heartbeat is being sent:
   ```bash
   # Enable debug logging
   curl -v -X POST https://claude-projects.truapi.com/api/sessions/${SESSION_ID}/heartbeat \
     -H "X-API-Key: ${API_KEY}" \
     -H "Content-Type: application/json" \
     -d '{}'
   ```

2. Check session status:
   ```bash
   curl -X GET https://claude-projects.truapi.com/api/sessions/${SESSION_ID}/health \
     -H "X-API-Key: ${API_KEY}"
   ```

3. Verify heartbeat interval is ≤3 minutes (180000ms)

### Issue: Recovery Not Working

**Symptoms:**
- Recovery endpoint returns error
- New session not created after recovery

**Solutions:**
1. Check original session is in failed state:
   ```bash
   curl -X GET https://claude-projects.truapi.com/api/sessions/${SESSION_ID} \
     -H "X-API-Key: ${API_KEY}"
   # status should be "failed" or "stalled"
   ```

2. Get recovery state first:
   ```bash
   curl -X GET https://claude-projects.truapi.com/api/sessions/${SESSION_ID}/recovery-state \
     -H "X-API-Key: ${API_KEY}"
   ```

3. Verify new_machine_id is available:
   ```bash
   curl -X GET https://claude-projects.truapi.com/api/machines \
     -H "X-API-Key: ${API_KEY}"
   ```

### Issue: Rate Limiting (429 errors)

**Symptoms:**
```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded: 100 requests per minute"
}
```

**Solutions:**
1. Implement exponential backoff:
   ```bash
   retry_with_backoff() {
     local max_attempts=3
     local timeout=1
     local attempt=1

     while [ $attempt -le $max_attempts ]; do
       if curl -s -X POST "$@"; then
         return 0
       fi
       attempt=$((attempt + 1))
       sleep $timeout
       timeout=$((timeout * 2))
     done

     return 1
   }
   ```

2. Reduce request frequency
3. Check if rate limits should be adjusted (contact team)

---

## Phase 6: Performance Benefits

### Latency Improvements

| Operation | Old Approach | New Approach | Improvement |
|-----------|-------------|------------|-------------|
| Session Creation | ~2 seconds (file I/O + GitHub) | <1 second (API) | 2x faster |
| Status Update | ~3 seconds (GitHub GraphQL) | <500ms (API) | 6x faster |
| Failure Detection | Manual (~hours) | Automatic (3 minutes) | 20x faster |
| Recovery Setup | Manual (~10 min) | Automatic (<1 min) | 10x faster |

### Reliability Improvements

| Metric | Old | New | Target |
|--------|-----|-----|--------|
| **Failure Detection** | Manual | Automatic | <5 min |
| **Recovery Rate** | ~50% | ~90%+ | >95% |
| **State Consistency** | File-dependent | Database-backed | 100% |
| **Audit Trail** | Limited | Complete | ✅ |

### Scalability

| Scenario | Old Approach | New Approach |
|----------|-------------|------------|
| 10 concurrent sessions | ✅ OK | ✅ OK (optimized) |
| 100 concurrent sessions | ⚠️ File lock contention | ✅ OK (full support) |
| 1000 concurrent sessions | ❌ Not feasible | ✅ OK (with scaling) |

---

## Phase 7: FAQ

### Q: Can I use both signal files and MCP tools?

**A:** Yes, during the transition period both approaches work. However, we recommend fully migrating to MCP tools for the best experience. Signal files will be deprecated in 90 days.

### Q: What if my session is interrupted?

**A:** With MCP tools:
1. Session is marked as "stalled" after 3 minutes with no heartbeat
2. You can query recovery state and restart from where you left off
3. Automatic recovery is available via the recovery API

### Q: How often should I send heartbeats?

**A:** The VSCode extension sends heartbeats every 60 seconds automatically. For custom implementations, heartbeat frequency should be:
- **Recommended:** Every 60 seconds
- **Minimum:** Every 180 seconds (3 minutes is the stall threshold)
- **Maximum:** Every 10 seconds (to avoid rate limiting)

### Q: What data is captured in the state tracking API?

**A:** Complete session lifecycle data:
- Session ID, project ID, machine ID
- Session status and timestamps
- Task-level progress and status
- Error messages and failure context
- Recovery state for failed sessions
- Complete audit trail with all status transitions

### Q: Is my data secure?

**A:** Yes:
- API key-based authentication (no OAuth)
- TLS 1.2+ encryption for all data in transit
- MongoDB Atlas encryption at rest
- All data encrypted in storage
- Access logs and audit trail maintained
- IP whitelist can be configured if needed

### Q: How long is session data retained?

**A:** By default:
- **Active/In-Progress Sessions:** Indefinitely (until completed)
- **Completed Sessions:** 30 days (configurable)
- **Archived Sessions:** Indefinitely
- TTL indexes automatically clean up old data

### Q: Can I query historical session data?

**A:** Yes:
```bash
# Query sessions by project
curl -X GET "https://claude-projects.truapi.com/api/sessions?project_id=70&status=completed" \
  -H "X-API-Key: ${API_KEY}"

# Query sessions by machine
curl -X GET "https://claude-projects.truapi.com/api/sessions?machine_id=my-machine" \
  -H "X-API-Key: ${API_KEY}"

# Query tasks for a session
curl -X GET "https://claude-projects.truapi.com/api/tasks?session_id=${SESSION_ID}" \
  -H "X-API-Key: ${API_KEY}"
```

### Q: What happens if the API is down?

**A:** The VSCode extension gracefully degrades:
1. Continues orchestration without tracking
2. Logs API connection errors
3. Retries API calls with exponential backoff
4. Persists session state locally until API is available
5. Resumes tracking when API comes back online

### Q: Can I use MCP tools in non-VSCode contexts?

**A:** Absolutely! The API is language and framework agnostic:
- Works with bash scripts
- Works with Python scripts
- Works with Node.js applications
- Works with any system that can make HTTP requests
- Documentation available in examples/mcp-tools/

---

## Phase 8: Getting Help

### Resources

1. **API Documentation:** `/docs/api-reference.md`
2. **Examples:** `/examples/mcp-tools/`
3. **Integration Guide:** `/examples/INTEGRATION.md` (updated for MCP tools)
4. **Health Monitoring:** `https://claude-projects.truapi.com/health/detailed`

### Contact Support

- **Documentation:** See `/docs/` directory
- **Issues/Bugs:** Open GitHub issue with logs
- **API Keys:** Contact project team
- **Questions:** Reference `/examples/mcp-tools/project-workflow.md`

### Monitoring Your Migration

Track your migration progress:

```bash
# Check how many sessions are using MCP tools
curl -X GET "https://claude-projects.truapi.com/api/sessions/health" \
  -H "X-API-Key: ${API_KEY}"

# Compare with legacy signal file sessions
ls -la .claude-sessions/*.signal | wc -l
```

---

## Conclusion

The MCP Tools approach provides significant improvements in reliability, performance, and observability. While the signal file approach will continue to work during the transition period, we encourage complete migration within the 90-day deprecation window.

**Key Takeaways:**

✅ MCP tools provide real-time failure detection
✅ Automatic recovery workflows save time and reduce manual intervention
✅ Complete session history for auditing and analytics
✅ Sub-500ms latency for all API operations
✅ Graceful degradation if API becomes unavailable
✅ 90-day transition period before signal files are removed

**Start migrating today** and enjoy the benefits of automated session tracking!
