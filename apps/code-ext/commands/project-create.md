---
name: project
description: "Orchestrate full project setup: Problem → PFB → PRD → GitHub Project with Issues"
category: workflow
complexity: advanced
argument-hint: <problem-description>
allowed-tools: Bash(claude:*), Bash(gh:*), Bash(git:*), Read, Write, Grep, Glob, Task, TodoWrite
---

# /project - Full Project Orchestration

## Purpose
Takes a problem description and orchestrates the complete workflow:
1. Generate Product Feature Brief (PFB)
2. Generate Product Requirements Document (PRD)
3. Create GitHub Project
4. Generate structured issues (phases + work items)

## Usage
```
/project <problem-description OR file-path>
```

**Examples:**

Direct text (for short descriptions):
```
/project We need to implement Lightning Network payment integration for our social media platform.
```

File path (recommended for large descriptions):
```
/project ./problem-description.md
/project /absolute/path/to/description.md
/project .claude-sessions/project-input-12345.md
```

When a file path is provided, the content will be read from the file.

---

## 🎯 ORCHESTRATION WORKFLOW

Execute the full project orchestration workflow by loading and executing the PROJECT_ORCHESTRATOR.md prompt:

### Step 1: Load Orchestration Prompt

```bash
# Read the orchestration prompt
ORCHESTRATION_PROMPT=$(cat ~/.claude/commands/prompts/PROJECT_ORCHESTRATOR.md)
```

### Step 2: Execute Orchestration

The orchestration prompt will handle:

**STAGE 1: Title Generation & Setup**
- Generate actionable project title from problem description
- Create filesystem slug (lowercase, hyphens)
- Create `./projects/[slug]/` directory
- Initialize `orchestration-state.json`

**STAGE 2: Product Feature Brief Generation**
- Read template: `~/.claude/commands/template/PRODUCT_FEATURE_BRIEF.md`
- Launch subagent with composite prompt
- Output: `./projects/[slug]/pfb.md`
- Validate: All 10 sections present

**STAGE 3: Product Requirements Document Generation**
- Read template: `~/.claude/commands/template/PRODUCT_REQUIREMENTS_DOCUMENT.md`
- Read PFB from Stage 2
- Launch subagent with composite prompt
- Output: `./projects/[slug]/prd.md`
- Parse: Extract phases and work items

**STAGE 4: GitHub Project Creation**
- Detect repository owner from `git remote` (e.g., "stoked-ui" from "stoked-ui/sui")
- Create GitHub Project in the repository's organization: `gh project create --owner [DETECTED_OWNER] --title "[title]"`
- Capture project number
- Link to repository (automatic via owner detection)

**STAGE 5: Issue Generation & Linking**
- **Pre-step:** Read project requirements from `~/.claude-projects/projects.md` (global) and `[workspaceRoot]/.claude-projects/projects.md` (workspace). Either or both may be absent — skip missing files. Merged requirements are appended as a `## Project Requirements` section to every issue body.
- For each Phase: Create MASTER issue `(Phase 1) - [title] - MASTER`
- For each Work Item: Create issue `(Phase 1.1) - [title]`
- Add parent references: `Parent issue: #[master-number]`
- Extract Implementation Details, Acceptance Criteria, Acceptance Tests from PRD
- Link pfb.md and prd.md in issue descriptions
- Add all issues to project

---

## 📋 EXECUTION PATTERN

### Direct Execution (Recommended)

Load and execute the orchestration prompt directly:

```markdown
I will execute the PROJECT ORCHESTRATOR workflow for your problem description.

**Loading orchestration prompt from:**
~/.claude/commands/prompts/PROJECT_ORCHESTRATOR.md

**Problem Description:**
$ARGUMENTS

**Executing orchestration workflow...**

[The orchestration prompt takes over from here]
```

### TodoWrite Tracking

The orchestration will create a TodoWrite checklist:
- [ ] Stage 1: Title Generation & Setup
- [ ] Stage 2: Product Feature Brief Generation
- [ ] Stage 3: Product Requirements Document Generation
- [ ] Stage 4: GitHub Project Creation
- [ ] Stage 5: Issue Generation & Linking

---

## 🎯 PROMPT LOCATIONS

The orchestration uses these prompts (automatically loaded):

- **Orchestrator**: `~/.claude/commands/prompts/PROJECT_ORCHESTRATOR.md`
- **PFB Template**: `~/.claude/commands/template/PRODUCT_FEATURE_BRIEF.md`
- **PRD Template**: `~/.claude/commands/template/PRODUCT_REQUIREMENTS_DOCUMENT.md`

---

## 📦 OUTPUT DELIVERABLES

After successful orchestration:

### Files Generated
```
./projects/[slug]/
├── pfb.md                          # Product Feature Brief (10 sections)
├── prd.md                          # Product Requirements Document (phases + work items)
├── orchestration-state.json        # Complete state tracking
└── ORCHESTRATION_SUMMARY.md        # Summary with all links
```

### GitHub Resources
- **GitHub Project**: `https://github.com/orgs/stokedconsulting/projects/[N]`
- **Master Issues**: `(Phase 1) - [title] - MASTER`, `(Phase 2) - [title] - MASTER`, etc.
- **Work Item Issues**: `(Phase 1.1) - [title]`, `(Phase 1.2) - [title]`, etc.
- **Parent-Child Links**: All work items reference their parent phase

---

## 🏗️ ISSUE FORMAT

### Master Phase Issues
**Title**: `(Phase 1) - Foundation - MASTER`

**Body**:
```markdown
## Phase 1: Foundation

**Purpose:** [Extract from PRD Phase purpose statement]

**Part of Project:** [project-title]

**Related Documents:**
- Product Feature Brief: `./projects/[slug]/pfb.md`
- Product Requirements Document: `./projects/[slug]/prd.md` (Section: Phase 1)

**Work Items in this Phase:**
- [ ] 1.1 [work-item-title-1]
- [ ] 1.2 [work-item-title-2]

**Completion Criteria:**
All work items in this phase must be complete before moving to Phase 2.

---

This is a MASTER issue for Phase 1. See child issues for specific work items.
```

### Work Item Issues
**Title**: `(Phase 1.1) - Database Schema Setup`

**Body**:
```markdown
## Work Item 1.1: Database Schema Setup

**Phase:** 1 - Foundation
**Part of Project:** [project-title]

**Related Documents:**
- Product Feature Brief: `./projects/[slug]/pfb.md`
- Product Requirements Document: `./projects/[slug]/prd.md` (Phase 1, Work Item 1.1)

---

## Implementation Details
[Extracted from PRD]

## Acceptance Criteria
- AC-1.1.a: [criterion]
- AC-1.1.b: [criterion]

## Acceptance Tests
- Test-1.1.a: [test]
- Test-1.1.b: [test]

---

Parent issue: #[master-issue-number]
```

---

## ⏱️ EXPECTED TIMELINE

- **Stage 1**: ~30 seconds (title generation, directory setup)
- **Stage 2**: 2-4 minutes (interactive PFB generation)
- **Stage 3**: 3-6 minutes (interactive PRD generation)
- **Stage 4**: ~10 seconds (GitHub project creation)
- **Stage 5**: ~30 seconds (issue creation)

**Total**: ~10-15 minutes end-to-end

---

## 🔗 INTEGRATION WITH /gh-project

After `/project` completes:
1. **GitHub Project created** with project number
2. **All issues created** and linked to project
3. **Ready for execution** with `/gh-project [project-number]`

**Workflow**:
```bash
# Create project from problem description
/project We need to implement Lightning Network payments

# Orchestration generates:
# - ./projects/implement-lightning-network-payments/pfb.md
# - ./projects/implement-lightning-network-payments/prd.md
# - GitHub Project #42 with all issues

# Execute the project
/gh-project 42
```

---

## 🚨 IMPORTANT NOTES

### Validation Gates
- Each stage validates output before proceeding
- PFB must have all 10 sections
- PRD must have phases and work items
- Issues must link to parent phases
- All files must reference pfb.md and prd.md

### Resumability
- State file tracks progress: `./projects/[slug]/orchestration-state.json`
- Can resume from any failed stage
- Skips completed stages if resuming

### Error Handling
- **Subagent failures**: Retry with clarifications
- **File validation failures**: Show expected vs actual
- **GitHub CLI failures**: Check auth and permissions
- **Parsing failures**: Ask for manual input

---

## 📋 EXECUTION START

### Step 0: Resolve Input

**Raw Input:** `$ARGUMENTS`

**Input Resolution:**
1. Check if `$ARGUMENTS` looks like a file path (starts with `/`, `./`, `~`, or `.claude-sessions/`)
2. If it's a file path, read the file content using the Read tool
3. Use the file content as the problem description
4. If not a file path, use `$ARGUMENTS` directly as the problem description

```
IF $ARGUMENTS matches pattern: ^(/|\.\/|~/|\.claude-sessions/)
  THEN: Read file at $ARGUMENTS → use content as problem description
  ELSE: Use $ARGUMENTS directly as problem description
```

**Problem Description:** [resolved from above]

**Loading orchestration prompt...**

[Read and execute ~/.claude/commands/prompts/PROJECT_ORCHESTRATOR.md with the problem description as input]

---

## 🎓 COMPARISON: /project vs /gh-project

| Command | Purpose | Input | Output |
|---------|---------|-------|--------|
| `/project` | **Create** new project from problem description | Problem description | PFB + PRD + GitHub Project + Issues |
| `/gh-project` | **Execute** existing GitHub Project | Project number | Implemented features via subagents |

**Workflow**: `/project` → `/gh-project` → Complete feature implementation
