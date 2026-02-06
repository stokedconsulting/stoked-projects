# GitHub Error Handling Module

Comprehensive error handling for GitHub API operations with automatic retry logic, circuit breaker pattern, and user-friendly error messages.

## Features

- **Error Categorization**: Classifies errors into 6 types (rate limit, auth, server, network, validation, unknown)
- **Retry Strategies**: Automatic retry with exponential backoff for transient failures
- **Circuit Breaker**: Prevents cascading failures with fast-fail mechanism
- **User-Friendly Messages**: Maps technical errors to actionable guidance
- **Retry History Tracking**: Maintains complete audit trail of retry attempts

## Usage

### Basic Usage

```typescript
import { RetryStrategyService } from './github/errors';

// Inject the service
constructor(private readonly retryStrategy: RetryStrategyService) {}

// Execute operation with automatic retry
async fetchProject(projectId: string) {
  return await this.retryStrategy.executeWithRetry(
    async () => {
      // Your GitHub API call here
      return await this.githubClient.getProject(projectId);
    },
    {
      operation_type: 'fetch_project',
      user_id: 'user-123',
      resource: projectId,
    }
  );
}
```

### Error Types

#### 1. Rate Limit (429)
- **Behavior**: Waits until rate limit reset time, then retries once
- **User Message**: "GitHub API rate limit exceeded. Please wait a few minutes and try again."

#### 2. Auth Errors (401/403)
- **Behavior**: No retry - requires user action
- **User Message**:
  - 401: "GitHub authentication failed. Please verify your access token is valid and has not expired."
  - 403: "GitHub authorization failed. Your token does not have the required permissions..."

#### 3. Server Errors (500/502/503)
- **Behavior**: Retries 3 times with exponential backoff (1s, 2s, 4s)
- **User Message**: "GitHub is experiencing technical difficulties. We will automatically retry your request."

#### 4. Network Errors (timeouts, connection failures)
- **Behavior**: Retries 3 times with exponential backoff (1s, 2s, 4s)
- **User Message**: "Network error while connecting to GitHub. We will automatically retry your request."

#### 5. Validation Errors (400/422)
- **Behavior**: No retry - invalid request
- **User Message**: "Invalid request to GitHub API. Please check your input parameters and try again."

#### 6. Unknown Errors
- **Behavior**: Single retry attempt
- **User Message**: "An unexpected error occurred while communicating with GitHub. We will retry once."

## Circuit Breaker

The circuit breaker prevents cascading failures by opening after consecutive failures:

- **Closed**: Normal operation (initial state)
- **Open**: Fast-fail mode (after 5 consecutive failures, lasts 30 seconds)
- **Half-Open**: Testing recovery (allows test request, closes after 3 successes)

### Configuration

```typescript
// Circuit breaker thresholds
FAILURE_THRESHOLD = 5;      // Opens after 5 failures
SUCCESS_THRESHOLD = 3;      // Closes after 3 successes
RECOVERY_TIMEOUT_MS = 30000; // 30 seconds in open state
```

### Checking Circuit Breaker Status

```typescript
const stats = this.retryStrategy.getCircuitBreakerStats();
console.log(stats);
// {
//   state: 'CLOSED',
//   failure_count: 0,
//   success_count: 0,
//   last_failure_time: undefined,
//   last_state_change: 1234567890,
//   next_attempt_time: undefined
// }
```

## Error Details Structure

All errors extend `GitHubException` and include:

```typescript
interface GitHubErrorDetails {
  type: GitHubErrorType;           // Error category
  status_code?: number;            // HTTP status code
  technical_message: string;       // Technical error message
  user_message: string;            // User-friendly message
  rate_limit_reset?: number;       // Unix timestamp for rate limit
  retry_decision: RetryDecision;   // Retry strategy info
  context?: object;                // Operation context
  retry_history?: Array<{          // Retry attempt history
    attempt: number;
    timestamp: string;
    error: string;
  }>;
}
```

## Integration with NestJS

Import the module in your feature module:

```typescript
import { Module } from '@nestjs/common';
import { GitHubErrorHandlerModule } from './github/errors';

@Module({
  imports: [GitHubErrorHandlerModule],
  // ...
})
export class GitHubModule {}
```

## Testing

Run the test suite:

```bash
npm test -- src/github/errors
```

### Test Coverage

- ✅ AC-1.4.a: Rate limit handling with reset time
- ✅ AC-1.4.b: Server error retry with exponential backoff
- ✅ AC-1.4.c: Auth errors return immediately without retry
- ✅ AC-1.4.d: Circuit breaker opens after 5 failures
- ✅ AC-1.4.e: Circuit breaker half-open and closing behavior
- ✅ AC-1.4.f: User-friendly error messages with remediation steps

## Architecture

```
github/errors/
├── github-error.types.ts          # Type definitions
├── github.exception.ts            # Exception classes
├── circuit-breaker.service.ts     # Circuit breaker implementation
├── error-categorization.service.ts # Error classification
├── retry-strategy.service.ts      # Retry orchestration
├── github-error-handler.module.ts # NestJS module
└── index.ts                       # Public exports
```

## Best Practices

1. **Always provide context**: Include operation type, user ID, and resource information
2. **Handle errors gracefully**: Catch `GitHubException` and display `user_message` to users
3. **Monitor circuit breaker**: Log state changes for operational visibility
4. **Review retry history**: Use `retry_history` for debugging persistent failures
5. **Reset circuit breaker carefully**: Manual reset should only be done after confirming recovery

## Related Documentation

- [GitHub API Rate Limits](https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limiting)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Exponential Backoff](https://en.wikipedia.org/wiki/Exponential_backoff)
