# MCP Tools: Complete Project Workflow Examples

This document provides complete end-to-end workflow examples for managing Claude Projects using MCP Tools.

---

## Quick Start: 5-Minute Setup

### 1. Get Your API Key

```bash
# Contact your team to get an MCP_API_KEY
export MCP_API_KEY="your-api-key-here"

# Verify it works
curl -X GET https://claude-projects.truapi.com/health \
  -H "X-API-Key: ${MCP_API_KEY}"
```

### 2. Create a Project Session

```bash
#!/bin/bash
# Create session for project

PROJECT_ID="72"
MACHINE_ID="$(hostname)"

SESSION=$(curl -s -X POST https://claude-projects.truapi.com/api/sessions \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"project_id\": \"${PROJECT_ID}\",
    \"machine_id\": \"${MACHINE_ID}\"
  }")

SESSION_ID=$(echo "$SESSION" | jq -r '.session_id')
echo "Session created: $SESSION_ID"
```

### 3. Create Tasks and Start Working

```bash
# Create a task
TASK=$(curl -s -X POST https://claude-projects.truapi.com/api/tasks \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\": \"${SESSION_ID}\",
    \"project_id\": \"${PROJECT_ID}\",
    \"github_issue_id\": \"10\",
    \"task_name\": \"Implement API endpoint\"
  }")

TASK_ID=$(echo "$TASK" | jq -r '.task_id')

# Start the task
curl -s -X PATCH https://claude-projects.truapi.com/api/tasks/${TASK_ID} \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}' > /dev/null

# ... do your work ...

# Mark as completed
curl -s -X PATCH https://claude-projects.truapi.com/api/tasks/${TASK_ID} \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}' > /dev/null

echo "Task completed!"
```

### 4. Send Heartbeats

```bash
# Send heartbeat every 60 seconds
while true; do
  curl -s -X POST https://claude-projects.truapi.com/api/sessions/${SESSION_ID}/heartbeat \
    -H "X-API-Key: ${MCP_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{}' > /dev/null
  sleep 60
done
```

---

## Example 1: Simple Issue Fix

**Scenario:** Fix a bug in GitHub issue #10

```bash
#!/bin/bash
# fix-bug.sh - Workflow for fixing a single bug

set -e

API_BASE="https://claude-projects.truapi.com"
API_KEY="${MCP_API_KEY}"
PROJECT_ID="70"
ISSUE_ID="10"
ISSUE_TITLE="Fix login button styling"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🐛 Fixing Issue #${ISSUE_ID}: ${ISSUE_TITLE}${NC}\n"

# Step 1: Create session
echo "Step 1: Creating session..."
SESSION=$(curl -s -X POST "${API_BASE}/api/sessions" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"project_id\": \"${PROJECT_ID}\",
    \"machine_id\": \"$(hostname)\"
  }")

SESSION_ID=$(echo "$SESSION" | jq -r '.session_id')
echo -e "${GREEN}✓ Session: ${SESSION_ID}${NC}\n"

# Step 2: Create task
echo "Step 2: Creating task..."
TASK=$(curl -s -X POST "${API_BASE}/api/tasks" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\": \"${SESSION_ID}\",
    \"project_id\": \"${PROJECT_ID}\",
    \"github_issue_id\": \"${ISSUE_ID}\",
    \"task_name\": \"${ISSUE_TITLE}\"
  }")

TASK_ID=$(echo "$TASK" | jq -r '.task_id')
echo -e "${GREEN}✓ Task: ${TASK_ID}${NC}\n"

# Step 3: Start heartbeat in background
echo "Step 3: Starting heartbeat monitor..."
(
  while true; do
    curl -s -X POST "${API_BASE}/api/sessions/${SESSION_ID}/heartbeat" \
      -H "X-API-Key: ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d '{}' > /dev/null
    sleep 60
  done
) &
HEARTBEAT_PID=$!
echo -e "${GREEN}✓ Heartbeat started (PID: ${HEARTBEAT_PID})${NC}\n"

# Step 4: Mark task as in progress
echo "Step 4: Marking task as in progress..."
curl -s -X PATCH "${API_BASE}/api/tasks/${TASK_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}' > /dev/null
echo -e "${GREEN}✓ Task started${NC}\n"

# Step 5: Do the actual work
echo "Step 5: Fixing the bug..."
# ... your actual work here ...
# For example: edit files, run tests, etc.
echo "  - Updated button styles"
echo "  - Tested on multiple browsers"
echo "  - All tests passing"
echo -e "${GREEN}✓ Bug fixed${NC}\n"

# Step 6: Mark task as completed
echo "Step 6: Marking task as completed..."
curl -s -X PATCH "${API_BASE}/api/tasks/${TASK_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "metadata": {"completed_by": "claude"}
  }' > /dev/null
echo -e "${GREEN}✓ Task completed${NC}\n"

# Step 7: Mark session as completed
echo "Step 7: Finalizing session..."
curl -s -X PATCH "${API_BASE}/api/sessions/${SESSION_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}' > /dev/null

# Stop heartbeat
kill $HEARTBEAT_PID 2>/dev/null || true

echo -e "${GREEN}✓ Session completed${NC}\n"
echo -e "${BLUE}✅ Workflow complete!${NC}\n"
```

---

## Example 2: Multi-Issue Workflow

**Scenario:** Work on multiple related issues in a single session

```bash
#!/bin/bash
# multi-issue-workflow.sh - Handle multiple issues in one session

set -e

API_BASE="https://claude-projects.truapi.com"
API_KEY="${MCP_API_KEY}"
PROJECT_ID="72"
MACHINE_ID="$(hostname)"

# Define issues to work on
declare -a ISSUES=(
  "5:Database schema design"
  "10:Implement session endpoints"
  "15:Add heartbeat mechanism"
)

echo "📋 Multi-Issue Workflow"
echo "======================================\n"

# Create session
echo "Creating session..."
SESSION=$(curl -s -X POST "${API_BASE}/api/sessions" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"project_id\": \"${PROJECT_ID}\",
    \"machine_id\": \"${MACHINE_ID}\"
  }")

SESSION_ID=$(echo "$SESSION" | jq -r '.session_id')
echo "✓ Session: ${SESSION_ID}\n"

# Create task for each issue
declare -a TASK_IDS
echo "Creating tasks..."

for issue_spec in "${ISSUES[@]}"; do
  ISSUE_ID="${issue_spec%:*}"
  ISSUE_NAME="${issue_spec#*:}"

  TASK=$(curl -s -X POST "${API_BASE}/api/tasks" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
      \"session_id\": \"${SESSION_ID}\",
      \"project_id\": \"${PROJECT_ID}\",
      \"github_issue_id\": \"${ISSUE_ID}\",
      \"task_name\": \"${ISSUE_NAME}\"
    }")

  TASK_ID=$(echo "$TASK" | jq -r '.task_id')
  TASK_IDS+=("$TASK_ID")

  echo "  ✓ Issue #${ISSUE_ID}: ${TASK_ID}"
done
echo ""

# Start heartbeat
(
  while true; do
    curl -s -X POST "${API_BASE}/api/sessions/${SESSION_ID}/heartbeat" \
      -H "X-API-Key: ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d '{}' > /dev/null
    sleep 60
  done
) &
HEARTBEAT_PID=$!

# Process each task
echo "Processing tasks..."
echo "────────────────────────────────\n"

for i in "${!TASK_IDS[@]}"; do
  TASK_ID="${TASK_IDS[$i]}"
  ISSUE_SPEC="${ISSUES[$i]}"
  ISSUE_ID="${ISSUE_SPEC%:*}"
  ISSUE_NAME="${ISSUE_SPEC#*:}"

  echo "Working on Issue #${ISSUE_ID}: ${ISSUE_NAME}"

  # Mark as in progress
  curl -s -X PATCH "${API_BASE}/api/tasks/${TASK_ID}" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"status": "in_progress"}' > /dev/null

  # Simulate work
  echo "  → Implementing..."
  sleep 2

  # Mark as completed
  curl -s -X PATCH "${API_BASE}/api/tasks/${TASK_ID}" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"status": "completed"}' > /dev/null

  echo "  → ✓ Completed\n"
done

# Finalize session
echo "────────────────────────────────"
echo "Finalizing session..."

curl -s -X PATCH "${API_BASE}/api/sessions/${SESSION_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}' > /dev/null

kill $HEARTBEAT_PID 2>/dev/null || true

echo "✓ Session completed\n"
echo "✅ All issues completed!"
```

---

## Example 3: Handling Failures and Recovery

**Scenario:** Handle task failures and automatic session recovery

```bash
#!/bin/bash
# recovery-workflow.sh - Handle failures with automatic recovery

set -e

API_BASE="https://claude-projects.truapi.com"
API_KEY="${MCP_API_KEY}"
PROJECT_ID="72"

handle_failure() {
  local SESSION_ID=$1
  local TASK_ID=$2
  local ERROR_MSG=$3

  echo "⚠️ Task failed: $ERROR_MSG"

  # Mark task as failed
  curl -s -X PATCH "${API_BASE}/api/tasks/${TASK_ID}" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
      \"status\": \"failed\",
      \"error_message\": \"${ERROR_MSG}\"
    }" > /dev/null

  # Get recovery state
  echo "Getting recovery state..."
  RECOVERY_STATE=$(curl -s -X GET "${API_BASE}/api/sessions/${SESSION_ID}/recovery-state" \
    -H "X-API-Key: ${API_KEY}")

  # Show what can be recovered
  LAST_COMPLETED=$(echo "$RECOVERY_STATE" | jq -r '.last_successful_task.task_name // "none"')
  FAILED_COUNT=$(echo "$RECOVERY_STATE" | jq '.failed_tasks | length')

  echo "Recovery information:"
  echo "  - Last completed: $LAST_COMPLETED"
  echo "  - Failed tasks: $FAILED_COUNT"

  # Initiate recovery
  echo "Initiating recovery..."
  NEW_SESSION=$(curl -s -X POST "${API_BASE}/api/sessions/${SESSION_ID}/recover" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
      \"new_machine_id\": \"$(hostname)\",
      \"reset_failed_tasks\": true
    }")

  NEW_SESSION_ID=$(echo "$NEW_SESSION" | jq -r '.session_id')
  echo "Recovery session created: $NEW_SESSION_ID"

  return 0
}

# Create initial session
echo "Creating initial session..."
SESSION=$(curl -s -X POST "${API_BASE}/api/sessions" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"project_id\": \"${PROJECT_ID}\",
    \"machine_id\": \"$(hostname)\"
  }")

SESSION_ID=$(echo "$SESSION" | jq -r '.session_id')
echo "Session: $SESSION_ID\n"

# Create task
TASK=$(curl -s -X POST "${API_BASE}/api/tasks" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\": \"${SESSION_ID}\",
    \"project_id\": \"${PROJECT_ID}\",
    \"task_name\": \"Complex operation\"
  }")

TASK_ID=$(echo "$TASK" | jq -r '.task_id')
echo "Task: $TASK_ID\n"

# Mark as in progress
curl -s -X PATCH "${API_BASE}/api/tasks/${TASK_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}' > /dev/null

# Simulate work with failure
echo "Starting task execution..."
if [ $((RANDOM % 2)) -eq 0 ]; then
  echo "✓ Task completed successfully"
  curl -s -X PATCH "${API_BASE}/api/tasks/${TASK_ID}" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"status": "completed"}' > /dev/null
else
  ERROR="Database connection timeout"
  handle_failure "$SESSION_ID" "$TASK_ID" "$ERROR"
fi

# Check final status
FINAL_STATUS=$(curl -s -X GET "${API_BASE}/api/sessions/${SESSION_ID}/health" \
  -H "X-API-Key: ${API_KEY}")

echo "Final session health:"
echo "$FINAL_STATUS" | jq '.'
```

---

## Example 4: Monitoring and Observability

**Scenario:** Monitor session health and get metrics

```bash
#!/bin/bash
# monitor-workflow.sh - Monitor and observe a running workflow

API_BASE="https://claude-projects.truapi.com"
API_KEY="${MCP_API_KEY}"

# Function to display formatted metrics
display_metrics() {
  echo "📊 API Health Metrics"
  echo "====================================\n"

  # Overall health
  HEALTH=$(curl -s -X GET "${API_BASE}/api/sessions/health" \
    -H "X-API-Key: ${API_KEY}")

  echo "Total Sessions: $(echo "$HEALTH" | jq '.total_sessions')"
  echo "  - Active:   $(echo "$HEALTH" | jq '.active_sessions')"
  echo "  - Stalled:  $(echo "$HEALTH" | jq '.stalled_sessions')"
  echo "  - Failed:   $(echo "$HEALTH" | jq '.failed_sessions')"
  echo "  - Completed: $(echo "$HEALTH" | jq '.completed_sessions')\n"

  # Stalled sessions
  STALLED=$(curl -s -X GET "${API_BASE}/api/sessions/stalled" \
    -H "X-API-Key: ${API_KEY}")

  STALLED_COUNT=$(echo "$STALLED" | jq '.stalled_sessions | length')
  if [ "$STALLED_COUNT" -gt 0 ]; then
    echo "⚠️ Stalled Sessions ($STALLED_COUNT):"
    echo "$STALLED" | jq -r '.stalled_sessions[] | "  - Session: \(.session_id) (Project: \(.project_id))"'
    echo ""
  fi
}

# Function to monitor a specific session
monitor_session() {
  local SESSION_ID=$1

  echo "🔍 Monitoring Session: $SESSION_ID\n"

  for i in {1..5}; do
    HEALTH=$(curl -s -X GET "${API_BASE}/api/sessions/${SESSION_ID}/health" \
      -H "X-API-Key: ${API_KEY}")

    STATUS=$(echo "$HEALTH" | jq -r '.status')
    IS_HEALTHY=$(echo "$HEALTH" | jq -r '.is_healthy')
    TIME_SINCE=$(echo "$HEALTH" | jq '.time_since_heartbeat_ms')

    echo "Check $i: Status=$STATUS, Healthy=$IS_HEALTHY, LastHB=${TIME_SINCE}ms"

    sleep 5
  done
}

# Show overall metrics
display_metrics

# Example: Monitor a session if provided
if [ -n "$1" ]; then
  monitor_session "$1"
fi
```

---

## Example 5: CI/CD Integration

**Scenario:** Integrate MCP Tools with CI/CD pipeline

```bash
#!/bin/bash
# ci-workflow.sh - CI/CD pipeline with MCP Tools integration

set -e

API_BASE="https://claude-projects.truapi.com"
API_KEY="${MCP_API_KEY}"
PROJECT_ID="${CI_PROJECT_ID:-72}"
CI_BUILD_ID="${CI_JOB_ID:-unknown}"
CI_COMMIT_SHA="${CI_COMMIT_SHA:-unknown}"

echo "🚀 Starting CI/CD Workflow"
echo "  Build ID: $CI_BUILD_ID"
echo "  Commit: $CI_COMMIT_SHA\n"

# Create session for CI job
SESSION=$(curl -s -X POST "${API_BASE}/api/sessions" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"project_id\": \"${PROJECT_ID}\",
    \"machine_id\": \"ci-runner\",
    \"metadata\": {
      \"ci_build_id\": \"${CI_BUILD_ID}\",
      \"commit_sha\": \"${CI_COMMIT_SHA}\",
      \"pipeline\": \"CI/CD\"
    }
  }")

SESSION_ID=$(echo "$SESSION" | jq -r '.session_id')
echo "Session created: $SESSION_ID\n"

# Create tasks for each CI stage
STAGES=("unit_tests" "integration_tests" "build" "deploy")

declare -a TASK_IDS

for stage in "${STAGES[@]}"; do
  TASK=$(curl -s -X POST "${API_BASE}/api/tasks" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
      \"session_id\": \"${SESSION_ID}\",
      \"project_id\": \"${PROJECT_ID}\",
      \"task_name\": \"CI Stage: ${stage}\"
    }")

  TASK_ID=$(echo "$TASK" | jq -r '.task_id')
  TASK_IDS+=("$TASK_ID")
done

# Run stages and update task status
for i in "${!STAGES[@]}"; do
  STAGE="${STAGES[$i]}"
  TASK_ID="${TASK_IDS[$i]}"

  echo "Running stage: $STAGE"

  # Mark task as in progress
  curl -s -X PATCH "${API_BASE}/api/tasks/${TASK_ID}" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"status": "in_progress"}' > /dev/null

  # Run the actual stage
  if ./scripts/ci/${STAGE}.sh; then
    echo "✓ $STAGE passed"

    curl -s -X PATCH "${API_BASE}/api/tasks/${TASK_ID}" \
      -H "X-API-Key: ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d '{"status": "completed"}' > /dev/null
  else
    echo "✗ $STAGE failed"

    curl -s -X PATCH "${API_BASE}/api/tasks/${TASK_ID}" \
      -H "X-API-Key: ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{
        \"status\": \"failed\",
        \"error_message\": \"${STAGE} stage failed\"
      }" > /dev/null

    # Mark session as failed
    curl -s -X POST "${API_BASE}/api/sessions/${SESSION_ID}/mark-failed" \
      -H "X-API-Key: ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d '{"error_message": "CI pipeline failed at stage: '"${STAGE}"'"}' > /dev/null

    exit 1
  fi
done

# Mark session as completed
echo "All stages passed!"
curl -s -X PATCH "${API_BASE}/api/sessions/${SESSION_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}' > /dev/null

echo "✅ CI/CD pipeline completed successfully"
```

---

## Common Patterns

### Pattern 1: Async Task with Polling

```bash
# Start task and poll for completion
TASK_ID="..."

curl -s -X PATCH "..." -d '{"status": "in_progress"}' > /dev/null

# Poll status
while true; do
  STATUS=$(curl -s -X GET "${API_BASE}/api/tasks/${TASK_ID}" \
    -H "X-API-Key: ${API_KEY}" | jq -r '.status')

  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    echo "Task status: $STATUS"
    break
  fi

  echo "Waiting for task..."
  sleep 5
done
```

### Pattern 2: Timeout Handling

```bash
# Execute with timeout
timeout 300 ./long-running-task.sh

if [ $? -eq 124 ]; then
  # Timeout occurred
  curl -s -X POST "${API_BASE}/api/sessions/${SESSION_ID}/mark-failed" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"error_message": "Task execution timeout"}' > /dev/null
fi
```

### Pattern 3: Error Context

```bash
# Capture detailed error information
if ! command_that_might_fail; then
  ERROR_MSG="Failed at step: $?"
  ERROR_LOG=$(dmesg | tail -10 | tr '\n' ' ')

  curl -s -X PATCH "${API_BASE}/api/tasks/${TASK_ID}" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
      \"status\": \"failed\",
      \"error_message\": \"${ERROR_MSG}\",
      \"metadata\": {
        \"error_log\": \"${ERROR_LOG}\",
        \"failed_at\": \"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\"
      }
    }" > /dev/null
fi
```

---

## Best Practices

1. **Always send heartbeats** - Keep session alive with 60-second heartbeats
2. **Capture error context** - Store detailed error messages for debugging
3. **Use meaningful task names** - Make task purposes clear
4. **Set timestamps** - Include when events occurred
5. **Monitor health** - Periodically check session health
6. **Handle failures gracefully** - Use recovery workflows
7. **Clean up on exit** - Always mark session complete
8. **Use metadata** - Store additional context for future analysis

---

## See Also

- `/docs/mcp-migration-guide.md` - Complete migration guide
- `/examples/mcp-tools/create-project.md` - Creating projects
- `/examples/mcp-tools/update-issue.md` - Updating issues
- `/examples/mcp-tools/move-issue.md` - Moving between phases
