#!/bin/bash

# Claude Session Wrapper
# This script wraps the Claude CLI to enable session monitoring
# Usage: claude-session-wrapper.sh [session-file] [claude-args...]

SESSION_FILE="$1"
shift  # Remove first argument, rest are Claude arguments

if [ -z "$SESSION_FILE" ]; then
    echo "Error: Session file path required as first argument"
    exit 1
fi

# Ensure session file exists
touch "$SESSION_FILE"

# Function to log with timestamp
log_activity() {
    echo -e "\n**[$(date -u +%Y-%m-%dT%H:%M:%S.000Z)]** $1\n" >> "$SESSION_FILE"
}

# Log session start
log_activity "Claude command started: claude $*"

# Create a named pipe for output capture
PIPE=$(mktemp -u)
mkfifo "$PIPE"

# Background process to monitor output and touch session file periodically
(
    LAST_TOUCH=0
    while IFS= read -r line; do
        echo "$line"  # Pass through to terminal
        
        # Touch session file every 5 seconds to indicate activity
        CURRENT_TIME=$(date +%s)
        if [ $((CURRENT_TIME - LAST_TOUCH)) -ge 5 ]; then
            touch "$SESSION_FILE"
            LAST_TOUCH=$CURRENT_TIME
        fi
    done < "$PIPE"
) &

MONITOR_PID=$!

# Run Claude with output tee'd to the pipe
claude "$@" 2>&1 | tee "$PIPE"

# Capture exit code
EXIT_CODE=$?

# Cleanup
kill $MONITOR_PID 2>/dev/null
rm -f "$PIPE"

# Log completion
log_activity "Claude command completed with exit code: $EXIT_CODE"

exit $EXIT_CODE
