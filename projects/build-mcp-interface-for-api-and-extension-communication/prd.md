# Product Requirements Document (Sequential)

## 0. Source Context
**Derived From:** Feature Brief
**Feature Name:** MCP Interface for API and Extension Communication
**PRD Owner:** stoked
**Last Updated:** 2026-01-20

### Feature Brief Summary
Build a Model Context Protocol (MCP) server that enables Claude Code and other LLM applications to interact with the api and VSCode extension. This interface will eliminate manual refresh operations by providing standardized tools for reading project state, updating project/issue statuses, and creating new projects/issues, enabling real-time bidirectional synchronization between Claude AI sessions and GitHub Projects.

**Source Feature Brief:** `/Users/stoked/work/stoked-projects/projects/build-mcp-interface-for-api-and-extension-communication/pfb.md`

**Problem:** Extension requires manual refreshes; no automated sync between API and extension
**Goals:** Eliminate manual refreshes, provide MCP tools, enable real-time sync
**Scope:** Read/Update/Create operations for projects/issues, real-time notifications (NOT git operations)
**Dependencies:** api, VSCode extension, MCP SDK, GitHub CLI

---

## 1. Objectives & Constraints
### Objectives
- Eliminate manual refresh operations in the VSCode extension when Claude Code updates GitHub Projects
- Provide discoverable, standardized MCP tools for LLMs to interact with project state
- Enable real-time bidirectional sync between Claude sessions and the VSCode extension (<2s latency)
- Replace the brittle signal file mechanism (`update-project.sh`) with a proper API-driven notification system
- Achieve 100% Claude Code adoption of MCP tools for project management tasks
- Maintain <1% error rate for sync operations between API and extension

### Constraints
- **Technical:**
  - Must use existing api endpoints at localhost:8167 (no API changes required)
  - Must use `@modelcontextprotocol/sdk@1.6.1` (already installed in monorepo)
  - Must maintain backward compatibility with existing VSCode extension functionality
  - Must work within VSCode extension sandbox environment
  - Real-time updates required with <2 second latency
  - Must support API key-based authentication compatible with existing api
- **Timeline:**
  - ASAP/Next Sprint delivery (1-2 weeks estimated)
- **Resources:**
  - Single developer (stoked) implementation
  - No breaking changes allowed to api during development
- **Network:**
  - Requires stable network connection to API (no offline mode)
  - Must handle WebSocket/SSE connection drops gracefully

---

## 2. Execution Phases

> Phases below are ordered and sequential.
> A phase cannot begin until all acceptance criteria of the previous phase are met.

---

## Phase 1: Foundation & Infrastructure
**Purpose:** Establish the MCP server scaffold, API client integration, and basic tool infrastructure before implementing specific tools. This foundation ensures proper authentication, error handling, and communication patterns are established for all subsequent development.

### 1.1 MCP Server Package Initialization
Create the new `packages/mcp-server` package with proper TypeScript configuration, MCP SDK integration, and monorepo tooling.

**Implementation Details**
- **Systems affected:** Monorepo workspace configuration, pnpm-workspace.yaml
- **Package structure:**
  - `packages/mcp-server/src/index.ts` - Main server entry point
  - `packages/mcp-server/src/server.ts` - MCP server class implementation
  - `packages/mcp-server/package.json` - Package manifest with MCP SDK dependency
  - `packages/mcp-server/tsconfig.json` - TypeScript configuration extending monorepo base
- **Dependencies:**
  - `@modelcontextprotocol/sdk@1.6.1` (use existing workspace dependency)
  - Shared monorepo TypeScript config
  - Node.js stdio transport for MCP communication
- **Outputs:** Runnable MCP server package that starts successfully and responds to MCP protocol handshake
- **Failure modes:**
  - SDK version mismatch: Pin to 1.6.1 explicitly
  - Transport initialization failure: Validate stdio availability before server start
  - TypeScript compilation errors: Use strict tsconfig from monorepo base

**Acceptance Criteria**
- AC-1.1.a: When `pnpm --filter mcp-server build` is executed → TypeScript compilation succeeds with no errors
- AC-1.1.b: When MCP server starts via `node dist/index.js` → Server initializes and listens on stdio transport successfully
- AC-1.1.c: When MCP client sends initialization handshake → Server responds with valid MCP protocol version and capabilities
- AC-1.1.d: When package.json is inspected → Contains `@modelcontextprotocol/sdk@1.6.1` as dependency and proper build scripts

**Acceptance Tests**
- Test-1.1.a: Unit test validates package.json has correct dependencies and scripts
- Test-1.1.b: Integration test starts MCP server and verifies stdio transport binding
- Test-1.1.c: Protocol test sends MCP handshake and validates response structure matches MCP spec
- Test-1.1.d: Build test executes `pnpm build` and verifies dist/ output contains compiled JavaScript

---

### 1.2 API Client Integration
Implement HTTP client for api with authentication, error handling, and type-safe request/response handling.

**Implementation Details**
- **Systems affected:** MCP server, api (read-only, no changes)
- **API client module:** `packages/mcp-server/src/api-client.ts`
- **Core logic:**
  - Base URL configuration: `http://localhost:8167`
  - API key authentication via `X-API-Key` or `Authorization: Bearer` headers
  - HTTP methods: GET, POST, PUT, DELETE with typed request/response
  - Error handling: Network errors, HTTP 4xx/5xx errors, timeout handling
  - Request timeout: 10 seconds default
  - Retry logic: 3 retries with exponential backoff for 5xx errors
- **Configuration:**
  - Read API key from environment variable `STATE_TRACKING_API_KEY`
  - Read base URL from environment variable `STATE_TRACKING_API_URL` (default: localhost:8167)
- **TypeScript interfaces:** Define types for Project, Issue, Phase, WorkItem matching API schemas
- **Failure modes:**
  - Missing API key: Fail fast with clear error message at server startup
  - Network timeout: Return timeout error to MCP client with retry suggestion
  - 401/403 errors: Return authentication error with setup instructions
  - 404 errors: Return not found error with resource identifier
  - 429 rate limit: Return rate limit error with retry-after time
  - 5xx server errors: Retry up to 3 times, then return error

**Acceptance Criteria**
- AC-1.2.a: When API client is initialized without API key → Throws error with message "STATE_TRACKING_API_KEY environment variable required"
- AC-1.2.b: When API client makes authenticated request with valid key → Request includes proper authentication header
- AC-1.2.c: When API returns 401 error → Client throws typed AuthenticationError with setup instructions
- AC-1.2.d: When API returns 5xx error → Client retries 3 times with exponential backoff (1s, 2s, 4s)
- AC-1.2.e: When network timeout occurs → Client throws TimeoutError after 10 seconds
- AC-1.2.f: When API returns valid JSON response → Client parses and returns typed TypeScript object

**Acceptance Tests**
- Test-1.2.a: Unit test validates API client constructor throws when API key is undefined
- Test-1.2.b: Integration test with mock server validates authentication header is set correctly
- Test-1.2.c: Unit test validates 401 response throws AuthenticationError with expected message
- Test-1.2.d: Integration test with mock 5xx responses validates retry behavior with timing
- Test-1.2.e: Integration test validates 10-second timeout triggers TimeoutError
- Test-1.2.f: Unit test validates response parsing for sample Project/Issue JSON payloads

---

### 1.3 MCP Tool Registration Framework
Implement the framework for registering and executing MCP tools, including parameter validation and error handling.

**Implementation Details**
- **Systems affected:** MCP server tool registry
- **Tool registration module:** `packages/mcp-server/src/tools/registry.ts`
- **Core logic:**
  - Tool definition interface: name, description, input schema (JSON Schema), handler function
  - Parameter validation using JSON Schema validation library (ajv)
  - Error handling wrapper for tool execution
  - Tool listing endpoint for MCP protocol `tools/list` request
  - Tool execution endpoint for MCP protocol `tools/call` request
- **Tool handler pattern:**
  ```typescript
  interface ToolHandler {
    name: string;
    description: string;
    inputSchema: JSONSchema;
    handler: (params: unknown) => Promise<ToolResult>;
  }
  ```
- **Error wrapping:** Catch all handler errors and return MCP-compatible error responses
- **Validation:** Validate input parameters against schema before invoking handler
- **Logging:** Log all tool invocations with parameters (sanitize API keys) and execution time
- **Failure modes:**
  - Invalid parameters: Return validation error with specific field issues
  - Handler exception: Catch, log, and return generic error to client
  - Schema definition error: Fail at registration time, not runtime

**Acceptance Criteria**
- AC-1.3.a: When tool is registered with valid schema → Tool appears in `tools/list` response
- AC-1.3.b: When `tools/call` request has invalid parameters → Returns validation error with field-specific messages
- AC-1.3.c: When tool handler throws exception → Exception is caught and returned as MCP error response
- AC-1.3.d: When tool handler executes successfully → Returns MCP success response with tool output
- AC-1.3.e: When multiple tools are registered → All tools appear in `tools/list` with correct schemas

**Acceptance Tests**
- Test-1.3.a: Unit test registers dummy tool and validates it appears in tool list
- Test-1.3.b: Integration test calls tool with invalid params and validates error response structure
- Test-1.3.c: Unit test validates exception in handler converts to MCP error response
- Test-1.3.d: Integration test calls successful tool and validates MCP success response format
- Test-1.3.e: Unit test registers 3 tools and validates all appear in list with correct metadata

---

### 1.4 Configuration and Environment Setup
Create configuration management for MCP server settings, API credentials, and runtime environment.

**Implementation Details**
- **Systems affected:** MCP server startup, environment configuration
- **Configuration module:** `packages/mcp-server/src/config.ts`
- **Configuration sources:**
  - Environment variables (primary)
  - `.env` file support (dotenv)
  - Default values for non-sensitive settings
- **Configuration schema:**
  ```typescript
  interface ServerConfig {
    apiBaseUrl: string; // STATE_TRACKING_API_URL
    apiKey: string; // STATE_TRACKING_API_KEY (required)
    logLevel: 'debug' | 'info' | 'warn' | 'error'; // LOG_LEVEL
    requestTimeout: number; // REQUEST_TIMEOUT_MS
    retryAttempts: number; // RETRY_ATTEMPTS
  }
  ```
- **Validation:** Validate required fields at startup, fail fast with clear messages
- **Documentation:** Create `.env.example` with all configuration options and descriptions
- **Logging:** Implement structured logging with configurable log levels
- **Failure modes:**
  - Missing required config: Fail at startup with clear error listing missing variables
  - Invalid config values: Validate types and ranges, fail with validation error

**Acceptance Criteria**
- AC-1.4.a: When server starts without STATE_TRACKING_API_KEY → Fails immediately with error "Required environment variable STATE_TRACKING_API_KEY not set"
- AC-1.4.b: When .env.example is read → Contains all configuration options with descriptions
- AC-1.4.c: When LOG_LEVEL=debug is set → Server logs include debug-level messages
- AC-1.4.d: When configuration is loaded → Default values are applied for optional settings
- AC-1.4.e: When invalid log level is provided → Server fails with validation error listing valid options

**Acceptance Tests**
- Test-1.4.a: Integration test starts server without API key and validates error message
- Test-1.4.b: Manual review validates .env.example completeness and clarity
- Test-1.4.c: Integration test sets LOG_LEVEL=debug and validates debug logs appear
- Test-1.4.d: Unit test validates default configuration values are applied correctly
- Test-1.4.e: Unit test validates invalid log level throws validation error

---

### 1.5 Basic Health Check Tool
Implement the first functional MCP tool as a health check to validate the entire stack.

**Implementation Details**
- **Systems affected:** MCP server tools, api
- **Tool name:** `health_check`
- **Tool description:** "Check connectivity and authentication with the api. Returns API health status and authentication verification."
- **Input schema:** No parameters required (empty schema)
- **Handler logic:**
  - Make GET request to `${apiBaseUrl}/health` endpoint
  - Verify authentication by making GET request to `${apiBaseUrl}/api/projects` (should return 200 or 401, not network error)
  - Return health status object with API availability, authentication status, response time
- **Output format:**
  ```typescript
  interface HealthCheckResult {
    apiAvailable: boolean;
    authenticated: boolean;
    responseTimeMs: number;
    apiVersion?: string;
    error?: string;
  }
  ```
- **Failure modes:**
  - API unreachable: Return apiAvailable=false with network error message
  - Authentication failure: Return authenticated=false with auth error message
  - Timeout: Return apiAvailable=false with timeout error

**Acceptance Criteria**
- AC-1.5.a: When `health_check` tool is called with valid API key → Returns success with authenticated=true
- AC-1.5.b: When `health_check` tool is called with invalid API key → Returns success with authenticated=false
- AC-1.5.c: When API is unreachable → Returns success with apiAvailable=false and error message
- AC-1.5.d: When API responds within 2 seconds → Response includes responseTimeMs field with accurate timing
- AC-1.5.e: When health check succeeds → Tool appears in Claude Code's MCP tool list

**Acceptance Tests**
- Test-1.5.a: Integration test with valid API key validates authenticated=true response
- Test-1.5.b: Integration test with invalid API key validates authenticated=false response
- Test-1.5.c: Integration test with unreachable API (mock network failure) validates apiAvailable=false
- Test-1.5.d: Integration test validates responseTimeMs is present and reasonable (<5000ms)
- Test-1.5.e: Manual test in Claude Code validates tool appears and executes successfully

---

## Phase 2: Core Read Operations
**Purpose:** Implement read-only MCP tools for fetching project state, enabling Claude Code to discover and understand project structure before implementing write operations. This phase establishes the data retrieval patterns and validates API integration.

### 2.1 Read Project Tool
Implement MCP tool to fetch complete project details by project number.

**Implementation Details**
- **Systems affected:** MCP server tools, api GET endpoints
- **Tool name:** `read_project`
- **Tool description:** "Fetch complete project details from GitHub Projects by project number. Returns project metadata, fields, phases, and high-level statistics. Use this to understand project structure before reading issues."
- **Input schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "projectNumber": {
        "type": "number",
        "description": "GitHub Project number (e.g., 70 for Project #70)"
      }
    },
    "required": ["projectNumber"]
  }
  ```
- **Handler logic:**
  - Make GET request to `${apiBaseUrl}/api/projects/${projectNumber}`
  - Parse response and extract Project object
  - Include phases, field definitions, and summary statistics
  - Handle 404 (project not found) with clear error message
- **Output format:** Full Project object with nested phases array
- **Error handling:**
  - 404: "Project #{projectNumber} not found"
  - 401/403: "Authentication failed. Check STATE_TRACKING_API_KEY"
  - Network error: "Failed to connect to api"
- **Failure modes:**
  - Invalid project number (negative, non-integer): Validation error
  - Project not found: User-friendly 404 error
  - Malformed API response: JSON parse error with details

**Acceptance Criteria**
- AC-2.1.a: When `read_project` is called with valid project number → Returns complete Project object with phases
- AC-2.1.b: When `read_project` is called with non-existent project number → Returns error "Project #999 not found"
- AC-2.1.c: When `read_project` is called with invalid parameter (string) → Returns validation error
- AC-2.1.d: When API returns malformed JSON → Returns parse error with details
- AC-2.1.e: When project has multiple phases → All phases appear in response phases array

**Acceptance Tests**
- Test-2.1.a: Integration test with known project validates complete Project object structure
- Test-2.1.b: Integration test with project number 999999 validates 404 error message
- Test-2.1.c: Unit test with invalid parameter validates schema validation error
- Test-2.1.d: Unit test with malformed JSON response validates parse error handling
- Test-2.1.e: Integration test with multi-phase project validates all phases returned

---

### 2.2 List Issues Tool
Implement MCP tool to list project issues with optional filtering by status, phase, and assignee.

**Implementation Details**
- **Systems affected:** MCP server tools, api GET endpoints
- **Tool name:** `list_issues`
- **Tool description:** "List all issues in a GitHub Project with optional filtering. Returns issue summaries including title, status, phase, assignee, and labels. Use filters to narrow results to specific phases or statuses."
- **Input schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "projectNumber": {
        "type": "number",
        "description": "GitHub Project number"
      },
      "status": {
        "type": "string",
        "enum": ["backlog", "todo", "in_progress", "done"],
        "description": "Filter by issue status (optional)"
      },
      "phase": {
        "type": "string",
        "description": "Filter by phase name (optional)"
      },
      "assignee": {
        "type": "string",
        "description": "Filter by GitHub username (optional)"
      }
    },
    "required": ["projectNumber"]
  }
  ```
- **Handler logic:**
  - Make GET request to `${apiBaseUrl}/api/projects/${projectNumber}/issues` with query parameters
  - Apply filters via API query parameters: `?status={status}&phase={phase}&assignee={assignee}`
  - Parse response array of Issue objects
  - Return summary format (not full issue details) for performance
- **Output format:** Array of Issue summary objects
- **Performance:** Should handle 100+ issues efficiently (<2s response time)
- **Failure modes:**
  - Invalid status enum: Validation error listing valid statuses
  - Project not found: 404 error
  - Empty results: Return empty array (not error)

**Acceptance Criteria**
- AC-2.2.a: When `list_issues` is called with only project number → Returns all issues in project
- AC-2.2.b: When `list_issues` is called with status filter → Returns only issues matching that status
- AC-2.2.c: When `list_issues` is called with phase filter → Returns only issues in that phase
- AC-2.2.d: When `list_issues` is called with multiple filters → Returns issues matching all filters (AND logic)
- AC-2.2.e: When no issues match filters → Returns empty array with success status
- AC-2.2.f: When project has 100+ issues → Response completes in <2 seconds

**Acceptance Tests**
- Test-2.2.a: Integration test lists all issues and validates array structure
- Test-2.2.b: Integration test with status="in_progress" validates only in-progress issues returned
- Test-2.2.c: Integration test with phase filter validates only issues in that phase returned
- Test-2.2.d: Integration test with status AND phase filters validates AND logic
- Test-2.2.e: Integration test with impossible filter combination validates empty array response
- Test-2.2.f: Load test with project containing 100 issues validates <2s response time

---

### 2.3 Get Project Phases Tool
Implement MCP tool to fetch the phase structure and configuration for a project.

**Implementation Details**
- **Systems affected:** MCP server tools, api GET endpoints
- **Tool name:** `get_project_phases`
- **Tool description:** "Get the list of phases (sequential stages) defined for a GitHub Project. Returns phase names, order, and work item counts. Use this to understand project structure before moving issues between phases."
- **Input schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "projectNumber": {
        "type": "number",
        "description": "GitHub Project number"
      }
    },
    "required": ["projectNumber"]
  }
  ```
- **Handler logic:**
  - Make GET request to `${apiBaseUrl}/api/projects/${projectNumber}/phases`
  - Parse response array of Phase objects
  - Include phase order, work item counts, and completion status
- **Output format:** Array of Phase objects with nested work items summary
- **Caching consideration:** Phases change infrequently, consider 5-minute cache
- **Failure modes:**
  - Project not found: 404 error
  - No phases defined: Return empty array

**Acceptance Criteria**
- AC-2.3.a: When `get_project_phases` is called for project with phases → Returns ordered array of Phase objects
- AC-2.3.b: When `get_project_phases` is called for project without phases → Returns empty array
- AC-2.3.c: When phases are returned → Array is ordered by phase sequence number
- AC-2.3.d: When phase has work items → Work item count is included in response
- AC-2.3.e: When project does not exist → Returns 404 error

**Acceptance Tests**
- Test-2.3.a: Integration test with multi-phase project validates Phase array structure
- Test-2.3.b: Integration test with phase-less project validates empty array response
- Test-2.3.c: Integration test validates phases returned in correct sequence order
- Test-2.3.d: Integration test validates work item counts match actual work items
- Test-2.3.e: Integration test with invalid project number validates 404 error

---

### 2.4 Get Issue Details Tool
Implement MCP tool to fetch complete details for a single issue, including work items and activity.

**Implementation Details**
- **Systems affected:** MCP server tools, api GET endpoints
- **Tool name:** `get_issue_details`
- **Tool description:** "Get complete details for a specific GitHub issue including description, status, phase, work items, labels, and recent activity. Use this after list_issues to get full information for a specific issue."
- **Input schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "projectNumber": {
        "type": "number",
        "description": "GitHub Project number"
      },
      "issueNumber": {
        "type": "number",
        "description": "GitHub issue number"
      }
    },
    "required": ["projectNumber", "issueNumber"]
  }
  ```
- **Handler logic:**
  - Make GET request to `${apiBaseUrl}/api/projects/${projectNumber}/issues/${issueNumber}`
  - Parse response and return full Issue object
  - Include nested work items array with completion status
- **Output format:** Complete Issue object with all fields and nested work items
- **Failure modes:**
  - Issue not found: 404 error with "Issue #{issueNumber} not found in Project #{projectNumber}"
  - Issue exists but not in project: 404 error clarifying issue-project mismatch

**Acceptance Criteria**
- AC-2.4.a: When `get_issue_details` is called with valid issue → Returns complete Issue object
- AC-2.4.b: When issue has work items → Work items array is populated with full details
- AC-2.4.c: When issue does not exist → Returns 404 error with issue number in message
- AC-2.4.d: When issue exists but not in specified project → Returns 404 error clarifying mismatch
- AC-2.4.e: When issue has labels → Labels array is included in response

**Acceptance Tests**
- Test-2.4.a: Integration test with known issue validates complete Issue object structure
- Test-2.4.b: Integration test with issue containing work items validates nested array
- Test-2.4.c: Integration test with non-existent issue validates 404 error message
- Test-2.4.d: Integration test with issue in different project validates mismatch error
- Test-2.4.e: Integration test with labeled issue validates labels array presence

---

## Phase 3: Core Write Operations
**Purpose:** Implement write operations (update and create) for issues and projects, enabling Claude Code to modify project state. This phase builds on read operations to enable full project management capabilities.

### 3.1 Update Issue Status Tool
Implement MCP tool to change issue status in GitHub Projects (backlog, todo, in_progress, done).

**Implementation Details**
- **Systems affected:** MCP server tools, api PUT endpoints, GitHub Projects API
- **Tool name:** `update_issue_status`
- **Tool description:** "Update the status of a GitHub issue in the project board. Valid statuses: backlog, todo, in_progress, done. This operation syncs to GitHub Projects and triggers extension notifications."
- **Input schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "projectNumber": {
        "type": "number",
        "description": "GitHub Project number"
      },
      "issueNumber": {
        "type": "number",
        "description": "GitHub issue number"
      },
      "status": {
        "type": "string",
        "enum": ["backlog", "todo", "in_progress", "done"],
        "description": "New status for the issue"
      }
    },
    "required": ["projectNumber", "issueNumber", "status"]
  }
  ```
- **Handler logic:**
  - Validate issue exists via GET request first
  - Make PUT request to `${apiBaseUrl}/api/projects/${projectNumber}/issues/${issueNumber}/status`
  - Request body: `{ "status": "{status}" }`
  - Parse updated Issue object from response
  - Trigger notification event (handled in Phase 4)
- **Output format:** Updated Issue object with new status
- **Optimistic locking:** If API supports ETags, include If-Match header to prevent conflicts
- **Failure modes:**
  - Invalid status transition: API validation error (return to user)
  - Issue not found: 404 error
  - Concurrent update conflict: 409 error with retry suggestion
  - GitHub API failure: Return error with GitHub API message

**Acceptance Criteria**
- AC-3.1.a: When `update_issue_status` is called with valid parameters → Issue status updates successfully
- AC-3.1.b: When status changes from "todo" to "in_progress" → GitHub Projects board reflects change
- AC-3.1.c: When invalid status value is provided → Returns validation error with valid statuses
- AC-3.1.d: When issue does not exist → Returns 404 error
- AC-3.1.e: When concurrent update occurs → Returns 409 conflict error with retry suggestion
- AC-3.1.f: When update succeeds → Returns updated Issue object with new status and update timestamp

**Acceptance Tests**
- Test-3.1.a: Integration test updates issue status and validates API response
- Test-3.1.b: Manual test validates GitHub Projects board shows updated status
- Test-3.1.c: Unit test with invalid status validates enum validation error
- Test-3.1.d: Integration test with non-existent issue validates 404 error
- Test-3.1.e: Integration test with simulated concurrent update validates 409 handling
- Test-3.1.f: Integration test validates response contains new status and timestamp

---

### 3.2 Update Issue Phase Tool
Implement MCP tool to move issues between project phases (sequential stages).

**Implementation Details**
- **Systems affected:** MCP server tools, api PUT endpoints, GitHub Projects API
- **Tool name:** `update_issue_phase`
- **Tool description:** "Move a GitHub issue to a different phase in the project. Phases represent sequential stages like 'Foundation', 'Core Features', etc. Use get_project_phases to see available phases first."
- **Input schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "projectNumber": {
        "type": "number",
        "description": "GitHub Project number"
      },
      "issueNumber": {
        "type": "number",
        "description": "GitHub issue number"
      },
      "phaseName": {
        "type": "string",
        "description": "Target phase name (must match existing phase)"
      }
    },
    "required": ["projectNumber", "issueNumber", "phaseName"]
  }
  ```
- **Handler logic:**
  - Validate phase exists via GET phases endpoint
  - Make PUT request to `${apiBaseUrl}/api/projects/${projectNumber}/issues/${issueNumber}/phase`
  - Request body: `{ "phaseName": "{phaseName}" }`
  - Parse updated Issue object from response
  - Trigger notification event (handled in Phase 4)
- **Output format:** Updated Issue object with new phase assignment
- **Validation:** Verify phase name exists in project before making update
- **Failure modes:**
  - Phase not found: 404 error with available phases listed
  - Issue not found: 404 error
  - Invalid phase name: Validation error with fuzzy match suggestions

**Acceptance Criteria**
- AC-3.2.a: When `update_issue_phase` is called with valid phase name → Issue moves to target phase
- AC-3.2.b: When phase name does not exist → Returns error listing available phases
- AC-3.2.c: When issue does not exist → Returns 404 error
- AC-3.2.d: When phase name has typo → Returns error with fuzzy match suggestions (e.g., "Did you mean 'Foundation'?")
- AC-3.2.e: When update succeeds → GitHub Projects board shows issue in new phase column

**Acceptance Tests**
- Test-3.2.a: Integration test moves issue to different phase and validates response
- Test-3.2.b: Integration test with invalid phase name validates error with phase list
- Test-3.2.c: Integration test with non-existent issue validates 404 error
- Test-3.2.d: Unit test validates fuzzy matching for common typos (e.g., "foundaton" → "Foundation")
- Test-3.2.e: Manual test validates GitHub Projects board reflects new phase assignment

---

### 3.3 Create Issue Tool
Implement MCP tool to create new GitHub issues and add them to projects.

**Implementation Details**
- **Systems affected:** MCP server tools, api POST endpoints, GitHub Issues API, GitHub Projects API
- **Tool name:** `create_issue`
- **Tool description:** "Create a new GitHub issue and add it to the project board. Optionally set initial status, phase, assignee, and labels. Returns the created issue with its GitHub issue number."
- **Input schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "projectNumber": {
        "type": "number",
        "description": "GitHub Project number to add issue to"
      },
      "title": {
        "type": "string",
        "description": "Issue title (required)"
      },
      "body": {
        "type": "string",
        "description": "Issue description in markdown (optional)"
      },
      "status": {
        "type": "string",
        "enum": ["backlog", "todo", "in_progress", "done"],
        "description": "Initial status (default: backlog)"
      },
      "phase": {
        "type": "string",
        "description": "Initial phase name (optional)"
      },
      "assignee": {
        "type": "string",
        "description": "GitHub username to assign (optional)"
      },
      "labels": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Array of label names (optional)"
      }
    },
    "required": ["projectNumber", "title"]
  }
  ```
- **Handler logic:**
  - Validate project exists
  - If phase provided, validate phase exists
  - Make POST request to `${apiBaseUrl}/api/projects/${projectNumber}/issues`
  - Request body: Full issue creation payload
  - Parse created Issue object from response (includes new issue number)
  - Trigger notification event (handled in Phase 4)
- **Output format:** Created Issue object with GitHub issue number and URL
- **Validation:**
  - Title non-empty (1-256 characters)
  - Phase name exists if provided
  - Assignee is valid GitHub user if provided
  - Labels exist in repository if provided
- **Failure modes:**
  - Empty title: Validation error
  - Invalid phase: 404 error with available phases
  - Invalid assignee: GitHub API error with details
  - Repository permission denied: 403 error with permission message
  - Rate limit exceeded: 429 error with retry-after

**Acceptance Criteria**
- AC-3.3.a: When `create_issue` is called with title only → Creates issue with default status "backlog"
- AC-3.3.b: When `create_issue` includes body → Issue description contains provided markdown
- AC-3.3.c: When `create_issue` includes status → Issue is created with specified status
- AC-3.3.d: When `create_issue` includes phase → Issue is assigned to specified phase
- AC-3.3.e: When `create_issue` includes assignee → Issue is assigned to GitHub user
- AC-3.3.f: When `create_issue` includes labels → Issue has specified labels applied
- AC-3.3.g: When title is empty → Returns validation error
- AC-3.3.h: When issue is created → Returns Issue object with GitHub issue number and URL

**Acceptance Tests**
- Test-3.3.a: Integration test creates minimal issue and validates default status
- Test-3.3.b: Integration test creates issue with body and validates markdown rendering
- Test-3.3.c: Integration test creates issue with status="todo" and validates status
- Test-3.3.d: Integration test creates issue with phase and validates phase assignment
- Test-3.3.e: Integration test creates issue with assignee and validates assignment
- Test-3.3.f: Integration test creates issue with labels and validates label application
- Test-3.3.g: Unit test with empty title validates validation error
- Test-3.3.h: Integration test validates response contains issue number and GitHub URL

---

### 3.4 Update Issue Details Tool
Implement MCP tool to update issue title, description, assignee, and labels.

**Implementation Details**
- **Systems affected:** MCP server tools, api PUT endpoints, GitHub Issues API
- **Tool name:** `update_issue`
- **Tool description:** "Update issue details including title, description, assignee, or labels. Only provided fields will be updated (partial update supported). Use this for general issue modifications beyond status/phase changes."
- **Input schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "projectNumber": {
        "type": "number",
        "description": "GitHub Project number"
      },
      "issueNumber": {
        "type": "number",
        "description": "GitHub issue number"
      },
      "title": {
        "type": "string",
        "description": "New title (optional)"
      },
      "body": {
        "type": "string",
        "description": "New description in markdown (optional)"
      },
      "assignee": {
        "type": "string",
        "description": "GitHub username to assign (optional, use null to unassign)"
      },
      "labels": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Complete array of label names (replaces existing labels)"
      }
    },
    "required": ["projectNumber", "issueNumber"]
  }
  ```
- **Handler logic:**
  - Validate issue exists
  - Make PATCH request to `${apiBaseUrl}/api/projects/${projectNumber}/issues/${issueNumber}`
  - Request body: Only include provided fields (partial update)
  - Parse updated Issue object from response
  - Trigger notification event (handled in Phase 4)
- **Output format:** Updated Issue object with modified fields
- **Partial update semantics:** Only modify provided fields, leave others unchanged
- **Failure modes:**
  - Issue not found: 404 error
  - Empty title: Validation error
  - Invalid assignee: GitHub API error
  - Permission denied: 403 error

**Acceptance Criteria**
- AC-3.4.a: When `update_issue` is called with only title → Only title is updated, other fields unchanged
- AC-3.4.b: When `update_issue` is called with assignee=null → Issue assignee is removed
- AC-3.4.c: When `update_issue` is called with labels → Labels are replaced (not merged) with provided array
- AC-3.4.d: When no update fields are provided → Returns validation error "At least one field required"
- AC-3.4.e: When issue does not exist → Returns 404 error
- AC-3.4.f: When update succeeds → Returns updated Issue object with modification timestamp

**Acceptance Tests**
- Test-3.4.a: Integration test updates only title and validates other fields unchanged
- Test-3.4.b: Integration test sets assignee=null and validates assignee removed
- Test-3.4.c: Integration test updates labels and validates complete replacement
- Test-3.4.d: Unit test with no fields validates validation error
- Test-3.4.e: Integration test with non-existent issue validates 404 error
- Test-3.4.f: Integration test validates response includes updated timestamp

---

## Phase 4: Real-Time Notification System
**Purpose:** Implement WebSocket/SSE-based notification system to push real-time updates from the MCP server to the VSCode extension, eliminating manual refresh requirements. This phase enables true bidirectional synchronization.

### 4.1 Notification Event Architecture
Design and implement event bus architecture for broadcasting state change notifications.

**Implementation Details**
- **Systems affected:** MCP server, api, VSCode extension
- **Event bus module:** `packages/mcp-server/src/events/event-bus.ts`
- **Event types:**
  ```typescript
  type EventType =
    | 'project.updated'
    | 'issue.created'
    | 'issue.updated'
    | 'issue.deleted'
    | 'phase.updated';

  interface StateChangeEvent {
    type: EventType;
    timestamp: string;
    projectNumber: number;
    issueNumber?: number;
    data: unknown; // Type-specific payload
  }
  ```
- **Core logic:**
  - In-memory event bus using EventEmitter pattern
  - Subscribe/unsubscribe methods for clients
  - Emit methods called from tool handlers after successful operations
  - Event filtering by project number for scoped subscriptions
- **Integration points:**
  - Update tool handlers (3.1-3.4) to emit events after successful operations
  - Create subscription endpoint for WebSocket clients
- **Performance:** Support 100+ concurrent subscribers with <100ms event delivery
- **Failure modes:**
  - Subscriber connection drops: Remove from subscriber list, no error
  - Event delivery failure: Log error, continue to other subscribers

**Acceptance Criteria**
- AC-4.1.a: When state change occurs → Event is emitted to event bus with correct type and payload
- AC-4.1.b: When client subscribes → Client is added to subscriber list
- AC-4.1.c: When client unsubscribes → Client is removed from subscriber list
- AC-4.1.d: When event is emitted → All active subscribers receive event within 100ms
- AC-4.1.e: When subscriber connection fails → Other subscribers continue receiving events

**Acceptance Tests**
- Test-4.1.a: Integration test updates issue and validates event emission with correct payload
- Test-4.1.b: Unit test validates subscription adds client to internal list
- Test-4.1.c: Unit test validates unsubscription removes client from list
- Test-4.1.d: Integration test with timing validates event delivery <100ms
- Test-4.1.e: Integration test with failing subscriber validates other subscribers unaffected

---

### 4.2 WebSocket Server Implementation
Implement WebSocket server for persistent connections with VSCode extension.

**Implementation Details**
- **Systems affected:** MCP server, VSCode extension
- **WebSocket module:** `packages/mcp-server/src/notifications/websocket-server.ts`
- **Library:** Use `ws` library for WebSocket server
- **Server configuration:**
  - Port: Configurable via WS_PORT environment variable (default: 8080)
  - Path: `/notifications`
  - Authentication: Require API key in connection query parameter or header
- **Connection lifecycle:**
  - Client connects with authentication
  - Server validates API key
  - Client sends subscription message with project filters
  - Server subscribes client to event bus
  - Server pushes events to client as JSON messages
  - Client can ping/pong for keepalive
  - On disconnect, unsubscribe from event bus
- **Message format:**
  ```typescript
  // Client → Server (subscription)
  {
    "type": "subscribe",
    "projectNumbers": [70, 71] // Optional filter
  }

  // Server → Client (event)
  {
    "type": "event",
    "event": StateChangeEvent
  }

  // Server → Client (error)
  {
    "type": "error",
    "message": "Error description"
  }
  ```
- **Keepalive:** Send ping every 30 seconds, disconnect if no pong after 60 seconds
- **Reconnection:** Client responsibility with exponential backoff
- **Failure modes:**
  - Invalid authentication: Close connection with 401 error code
  - Malformed subscription message: Send error message, keep connection open
  - Event delivery failure: Log error, attempt reconnection

**Acceptance Criteria**
- AC-4.2.a: When client connects with valid API key → Connection is established successfully
- AC-4.2.b: When client connects without API key → Connection is closed with 401 error
- AC-4.2.c: When client sends subscription message → Client receives subsequent events for subscribed projects
- AC-4.2.d: When state change occurs → Subscribed clients receive event within 2 seconds
- AC-4.2.e: When client connection drops → Client is unsubscribed from event bus
- AC-4.2.f: When keepalive ping is sent → Client responds with pong within 5 seconds

**Acceptance Tests**
- Test-4.2.a: Integration test establishes WebSocket connection with valid key
- Test-4.2.b: Integration test validates connection rejection with invalid key
- Test-4.2.c: Integration test sends subscription and validates event reception
- Test-4.2.d: Integration test triggers state change and validates <2s event delivery
- Test-4.2.e: Integration test validates cleanup after connection drop
- Test-4.2.f: Integration test validates ping/pong keepalive mechanism

---

### 4.3 VSCode Extension WebSocket Client
Implement WebSocket client in VSCode extension to receive real-time notifications.

**Implementation Details**
- **Systems affected:** VSCode extension (`apps/code-ext`)
- **Client module:** `apps/code-ext/src/notifications/websocket-client.ts`
- **Library:** Use `ws` library (or browser-compatible WebSocket API)
- **Configuration:**
  - WebSocket URL from extension settings (default: ws://localhost:8080/notifications)
  - API key from extension settings (same as used for API calls)
- **Connection lifecycle:**
  - Establish connection on extension activation
  - Authenticate with API key
  - Subscribe to active project numbers
  - Receive and process events
  - Update extension UI (project tree, issue details)
  - Reconnect on disconnection with exponential backoff (1s, 2s, 4s, 8s, max 30s)
- **Event handling:**
  - `issue.created` → Refresh project tree, add new issue to UI
  - `issue.updated` → Update issue in UI without full refresh
  - `issue.deleted` → Remove issue from UI
  - `project.updated` → Refresh project metadata
  - `phase.updated` → Refresh phase structure
- **UI updates:** Batch multiple events within 500ms window to prevent excessive refreshes
- **Failure modes:**
  - Connection failure: Show status bar warning, attempt reconnection
  - Invalid event format: Log error, ignore event
  - UI update error: Log error, schedule full refresh

**Acceptance Criteria**
- AC-4.3.a: When extension activates → WebSocket connection is established automatically
- AC-4.3.b: When issue is updated via Claude Code → Extension UI updates within 2 seconds without manual refresh
- AC-4.3.c: When connection drops → Extension attempts reconnection with exponential backoff
- AC-4.3.d: When multiple events occur rapidly → UI updates are batched to prevent excessive refreshes
- AC-4.3.e: When extension deactivates → WebSocket connection is closed gracefully
- AC-4.3.f: When WebSocket URL is invalid → Extension shows error message with configuration instructions

**Acceptance Tests**
- Test-4.3.a: Integration test validates connection on extension activation
- Test-4.3.b: End-to-end test validates UI update after Claude Code issue update
- Test-4.3.c: Integration test simulates connection drop and validates reconnection
- Test-4.3.d: Integration test sends rapid events and validates batching behavior
- Test-4.3.e: Integration test validates graceful connection close on deactivation
- Test-4.3.f: Integration test with invalid URL validates error message display

---

### 4.4 Notification Reliability and Error Handling
Implement reliability mechanisms for notification delivery and error recovery.

**Implementation Details**
- **Systems affected:** WebSocket server, WebSocket client, event bus
- **Reliability mechanisms:**
  - **Message acknowledgment:** Client sends ack for each event received
  - **Event sequence numbers:** Server assigns sequence number to each event per client
  - **Missed event detection:** Client detects gaps in sequence numbers, requests replay
  - **Event replay buffer:** Server maintains 100-event buffer per project for replay
  - **Idempotency:** Client handles duplicate events gracefully (use sequence numbers)
- **Replay endpoint:**
  - Client can request events since specific sequence number
  - Server returns buffered events in order
- **Error recovery flows:**
  - Connection drop → Reconnect → Request replay since last received sequence
  - Invalid event → Log error → Send error to client → Continue processing
  - UI update failure → Log error → Mark client for full refresh on next event
- **Monitoring:**
  - Log successful event deliveries
  - Log failed deliveries with reason
  - Track event bus queue depth (alert if >1000)
  - Track client connection count
- **Failure modes:**
  - Event buffer overflow: Drop oldest events, log warning
  - Replay request for expired events: Return available events, notify client of gap
  - Persistent client errors: After 10 errors, disconnect client

**Acceptance Criteria**
- AC-4.4.a: When client reconnects after brief disconnect → Receives missed events via replay
- AC-4.4.b: When client receives duplicate event → Ignores duplicate based on sequence number
- AC-4.4.c: When event buffer overflows → Oldest events are dropped, warning is logged
- AC-4.4.d: When client detects sequence gap → Requests and receives replay of missed events
- AC-4.4.e: When client experiences persistent errors → Server disconnects client after 10 errors
- AC-4.4.f: When server restarts → Clients reconnect and request replay automatically

**Acceptance Tests**
- Test-4.4.a: Integration test simulates disconnect and validates replay on reconnect
- Test-4.4.b: Integration test sends duplicate event and validates client ignores it
- Test-4.4.c: Integration test overflows buffer and validates oldest event dropped
- Test-4.4.d: Integration test creates sequence gap and validates replay request
- Test-4.4.e: Integration test simulates client errors and validates disconnect after 10
- Test-4.4.f: Integration test restarts server and validates client reconnection and replay

---

## Phase 5: Integration, Testing & Migration
**Purpose:** Perform comprehensive end-to-end testing, migrate from legacy `update-project.sh` script, create documentation, and validate production readiness. This phase ensures the complete system works reliably before deployment.

### 5.1 End-to-End Integration Testing
Create comprehensive test suite covering complete workflows from Claude Code to VSCode extension.

**Implementation Details**
- **Systems affected:** All components (MCP server, api, VSCode extension, Claude Code)
- **Test framework:** Jest with custom integration test helpers
- **Test scenarios:**
  1. **Create project workflow:** Claude creates project → Extension shows new project
  2. **Create issue workflow:** Claude creates issue → Extension shows new issue in project
  3. **Update status workflow:** Claude updates issue status → Extension UI reflects change
  4. **Move phase workflow:** Claude moves issue to new phase → Extension shows issue in new phase
  5. **Concurrent updates:** Two Claude sessions update same project → No data loss or corruption
  6. **Network failure recovery:** Connection drops during update → Retry succeeds, no duplicate data
  7. **Full project lifecycle:** Create project → Add phases → Create issues → Update statuses → Complete project
- **Test environment:**
  - Use test instance of api (or mock server)
  - Use test GitHub repository for issue operations
  - Automated Claude Code session simulation (scripted tool calls)
- **Performance tests:**
  - Create 100 issues → Validate <10s total time
  - Update 50 issues concurrently → Validate no failures
  - Extension handles 100 rapid events → UI updates correctly
- **Error scenario tests:**
  - Invalid API key → Clear error message
  - API timeout → Retry with backoff
  - GitHub rate limit → Graceful error with retry-after
  - WebSocket disconnect → Automatic reconnection
- **Failure modes:**
  - Test flakiness: Implement retries for network-dependent tests
  - Environment setup failure: Validate test environment before running tests

**Acceptance Criteria**
- AC-5.1.a: When full project lifecycle test runs → All steps complete successfully with assertions passing
- AC-5.1.b: When concurrent update test runs → No data corruption or lost updates occur
- AC-5.1.c: When network failure test runs → System recovers and completes operation successfully
- AC-5.1.d: When performance tests run → All operations complete within defined time thresholds
- AC-5.1.e: When error scenario tests run → All error cases produce expected error messages and recovery behavior
- AC-5.1.f: When complete test suite runs → >95% tests pass with <5% flakiness rate

**Acceptance Tests**
- Test-5.1.a: E2E test executes full project lifecycle and validates each step
- Test-5.1.b: E2E test simulates concurrent updates from two sessions and validates data consistency
- Test-5.1.c: E2E test simulates network failure and validates retry and recovery
- Test-5.1.d: Performance test suite validates all timing requirements
- Test-5.1.e: Error scenario test suite validates all error handling paths
- Test-5.1.f: CI/CD pipeline runs full test suite and validates pass rate

---

### 5.2 Migration from update-project.sh
Create migration path and tooling to transition from signal file approach to MCP tools.

**Implementation Details**
- **Systems affected:** Examples directory, documentation, Claude Code prompts
- **Migration steps:**
  1. Create migration guide document
  2. Add deprecation notice to `update-project.sh` script
  3. Create equivalent MCP tool examples for all `update-project.sh` use cases
  4. Update Claude Code system prompts to prefer MCP tools over shell scripts
  5. Add detection for signal file usage with migration suggestions
- **Migration guide contents:**
  - Side-by-side comparison of old vs new approach
  - Step-by-step migration instructions
  - Troubleshooting common issues
  - Performance benefits of MCP approach
- **Backward compatibility:**
  - Keep `update-project.sh` functional but deprecated for 1 release cycle
  - Add warning message when script is executed
  - Provide equivalent MCP tool command in warning
- **Tool examples:** Create `examples/mcp-tools/` directory with:
  - `create-project.md` - Example Claude prompts for project creation
  - `update-issue.md` - Example prompts for issue updates
  - `move-issue.md` - Example prompts for phase movements
  - `project-workflow.md` - Complete workflow examples
- **Failure modes:**
  - Users unaware of deprecation: Add prominent notices in multiple locations
  - MCP tools not configured: Provide setup validation checklist

**Acceptance Criteria**
- AC-5.2.a: When migration guide is reviewed → Contains clear step-by-step instructions for all use cases
- AC-5.2.b: When `update-project.sh` is executed → Displays deprecation warning with MCP alternative
- AC-5.2.c: When MCP tool examples are reviewed → Cover all functionality previously provided by shell script
- AC-5.2.d: When Claude Code is used after migration → Automatically prefers MCP tools over shell scripts
- AC-5.2.e: When users follow migration guide → Can successfully transition without data loss or downtime

**Acceptance Tests**
- Test-5.2.a: Manual review validates migration guide completeness and clarity
- Test-5.2.b: Integration test executes shell script and validates warning message appears
- Test-5.2.c: Manual review validates MCP examples cover all shell script functionality
- Test-5.2.d: Integration test with Claude Code validates MCP tool preference
- Test-5.2.e: User acceptance test with sample user validates successful migration

---

### 5.3 Documentation and Examples
Create comprehensive documentation for developers and users.

**Implementation Details**
- **Systems affected:** Documentation, examples directory, README files
- **Documentation deliverables:**
  1. **MCP Server README:** `packages/mcp-server/README.md`
     - Installation and setup instructions
     - Configuration reference (environment variables)
     - Tool reference (all 10+ tools with parameters and examples)
     - Architecture overview (diagrams)
     - Troubleshooting guide
  2. **VSCode Extension Documentation:** Update `apps/code-ext/README.md`
     - WebSocket notification setup
     - Configuration settings
     - Troubleshooting connection issues
  3. **Integration Guide:** `docs/mcp-integration.md`
     - Complete setup walkthrough
     - Claude Code configuration
     - Extension configuration
     - API key setup
     - Verification steps
  4. **API Reference:** `docs/api-reference.md`
     - All MCP tools with JSON schemas
     - Request/response examples
     - Error codes and messages
  5. **Developer Guide:** `docs/mcp-development.md`
     - Adding new tools
     - Event bus architecture
     - Testing guidelines
- **Code examples:**
  - Example Claude prompts for common tasks
  - VSCode extension configuration snippets
  - Automated setup scripts where possible
- **Diagrams:**
  - Architecture diagram (MCP server, API, extension, Claude Code)
  - Sequence diagrams for key workflows
  - WebSocket notification flow diagram
- **Failure modes:**
  - Outdated documentation: Add docs update checklist to PR template
  - Missing edge cases: Incorporate user feedback into docs

**Acceptance Criteria**
- AC-5.3.a: When MCP Server README is reviewed → Contains complete setup instructions that new user can follow
- AC-5.3.b: When tool reference is reviewed → All tools have parameter descriptions and usage examples
- AC-5.3.c: When integration guide is followed → User successfully configures entire system end-to-end
- AC-5.3.d: When architecture diagrams are reviewed → Clearly illustrate component relationships and data flow
- AC-5.3.e: When troubleshooting guides are reviewed → Cover common issues with clear resolution steps

**Acceptance Tests**
- Test-5.3.a: User acceptance test with new developer validates README sufficiency
- Test-5.3.b: Manual review validates all tools documented with examples
- Test-5.3.c: User acceptance test validates integration guide completeness
- Test-5.3.d: Manual review validates diagram accuracy and clarity
- Test-5.3.e: Manual review validates troubleshooting guide covers known issues

---

### 5.4 Production Readiness Validation
Validate system meets production requirements for performance, reliability, security, and observability.

**Implementation Details**
- **Systems affected:** All components
- **Validation areas:**
  1. **Performance:**
     - MCP tool response time: <500ms for read operations, <2s for write operations
     - WebSocket event delivery: <2s latency
     - Extension UI update: <2s after state change
     - Concurrent client support: 50+ simultaneous WebSocket connections
     - Load test: 1000 operations/hour sustained
  2. **Reliability:**
     - Uptime target: 99.5% (excluding maintenance)
     - Event delivery success rate: >99%
     - Automatic reconnection: <30s recovery after disconnect
     - Zero data loss during failures
  3. **Security:**
     - API key validation on all requests
     - No sensitive data in logs (sanitize API keys)
     - WebSocket authentication required
     - HTTPS for API communication (ws:// only for localhost)
  4. **Observability:**
     - Structured logging with levels (debug, info, warn, error)
     - Key metrics: request count, error rate, response time, connection count
     - Error tracking with stack traces
     - Health check endpoint
  5. **Error handling:**
     - All errors have clear, actionable messages
     - Retry guidance included in transient error messages
     - No uncaught exceptions
- **Validation methods:**
  - Load testing with k6 or similar tool
  - Security audit with checklist
  - Log analysis for sensitive data
  - Error injection testing (chaos engineering)
- **Failure modes:**
  - Performance regression: Establish baseline metrics, fail CI if exceeded
  - Security vulnerability: Automated security scanning in CI
  - Missing observability: Validate logs and metrics in all code paths

**Acceptance Criteria**
- AC-5.4.a: When load test runs with 1000 operations/hour → All operations complete within performance thresholds
- AC-5.4.b: When 50 concurrent WebSocket connections are active → All connections receive events successfully
- AC-5.4.c: When security audit is performed → No sensitive data appears in logs or error messages
- AC-5.4.d: When error injection test runs → System recovers gracefully from all injected failures
- AC-5.4.e: When observability validation runs → All key metrics are logged and queryable
- AC-5.4.f: When production readiness checklist is completed → All items marked complete

**Acceptance Tests**
- Test-5.4.a: Load test with k6 validates sustained 1000 ops/hour performance
- Test-5.4.b: Integration test establishes 50 WebSocket connections and validates event delivery
- Test-5.4.c: Automated log scanning validates no API keys or sensitive data present
- Test-5.4.d: Chaos test injects network failures, API errors, and validates recovery
- Test-5.4.e: Metrics validation test confirms all required metrics are emitted
- Test-5.4.f: Manual checklist review validates all production criteria met

---

### 5.5 Claude Code Integration Validation
Validate Claude Code successfully discovers and uses MCP tools for project management.

**Implementation Details**
- **Systems affected:** Claude Code, MCP server configuration
- **Configuration:**
  - Add MCP server to Claude Code's MCP configuration file
  - Ensure server starts automatically when Claude Code launches
  - Validate tool discovery via MCP protocol
- **Test scenarios:**
  1. **Tool discovery:** Claude can list all available MCP tools
  2. **Tool usage:** Claude successfully uses tools in natural conversation
  3. **Error handling:** Claude receives and understands error messages
  4. **Workflow completion:** Claude completes multi-step workflows using tools
  5. **Preference:** Claude prefers MCP tools over shell scripts for project operations
- **Claude Code configuration:**
  - MCP server entry in `~/.claude/mcp_servers.json` or equivalent
  - Server startup command and arguments
  - Environment variable configuration
- **Validation methods:**
  - Interactive testing with sample prompts
  - Automated prompt testing (scripted conversations)
  - Error scenario testing (invalid parameters, missing resources)
- **Documentation for Claude:**
  - Tool descriptions optimized for LLM understanding
  - Clear parameter names and descriptions
  - Usage examples in tool descriptions
  - Error message format designed for LLM parsing
- **Failure modes:**
  - Tools not discovered: Validate MCP protocol handshake
  - Tools not used: Improve tool descriptions for discoverability
  - Errors not understood: Enhance error message clarity

**Acceptance Criteria**
- AC-5.5.a: When Claude Code starts → MCP server starts automatically and tools are discovered
- AC-5.5.b: When user asks Claude to create issue → Claude uses `create_issue` MCP tool without prompting
- AC-5.5.c: When user asks Claude to update project → Claude uses MCP tools instead of shell scripts
- AC-5.5.d: When MCP tool returns error → Claude understands error and suggests resolution or retry
- AC-5.5.e: When user requests multi-step workflow → Claude chains multiple MCP tools to complete task
- AC-5.5.f: When user asks what project operations are available → Claude lists MCP tools with descriptions

**Acceptance Tests**
- Test-5.5.a: Integration test validates MCP server startup and tool discovery
- Test-5.5.b: Interactive test with sample prompt validates create_issue tool usage
- Test-5.5.c: Interactive test validates MCP tool preference over shell scripts
- Test-5.5.d: Integration test with error scenario validates Claude's error handling
- Test-5.5.e: Interactive test with complex workflow validates multi-tool chaining
- Test-5.5.f: Interactive test validates Claude lists and explains available tools

---

## 3. Completion Criteria
The project is considered complete when:

### All Phase Acceptance Criteria Pass
- **Phase 1 (Foundation):** All 18 acceptance criteria validated (1.1-1.5)
- **Phase 2 (Read Operations):** All 17 acceptance criteria validated (2.1-2.4)
- **Phase 3 (Write Operations):** All 22 acceptance criteria validated (3.1-3.4)
- **Phase 4 (Notifications):** All 20 acceptance criteria validated (4.1-4.4)
- **Phase 5 (Integration):** All 23 acceptance criteria validated (5.1-5.5)
- **Total:** 100 acceptance criteria with 100% pass rate

### All Acceptance Tests Green
- Unit tests: >95% pass rate
- Integration tests: >90% pass rate (allowing for environmental flakiness)
- End-to-end tests: >85% pass rate
- Manual/user acceptance tests: 100% pass rate
- Performance tests: 100% meet thresholds

### No Open P0 or P1 Issues Remain
- **P0 (Critical):** Zero open issues (system unusable or data loss)
- **P1 (High):** Zero open issues (major functionality broken or severe UX degradation)
- **P2 (Medium):** Acceptable to ship with <5 open issues (minor bugs, enhancements)
- **P3 (Low):** Acceptable to ship with any number (nice-to-haves, future improvements)

### Production Metrics Validated
- Manual refresh operations: 0 required during Claude Code sessions
- Extension update latency: <2 seconds (95th percentile)
- Tool adoption: 100% of Claude Code project operations use MCP tools
- Error rate: <1% for sync operations
- WebSocket uptime: >99% during testing period

### Documentation Complete
- All README files updated with MCP information
- Integration guide complete and validated by user test
- API reference complete for all tools
- Migration guide complete with deprecation notices
- Troubleshooting guides cover all common issues

### Backward Compatibility Maintained
- Existing VSCode extension functionality works without regression
- `update-project.sh` still functional (though deprecated)
- No breaking changes to api required
- Extension works with or without MCP server (graceful degradation)

---

## 4. Rollout & Validation

### Rollout Strategy

**Phase 1: Internal Alpha (Week 1)**
- Deploy to local development environment only
- Developer (stoked) uses MCP tools for real project work
- Collect initial feedback and identify critical bugs
- Validate core workflows: create, read, update projects/issues
- No user-facing announcement

**Phase 2: Beta Testing (Week 2)**
- Deploy MCP server package to npm (beta tag)
- Update extension to consume WebSocket notifications (beta release)
- Invite 2-3 early adopter users from internal team
- Provide setup guide and troubleshooting support
- Collect usage metrics and error logs
- Monitor for performance issues and data corruption

**Phase 3: General Availability (Week 3)**
- Release MCP server package to npm (stable tag)
- Release VSCode extension update with notification support
- Publish migration guide and documentation
- Add deprecation warnings to `update-project.sh`
- Announce via GitHub repository README and release notes
- Monitor adoption metrics and error rates

**Phase 4: Deprecation (Week 6+)**
- After 3 weeks of stable operation, increase deprecation warnings
- Schedule `update-project.sh` removal for next major version
- Ensure 100% migration to MCP tools

### Feature Flags
- `ENABLE_MCP_TOOLS`: Environment variable to enable/disable MCP server (default: enabled)
- `ENABLE_WEBSOCKET_NOTIFICATIONS`: Extension setting to enable/disable real-time sync (default: enabled)
- `FALLBACK_TO_POLLING`: Extension fallback if WebSocket fails (default: enabled, 30s interval)

### Progressive Exposure
- Week 1: Developer only (1 user)
- Week 2: Internal team (3-5 users)
- Week 3: All users (open access)

### Rollback Plan
- **Trigger conditions:**
  - >5% error rate in MCP tool calls
  - >10% WebSocket connection failures
  - Data corruption detected
  - Critical security vulnerability discovered
- **Rollback steps:**
  1. Disable MCP server via feature flag
  2. Revert extension to previous version (without WebSocket client)
  3. Re-enable `update-project.sh` without deprecation warnings
  4. Notify users of rollback and estimated resolution time
  5. Investigate and fix root cause
  6. Re-deploy with fix after validation

### Post-Launch Validation

**Metrics to Monitor**
- **Usage metrics:**
  - MCP tool call count (by tool type)
  - Unique users invoking MCP tools
  - Claude Code session count using MCP tools
  - Manual refresh actions in extension (target: 0)
- **Performance metrics:**
  - MCP tool response time (p50, p95, p99)
  - WebSocket event delivery latency (p50, p95, p99)
  - Extension UI update latency (p50, p95, p99)
  - API request count and rate limit usage
- **Reliability metrics:**
  - MCP tool error rate (by error type)
  - WebSocket connection failure rate
  - Reconnection success rate
  - Event delivery success rate
  - Uptime percentage
- **Quality metrics:**
  - User-reported bugs (by severity)
  - Claude Code tool preference (MCP vs shell script)
  - Setup completion rate (users successfully configured)

**Monitoring Tools**
- Application logs: Structured JSON logs with log levels
- Error tracking: Sentry or similar for exception tracking
- Metrics dashboard: Grafana or similar for visualizing metrics
- Health checks: Automated endpoint monitoring

**Rollback Triggers**
- Error rate >5% sustained for >10 minutes → Automatic rollback
- WebSocket connection failures >10% sustained for >10 minutes → Disable WebSocket, use polling
- Data corruption detected (any instance) → Immediate rollback and incident response
- Security vulnerability (CVSS >7.0) → Immediate rollback and patch
- User-reported critical bugs >3 in 24 hours → Manual rollback decision

**Success Validation (After 2 Weeks)**
- Manual refresh operations: <5% of users performing manual refreshes
- Extension update latency: <2s for >90% of events
- Tool adoption: >80% of project operations use MCP tools
- Error rate: <2% for sync operations
- User satisfaction: >80% positive feedback

---

## 5. Open Questions

### Authentication & Security
- **Q1:** Should MCP server use the same API key as the extension, or separate credentials?
  - **Recommendation:** Same API key for simplicity in initial release. Add separate scope/permissions in future version if needed.
  - **Decision needed by:** Phase 1.2 (API Client Integration)

- **Q2:** How should API keys be distributed to users? Manual configuration or automated setup?
  - **Recommendation:** Manual configuration via environment variable with clear setup guide. Explore automated setup (OAuth flow) in future version.
  - **Decision needed by:** Phase 1.4 (Configuration)

- **Q3:** Should WebSocket connections use wss:// (secure) or ws:// (plain) for localhost?
  - **Recommendation:** ws:// for localhost, wss:// for remote deployments. Add configuration option for production use.
  - **Decision needed by:** Phase 4.2 (WebSocket Server)

### Architecture & Technical
- **Q4:** Does the VSCode extension currently have WebSocket/SSE capability, or does this need to be added?
  - **Action required:** Review `apps/code-ext/src/extension.ts` to assess current architecture
  - **Decision needed by:** Phase 4.3 (Extension WebSocket Client)

- **Q5:** Should notifications use WebSocket or Server-Sent Events (SSE)?
  - **Recommendation:** WebSocket for bidirectional communication (allows client → server subscription messages). SSE is simpler but unidirectional.
  - **Decision needed by:** Phase 4.2 (WebSocket Server)

- **Q6:** How should the MCP server handle API downtime? Queue operations or fail fast?
  - **Recommendation:** Fail fast with clear error messages, let Claude retry. Queueing adds complexity and potential data loss.
  - **Decision needed by:** Phase 1.2 (API Client Integration)

### Tool Design
- **Q7:** Should we have fine-grained tools (e.g., `update_issue_title`, `update_issue_status` separately) or coarse-grained (e.g., `update_issue` with optional fields)?
  - **Recommendation:** Start with coarse-grained tools (fewer tools, more flexible). Refine to fine-grained based on Claude usage patterns if needed.
  - **Decision needed by:** Phase 3 (Write Operations)

- **Q8:** What's the appropriate level of detail for tool responses? Full objects or summaries?
  - **Recommendation:** Return full objects for single-entity operations (get_issue_details), summaries for list operations (list_issues). Include a `verbose` parameter for future flexibility.
  - **Decision needed by:** Phase 2 (Read Operations)

### Migration & Rollout
- **Q9:** What's the deprecation timeline for `update-project.sh`? Immediate or gradual?
  - **Recommendation:** Gradual deprecation with warnings for 3 weeks, then remove in next major version. Provides time for migration.
  - **Decision needed by:** Phase 5.2 (Migration)

- **Q10:** Should notification filtering be server-side (subscribe to specific projects) or client-side (receive all, filter locally)?
  - **Recommendation:** Server-side subscription with project number filters to reduce bandwidth. Client-side filtering adds unnecessary load.
  - **Decision needed by:** Phase 4.1 (Event Architecture)

### Performance & Scale
- **Q11:** What's the expected concurrent user count for the MCP server and WebSocket connections?
  - **Assumption:** Single-user/single-team initially (<10 concurrent users). Plan for 50+ connections in architecture for future growth.
  - **Decision needed by:** Phase 4.2 (WebSocket Server)

- **Q12:** Should the MCP server implement caching for frequently accessed data (projects, phases)?
  - **Recommendation:** Start without caching for simplicity. Add caching in Phase 5 or post-launch if performance issues arise.
  - **Decision needed by:** Phase 2 (Read Operations)

### Error Handling & UX
- **Q13:** How should conflicting concurrent updates be handled? Last-write-wins or optimistic locking?
  - **Recommendation:** Optimistic locking with ETags if API supports it. Return 409 conflict error to Claude with retry suggestion.
  - **Decision needed by:** Phase 3.1 (Update Operations)

- **Q14:** What level of detail should error messages provide to the LLM vs. the user?
  - **Recommendation:** Provide detailed, actionable errors to both. LLMs benefit from structured error formats; users need clear resolution steps.
  - **Decision needed by:** Phase 1.3 (Tool Framework)

---
