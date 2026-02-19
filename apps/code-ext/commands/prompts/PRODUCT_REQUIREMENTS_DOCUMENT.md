# Product Requirements Document (PRD) Generation Prompt

Use this prompt to create a comprehensive, sequential Product Requirements Document through interactive discovery.

---

## Prompt Text

```
Create a Product Requirements Document (PRD) following these steps:

**STEP 1: Setup & Context**
1. Read the template: ~/.claude/commands/template/PRODUCT_REQUIREMENTS_DOCUMENT.md
2. Ask for the project name (this will be used for the output path)
3. Check if a Product Feature Brief exists at: ./projects/[project-name]/pfb.md
   - If YES: Read it and use as source context for objectives and constraints
   - If NO: Ask for feature name and basic objectives

**STEP 2: Source Context** (Section 0)
Gather or reference:
- Feature name
- PRD owner (who is responsible for this document)
- Link to Feature Brief (if it exists)
- Brief summary of what this feature enables (2-3 sentences)

**STEP 3: Objectives & Constraints** (Section 1)
Ask:
- What are the primary objectives for this feature? (2-4 objectives)
- What constraints must we work within? (technical, timeline, resource, legal, etc.)

If PFB exists, pull from Goals section; if not, gather fresh.

**STEP 3.5: Required Toolchain** (Section 1.5)
Ask: "What tools, runtimes, SDKs, or system dependencies must be installed to build and test this project?"

For each tool identified, determine:
- Minimum version required
- Install command (how to get it)
- Verify command (how to confirm it's installed, e.g., `rustc --version`)

Common examples:
- Rust projects: `rustc`, `cargo`, `wasm-pack`, `wasm32-unknown-unknown` target
- Python projects: `python3`, `pip`, specific packages
- Go projects: `go`, `protoc`
- Mobile projects: `xcodebuild`, `android-sdk`
- Standard Node.js/TypeScript: state "Standard Node.js toolchain" if no extra tools needed

Format as a table in Section 1.5:
| Tool | Min Version | Install Command | Verify Command |

**This section is critical for automated build verification.** If the orchestrator cannot verify the toolchain before spawning subagents, it cannot catch missing-tool failures early.

**STEP 4: Execution Phase Planning** (Section 2 - High Level)
This is the core of the PRD. Ask:
- "How should we break this feature into sequential implementation phases?"
- "What's the logical order of phases where each phase builds on the previous?"
- Typical breakdown: 2-5 phases (e.g., Foundation → Core Logic → Integration → Polish)

For each phase identified:
- What's the purpose of this phase?
- Why must this phase come BEFORE the next one?
- What capabilities should exist AFTER this phase completes?

Create a TodoWrite checklist for phases:
- [ ] Phase 1: [Name]
- [ ] Phase 2: [Name]
- [ ] Phase 3: [Name]
- etc.

**STEP 5: Work Item Discovery** (Iterative per Phase)
For each phase, ask:
- "What are the discrete work items in this phase?"
- "What's the smallest meaningful unit of work?"
- Typical: 2-4 work items per phase

For each work item, gather:

**5.1 Work Item Description**
- Brief description of what this work item accomplishes
- Why this work item exists in THIS phase

**5.2 Implementation Details**
Ask systematically:
- What systems/components are affected?
- What are the inputs and outputs?
- What's the core logic or algorithm?
- What failure modes must be handled?
- Any dependencies on previous work items?
- Performance or security considerations?

**5.3 Acceptance Criteria**
Critical: These must be measurable and testable.
Ask: "How will we know this work item is complete?"

Split into two categories:

_Structural Criteria_ (code inspection):
Format: AC-[Phase].[Item].[Letter]: Condition → Expected Outcome
Examples:
- AC-1.1.a: When user submits valid form → data saved to database
- AC-1.1.b: When user submits invalid form → validation error shown

_Executable Criteria_ (verified by running a command):
Format: AC-[Phase].[Item].[Letter]: `<command>` → Expected output/exit code
Examples:
- AC-1.1.c: `cargo test --lib auth` → all tests pass (exit 0)
- AC-1.1.d: `curl -s http://localhost:3000/health` → returns `{"status":"ok"}`

**Every work item MUST have at least one Executable Criterion.** If the work item produces code, there must be a command that verifies it works.

Aim for 2-5 acceptance criteria per work item.

**5.4 Acceptance Tests**
For each acceptance criterion, define HOW to test it.

Format: Test-[Phase].[Item].[Letter]: Test type + what's being validated
Examples:
- Test-1.1.a: Unit test validates form data transformation
- Test-1.1.b: Integration test validates database write
- Test-1.1.c: E2E test validates complete user flow

Test types: Unit, Integration, E2E, Performance, Security, Regression

**5.5 Verification Commands**
For each work item, provide literal shell commands that MUST succeed:
```bash
# Build verification
<project-specific build command>
# Test verification
<project-specific test command for this work item>
# Artifact verification (if applicable)
ls -la <expected output file>
```

These commands will be executed by the orchestrator after each subagent completes.
If a command fails, the work item is NOT done regardless of code inspection results.

**STEP 6: Completion Criteria** (Section 3)
Ask:
- When is the ENTIRE project considered complete?
- What must be true across all phases?

Typical criteria:
- All phase acceptance criteria pass
- All acceptance tests green
- No P0/P1 issues remain
- Performance benchmarks met
- Security review passed

**STEP 7: Rollout & Validation** (Section 4)
Ask:
- How will we roll this out? (feature flags, progressive exposure, etc.)
- What metrics will we monitor post-launch?
- What are the rollback triggers? (conditions that would cause us to revert)
- How will we validate success after launch?

**STEP 8: Open Questions** (Section 5)
Capture:
- What technical questions remain unanswered?
- What decisions need to be made before proceeding?
- What research or spikes are needed?

**STEP 9: Quality Validation**
Before generating the document, validate:
- ✅ Phases are truly sequential (later phases depend on earlier ones)
- ✅ Acceptance criteria are measurable and testable (not vague)
- ✅ Each work item is atomic (single responsibility)
- ✅ Implementation details cover: systems, data, logic, failures
- ✅ Acceptance tests map 1:1 to acceptance criteria
- ✅ Completion criteria are comprehensive
- ✅ Rollout includes rollback plan

**STEP 10: Document Generation**
Compile all gathered information into PRD format:
- Use template structure exactly as in ~/.claude/commands/template/PRODUCT_REQUIREMENTS_DOCUMENT.md
- Maintain sequential phase numbering (Phase 1, Phase 2, etc.)
- Maintain hierarchical work item numbering (1.1, 1.2, 2.1, 2.2, etc.)
- Ensure all sections present (even if marked TBD)

**STEP 11: Output**
- Create directory ./projects/[project-name]/ if needed
- Write completed PRD to: ./projects/[project-name]/prd.md
- Confirm file created successfully
- Provide summary of structure (X phases, Y total work items, Z acceptance criteria)

**QUALITY CRITERIA:**
✅ All sections present (0-5, including 1.5 Required Toolchain)
✅ Phases are sequential with clear dependencies
✅ Each phase has purpose statement
✅ Each work item has implementation details
✅ Acceptance criteria are measurable (SMART)
✅ Every work item has at least one Executable Criterion with a literal command
✅ Every work item has a Verification Commands section
✅ Acceptance tests cover all criteria
✅ Required Toolchain section filled out (even if "Standard Node.js toolchain")
✅ Completion criteria comprehensive
✅ Rollout strategy includes rollback
✅ Output written to correct path

**FLEXIBILITY:**
- Number of phases is variable (typically 2-5, but can be more)
- Number of work items per phase is variable (typically 2-4)
- Can mark detailed sections TBD if research needed
- Can reference external docs for technical details
- Can iterate and refine after initial creation

**WORKFLOW MODES:**
- Use --brainstorm mode for initial phase planning
- Use --think mode when defining acceptance criteria (ensure testability)
- Use TodoWrite to track progress through phases
- Be collaborative and iterative, not rigid

**EXAMPLES OF GOOD ACCEPTANCE CRITERIA:**
✅ GOOD: "When user clicks 'Save' with valid data → record persisted to DB with status 'active' within 200ms"
✅ GOOD: "When API rate limit exceeded → 429 response returned with Retry-After header"
❌ BAD: "System should work well" (not measurable)
❌ BAD: "User experience is good" (not testable)

**EXAMPLES OF PHASE SEQUENCING:**
Example: User Authentication Feature
- Phase 1: Database & Models (user table, schema, migrations)
- Phase 2: Core Auth Logic (password hashing, JWT generation)
- Phase 3: API Endpoints (login, logout, refresh token)
- Phase 4: Frontend Integration (login form, session management)
- Phase 5: Security Hardening (rate limiting, audit logging)

Each phase MUST complete before next can begin.

**INTEGRATION WITH FEATURE BRIEF:**
If PFB exists:
- Pull objectives from PFB Goals
- Pull constraints from PFB Assumptions & Constraints
- Reference PFB in Section 0
- Ensure PRD aligns with PFB scope

If no PFB:
- Gather objectives fresh
- Consider creating PFB first for strategic alignment
- Mark source as "Direct input" in Section 0
```

---

## Usage

Simply copy the prompt text above and paste it into your conversation with Claude Code. Claude will:
1. Check for existing Product Feature Brief
2. Guide you through phase planning and work item breakdown
3. Help define measurable acceptance criteria and tests
4. Compile everything into a properly formatted PRD
5. Save it to ./projects/[project-name]/prd.md

## PRD vs PFB: When to Use Each

**Use Product Feature Brief (PFB) when:**
- Starting new feature exploration
- Need strategic alignment and stakeholder buy-in
- Defining problem space and success metrics
- Making go/no-go decisions

**Use Product Requirements Document (PRD) when:**
- Ready to plan implementation
- Need technical breakdown and sequencing
- Defining acceptance criteria for development
- Planning testing and rollout strategy

**Best Practice:** Create PFB first (strategic), then PRD (tactical).

## Notes

- PRD is more technical than PFB - it's for implementation teams
- Phases must be truly sequential (dependencies matter)
- Acceptance criteria should be testable with automated tests
- Work items should be atomic (single responsibility)
- The prompt handles variable numbers of phases and work items
- Can iterate and refine PRD as implementation progresses
- All files saved to ./projects/[project-name]/prd.md

## Quality Checklist

Before finalizing your PRD, verify:
- [ ] Each phase has clear purpose and dependencies
- [ ] Work items are atomic and well-scoped
- [ ] Acceptance criteria are SMART (Specific, Measurable, Achievable, Relevant, Testable)
- [ ] Acceptance tests map 1:1 to criteria
- [ ] Implementation details cover systems, data, logic, failures
- [ ] Completion criteria define "done"
- [ ] Rollout strategy includes monitoring and rollback
- [ ] Open questions captured for resolution
