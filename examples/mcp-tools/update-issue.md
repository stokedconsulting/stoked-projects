# MCP Tools: Issue Update Examples

This document provides Claude prompts and code examples for updating issue status and task progress using MCP Tools.

---

## Claude Prompt: Update Issue Status

```
I need to update the status of several GitHub issues that were worked on during this session.

Current status:
- Issue #10: In progress (needs to mark as completed)
- Issue #15: Blocked (needs error details)
- Issue #23: Ready for review (needs to mark as completed)

For the MCP Tools State Tracking API:
1. Use the session ID: 550e8400-e29b-41d4-a716-446655440000
2. For each task associated with these issues:
   - Get the task ID from the API
   - Update the task status via PATCH /api/tasks/{taskId}
   - Include completion timestamps

Use my API key from the MCP_API_KEY environment variable.

Provide:
- cURL commands for each status update
- Expected API responses
- How to verify updates in the system
```

---

## Example: Update Task Status

### Mark Task as In Progress

```bash
# Update task status to in_progress
curl -X PATCH https://claude-projects.truapi.com/api/tasks/660f9511-f41d-52e5-b826-557766551111 \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in_progress",
    "metadata": {
      "started_at": "2026-01-20T10:35:00Z"
    }
  }'

# Response:
# {
#   "task_id": "660f9511-f41d-52e5-b826-557766551111",
#   "session_id": "550e8400-e29b-41d4-a716-446655440000",
#   "status": "in_progress",
#   "started_at": "2026-01-20T10:35:00Z",
#   "updated_at": "2026-01-20T10:35:00Z"
# }
```

### Mark Task as Completed

```bash
curl -X PATCH https://claude-projects.truapi.com/api/tasks/660f9511-f41d-52e5-b826-557766551111 \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "metadata": {
      "completed_at": "2026-01-20T10:45:00Z",
      "completion_notes": "Task completed successfully"
    }
  }'

# Response:
# {
#   "task_id": "660f9511-f41d-52e5-b826-557766551111",
#   "session_id": "550e8400-e29b-41d4-a716-446655440000",
#   "status": "completed",
#   "started_at": "2026-01-20T10:35:00Z",
#   "completed_at": "2026-01-20T10:45:00Z",
#   "updated_at": "2026-01-20T10:45:00Z"
# }
```

### Mark Task as Failed with Error

```bash
curl -X PATCH https://claude-projects.truapi.com/api/tasks/660f9511-f41d-52e5-b826-557766551111 \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "failed",
    "error_message": "Database connection timeout during migration",
    "metadata": {
      "error_type": "timeout",
      "error_code": "DATABASE_TIMEOUT",
      "retry_count": 3,
      "failed_at": "2026-01-20T10:45:00Z"
    }
  }'

# Response:
# {
#   "task_id": "660f9511-f41d-52e5-b826-557766551111",
#   "session_id": "550e8400-e29b-41d4-a716-446655440000",
#   "status": "failed",
#   "error_message": "Database connection timeout during migration",
#   "started_at": "2026-01-20T10:35:00Z",
#   "completed_at": "2026-01-20T10:45:00Z",
#   "updated_at": "2026-01-20T10:45:00Z"
# }
```

### Mark Task as Blocked

```bash
curl -X PATCH https://claude-projects.truapi.com/api/tasks/660f9511-f41d-52e5-b826-557766551111 \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "blocked",
    "metadata": {
      "blocked_reason": "Waiting for code review on PR #456",
      "blocked_since": "2026-01-20T10:45:00Z",
      "blocked_by": ["task-xyz"]
    }
  }'

# Response:
# {
#   "task_id": "660f9511-f41d-52e5-b826-557766551111",
#   "status": "blocked",
#   "metadata": {
#     "blocked_reason": "Waiting for code review on PR #456",
#     ...
#   }
# }
```

---

## Example: Bash Script for Bulk Issue Updates

```bash
#!/bin/bash
#
# update-issues.sh - Update multiple GitHub issues via MCP Tools
#
# Usage:
#   ./update-issues.sh --session SESSION_ID \
#     --issue 10:completed \
#     --issue 15:failed \
#     --issue 23:completed
#

set -e

API_BASE="${MCP_API_BASE:-https://claude-projects.truapi.com}"
API_KEY="${MCP_API_KEY}"
SESSION_ID=""
declare -A ISSUE_UPDATES

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --session)
      SESSION_ID="$2"
      shift 2
      ;;
    --issue)
      ISSUE_SPEC="$2"
      ISSUE_NUM="${ISSUE_SPEC%:*}"
      ISSUE_STATUS="${ISSUE_SPEC#*:}"
      ISSUE_UPDATES["$ISSUE_NUM"]="$ISSUE_STATUS"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Validate inputs
if [[ -z "$SESSION_ID" ]]; then
  echo "Error: --session is required"
  exit 1
fi

if [[ -z "$API_KEY" ]]; then
  echo "Error: MCP_API_KEY environment variable not set"
  exit 1
fi

if [[ ${#ISSUE_UPDATES[@]} -eq 0 ]]; then
  echo "Error: No issues specified (use --issue NUM:STATUS)"
  exit 1
fi

# Function to get tasks by session
get_session_tasks() {
  curl -s -X GET "${API_BASE}/api/tasks?session_id=${SESSION_ID}&limit=100" \
    -H "X-API-Key: ${API_KEY}"
}

# Function to find task by issue ID
find_task_by_issue() {
  local issue_id=$1
  local tasks=$2

  echo "$tasks" | jq -r ".[] | select(.github_issue_id == \"${issue_id}\") | .task_id" | head -1
}

# Function to update task status
update_task_status() {
  local task_id=$1
  local status=$2

  curl -s -X PATCH "${API_BASE}/api/tasks/${task_id}" \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
      \"status\": \"${status}\",
      \"metadata\": {
        \"updated_at\": \"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\",
        \"github_issue_id\": \"${issue_id}\"
      }
    }"
}

echo "📋 Updating issues for session: $SESSION_ID"
echo "────────────────────────────────────────────"

# Fetch all tasks for this session
echo "Fetching tasks from session..."
TASKS=$(get_session_tasks)

# Update each issue
UPDATED_COUNT=0
FAILED_COUNT=0

for ISSUE_NUM in "${!ISSUE_UPDATES[@]}"; do
  STATUS="${ISSUE_UPDATES[$ISSUE_NUM]}"

  echo -n "Issue #$ISSUE_NUM → $STATUS ... "

  # Find the task associated with this issue
  TASK_ID=$(find_task_by_issue "$ISSUE_NUM" "$TASKS")

  if [[ -z "$TASK_ID" ]] || [[ "$TASK_ID" == "null" ]]; then
    echo "❌ Task not found"
    ((FAILED_COUNT++))
    continue
  fi

  # Update the task
  RESPONSE=$(update_task_status "$TASK_ID" "$STATUS")
  UPDATED_STATUS=$(echo "$RESPONSE" | jq -r '.status' 2>/dev/null || echo "error")

  if [[ "$UPDATED_STATUS" == "$STATUS" ]]; then
    echo "✅"
    ((UPDATED_COUNT++))
  else
    echo "❌"
    echo "  Error: $RESPONSE"
    ((FAILED_COUNT++))
  fi
done

echo "────────────────────────────────────────────"
echo "Results: $UPDATED_COUNT updated, $FAILED_COUNT failed"
```

---

## Example: Python Script for Issue Updates

```python
#!/usr/bin/env python3
"""
update_issues.py - Update multiple GitHub issues via MCP Tools
"""

import json
import os
import requests
import sys
from datetime import datetime

API_BASE = os.getenv('MCP_API_BASE', 'https://claude-projects.truapi.com')
API_KEY = os.getenv('MCP_API_KEY')

if not API_KEY:
    print('Error: MCP_API_KEY environment variable not set', file=sys.stderr)
    sys.exit(1)

class MCPClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update({
            'X-API-Key': api_key,
            'Content-Type': 'application/json',
        })

    def get_session_tasks(self, session_id: str):
        """Get all tasks for a session"""
        response = self.session.get(
            f'{self.base_url}/api/tasks?session_id={session_id}&limit=100',
        )

        if response.status_code != 200:
            raise Exception(f'Failed to get tasks: {response.text}')

        return response.json()

    def find_task_by_issue(self, tasks: list, issue_id: str) -> str:
        """Find task ID by GitHub issue ID"""
        for task in tasks:
            if task.get('github_issue_id') == str(issue_id):
                return task['task_id']
        return None

    def update_task_status(self, task_id: str, status: str, error_message: str = None):
        """Update task status"""
        data = {
            'status': status,
            'metadata': {
                'updated_at': datetime.utcnow().isoformat(),
            },
        }

        if error_message:
            data['error_message'] = error_message

        response = self.session.patch(
            f'{self.base_url}/api/tasks/{task_id}',
            json=data,
        )

        if response.status_code != 200:
            raise Exception(f'Failed to update task: {response.text}')

        return response.json()


def update_issues(session_id: str, issue_updates: dict):
    """Update multiple GitHub issues"""
    client = MCPClient(API_BASE, API_KEY)

    try:
        print(f'\n📋 Updating issues for session: {session_id}\n')

        # Get tasks for this session
        print('Fetching tasks from session...')
        tasks_response = client.get_session_tasks(session_id)
        tasks = tasks_response.get('data', [])

        if not tasks:
            print('⚠ No tasks found for this session')
            return

        # Update each issue
        updated_count = 0
        failed_count = 0

        for issue_num, update_info in issue_updates.items():
            status = update_info.get('status')
            error_message = update_info.get('error_message')

            print(f'Issue #{issue_num} → {status} ... ', end='', flush=True)

            # Find the task for this issue
            task_id = client.find_task_by_issue(tasks, issue_num)

            if not task_id:
                print('❌ Task not found')
                failed_count += 1
                continue

            try:
                # Update the task
                result = client.update_task_status(
                    task_id,
                    status,
                    error_message,
                )

                if result.get('status') == status:
                    print('✅')
                    updated_count += 1
                else:
                    print('❌ Status mismatch')
                    failed_count += 1

            except Exception as e:
                print(f'❌ {e}')
                failed_count += 1

        # Summary
        print(f'\n────────────────────────────────')
        print(f'Results: {updated_count} updated, {failed_count} failed')

    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Update GitHub issues via MCP Tools')
    parser.add_argument('--session', required=True, help='Session ID')
    parser.add_argument(
        '--update',
        nargs='+',
        required=True,
        help='Issue updates (format: ISSUE_NUM:STATUS or ISSUE_NUM:STATUS:ERROR_MESSAGE)',
    )

    args = parser.parse_args()

    # Parse updates
    issue_updates = {}
    for update_str in args.update:
        parts = update_str.split(':')
        issue_num = parts[0]
        status = parts[1] if len(parts) > 1 else 'completed'
        error_message = parts[2] if len(parts) > 2 else None

        issue_updates[issue_num] = {
            'status': status,
            'error_message': error_message,
        }

    update_issues(args.session, issue_updates)
```

---

## Example: Node.js Implementation

```javascript
// update-issues.js - Update GitHub issues via MCP Tools

const https = require('https');

const API_BASE = process.env.MCP_API_BASE || 'https://claude-projects.truapi.com';
const API_KEY = process.env.MCP_API_KEY;

if (!API_KEY) {
  console.error('Error: MCP_API_KEY environment variable not set');
  process.exit(1);
}

async function apiCall(method, endpoint, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}${endpoint}`);
    const options = {
      method,
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(url, options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(body),
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: body,
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function findTaskByIssue(tasks, issueId) {
  const task = tasks.find((t) => t.github_issue_id === issueId.toString());
  return task ? task.task_id : null;
}

async function updateIssues(sessionId, issueUpdates) {
  try {
    console.log(`\n📋 Updating issues for session: ${sessionId}\n`);

    // Get tasks for this session
    console.log('Fetching tasks from session...');
    const tasksResponse = await apiCall('GET', `/api/tasks?session_id=${sessionId}&limit=100`);

    if (tasksResponse.status !== 200) {
      throw new Error(`Failed to get tasks: ${JSON.stringify(tasksResponse.data)}`);
    }

    const tasks = tasksResponse.data;

    if (tasks.length === 0) {
      console.log('⚠ No tasks found for this session');
      return;
    }

    // Update each issue
    let updatedCount = 0;
    let failedCount = 0;

    for (const [issueNum, updateInfo] of Object.entries(issueUpdates)) {
      const { status, errorMessage } = updateInfo;

      process.stdout.write(`Issue #${issueNum} → ${status} ... `);

      // Find the task for this issue
      const taskId = await findTaskByIssue(tasks, issueNum);

      if (!taskId) {
        console.log('❌ Task not found');
        failedCount++;
        continue;
      }

      try {
        // Update the task
        const updateData = {
          status,
          metadata: {
            updated_at: new Date().toISOString(),
          },
        };

        if (errorMessage) {
          updateData.error_message = errorMessage;
        }

        const result = await apiCall('PATCH', `/api/tasks/${taskId}`, updateData);

        if (result.status === 200 && result.data.status === status) {
          console.log('✅');
          updatedCount++;
        } else {
          console.log('❌ Status mismatch');
          failedCount++;
        }
      } catch (error) {
        console.log(`❌ ${error.message}`);
        failedCount++;
      }
    }

    // Summary
    console.log(`\n────────────────────────────────`);
    console.log(`Results: ${updatedCount} updated, ${failedCount} failed`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  const sessionId = process.argv[2];
  const updates = process.argv.slice(3);

  if (!sessionId || updates.length === 0) {
    console.error('Usage: node update-issues.js SESSION_ID ISSUE_NUM:STATUS [ISSUE_NUM:STATUS ...]');
    process.exit(1);
  }

  const issueUpdates = {};
  for (const update of updates) {
    const [issueNum, status, errorMessage] = update.split(':');
    issueUpdates[issueNum] = {
      status: status || 'completed',
      errorMessage: errorMessage || null,
    };
  }

  updateIssues(sessionId, issueUpdates);
}

module.exports = { updateIssues, apiCall };
```

---

## Quick Reference

### Update Task to In Progress
```bash
curl -X PATCH https://claude-projects.truapi.com/api/tasks/TASK_ID \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}'
```

### Mark Task Completed
```bash
curl -X PATCH https://claude-projects.truapi.com/api/tasks/TASK_ID \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

### Mark Task Failed
```bash
curl -X PATCH https://claude-projects.truapi.com/api/tasks/TASK_ID \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "failed",
    "error_message": "Error description here"
  }'
```

### Get All Tasks for Session
```bash
curl -X GET "https://claude-projects.truapi.com/api/tasks?session_id=SESSION_ID" \
  -H "X-API-Key: ${MCP_API_KEY}"
```

---

## See Also

- `/docs/mcp-migration-guide.md` - Complete migration guide
- `/examples/mcp-tools/create-project.md` - Create project sessions
- `/examples/mcp-tools/move-issue.md` - Move issues between phases
- `/examples/mcp-tools/project-workflow.md` - Complete workflow examples
