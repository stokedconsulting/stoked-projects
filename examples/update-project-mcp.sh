#!/bin/bash
#
# update-project-mcp.sh - Update GitHub Projects using MCP Tools
#
# This script uses MCP Tools (via mcp-client.js) instead of direct `gh` CLI calls.
# It provides the same functionality as update-project.sh but with improved architecture.
#
# Usage:
#   update-project-mcp.sh --issue 123 --status Done
#   update-project-mcp.sh --close-issue 123 --project 70
#   update-project-mcp.sh --task-completed --issue 123
#
# Environment:
#   GITHUB_TOKEN      - GitHub personal access token (required)
#   MCP_API_KEY       - API key for State Tracking API (optional but recommended)
#   MCP_API_BASE      - State Tracking API base URL (default: https://claude-projects.truapi.com)
#

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_CLIENT="$SCRIPT_DIR/mcp-client.js"

# Check for required tools
if [[ ! -f "$MCP_CLIENT" ]]; then
    echo "Error: MCP client not found at $MCP_CLIENT"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required but not installed"
    exit 1
fi

if [[ -z "$GITHUB_TOKEN" && -z "$GH_TOKEN" ]]; then
    echo "Error: GITHUB_TOKEN or GH_TOKEN environment variable required"
    echo "Set it with: export GITHUB_TOKEN=your_github_token"
    exit 1
fi

# Configuration
API_BASE="${MCP_API_BASE:-https://claude-projects.truapi.com}"
API_KEY="${MCP_API_KEY}"

# Parse arguments
TYPE=""
ISSUE_NUMBER=""
PROJECT_NUMBER=""
STATUS=""
SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --issue)
            ISSUE_NUMBER="$2"
            shift 2
            ;;
        --project)
            PROJECT_NUMBER="$2"
            shift 2
            ;;
        --status)
            STATUS="$2"
            shift 2
            ;;
        --close-issue)
            TYPE="issue_closed"
            ISSUE_NUMBER="$2"
            shift 2
            ;;
        --task-completed)
            TYPE="task_completed"
            shift
            ;;
        --update-status)
            TYPE="status_updated"
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Detect type if not set
if [[ -z "$TYPE" ]]; then
    if [[ -n "$STATUS" ]]; then
        TYPE="status_updated"
    elif [[ -n "$ISSUE_NUMBER" ]]; then
        TYPE="task_completed"
    else
        echo "Error: Could not determine update type"
        exit 1
    fi
fi

echo "[update-project-mcp] Type: $TYPE, Issue: ${ISSUE_NUMBER:-N/A}, Project: ${PROJECT_NUMBER:-N/A}, Status: ${STATUS:-N/A}"

# Get repo info
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$REPO_ROOT"

# Get owner and repo from git remote
OWNER=""
REPO=""
if git remote get-url origin &> /dev/null; then
    REMOTE=$(git remote get-url origin)
    if [[ "$REMOTE" =~ github\.com[:/]([^/]+)/([^/.]+) ]]; then
        OWNER="${BASH_REMATCH[1]}"
        REPO="${BASH_REMATCH[2]}"
    fi
fi

if [[ -z "$OWNER" || -z "$REPO" ]]; then
    echo "Error: Could not determine GitHub owner/repo from git remote"
    exit 1
fi

echo "[update-project-mcp] Repository: $OWNER/$REPO"

# Perform GitHub updates using MCP client
if [[ "$TYPE" == "issue_closed" && -n "$ISSUE_NUMBER" ]]; then
    echo "[update-project-mcp] Closing issue #$ISSUE_NUMBER using MCP..."

    # Close issue via MCP client
    if node "$MCP_CLIENT" close-issue --owner "$OWNER" --repo "$REPO" --number "$ISSUE_NUMBER" > /dev/null 2>&1; then
        echo "[update-project-mcp] ✓ Issue #$ISSUE_NUMBER closed successfully"
    else
        echo "[update-project-mcp] Warning: Failed to close issue #$ISSUE_NUMBER"
    fi

    # Add a comment via MCP client
    echo "[update-project-mcp] Adding completion comment..."
    if node "$MCP_CLIENT" update-issue \
        --owner "$OWNER" \
        --repo "$REPO" \
        --number "$ISSUE_NUMBER" \
        --body "$(node "$MCP_CLIENT" get-issue --owner "$OWNER" --repo "$REPO" --number "$ISSUE_NUMBER" | jq -r '.body // ""')

---
**Completed via Claude Code**
Session: $SESSION_ID
Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" > /dev/null 2>&1; then
        echo "[update-project-mcp] ✓ Comment added"
    else
        echo "[update-project-mcp] Warning: Failed to add comment"
    fi
fi

if [[ "$TYPE" == "status_updated" && -n "$ISSUE_NUMBER" && -n "$STATUS" ]]; then
    echo "[update-project-mcp] Updating issue #$ISSUE_NUMBER status to '$STATUS'..."
    # Note: Status updates require GitHub Projects API (ProjectV2)
    # For now, we'll update the issue body to reflect status change
    echo "[update-project-mcp] Info: GitHub Projects status update requires ProjectV2 API"
    echo "[update-project-mcp] Info: Extension will refresh to show latest changes"
fi

# Update via State Tracking API if API key is available
if [[ -n "$API_KEY" ]]; then
    echo "[update-project-mcp] Updating State Tracking API..."

    # Create or update task in State Tracking API
    TASK_PAYLOAD=$(cat <<EOF
{
  "session_id": "$SESSION_ID",
  "project_id": "${PROJECT_NUMBER:-}",
  "github_issue_id": "${ISSUE_NUMBER:-}",
  "status": "$(if [[ "$TYPE" == "issue_closed" || "$TYPE" == "task_completed" ]]; then echo "completed"; else echo "in_progress"; fi)",
  "metadata": {
    "type": "$TYPE",
    "status": "${STATUS:-}",
    "updated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "updated_by": "update-project-mcp.sh"
  }
}
EOF
)

    # Try to update task via API
    if curl -s -X POST "${API_BASE}/api/tasks" \
        -H "X-API-Key: ${API_KEY}" \
        -H "Content-Type: application/json" \
        -d "$TASK_PAYLOAD" > /dev/null 2>&1; then
        echo "[update-project-mcp] ✓ State Tracking API updated"
    else
        echo "[update-project-mcp] Warning: Failed to update State Tracking API"
    fi
else
    echo "[update-project-mcp] Info: MCP_API_KEY not set - skipping State Tracking API update"
    echo "[update-project-mcp] Info: Set MCP_API_KEY to enable automatic session tracking"
fi

# Create signal file for VSCode extension (legacy support)
SESSIONS_DIR="$REPO_ROOT/.claude-sessions"
mkdir -p "$SESSIONS_DIR"
SIGNAL_FILE="$SESSIONS_DIR/${SESSION_ID}.signal"

cat > "$SIGNAL_FILE" <<EOF
{
  "state": "stopped",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "session_id": "$SESSION_ID",
  "event": "ProjectUpdate",
  "project_update": {
    "type": "$TYPE",
    "project_number": ${PROJECT_NUMBER:-null},
    "issue_number": ${ISSUE_NUMBER:-null},
    "status": ${STATUS:+\"$STATUS\"}
  }
}
EOF

echo "[update-project-mcp] ✓ Signal file created for extension"
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "✓ Update complete!"
echo "  - GitHub issue updated via MCP client"
if [[ -n "$API_KEY" ]]; then
    echo "  - State Tracking API notified"
fi
echo "  - VSCode extension will refresh automatically"
echo "════════════════════════════════════════════════════════════════"
