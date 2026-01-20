# MCP Tools: Move Issues Between Phases

This document provides Claude prompts and code examples for moving GitHub issues between project phases using MCP Tools.

---

## Claude Prompt: Move Issues Between Phases

```
I need to move multiple GitHub issues between project phases as we complete work.

Current project structure:
- Project #72: Claude Projects State Tracking API
- Phases: Planning → In Progress → Review → Done

Issues to move:
1. Issue #5 (database schema) - from "In Progress" to "Review"
2. Issue #10 (API endpoints) - from "In Progress" to "Review"
3. Issue #15 (deployment) - from "Planning" to "In Progress"

Using MCP Tools State Tracking API:
1. Get the session ID for this project
2. Get the task IDs associated with each issue
3. Update task status to reflect phase movement
4. Also update GitHub project status if needed

Provide:
- cURL commands to move each issue
- How to verify phase movements
- Best practices for coordinating with GitHub Projects
```

---

## Understanding Phase Movements

### Phase Structure

```
Planning → In Progress → Review → Done
  ↓           ↓           ↓       ↓
pending    in_progress   (review) completed
```

### Status Mapping

| Phase | Task Status | Notes |
|-------|------------|-------|
| Planning | `pending` | Issue created but not started |
| In Progress | `in_progress` | Active work happening |
| Review | `in_progress` + metadata | Task still active, awaiting approval |
| Done | `completed` | Task finished and approved |

---

## Example: Moving Issues Between Phases

### Phase 1: Planning → In Progress

```bash
#!/bin/bash
# Move issue from Planning to In Progress

SESSION_ID="550e8400-e29b-41d4-a716-446655440000"
TASK_ID="660f9511-f41d-52e5-b826-557766551111"
ISSUE_NUMBER="15"

echo "Moving issue #${ISSUE_NUMBER} from Planning → In Progress..."

# Update task status
curl -X PATCH https://claude-projects.truapi.com/api/tasks/${TASK_ID} \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in_progress",
    "metadata": {
      "phase": "In Progress",
      "phase_changed_at": "2026-01-20T10:30:00Z",
      "previous_phase": "Planning",
      "started_by": "claude"
    }
  }'

echo "✓ Issue #${ISSUE_NUMBER} moved to In Progress"
```

### Phase 2: In Progress → Review

```bash
#!/bin/bash
# Move issue from In Progress to Review (still in_progress status)

SESSION_ID="550e8400-e29b-41d4-a716-446655440000"
TASK_ID="660f9511-f41d-52e5-b826-557766551111"
ISSUE_NUMBER="5"

echo "Moving issue #${ISSUE_NUMBER} from In Progress → Review..."

curl -X PATCH https://claude-projects.truapi.com/api/tasks/${TASK_ID} \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in_progress",
    "metadata": {
      "phase": "Review",
      "phase_changed_at": "2026-01-20T14:30:00Z",
      "previous_phase": "In Progress",
      "awaiting_review": true,
      "review_started_by": "claude",
      "pull_request": "#456"
    }
  }'

echo "✓ Issue #${ISSUE_NUMBER} moved to Review"
```

### Phase 3: Review → Done

```bash
#!/bin/bash
# Move issue from Review to Done (mark completed)

SESSION_ID="550e8400-e29b-41d4-a716-446655440000"
TASK_ID="660f9511-f41d-52e5-b826-557766551111"
ISSUE_NUMBER="5"

echo "Moving issue #${ISSUE_NUMBER} from Review → Done..."

curl -X PATCH https://claude-projects.truapi.com/api/tasks/${TASK_ID} \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "metadata": {
      "phase": "Done",
      "phase_changed_at": "2026-01-20T15:30:00Z",
      "previous_phase": "Review",
      "completed_by": "claude",
      "merged_pr": "#456",
      "review_comments_addressed": true
    }
  }'

echo "✓ Issue #${ISSUE_NUMBER} moved to Done"
```

---

## Example: Bash Script for Bulk Phase Movements

```bash
#!/bin/bash
#
# move-issues.sh - Move multiple GitHub issues between phases
#
# Usage:
#   ./move-issues.sh --session SESSION_ID \
#     --move 5:Review \
#     --move 10:Review \
#     --move 15:"In Progress"
#

set -e

API_BASE="${MCP_API_BASE:-https://claude-projects.truapi.com}"
API_KEY="${MCP_API_KEY}"
SESSION_ID=""
declare -A ISSUE_PHASES

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --session)
      SESSION_ID="$2"
      shift 2
      ;;
    --move)
      MOVE_SPEC="$2"
      ISSUE_NUM="${MOVE_SPEC%:*}"
      ISSUE_PHASE="${MOVE_SPEC#*:}"
      ISSUE_PHASES["$ISSUE_NUM"]="$ISSUE_PHASE"
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
  echo -e "${RED}Error: --session is required${NC}"
  exit 1
fi

if [[ -z "$API_KEY" ]]; then
  echo -e "${RED}Error: MCP_API_KEY environment variable not set${NC}"
  exit 1
fi

if [[ ${#ISSUE_PHASES[@]} -eq 0 ]]; then
  echo -e "${RED}Error: No issues specified (use --move ISSUE_NUM:PHASE)${NC}"
  exit 1
fi

# Helper function
api_call() {
  local method=$1
  local endpoint=$2
  local data=$3

  if [[ -n "$data" ]]; then
    curl -s -X "$method" "${API_BASE}${endpoint}" \
      -H "X-API-Key: ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d "$data"
  else
    curl -s -X "$method" "${API_BASE}${endpoint}" \
      -H "X-API-Key: ${API_KEY}"
  fi
}

# Get all tasks for session
get_tasks() {
  api_call GET "/api/tasks?session_id=${SESSION_ID}&limit=100"
}

# Find task by issue ID
find_task_by_issue() {
  local issue_id=$1
  local tasks=$2

  echo "$tasks" | jq -r ".[] | select(.github_issue_id == \"${issue_id}\") | .task_id" | head -1
}

# Map phase name to task metadata
get_phase_metadata() {
  local phase=$1

  case "$phase" in
    "Planning")
      echo '{"status": "pending", "phase": "Planning"}'
      ;;
    "In Progress"|"InProgress")
      echo '{"status": "in_progress", "phase": "In Progress"}'
      ;;
    "Review")
      echo '{"status": "in_progress", "phase": "Review", "awaiting_review": true}'
      ;;
    "Done"|"Completed")
      echo '{"status": "completed", "phase": "Done"}'
      ;;
    *)
      echo '{"status": "in_progress", "phase": "'"$phase"'"}'
      ;;
  esac
}

echo -e "${BLUE}📊 Moving Issues Between Phases${NC}"
echo "Session: ${GREEN}${SESSION_ID}${NC}"
echo "────────────────────────────────────────────"

# Fetch tasks
echo "Fetching tasks..."
TASKS=$(get_tasks)

# Move each issue
MOVED_COUNT=0
FAILED_COUNT=0

for ISSUE_NUM in "${!ISSUE_PHASES[@]}"; do
  TARGET_PHASE="${ISSUE_PHASES[$ISSUE_NUM]}"

  echo -n "Issue #$ISSUE_NUM → ${GREEN}$TARGET_PHASE${NC} ... "

  # Find task
  TASK_ID=$(find_task_by_issue "$ISSUE_NUM" "$TASKS")

  if [[ -z "$TASK_ID" ]] || [[ "$TASK_ID" == "null" ]]; then
    echo -e "${RED}❌ Task not found${NC}"
    ((FAILED_COUNT++))
    continue
  fi

  # Get phase metadata
  PHASE_META=$(get_phase_metadata "$TARGET_PHASE")
  NEW_STATUS=$(echo "$PHASE_META" | jq -r '.status')

  # Update task
  RESPONSE=$(api_call PATCH "/api/tasks/${TASK_ID}" "{
    \"status\": \"${NEW_STATUS}\",
    \"metadata\": {
      \"phase\": \"${TARGET_PHASE}\",
      \"phase_changed_at\": \"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\",
      \"moved_by\": \"${USER}\"
    }
  }")

  UPDATED_PHASE=$(echo "$RESPONSE" | jq -r '.metadata.phase' 2>/dev/null || echo "error")

  if [[ "$UPDATED_PHASE" == "$TARGET_PHASE" ]]; then
    echo -e "${GREEN}✓${NC}"
    ((MOVED_COUNT++))
  else
    echo -e "${RED}❌${NC}"
    echo "  Error: $RESPONSE"
    ((FAILED_COUNT++))
  fi
done

echo "────────────────────────────────────────────"
echo -e "Results: ${GREEN}${MOVED_COUNT} moved${NC}, ${RED}${FAILED_COUNT} failed${NC}"
```

---

## Example: Python Script for Phase Movements

```python
#!/usr/bin/env python3
"""
move_issues.py - Move GitHub issues between project phases
"""

import json
import os
import requests
import sys
from datetime import datetime
from enum import Enum

API_BASE = os.getenv('MCP_API_BASE', 'https://claude-projects.truapi.com')
API_KEY = os.getenv('MCP_API_KEY')

if not API_KEY:
    print('Error: MCP_API_KEY environment variable not set', file=sys.stderr)
    sys.exit(1)

class Phase(Enum):
    """Project phases and their corresponding task statuses"""
    PLANNING = ('pending', 'Planning')
    IN_PROGRESS = ('in_progress', 'In Progress')
    REVIEW = ('in_progress', 'Review')
    DONE = ('completed', 'Done')

    @property
    def task_status(self):
        return self.value[0]

    @property
    def phase_name(self):
        return self.value[1]

    @staticmethod
    def from_name(name: str) -> 'Phase':
        """Get Phase enum from string name"""
        name = name.strip().lower().replace(' ', '_')
        for phase in Phase:
            if phase.name.lower() == name or phase.phase_name.lower() == name:
                return phase
        raise ValueError(f'Unknown phase: {name}')

class MCPClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update({
            'X-API-Key': api_key,
            'Content-Type': 'application/json',
        })

    def get_session_tasks(self, session_id: str) -> list:
        """Get all tasks for a session"""
        response = self.session.get(
            f'{self.base_url}/api/tasks?session_id={session_id}&limit=100',
        )

        if response.status_code != 200:
            raise Exception(f'Failed to get tasks: {response.text}')

        return response.json()

    def find_task_by_issue(self, tasks: list, issue_id: str) -> str:
        """Find task by GitHub issue ID"""
        for task in tasks:
            if task.get('github_issue_id') == str(issue_id):
                return task['task_id']
        return None

    def move_issue_to_phase(
        self,
        task_id: str,
        target_phase: Phase,
        previous_phase: Phase = None,
    ) -> dict:
        """Move an issue to a new phase"""
        data = {
            'status': target_phase.task_status,
            'metadata': {
                'phase': target_phase.phase_name,
                'phase_changed_at': datetime.utcnow().isoformat(),
                'moved_by': os.getenv('USER', 'unknown'),
            },
        }

        if previous_phase:
            data['metadata']['previous_phase'] = previous_phase.phase_name

        # Add phase-specific metadata
        if target_phase == Phase.REVIEW:
            data['metadata']['awaiting_review'] = True
        elif target_phase == Phase.DONE:
            data['metadata']['completed_at'] = datetime.utcnow().isoformat()

        response = self.session.patch(
            f'{self.base_url}/api/tasks/{task_id}',
            json=data,
        )

        if response.status_code != 200:
            raise Exception(f'Failed to move issue: {response.text}')

        return response.json()


def move_issues(session_id: str, issue_phases: dict):
    """Move multiple issues between phases"""
    client = MCPClient(API_BASE, API_KEY)

    try:
        print(f'\n📊 Moving Issues Between Phases\n')
        print(f'Session: {session_id}\n')

        # Get tasks
        print('Fetching tasks...')
        tasks = client.get_session_tasks(session_id)

        if not tasks:
            print('⚠ No tasks found for this session')
            return

        # Move each issue
        moved_count = 0
        failed_count = 0

        for issue_num, target_phase_name in issue_phases.items():
            print(f'Issue #{issue_num} → {target_phase_name} ... ', end='', flush=True)

            # Parse target phase
            try:
                target_phase = Phase.from_name(target_phase_name)
            except ValueError as e:
                print(f'❌ {e}')
                failed_count += 1
                continue

            # Find task
            task_id = client.find_task_by_issue(tasks, issue_num)

            if not task_id:
                print('❌ Task not found')
                failed_count += 1
                continue

            try:
                # Move the issue
                result = client.move_issue_to_phase(task_id, target_phase)

                if result.get('metadata', {}).get('phase') == target_phase.phase_name:
                    print('✓')
                    moved_count += 1
                else:
                    print('❌ Phase mismatch')
                    failed_count += 1

            except Exception as e:
                print(f'❌ {e}')
                failed_count += 1

        # Summary
        print(f'\n────────────────────────────────')
        print(f'Results: {moved_count} moved, {failed_count} failed')

    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Move GitHub issues between phases')
    parser.add_argument('--session', required=True, help='Session ID')
    parser.add_argument(
        '--move',
        nargs='+',
        required=True,
        help='Issue movements (format: ISSUE_NUM:PHASE)',
    )

    args = parser.parse_args()

    # Parse movements
    issue_phases = {}
    for move_str in args.move:
        parts = move_str.split(':')
        issue_num = parts[0]
        phase_name = parts[1] if len(parts) > 1 else 'In Progress'

        issue_phases[issue_num] = phase_name

    move_issues(args.session, issue_phases)
```

---

## Example: Node.js Implementation

```javascript
// move-issues.js - Move GitHub issues between project phases

const https = require('https');

const API_BASE = process.env.MCP_API_BASE || 'https://claude-projects.truapi.com';
const API_KEY = process.env.MCP_API_KEY;

if (!API_KEY) {
  console.error('Error: MCP_API_KEY environment variable not set');
  process.exit(1);
}

const PHASES = {
  planning: { taskStatus: 'pending', phaseName: 'Planning' },
  'in-progress': { taskStatus: 'in_progress', phaseName: 'In Progress' },
  review: { taskStatus: 'in_progress', phaseName: 'Review' },
  done: { taskStatus: 'completed', phaseName: 'Done' },
};

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

async function moveIssues(sessionId, issuePhases) {
  try {
    console.log(`\n📊 Moving Issues Between Phases\n`);
    console.log(`Session: ${sessionId}\n`);

    // Get tasks
    console.log('Fetching tasks...');
    const tasksResponse = await apiCall('GET', `/api/tasks?session_id=${sessionId}&limit=100`);

    if (tasksResponse.status !== 200) {
      throw new Error(`Failed to get tasks: ${tasksResponse.data}`);
    }

    const tasks = tasksResponse.data;

    if (tasks.length === 0) {
      console.log('⚠ No tasks found for this session');
      return;
    }

    let movedCount = 0;
    let failedCount = 0;

    for (const [issueNum, phaseName] of Object.entries(issuePhases)) {
      process.stdout.write(`Issue #${issueNum} → ${phaseName} ... `);

      // Find task
      const task = tasks.find((t) => t.github_issue_id === issueNum.toString());

      if (!task) {
        console.log('❌ Task not found');
        failedCount++;
        continue;
      }

      // Get phase configuration
      const phaseKey = phaseName.toLowerCase().replace(' ', '-');
      const phaseConfig = PHASES[phaseKey];

      if (!phaseConfig) {
        console.log('❌ Unknown phase');
        failedCount++;
        continue;
      }

      try {
        // Move the issue
        const moveData = {
          status: phaseConfig.taskStatus,
          metadata: {
            phase: phaseConfig.phaseName,
            phase_changed_at: new Date().toISOString(),
            moved_by: process.env.USER || 'unknown',
          },
        };

        if (phaseConfig.phaseName === 'Review') {
          moveData.metadata.awaiting_review = true;
        } else if (phaseConfig.phaseName === 'Done') {
          moveData.metadata.completed_at = new Date().toISOString();
        }

        const result = await apiCall('PATCH', `/api/tasks/${task.task_id}`, moveData);

        if (result.status === 200 && result.data.metadata.phase === phaseConfig.phaseName) {
          console.log('✓');
          movedCount++;
        } else {
          console.log('❌ Phase mismatch');
          failedCount++;
        }
      } catch (error) {
        console.log(`❌ ${error.message}`);
        failedCount++;
      }
    }

    // Summary
    console.log(`\n────────────────────────────────`);
    console.log(`Results: ${movedCount} moved, ${failedCount} failed`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  const sessionId = process.argv[2];
  const moves = process.argv.slice(3);

  if (!sessionId || moves.length === 0) {
    console.error('Usage: node move-issues.js SESSION_ID ISSUE_NUM:PHASE [ISSUE_NUM:PHASE ...]');
    process.exit(1);
  }

  const issuePhases = {};
  for (const move of moves) {
    const [issueNum, phase] = move.split(':');
    issuePhases[issueNum] = phase || 'In Progress';
  }

  moveIssues(sessionId, issuePhases);
}

module.exports = { moveIssues, apiCall };
```

---

## Quick Reference

### Move Issue to In Progress
```bash
curl -X PATCH https://claude-projects.truapi.com/api/tasks/TASK_ID \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in_progress",
    "metadata": {"phase": "In Progress"}
  }'
```

### Move Issue to Review
```bash
curl -X PATCH https://claude-projects.truapi.com/api/tasks/TASK_ID \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in_progress",
    "metadata": {"phase": "Review", "awaiting_review": true}
  }'
```

### Move Issue to Done
```bash
curl -X PATCH https://claude-projects.truapi.com/api/tasks/TASK_ID \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "metadata": {"phase": "Done"}
  }'
```

### Get Issues in Specific Phase
```bash
# Get all tasks (filter by metadata.phase in application layer)
curl -X GET "https://claude-projects.truapi.com/api/tasks?session_id=SESSION_ID" \
  -H "X-API-Key: ${MCP_API_KEY}"
```

---

## See Also

- `/docs/mcp-migration-guide.md` - Complete migration guide
- `/examples/mcp-tools/create-project.md` - Create project sessions
- `/examples/mcp-tools/update-issue.md` - Update issue status
- `/examples/mcp-tools/project-workflow.md` - Complete workflow examples
