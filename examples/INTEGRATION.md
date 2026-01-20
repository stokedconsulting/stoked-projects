# Claude Code Integration with VSCode Extension

This document explains how Claude Code can integrate with the Claude Projects VSCode extension to keep project status in sync.

## Overview

When Claude Code completes a task or closes an issue, it can call a helper script that:
1. Updates the GitHub Project (closes issues, updates status)
2. Notifies the VSCode extension to refresh automatically

This eliminates the need for manual refreshing in the extension.

## Setup

### 1. Make the script executable

```bash
chmod +x examples/update-project.sh
```

### 2. Set up Claude Code to use the script

When Claude Code completes a task, it should call:

```bash
./examples/update-project.sh --close-issue 123 --project 70
```

## Usage Examples

### When completing an issue

```bash
# Close issue #5 in project #70
./examples/update-project.sh --close-issue 5 --project 70
```

### When updating task status

```bash
# Mark issue #5 as "Done"
./examples/update-project.sh --issue 5 --status Done --project 70
```

### When completing a task (without closing)

```bash
# Notify that a task is complete (won't close the issue)
./examples/update-project.sh --task-completed --issue 5 --project 70
```

## How It Works

1. **Claude Code** completes a task and calls `update-project.sh`
2. **Script** updates GitHub via `gh` CLI
3. **Script** writes a signal file to `.claude-sessions/{session_id}.signal`
4. **Extension** detects the signal file change via file watcher
5. **Extension** clears cache and automatically refreshes the UI
6. **User** sees updated project status immediately

## Signal File Format

The signal file is a JSON file that looks like:

```json
{
  "state": "stopped",
  "timestamp": "2026-01-20T10:30:00Z",
  "session_id": "1737379800",
  "event": "ProjectUpdate",
  "project_update": {
    "type": "issue_closed",
    "project_number": 70,
    "issue_number": 5,
    "status": "Done"
  }
}
```

## Update Types

- `task_completed` - Task finished but issue stays open
- `issue_closed` - Issue completed and closed
- `status_updated` - Status field updated in project
- `item_updated` - Generic project item update

## Environment Variables

- `CLAUDE_SESSION_ID` - Optional session ID (auto-detected if not set)

## Integration in Claude Code

Claude Code should call this script at these points:

1. **After completing a task successfully**
   ```bash
   examples/update-project.sh --task-completed --issue $ISSUE_NUMBER --project $PROJECT_NUMBER
   ```

2. **After closing an issue**
   ```bash
   examples/update-project.sh --close-issue $ISSUE_NUMBER --project $PROJECT_NUMBER
   ```

3. **After updating project status manually**
   ```bash
   examples/update-project.sh --issue $ISSUE_NUMBER --status "Done" --project $PROJECT_NUMBER
   ```

## Benefits

- **No manual refreshing** - Extension updates automatically
- **Real-time sync** - See changes within seconds
- **Clean separation** - Claude Code doesn't need to know about the extension
- **Reliable** - File-based signaling is simple and robust

## Troubleshooting

### Extension doesn't update

1. Check that signal files are being created in `.claude-sessions/`
2. Check Output panel: **View → Output → Claude Projects**
3. Check Developer Console for errors: **Help → Toggle Developer Tools**

### Signal file not found

The script will try to find the most recent signal file automatically. If none exists, it will create one using the current timestamp.

### GitHub updates fail

Make sure you have:
- `gh` CLI installed and authenticated
- Proper permissions for the repository
- Network connectivity
