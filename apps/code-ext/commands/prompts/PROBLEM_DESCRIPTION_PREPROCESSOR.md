# Problem Description Preprocessor

Handles large problem descriptions by creating structured summaries for efficient orchestration.

---

## Purpose

When problem descriptions are large (>500 words), this preprocessor:
1. Analyzes the full description
2. Creates a concise summary (200-300 words)
3. Stores the full description as reference
4. Passes only the summary to orchestration

This prevents context overflow while preserving all details.

---

## Processing Logic

### Step 1: Size Detection

```bash
# Count words in problem description
WORD_COUNT=$(echo "$PROBLEM_DESCRIPTION" | wc -w | tr -d ' ')

if [ $WORD_COUNT -gt 500 ]; then
  echo "Large problem description detected ($WORD_COUNT words)"
  echo "Creating structured summary..."
  NEEDS_PREPROCESSING=true
else
  echo "Standard size problem description ($WORD_COUNT words)"
  NEEDS_PREPROCESSING=false
fi
```

### Step 2: Summary Generation (if needed)

If `NEEDS_PREPROCESSING=true`, use a focused prompt to create summary:

```
GENERATE CONCISE PROBLEM SUMMARY

**Original Problem Description:**
[full problem description - may be 1000+ words]

**TASK:**
Create a concise summary (200-300 words) that captures:
1. **Core Problem**: What needs to be built/solved
2. **Key Requirements**: 3-5 essential requirements
3. **Primary Users**: Who will use this
4. **Success Criteria**: How we'll know it works

**OUTPUT FORMAT:**
# Problem Summary

## Core Problem
[2-3 sentences describing what needs to be built]

## Key Requirements
- [Requirement 1]
- [Requirement 2]
- [Requirement 3]
- [Requirement 4]
- [Requirement 5]

## Primary Users
[1-2 sentences about target users]

## Success Criteria
[2-3 measurable outcomes]

---

**IMPORTANT:**
- Keep total summary under 300 words
- Focus on what to build, not implementation details
- Preserve critical context about scale/complexity
- Omit nice-to-haves and future considerations
```

### Step 3: File Storage

Store both versions in project directory:

```bash
# Create project directory early
SLUG="[generated-from-title]"
mkdir -p "./projects/$SLUG"

# Store full description
cat > "./projects/$SLUG/problem-description-full.md" <<EOF
# Full Problem Description

This is the complete, unabridged problem description provided by the user.
Use this as authoritative source when detailed context is needed.

---

$PROBLEM_DESCRIPTION

---

**Created:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Word Count:** $WORD_COUNT words
EOF

# Store summary (if created)
if [ "$NEEDS_PREPROCESSING" = true ]; then
  cat > "./projects/$SLUG/problem-description-summary.md" <<EOF
# Problem Summary

This is a concise summary used for orchestration and planning.
See \`problem-description-full.md\` for complete details.

---

$PROBLEM_SUMMARY

---

**Created:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Source:** problem-description-full.md ($WORD_COUNT words)
EOF
fi
```

### Step 4: Orchestration Integration

Modify orchestration to reference files:

**For PFB Generation (Stage 2):**
```markdown
**Project Title:** [generated-title]

**Problem Summary:**
[If preprocessed: contents of problem-description-summary.md]
[If not: original problem description]

**Full Context Available:**
For detailed requirements and context, see:
- Full problem description: `./projects/[slug]/problem-description-full.md`

**TASK:**
Create a comprehensive Product Feature Brief...
[rest of PFB generation prompt]
```

**For PRD Generation (Stage 3):**
```markdown
**Project Title:** [generated-title]
**Source Feature Brief:** ./projects/[slug]/pfb.md

**Reference Documents:**
- Problem Summary: `./projects/[slug]/problem-description-summary.md`
- Full Problem Description: `./projects/[slug]/problem-description-full.md`

Read these files if you need additional context beyond the PFB.

**TASK:**
Create a comprehensive Product Requirements Document...
[rest of PRD generation prompt]
```

---

## Integration with PROJECT_ORCHESTRATOR

Add preprocessing as **Stage 0** before existing stages:

### Modified Workflow

```markdown
Use TodoWrite to track these 6 stages:
- [ ] Stage 0: Problem Description Preprocessing (if needed)
- [ ] Stage 1: Title Generation & Setup
- [ ] Stage 2: Product Feature Brief Generation
- [ ] Stage 3: Product Requirements Document Generation
- [ ] Stage 4: GitHub Project Creation & ID Retrieval
- [ ] Stage 5: Issue Generation & GraphQL Linking
```

### Stage 0 Implementation

**Insert before Stage 1 in PROJECT_ORCHESTRATOR.md:**

```markdown
## STAGE 0: PROBLEM DESCRIPTION PREPROCESSING (Optional)

**Purpose:** Handle large problem descriptions by creating structured summaries

**When to run:** If problem description exceeds 500 words

**Steps:**

1. Count words in problem description:
   ```bash
   WORD_COUNT=$(echo "$PROBLEM_DESCRIPTION" | wc -w | tr -d ' ')
   ```

2. If WORD_COUNT > 500:
   - Generate concise summary using focused subagent (200-300 words)
   - Store full description: `./projects/[slug]/problem-description-full.md`
   - Store summary: `./projects/[slug]/problem-description-summary.md`
   - Use summary for rest of orchestration
   - Set `USING_SUMMARY=true` in state

3. If WORD_COUNT <= 500:
   - Skip preprocessing
   - Use original description directly
   - Set `USING_SUMMARY=false` in state

4. Update state file:
   ```json
   {
     "problem_description_word_count": [count],
     "using_summary": [true/false],
     "problem_description_full_path": "./projects/[slug]/problem-description-full.md",
     "problem_description_summary_path": "./projects/[slug]/problem-description-summary.md",
     "stages_completed": ["stage-0"]
   }
   ```

**Validation:**
- ✅ Word count calculated
- ✅ If large: Summary generated and validated (<350 words)
- ✅ If large: Full description stored
- ✅ State file updated

**Mark Stage 0 complete in TodoWrite**
```

---

## Benefits

1. **Prevents Context Overflow**: Keeps orchestration prompts manageable
2. **Preserves Full Context**: Nothing is lost, just organized differently
3. **Faster Processing**: Smaller summaries process faster in subagents
4. **Better Quality**: Focused summaries help subagents stay on track
5. **Flexible**: Subagents can read full description if needed

---

## State File Schema (Updated)

```json
{
  "title": "Multi-Agent Autonomous Project System",
  "slug": "multi-agent-autonomous-project-system",
  "problem_description_word_count": 847,
  "using_summary": true,
  "problem_description_full_path": "./projects/multi-agent-autonomous-project-system/problem-description-full.md",
  "problem_description_summary_path": "./projects/multi-agent-autonomous-project-system/problem-description-summary.md",
  "created_at": "2026-01-26T10:30:00Z",
  "stages_completed": ["stage-0", "stage-1", "stage-2", "stage-3", "stage-4", "stage-5"],
  "pfb_path": "./projects/multi-agent-autonomous-project-system/pfb.md",
  "prd_path": "./projects/multi-agent-autonomous-project-system/prd.md",
  "repo_owner": "stoked-ui",
  "repo_name": "claude-projects",
  "project_number": 73,
  "project_id": "PVT_kwDOBW_6Ns4BM9XY",
  "project_url": "https://github.com/orgs/stoked-ui/projects/73",
  "master_issues": { "phase-1": 1500, "phase-2": 1501 },
  "work_item_issues": { "1.1": 1502, "1.2": 1503 },
  "total_issues_created": 10,
  "all_issues_linked_to_project": true,
  "completion_date": "2026-01-26T10:45:00Z"
}
```

---

## Example: Your Multi-Agent System Project

**Original Description:** ~850 words (including 21 category descriptions)

**Generated Summary:**
```markdown
# Problem Summary

## Core Problem
Build an autonomous multi-agent system that continuously implements, reviews,
and generates new project work for a GitHub repository. Agents should handle
existing projects, validate completed work through peer review, and autonomously
propose new projects across 21 predefined categories when no work remains.

## Key Requirements
- Workspace-configurable agent concurrency (N agents working simultaneously)
- One GitHub project per agent at a time
- Automated peer review after completion (acceptance criteria validation)
- Autonomous new project generation when queue is empty
- Support for 21 project categories (Optimization, Innovation, Architecture, etc.)
- Pre-canned prompts for each category type

## Primary Users
Development teams wanting continuous, autonomous improvement of their codebases
without manual project planning overhead.

## Success Criteria
- Agents successfully complete existing projects with quality validation
- Review agents catch acceptance criteria gaps
- Category-based project generation produces actionable GitHub projects
- System runs continuously without human intervention
```

**Full description preserved** in `problem-description-full.md` with all 21 categories detailed.

---

## Usage

This preprocessing happens automatically when using `/project-create`:

```bash
# If your problem description is large
/project-create [your 850-word description with all categories]

# Output:
# "Large problem description detected (847 words)"
# "Creating structured summary..."
# "✅ Summary created (287 words)"
# "✅ Full description stored: ./projects/[slug]/problem-description-full.md"
# "Proceeding with orchestration using summary..."
```

---

## Backward Compatibility

- Small descriptions (<500 words): No change in behavior
- Stage 0 is optional and only runs when needed
- Existing projects without preprocessing continue to work
- State file is backward compatible (new fields are optional)
