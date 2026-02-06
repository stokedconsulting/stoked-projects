# Multi-Agent Autonomous Project Orchestration System

## 1. Feature Overview
**Feature Name:** Multi-Agent Autonomous Project Orchestration System
**Owner:** TBD
**Status:** Draft
**Target Release:** Q1 2026

### Summary
An autonomous multi-agent system that enables concurrent Claude AI agents to independently execute GitHub Projects, validate completion quality, and self-generate new improvement projects across 21 defined categories. Each workspace configures agent concurrency, with agents working one project at a time through completion, peer review, and iterative refinement. When project queues are empty, agents autonomously ideate and create new projects using category-specific prompts, creating a self-sustaining continuous improvement loop.

---

## 2. Problem Statement
### What problem are we solving?
Current Claude project orchestration requires manual project creation, sequential execution, and human-driven quality validation. This creates bottlenecks in continuous improvement workflows and limits the scale at which codebases can evolve. There is no systematic way to leverage AI agents for autonomous, parallel project execution with built-in quality gates and self-directed improvement discovery.

### Who is affected?
- **Primary users:** Development teams seeking continuous automated codebase improvement without constant manual oversight
- **Secondary users:** Engineering managers tracking agent efficiency, quality metrics, and improvement velocity
- **Tertiary users:** Open source maintainers wanting autonomous contribution systems

### Why now?
As Claude's capabilities mature, we can now reliably execute complex multi-step projects end-to-end. The existing single-agent `/project-start` and manual review processes prove the foundation works. Scaling to multi-agent parallel execution with autonomous project generation represents the natural evolution, enabling exponentially faster codebase improvement cycles while maintaining quality through agent-based peer review.

---

## 3. Goals & Success Metrics
### Goals
- **Enable parallel autonomous execution:** Allow N configurable agents to work concurrently on different projects without manual coordination
- **Establish quality gates:** Implement agent-based peer review with acceptance criteria validation and iterative refinement
- **Create self-sustaining improvement loop:** Agents autonomously generate new projects when queues empty, across all 21 improvement categories
- **Provide visibility and control:** Real-time monitoring of agent activity with manual override capabilities
- **Manage cost and safety:** Configurable spend limits, rate limiting, and emergency stop controls

### Success Metrics (How we'll know it worked)
**Agent Efficiency:**
- Projects completed per agent per day: >2 (target: 3-5)
- Average project completion time: <4 hours (excluding review cycles)
- Agent utilization rate: >80% (time spent actively working vs. idle)

**Quality:**
- CI/CD pass rate: >95% for agent-completed projects
- Acceptance criteria validation pass rate: >90% on first review
- Review cycles required per project: <3 average
- Regression rate: <5% (new issues introduced per completed project)

**Loop Effectiveness:**
- Self-generated projects per week per category: >1
- Category coverage: All 21 categories exercised within 30 days
- Self-generated project quality: 70%+ deemed valuable by human review

**Cost & Safety:**
- Zero budget overruns beyond configured limits
- Emergency stop response time: <30 seconds
- API rate limit violations: 0

---

## 4. User Experience & Scope
### In Scope
**Configuration:**
- **Workspace settings:** VS Code setting for concurrent agent count (default: 1, max: 10)
- **Spend limits:** Daily and monthly budget caps with automatic shutdown
- **Category configuration:** Enable/disable specific improvement categories
- **Review agent configuration:** Dedicated review agent persona and validation criteria

**Visibility:**
- **Real-time agent dashboard:** Sidebar showing per-agent: ID, current project number, current phase, status (working/reviewing/ideating/idle)
- **Progress indicators:** Per-project completion percentage, current task, elapsed time
- **Health monitoring:** Agent heartbeat status, error counts, last activity timestamp
- **Cost tracking:** Real-time spend against budget limits

**Manual Override:**
- **Pause controls:** Pause all agents, pause individual agents, pause by category
- **Project reassignment:** Manually assign/unassign projects to specific agents
- **Emergency stop:** Kill all agents immediately with state preservation
- **Agent restart:** Resume paused agents or restart failed agents

**Agent Workflows:**
1. **Execution Agent:** Pick project from queue → Execute `/project-start {project#}` → Push code to branch → Mark complete
2. **Review Agent:** Pick completed project → Validate acceptance criteria → Check quality standards → Request rework OR approve
3. **Ideation Agent:** Detect empty queue → Select category → Execute category prompt → Execute `/project-create {idea}` → Enqueue new project

**Quality Gates:**
- Automated CI/CD checks (linting, tests, build)
- Acceptance criteria validation against issue descriptions
- Code quality standards check (test coverage, documentation, error handling)
- Peer review by dedicated review agent with different persona

**Conflict Management:**
- Each agent works on separate branch (`agent-{id}/project-{num}`)
- Pre-merge conflict detection and reporting
- Escalation to user for manual resolution
- Automated rebase attempts with rollback on failure

### Out of Scope (Initial Version)
- **Advanced scheduling:** Priority queues, dependency graphs, task routing algorithms
- **Cross-project coordination:** Agents collaborating on single large project
- **Human-in-the-loop review:** Manual approval gates (fully autonomous initially)
- **Learning/adaptation:** Agent performance optimization based on historical success
- **Multi-repository support:** Single repository per workspace initially
- **Custom category prompts:** Category prompts are pre-canned, not user-customizable
- **Distributed execution:** All agents run locally; no cloud orchestration
- **Advanced analytics:** Detailed performance dashboards, trend analysis, A/B testing

---

## 5. Assumptions & Constraints
### Assumptions
- **API limits:** Standard GitHub API rate limits are sufficient with queuing and exponential backoff
- **Agent reliability:** Claude agents can complete projects end-to-end without crashing >90% of the time
- **Review agent effectiveness:** A different agent persona can reliably validate quality without human oversight
- **Session state:** File-based `.claude-sessions/` state tracking is sufficient for multi-agent coordination
- **Network connectivity:** Agents have reliable internet access for GitHub API and Claude API calls
- **Repository quality:** Codebase has sufficient tests and CI/CD to validate changes automatically
- **Budget awareness:** Users understand AI API costs and set appropriate spend limits

### Constraints
- **Technical:** Must use existing `.claude-sessions/` file-based IPC; NestJS State Tracking API for session monitoring; VS Code extension for UI
- **Infrastructure:** Local execution initially; file system as state store; one session file per agent
- **Authentication:** Reuse existing GitHub OAuth and VS Code authentication flows
- **Branch strategy:** One branch per agent-project combination; merge to main only after approval
- **Cost limits:** Hard stop when daily/monthly budgets exceeded; no credit-based continuation
- **Concurrent agents:** Maximum 10 agents per workspace to prevent resource exhaustion
- **Category prompts:** 21 pre-defined categories with fixed prompt templates (see problem description)

---

## 6. Risks & Mitigations
| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| **Cost escalation:** Agents enter infinite loops or inefficient execution patterns, burning budget | Critical | Medium | - Hard spend limits with automatic shutdown<br>- Per-project time limits (8-hour max)<br>- Monitoring dashboard with real-time cost tracking<br>- Alert thresholds at 50%, 75%, 90% of budget<br>- Agent kill-switch accessible in UI |
| **Infinite review loops:** Review agent and execution agent disagree indefinitely, blocking completion | High | Medium | - Maximum 3 review cycles per project<br>- Escalation to user after 3rd rejection<br>- Review agent timeout (2-hour max per review)<br>- Detailed rejection reasons required from review agent |
| **Code conflicts:** Multiple agents create incompatible changes that fail to merge | High | High | - Separate branches enforced (`agent-{id}/project-{num}`)<br>- Pre-merge conflict detection<br>- Automated rebase attempts with conservative conflict resolution<br>- User escalation queue for manual resolution<br>- Agent pauses if >3 conflicts pending |
| **Quality variance:** Self-generated projects lack coherence or value | Medium | High | - Category-specific prompt templates with quality criteria<br>- Review agent validates self-generated projects before work begins<br>- Weekly human review of self-generated project backlog<br>- Disable underperforming categories based on metrics |
| **Security implications:** Agents commit secrets, introduce vulnerabilities, or modify critical files | Critical | Low | - Pre-commit hooks for secret scanning (existing CI/CD)<br>- Review agent checks for security anti-patterns<br>- Protected file paths (e.g., `.env`, `credentials.json`) flagged<br>- Security category reviews run monthly<br>- Human review of security-related PRs |
| **Agent resource starvation:** All agents stuck on hard problems, no progress made | Medium | Medium | - Per-project timeout (8 hours) with automatic abandonment<br>- Agent reallocation to different projects after timeout<br>- "Stuck" detection: no file changes in 30 minutes triggers escalation<br>- Emergency "skip project" command available |
| **State file corruption:** Concurrent writes to `.claude-sessions/` cause data loss | High | Low | - One file per agent (no concurrent writes to same file)<br>- Atomic file writes with temp file + rename pattern<br>- Validation on read with auto-recovery from corruption<br>- Backup state to State Tracking API |
| **GitHub API rate limiting:** Excessive API calls cause throttling, blocking all agents | High | Medium | - Shared rate limit tracker across all agents<br>- Exponential backoff on 429 responses<br>- Request queuing with priority (reviews > execution > ideation)<br>- Fallback to MCP tools with built-in rate limiting |

---

## 7. Dependencies
### Team Dependencies
- **State Tracking API:** Session monitoring, heartbeat tracking, agent health status (must be deployed and operational)
- **VS Code Extension:** UI for agent dashboard, manual controls, OAuth authentication
- **GitHub Projects MCP Tools:** Project CRUD, issue management, status updates

### External Systems / Vendors
- **Claude API:** All agent execution relies on Claude Sonnet 4.5 availability and performance
- **GitHub API:** Project management, issue tracking, code hosting, PR creation
- **GitHub OAuth:** Authentication for GitHub API access
- **VS Code APIs:** Extension host, webview, authentication, workspace state

### Data or Infrastructure Dependencies
- **`.claude-sessions/` directory:** File-based state tracking for agent sessions
- **State Tracking API database:** MongoDB Atlas for agent session persistence
- **Workspace settings:** VS Code workspace configuration for agent count and limits
- **Category prompt templates:** 21 pre-defined prompts (to be created as part of implementation)
- **Review agent prompt template:** Dedicated persona for quality validation (to be created)

---

## 8. Open Questions
### Agent Coordination
- **Q:** How do we prevent agents from picking the same project simultaneously?
  - **A (Proposed):** Atomic "claim" operation via State Tracking API; project status includes `claimed_by_agent_id` field

- **Q:** Should review agents be dedicated instances or can execution agents switch to review mode?
  - **A (Proposed):** Dedicated review agent(s) with different persona/prompt to ensure objectivity

- **Q:** What happens if an agent crashes mid-project?
  - **A (Proposed):** State Tracking API detects missing heartbeat; extension offers "resume" or "reassign" options

### Quality & Review
- **Q:** What specific criteria define "reasonable standard of quality"?
  - **A (Proposed):** (1) All tests pass, (2) Linting clean, (3) No obvious security issues, (4) Acceptance criteria met, (5) Code documented

- **Q:** Should review agents have access to full project context or just the diff?
  - **A (Proposed):** Full context including original issue, acceptance criteria, code diff, test results

- **Q:** How do we handle subjective quality disagreements between agents?
  - **A (Proposed):** After 3 cycles, escalate to user with both perspectives presented

### Project Ideation
- **Q:** How do we ensure category prompts generate valuable, non-redundant projects?
  - **A (Proposed):** Prompts include: "Review existing issues to avoid duplicates" + "Propose specific, scoped improvements"

- **Q:** Should agents validate feasibility before creating projects?
  - **A (Proposed):** Yes - ideation prompt includes "Verify technical feasibility before proposing"

- **Q:** What if all categories have been exhausted (no more ideas)?
  - **A (Proposed):** Agent enters idle state; user can manually add projects or adjust category prompts

### Cost & Safety
- **Q:** Should spend limits be per-agent or total across all agents?
  - **A (Proposed):** Total across all agents to prevent budget multiplication

- **Q:** How granular should cost tracking be (per-request vs. per-project)?
  - **A (Proposed):** Per-project with request-level logging for debugging

- **Q:** Should we implement token usage predictions to prevent mid-project budget exhaustion?
  - **A (Proposed):** Yes - estimate cost before starting project; skip if insufficient budget remains

---

## 9. Non-Goals
Explicitly state what success does **not** require:

- **Advanced machine learning:** No reinforcement learning, model fine-tuning, or agent performance optimization algorithms
- **Human-in-the-loop workflow:** No approval gates, manual reviews, or interactive decision points (fully autonomous)
- **Cross-repository orchestration:** Single repository per workspace; no multi-repo dependency management
- **Custom category prompts:** Users cannot define custom categories or modify prompts (use pre-defined 21 categories)
- **Agent specialization:** All execution agents are identical; no role-based specialization (except review agents)
- **Cloud execution infrastructure:** No serverless functions, container orchestration, or distributed agent deployment
- **Advanced analytics dashboard:** No historical trend analysis, agent performance comparisons, or optimization recommendations
- **Integration with external tools:** No Jira, Linear, Slack, or third-party project management integrations
- **Agent communication/collaboration:** Agents do not communicate with each other; no shared context or collaborative workflows
- **Smart scheduling/prioritization:** No AI-driven task routing, dependency analysis, or priority optimization
- **Rollback mechanisms:** No automatic rollback of merged changes; relies on standard git revert workflows
- **Multi-tenant support:** Single user per workspace; no team collaboration features

---

## 10. Notes & References
### Reference Implementation
- **Existing `/project-start` command:** Single-agent orchestration proven to work end-to-end
- **State Tracking API:** `/Users/stoked/work/claude-projects/packages/api/` - Session monitoring foundation
- **VS Code Extension:** `/Users/stoked/work/claude-projects/apps/code-ext/` - UI and GitHub integration
- **`.claude-sessions/` IPC:** File-based state tracking already in use for single-agent workflows

### Technical Architecture
**Agent Session Management:**
```
Agent 1: .claude-sessions/agent-1.session
  - current_project_id
  - current_phase
  - status (working|reviewing|ideating|idle)
  - last_heartbeat
  - branch_name

Agent 2: .claude-sessions/agent-2.session
  ...
```

**Agent State Machine:**
```
IDLE → (query project queue) → CLAIM_PROJECT → WORKING
WORKING → (push code) → REQUEST_REVIEW
REQUEST_REVIEW → (wait for review agent) → APPROVED|REJECTED
APPROVED → (merge PR) → IDLE
REJECTED → (read feedback) → WORKING
IDLE + (empty queue) → IDEATING
IDEATING → (generate idea) → CREATE_PROJECT → IDLE
```

**Review Agent Workflow:**
```
IDLE → (query completed projects) → CLAIM_REVIEW → REVIEWING
REVIEWING → (validate criteria) → APPROVE|REJECT
APPROVE → (mark project done) → IDLE
REJECT → (write feedback) → (assign back to execution agent) → IDLE
```

### 21 Improvement Categories
From problem description, agents will rotate through:
1. Optimization
2. Innovation
3. Architecture
4. Front End Improvements
5. Back End Improvements
6. Security
7. Testing
8. Documentation
9. Technical Debt
10. Developer Experience (DX)
11. Monitoring & Observability
12. DevOps/Infrastructure
13. Accessibility (a11y)
14. Dependency Management
15. Data Management
16. Internationalization (i18n)
17. Error Handling & Resilience
18. Code Quality
19. Compliance & Governance
20. Scalability
21. API Evolution

**Category Prompt Template Structure:**
```markdown
You are a {category} specialist reviewing {repository_name}.

Your task: Identify one specific, valuable {category} improvement.

Requirements:
- Review existing issues to avoid duplicates
- Propose a scoped improvement (completable in <8 hours)
- Verify technical feasibility
- Define clear acceptance criteria
- Consider current architecture and patterns

Output format:
**Title:** [Concise improvement title]
**Description:** [2-3 sentence overview]
**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2
...
**Technical Approach:** [High-level implementation plan]
```

### Key Design Decisions
- **File-based state over database:** Leverage existing `.claude-sessions/` infrastructure; one file per agent avoids concurrency issues
- **Review agents as separate instances:** Ensures objectivity; different persona/prompt from execution agents
- **Hard budget limits:** No soft limits or warnings-only; automatic shutdown protects against runaway costs
- **Branch-per-agent-project:** Simplifies conflict management; clear ownership and isolation
- **Category rotation:** Ensures all improvement types are addressed; prevents over-focusing on easy wins
- **No cross-project dependencies:** Each project is independent; simplifies orchestration and reduces blocking

### Implementation Phases (Suggested)
**Phase 1: Multi-Agent Execution (MVP)**
- Configure agent count in workspace settings
- Session file per agent (`.claude-sessions/agent-{id}.session`)
- Project claiming via State Tracking API
- Parallel execution of existing projects
- Agent dashboard in VS Code extension

**Phase 2: Review Agent System**
- Dedicated review agent with separate prompt
- Acceptance criteria validation logic
- Quality standards checklist
- Iterative refinement workflow (max 3 cycles)
- User escalation for unresolved issues

**Phase 3: Autonomous Ideation Loop**
- 21 category prompt templates
- Empty queue detection
- Category selection algorithm (round-robin or least-recently-used)
- Auto-execute `/project-create` with generated ideas
- Self-generated project validation gate

**Phase 4: Safety & Monitoring**
- Spend tracking and budget limits
- Real-time cost dashboard
- Emergency stop controls
- Health monitoring and alerting
- Stuck agent detection and recovery

**Phase 5: Conflict Management**
- Pre-merge conflict detection
- Automated rebase attempts
- User escalation queue
- Manual resolution UI in VS Code

### Related Documentation
- **Problem Description:** `./problem-description-full.md`
- **State Tracking API PFB:** `/Users/stoked/work/claude-projects/projects/build-claude-projects-api/pfb.md`
- **VS Code Extension README:** `/Users/stoked/work/claude-projects/apps/code-ext/README.md`
- **Claude Commands:** `~/.claude/commands/` - Existing `/project-start`, `/project-create` implementations
