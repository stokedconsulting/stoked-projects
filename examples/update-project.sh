#!/bin/bash
#
# update-project.sh - Helper script for Claude Code to update GitHub Projects [DEPRECATED]
#
# DEPRECATION NOTICE:
# ==================
# This script uses the legacy signal file approach and is DEPRECATED as of January 2026.
# Please migrate to MCP Tools for better reliability, performance, and features.
#
# Migration Guide: docs/mcp-migration-guide.md
# Deprecation Timeline:
#  - Now: Signal file approach still works (with warnings)
#  - 30 days: Legacy approach marked for deprecation
#  - 90 days: Signal file approach removed completely
#
# This script updates GitHub Projects and notifies the VSCode extension to refresh.
# Claude Code can call this script when completing tasks/issues.
#
# Usage:
#   update-project.sh --issue 123 --status Done
#   update-project.sh --close-issue 123 --project 70
#   update-project.sh --task-completed --issue 123
#
# RECOMMENDED ALTERNATIVE (MCP Tools):
#   curl -X POST https://claude-projects.truapi.com/api/tasks/TASK_ID \
#     -H "X-API-Key: YOUR_API_KEY" \
#     -H "Content-Type: application/json" \
#     -d '{"status": "completed"}'
#

set -e

# Print deprecation warning
cat >&2 << 'DEPRECATION_WARNING'
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         DEPRECATION WARNING                                   ║
╚═══════════════════════════════════════════════════════════════════════════════╝

The signal file approach (update-project.sh) is DEPRECATED.

This script uses file-based signaling which has significant limitations:
  ✗ No real-time session monitoring
  ✗ No automatic failure detection
  ✗ No recovery state management
  ✗ Manual failure handling required
  ✗ Limited audit trail

RECOMMENDED ALTERNATIVE: MCP Tools (State Tracking API)

Benefits of migrating to MCP Tools:
  ✓ Real-time failure detection (<5 minutes)
  ✓ Automatic recovery workflows
  ✓ Zero manual intervention for stalls
  ✓ Complete session history
  ✓ Sub-500ms API latencies
  ✓ Full audit trail and compliance

Migration Steps:
  1. Read: docs/mcp-migration-guide.md
  2. Setup: Get API key from your team
  3. Test: See examples/mcp-tools/ for code examples
  4. Deploy: Update your orchestration to use MCP API

TIMELINE:
  Now (Jan 2026):         Signal files work with warnings
  30 days (Feb 2026):     Marked for deprecation
  90 days (Apr 2026):     Removed completely

Questions? See docs/mcp-migration-guide.md
═══════════════════════════════════════════════════════════════════════════════
DEPRECATION_WARNING


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

echo "[update-project] Type: $TYPE, Issue: ${ISSUE_NUMBER:-N/A}, Project: ${PROJECT_NUMBER:-N/A}, Status: ${STATUS:-N/A}"

# Get repo root
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SESSIONS_DIR="$REPO_ROOT/.claude-sessions"
mkdir -p "$SESSIONS_DIR"

# Find the most recent signal file or create a new one
SIGNAL_FILE="$SESSIONS_DIR/${SESSION_ID}.signal"
if [[ ! -f "$SIGNAL_FILE" ]]; then
    # Find most recent signal file
    LATEST_SIGNAL=$(find "$SESSIONS_DIR" -name "*.signal" -type f -exec ls -t {} + 2>/dev/null | head -n1)
    if [[ -n "$LATEST_SIGNAL" ]]; then
        SIGNAL_FILE="$LATEST_SIGNAL"
    fi
fi

echo "[update-project] Using signal file: $SIGNAL_FILE"

# Perform GitHub updates
if [[ "$TYPE" == "issue_closed" && -n "$ISSUE_NUMBER" ]]; then
    echo "[update-project] Closing issue #$ISSUE_NUMBER..."
    gh issue close "$ISSUE_NUMBER" --comment "Completed via Claude Code" || echo "Warning: Failed to close issue"
fi

if [[ "$TYPE" == "status_updated" && -n "$ISSUE_NUMBER" && -n "$STATUS" && -n "$PROJECT_NUMBER" ]]; then
    echo "[update-project] Updating issue #$ISSUE_NUMBER status to '$STATUS' in project #$PROJECT_NUMBER..."
    # Note: This requires the GitHub CLI project extension or GraphQL API call
    # For now, we'll skip the actual update and just notify the extension
    echo "Warning: Direct status update not implemented yet - extension will refresh to show changes"
fi

# Write signal file to notify extension
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

echo "[update-project] ✓ Notified extension to refresh projects"
echo ""
echo "TIP: The VSCode extension will automatically refresh to show updated status."
