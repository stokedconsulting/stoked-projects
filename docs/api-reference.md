# MCP API Reference

Complete reference for all MCP tools, including JSON schemas, request/response examples, and error codes.

---

## Table of Contents

1. [Tool Overview](#tool-overview)
2. [Tool Specifications](#tool-specifications)
   - [health_check](#health_check)
   - [read_project](#read_project)
   - [get_project_phases](#get_project_phases)
   - [list_issues](#list_issues)
   - [get_issue_details](#get_issue_details)
   - [create_issue](#create_issue)
   - [update_issue_status](#update_issue_status)
   - [update_issue_phase](#update_issue_phase)
   - [update_issue](#update_issue)
3. [Error Codes](#error-codes)
4. [Data Types](#data-types)
5. [Event Types](#event-types)

---

## Tool Overview

| Tool Name | Category | Purpose | Read/Write |
|-----------|----------|---------|-----------|
| `health_check` | System | Verify API connectivity and authentication | Read |
| `read_project` | Projects | Fetch complete project details and metadata | Read |
| `get_project_phases` | Projects | List all phases in a project | Read |
| `list_issues` | Issues | Query issues with filtering | Read |
| `get_issue_details` | Issues | Get detailed information for a specific issue | Read |
| `create_issue` | Issues | Create new issue and add to project | Write |
| `update_issue_status` | Issues | Change issue status | Write |
| `update_issue_phase` | Issues | Move issue to different phase | Write |
| `update_issue` | Issues | Update multiple issue fields | Write |

---

## Tool Specifications

### health_check

Verify connectivity and authentication with the state tracking API.

**Use Cases**:
- Test MCP server configuration
- Verify API credentials
- Check network connectivity
- Measure API latency

#### Input Schema

```json
{
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false
}
```

**Parameters**: None

#### Request Example

```json
{}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "apiAvailable": {
      "type": "boolean",
      "description": "Whether the API is reachable and responding"
    },
    "authenticated": {
      "type": "boolean",
      "description": "Whether authentication is valid"
    },
    "responseTimeMs": {
      "type": "number",
      "description": "Response time in milliseconds"
    },
    "apiVersion": {
      "type": "string",
      "description": "API version string (optional)"
    },
    "error": {
      "type": "string",
      "description": "Error message if health check failed (optional)"
    }
  },
  "required": ["apiAvailable", "authenticated", "responseTimeMs"]
}
```

#### Success Response

```json
{
  "apiAvailable": true,
  "authenticated": true,
  "responseTimeMs": 145,
  "apiVersion": "1.0.0"
}
```

#### Error Response

```json
{
  "apiAvailable": false,
  "authenticated": false,
  "responseTimeMs": 5023,
  "error": "API health check failed: ECONNREFUSED"
}
```

#### Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `API health check failed: ECONNREFUSED` | API server not reachable | Check network connectivity and API URL |
| `Authentication failed: Invalid or expired API key` | Invalid credentials | Verify `STATE_TRACKING_API_KEY` in configuration |
| `Authentication check failed: timeout` | API not responding | Increase `REQUEST_TIMEOUT_MS` or check server status |

---

### read_project

Fetch complete project details including metadata, fields, phases, and statistics.

**Use Cases**:
- Get project overview before working on tasks
- Check available phases and fields
- Review project statistics
- Understand project structure

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "projectNumber": {
      "type": "number",
      "description": "GitHub Project number (e.g., 70 for Project #70)"
    }
  },
  "required": ["projectNumber"],
  "additionalProperties": false
}
```

#### Request Example

```json
{
  "projectNumber": 70
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "projectNumber": { "type": "number" },
    "id": { "type": "string", "description": "GitHub Project ID" },
    "title": { "type": "string" },
    "description": { "type": "string" },
    "url": { "type": "string" },
    "status": { "type": "string", "enum": ["open", "closed"] },
    "public": { "type": "boolean" },
    "owner": { "type": "string", "description": "Owner login (user or organization)" },
    "fields": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "dataType": { "type": "string" },
          "options": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "phases": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "description": { "type": "string" },
          "order": { "type": "number" },
          "status": { "type": "string", "enum": ["pending", "in_progress", "completed"] }
        }
      }
    },
    "stats": {
      "type": "object",
      "properties": {
        "totalItems": { "type": "number" },
        "openItems": { "type": "number" },
        "closedItems": { "type": "number" },
        "totalPhases": { "type": "number" }
      }
    },
    "createdAt": { "type": "string", "format": "date-time" },
    "updatedAt": { "type": "string", "format": "date-time" }
  },
  "required": ["projectNumber", "id", "title", "url", "status", "public", "owner", "fields", "phases", "stats", "createdAt", "updatedAt"]
}
```

#### Success Response

```json
{
  "projectNumber": 70,
  "id": "PVT_kwDOABCDEF",
  "title": "Claude Projects State Tracking API",
  "description": "Build state tracking API for GitHub Projects integration",
  "url": "https://github.com/orgs/stokedconsulting/projects/70",
  "status": "open",
  "public": true,
  "owner": "stokedconsulting",
  "fields": [
    {
      "id": "FIELD_123",
      "name": "Status",
      "dataType": "single_select",
      "options": ["Backlog", "Todo", "In Progress", "Done"]
    },
    {
      "id": "FIELD_456",
      "name": "Phase",
      "dataType": "text"
    }
  ],
  "phases": [
    {
      "id": "phase_1",
      "name": "Phase 1: Planning",
      "description": "Initial planning and architecture",
      "order": 1,
      "status": "completed"
    },
    {
      "id": "phase_2",
      "name": "Phase 2: Development",
      "description": "Core API development",
      "order": 2,
      "status": "in_progress"
    }
  ],
  "stats": {
    "totalItems": 45,
    "openItems": 23,
    "closedItems": 22,
    "totalPhases": 5
  },
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-20T14:30:00Z"
}
```

#### Error Responses

**Project Not Found**:
```json
{
  "error": "Project #70 not found"
}
```

**Authentication Error**:
```json
{
  "error": "Authentication failed. Check STATE_TRACKING_API_KEY"
}
```

#### Errors

| Error | HTTP Code | Cause | Solution |
|-------|-----------|-------|----------|
| `Project #XX not found` | 404 | Project doesn't exist or no access | Verify project number and API key permissions |
| `Authentication failed` | 401 | Invalid API key | Check `STATE_TRACKING_API_KEY` configuration |
| `Failed to connect to api` | - | Network error | Check API URL and network connectivity |

---

### get_project_phases

Get all phases in a project with their order and status.

**Use Cases**:
- List available phases before assigning issues
- Check phase completion status
- Plan phase-by-phase execution
- Understand project workflow

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "projectNumber": {
      "type": "number",
      "description": "GitHub Project number"
    }
  },
  "required": ["projectNumber"],
  "additionalProperties": false
}
```

#### Request Example

```json
{
  "projectNumber": 70
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "projectNumber": { "type": "number" },
    "phases": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "description": { "type": "string" },
          "order": { "type": "number" },
          "status": { "type": "string", "enum": ["pending", "in_progress", "completed"] }
        }
      }
    },
    "totalPhases": { "type": "number" }
  },
  "required": ["projectNumber", "phases", "totalPhases"]
}
```

#### Success Response

```json
{
  "projectNumber": 70,
  "phases": [
    {
      "id": "phase_1",
      "name": "Phase 1: Planning",
      "description": "Initial planning and architecture",
      "order": 1,
      "status": "completed"
    },
    {
      "id": "phase_2",
      "name": "Phase 2: Development",
      "description": "Core API development",
      "order": 2,
      "status": "in_progress"
    },
    {
      "id": "phase_3",
      "name": "Phase 3: Testing",
      "description": "Integration and E2E testing",
      "order": 3,
      "status": "pending"
    }
  ],
  "totalPhases": 5
}
```

---

### list_issues

List all issues in a project with optional filtering by status, phase, or assignee.

**Use Cases**:
- Get all issues in a project
- Filter issues by status (e.g., only `in_progress`)
- Find issues in a specific phase
- List issues assigned to a user
- Query open work items

#### Input Schema

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
  "required": ["projectNumber"],
  "additionalProperties": false
}
```

#### Request Examples

**All Issues**:
```json
{
  "projectNumber": 70
}
```

**Filter by Status**:
```json
{
  "projectNumber": 70,
  "status": "in_progress"
}
```

**Filter by Phase**:
```json
{
  "projectNumber": 70,
  "phase": "Phase 2: Development"
}
```

**Multiple Filters**:
```json
{
  "projectNumber": 70,
  "status": "todo",
  "phase": "Phase 2: Development",
  "assignee": "developer123"
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "projectNumber": { "type": "number" },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "number": { "type": "number", "description": "GitHub issue number" },
          "id": { "type": "string" },
          "title": { "type": "string" },
          "description": { "type": "string" },
          "status": { "type": "string", "enum": ["backlog", "todo", "in_progress", "done"] },
          "phase": { "type": "string" },
          "assignee": { "type": "string" },
          "labels": { "type": "array", "items": { "type": "string" } },
          "url": { "type": "string" },
          "createdAt": { "type": "string", "format": "date-time" },
          "updatedAt": { "type": "string", "format": "date-time" }
        }
      }
    },
    "total": { "type": "number" },
    "filters": {
      "type": "object",
      "properties": {
        "status": { "type": "string" },
        "phase": { "type": "string" },
        "assignee": { "type": "string" }
      }
    }
  },
  "required": ["projectNumber", "issues", "total"]
}
```

#### Success Response

```json
{
  "projectNumber": 70,
  "issues": [
    {
      "number": 42,
      "id": "I_kwDOABCDEF",
      "title": "Implement user authentication",
      "description": "Add OAuth2 authentication flow with GitHub",
      "status": "in_progress",
      "phase": "Phase 2: Development",
      "assignee": "developer123",
      "labels": ["feature", "backend", "priority-high"],
      "url": "https://github.com/owner/repo/issues/42",
      "createdAt": "2024-01-15T10:00:00Z",
      "updatedAt": "2024-01-20T14:30:00Z"
    },
    {
      "number": 43,
      "id": "I_kwDOABCDEF2",
      "title": "Add API rate limiting",
      "description": "Implement rate limiting middleware",
      "status": "in_progress",
      "phase": "Phase 2: Development",
      "assignee": "developer456",
      "labels": ["feature", "backend"],
      "url": "https://github.com/owner/repo/issues/43",
      "createdAt": "2024-01-16T09:00:00Z",
      "updatedAt": "2024-01-20T15:00:00Z"
    }
  ],
  "total": 2,
  "filters": {
    "status": "in_progress",
    "phase": "Phase 2: Development"
  }
}
```

---

### get_issue_details

Get detailed information about a specific issue.

**Use Cases**:
- Fetch full issue details before working on it
- Check current status and assignments
- Review issue description and requirements
- Verify issue metadata

#### Input Schema

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
  "required": ["projectNumber", "issueNumber"],
  "additionalProperties": false
}
```

#### Request Example

```json
{
  "projectNumber": 70,
  "issueNumber": 42
}
```

#### Response Schema

Same as individual issue object in `list_issues` response.

#### Success Response

```json
{
  "number": 42,
  "id": "I_kwDOABCDEF",
  "title": "Implement user authentication",
  "description": "Add OAuth2 authentication flow with GitHub",
  "status": "in_progress",
  "phase": "Phase 2: Development",
  "assignee": "developer123",
  "labels": ["feature", "backend", "priority-high"],
  "url": "https://github.com/owner/repo/issues/42",
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-20T14:30:00Z"
}
```

#### Error Responses

**Issue Not Found**:
```json
{
  "error": "Issue #42 not found in Project #70"
}
```

---

### create_issue

Create a new GitHub issue and add it to the project board.

**Use Cases**:
- Create new work items programmatically
- Add issues with initial status and phase
- Assign issues to team members
- Tag issues with labels

#### Input Schema

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
      "description": "Issue title (required)",
      "minLength": 1
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
  "required": ["projectNumber", "title"],
  "additionalProperties": false
}
```

#### Request Examples

**Minimal**:
```json
{
  "projectNumber": 70,
  "title": "Add user profile page"
}
```

**Complete**:
```json
{
  "projectNumber": 70,
  "title": "Add user profile page",
  "body": "Create a new profile page with:\n- User information display\n- Settings management\n- Avatar upload",
  "status": "todo",
  "phase": "Phase 2: Development",
  "assignee": "developer123",
  "labels": ["feature", "frontend", "priority-medium"]
}
```

#### Response Schema

```json
{
  "type": "object",
  "properties": {
    "number": { "type": "number", "description": "GitHub issue number" },
    "id": { "type": "string" },
    "title": { "type": "string" },
    "description": { "type": "string" },
    "status": { "type": "string" },
    "phase": { "type": "string" },
    "assignee": { "type": "string" },
    "labels": { "type": "array", "items": { "type": "string" } },
    "url": { "type": "string" },
    "createdAt": { "type": "string", "format": "date-time" },
    "updatedAt": { "type": "string", "format": "date-time" }
  },
  "required": ["number", "id", "title", "status", "url", "createdAt", "updatedAt"]
}
```

#### Success Response

```json
{
  "number": 44,
  "id": "I_kwDOABCDEF3",
  "title": "Add user profile page",
  "description": "Create a new profile page with:\n- User information display\n- Settings management\n- Avatar upload",
  "status": "todo",
  "phase": "Phase 2: Development",
  "assignee": "developer123",
  "labels": ["feature", "frontend", "priority-medium"],
  "url": "https://github.com/owner/repo/issues/44",
  "createdAt": "2024-01-20T16:00:00Z",
  "updatedAt": "2024-01-20T16:00:00Z"
}
```

#### Error Responses

**Empty Title**:
```json
{
  "error": "Title is required and cannot be empty",
  "projectNumber": 70
}
```

**Phase Not Found**:
```json
{
  "error": "Phase \"Invalid Phase\" not found in Project #70",
  "projectNumber": 70,
  "phase": "Invalid Phase"
}
```

#### Events Emitted

- `issue.created`: Broadcast to WebSocket clients when issue is successfully created

---

### update_issue_status

Update the status of an issue on the project board.

**Use Cases**:
- Mark issue as in progress when starting work
- Complete issue by setting status to done
- Move issue back to todo if blocked
- Update workflow stage

#### Input Schema

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
  "required": ["projectNumber", "issueNumber", "status"],
  "additionalProperties": false
}
```

#### Request Example

```json
{
  "projectNumber": 70,
  "issueNumber": 42,
  "status": "done"
}
```

#### Response Schema

Same as `get_issue_details` response with updated status.

#### Success Response

```json
{
  "number": 42,
  "id": "I_kwDOABCDEF",
  "title": "Implement user authentication",
  "description": "Add OAuth2 authentication flow with GitHub",
  "status": "done",
  "phase": "Phase 2: Development",
  "assignee": "developer123",
  "labels": ["feature", "backend", "priority-high"],
  "url": "https://github.com/owner/repo/issues/42",
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-20T16:30:00Z"
}
```

#### Events Emitted

- `issue.updated`: Broadcast to WebSocket clients with status change details

---

### update_issue_phase

Move an issue to a different project phase.

**Use Cases**:
- Progress issue through project phases
- Reorganize work by phase
- Align issue with current project stage

#### Input Schema

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
    "phase": {
      "type": "string",
      "description": "Target phase name"
    }
  },
  "required": ["projectNumber", "issueNumber", "phase"],
  "additionalProperties": false
}
```

#### Request Example

```json
{
  "projectNumber": 70,
  "issueNumber": 42,
  "phase": "Phase 3: Testing"
}
```

#### Response Schema

Same as `get_issue_details` response with updated phase.

#### Events Emitted

- `issue.updated`: Broadcast to WebSocket clients with phase change details
- `phase.updated`: If phase statistics changed

---

### update_issue

Update multiple fields of an issue simultaneously.

**Use Cases**:
- Batch update multiple issue fields
- Reassign and update status in one operation
- Change title, description, and labels together

#### Input Schema

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
      "description": "New description (optional)"
    },
    "status": {
      "type": "string",
      "enum": ["backlog", "todo", "in_progress", "done"],
      "description": "New status (optional)"
    },
    "phase": {
      "type": "string",
      "description": "New phase (optional)"
    },
    "assignee": {
      "type": "string",
      "description": "New assignee or null to unassign (optional)"
    },
    "labels": {
      "type": "array",
      "items": { "type": "string" },
      "description": "New labels array (optional)"
    }
  },
  "required": ["projectNumber", "issueNumber"],
  "additionalProperties": false
}
```

**Note**: At least one optional field must be provided.

#### Request Example

```json
{
  "projectNumber": 70,
  "issueNumber": 42,
  "status": "in_progress",
  "assignee": "newdeveloper",
  "labels": ["feature", "backend", "priority-high", "in-review"]
}
```

#### Response Schema

Same as `get_issue_details` response with all updated fields.

#### Events Emitted

- `issue.updated`: Broadcast to WebSocket clients with all changed fields

---

## Error Codes

### HTTP-Based Errors

| Status Code | Error Type | Description | Example |
|-------------|------------|-------------|---------|
| 400 | Validation Error | Invalid parameters or missing required fields | `Parameter validation failed` |
| 401 | Authentication Error | Invalid or missing API key | `Authentication failed: Invalid API key` |
| 403 | Authorization Error | Valid credentials but insufficient permissions | `Access denied to Project #70` |
| 404 | Not Found Error | Resource doesn't exist | `Project #70 not found` |
| 409 | Conflict Error | Concurrent update conflict | `Concurrent update detected` |
| 429 | Rate Limit Error | Too many requests | `Rate limit exceeded` |
| 500 | Server Error | Internal server error | `Internal server error` |
| 503 | Service Unavailable | API temporarily unavailable | `Service temporarily unavailable` |

### MCP Tool Errors

Tool execution errors are returned with `isError: true` in the MCP result:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"error\":\"Project #70 not found\"}"
    }
  ],
  "isError": true
}
```

### Common Error Messages

| Error Message | Meaning | Solution |
|---------------|---------|----------|
| `Unknown tool: {toolName}` | Tool doesn't exist | Check tool name spelling |
| `Parameter validation failed` | Invalid input parameters | Review parameter requirements |
| `Project #XX not found` | Project doesn't exist or no access | Verify project number and permissions |
| `Issue #XX not found in Project #YY` | Issue doesn't exist in project | Check issue number |
| `Phase "{name}" not found in Project #XX` | Phase doesn't exist | Use `get_project_phases` to see valid phases |
| `Title is required and cannot be empty` | Missing required field | Provide non-empty title |
| `Failed to connect to api` | Network connectivity issue | Check API URL and network |
| `Authentication failed: Invalid API key` | Invalid credentials | Verify `STATE_TRACKING_API_KEY` |
| `Concurrent update detected` | Two updates happened simultaneously | Retry the operation |

---

## Data Types

### Issue

```typescript
interface Issue {
  number: number;           // GitHub issue number
  id: string;              // GitHub issue ID
  title: string;           // Issue title
  description?: string;    // Issue body (markdown)
  status: IssueStatus;     // Current status
  phase?: string;          // Assigned phase name
  assignee?: string;       // GitHub username
  labels: string[];        // Label names
  url: string;            // GitHub issue URL
  createdAt: string;      // ISO 8601 timestamp
  updatedAt: string;      // ISO 8601 timestamp
}
```

### IssueStatus

```typescript
type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'done';
```

### ProjectPhase

```typescript
interface ProjectPhase {
  id: string;                // Phase ID
  name: string;              // Phase name
  description?: string;      // Phase description
  order: number;             // Display order (1-based)
  status: PhaseStatus;       // Phase status
}

type PhaseStatus = 'pending' | 'in_progress' | 'completed';
```

### ProjectDetails

```typescript
interface ProjectDetails {
  projectNumber: number;     // Project number
  id: string;                // GitHub Project ID
  title: string;             // Project title
  description?: string;      // Project description
  url: string;              // Project URL
  status: 'open' | 'closed';
  public: boolean;           // Is project public
  owner: string;            // Owner login
  fields: ProjectField[];    // Field definitions
  phases: ProjectPhase[];    // Project phases
  stats: ProjectStats;       // Summary statistics
  createdAt: string;        // ISO 8601 timestamp
  updatedAt: string;        // ISO 8601 timestamp
}
```

### ProjectField

```typescript
interface ProjectField {
  id: string;               // Field ID
  name: string;             // Field name
  dataType: string;         // Field data type
  options?: string[];       // Options for select fields
}
```

### ProjectStats

```typescript
interface ProjectStats {
  totalItems: number;       // Total issue count
  openItems: number;        // Open issue count
  closedItems: number;      // Closed issue count
  totalPhases: number;      // Phase count
}
```

---

## Event Types

Events emitted by the MCP server for real-time WebSocket notifications.

### Event Structure

```typescript
interface StateChangeEvent {
  type: EventType;          // Event type
  timestamp: string;        // ISO 8601 timestamp
  projectNumber: number;    // Project number
  issueNumber?: number;     // Issue number (for issue events)
  data: unknown;           // Event-specific payload
}
```

### Event Types

#### project.updated

Emitted when project metadata changes.

**Example**:
```json
{
  "type": "project.updated",
  "timestamp": "2024-01-20T16:00:00Z",
  "projectNumber": 70,
  "data": {
    "title": "New Project Title",
    "description": "Updated description"
  }
}
```

#### issue.created

Emitted when a new issue is created via `create_issue`.

**Example**:
```json
{
  "type": "issue.created",
  "timestamp": "2024-01-20T16:00:00Z",
  "projectNumber": 70,
  "issueNumber": 44,
  "data": {
    "title": "Add user profile page",
    "status": "todo",
    "phase": "Phase 2: Development"
  }
}
```

#### issue.updated

Emitted when issue fields change.

**Example**:
```json
{
  "type": "issue.updated",
  "timestamp": "2024-01-20T16:30:00Z",
  "projectNumber": 70,
  "issueNumber": 42,
  "data": {
    "status": "done",
    "previousStatus": "in_progress",
    "updatedFields": ["status"]
  }
}
```

#### issue.deleted

Emitted when an issue is removed from the project.

**Example**:
```json
{
  "type": "issue.deleted",
  "timestamp": "2024-01-20T17:00:00Z",
  "projectNumber": 70,
  "issueNumber": 45,
  "data": {
    "title": "Deleted Issue Title"
  }
}
```

#### phase.updated

Emitted when phase metadata or statistics change.

**Example**:
```json
{
  "type": "phase.updated",
  "timestamp": "2024-01-20T16:30:00Z",
  "projectNumber": 70,
  "data": {
    "phaseId": "phase_2",
    "phaseName": "Phase 2: Development",
    "status": "completed",
    "previousStatus": "in_progress"
  }
}
```

---

## Usage Examples

### Example 1: Check API Health

```typescript
// Request
{
  "tool": "health_check",
  "params": {}
}

// Response (success)
{
  "apiAvailable": true,
  "authenticated": true,
  "responseTimeMs": 145,
  "apiVersion": "1.0.0"
}
```

### Example 2: Read Project and List Issues

```typescript
// Step 1: Read project overview
{
  "tool": "read_project",
  "params": {
    "projectNumber": 70
  }
}

// Step 2: List in-progress issues in Phase 2
{
  "tool": "list_issues",
  "params": {
    "projectNumber": 70,
    "status": "in_progress",
    "phase": "Phase 2: Development"
  }
}
```

### Example 3: Create and Complete Issue

```typescript
// Step 1: Create issue
{
  "tool": "create_issue",
  "params": {
    "projectNumber": 70,
    "title": "Implement caching layer",
    "body": "Add Redis caching for API responses",
    "status": "todo",
    "phase": "Phase 2: Development",
    "labels": ["feature", "backend"]
  }
}
// Returns: { number: 46, ... }

// Step 2: Update status to in_progress
{
  "tool": "update_issue_status",
  "params": {
    "projectNumber": 70,
    "issueNumber": 46,
    "status": "in_progress"
  }
}

// Step 3: Complete issue
{
  "tool": "update_issue_status",
  "params": {
    "projectNumber": 70,
    "issueNumber": 46,
    "status": "done"
  }
}
```

---

## See Also

- [MCP Server README](../packages/mcp-server/README.md) - Installation and usage
- [Integration Guide](./mcp-integration.md) - Complete setup walkthrough
- [Developer Guide](./mcp-development.md) - Adding custom tools

---

Built with the [Model Context Protocol](https://modelcontextprotocol.io/) for seamless AI integration.
