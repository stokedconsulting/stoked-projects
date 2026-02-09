# GitHub Client Module

Unified GitHub API client abstraction layer that provides a consistent interface for both GraphQL and REST API operations.

## Features

- **Dual API Support**: Single interface for both GraphQL and REST operations
- **Connection Pooling**: Configurable pool (default 10 concurrent connections)
- **Automatic Retry**: Exponential backoff for transient failures (3 attempts: 1s, 2s, 4s)
- **Rate Limit Handling**: Automatic queuing and retry after rate limit window
- **Error Normalization**: Consistent error format across API types
- **TypeScript**: Full type safety with generics

## Installation

The module requires the following dependencies (already installed):

```bash
pnpm add @octokit/graphql @octokit/rest @octokit/types
```

## Usage

### Module Registration

```typescript
import { GitHubModule } from './modules/github';

// Synchronous registration
@Module({
  imports: [
    GitHubModule.forRoot({
      token: 'github_pat_xxxxx',
      maxConnections: 10,
      retryAttempts: 3,
      retryDelays: [1000, 2000, 4000],
      timeout: 30000,
    }),
  ],
})
export class AppModule {}

// Async registration with ConfigService
@Module({
  imports: [
    GitHubModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        token: configService.get<string>('GITHUB_TOKEN'),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

### GraphQL Operations

```typescript
import { GitHubClientService } from './modules/github';

@Injectable()
export class MyService {
  constructor(private readonly githubClient: GitHubClientService) {}

  async getUser(login: string) {
    const result = await this.githubClient.executeGraphQL({
      query: `
        query($login: String!) {
          user(login: $login) {
            id
            name
            email
          }
        }
      `,
      variables: { login },
    });

    if (result.success) {
      return result.data;
    } else {
      throw new Error(result.error.message);
    }
  }
}
```

### REST Operations

```typescript
async createIssue(owner: string, repo: string, title: string) {
  const result = await this.githubClient.executeREST({
    method: 'POST',
    endpoint: `repos/${owner}/${repo}/issues`,
    body: { title, body: 'Issue body' },
  });

  return result.data;
}

async getRepository(owner: string, repo: string) {
  const result = await this.githubClient.executeREST({
    method: 'GET',
    endpoint: `repos/${owner}/${repo}`,
  });

  return result.data;
}
```

### Rate Limit Monitoring

```typescript
async checkRateLimit() {
  const rateLimitInfo = await this.githubClient.getRateLimitInfo();

  console.log(`Remaining: ${rateLimitInfo.remaining}/${rateLimitInfo.limit}`);
  console.log(`Resets at: ${rateLimitInfo.reset}`);
}
```

### Connection Pool Status

```typescript
getPoolStatus() {
  const status = this.githubClient.getConnectionPoolStatus();

  console.log(`Active: ${status.active}/${status.total}`);
  console.log(`Queued: ${status.queued}`);
}
```

## Response Format

All operations return a normalized response:

```typescript
interface GitHubResponse<T> {
  success: boolean;
  data?: T;
  error?: GitHubError;
  metadata?: {
    operation: 'graphql' | 'rest';
    duration: number;
    retryCount?: number;
  };
}
```

## Error Handling

Errors are normalized with specific error codes:

```typescript
enum GitHubErrorCode {
  GITHUB_AUTH_FAILED = 'GITHUB_AUTH_FAILED',      // No retry
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',    // Auto-queued
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',            // Auto-retry (3x)
  API_DEPRECATED = 'API_DEPRECATED',              // No retry, logged
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',                // No retry
}
```

### Error Handling Examples

```typescript
const result = await this.githubClient.executeGraphQL({ query });

if (!result.success) {
  switch (result.error.code) {
    case GitHubErrorCode.GITHUB_AUTH_FAILED:
      // Refresh token or alert admin
      break;
    case GitHubErrorCode.RATE_LIMIT_EXCEEDED:
      // Already queued, will retry automatically
      break;
    case GitHubErrorCode.NETWORK_TIMEOUT:
      // Already retried 3 times, log error
      break;
    case GitHubErrorCode.API_DEPRECATED:
      // Update to new endpoint
      break;
  }
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | string | required | GitHub Personal Access Token |
| `maxConnections` | number | 10 | Maximum concurrent connections |
| `retryAttempts` | number | 3 | Number of retry attempts |
| `retryDelays` | number[] | [1000, 2000, 4000] | Delay in ms for each retry |
| `timeout` | number | 30000 | Request timeout in ms |

## Retry Behavior

- **Authentication errors**: No retry (error code indicates permanent failure)
- **Rate limits**: Automatic queuing, retry after rate limit window
- **Network timeouts**: 3 retries with exponential backoff (1s, 2s, 4s)
- **Server errors (5xx)**: 3 retries with exponential backoff
- **Client errors (4xx)**: No retry (except rate limits)

## Testing

All 29 tests passing:

```bash
# Run all tests
pnpm test -- src/modules/github/

# Run unit tests only
pnpm test -- src/modules/github/client/github-client.service.spec.ts

# Run integration tests only
pnpm test -- src/modules/github/client/github-client.integration.spec.ts
```

### Test Coverage

- ✅ AC-1.1.a: GraphQL query execution with typed response (< 2s)
- ✅ AC-1.1.b: REST endpoint execution with normalized response
- ✅ AC-1.1.c: Rate limit queuing and retry after window
- ✅ AC-1.1.d: Network timeout retry with exponential backoff (3x)
- ✅ AC-1.1.e: Authentication failure without retry
- ✅ AC-1.1.f: API deprecation warning logging

## Architecture

```
GitHubModule
├── GitHubClientService (main service)
│   ├── GraphQL client (@octokit/graphql)
│   ├── REST client (@octokit/rest)
│   └── Connection pool manager
├── Types
│   ├── GitHubResponse<T>
│   ├── GitHubError
│   ├── GitHubErrorCode
│   └── Client configuration
└── Tests
    ├── Unit tests (17)
    └── Integration tests (12)
```

## Performance

- Connection pooling limits concurrent requests
- Automatic request queuing prevents overwhelming API
- Rate limit detection prevents wasted retries
- Exponential backoff reduces server load

## Future Enhancements

- Circuit breaker pattern for cascading failures
- Metrics collection (request count, duration, errors)
- Webhook event handling
- GraphQL schema caching
- Request/response caching layer
