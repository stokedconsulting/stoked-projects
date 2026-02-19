---
name: project-integrate
description: "Integrate completed project into main: validate, sync, PR, squash merge, cleanup"
category: workflow
complexity: advanced
argument-hint: <project-number> [--merge]
allowed-tools: Bash(gh:*), Bash(git:*), Bash(cd:*), Bash(pnpm:*), Bash(npm:*), Task, Read, Write, Grep, Glob, Edit
---

# /project-integrate - Project Integration Pipeline

## Purpose
Automates the full integration of a completed project branch into main via a 5-phase pipeline:
1. **Pre-flight** - Verify worktree state, clean up, push outstanding work
2. **Acceptance Validation** - Confirm all items Done, run review, build, tests *(skipped with `--merge`)*
3. **Sync with Main** - Merge origin/main with multi-tier conflict resolution
4. **Integration** - Create PR and squash merge into main
5. **Cleanup** - Remove worktree, update state files, print summary

## Usage
```
/project-integrate <project-number> [--merge]
```

**Examples:**
```
/project-integrate 79          # Full validation + integration
/project-integrate 79 --merge  # Skip validation, just merge into main
```

### `--merge` Flag

When `--merge` is passed, the pipeline assumes all work is valid and skips Phase 2 entirely (no item status checks, no project review, no builds, no tests). Use this when you've already validated the work yourself and just want to land the branch cleanly on main.

---

## ROLE & MISSION

You are the **Integration Engineer** — you take a fully-built project branch and land it cleanly on main with full validation and intelligent conflict resolution.

### You DO:
- Validate project completeness before integration
- Resolve merge conflicts intelligently (mechanical + AI-assisted)
- Create well-documented PRs with validation results
- Track integration state for resumability
- Clean up worktrees and update project metadata

### You DO NOT:
- Implement features or fix bugs (that's `/project-start`'s job)
- Skip validation steps — unless `--merge` flag is explicitly passed
- Force-push or rebase shared branches
- Proceed past a failed validation without escalating

---

## ARGUMENT PARSING

**ALWAYS parse arguments first before doing anything else.**

```bash
# Parse $ARGUMENTS into project number and flags
MERGE_ONLY=false
PROJECT_NUM=""

for arg in $ARGUMENTS; do
  if [ "$arg" = "--merge" ]; then
    MERGE_ONLY=true
  elif [ -z "$PROJECT_NUM" ]; then
    PROJECT_NUM="$arg"
  fi
done

if [ -z "$PROJECT_NUM" ]; then
  echo "ERROR: No project number provided."
  echo "Usage: /project-integrate <project-number> [--merge]"
  exit 1
fi

if [ "$MERGE_ONLY" = true ]; then
  echo "MODE: --merge (skipping validation, direct integration)"
else
  echo "MODE: full validation + integration"
fi
```

---

## RESUMABILITY: Check for Existing State

**ALWAYS start here.** Check if a previous integration attempt exists:

```bash
# Find the project slug from orchestration state
# NOTE: Use $PROJECT_NUM (parsed above), not raw $ARGUMENTS
SLUG=$(ls projects/ | while read dir; do
  if [ -f "projects/$dir/orchestration-state.json" ]; then
    num=$(cat "projects/$dir/orchestration-state.json" | jq -r '.project_number // empty')
    if [ "$num" = "$PROJECT_NUM" ]; then
      echo "$dir"
      break
    fi
  fi
done)

if [ -z "$SLUG" ]; then
  echo "ERROR: No orchestration state found for project #$PROJECT_NUM"
  echo "This command requires a project that was created via /project-create and built via /project-start"
  exit 1
fi

echo "Found project slug: $SLUG"

# Check for existing integration state
if [ -f "projects/$SLUG/integration-state.json" ]; then
  echo "Found existing integration state — checking for resume..."
  cat "projects/$SLUG/integration-state.json" | jq .
fi
```

**Resume logic:**
- If `integration-state.json` exists and `current_phase` is not `"complete"`:
  - Read `phases_completed` array
  - Skip completed phases and resume from `current_phase`
  - Report what's being resumed and why
- If `integration-state.json` does not exist or `current_phase` is `"complete"`:
  - Start fresh from Phase 1

---

## PHASE 1: PRE-FLIGHT

### 1.1 Locate Worktree

```bash
OWNER=$(gh repo view --json owner -q .owner.login)

# Get main worktree path (works from any location)
MAIN_WORKTREE=$(git worktree list --porcelain | awk '/^worktree/ {print $2; exit}')
REPO_NAME=$(basename "$MAIN_WORKTREE")
PARENT_DIR=$(dirname "$MAIN_WORKTREE")
WORKTREE_PATH="${PARENT_DIR}/${REPO_NAME}-project-$PROJECT_NUM"

if [ ! -d "$WORKTREE_PATH" ]; then
  echo "ERROR: No worktree found at $WORKTREE_PATH"
  echo "Expected a worktree created by /project-start for project #$PROJECT_NUM"
  exit 1
fi

cd "$WORKTREE_PATH"
echo "Working in: $WORKTREE_PATH"
```

### 1.2 Verify Branch

```bash
CURRENT_BRANCH=$(git branch --show-current)
EXPECTED_BRANCH="project/$PROJECT_NUM"

if [ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]; then
  echo "ERROR: Expected branch '$EXPECTED_BRANCH' but found '$CURRENT_BRANCH'"
  exit 1
fi

echo "On branch: $CURRENT_BRANCH"
```

### 1.3 Clean Working Tree

```bash
# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes detected — creating pre-integration snapshot..."
  git add -A
  git commit -m "$(cat <<'EOF'
pre-integration snapshot: uncommitted work from project/$PROJECT_NUM

Automatically committed by /project-integrate before integration.
EOF
)"
  echo "Snapshot committed."
else
  echo "Working tree is clean."
fi
```

### 1.4 Push Outstanding Commits

```bash
# Check for unpushed commits
UNPUSHED=$(git log @{u}..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')

if [ "$UNPUSHED" -gt 0 ]; then
  echo "Pushing $UNPUSHED unpushed commit(s)..."
  git push origin "project/$PROJECT_NUM"
else
  echo "All commits already pushed."
fi
```

### 1.5 Fetch and Log Divergence

```bash
git fetch origin main

AHEAD=$(git rev-list origin/main..HEAD --count)
BEHIND=$(git rev-list HEAD..origin/main --count)

echo "Branch status relative to origin/main:"
echo "  Ahead: $AHEAD commits"
echo "  Behind: $BEHIND commits"
```

### 1.6 Write Initial State

Write `projects/$SLUG/integration-state.json`:

```json
{
  "project_number": $PROJECT_NUM,
  "slug": "$SLUG",
  "merge_only": $MERGE_ONLY,
  "started_at": "<ISO-8601 timestamp>",
  "current_phase": "preflight",
  "phases_completed": [],
  "worktree_path": "$WORKTREE_PATH",
  "branch": "project/$PROJECT_NUM",
  "ahead_of_main": $AHEAD,
  "behind_main": $BEHIND,
  "conflicts_resolved": [],
  "conflict_log": [],
  "validation_results": {},
  "pr_number": null,
  "pr_url": null,
  "merge_commit": null,
  "completed_at": null
}
```

Update state:
- If `MERGE_ONLY=true`: `phases_completed: ["preflight", "validation"]`, `current_phase: "sync"` *(skip validation entirely)*
- If `MERGE_ONLY=false`: `phases_completed: ["preflight"]`, `current_phase: "validation"`

---

## PHASE 2: ACCEPTANCE VALIDATION

> **`--merge` flag:** If `MERGE_ONLY=true`, skip this entire phase. Jump directly to Phase 3: Sync with Main. The validation state is recorded as `"validation_results": { "skipped": true, "reason": "--merge flag" }`.

### 2.1 Verify All Items Done

```bash
# Fetch project items
gh project item-list $PROJECT_NUM --owner $OWNER --format json --limit 200 > /tmp/project-$PROJECT_NUM-items.json

# Check for non-Done items (exclude the project description/title item if present)
NOT_DONE=$(cat /tmp/project-$PROJECT_NUM-items.json | jq -r '
  .items[]
  | select(.content.type == "Issue" or .content.type == "DraftIssue")
  | select(.fieldValues.Status != "Done")
  | "\(.fieldValues.Status // "No Status")\t\(.content.title)"
')

if [ -n "$NOT_DONE" ]; then
  echo "ABORT: The following items are NOT Done:"
  echo "$NOT_DONE"
  echo ""
  echo "All project items must have status 'Done' before integration."
  echo "Run /project-start $PROJECT_NUM to complete remaining work, or manually update statuses."
  exit 1
fi

echo "All project items are Done."
```

**If any items are not Done: ABORT immediately** with a clear list of incomplete items. Do NOT proceed.

### 2.2 Run Project Review

Launch `/review-project` to validate acceptance criteria:

```
Task({
  subagent_type: "general-purpose",
  description: "Review project $PROJECT_NUM",
  prompt: "/review-project $PROJECT_NUM"
})
```

**Analyze the review results:**
- If the review identifies **critical failures** (items that don't meet acceptance criteria, broken functionality, missing required features): **ABORT** with the review findings.
- If the review identifies only **minor concerns** (style issues, documentation gaps, optimization opportunities): **Log them** in integration state but proceed.
- If the review is **healthy**: Proceed.

### 2.3 Verify Toolchain (if project has build_config)

```bash
cd "$WORKTREE_PATH"

# Check if orchestration-state.json has toolchain requirements
if [ -f "projects/$SLUG/orchestration-state.json" ]; then
  TOOLCHAIN_REQS=$(cat "projects/$SLUG/orchestration-state.json" | jq -r '.build_config.toolchain_requirements[]?.check // empty' 2>/dev/null)

  if [ -n "$TOOLCHAIN_REQS" ]; then
    echo "Verifying toolchain requirements..."
    TOOLCHAIN_OK=true
    while IFS= read -r CHECK_CMD; do
      if [ -n "$CHECK_CMD" ]; then
        if ! eval "$CHECK_CMD" >/dev/null 2>&1; then
          echo "TOOLCHAIN MISSING: $CHECK_CMD failed"
          TOOLCHAIN_OK=false
        fi
      fi
    done <<< "$TOOLCHAIN_REQS"

    if [ "$TOOLCHAIN_OK" = false ]; then
      echo "ABORT: Required toolchain not installed. Install missing tools before integration."
      exit 1
    fi
    echo "Toolchain verified."
  fi
fi
```

### 2.4 Run Builds

```bash
cd "$WORKTREE_PATH"

BUILD_PASSED=true

# FIRST: Try project-specific build commands from orchestration-state.json
HAS_BUILD_CONFIG=false
if [ -f "projects/$SLUG/orchestration-state.json" ]; then
  BUILD_CMD=$(cat "projects/$SLUG/orchestration-state.json" | jq -r '.build_config.build_commands.primary // empty' 2>/dev/null)

  if [ -n "$BUILD_CMD" ]; then
    HAS_BUILD_CONFIG=true
    echo "Running project build command: $BUILD_CMD"
    if ! eval "$BUILD_CMD"; then
      echo "ABORT: Project build FAILED: $BUILD_CMD"
      BUILD_PASSED=false
    fi

    # Run additional build commands
    for cmd in $(cat "projects/$SLUG/orchestration-state.json" | jq -r '.build_config.build_commands.additional[]? // empty' 2>/dev/null); do
      echo "Running additional build: $cmd"
      if ! eval "$cmd"; then
        echo "ABORT: Additional build FAILED: $cmd"
        BUILD_PASSED=false
      fi
    done
  fi
fi

# FALLBACK: If no build_config, use hardcoded package checks (legacy projects)
if [ "$HAS_BUILD_CONFIG" = false ]; then
  echo "No build_config found — using legacy package detection..."

  CHANGED_FILES=$(git diff --name-only origin/main...HEAD)

  # Check if extension code changed
  if echo "$CHANGED_FILES" | grep -q "^apps/code-ext/"; then
    echo "Building apps/code-ext..."
    cd "$WORKTREE_PATH/apps/code-ext"
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    if ! pnpm run compile; then
      echo "ABORT: apps/code-ext build FAILED"
      BUILD_PASSED=false
    fi
    cd "$WORKTREE_PATH"
  fi

  # Check if API code changed
  if echo "$CHANGED_FILES" | grep -q "^packages/api/"; then
    echo "Building packages/api..."
    cd "$WORKTREE_PATH/packages/api"
    npm install 2>/dev/null || npm ci
    if ! npm run build; then
      echo "ABORT: packages/api build FAILED"
      BUILD_PASSED=false
    fi
    cd "$WORKTREE_PATH"
  fi

  # Check if MCP server changed
  if echo "$CHANGED_FILES" | grep -q "^packages/mcp-server/"; then
    echo "Building packages/mcp-server..."
    cd "$WORKTREE_PATH/packages/mcp-server"
    npm install 2>/dev/null || npm ci
    if ! npm run build; then
      echo "ABORT: packages/mcp-server build FAILED"
      BUILD_PASSED=false
    fi
    cd "$WORKTREE_PATH"
  fi
fi

if [ "$BUILD_PASSED" = false ]; then
  echo "ABORT: One or more builds failed. Fix build errors before integration."
  exit 1
fi

echo "All builds passed."
```

### 2.6 Run Tests

```bash
cd "$WORKTREE_PATH"

TEST_PASSED=true

# FIRST: Try project-specific test commands from orchestration-state.json
HAS_TEST_CONFIG=false
if [ -f "projects/$SLUG/orchestration-state.json" ]; then
  TEST_CMD=$(cat "projects/$SLUG/orchestration-state.json" | jq -r '.build_config.test_commands.unit // empty' 2>/dev/null)

  if [ -n "$TEST_CMD" ]; then
    HAS_TEST_CONFIG=true
    echo "Running project test command: $TEST_CMD"
    TEST_OUTPUT=$(eval "$TEST_CMD" 2>&1)
    TEST_EXIT=$?

    if [ $TEST_EXIT -ne 0 ]; then
      echo "WARNING: Project tests failed"
      echo "$TEST_OUTPUT"
      TEST_PASSED=false
    fi

    # Check for zero-test condition
    if echo "$TEST_OUTPUT" | grep -qiE "(0 tests|0 passing|test suites: 0|tests: 0|no tests found)"; then
      echo "WARNING: ZERO TESTS DETECTED — test command succeeded but no tests actually ran"
      TEST_PASSED=false
    fi

    # Run integration tests if configured
    INT_TEST_CMD=$(cat "projects/$SLUG/orchestration-state.json" | jq -r '.build_config.test_commands.integration // empty' 2>/dev/null)
    if [ -n "$INT_TEST_CMD" ]; then
      echo "Running integration tests: $INT_TEST_CMD"
      if ! eval "$INT_TEST_CMD" 2>&1; then
        echo "WARNING: Integration tests failed"
        TEST_PASSED=false
      fi
    fi
  fi
fi

# FALLBACK: If no test_config, use hardcoded package checks (legacy projects)
if [ "$HAS_TEST_CONFIG" = false ]; then
  echo "No test_config found — using legacy package detection..."

  CHANGED_FILES=$(git diff --name-only origin/main...HEAD 2>/dev/null)

  if echo "$CHANGED_FILES" | grep -q "^packages/api/"; then
    echo "Running packages/api tests..."
    cd "$WORKTREE_PATH/packages/api"
    if ! npm test 2>&1; then
      echo "WARNING: packages/api tests failed"
      TEST_PASSED=false
    fi
    cd "$WORKTREE_PATH"
  fi

  if echo "$CHANGED_FILES" | grep -q "^packages/mcp-server/"; then
    echo "Running packages/mcp-server tests..."
    cd "$WORKTREE_PATH/packages/mcp-server"
    if ! npm test 2>&1; then
      echo "WARNING: packages/mcp-server tests failed"
      TEST_PASSED=false
    fi
    cd "$WORKTREE_PATH"
  fi
fi

if [ "$TEST_PASSED" = false ]; then
  echo "ABORT: Tests failed. Fix test failures before integration."
  exit 1
fi

echo "All tests passed."
```

### 2.7 Update State

Update `integration-state.json`:
- `phases_completed`: add `"validation"`
- `current_phase`: `"sync"`
- `validation_results`: `{ "all_items_done": true, "review_status": "passed|minor_concerns", "builds_passed": true, "tests_passed": true, "toolchain_verified": true }`

---

## PHASE 3: SYNC WITH MAIN

### 3.1 Attempt Merge

```bash
cd "$WORKTREE_PATH"
git fetch origin main

# Attempt the merge
if git merge origin/main -m "merge origin/main into project/$PROJECT_NUM for integration"; then
  echo "Clean merge - no conflicts."
  git push origin "project/$PROJECT_NUM"
else
  echo "Merge conflicts detected. Beginning resolution..."
fi
```

### 3.2 Parse Conflicts (if any)

```bash
# Get list of conflicting files
CONFLICTS=$(git status --short | grep "^UU\|^AA\|^DD\|^AU\|^UA" | awk '{print $2}')

if [ -z "$CONFLICTS" ]; then
  echo "No conflicts to resolve."
else
  echo "Conflicting files:"
  echo "$CONFLICTS"
fi
```

### 3.3 Tier 1 - Mechanical Resolution

Resolve conflicts that have deterministic strategies — no AI needed:

**Lock files** (`pnpm-lock.yaml`, `package-lock.json`):
```bash
for lockfile in pnpm-lock.yaml package-lock.json; do
  if echo "$CONFLICTS" | grep -q "$lockfile"; then
    echo "Resolving $lockfile mechanically..."
    # Accept the project's package.json, regenerate lock file
    git checkout --ours "$lockfile"
    git add "$lockfile"

    # Determine which package manager to regenerate with
    LOCK_DIR=$(dirname "$lockfile")
    if [ "$lockfile" = "pnpm-lock.yaml" ] || echo "$lockfile" | grep -q "pnpm-lock"; then
      (cd "$LOCK_DIR" 2>/dev/null || true; pnpm install --no-frozen-lockfile)
    else
      (cd "$LOCK_DIR" 2>/dev/null || true; npm install)
    fi
    git add "$lockfile"
    echo "Resolved $lockfile via regeneration."
  fi
done
```

**Build output** (`out/`, `dist/`):
```bash
for file in $CONFLICTS; do
  if echo "$file" | grep -qE "^(out|dist)/"; then
    echo "Resolving build artifact $file — accepting project version..."
    git checkout --ours "$file" 2>/dev/null || git rm "$file" 2>/dev/null
    git add "$file"
  fi
done
```

**OS/generated files** (`.DS_Store`):
```bash
for file in $CONFLICTS; do
  if echo "$file" | grep -qE "\.DS_Store$"; then
    echo "Resolving OS file $file — accepting either side..."
    git checkout --ours "$file" 2>/dev/null || git checkout --theirs "$file" 2>/dev/null
    git add "$file"
  fi
done
```

### 3.4 Tier 2 - AI-Assisted Resolution

For remaining conflicts after Tier 1, use Claude with full project context:

```bash
REMAINING_CONFLICTS=$(git status --short | grep "^UU\|^AA\|^DD\|^AU\|^UA" | awk '{print $2}')
```

**For each remaining conflicting file:**

1. **Gather context:**
   - Read the project's PRD: `projects/$SLUG/prd.md`
   - Get what the project changed: `git log --oneline origin/main..HEAD -- <file>`
   - Get what main changed: `git log --oneline HEAD..origin/main -- <file>`
   - Read the full file with conflict markers

2. **Resolution approach:**
   - If main's change is **unrelated** to the project's change (e.g., different functions) — incorporate both
   - If main's change **overlaps** with the project's change — prefer project's version but incorporate bug fixes or API changes from main
   - If main **deleted or restructured** code the project modified — analyze whether main's restructuring supersedes or the project's changes need adaptation

3. **Apply resolution:**
   - Write the resolved file content
   - `git add <file>`
   - Log the resolution rationale to `conflict_log[]` in integration state

### 3.5 Validate Resolution

After resolving all conflicts:

```bash
git commit -m "resolve merge conflicts for project/$PROJECT_NUM integration"

# Re-run builds to validate resolution
BUILD_OK=true

# Use project-specific build commands if available
if [ -f "projects/$SLUG/orchestration-state.json" ]; then
  BUILD_CMD=$(cat "projects/$SLUG/orchestration-state.json" | jq -r '.build_config.build_commands.primary // empty' 2>/dev/null)
  if [ -n "$BUILD_CMD" ]; then
    echo "Post-resolution build: $BUILD_CMD"
    if ! eval "$BUILD_CMD"; then BUILD_OK=false; fi
  fi
fi

# Fallback: hardcoded package checks
if [ -z "$BUILD_CMD" ]; then
  if echo "$CHANGED_FILES" | grep -q "^apps/code-ext/"; then
    cd "$WORKTREE_PATH/apps/code-ext"
    if ! pnpm run compile; then BUILD_OK=false; fi
    cd "$WORKTREE_PATH"
  fi

  if echo "$CHANGED_FILES" | grep -q "^packages/api/"; then
    cd "$WORKTREE_PATH/packages/api"
    if ! npm run build; then BUILD_OK=false; fi
    cd "$WORKTREE_PATH"
  fi
fi

if [ "$BUILD_OK" = false ]; then
  echo "Post-resolution build FAILED. Attempting re-resolution (attempt 2 of 2)..."
  # Re-examine the failing files and fix
  # If second attempt also fails → Tier 3 escalation
fi
```

**If build/tests fail after 2 resolution attempts → Tier 3: Human Escalation**

### 3.6 Tier 3 - Human Escalation (if needed)

If AI resolution fails after 2 attempts:

```
INTEGRATION BLOCKED - MANUAL CONFLICT RESOLUTION REQUIRED

Conflicting files:
- src/extension.ts: Project added new command registration, main refactored activation flow
- package.json: Both sides modified dependencies

Attempted resolutions:
1. [description of attempt 1 and why it failed]
2. [description of attempt 2 and why it failed]

Build error:
[exact error output]

Suggested manual resolution:
[specific guidance for each file]
```

**ABORT the integration.** Update state with `current_phase: "sync"` so the user can fix conflicts and re-run.

### 3.7 Push and Update State

```bash
git push origin "project/$PROJECT_NUM"
```

Update `integration-state.json`:
- `phases_completed`: add `"sync"`
- `current_phase`: `"integration"`
- `conflicts_resolved`: list of files that had conflicts
- `conflict_log`: array of `{ file, strategy, rationale }` entries

---

## PHASE 4: INTEGRATION

### 4.1 Read Project Metadata

```bash
# Get project title from orchestration state
PROJECT_TITLE=$(cat "projects/$SLUG/orchestration-state.json" | jq -r '.title')
PROJECT_URL=$(cat "projects/$SLUG/orchestration-state.json" | jq -r '.project_url // empty')

# Get stats
STATS=$(git diff --stat origin/main...HEAD)
FILES_CHANGED=$(git diff --name-only origin/main...HEAD | wc -l | tr -d ' ')
INSERTIONS=$(git diff --shortstat origin/main...HEAD | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+')
DELETIONS=$(git diff --shortstat origin/main...HEAD | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+')
```

### 4.2 Create Pull Request

```bash
# Build the PR body from integration state and project metadata
# Read validation results and conflict log from integration-state.json

gh pr create \
  --title "Project #$PROJECT_NUM: $PROJECT_TITLE" \
  --head "project/$PROJECT_NUM" \
  --base main \
  --body "$(cat <<'PREOF'
## Summary

Integrates Project #$PROJECT_NUM: $PROJECT_TITLE

**GitHub Project:** $PROJECT_URL

### Phase Summary
[Generated from orchestration-state.json — list each phase with title and Done status]

## Acceptance Validation

[If --merge: "Skipped (--merge flag)"]
[If full validation:
- All items Done: Yes
- Project review: Passed
- Builds: Passed
- Tests: Passed
]

## Conflict Resolution Log

[If no conflicts: "Clean merge — no conflicts."]
[If conflicts resolved: list each file with strategy and rationale]

## Stats

- Files changed: $FILES_CHANGED
- Insertions: $INSERTIONS
- Deletions: $DELETIONS

---
Generated by `/project-integrate`
PREOF
)"
```

**IMPORTANT:** Build the PR body dynamically from actual integration state. The template above shows the structure — populate it with real data from `integration-state.json` and `orchestration-state.json`. Use a HEREDOC with proper variable substitution.

Capture the PR number and URL:
```bash
PR_URL=$(gh pr view --json url -q .url)
PR_NUMBER=$(gh pr view --json number -q .number)
echo "Created PR #$PR_NUMBER: $PR_URL"
```

### 4.3 Squash Merge

```bash
gh pr merge $PR_NUMBER --squash --delete-branch \
  --subject "Integrate Project #$PROJECT_NUM: $PROJECT_TITLE (#$PR_NUMBER)"
```

### 4.4 Verify Merge

```bash
# Switch to main in the main worktree to verify
cd "$MAIN_WORKTREE"
git pull origin main
MERGE_COMMIT=$(git log -1 --format="%H" main)
MERGE_SUBJECT=$(git log -1 --format="%s" main)

echo "Merge commit: $MERGE_COMMIT"
echo "Subject: $MERGE_SUBJECT"
```

### 4.5 Update State

Update `integration-state.json`:
- `phases_completed`: add `"integration"`
- `current_phase`: `"cleanup"`
- `pr_number`: actual PR number
- `pr_url`: actual PR URL
- `merge_commit`: SHA from main

---

## PHASE 5: CLEANUP

### 5.1 Remove Worktree

```bash
cd "$MAIN_WORKTREE"

# Remove the project worktree
git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || true
git worktree prune

echo "Worktree removed: $WORKTREE_PATH"
```

### 5.2 Update Orchestration State

Read `projects/$SLUG/orchestration-state.json` and add integration metadata:

```json
{
  "...existing fields...",
  "integration": {
    "integrated_at": "<ISO-8601 timestamp>",
    "pr_number": <number>,
    "pr_url": "<url>",
    "merge_commit_sha": "<sha>",
    "integrated_by": "project-integrate"
  }
}
```

### 5.3 Finalize Integration State

Update `integration-state.json`:
- `phases_completed`: add `"cleanup"`
- `current_phase`: `"complete"`
- `completed_at`: ISO-8601 timestamp

### 5.4 Print Summary

```
PROJECT INTEGRATED

Project: #$PROJECT_NUM - $PROJECT_TITLE
PR: #$PR_NUMBER ($PR_URL)
Merge Commit: $MERGE_COMMIT
Files Changed: $FILES_CHANGED
Insertions: +$INSERTIONS
Deletions: -$DELETIONS
Conflicts Resolved: [count or "none"]
Worktree: Removed

Integration complete. Project #$PROJECT_NUM is now on main.
```

**The final line MUST be exactly:**
```
PROJECT INTEGRATED
```

This marker is used by hooks and automation to detect successful integration.

---

## CRITICAL RULES

### Safety
- **NEVER force-push.** The project branch has been pushed multiple times during orchestration.
- **NEVER rebase** the project branch. Always merge.
- **NEVER skip validation** unless `--merge` flag was explicitly passed. Without `--merge`: if items aren't Done, abort. If builds fail, abort.
- **NEVER proceed past a Tier 3 escalation.** If AI conflict resolution fails twice, stop.

### Git
- All merge operations use `git merge`, never `git rebase`
- Integration into main is via **squash merge** through a PR (preserves full history in PR, clean single commit on main)
- The `--delete-branch` flag on merge removes the remote branch automatically

### State
- **Always write state before and after each phase.** This enables resumability.
- On re-run, skip phases listed in `phases_completed`.
- If a phase is interrupted, it will be re-run from the beginning of that phase (phases are designed to be idempotent).

### Abort Conditions
Integration aborts immediately if:
1. No worktree found for the project
2. Any project item is not "Done" *(skipped with `--merge`)*
3. Project review identifies critical failures *(skipped with `--merge`)*
4. Builds fail (pre-merge or post-conflict-resolution) *(skipped with `--merge`, but post-conflict builds still run)*
5. Tests fail *(skipped with `--merge`)*
6. Conflict resolution fails after 2 attempts (Tier 3 escalation)

On abort: update `integration-state.json` with current phase so re-run can resume.

---

## CONFLICT RESOLUTION REFERENCE

### Tier 0 - No Conflicts
`git merge origin/main` succeeds cleanly. Proceed immediately.

### Tier 1 - Mechanical (no AI)
| File Pattern | Strategy |
|---|---|
| `pnpm-lock.yaml`, `package-lock.json` | Accept project's `package.json`, regenerate lock file |
| `out/`, `dist/` (build artifacts) | Accept project side, will rebuild |
| `.DS_Store`, OS files | Accept either side |

### Tier 2 - AI-Assisted
For each conflicting source file:
1. Read project PRD for intent context
2. Compare both sides' change history for the file
3. Resolve semantically: incorporate both sides where possible, prefer project for overlapping changes
4. Validate with build after resolution

### Tier 3 - Human Escalation
After 2 failed AI resolution attempts:
- Present detailed conflict analysis
- Show attempted resolutions and why they failed
- Provide specific guidance for manual resolution
- ABORT and save state for re-run

---

## EXECUTION START

**Project Number:** $PROJECT_NUM
**Merge Only:** $MERGE_ONLY
**Action:** Begin integration pipeline

Check for existing `integration-state.json` and either resume or start fresh.

Begin Phase 1: Pre-flight.
