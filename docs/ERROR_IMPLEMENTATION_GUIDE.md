# Error Message Consistency Implementation Guide

## Overview

This guide documents the implementation of consistent error handling across all three components of Project #77. All errors now use standardized error codes, user-friendly messages, and actionable remediation steps.

---

## Implementation Status

### 1. VSCode Extension (`apps/code-ext/`)

**Status**: Implementation template provided

**New File**: `apps/code-ext/src/error-handler.ts`
- `ExtensionError` class with error codes
- `ExtensionErrorHandler` service for logging and UI display
- `executeWithErrorHandling()` helper for async operations
- `ErrorCode` enum with 45+ standardized codes

**Error Codes Implemented**:
- `AUTH_*` - Authentication errors (4 codes)
- `NET_*` - Network errors (3 codes)
- `GH_*` - GitHub API errors (5 codes)
- `VAL_*` - Validation errors (3 codes)
- `STATE_*` - State management errors (3 codes)
- `VSC_*` - VSCode specific errors (7 codes)

**Usage Pattern**:
```typescript
import { ExtensionError, ErrorCode, ExtensionErrorHandler } from './error-handler';

// In command or event handler
try {
  // operation
} catch (error) {
  const handler = new ExtensionErrorHandler(outputChannel);
  await handler.handleError(error);
}

// Or throw with structured error
throw new ExtensionError(
  ErrorCode.VSC_ERROR_NO_WORKSPACE,
  'No workspace folder is open',
  'Open a folder containing a Git repository'
);
```

**Files to Update**:
- `apps/code-ext/src/projects-view-provider.ts` - Replace all `showErrorMessage()` calls
- `apps/code-ext/src/github-api.ts` - Add error codes to API errors
- `apps/code-ext/src/claude-api.ts` - Add error codes to Claude errors
- `apps/code-ext/src/extension.ts` - Add error codes to initialization errors
- Other files - Replace generic `throw new Error()` with `ExtensionError`

### 2. MCP Server (`packages/mcp-server/`)

**Status**: Error classes provided

**New File**: `packages/mcp-server/src/errors.ts`
- 11 specialized error classes (extending `MCPError`)
- `ErrorCode` enum with 30+ codes
- `statusCodeToError()` helper for HTTP to MCP error mapping
- `ErrorResponse` interface matching API format

**Error Classes**:
- `AuthenticationError` - 401/403
- `AuthorizationError` - Missing scopes
- `TimeoutError` - Request timeouts
- `NotFoundError` - 404 responses
- `RateLimitError` - 429 with retry-after
- `ServerError` - 5xx responses
- `ValidationError` - Input validation
- `ConflictError` - 409 conflicts
- `ConfigurationError` - Missing config

**Usage Pattern**:
```typescript
import {
  AuthenticationError,
  NotFoundError,
  TimeoutError,
  toErrorResponse
} from '../errors';

// In tool implementation
async function getTool() {
  if (!apiKey) {
    throw new AuthenticationError(
      'GitHub token not configured',
      'Set GITHUB_TOKEN environment variable'
    );
  }

  if (!resource) {
    throw new NotFoundError('Project', projectId);
  }
}

// In MCP message handler
try {
  result = await getTool();
} catch (error) {
  const errorResponse = toErrorResponse(error);
  return { error: errorResponse };
}
```

**Files to Update**:
- `packages/mcp-server/src/api-client.ts` - Update error types to use new error classes
- `packages/mcp-server/src/tools/*.ts` - Use error classes for consistent throwing
- `packages/mcp-server/src/server.ts` - Add error to response mapping
- `packages/mcp-server/src/config.ts` - Use `ConfigurationError` for validation

### 3. State Tracking API (`packages/state-tracking-api/`)

**Status**: Error code reference provided

**New File**: `packages/state-tracking-api/src/common/errors/error-codes.ts`
- `ERROR_CODE_REFERENCE` mapping with remediation
- `REMEDIATION_MESSAGES` helpers
- `getErrorCodeDetails()` and `formatRemediation()` functions

**Integrated with Existing**:
- `AllExceptionsFilter` already uses `ErrorCode` enum
- `ErrorResponse` interface already in place
- Already provides structured error responses

**Files to Update**:
- `packages/state-tracking-api/src/common/filters/all-exceptions.filter.ts` - Add remediation to error responses
- All controller files - Throw appropriate NestJS exceptions with error codes
- Add error code mapping in filter

**Example Enhanced Filter**:
```typescript
// In AllExceptionsFilter.catch()
const errorCodeDetails = getErrorCodeDetails(errorCode);
const remediation = formatRemediation(
  errorCodeDetails.remediation,
  { variable: configVar, operation: operation }
);

errorResponse.remediation = remediation;
```

---

## Error Code Categories & Examples

### Authentication (4xx)

| Code | HTTP | Message | Example |
|------|------|---------|---------|
| `AUTH_CRITICAL_MISSING_KEY` | 401 | API key missing | "Set STATE_TRACKING_API_KEY variable" |
| `AUTH_ERROR_INVALID_CREDENTIALS` | 401 | Token invalid/expired | "Run `gh auth login` to re-authenticate" |
| `AUTH_ERROR_INSUFFICIENT_SCOPES` | 403 | Missing permissions | "Token needs: repo, read:org, project scopes" |

### Network (5xx)

| Code | HTTP | Message | Example |
|------|------|---------|---------|
| `NET_ERROR_TIMEOUT` | 504 | Request timeout | "Check network, try again in 30 seconds" |
| `NET_ERROR_CONNECTION_FAILED` | - | Cannot connect | "Verify hostname and network connectivity" |
| `NET_ERROR_DNS_RESOLUTION` | - | DNS failure | "Check DNS settings or hostname" |

### GitHub API (4xx/5xx)

| Code | HTTP | Message | Example |
|------|------|---------|---------|
| `GH_ERROR_RATE_LIMIT` | 429 | API limit exceeded | "Wait 60 seconds or upgrade GitHub account" |
| `GH_ERROR_NOT_FOUND` | 404 | Resource missing | "Verify repository exists and you have access" |
| `GH_ERROR_GRAPHQL_ERROR` | 400 | Query invalid | "Check query syntax against GitHub schema" |

### Validation (400)

| Code | HTTP | Message | Example |
|------|------|---------|---------|
| `VAL_ERROR_MISSING_FIELD` | 400 | Required field absent | "Provide {field} to proceed" |
| `VAL_ERROR_INVALID_FORMAT` | 400 | Wrong format | "Use format: {format}, got: {actual}" |
| `VAL_ERROR_INVALID_ENUM` | 400 | Invalid choice | "Must be one of: {values}" |

---

## Implementation Steps

### Step 1: Review Current Errors (Already Done)

- [x] Audited extension error messages (102 occurrences)
- [x] Audited MCP server error handling (50+ occurrences)
- [x] Audited API error responses (existing `ErrorCode` enum)

### Step 2: Update VSCode Extension

1. Import error handler:
   ```typescript
   import { ExtensionError, ErrorCode, ExtensionErrorHandler } from './error-handler';
   ```

2. Replace error displays in `projects-view-provider.ts`:
   ```typescript
   // Before:
   vscode.window.showErrorMessage('Failed to update status');

   // After:
   throw new ExtensionError(
     ErrorCode.VSC_ERROR_STATUS_FIELD_NOT_FOUND,
     'Status field not found in project',
     'Ensure the project has a Status field configured'
   );
   ```

3. Add error handler to command implementations:
   ```typescript
   const handler = new ExtensionErrorHandler(this._outputChannel);
   try {
     // operation
   } catch (error) {
     await handler.handleError(error);
   }
   ```

### Step 3: Update MCP Server

1. Update `api-client.ts` to use new error classes:
   ```typescript
   // Before:
   throw new Error('STATE_TRACKING_API_KEY environment variable required');

   // After:
   throw new ConfigurationError(
     'STATE_TRACKING_API_KEY',
     'Required to authenticate with State Tracking API'
   );
   ```

2. Update tool implementations:
   ```typescript
   // In each tool
   if (!resource) {
     throw new NotFoundError('Project', projectId);
   }
   ```

3. Update server error handling:
   ```typescript
   try {
     result = await tool();
   } catch (error) {
     return { error: toErrorResponse(error) };
   }
   ```

### Step 4: Update State Tracking API

1. Enhance `AllExceptionsFilter`:
   ```typescript
   import { getErrorCodeDetails, formatRemediation } from '../errors/error-codes';

   // In catch()
   errorResponse.remediation = formatRemediation(
     getErrorCodeDetails(errorCodeString).remediation,
     context
   );
   ```

2. Update controllers to throw with error context:
   ```typescript
   if (!project) {
     throw new NotFoundException('Project not found', ErrorCode.GH_ERROR_NOT_FOUND);
   }
   ```

### Step 5: Testing

1. **Unit Tests**: Test error creation and serialization
   ```typescript
   it('should create ExtensionError with code', () => {
     const error = new ExtensionError(
       ErrorCode.VSC_ERROR_NO_WORKSPACE,
       'test message'
     );
     expect(error.errorCode).toBe(ErrorCode.VSC_ERROR_NO_WORKSPACE);
   });
   ```

2. **Integration Tests**: Test error flows end-to-end
   ```typescript
   it('should handle authentication error', async () => {
     // Simulate auth failure
     // Verify error response contains code, message, remediation
   });
   ```

3. **Manual Testing**: Test in each component
   - VSCode: Trigger error, verify toast shows code + message + remediation
   - MCP: Call tool with missing arg, verify error response format
   - API: Make invalid request, verify error response format

---

## Error Message Examples

### Example 1: GitHub Authentication Failure

**Scenario**: User clicks project but GitHub token is invalid

**VSCode Display**:
```
[AUTH_ERROR_INVALID_CREDENTIALS] GitHub authentication failed

Fix: Run "gh auth login" to re-authenticate
```

**Output Channel Log**:
```
[2026-01-24T15:30:00Z] AUTH_ERROR_INVALID_CREDENTIALS: GitHub authentication failed
Remediation: Run "gh auth login" to re-authenticate
---
```

### Example 2: API Rate Limit

**Scenario**: Tool makes rapid requests, hits GitHub rate limit

**MCP Error Response**:
```json
{
  "errorCode": "GH_ERROR_RATE_LIMIT",
  "message": "GitHub API rate limit exceeded",
  "remediation": "Wait 60 seconds before retrying",
  "details": "Core rate limit: 60/60 resets in 60s",
  "severity": "warning"
}
```

### Example 3: Missing Project Field

**Scenario**: API request missing required field

**API Error Response**:
```json
{
  "statusCode": 400,
  "errorCode": "VAL_ERROR_MISSING_FIELD",
  "message": "Required field missing: status",
  "remediation": "Provide status field with one of: open, in_progress, done",
  "requestId": "req-123e4567-e89b-12d3-a456-426614174000",
  "timestamp": "2026-01-24T15:30:00Z"
}
```

---

## Deployment Checklist

- [ ] Error codes documented in `docs/error-handling.md`
- [ ] Error classes implemented in each component
- [ ] VSCode extension uses ExtensionError
- [ ] MCP server uses error classes
- [ ] API includes remediation in responses
- [ ] Unit tests for error handling
- [ ] Integration tests for error flows
- [ ] Manual testing in development environment
- [ ] Error logging verified in output channels
- [ ] Production readiness tested (no stack traces exposed)
- [ ] Documentation updated with error codes
- [ ] Team trained on error handling patterns

---

## Migration Path

### Phase 1: Infrastructure (1-2 days)
- Create error classes and utilities
- Add error codes enums
- Create documentation
- **Status**: ✅ Complete

### Phase 2: VSCode Extension (2-3 days)
- Update all error throwing and handling
- Test all error scenarios
- Verify UI displays are clean

### Phase 3: MCP Server (1-2 days)
- Update api-client.ts
- Update all tools
- Update server error handling

### Phase 4: State Tracking API (1 day)
- Enhance exception filter
- Add remediation to responses
- Test error scenarios

### Phase 5: Testing & Documentation (1 day)
- End-to-end testing
- Documentation updates
- Team training

**Total Time Estimate**: 6-9 days

---

## Troubleshooting

### Issue: Error Code Not Recognized

**Solution**: Check error code spelling against `ErrorCode` enum, use IDE autocomplete

### Issue: Remediation Not Showing

**Solution**: Ensure remediation parameter is passed, check for null/undefined

### Issue: Error Lost in Translation

**Solution**: Use `toErrorResponse()` helper to ensure consistent formatting

### Issue: Stack Trace Exposed in Production

**Solution**: Check environment, ensure `isDevelopment` flag is properly set

---

## FAQ

**Q: Do I need to update all existing errors?**
A: Yes, for consistency. Start with high-impact areas (auth, user-facing errors)

**Q: Can I create custom error codes?**
A: Yes, follow the pattern `{CATEGORY}_{SEVERITY}_{DESCRIPTION}`

**Q: How do I test error scenarios?**
A: Use error mocking/simulation in tests, throw errors intentionally

**Q: What about backwards compatibility?**
A: Error responses are enhanced, not changed, so API clients continue to work

---

## Related Documentation

- [Error Handling Reference](./error-handling.md) - Complete error code list
- [API Reference](./api-reference.md) - API error response formats
- [VSCode Extension README](../apps/code-ext/README.md) - Extension-specific errors
- [MCP Development](./mcp-development.md) - MCP server errors
