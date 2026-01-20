#!/bin/bash
#
# test-update.sh - Test the project update notification system
#
# This script simulates Claude Code completing a task and notifying the extension.
#

set -e

echo "=== Testing Project Update Notification ==="
echo ""

# Get the repo root
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$REPO_ROOT"

echo "Repository: $REPO_ROOT"
echo ""

# Test 1: Task completed
echo "Test 1: Simulating task completion for issue #2 in project #70..."
./examples/update-project.sh --task-completed --issue 2 --project 70
echo ""

sleep 2

# Test 2: Status updated
echo "Test 2: Simulating status update for issue #3..."
./examples/update-project.sh --issue 3 --status "In Progress" --project 70
echo ""

sleep 2

# Test 3: Issue closed
echo "Test 3: Simulating issue closure for issue #4..."
./examples/update-project.sh --close-issue 4 --project 70
echo ""

echo "=== Tests Complete ==="
echo ""
echo "Check your VSCode extension - it should have refreshed automatically!"
echo "Look for notifications in the bottom-right corner."
