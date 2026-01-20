#!/bin/bash

# Configuration
REPO_OWNER="stokedconsulting"
REPO_NAME="claude-projects"
PROJECT_ID="PVT_kwDOBW_6Ns4BM-sD"
PROJECT_NUMBER=70
PROJECT_TITLE="Build Claude Projects State Tracking API"
SLUG="build-claude-projects-state-tracking-api"

# Function to add issue to project using GraphQL
add_issue_to_project() {
  local issue_number=$1
  local project_id=$2

  echo "  Linking issue #$issue_number to project..."

  # Get the issue node ID
  issue_id=$(gh api graphql -f query="
    query {
      repository(owner: \"$REPO_OWNER\", name: \"$REPO_NAME\") {
        issue(number: $issue_number) {
          id
        }
      }
    }
  " --jq '.data.repository.issue.id')

  # Add to project using GraphQL mutation
  gh api graphql -f query="
    mutation {
      addProjectV2ItemById(input: {
        projectId: \"$project_id\"
        contentId: \"$issue_id\"
      }) {
        item {
          id
        }
      }
    }
  " > /dev/null 2>&1

  if [ $? -eq 0 ]; then
    echo "    ✓ Linked #$issue_number"
    return 0
  else
    echo "    ✗ Failed to link #$issue_number"
    return 1
  fi
}

# Arrays to store issue numbers
declare -A MASTER_ISSUES
declare -A WORK_ITEM_ISSUES

echo "Creating GitHub issues for: $PROJECT_TITLE"
echo "Project URL: https://github.com/orgs/$REPO_OWNER/projects/$PROJECT_NUMBER"
echo ""

# ============================================================================
# PHASE 1: Foundation & Database Schema
# ============================================================================
echo "Creating Phase 1 issues..."

PHASE1_BODY="$(cat <<'EOF'
## Phase 1: Foundation & Database Schema

**Purpose:** Establish the foundational database schema and data models that all subsequent API endpoints and business logic depend on. Without properly designed schemas and indexes, we cannot reliably track session state or enable recovery operations.

**Part of Project:** Build Claude Projects State Tracking API

**Related Documents:**
- Product Feature Brief: \`./projects/build-claude-projects-state-tracking-api/pfb.md\`
- Product Requirements Document: \`./projects/build-claude-projects-state-tracking-api/prd.md\` (Section: Phase 1)

**Work Items in this Phase:**
- [ ] 1.1 MongoDB Schema Design & Models
- [ ] 1.2 NestJS Project Setup & Structure
- [ ] 1.3 API Key Authentication Implementation
- [ ] 1.4 SST Infrastructure Configuration

**Completion Criteria:**
All work items in this phase must be complete before moving to Phase 2.

---

This is a MASTER issue for Phase 1. See child issues for specific work items.
EOF
)"

ISSUE_URL=$(gh issue create \
  --repo "$REPO_OWNER/$REPO_NAME" \
  --title "(Phase 1) - Foundation & Database Schema - MASTER" \
  --body "$PHASE1_BODY")

MASTER_ISSUES[1]=$(echo "$ISSUE_URL" | grep -oE '[0-9]+$')
echo "  Created Master Issue #${MASTER_ISSUES[1]}"

# Phase 1 Work Items - will create after reading detailed content from PRD
echo "  Phase 1 master issue created. Work items will be created next..."

echo ""
echo "Issue creation script ready. Master issue #${MASTER_ISSUES[1]} created."
echo "Additional work items and phases will be created in subsequent steps."
