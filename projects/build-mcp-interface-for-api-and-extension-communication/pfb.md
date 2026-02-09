# Build MCP Interface for API and Extension Communication

## 1. Feature Overview

**Feature Name:** MCP Interface for API and Extension Communication
**Owner:** stoked
**Status:** Proposed
**Target Release:** ASAP / Next Sprint (High Priority)

### Summary

Build a Model Context Protocol (MCP) server that enables Claude Code and other LLM applications to interact with the api and VSCode extension. This interface will eliminate manual refresh operations by providing standardized tools for reading project state, updating project/issue statuses, and creating new projects/issues, enabling real-time bidirectional synchronization between Claude AI sessions and GitHub Projects.

---

## 2. Problem Statement

### What problem are we solving?

Currently, the VSCode extension requires manual refresh operations to display updated project and issue states when Claude Code makes changes. The `update-project.sh` script in the examples directory attempts to solve this via signal files, but this approach is brittle, lacks discoverability for LLMs, and doesn't scale. Developers experience workflow interruptions as they must manually refresh the extension to see changes made by Claude Code, breaking the seamless automation promise of the system.

### Who is affected?

- **Primary users:** Developers using Claude Code with the GitHub Projects VSCode extension
- **Secondary users:** Future LLM applications (GitHub Copilot, other AI assistants) that may integrate with the api

### Why now?

The api was just integrated (commit d44e456a) with complete project/issue/phase/work-item functionality. The infrastructure is ready, but the interface layer is missing. Without MCP integration, developers experience friction with manual refreshes, undermining the value proposition of AI-driven project orchestration. This is blocking the full user experience of seamless Claude-driven project management.

---

## 3. Goals & Success Metrics

### Goals

- **Eliminate manual refresh operations** in the VSCode extension when Claude Code updates GitHub Projects
- **Provide discoverable, standardized MCP tools** for LLMs to interact with project state
- **Enable real-time bidirectional sync** between Claude sessions and the VSCode extension
- **Replace the signal file mechanism** with a proper API-driven notification system

### Success Metrics (How we'll know it worked)

- **Manual refresh actions:** Current unknown baseline → Target: 0 manual refreshes needed during Claude sessions
- **Extension update latency:** Current manual (∞) → Target: <2 seconds automatic update after state changes
- **Tool adoption:** Claude Code successfully uses MCP tools in 100% of project management tasks
- **Error rate:** <1% failed sync operations between API and extension

---

## 4. User Experience & Scope

### In Scope

- **MCP Server Implementation:** Build a Node.js MCP server using `@modelcontextprotocol/sdk`
- **Project Read Operations:** Tools to fetch project details, list issues, get phase information
- **Project Write Operations:** Tools to update issue statuses, create new issues, update project fields
- **Extension Notification System:** WebSocket or Server-Sent Events (SSE) to push real-time updates to the VSCode extension
- **Authentication:** API key-based auth compatible with existing api authentication
- **Tool Definitions:** Clear, LLM-friendly tool descriptions with examples for:
  - `read_project` - Get project details by number
  - `list_issues` - List issues with optional filtering (status, phase, assignee)
  - `update_issue_status` - Change issue status in GitHub Projects
  - `create_issue` - Create new issue and add to project
  - `get_project_phases` - List phases for a project
  - `update_issue_phase` - Move issue to different phase
- **Migration Path:** Deprecate `update-project.sh` in favor of MCP tools

### Out of Scope

- **Git operations** (commits, pushes, branch management) - these remain in Claude Code's Bash tool domain
- **GitHub repository management** (creating repos, managing permissions)
- **Support for non-Claude LLM platforms** in the initial release (future enhancement)
- **Historical analytics or reporting** features
- **Offline mode** - requires active API connection

---

## 5. Assumptions & Constraints

### Assumptions

- **MCP Protocol:** Claude Code supports MCP protocol and can discover/invoke MCP tools
- **API Availability:** The api is deployed and accessible (currently at claude-projects.truapi.com)
- **Extension Architecture:** The VSCode extension can be modified to consume WebSocket/SSE events
- **Network Connectivity:** Users have stable network connection to the API during Claude sessions
- **GitHub CLI:** GitHub CLI (`gh`) is installed and authenticated for GitHub operations

### Constraints

- **Technical:**
  - Must use existing api endpoints (no API changes required)
  - Must maintain backward compatibility with existing extension functionality
  - Real-time updates required (<2s latency)
  - Must work within VSCode extension sandbox environment
- **Timeline:**
  - ASAP/Next Sprint delivery (1-2 weeks estimated)
- **Resources:**
  - Single developer (stoked) implementation
  - MCP SDK dependency: `@modelcontextprotocol/sdk@1.6.1` (already in node_modules)

---

## 6. Risks & Mitigations

| Risk                                                                                 | Impact | Mitigation                                                                              |
| ------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------- |
| **Authentication complexity** - MCP servers may require different auth flow than API | High   | Use API key pass-through from Claude config; document setup clearly with examples       |
| **Concurrent update conflicts** - Multiple Claude sessions updating same project     | Medium | Implement optimistic locking with version fields; return clear conflict errors to LLM   |
| **Extension notification reliability** - WebSocket/SSE connection drops              | High   | Implement reconnection logic with exponential backoff; fall back to polling if needed   |
| **Error handling opacity** - LLMs may not handle API errors gracefully               | Medium | Design detailed, actionable error messages; include retry guidance in tool descriptions |
| **GitHub API rate limits** - Heavy usage may hit GitHub limits                       | Medium | Implement caching layer in api; batch operations where possible          |
| **MCP adoption learning curve** - Developers unfamiliar with MCP setup               | Low    | Provide complete setup guide with VSCode configuration examples                         |

---

## 7. Dependencies

### Team Dependencies

- **State-tracking-api team:** API must remain stable during MCP development (no breaking changes)
- **VSCode extension team:** Extension updates needed for WebSocket/SSE client implementation

### External Systems / Vendors

- **State-tracking-api:** NestJS API at `packages/api` (deployed at claude-projects.truapi.com)
- **VSCode Extension:** Located at `apps/code-ext` (claude-projects-vscode)
- **MCP SDK:** `@modelcontextprotocol/sdk@1.6.1` (already available)
- **GitHub CLI:** Required for some GitHub operations (already dependency of update-project.sh)
- **MongoDB Atlas:** Backend database for api

### Data / Infrastructure Dependencies

- **API Keys:** Need distribution mechanism for MCP server API keys
- **Network Access:** MCP server needs outbound HTTPS to claude-projects.truapi.com
- **VSCode Configuration:** Users need to configure MCP server in Claude Code settings

---

## 8. Open Questions

- **Authentication mechanism:** Should MCP server use same API key as extension, or separate credentials? _Recommendation: Same key for simplicity, separate scope/permissions for future_
- **Extension architecture:** Does the extension currently have WebSocket/SSE capability, or does this need to be added? _Need to review `apps/code-ext/src/extension.ts`_
- **Migration strategy:** What's the deprecation timeline for `update-project.sh`? Immediate or gradual? _Recommendation: Gradual with warnings_
- **Error recovery:** How should the MCP server handle API downtime? Queue operations? Fail fast? _Recommendation: Fail fast with clear errors, let Claude retry_
- **Tool granularity:** Should we have fine-grained tools (update_issue_title, update_issue_status separately) or coarse-grained (update_issue with optional fields)? _Recommendation: Start coarse-grained, refine based on usage_
- **Notification filtering:** Should extension receive all project updates or only for currently viewed projects? _Recommendation: All updates with client-side filtering_

---

## 9. Non-Goals

Explicitly state what success does **not** require:

- **Offline functionality** - The MCP interface requires active API connection
- **Support for non-GitHub project management systems** (Jira, Linear, etc.)
- **Git repository operations** - Commits, pushes, and branch management remain in Bash tool domain
- **Historical data migration** - No need to backfill historical project data
- **Multi-tenancy or user management** - Single-user/single-team focus initially
- **Advanced analytics or dashboards** - Simple CRUD operations only
- **Mobile or web client support** - VSCode extension only
- **Performance optimization beyond 2s latency** - Real-time is sufficient, sub-second not required initially

---

## 10. Notes & References

### Links to Documentation

- **MCP Protocol Documentation:** https://modelcontextprotocol.io/
- **MCP SDK Repository:** https://github.com/modelcontextprotocol/sdk
- **State-tracking-api README:** `/Users/stoked/work/claude-projects/packages/api/README.md`
- **API Documentation (Swagger):** https://claude-projects.truapi.com/api/docs (when deployed)
- **VSCode Extension Package:** `/Users/stoked/work/claude-projects/apps/code-ext/package.json`

### Code References

- **Current signal file implementation:** `/Users/stoked/work/claude-projects/examples/update-project.sh`
- **State-tracking-api controllers:**
  - Sessions: `/Users/stoked/work/claude-projects/packages/api/src/modules/sessions/sessions.controller.ts`
  - Tasks: `/Users/stoked/work/claude-projects/packages/api/src/modules/tasks/tasks.controller.ts`
  - Machines: `/Users/stoked/work/claude-projects/packages/api/src/modules/machines/machines.controller.ts`
- **VSCode Extension Entry:** `/Users/stoked/work/claude-projects/apps/code-ext/src/extension.ts`
- **MCP SDK (already installed):** `node_modules/@modelcontextprotocol/sdk`

### Related Commits

- **d44e456a** - feat: integrate complete api from Project #70
- **0a77b490** - refactor: restructure repository into monorepo with pnpm workspaces

### Technical Notes

- The api uses NestJS with MongoDB for persistence
- Current authentication is API key-based (X-API-Key or Authorization: Bearer headers)
- Extension currently uses signal files at `.claude-sessions/*.signal` for notifications
- Extension displays project boards with phase-based organization
- MCP server should be implemented as a new package: `packages/mcp-server`

### Prior Art

- **OpenControl MCP implementation:** `node_modules/opencontrol` has MCP example (review for patterns)
- **GitHub Projects GraphQL API:** Consider for direct GitHub integration vs API proxy pattern
