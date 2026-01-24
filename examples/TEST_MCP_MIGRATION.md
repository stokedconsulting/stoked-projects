# MCP Migration Test Plan

## Overview

This document outlines the testing strategy for the shell scripts migration to MCP tools.

---

## Test Environment Setup

### Prerequisites

```bash
# 1. Install Node.js
node --version  # Should be v18+

# 2. Install dependencies
cd examples
npm install

# 3. Set environment variables
export GITHUB_TOKEN=your_github_token
export MCP_API_KEY=your_mcp_api_key  # Optional

# 4. Make scripts executable
chmod +x mcp-client.js update-project-mcp.sh test-update-mcp.sh
```

---

## Unit Tests

### Test 1: MCP Client Help

**Command:**
```bash
./examples/mcp-client.js
```

**Expected Output:**
```
Usage: mcp-client.js <operation> [options]

Operations:
  close-issue     - Close a GitHub issue
  create-issue    - Create a new GitHub issue
  update-issue    - Update an existing issue
  get-issue       - Get issue details
  list-issues     - List repository issues
  list-projects   - List repository projects
...
```

**Status:** ✅ Pass / ❌ Fail

---

### Test 2: MCP Client Error Handling (No Token)

**Command:**
```bash
unset GITHUB_TOKEN
./examples/mcp-client.js get-issue --number 1
```

**Expected Output:**
```
Error: GITHUB_TOKEN or GH_TOKEN environment variable required
Set it with: export GITHUB_TOKEN=your_github_token
```

**Exit Code:** 1

**Status:** ✅ Pass / ❌ Fail

---

### Test 3: Auto-Detect Repository

**Command:**
```bash
cd /path/to/claude-projects
./examples/mcp-client.js list-issues --limit 5
```

**Expected:**
- Should auto-detect owner and repo from git remote
- Should list issues from the repository

**Status:** ✅ Pass / ❌ Fail

---

### Test 4: Get Issue Details

**Command:**
```bash
./examples/mcp-client.js get-issue --number 1 | jq '.title'
```

**Expected:**
- JSON output with issue details
- Title field should be present

**Status:** ✅ Pass / ❌ Fail

---

### Test 5: List Issues

**Command:**
```bash
./examples/mcp-client.js list-issues --state open --limit 10 | jq 'length'
```

**Expected:**
- JSON array of issues
- At most 10 issues returned

**Status:** ✅ Pass / ❌ Fail

---

### Test 6: List Projects

**Command:**
```bash
./examples/mcp-client.js list-projects | jq '.repository.projectsV2.nodes | length'
```

**Expected:**
- JSON output with projects
- Should list ProjectsV2

**Status:** ✅ Pass / ❌ Fail

---

## Integration Tests

### Test 7: Update Project Script (Task Completed)

**Command:**
```bash
./examples/update-project-mcp.sh --task-completed --issue 2 --project 70
```

**Expected:**
- Should create signal file
- Should update State Tracking API (if MCP_API_KEY set)
- Should output success message

**Verify:**
```bash
# Check signal file created
ls -la .claude-sessions/*.signal

# Check output contains success message
# Should see: "✓ Update complete!"
```

**Status:** ✅ Pass / ❌ Fail

---

### Test 8: Update Project Script (Close Issue)

**Command:**
```bash
./examples/update-project-mcp.sh --close-issue 4 --project 70
```

**Expected:**
- Should call MCP client to close issue
- Should create signal file
- Should update State Tracking API

**Verify:**
```bash
# Check issue is closed on GitHub
./examples/mcp-client.js get-issue --number 4 | jq '.state'
# Should output: "closed"
```

**Status:** ✅ Pass / ❌ Fail

---

### Test 9: Update Project Script (Status Update)

**Command:**
```bash
./examples/update-project-mcp.sh --issue 3 --status "In Progress" --project 70
```

**Expected:**
- Should log status update
- Should create signal file
- Extension should refresh

**Status:** ✅ Pass / ❌ Fail

---

### Test 10: Full Test Suite

**Command:**
```bash
./examples/test-update-mcp.sh
```

**Expected:**
- All three test scenarios should run
- Should see success messages for each
- Should create signal files

**Status:** ✅ Pass / ❌ Fail

---

## State Tracking API Tests

### Test 11: API Integration (with MCP_API_KEY)

**Command:**
```bash
export MCP_API_KEY=your_key
./examples/update-project-mcp.sh --task-completed --issue 5 --project 70
```

**Expected:**
- Should update State Tracking API
- Should see: "✓ State Tracking API updated"

**Verify:**
```bash
# Query State Tracking API
curl -X GET "https://claude-projects.truapi.com/api/tasks?session_id=SESSION_ID" \
  -H "X-API-Key: $MCP_API_KEY"

# Should see task entry
```

**Status:** ✅ Pass / ❌ Fail

---

### Test 12: API Integration (without MCP_API_KEY)

**Command:**
```bash
unset MCP_API_KEY
./examples/update-project-mcp.sh --task-completed --issue 6 --project 70
```

**Expected:**
- Should skip State Tracking API update
- Should see: "Info: MCP_API_KEY not set - skipping State Tracking API update"
- Should still work (legacy mode)

**Status:** ✅ Pass / ❌ Fail

---

## Performance Tests

### Test 13: Response Time Comparison

**Setup:**
```bash
# Install hyperfine for benchmarking
brew install hyperfine  # macOS
```

**Command:**
```bash
# Benchmark gh CLI
hyperfine --warmup 3 'gh issue view 1 --json title'

# Benchmark MCP client
hyperfine --warmup 3 './examples/mcp-client.js get-issue --number 1'
```

**Expected:**
- MCP client should be faster (< 500ms vs ~800ms for gh CLI)

**Status:** ✅ Pass / ❌ Fail

---

### Test 14: Concurrent Operations

**Command:**
```bash
# Run multiple operations in parallel
for i in {1..5}; do
  ./examples/mcp-client.js get-issue --number $i &
done
wait
```

**Expected:**
- All operations should complete successfully
- No race conditions or errors

**Status:** ✅ Pass / ❌ Fail

---

## Error Handling Tests

### Test 15: Invalid Issue Number

**Command:**
```bash
./examples/mcp-client.js get-issue --number 999999
```

**Expected:**
- Should return error from GitHub API
- Should exit with non-zero code

**Status:** ✅ Pass / ❌ Fail

---

### Test 16: Network Failure

**Command:**
```bash
# Simulate network failure (requires network interception tool)
# Or test with invalid API endpoint
export MCP_API_BASE=https://invalid-endpoint.example.com
./examples/update-project-mcp.sh --task-completed --issue 1 --project 70
```

**Expected:**
- Should handle network errors gracefully
- Should still create signal file (fallback mode)

**Status:** ✅ Pass / ❌ Fail

---

### Test 17: Invalid GitHub Token

**Command:**
```bash
export GITHUB_TOKEN=invalid_token
./examples/mcp-client.js get-issue --number 1
```

**Expected:**
- Should return authentication error
- Should exit with non-zero code

**Status:** ✅ Pass / ❌ Fail

---

## Backward Compatibility Tests

### Test 18: Legacy Script Still Works

**Command:**
```bash
./examples/update-project.sh --task-completed --issue 1 --project 70
```

**Expected:**
- Should still work (shows deprecation warning)
- Should create signal file
- Extension should refresh

**Status:** ✅ Pass / ❌ Fail

---

### Test 19: Signal File Format

**Command:**
```bash
./examples/update-project-mcp.sh --task-completed --issue 1 --project 70
cat .claude-sessions/*.signal | jq '.'
```

**Expected:**
```json
{
  "state": "stopped",
  "timestamp": "2026-01-24T...",
  "session_id": "...",
  "event": "ProjectUpdate",
  "project_update": {
    "type": "task_completed",
    "project_number": 70,
    "issue_number": 1,
    "status": null
  }
}
```

**Status:** ✅ Pass / ❌ Fail

---

## Security Tests

### Test 20: Token Not Leaked in Logs

**Command:**
```bash
./examples/mcp-client.js get-issue --number 1 2>&1 | grep -i "token"
```

**Expected:**
- GitHub token should NOT appear in logs
- Should NOT see token in stderr or stdout

**Status:** ✅ Pass / ❌ Fail

---

### Test 21: Input Validation

**Command:**
```bash
# Try to inject malicious input
./examples/mcp-client.js get-issue --number "1; rm -rf /"
```

**Expected:**
- Should safely handle input
- Should not execute shell commands

**Status:** ✅ Pass / ❌ Fail

---

## Test Results Summary

| Test | Status | Notes |
|------|--------|-------|
| 1. Help output | ⬜ | |
| 2. Error handling | ⬜ | |
| 3. Auto-detect repo | ⬜ | |
| 4. Get issue | ⬜ | |
| 5. List issues | ⬜ | |
| 6. List projects | ⬜ | |
| 7. Task completed | ⬜ | |
| 8. Close issue | ⬜ | |
| 9. Status update | ⬜ | |
| 10. Full test suite | ⬜ | |
| 11. API integration (with key) | ⬜ | |
| 12. API integration (no key) | ⬜ | |
| 13. Performance | ⬜ | |
| 14. Concurrent ops | ⬜ | |
| 15. Invalid issue | ⬜ | |
| 16. Network failure | ⬜ | |
| 17. Invalid token | ⬜ | |
| 18. Legacy compat | ⬜ | |
| 19. Signal format | ⬜ | |
| 20. Token security | ⬜ | |
| 21. Input validation | ⬜ | |

---

## Test Execution

Run all tests:

```bash
# Set environment
export GITHUB_TOKEN=your_token
export MCP_API_KEY=your_key

# Run tests manually
./examples/mcp-client.js
./examples/mcp-client.js get-issue --number 1
./examples/update-project-mcp.sh --task-completed --issue 1 --project 70
./examples/test-update-mcp.sh

# Check results
echo "Review test results above"
```

---

## Acceptance Criteria

Migration is complete when:

- ✅ All scripts replaced with MCP client
- ✅ All tests passing
- ✅ Documentation updated
- ✅ Dependencies installed
- ✅ State Tracking API integration working
- ✅ Backward compatibility maintained
- ✅ Performance improved
- ✅ Security validated

---

## Rollback Plan

If migration fails:

1. Revert to legacy scripts:
   ```bash
   git checkout -- examples/update-project.sh examples/test-update.sh
   ```

2. Remove new files:
   ```bash
   rm examples/mcp-client.js examples/update-project-mcp.sh examples/test-update-mcp.sh
   ```

3. Continue using `gh` CLI

4. Document issues for future retry
