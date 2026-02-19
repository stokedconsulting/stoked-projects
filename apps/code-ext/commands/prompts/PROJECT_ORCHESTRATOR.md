# Project Orchestration Prompt

Automated workflow for: Problem Description → PFB → PRD → GitHub Project with Issues

---

## Orchestration Prompt

```
ORCHESTRATE FULL PROJECT SETUP FROM PROBLEM DESCRIPTION TO GITHUB PROJECT

**INPUT REQUIRED:**
- Problem description (what problem are we solving and for whom?)

**OUTPUT DELIVERABLES:**
1. Product Feature Brief (PFB) at ./projects/[slug]/pfb.md
2. Product Requirements Document (PRD) at ./projects/[slug]/prd.md
3. GitHub Project with structured issues (fully linked)
4. Orchestration state file for tracking
5. Summary report with all links and references

---

## EXECUTION WORKFLOW

Use TodoWrite to track these 6 stages:
- [ ] Stage 0: Problem Description Preprocessing (if needed - large inputs)
- [ ] Stage 1: Title Generation & Setup
- [ ] Stage 2: Product Feature Brief Generation
- [ ] Stage 3: Product Requirements Document Generation
- [ ] Stage 4: GitHub Project Creation & ID Retrieval
- [ ] Stage 5: Issue Generation & GraphQL Linking

---

## STAGE 0: PROBLEM DESCRIPTION PREPROCESSING (Optional)

**Purpose:** Handle large problem descriptions by creating structured summaries

**When to run:** If problem description exceeds 350 words OR has high structural complexity

**Steps:**

1. Count words in problem description:
   ```bash
   WORD_COUNT=$(echo "$PROBLEM_DESCRIPTION" | wc -w | tr -d ' ')
   echo "Problem description: $WORD_COUNT words"
   ```

2. **If WORD_COUNT > 350** (Large description - needs preprocessing):

   a. Generate temporary slug for directory:
      ```bash
      TEMP_SLUG=$(echo "$PROBLEM_DESCRIPTION" | head -c 100 | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/-\+/-/g' | sed 's/^-//;s/-$//')
      mkdir -p "./projects/$TEMP_SLUG"
      ```

   b. Store full description:
      ```bash
      cat > "./projects/$TEMP_SLUG/problem-description-full.md" <<EOF
# Full Problem Description

$PROBLEM_DESCRIPTION

---
**Created:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Word Count:** $WORD_COUNT words
EOF
      ```

   c. Generate concise summary using focused prompt:
      ```
      Task(
        subagent_type="general-purpose",
        prompt="""
GENERATE CONCISE PROBLEM SUMMARY

**Original Problem Description:**
See file: ./projects/$TEMP_SLUG/problem-description-full.md

Read the full description and create a concise summary (200-300 words) that captures:

## Output Format

# Problem Summary

## Core Problem
[2-3 sentences: What needs to be built/solved]

## Key Requirements
- [Requirement 1 - most critical]
- [Requirement 2]
- [Requirement 3]
- [Requirement 4]
- [Requirement 5]

## Primary Users
[1-2 sentences: Who will use this]

## Success Criteria
[2-3 measurable outcomes]

---

**IMPORTANT:**
- Keep total summary under 300 words
- Focus on WHAT to build, not HOW
- Preserve critical context about scale/complexity
- Omit implementation details, nice-to-haves, future considerations
- Save output to: ./projects/$TEMP_SLUG/problem-description-summary.md
        """,
        description="Generate problem summary",
        max_turns=10
      )
      ```

   d. Validate summary:
      - Check file exists: `./projects/$TEMP_SLUG/problem-description-summary.md`
      - Verify word count < 350 words
      - Ensure all 4 sections present

   e. Set flag to use summary in later stages:
      ```bash
      USING_SUMMARY=true
      PROBLEM_FOR_ORCHESTRATION=$(cat "./projects/$TEMP_SLUG/problem-description-summary.md")
      ```

3. **If WORD_COUNT <= 350** (Standard size - no preprocessing needed):
   ```bash
   USING_SUMMARY=false
   PROBLEM_FOR_ORCHESTRATION="$PROBLEM_DESCRIPTION"
   echo "Standard size - proceeding with full description"
   ```

4. Update state file (will be moved to final location in Stage 1):
   ```json
   {
     "problem_description_word_count": [count],
     "using_summary": [true/false],
     "problem_description_paths": {
       "full": "./projects/[temp-slug]/problem-description-full.md",
       "summary": "./projects/[temp-slug]/problem-description-summary.md"
     },
     "temp_slug": "[temp-slug]",
     "stages_completed": ["stage-0"]
   }
   ```

**Validation:**
- ✅ Word count calculated
- ✅ If large: Summary generated (<350 words, all sections present)
- ✅ If large: Full description stored in temp location
- ✅ PROBLEM_FOR_ORCHESTRATION variable set correctly
- ✅ State initialized

**Mark Stage 0 complete in TodoWrite**

**IMPORTANT:** All subsequent stages (1-5) should use `$PROBLEM_FOR_ORCHESTRATION` instead of the raw input.

---

## STAGE 1: TITLE GENERATION & SETUP

**Purpose:** Create project title and directory structure

**Steps:**

1. Analyze the problem description (use `$PROBLEM_FOR_ORCHESTRATION` from Stage 0):
   ```bash
   # This variable was set in Stage 0:
   # - If large input: contains summary
   # - If standard input: contains original description
   ```

2. Generate a concise, actionable title (format: [Verb] + [Noun] + [Context]):
   - Example: "Implement User Authentication System"
   - Example: "Add Real-time Chat Messaging"
   - Example: "Build Analytics Dashboard"
   - Example: "Build Multi-Agent Autonomous Project System"

3. Create slug from title:
   - Convert to lowercase
   - Replace spaces with hyphens
   - Remove special characters (keep only a-z, 0-9, hyphens)
   - Example: "Implement User Authentication System" → "implement-user-authentication-system"

4. Create final project directory: `./projects/[slug]/`

5. **If preprocessing was used (USING_SUMMARY=true):**
   - Move files from temp location to final location:
     ```bash
     mv "./projects/$TEMP_SLUG/problem-description-full.md" "./projects/$SLUG/"
     mv "./projects/$TEMP_SLUG/problem-description-summary.md" "./projects/$SLUG/"
     rmdir "./projects/$TEMP_SLUG"
     ```

6. Initialize state file: `./projects/[slug]/orchestration-state.json`
   ```json
   {
     "title": "[generated-title]",
     "slug": "[generated-slug]",
     "problem_description_word_count": [count-from-stage-0],
     "using_summary": [true/false-from-stage-0],
     "problem_description_paths": {
       "full": "./projects/[slug]/problem-description-full.md",
       "summary": "./projects/[slug]/problem-description-summary.md"
     },
     "created_at": "[timestamp]",
     "stages_completed": ["stage-0", "stage-1"]
   }
   ```

   **Note:** If preprocessing wasn't used, omit the paths and set `using_summary: false`

7. Show user the generated title and slug

**Validation:**
- ✅ Directory created at final location
- ✅ If preprocessed: Files moved from temp to final location
- ✅ State file exists
- ✅ Title is concise and actionable
- ✅ Slug is valid filesystem path
- ✅ All problem description files in correct location

**Mark Stage 1 complete in TodoWrite**

---

## STAGE 2: PRODUCT FEATURE BRIEF GENERATION

**Purpose:** Generate comprehensive PFB using subagent

**Steps:**

1. Read PFB template: `~/.claude/commands/template/PRODUCT_FEATURE_BRIEF.md`

2. Construct composite prompt for subagent:
   ```
   GENERATE PRODUCT FEATURE BRIEF

   **Project Title:** [generated-title]

   **Problem Description:**
   [If using_summary: paste summary here]
   [If not: paste original description]

   **Additional Context Available:**
   [If using_summary: For detailed requirements, see: ./projects/[slug]/problem-description-full.md]
   [If not: omit this line]

   **TASK:**
   Create a comprehensive Product Feature Brief using the template structure.

   Follow the template at: ~/.claude/commands/template/PRODUCT_FEATURE_BRIEF.md

   **REQUIRED SECTIONS (all 10 must be present):**
   1. Feature Overview (name, owner, status, target release, summary)
   2. Problem Statement (what problem, who affected, why now)
   3. Goals & Success Metrics
   4. User Experience & Scope (in/out of scope)
   5. Assumptions & Constraints
   6. Risks & Mitigations
   7. Dependencies
   8. Open Questions
   9. Non-Goals
   10. Notes & References

   **INTERACTIVE APPROACH:**
   - Ask clarifying questions for each section
   - Use the problem description as foundation
   - If full description exists, read it for additional detail
   - Mark sections as "TBD" if information is not available
   - Be thorough but allow for iteration

   **OUTPUT REQUIREMENT:**
   - Write the completed PFB to: ./projects/[slug]/pfb.md
   - Ensure all 10 sections are present
   - Use proper markdown formatting
   - In Notes & References section, link to problem description files

   **DO NOT:**
   - Make up metrics without user input
   - Skip sections (mark TBD if needed)
   - Write to any other location
   ```

3. Launch subagent using Task tool:
   ```
   Task(
     subagent_type="general-purpose",
     prompt=[composite prompt above],
     description="Generate Product Feature Brief",
     max_turns=50
   )
   ```

4. Wait for subagent completion

5. Validate output:
   - Read `./projects/[slug]/pfb.md`
   - Check file exists and is not empty
   - Verify all 10 sections present (search for "## 1." through "## 10.")
   - Check for minimum content (file > 1000 characters)

6. Update state file:
   ```json
   {
     ...existing fields,
     "pfb_path": "./projects/[slug]/pfb.md",
     "pfb_completed": true,
     "stages_completed": ["stage-1", "stage-2"]
   }
   ```

**Validation:**
- ✅ Subagent completed successfully
- ✅ PFB file exists at correct path
- ✅ All 10 sections present
- ✅ File has substantial content
- ✅ State file updated

**If validation fails:**
- Show what was found vs expected
- Attempt manual fix or re-run subagent
- Do NOT proceed to Stage 3

**Mark Stage 2 complete in TodoWrite**

---

## STAGE 3: PRODUCT REQUIREMENTS DOCUMENT GENERATION

**Purpose:** Generate sequential, testable PRD using subagent

**Steps:**

1. Read PRD template: `~/.claude/commands/template/PRODUCT_REQUIREMENTS_DOCUMENT.md`

2. Read the generated PFB: `./projects/[slug]/pfb.md`

3. Construct composite prompt for subagent:
   ```
   GENERATE PRODUCT REQUIREMENTS DOCUMENT

   **Project Title:** [generated-title]
   **Source Feature Brief:** ./projects/[slug]/pfb.md

   **FEATURE BRIEF SUMMARY:**
   [Extract key sections from PFB: Problem Statement, Goals, Scope]

   **Additional Context Available:**
   [If using_summary:]
   - Problem Summary: ./projects/[slug]/problem-description-summary.md
   - Full Problem Description: ./projects/[slug]/problem-description-full.md
   [If not using_summary: omit these lines]

   **TASK:**
   Create a comprehensive Product Requirements Document with sequential execution phases.

   Read the source documents above for full context.

   Follow the template at: ~/.claude/commands/template/PRODUCT_REQUIREMENTS_DOCUMENT.md

   **REQUIRED STRUCTURE:**
   - Section 0: Source Context (reference to PFB)
   - Section 1: Objectives & Constraints (from PFB)
   - Section 1.5: Required Toolchain (tools, runtimes, SDKs needed — with install/verify commands)
   - Section 2: Execution Phases (main content)
     * Each Phase: Purpose statement
     * Each Phase: 1-5 Work Items
     * Each Work Item: Implementation Details
     * Each Work Item: Acceptance Criteria (Structural + Executable — at least one Executable per item)
     * Each Work Item: Acceptance Tests (specific tests)
     * Each Work Item: Verification Commands (literal bash commands that must exit 0)
   - Section 3: Completion Criteria
   - Section 4: Rollout & Validation
   - Section 5: Open Questions

   **PHASE SEQUENCING:**
   - Phases must be sequential (Phase 2 depends on Phase 1)
   - Typical: 2-5 phases (Foundation → Core → Integration → Polish)
   - Each phase builds on previous capabilities

   **ACCEPTANCE CRITERIA FORMAT:**
   - AC-[Phase].[Item].[Letter]: Condition → Expected Outcome
   - Example: AC-1.1.a: When user submits valid form → data saved to database within 200ms
   - Must be measurable and testable

   **ACCEPTANCE TEST FORMAT:**
   - Test-[Phase].[Item].[Letter]: Test type + validation
   - Example: Test-1.1.a: Unit test validates form data transformation
   - Must map 1:1 to acceptance criteria

   **INTERACTIVE APPROACH:**
   - Ask clarifying questions about implementation approach
   - Break complex features into logical phases
   - Define clear acceptance criteria for each work item
   - Ensure testability at every level

   **OUTPUT REQUIREMENT:**
   - Write the completed PRD to: ./projects/[slug]/prd.md
   - Ensure all sections present
   - Use proper markdown formatting
   - Maintain hierarchical numbering (Phase 1, 1.1, 1.2, Phase 2, 2.1, etc.)
   ```

4. Launch subagent using Task tool:
   ```
   Task(
     subagent_type="general-purpose",
     prompt=[composite prompt above],
     description="Generate Product Requirements Document",
     max_turns=60
   )
   ```

5. Wait for subagent completion

6. Validate output:
   - Read `./projects/[slug]/prd.md`
   - Check file exists and is not empty
   - Verify phase structure exists (search for "## Phase 1:", "## Phase 2:", etc.)
   - Verify work items exist (search for "### 1.1", "### 1.2", etc.)
   - Check for minimum content (file > 2000 characters)

7. Parse PRD to extract phases and work items:
   - Use regex: `## Phase (\d+): (.+)` to find phases
   - Use regex: `### (\d+\.\d+) (.+)` to find work items
   - Build structured data:
     ```json
     {
       "phases": [
         {
           "number": 1,
           "title": "Foundation",
           "work_items": [
             {"number": "1.1", "title": "Database Schema Setup"},
             {"number": "1.2", "title": "Model Definitions"}
           ]
         }
       ]
     }
     ```

8. Update state file:
   ```json
   {
     ...existing fields,
     "prd_path": "./projects/[slug]/prd.md",
     "prd_completed": true,
     "phases": [parsed phase data],
     "stages_completed": ["stage-1", "stage-2", "stage-3"]
   }
   ```

**Validation:**
- ✅ Subagent completed successfully
- ✅ PRD file exists at correct path
- ✅ Phase structure present
- ✅ Work items identified and parsed
- ✅ File has substantial content
- ✅ State file updated with parsed data

**If validation fails:**
- Show PRD structure found
- Attempt manual parsing
- Do NOT proceed to Stage 4

**Mark Stage 3 complete in TodoWrite**

---

## STAGE 4: GITHUB PROJECT CREATION VIA MCP

**Purpose:** Create GitHub Project using MCP tools (which emit real-time WebSocket events to the extension)

**Steps:**

1. Detect repository owner from current git remote:
   ```bash
   REPO_FULL=$(git remote get-url origin | grep -oE '[^/:]+/[^/]+\.git' | sed 's/\.git$//')
   REPO_OWNER=$(echo "$REPO_FULL" | cut -d'/' -f1)
   REPO_NAME=$(echo "$REPO_FULL" | cut -d'/' -f2)
   ```
   This extracts the owner (e.g., "stokedconsulting") and repo name (e.g., "des.irable.v3")

2. **Create GitHub Project using MCP tool `github_create_project`:**
   Call the MCP tool with:
   - `owner`: REPO_OWNER (detected above)
   - `name`: [generated-title]
   - `body`: (optional project description)

   The tool returns: `{ success: true, project: { id, number, url, title } }`
   **This automatically emits a `project.created` WebSocket event to the extension.**

   Extract from the response:
   - `PROJECT_ID` (starts with PVT_)
   - `PROJECT_NUMBER`
   - `PROJECT_URL`

3. **Link project to repository using MCP tool `github_link_project`:**
   **DEFAULT BEHAVIOR: ALWAYS link the project to the current repository unless the user explicitly requests otherwise.**
   Call the MCP tool with:
   - `projectId`: PROJECT_ID (from step 2)
   - `owner`: REPO_OWNER
   - `repo`: REPO_NAME

4. **Notify extension using MCP tool `notify_project_created`:**
   Call the MCP tool with:
   - `projectNumber`: PROJECT_NUMBER
   - `title`: [generated-title]
   - `owner`: REPO_OWNER
   - `repo`: REPO_NAME
   - `url`: PROJECT_URL

   This sends a second notification to ensure the extension picks up the new project.

5. Store project details in state file:
   ```json
   {
     ...existing fields,
     "repo_owner": "[repo-owner]",
     "repo_name": "[repo-name]",
     "project_number": [number],
     "project_id": "[PVT_...]",
     "project_url": "https://github.com/orgs/[repo-owner]/projects/[number]",
     "stages_completed": ["stage-1", "stage-2", "stage-3", "stage-4"]
   }
   ```

6. Show user the project URL

**Validation:**
- Project created (MCP tool returned success)
- Project number and ID (PVT_*) extracted
- Project linked to repository
- Extension notified (project appears in sidebar)
- State file updated

**If validation fails:**
- Check GitHub token/permissions
- Verify organization access
- Show specific error from MCP tool response
- Do NOT proceed to Stage 5

**Mark Stage 4 complete in TodoWrite**

---

## STAGE 5: ISSUE GENERATION VIA MCP (Real-Time Extension Updates)

**Purpose:** Create GitHub issues for all phases and work items using MCP tools. Each issue creation emits a WebSocket event so the extension shows issues appearing one-by-one in real time.

**IMPORTANT:**
- Use MCP tool `github_create_issue` for each issue (emits `issue.created` event)
- Use MCP tool `github_link_issue_to_project` to add each issue to the project (emits `issue.updated` event)
- Always pass `projectNumber` to enable real-time notifications
- The extension will update its UI after each issue creation — no polling needed

**Steps:**

### PRE-STEP: Read Project Requirements

Before creating any issues, read project-level requirements that should be incorporated into issue descriptions. These files contain cross-cutting standards, conventions, or constraints that apply to all project items.

1. **Read global project requirements** (if exists):
   - Path: `~/.claude-projects/projects.md`
   - Read the file. If it does not exist, skip — this is optional.
   - Store content as `GLOBAL_PROJECT_REQUIREMENTS`

2. **Read workspace project requirements** (if exists):
   - Path: `[workspaceRoot]/.claude-projects/projects.md` (use the current working directory)
   - Read the file. If it does not exist, skip — this is optional.
   - Store content as `WORKSPACE_PROJECT_REQUIREMENTS`

3. **Merge requirements:**
   - If both exist, combine them (global first, then workspace — workspace can override/extend global)
   - If only one exists, use that one
   - If neither exists, proceed without additional requirements
   - Store the merged content as `PROJECT_REQUIREMENTS`

4. **Apply requirements to issue bodies:**
   - If `PROJECT_REQUIREMENTS` is non-empty, append a `## Project Requirements` section to **every** issue body (both master phase issues and work item issues) containing the merged requirements content
   - Format:
     ```markdown
     ## Project Requirements
     [content from merged PROJECT_REQUIREMENTS]
     ```
   - This section goes before the final `---` / `Parent issue:` line in each issue body

### PART A: Create and Link Issues (One at a Time for Real-Time Updates)

For each issue (masters first, then work items), do BOTH create AND link before moving to the next issue. This way the extension shows each issue appearing in the project as it's created.

1. **Create Master Phase Issues**

   For each phase in parsed PRD data:

   Title format: `(Phase [#]) - [phase-title] - MASTER`
   Example: `(Phase 1) - Component Analysis Foundation - MASTER`

   Body format:
   ```markdown
   ## Phase [#]: [phase-title]

   **Purpose:** [Extract from PRD Phase purpose statement]

   **Part of Project:** [project-title]

   **Related Documents:**
   - Product Feature Brief: `./projects/[slug]/pfb.md`
   - Product Requirements Document: `./projects/[slug]/prd.md` (Section: Phase [#])

   **Work Items in this Phase:**
   - [ ] [#.1] [work-item-title-1]
   - [ ] [#.2] [work-item-title-2]
   - [ ] [#.3] [work-item-title-3]

   **Completion Criteria:**
   All work items in this phase must be complete before moving to Phase [#+1].

   ---

   This is a MASTER issue for Phase [#]. See child issues for specific work items.
   ```

   **Step A: Create issue using MCP tool `github_create_issue`:**
   - `owner`: REPO_OWNER
   - `repo`: REPO_NAME
   - `title`: "(Phase [#]) - [phase-title] - MASTER"
   - `body`: [formatted body]
   - `projectNumber`: PROJECT_NUMBER

   The tool returns `{ success: true, issue: { number, id, url, title, state } }`
   **This automatically emits `issue.created` → extension updates in real time.**

   Store the issue `number` and `id` (node ID) from the response.

   **Step B: Link issue to project using MCP tool `github_link_issue_to_project`:**
   - `projectId`: PROJECT_ID (PVT_* from Stage 4)
   - `issueId`: [issue node ID from Step A]
   - `projectNumber`: PROJECT_NUMBER
   - `issueNumber`: [issue number from Step A]

   **This emits `issue.updated` → extension refreshes to show issue in project.**

2. **Create Work Item Issues**

   For each work item in phase:

   Title format: `(Phase [#].[X]) - [work-item-title]`
   Example: `(Phase 1.1) - Component Scanner and AST Parser`

   Body format:
   ```markdown
   ## Work Item [#.X]: [work-item-title]

   **Phase:** [#] - [phase-title]
   **Part of Project:** [project-title]

   **Related Documents:**
   - Product Feature Brief: `./projects/[slug]/pfb.md`
   - Product Requirements Document: `./projects/[slug]/prd.md` (Phase [#], Work Item [#.X])

   ---

   ## Implementation Details
   [Extract from PRD Work Item Implementation Details section - full content]

   ## Acceptance Criteria
   [Extract from PRD Work Item Acceptance Criteria section - full content]

   ## Acceptance Tests
   [Extract from PRD Work Item Acceptance Tests section - full content]

   ## Verification Commands
   [Extract from PRD Work Item Verification Commands section - literal bash commands]
   ```bash
   # These commands MUST exit 0 for this work item to be considered done
   [command 1]
   [command 2]
   ```

   ---

   Parent issue: #[master-issue-number]
   ```

   **Step A: Create issue using MCP tool `github_create_issue`:**
   - `owner`: REPO_OWNER
   - `repo`: REPO_NAME
   - `title`: "(Phase [#].[X]) - [work-item-title]"
   - `body`: [formatted body with parent reference]
   - `projectNumber`: PROJECT_NUMBER

   **Step B: Link issue to project using MCP tool `github_link_issue_to_project`:**
   - `projectId`: PROJECT_ID
   - `issueId`: [issue node ID from Step A]
   - `projectNumber`: PROJECT_NUMBER
   - `issueNumber`: [issue number from Step A]

3. **Update State File with Issue Numbers**
   ```json
   {
     ...existing fields,
     "master_issues": {
       "phase-1": { "number": 1489, "id": "I_..." },
       "phase-2": { "number": 1490, "id": "I_..." }
     },
     "work_item_issues": {
       "1.1": { "number": 1494, "id": "I_..." },
       "1.2": { "number": 1495, "id": "I_..." }
     }
   }
   ```

### PART B: Verify and Complete

4. **Verify using MCP tool `read_project`:**
   Call with `projectNumber`: PROJECT_NUMBER
   Check that the returned project has the expected number of items.

5. **Update State File - Mark Complete**
   ```json
   {
     ...existing fields,
     "stages_completed": ["stage-1", "stage-2", "stage-3", "stage-4", "stage-5"],
     "total_issues_created": [count],
     "all_issues_linked_to_project": true,
     "completion_date": "[timestamp]"
   }
   ```

6. **Generate Summary Report:** `./projects/[slug]/ORCHESTRATION_SUMMARY.md`

**Validation:**
- All master issues created (MCP tool returned success for each)
- All work item issues created
- Parent references added to work item bodies
- All issues linked to project (MCP tool returned success for each)
- Extension shows all issues in real-time (no manual refresh needed)
- State file has all issue numbers and node IDs
- Summary report generated

**If validation fails:**
- Show which issues failed (MCP tool error response)
- Retry failed issues using the same MCP tools
- Do NOT mark Stage 5 as complete until all issues are created and linked

**Mark Stage 5 complete in TodoWrite**

---

## FINAL SUMMARY REPORT

Generate: `./projects/[slug]/ORCHESTRATION_SUMMARY.md`

```markdown
# Project Orchestration Summary

**Project:** [title]
**Created:** [timestamp]

## Documents Generated
- ✅ Product Feature Brief: `./projects/[slug]/pfb.md`
- ✅ Product Requirements Document: `./projects/[slug]/prd.md`
[If using_summary:]
- ✅ Problem Description (Summary): `./projects/[slug]/problem-description-summary.md`
- ✅ Problem Description (Full): `./projects/[slug]/problem-description-full.md`

## GitHub Project
- **Project URL:** https://github.com/orgs/[repo-owner]/projects/[number]
- **Project Number:** [number]
- **Project ID:** [id - starts with PVT_]
- **Repository:** [repo-owner]/[repo-name]
- **Total Items:** [count] ([master-count] master + [work-item-count] work items)

## Issues Created

### Master Phase Issues
- Phase 1: #[issue-number] - [title]
- Phase 2: #[issue-number] - [title]
- Phase 3: #[issue-number] - [title]

### Work Item Issues
**Phase 1:**
- 1.1: #[issue-number] - [title]
- 1.2: #[issue-number] - [title]

**Phase 2:**
- 2.1: #[issue-number] - [title]
- 2.2: #[issue-number] - [title]

**Phase 3:**
- 3.1: #[issue-number] - [title]

## Linking Status
- ✅ All issues successfully linked to project
- ✅ Project board accessible with all items visible
- ✅ Ready for team assignment and implementation

## Next Steps
1. Review Product Feature Brief: `./projects/[slug]/pfb.md`
2. Review Product Requirements Document: `./projects/[slug]/prd.md`
3. Visit project board: https://github.com/orgs/[repo-owner]/projects/[number]
4. Assign team members to issues
5. Set priority and size estimates using project fields
6. Begin Phase 1 implementation
7. Execute project using: `/gh-project [number]`

## State File
All orchestration state saved to: `./projects/[slug]/orchestration-state.json`

---

**Orchestration Complete! 🚀**
```

Display this summary to the user with all links clickable.

---

## ERROR HANDLING

**Subagent Failures:**
- Capture error message
- Show to user
- Offer to retry with clarifications
- Do NOT proceed to next stage

**File Validation Failures:**
- Show what was expected vs what exists
- Offer to manually create/fix
- Do NOT proceed to next stage

**MCP Tool Failures:**
- Check GITHUB_TOKEN is set in MCP server environment
- Verify permissions: User must have write access to org/repo
- Show the specific error from the MCP tool response (`isError: true` responses)
- Retry the failed MCP tool call with the same parameters

**Project ID Extraction Failures:**
- The `github_create_project` MCP tool returns `{ id, number, url, title }` directly
- Project ID must start with "PVT_"
- If the tool fails, check MCP server logs for details
- If still fails, stop and ask user to verify GitHub token permissions

**Issue Creation/Linking Failures:**
- If `github_create_issue` fails for a specific issue, retry before moving on
- If `github_link_issue_to_project` fails, retry with the same issueId and projectId
- Track failed issues in the state file
- At end, retry all failed issues before marking complete

**Parsing Failures:**
- Show PRD structure found
- Ask user to manually specify phases/work items
- Offer to continue with manual input

**Resumability:**
- Check for existing state file before starting
- If found, ask user: "Resume from [last-stage] or start fresh?"
- If resuming, skip completed stages
- Re-validate files before proceeding
- If resuming Stage 5, check which issues already exist to avoid duplicates

---

## QUALITY CRITERIA

Before declaring orchestration complete, verify:
- ✅ All 5 stages marked complete in TodoWrite
- ✅ PFB file exists with 10 sections
- ✅ PRD file exists with phases and work items
- ✅ GitHub project created and accessible
- ✅ Project ID (PVT_*) retrieved and stored
- ✅ All master issues created (one per phase)
- ✅ All work item issues created (one per work item)
- ✅ Parent-child relationships established (parent issue references in work item bodies)
- ✅ All issues linked to project via MCP tools (verified by read_project)
- ✅ State file complete with all data (issue numbers, project details)
- ✅ Summary report generated
- ✅ User can access all resources via URLs

---

## EXECUTION CHECKLIST

- [ ] User provided problem description
- [ ] Stage 1: Title generation and setup complete
- [ ] Stage 2: PFB generated and validated (10 sections)
- [ ] Stage 3: PRD generated and validated (phases + work items parsed)
- [ ] Stage 4: GitHub project created, ID retrieved (PVT_*)
- [ ] Stage 5A: All issues created (master + work items)
- [ ] Stage 5B: All issues linked via GraphQL API
- [ ] Stage 5C: Linking verified (item count matches)
- [ ] Summary report generated
- [ ] All files accessible
- [ ] All URLs working
- [ ] User informed of next steps

---
```

---

## Usage

Copy the orchestration prompt above and provide your problem description:

```
[Paste orchestration prompt]

PROBLEM DESCRIPTION:
We need to add real-time video streaming capabilities to our social media platform.
Users should be able to go live, viewers should be able to watch with minimal latency,
and we need to support chat during streams. The system should scale to handle thousands
of concurrent viewers per stream.
```

The orchestrator will:
1. Generate title (e.g., "Implement Real-time Video Streaming")
2. Create PFB through interactive discovery
3. Create PRD with technical breakdown
4. Create GitHub project and retrieve project ID
5. Generate all phase and work item issues
6. Link all issues to project using GraphQL API
7. Verify all links successful
8. Provide complete summary with links

## Expected Timeline

- **Stage 1**: ~30 seconds
- **Stage 2**: 2-4 minutes (interactive PFB generation)
- **Stage 3**: 3-6 minutes (interactive PRD generation)
- **Stage 4**: ~10 seconds (project creation + ID retrieval)
- **Stage 5**: ~1-2 minutes (issue creation + GraphQL linking)

**Total**: ~10-15 minutes for complete orchestration

## Files Generated

```
./projects/[slug]/
├── pfb.md                               # Product Feature Brief
├── prd.md                               # Product Requirements Document
├── orchestration-state.json             # State tracking with all IDs
├── ORCHESTRATION_SUMMARY.md             # Summary report
└── (if large input:)
    ├── problem-description-summary.md   # Concise summary (200-300 words)
    └── problem-description-full.md      # Complete original description
```

## Key Improvements in This Version

### 1. **MCP Tools for Project Creation (Stage 4)**
- Uses `github_create_project` MCP tool for reliable structured output
- Extracts project ID (PVT_*) directly from tool response
- Emits `project.created` WebSocket event — extension sees new project immediately

### 2. **MCP Tools for Issue Creation & Linking (Stage 5)**
- Uses `github_create_issue` MCP tool (emits `issue.created` event per issue)
- Uses `github_link_issue_to_project` MCP tool (emits `issue.updated` event)
- Extension shows issues appearing one-by-one in real time — no polling
- Verifies linking via `read_project` MCP tool

### 3. **Proper Naming Conventions**
- Master issues: `(Phase X) - Title - MASTER`
- Work items: `(Phase X.Y) - Title`
- Parent references: `Parent issue: #XXXX` in body

### 4. **Robust Error Handling**
- Validates project ID format (must start with PVT_)
- Tracks linking failures individually
- Provides manual commands for failed operations
- Verifies final item count matches expected

### 5. **Complete State Tracking**
- Stores project ID for resumability
- Tracks all issue numbers
- Records linking status
- Enables full project recovery if interrupted

## Benefits

- **Automated**: Single command to full project setup
- **Reliable**: Uses MCP tools with structured responses instead of CLI parsing
- **Real-time**: Extension updates live as each issue is created via WebSocket events
- **Consistent**: Uses standard templates and naming conventions
- **Traceable**: All artifacts linked together with full audit trail
- **Resumable**: Can continue if interrupted
- **Verifiable**: Checks item count to confirm all issues linked
- **Comprehensive**: No manual steps required
