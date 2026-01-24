# Error Handling & Error Code Reference

## Overview

This document defines a consistent error handling strategy across the three main components:
- **VSCode Extension** (`apps/code-ext/`)
- **MCP Server** (`packages/mcp-server/`)
- **State Tracking API** (`packages/state-tracking-api/`)

All components follow the same error code standards and provide consistent, user-friendly error messages with remediation steps.

---

## Error Code Standard

### Error Code Format

Error codes follow the pattern: `{CATEGORY}_{SEVERITY}_{DESCRIPTION}`

Examples:
- `AUTH_CRITICAL_MISSING_KEY` - Authentication, critical severity, missing API key
- `GH_ERROR_RATE_LIMIT` - GitHub API, error severity, rate limited
- `NET_ERROR_TIMEOUT` - Network, error severity, timeout

### Error Code Categories

| Category | Component | Description |
|----------|-----------|-------------|
| `AUTH_*` | All | Authentication and authorization failures |
| `GH_*` | Extension, MCP | GitHub API errors |
| `NET_*` | MCP, API | Network and connectivity errors |
| `DB_*` | API | Database operation failures |
| `VAL_*` | All | Input validation errors |
| `STATE_*` | Extension | State management failures |
| `CONFIG_*` | MCP, API | Configuration errors |
| `SESSION_*` | API | Session management errors |

### Error Severity Levels

| Severity | HTTP Status | Meaning | User Action |
|----------|-------------|---------|-------------|
| `CRITICAL` | 500, 503 | System failure, operation cannot proceed | Report issue, retry later |
| `ERROR` | 400, 401, 403, 404, 429 | Operation failed, user action may help | Review setup, check limits, retry |
| `WARNING` | 299 | Operation succeeded with caveats | Review results, may need adjustment |

---

## Unified Error Response Format

### HTTP API Errors

All error responses follow this structure:

```typescript
interface ErrorResponse {
  statusCode: number;           // HTTP status code
  errorCode: string;            // Standardized error code (AUTH_CRITICAL_MISSING_KEY)
  message: string;              // User-friendly error message
  details?: string[] | object;  // Additional context
  remediation?: string;         // Steps to fix the issue
  requestId?: string;           // For tracing
  timestamp?: string;           // ISO 8601 timestamp
  path?: string;                // Request path (development only)
  stack?: string;               // Stack trace (development only)
}
```

### Error Response Example

```json
{
  "statusCode": 401,
  "errorCode": "AUTH_ERROR_INVALID_CREDENTIALS",
  "message": "GitHub authentication failed. Your token may be expired or revoked.",
  "remediation": "1. Run 'gh auth login' to re-authenticate\n2. Ensure your token has 'repo' and 'project' scopes\n3. Try the operation again",
  "requestId": "req-123e4567-e89b-12d3-a456-426614174000",
  "timestamp": "2026-01-24T15:30:00Z"
}
```

---

## Standardized Error Codes & Messages

### Authentication Errors (401, 403)

| Error Code | Message | Remediation |
|-----------|---------|-------------|
| `AUTH_CRITICAL_MISSING_KEY` | "API key is missing or not configured" | Export `STATE_TRACKING_API_KEY` environment variable |
| `AUTH_ERROR_INVALID_CREDENTIALS` | "Authentication failed. Token may be expired." | Run `gh auth login` to re-authenticate |
| `AUTH_ERROR_INSUFFICIENT_SCOPES` | "Token lacks required scopes" | Re-authenticate with appropriate scopes: `repo`, `read:org`, `read:project`, `project` |
| `AUTH_ERROR_GITHUB_OAUTH_RESTRICTION` | "Organization has OAuth App access restrictions" | Grant access to VS Code in Organization Settings: `https://github.com/organizations/{org}/settings/oauth_application_policy` |

### Network & Timeout Errors

| Error Code | Message | Remediation |
|-----------|---------|-------------|
| `NET_ERROR_TIMEOUT` | "Request timed out after {timeout}ms" | Check network connection, retry the operation |
| `NET_ERROR_CONNECTION_FAILED` | "Failed to connect to {url}" | Verify network connectivity and URL is correct |
| `NET_ERROR_DNS_RESOLUTION` | "Cannot resolve hostname: {hostname}" | Check network connection and DNS settings |

### Rate Limiting

| Error Code | Message | Remediation |
|-----------|---------|-------------|
| `GH_ERROR_RATE_LIMIT` | "GitHub API rate limit exceeded" | Wait {retryAfter} seconds before retrying. Current limit: {limit}/{resetTime} |
| `API_ERROR_RATE_LIMIT` | "Too many requests. Please slow down." | Wait {retryAfter} seconds before retrying |

### GitHub API Errors

| Error Code | Message | Remediation |
|-----------|---------|-------------|
| `GH_ERROR_NOT_FOUND` | "Repository not found: {owner}/{repo}" | Verify repository name and ensure you have access |
| `GH_ERROR_INVALID_QUERY` | "Invalid GraphQL query: {error}" | Check query syntax, refer to GitHub GraphQL documentation |
| `GH_ERROR_GRAPHQL_ERROR` | "GitHub GraphQL error: {error}" | Review GitHub API response, check field names and types |
| `GH_ERROR_MUTATION_FAILED` | "Failed to {operation}: {reason}" | Check permissions, field values, and project state |

### Validation Errors (400)

| Error Code | Message | Remediation |
|-----------|---------|-------------|
| `VAL_ERROR_MISSING_FIELD` | "Required field missing: {field}" | Provide {field} to proceed |
| `VAL_ERROR_INVALID_FORMAT` | "{field} has invalid format: expected {expected}, got {actual}" | Format {field} as {expected} |
| `VAL_ERROR_INVALID_ENUM` | "{field} value invalid. Allowed: {values}" | Use one of: {values} |

### Database Errors (500)

| Error Code | Message | Remediation |
|-----------|---------|-------------|
| `DB_ERROR_CONNECTION_FAILED` | "Database connection failed" | Check database connectivity, verify credentials, contact support |
| `DB_ERROR_CONFLICT` | "Conflict: {resource} already exists or is in use" | Use a different value or remove the existing resource first |
| `DB_ERROR_QUERY_FAILED` | "Database operation failed: {reason}" | Review operation, check constraints, contact support |

### State Management Errors

| Error Code | Message | Remediation |
|-----------|---------|-------------|
| `STATE_ERROR_NO_SESSION` | "No active session found" | Start a new session by clicking a project |
| `STATE_ERROR_SESSION_EXPIRED` | "Session has expired" | Reload the VS Code window or start a new session |
| `STATE_ERROR_INVALID_STATE` | "Invalid state transition: cannot go from {current} to {target}" | Check state machine rules or contact support |

### Configuration Errors

| Error Code | Message | Remediation |
|-----------|---------|-------------|
| `CONFIG_CRITICAL_MISSING_ENV` | "Required environment variable not set: {variable}" | Set {variable} and restart the application |
| `CONFIG_ERROR_INVALID_VALUE` | "Configuration value invalid: {variable} = {value}" | Verify {variable} and set to a valid value |

### VSCode Extension Specific Errors

| Error Code | Message | Remediation |
|-----------|---------|-------------|
| `VSC_ERROR_NO_WORKSPACE` | "No workspace folder is open" | Open a folder containing a Git repository |
| `VSC_ERROR_GIT_EXTENSION_NOT_FOUND` | "Git extension not found" | Ensure VS Code has Git support installed |
| `VSC_ERROR_NO_GIT_REPO` | "No git repository found in workspace" | Initialize a git repository with `git init` |
| `VSC_ERROR_NO_REMOTE` | "No remote found in current repository" | Add a remote with `git remote add origin <url>` |
| `VSC_ERROR_INVALID_GH_URL` | "Could not parse GitHub URL from remote: {remote}" | Verify remote is a valid GitHub URL |

---

## Implementation by Component

### 1. VSCode Extension (`apps/code-ext/`)

**File**: `apps/code-ext/src/error-handler.ts` (new)

Provides:
- Custom error class with error codes
- User-friendly error messages to VS Code UI
- Remediation steps shown in toast notifications
- Error logging to output channel

**Usage**:
```typescript
import { ExtensionError, ErrorCode } from './error-handler';

throw new ExtensionError(
  ErrorCode.VSC_ERROR_NO_WORKSPACE,
  'No workspace folder is open',
  'Open a folder containing a Git repository'
);
```

**Key Changes**:
- All `throw new Error()` replaced with `ExtensionError`
- All `vscode.window.showErrorMessage()` updated to include error codes and remediation
- Centralized error handling in projects-view-provider.ts

### 2. MCP Server (`packages/mcp-server/`)

**Files**:
- `packages/mcp-server/src/errors.ts` (new)
- Updated: `packages/mcp-server/src/api-client.ts`

Provides:
- Standardized error classes with error codes
- Consistent error messages across all tools
- Remediation guidance in error details

**Error Classes**:
- `APIClientError` - Base error class with error codes
- `AuthenticationError` - 401/403 responses
- `TimeoutError` - Request timeouts
- `NotFoundError` - 404 responses
- `RateLimitError` - 429 responses with retry-after
- `ServerError` - 5xx responses
- `ValidationError` - Input validation failures

**Usage**:
```typescript
import { AuthenticationError, ErrorCode } from './errors';

throw new AuthenticationError(
  ErrorCode.AUTH_ERROR_INVALID_CREDENTIALS,
  'GitHub authentication failed',
  'Run "gh auth login" to re-authenticate'
);
```

### 3. State Tracking API (`packages/state-tracking-api/`)

**File**: `packages/state-tracking-api/src/common/errors/error-codes.ts` (new)

Uses existing:
- `ErrorCode` enum in `all-exceptions.filter.ts`
- `ErrorResponse` interface

**Enhancements**:
- Add remediation field to all error responses
- Map HTTP exceptions to standardized error codes
- Include detailed error messages with context

**Current Error Codes** (to maintain):
```typescript
export enum ErrorCode {
  VALIDATION_ERROR = 'validation_error',
  NOT_FOUND = 'not_found',
  UNAUTHORIZED = 'unauthorized',
  FORBIDDEN = 'forbidden',
  CONFLICT = 'conflict',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  TIMEOUT = 'timeout',
  DATABASE_ERROR = 'database_error',
  INTERNAL_ERROR = 'internal_error',
}
```

---

## Error Handling Patterns

### Pattern 1: Try-Catch with Remediation

```typescript
try {
  // Operation
} catch (error) {
  if (error instanceof AuthenticationError) {
    throw new ExtensionError(
      ErrorCode.AUTH_ERROR_INVALID_CREDENTIALS,
      error.message,
      'Run "gh auth login" to re-authenticate'
    );
  }
  // ... handle other error types
}
```

### Pattern 2: Validation with User Guidance

```typescript
if (!apiKey) {
  throw new ExtensionError(
    ErrorCode.AUTH_CRITICAL_MISSING_KEY,
    'API key is missing or not configured',
    'Export STATE_TRACKING_API_KEY environment variable and restart VS Code'
  );
}
```

### Pattern 3: Network Error with Retry Guidance

```typescript
if (error instanceof TimeoutError) {
  throw new ExtensionError(
    ErrorCode.NET_ERROR_TIMEOUT,
    `Request timed out after ${timeout}ms`,
    'Check your network connection and try again'
  );
}
```

### Pattern 4: Rate Limiting with Backoff

```typescript
if (error instanceof RateLimitError) {
  const retryAfter = error.retryAfter || 60;
  throw new ExtensionError(
    ErrorCode.GH_ERROR_RATE_LIMIT,
    `GitHub API rate limit exceeded`,
    `Wait ${retryAfter} seconds before retrying`
  );
}
```

---

## Error Message Best Practices

### Guidelines

1. **Be Specific**: Include affected resource/field
   - Bad: "Operation failed"
   - Good: "Failed to update status field: field not found"

2. **Include Context**: Show relevant values
   - Bad: "Invalid value"
   - Good: "Invalid value for 'priority': expected one of [low, medium, high, critical], got 'urgent'"

3. **Make It Actionable**: Provide clear next steps
   - Bad: "Authentication error"
   - Good: "Authentication failed. Run `gh auth login` to re-authenticate"

4. **Be User-Friendly**: Avoid technical jargon where possible
   - Bad: "GraphQL mutation failed on updateProjectV2Item"
   - Good: "Failed to update the issue status. Check that you have permission to edit this project."

5. **Include Error Code**: Always show the error code for debugging
   - Include: "Error [AUTH_ERROR_INVALID_CREDENTIALS]: ..."

---

## Tracing & Debugging

### Request IDs

Every request/operation gets a unique request ID for tracing:
- Format: `{component}-{timestamp}-{random}`
- Examples:
  - VSCode: `ext-1704070200000-a3b2c1d4`
  - MCP: `mcp-1704070200000-e5f6g7h8`
  - API: `api-1704070200000-i9j0k1l2`

### Logging

All errors logged with:
- Timestamp
- Request/Session ID
- Error code
- Full stack trace (development only)
- Relevant context

### Development vs. Production

**Development**:
- Full stack traces included in error responses
- Verbose logging to console/output
- All details included in error messages

**Production**:
- Stack traces removed from responses
- Error codes and user-friendly messages only
- Detailed logs sent to monitoring/logging service

---

## Migration Checklist

- [ ] Create `packages/mcp-server/src/errors.ts` with error classes
- [ ] Create `packages/state-tracking-api/src/common/errors/error-codes.ts`
- [ ] Create `apps/code-ext/src/error-handler.ts` with extension error class
- [ ] Update all error handling in VSCode extension
- [ ] Update all error handling in MCP server tools
- [ ] Update all error handling in State Tracking API controllers
- [ ] Add error response middleware to all HTTP handlers
- [ ] Test error scenarios end-to-end
- [ ] Add error code documentation to each component's README
- [ ] Update deployment guides with error troubleshooting section

---

## Example Error Scenarios

### Scenario 1: GitHub Authentication Fails

**User Action**: Click project in VS Code
**Error Occurs**: `gh auth status` returns invalid token
**Response**:
```json
{
  "statusCode": 401,
  "errorCode": "AUTH_ERROR_INVALID_CREDENTIALS",
  "message": "GitHub authentication failed. Your token may be expired or revoked.",
  "remediation": "1. Run 'gh auth login' to re-authenticate\n2. Ensure your token has 'repo' and 'project' scopes\n3. Reload VS Code window",
  "timestamp": "2026-01-24T15:30:00Z"
}
```
**VS Code Shows**: Toast notification with error code and remediation steps

---

### Scenario 2: API Rate Limit Exceeded

**User Action**: Fetch large project in rapid succession
**Error Occurs**: GitHub GraphQL API returns 429
**Response**:
```json
{
  "statusCode": 429,
  "errorCode": "GH_ERROR_RATE_LIMIT",
  "message": "GitHub API rate limit exceeded",
  "details": "Rate limit reset at 2026-01-24T16:00:00Z",
  "remediation": "Wait 30 minutes or upgrade GitHub account for higher limits",
  "timestamp": "2026-01-24T15:30:00Z"
}
```
**VS Code Shows**: Toast with countdown timer

---

### Scenario 3: Database Conflict in API

**User Action**: Update project status concurrently
**Error Occurs**: MongoDB conflict on unique constraint
**Response**:
```json
{
  "statusCode": 409,
  "errorCode": "DB_ERROR_CONFLICT",
  "message": "Project name 'My Project' already exists",
  "details": "A project with this name exists in your workspace",
  "remediation": "Use a different project name or delete the existing project first",
  "timestamp": "2026-01-24T15:30:00Z"
}
```

---

## Related Documentation

- [API Reference](./api-reference.md)
- [MCP Development](./mcp-development.md)
- [VSCode Extension README](../apps/code-ext/README.md)
- [State Tracking API README](../packages/state-tracking-api/README.md)
