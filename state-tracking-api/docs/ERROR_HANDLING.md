# Error Handling

This document describes the error handling and rate limiting implementation in the Claude Projects State Tracking API.

## Overview

The API uses structured error responses with standardized error codes, request ID tracking, and comprehensive error handling for all types of failures.

## Error Response Format

All error responses follow this standardized format:

```json
{
  "statusCode": 400,
  "error": "validation_error",
  "message": "Validation failed",
  "details": ["field x is required", "field y must be a number"],
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-01-19T12:00:00.000Z",
  "path": "/sessions"
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `statusCode` | number | HTTP status code (400, 404, 500, etc.) |
| `error` | string | Standardized error code (see Error Codes below) |
| `message` | string | Human-readable error message |
| `details` | array/object | Optional detailed error information (e.g., validation errors) |
| `request_id` | string | Unique request identifier for tracking/debugging |
| `timestamp` | string | ISO 8601 timestamp of when the error occurred |
| `path` | string | Request path that caused the error |
| `stack` | string | Stack trace (only in development mode) |

## Error Codes

The API uses standardized error codes to categorize errors:

| Error Code | HTTP Status | Description |
|------------|-------------|-------------|
| `validation_error` | 400 | Request validation failed (invalid input, missing required fields) |
| `not_found` | 404 | Requested resource not found |
| `unauthorized` | 401 | Authentication required or invalid credentials |
| `forbidden` | 403 | Authenticated but not authorized to access resource |
| `conflict` | 409 | Resource conflict (e.g., duplicate entry) |
| `rate_limit_exceeded` | 429 | Too many requests - rate limit exceeded |
| `timeout` | 504 | Request or database operation timed out |
| `database_error` | 500 | Database operation failed |
| `internal_error` | 500 | Unexpected internal server error |

## Error Types

### 1. Validation Errors

Validation errors occur when request data doesn't meet requirements.

**Example Request:**
```bash
POST /sessions
{
  "project_id": "",  # Empty string
  "docker_slot": "invalid"  # Should be number
}
```

**Example Response:**
```json
{
  "statusCode": 400,
  "error": "validation_error",
  "message": "Validation failed",
  "details": [
    "project_id should not be empty",
    "docker_slot must be a number"
  ],
  "request_id": "req-123",
  "timestamp": "2026-01-19T12:00:00.000Z",
  "path": "/sessions"
}
```

### 2. Not Found Errors

Returned when a requested resource doesn't exist.

**Example Response:**
```json
{
  "statusCode": 404,
  "error": "not_found",
  "message": "Session with ID abc-123 not found",
  "request_id": "req-124",
  "timestamp": "2026-01-19T12:00:00.000Z",
  "path": "/sessions/abc-123"
}
```

### 3. Authentication Errors

Returned when authentication is required or fails.

**Example Response:**
```json
{
  "statusCode": 401,
  "error": "unauthorized",
  "message": "Invalid API key",
  "request_id": "req-125",
  "timestamp": "2026-01-19T12:00:00.000Z",
  "path": "/sessions"
}
```

### 4. Rate Limit Errors

Returned when rate limits are exceeded.

**Example Response:**
```json
{
  "statusCode": 429,
  "error": "rate_limit_exceeded",
  "message": "Too many requests",
  "request_id": "req-126",
  "timestamp": "2026-01-19T12:00:00.000Z",
  "path": "/sessions"
}
```

**Rate Limit Headers:**
The API may include these headers in responses:
- `X-RateLimit-Limit`: Maximum requests allowed in time window
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Time when the rate limit resets
- `Retry-After`: Seconds to wait before retrying (included in 429 responses)

### 5. Database Errors

#### Validation Error
Database-level validation failure (e.g., Mongoose schema validation).

```json
{
  "statusCode": 400,
  "error": "validation_error",
  "message": "Database validation failed",
  "details": {
    "email": "Email is required",
    "age": "Age must be a positive number"
  },
  "request_id": "req-127",
  "timestamp": "2026-01-19T12:00:00.000Z"
}
```

#### Duplicate Key Error
Attempt to create a resource with a duplicate unique field.

```json
{
  "statusCode": 409,
  "error": "conflict",
  "message": "Duplicate entry",
  "details": {
    "duplicateKey": { "session_id": "existing-id" }
  },
  "request_id": "req-128",
  "timestamp": "2026-01-19T12:00:00.000Z"
}
```

#### Cast Error
Invalid data type for a field (e.g., invalid UUID format).

```json
{
  "statusCode": 400,
  "error": "validation_error",
  "message": "Invalid id: not-a-valid-uuid",
  "request_id": "req-129",
  "timestamp": "2026-01-19T12:00:00.000Z"
}
```

#### Generic Database Error
Database connection or operation failure.

```json
{
  "statusCode": 500,
  "error": "database_error",
  "message": "Database operation failed",
  "request_id": "req-130",
  "timestamp": "2026-01-19T12:00:00.000Z"
}
```

### 6. Timeout Errors

Request or database operation exceeded time limit.

**Timeouts:**
- Request timeout: 30 seconds
- Database query timeout: 10 seconds

```json
{
  "statusCode": 504,
  "error": "timeout",
  "message": "Request timeout",
  "details": ["The operation took too long to complete"],
  "request_id": "req-131",
  "timestamp": "2026-01-19T12:00:00.000Z"
}
```

### 7. Internal Server Errors

Unexpected errors that don't fit other categories.

```json
{
  "statusCode": 500,
  "error": "internal_error",
  "message": "An unexpected error occurred",
  "request_id": "req-132",
  "timestamp": "2026-01-19T12:00:00.000Z"
}
```

## Rate Limiting

The API implements rate limiting to prevent abuse and ensure fair resource usage.

### Rate Limit Configuration

| Endpoint Type | Limit | Time Window | Description |
|---------------|-------|-------------|-------------|
| Global (default) | 100 requests | 60 seconds | Applied to all API endpoints except health checks |
| Heartbeat endpoint | 120 requests | 60 seconds | Higher limit for `/sessions/:id/heartbeat` |
| Health endpoints | No limit | N/A | `/health` and `/health/ready` are not rate limited |

### Rate Limit Behavior

1. **Request Tracking**: Rate limits are tracked per IP address
2. **Sliding Window**: Uses a 60-second sliding window
3. **Response**: Returns `429 Too Many Requests` when limit is exceeded
4. **Headers**: May include rate limit headers in responses

### Best Practices

1. **Heartbeat Interval**: Recommended heartbeat interval is 60 seconds (well within the 120 req/min limit)
2. **Retry Logic**: Implement exponential backoff when receiving 429 responses
3. **Monitor Headers**: Check rate limit headers to avoid hitting limits
4. **Batch Operations**: Use bulk endpoints when available instead of multiple individual requests

### Example: Handling Rate Limits

```typescript
async function sendHeartbeat(sessionId: string) {
  try {
    const response = await fetch(`/sessions/${sessionId}/heartbeat`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (response.status === 429) {
      // Rate limited - wait and retry
      const retryAfter = response.headers.get('Retry-After');
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 5000;

      await new Promise(resolve => setTimeout(resolve, waitTime));
      return sendHeartbeat(sessionId); // Retry
    }

    return response.json();
  } catch (error) {
    console.error('Heartbeat failed:', error);
    throw error;
  }
}
```

## Request ID Tracking

Every request is assigned a unique request ID for tracking and debugging.

### Request ID Sources

1. **Client-provided**: Include `X-Request-ID` header in your request
2. **Auto-generated**: If not provided, the server generates a UUID

### Using Request IDs

**Include in Request:**
```bash
curl -H "X-Request-ID: my-custom-id-123" \
     -H "Authorization: Bearer YOUR_API_KEY" \
     https://api.example.com/sessions
```

**Returned in Response:**
```json
{
  "statusCode": 200,
  "data": { ... },
  "request_id": "my-custom-id-123"
}
```

**Returned in Errors:**
```json
{
  "statusCode": 404,
  "error": "not_found",
  "message": "Resource not found",
  "request_id": "my-custom-id-123",
  "timestamp": "2026-01-19T12:00:00.000Z"
}
```

### Benefits

- **Debugging**: Track requests across logs and systems
- **Support**: Provide request ID when reporting issues
- **Monitoring**: Trace request flow through the system
- **Correlation**: Link related requests together

## Error Tracking Integration

The error handling system is designed for integration with error tracking services (Sentry, etc.).

### Integration Points

1. **Exception Filter**: All errors pass through `AllExceptionsFilter`
2. **Structured Data**: Errors include rich context (request ID, user agent, IP, etc.)
3. **Environment-aware**: Stack traces only in development

### Future Integration Example

```typescript
// In AllExceptionsFilter
private logError(exception: unknown, errorResponse: ErrorResponse, request: ExpressRequest) {
  // ... existing logging ...

  // Integrate with Sentry
  if (this.sentryService) {
    this.sentryService.captureException(exception, {
      tags: {
        error_code: errorResponse.error,
        request_id: errorResponse.request_id,
      },
      extra: {
        path: request.url,
        method: request.method,
        ip: request.ip,
      },
    });
  }
}
```

## Development vs Production

### Development Mode

- Stack traces included in error responses
- Detailed console logging
- More verbose error messages

### Production Mode

- No stack traces in responses
- Structured logging only
- Sanitized error messages
- Error tracking service integration

### Environment Detection

Set `NODE_ENV=production` for production mode:

```bash
NODE_ENV=production npm start
```

## Best Practices

### 1. Error Handling in Clients

```typescript
async function apiCall() {
  try {
    const response = await fetch('/sessions', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      const error = await response.json();

      // Handle specific error codes
      switch (error.error) {
        case 'validation_error':
          console.error('Validation failed:', error.details);
          break;
        case 'rate_limit_exceeded':
          console.error('Rate limited, retry after delay');
          break;
        case 'not_found':
          console.error('Resource not found');
          break;
        default:
          console.error('API error:', error.message);
      }

      throw new Error(error.message);
    }

    return response.json();
  } catch (error) {
    console.error('Request failed:', error);
    throw error;
  }
}
```

### 2. Logging Request IDs

Always log request IDs for debugging:

```typescript
const requestId = 'my-request-' + Date.now();
console.log(`[${requestId}] Starting request...`);

try {
  const response = await fetch('/sessions', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'X-Request-ID': requestId
    }
  });
} catch (error) {
  console.error(`[${requestId}] Request failed:`, error);
}
```

### 3. Retry Logic

Implement retry logic with exponential backoff:

```typescript
async function withRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429) {
        // Rate limited - exponential backoff
        const delay = Math.pow(2, i) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (error.status >= 500 && i < maxRetries - 1) {
        // Server error - retry
        const delay = Math.pow(2, i) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }
}
```

## Testing

### Unit Tests

Test error handling with mock exceptions:

```typescript
it('should handle validation errors', () => {
  const exception = new BadRequestException({
    message: ['field is required'],
  });

  filter.catch(exception, mockHost);

  expect(mockResponse.json).toHaveBeenCalledWith(
    expect.objectContaining({
      error: 'validation_error',
      details: ['field is required'],
    })
  );
});
```

### Integration Tests

Test rate limiting with actual requests:

```typescript
it('should enforce rate limits', async () => {
  const requests = Array(120).fill(null).map(() =>
    request(app).get('/sessions')
  );

  const responses = await Promise.all(requests);
  const rateLimited = responses.filter(r => r.status === 429);

  expect(rateLimited.length).toBeGreaterThan(0);
});
```

## Troubleshooting

### Common Issues

1. **Too many 429 errors**
   - Reduce request frequency
   - Implement request queuing
   - Use batch endpoints

2. **Timeout errors**
   - Optimize database queries
   - Add indexes for frequently queried fields
   - Consider pagination for large result sets

3. **Validation errors**
   - Check API documentation for required fields
   - Validate data before sending requests
   - Use TypeScript types for type safety

### Getting Help

When reporting errors, include:
- Request ID from error response
- Timestamp of the error
- Request method and endpoint
- Error code and message
- Steps to reproduce

## Summary

The Claude Projects State Tracking API provides:

- ✅ Structured error responses with standardized error codes
- ✅ Request ID tracking for debugging
- ✅ Comprehensive error handling (HTTP, database, timeout, validation)
- ✅ Rate limiting with configurable limits per endpoint
- ✅ Development vs production error detail levels
- ✅ Error tracking service integration ready
- ✅ Extensive test coverage

For more information, see:
- [API Documentation](../README.md)
- [Session Health Endpoints](./SESSION_HEALTH_ENDPOINTS.md)
- [Recovery Workflow](./RECOVERY_WORKFLOW.md)
