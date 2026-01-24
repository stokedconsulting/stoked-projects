#!/bin/bash
#
# test-update-mcp.sh - Test the MCP-based project update system
#
# This script simulates Claude Code completing a task and notifying the extension
# using MCP tools instead of direct `gh` CLI calls.
#

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "Testing MCP-Based Project Update System"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Get the repo root
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$REPO_ROOT"

echo "Repository: $REPO_ROOT"
echo ""

# Check for required environment variables
if [[ -z "$GITHUB_TOKEN" && -z "$GH_TOKEN" ]]; then
    echo "⚠ Warning: GITHUB_TOKEN not set"
    echo "  Set it with: export GITHUB_TOKEN=your_github_token"
    echo "  Continuing with reduced functionality..."
    echo ""
fi

if [[ -z "$MCP_API_KEY" ]]; then
    echo "⚠ Warning: MCP_API_KEY not set"
    echo "  Set it to enable State Tracking API integration"
    echo "  Continuing without API tracking..."
    echo ""
fi

# Test 1: Task completed
echo "Test 1: Simulating task completion for issue #2 in project #70..."
./examples/update-project-mcp.sh --task-completed --issue 2 --project 70
echo ""

sleep 2

# Test 2: Status updated
echo "Test 2: Simulating status update for issue #3..."
./examples/update-project-mcp.sh --issue 3 --status "In Progress" --project 70
echo ""

sleep 2

# Test 3: Issue closed
echo "Test 3: Simulating issue closure for issue #4..."
./examples/update-project-mcp.sh --close-issue 4 --project 70
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "Tests Complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "✓ All MCP-based update operations completed"
echo ""
echo "Check your VSCode extension - it should have refreshed automatically!"
echo "Look for notifications in the bottom-right corner."
echo ""
echo "Migration Benefits:"
echo "  ✓ Using MCP tools instead of gh CLI"
echo "  ✓ State Tracking API integration (if MCP_API_KEY set)"
echo "  ✓ Automatic failure detection and recovery"
echo "  ✓ Complete session audit trail"
echo ""
