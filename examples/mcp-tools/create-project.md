# MCP Tools: Project Creation Examples

This document provides Claude prompts and code examples for creating and initializing projects using MCP Tools (State Tracking API).

## Overview

Project creation in the MCP Tools approach involves:
1. **Creating a session** - Register orchestration session with the API
2. **Initializing machine** - Register the execution machine (if needed)
3. **Creating tasks** - Define work items to be tracked
4. **Starting heartbeat** - Send periodic alive signals

---

## Claude Prompt: Simple Project Setup

```
I need to set up a new Claude Project with the following details:
- Project ID: 72
- Project name: Build Claude Projects State Tracking API
- Machine: my-development-machine
- Tasks to track:
  1. Initialize project structure
  2. Set up database schema
  3. Implement API endpoints
  4. Deploy to production

Use the MCP Tools State Tracking API at https://claude-projects.truapi.com to:
1. Create a session for this project
2. Create task entries for each work item
3. Set up heartbeat monitoring every 60 seconds

Use my API key from the MCP_API_KEY environment variable.

Please provide:
- The session ID for this project
- Shell script with heartbeat implementation
- cURL commands to track each task
```

---

## Example: Bash Script for Project Creation

```bash
#!/bin/bash
#
# create-project-session.sh - Initialize MCP Tools tracking for a new project
#
# Usage:
#   ./create-project-session.sh --project 72 --name "My Project" --task "Task 1" --task "Task 2"
#

set -e

# Configuration
API_BASE="${MCP_API_BASE:-https://claude-projects.truapi.com}"
API_KEY="${MCP_API_KEY}"
PROJECT_ID=""
PROJECT_NAME=""
MACHINE_ID="$(hostname)"
TASKS=()

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --project)
      PROJECT_ID="$2"
      shift 2
      ;;
    --name)
      PROJECT_NAME="$2"
      shift 2
      ;;
    --task)
      TASKS+=("$2")
      shift 2
      ;;
    --machine)
      MACHINE_ID="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Validate inputs
if [[ -z "$PROJECT_ID" ]]; then
  echo -e "${RED}Error: --project is required${NC}"
  exit 1
fi

if [[ -z "$API_KEY" ]]; then
  echo -e "${RED}Error: MCP_API_KEY environment variable not set${NC}"
  exit 1
fi

# Helper function: make API call with error handling
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

# Step 1: Create session
echo -e "${BLUE}Step 1: Creating project session...${NC}"

SESSION_RESPONSE=$(api_call POST "/api/sessions" "{
  \"project_id\": \"${PROJECT_ID}\",
  \"machine_id\": \"${MACHINE_ID}\",
  \"metadata\": {
    \"project_name\": \"${PROJECT_NAME}\",
    \"created_at\": \"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\",
    \"created_by\": \"${USER}\",
    \"environment\": \"production\"
  }
}")

SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.session_id')

if [[ -z "$SESSION_ID" ]] || [[ "$SESSION_ID" == "null" ]]; then
  echo -e "${RED}Failed to create session:${NC}"
  echo "$SESSION_RESPONSE" | jq '.'
  exit 1
fi

echo -e "${GREEN}✓ Session created: $SESSION_ID${NC}"

# Step 2: Create tasks
if [[ ${#TASKS[@]} -gt 0 ]]; then
  echo -e "${BLUE}Step 2: Creating task entries...${NC}"

  TASK_IDS=()

  for i in "${!TASKS[@]}"; do
    TASK_NAME="${TASKS[$i]}"
    TASK_RESPONSE=$(api_call POST "/api/tasks" "{
      \"session_id\": \"${SESSION_ID}\",
      \"project_id\": \"${PROJECT_ID}\",
      \"task_name\": \"${TASK_NAME}\",
      \"metadata\": {
        \"task_number\": $((i + 1)),
        \"total_tasks\": ${#TASKS[@]},
        \"priority\": \"medium\"
      }
    }")

    TASK_ID=$(echo "$TASK_RESPONSE" | jq -r '.task_id')

    if [[ -z "$TASK_ID" ]] || [[ "$TASK_ID" == "null" ]]; then
      echo -e "${YELLOW}Warning: Failed to create task '$TASK_NAME'${NC}"
      continue
    fi

    TASK_IDS+=("$TASK_ID")
    echo -e "${GREEN}  ✓ Task created: $TASK_NAME ($TASK_ID)${NC}"
  done
else
  echo -e "${YELLOW}No tasks specified${NC}"
fi

# Step 3: Output session information
echo -e "\n${BLUE}Project Session Initialized${NC}"
echo "────────────────────────────────────────────────────"
echo -e "Project ID:   ${GREEN}${PROJECT_ID}${NC}"
echo -e "Session ID:   ${GREEN}${SESSION_ID}${NC}"
echo -e "Machine ID:   ${GREEN}${MACHINE_ID}${NC}"
echo -e "Tasks:        ${GREEN}${#TASK_IDS[@]}${NC}"
echo "────────────────────────────────────────────────────"

# Step 4: Output heartbeat script
echo -e "\n${BLUE}Save this script to send heartbeats:${NC}"
cat > ".claude-session-heartbeat.sh" << HEARTBEAT_SCRIPT
#!/bin/bash
# Auto-generated heartbeat script for session ${SESSION_ID}

API_BASE="${API_BASE}"
API_KEY="${API_KEY}"
SESSION_ID="${SESSION_ID}"

while true; do
  curl -s -X POST "\${API_BASE}/api/sessions/\${SESSION_ID}/heartbeat" \\
    -H "X-API-Key: \${API_KEY}" \\
    -H "Content-Type: application/json" \\
    -d '{}' > /dev/null

  echo "[heartbeat] Sent heartbeat for session \${SESSION_ID}"
  sleep 60
done
HEARTBEAT_SCRIPT

chmod +x ".claude-session-heartbeat.sh"
echo -e "${GREEN}Created: .claude-session-heartbeat.sh${NC}"

# Step 5: Output session file for reference
echo -e "\n${BLUE}Saving session information to file...${NC}"
cat > ".claude-session-${SESSION_ID}.json" << SESSION_FILE
{
  "session_id": "${SESSION_ID}",
  "project_id": "${PROJECT_ID}",
  "machine_id": "${MACHINE_ID}",
  "project_name": "${PROJECT_NAME}",
  "created_at": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "api_base": "${API_BASE}",
  "tasks": [
$(for TASK_ID in "${TASK_IDS[@]}"; do
  echo "    \"${TASK_ID}\","
done | sed '$ s/,$//')
  ]
}
SESSION_FILE

echo -e "${GREEN}Created: .claude-session-${SESSION_ID}.json${NC}"

# Step 6: Display next steps
echo -e "\n${BLUE}Next Steps:${NC}"
echo "1. Start heartbeat monitoring:"
echo -e "   ${YELLOW}nohup ./.claude-session-heartbeat.sh > heartbeat.log &${NC}"
echo ""
echo "2. Monitor session health:"
echo -e "   ${YELLOW}curl -X GET '${API_BASE}/api/sessions/${SESSION_ID}/health' \\${NC}"
echo -e "   ${YELLOW}  -H \"X-API-Key: \${MCP_API_KEY}\"${NC}"
echo ""
echo "3. Update task status:"
echo -e "   ${YELLOW}curl -X PATCH '${API_BASE}/api/tasks/TASK_ID' \\${NC}"
echo -e "   ${YELLOW}  -H \"X-API-Key: \${MCP_API_KEY}\" \\${NC}"
echo -e "   ${YELLOW}  -H \"Content-Type: application/json\" \\${NC}"
echo -e "   ${YELLOW}  -d '{\"status\": \"in_progress\"}'${NC}"
echo ""
echo "4. Check overall health:"
echo -e "   ${YELLOW}curl -X GET '${API_BASE}/api/sessions/health' \\${NC}"
echo -e "   ${YELLOW}  -H \"X-API-Key: \${MCP_API_KEY}\"${NC}"
echo ""
echo "5. When complete:"
echo -e "   ${YELLOW}curl -X PATCH '${API_BASE}/api/sessions/${SESSION_ID}' \\${NC}"
echo -e "   ${YELLOW}  -H \"X-API-Key: \${MCP_API_KEY}\" \\${NC}"
echo -e "   ${YELLOW}  -H \"Content-Type: application/json\" \\${NC}"
echo -e "   ${YELLOW}  -d '{\"status\": \"completed\"}'${NC}"
echo ""
echo "Documentation: See docs/mcp-migration-guide.md"
```

---

## Example: Node.js Implementation

```javascript
// create-project-session.js
// Initialize MCP Tools tracking using Node.js

const https = require('https');
const { v4: uuidv4 } = require('uuid');

const API_BASE = process.env.MCP_API_BASE || 'https://claude-projects.truapi.com';
const API_KEY = process.env.MCP_API_KEY;

if (!API_KEY) {
  console.error('Error: MCP_API_KEY environment variable not set');
  process.exit(1);
}

// Helper function to make API calls
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

// Main function
async function createProjectSession(projectId, projectName, tasks = []) {
  try {
    console.log('\n📋 Creating Project Session...\n');

    // Step 1: Create session
    console.log('Step 1: Creating session...');
    const sessionResponse = await apiCall('POST', '/api/sessions', {
      project_id: projectId.toString(),
      machine_id: require('os').hostname(),
      metadata: {
        project_name: projectName,
        created_at: new Date().toISOString(),
        environment: 'production',
      },
    });

    if (sessionResponse.status !== 201) {
      throw new Error(`Failed to create session: ${JSON.stringify(sessionResponse.data)}`);
    }

    const sessionId = sessionResponse.data.session_id;
    console.log(`✓ Session created: ${sessionId}\n`);

    // Step 2: Create tasks
    const taskIds = [];

    if (tasks.length > 0) {
      console.log('Step 2: Creating tasks...');

      for (let i = 0; i < tasks.length; i++) {
        const taskName = tasks[i];
        const taskResponse = await apiCall('POST', '/api/tasks', {
          session_id: sessionId,
          project_id: projectId.toString(),
          task_name: taskName,
          metadata: {
            task_number: i + 1,
            total_tasks: tasks.length,
            priority: 'medium',
          },
        });

        if (taskResponse.status !== 201) {
          console.warn(`⚠ Failed to create task "${taskName}"`);
          continue;
        }

        const taskId = taskResponse.data.task_id;
        taskIds.push(taskId);
        console.log(`✓ Task created: ${taskName} (${taskId})`);
      }
    }

    // Step 3: Start heartbeat
    console.log('\nStep 3: Starting heartbeat monitor...');

    const heartbeatInterval = setInterval(async () => {
      try {
        await apiCall('POST', `/api/sessions/${sessionId}/heartbeat`, {});
        console.log(`[${new Date().toISOString()}] Heartbeat sent`);
      } catch (error) {
        console.error(`Heartbeat failed: ${error.message}`);
      }
    }, 60000); // 60 seconds

    // Handle cleanup on exit
    process.on('SIGINT', async () => {
      console.log('\n\nCleaning up...');
      clearInterval(heartbeatInterval);

      // Mark session as completed
      const completeResponse = await apiCall('PATCH', `/api/sessions/${sessionId}`, {
        status: 'completed',
      });

      if (completeResponse.status === 200) {
        console.log('✓ Session marked as completed');
      }

      process.exit(0);
    });

    // Output session info
    console.log(`\n📊 Project Session Initialized\n`);
    console.log(`Project ID:   ${projectId}`);
    console.log(`Session ID:   ${sessionId}`);
    console.log(`Tasks:        ${taskIds.length}`);
    console.log(`\nHeartbeat:    Active (every 60 seconds)`);
    console.log('\n✓ Project session is ready for work\n');

    return {
      sessionId,
      projectId,
      taskIds,
      heartbeatInterval,
    };
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  const projectId = process.argv[2] || '72';
  const projectName = process.argv[3] || 'Claude Project';
  const tasks = process.argv.slice(4);

  createProjectSession(projectId, projectName, tasks);
}

module.exports = { createProjectSession, apiCall };
```

---

## Example: Python Implementation

```python
#!/usr/bin/env python3
"""
create_project_session.py - Initialize MCP Tools tracking for a project
"""

import json
import os
import requests
import time
import signal
import sys
from datetime import datetime
from typing import List, Optional

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

    def create_session(self, project_id: str, machine_id: str, metadata: dict = None) -> str:
        """Create a new project session"""
        data = {
            'project_id': project_id,
            'machine_id': machine_id,
            'metadata': metadata or {},
        }

        response = self.session.post(
            f'{self.base_url}/api/sessions',
            json=data,
        )

        if response.status_code != 201:
            raise Exception(f'Failed to create session: {response.text}')

        return response.json()['session_id']

    def create_task(self, session_id: str, project_id: str, task_name: str) -> str:
        """Create a new task"""
        data = {
            'session_id': session_id,
            'project_id': project_id,
            'task_name': task_name,
        }

        response = self.session.post(
            f'{self.base_url}/api/tasks',
            json=data,
        )

        if response.status_code != 201:
            raise Exception(f'Failed to create task: {response.text}')

        return response.json()['task_id']

    def send_heartbeat(self, session_id: str) -> dict:
        """Send heartbeat for session"""
        response = self.session.post(
            f'{self.base_url}/api/sessions/{session_id}/heartbeat',
            json={},
        )

        if response.status_code != 200:
            raise Exception(f'Failed to send heartbeat: {response.text}')

        return response.json()

    def get_session_health(self, session_id: str) -> dict:
        """Get session health status"""
        response = self.session.get(
            f'{self.base_url}/api/sessions/{session_id}/health',
        )

        if response.status_code != 200:
            raise Exception(f'Failed to get health: {response.text}')

        return response.json()

    def complete_session(self, session_id: str) -> dict:
        """Mark session as completed"""
        response = self.session.patch(
            f'{self.base_url}/api/sessions/{session_id}',
            json={'status': 'completed'},
        )

        if response.status_code != 200:
            raise Exception(f'Failed to complete session: {response.text}')

        return response.json()


def create_project_session(project_id: str, project_name: str, tasks: List[str]):
    """Main function to create and manage a project session"""
    import socket

    client = MCPClient(API_BASE, API_KEY)
    machine_id = socket.gethostname()

    try:
        print('\n📋 Creating Project Session...\n')

        # Step 1: Create session
        print('Step 1: Creating session...')
        session_id = client.create_session(
            project_id=project_id,
            machine_id=machine_id,
            metadata={
                'project_name': project_name,
                'created_at': datetime.utcnow().isoformat(),
                'environment': 'production',
            },
        )
        print(f'✓ Session created: {session_id}\n')

        # Step 2: Create tasks
        task_ids = []
        if tasks:
            print('Step 2: Creating tasks...')
            for i, task_name in enumerate(tasks):
                try:
                    task_id = client.create_task(
                        session_id=session_id,
                        project_id=project_id,
                        task_name=task_name,
                    )
                    task_ids.append(task_id)
                    print(f'✓ Task created: {task_name} ({task_id})')
                except Exception as e:
                    print(f'⚠ Failed to create task "{task_name}": {e}')

        # Step 3: Start heartbeat
        print('\nStep 3: Starting heartbeat monitor...')

        def send_heartbeats():
            """Send heartbeats every 60 seconds"""
            try:
                while True:
                    client.send_heartbeat(session_id)
                    print(f'[{datetime.utcnow().isoformat()}] Heartbeat sent')
                    time.sleep(60)
            except KeyboardInterrupt:
                pass

        def handle_exit(sig, frame):
            """Handle graceful shutdown"""
            print('\n\nCleaning up...')
            try:
                client.complete_session(session_id)
                print('✓ Session marked as completed')
            except Exception as e:
                print(f'⚠ Failed to complete session: {e}')
            sys.exit(0)

        signal.signal(signal.SIGINT, handle_exit)

        # Output session info
        print(f'\n📊 Project Session Initialized\n')
        print(f'Project ID:   {project_id}')
        print(f'Session ID:   {session_id}')
        print(f'Tasks:        {len(task_ids)}')
        print(f'\nHeartbeat:    Active (every 60 seconds)')
        print('\n✓ Project session is ready for work\n')

        # Run heartbeat sender
        send_heartbeats()

    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Create MCP Tools project session')
    parser.add_argument('--project', default='72', help='Project ID')
    parser.add_argument('--name', default='Claude Project', help='Project name')
    parser.add_argument('--tasks', nargs='+', default=[], help='Task names')

    args = parser.parse_args()

    create_project_session(args.project, args.name, args.tasks)
```

---

## Quick Reference

### Create a Session

```bash
curl -X POST https://claude-projects.truapi.com/api/sessions \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "72",
    "machine_id": "my-machine",
    "metadata": {"project_name": "My Project"}
  }'
```

### Create a Task

```bash
curl -X POST https://claude-projects.truapi.com/api/tasks \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "project_id": "72",
    "task_name": "My Task"
  }'
```

### Send Heartbeat

```bash
curl -X POST https://claude-projects.truapi.com/api/sessions/550e8400-e29b-41d4-a716-446655440000/heartbeat \
  -H "X-API-Key: ${MCP_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Check Health

```bash
curl -X GET https://claude-projects.truapi.com/api/sessions/health \
  -H "X-API-Key: ${MCP_API_KEY}"
```

---

## See Also

- `/docs/mcp-migration-guide.md` - Complete migration guide
- `/examples/mcp-tools/update-issue.md` - Update issue status
- `/examples/mcp-tools/move-issue.md` - Move issues between phases
- `/examples/mcp-tools/project-workflow.md` - Complete workflow examples
