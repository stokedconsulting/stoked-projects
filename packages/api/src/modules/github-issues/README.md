# GitHub Issues Module

REST API endpoints for GitHub Issues operations with caching and partial failure handling.

## Features

- **List Issues**: GET endpoint with filters and 2-minute cache
- **Get Issue**: GET endpoint for specific issue (always fresh, no cache)
- **Create Issue**: POST endpoint with labels and assignees support
- **Update Issue**: PATCH endpoint for updating fields
- **Close Issue**: POST endpoint to close issues
- **Link to Project**: POST endpoint to add issue to GitHub Project with status/priority updates
- **Partial Failure Handling**: Returns warnings when project linking succeeds but field updates fail
- **Cache Strategy**: 2-minute TTL for list operations, no cache for individual issues

## API Endpoints

### List Issues
```http
GET /api/github/issues/:owner/:repo?state=open&labels=bug&perPage=30&page=1
```

**Query Parameters:**
- `state`: `open`, `closed`, or `all` (default: `open`)
- `labels`: Comma-separated label names
- `assignee`: Filter by assignee username
- `creator`: Filter by creator username
- `sort`: `created`, `updated`, or `comments` (default: `created`)
- `direction`: `asc` or `desc` (default: `desc`)
- `perPage`: 1-100 (default: 30)
- `page`: Page number (default: 1)

**Response:** Array of issues (cached for 2 minutes)

### Get Specific Issue
```http
GET /api/github/issues/:owner/:repo/:number
```

**Response:** Issue object (always fresh, no cache)

### Create Issue
```http
POST /api/github/issues
Content-Type: application/json

{
  "owner": "octocat",
  "repo": "hello-world",
  "title": "Bug Report",
  "body": "Description here",
  "labels": ["bug", "priority-high"],
  "assignees": ["octocat"]
}
```

**Response:**
```json
{
  "data": {
    "id": "I_kwDOABCDEF01234567",
    "number": 42,
    "title": "Bug Report",
    "state": "OPEN",
    ...
  }
}
```

### Update Issue
```http
PATCH /api/github/issues/:owner/:repo/:number
Content-Type: application/json

{
  "title": "Updated Title",
  "body": "Updated description",
  "state": "open",
  "labels": ["bug", "fixed"],
  "assignees": ["maintainer"]
}
```

**Response:** Updated issue object

### Close Issue
```http
POST /api/github/issues/:owner/:repo/:number/close
```

**Response:** Closed issue with `state: "CLOSED"` and `closedAt` timestamp

### Link Issue to Project
```http
POST /api/github/issues/:owner/:repo/:number/link
Content-Type: application/json

{
  "projectId": "PVT_kwDOABCDEF01234567",
  "status": "In Progress",
  "priority": "High"
}
```

**Response:**
```json
{
  "data": {
    "itemId": "PVTI_456",
    "issue": { ... }
  },
  "warnings": [
    "Issue added to project but status update failed: Status field not found"
  ]
}
```

**Partial Failure Handling:**
- Issue always added to project first
- If status/priority update fails, issue remains in project but warnings are returned
- Warnings array only included if there are failures

## Cache Behavior

### List Operations (2-minute cache)
- Cache key includes filters (state, labels, assignee, creator, sort)
- Different filter combinations cached separately
- Cache automatically invalidated when issues created/updated/closed

### Individual Issues (no cache)
- Always fetches fresh data from GitHub
- Ensures real-time accuracy for issue details

## Acceptance Criteria

All 6 acceptance criteria from issue #65 are met:

- ✅ **AC-2.2.a**: POST create returns issue with number
- ✅ **AC-2.2.b**: POST close updates state to closed
- ✅ **AC-2.2.c**: POST link adds issue to project and updates status
- ✅ **AC-2.2.d**: GET specific issue returns fresh data (no cache)
- ✅ **AC-2.2.e**: Project link failure still creates issue with warning
- ✅ **AC-2.2.f**: GET list cached for 2 minutes

## Testing

### Run Unit Tests
```bash
cd api
npm test -- github-issues.service.spec.ts
```

**Coverage:** 14 tests covering all acceptance criteria

### Run Integration Tests
```bash
npm test -- github-issues.integration.spec.ts
```

**Coverage:** End-to-end tests with mocked GitHub API

## Dependencies

- `GitHubClientService` (Phase 1.1) - GraphQL/REST API client
- `GitHubLoggingModule` (Phase 1.3) - Structured logging
- `GitHubErrorHandlerModule` (Phase 1.4) - Error handling
- NestJS validation pipes - DTO validation
- `class-validator` - Field validation
- `class-transformer` - Query parameter transformation

## Architecture

```
GitHubIssuesModule
├── Controller (REST endpoints)
│   ├── GET /api/github/issues/:owner/:repo
│   ├── GET /api/github/issues/:owner/:repo/:number
│   ├── POST /api/github/issues
│   ├── PATCH /api/github/issues/:owner/:repo/:number
│   ├── POST /api/github/issues/:owner/:repo/:number/close
│   └── POST /api/github/issues/:owner/:repo/:number/link
├── Service (business logic)
│   ├── listIssues() - with cache
│   ├── getIssue() - no cache
│   ├── createIssue()
│   ├── updateIssue()
│   ├── closeIssue()
│   └── linkIssueToProject() - partial failure handling
├── Cache Service
│   ├── 2-minute TTL for lists
│   ├── Filter-based cache keys
│   └── Auto-invalidation on mutations
└── DTOs
    ├── CreateIssueDto
    ├── UpdateIssueDto
    ├── LinkIssueDto
    └── ListIssuesDto
```

## Error Handling

- **Authentication errors**: Thrown by GitHubClientService, propagated to client
- **Not found errors**: Returns 404 for non-existent issues
- **Validation errors**: Returns 400 for invalid request data
- **Partial failures**: Returns 200 with warnings array for successful operations with field update failures
- **GitHub API errors**: Normalized and propagated with error details

## Examples

### Creating an Issue with Labels
```typescript
const response = await fetch('/api/github/issues', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    owner: 'my-org',
    repo: 'my-repo',
    title: 'Feature Request',
    body: 'Add dark mode support',
    labels: ['enhancement', 'ui'],
  }),
});

const { data } = await response.json();
console.log(`Created issue #${data.number}`);
```

### Linking Issue to Project with Status
```typescript
const response = await fetch('/api/github/issues/my-org/my-repo/42/link', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    projectId: 'PVT_abc123',
    status: 'In Progress',
    priority: 'High',
  }),
});

const { data, warnings } = await response.json();

if (warnings) {
  console.warn('Partial failure:', warnings);
} else {
  console.log(`Issue linked to project with item ID: ${data.itemId}`);
}
```

### Listing Issues with Filters
```typescript
const response = await fetch(
  '/api/github/issues/my-org/my-repo?state=open&labels=bug&assignee=maintainer'
);

const issues = await response.json();
console.log(`Found ${issues.length} open bugs assigned to maintainer`);
```

## Implementation Notes

- Uses GraphQL for all GitHub operations (more efficient than REST for nested data)
- Project field updates use `updateProjectV2ItemFieldValue` mutation
- Cache keys include all filter parameters for proper cache isolation
- Warnings array only included in response when non-empty
- Repository cache invalidation happens on create/update/close operations
