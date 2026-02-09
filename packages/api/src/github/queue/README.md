# GitHub API Rate Limiting and Request Queue

This module provides intelligent rate limiting and request queuing to stay within GitHub API limits while maximizing throughput.

## Features

- **Rate Limit Tracking**: Monitors GitHub GraphQL (5,000 req/hour) and REST API limits separately
- **Priority Queue**: Three-tier priority system (high, normal, low)
- **Per-User Isolation**: Independent queues and rate limits for each user
- **Proactive Throttling**: Automatically slows down at 80% quota threshold
- **Queue Management**: Configurable capacity (default: 1,000 requests), automatic timeout cleanup
- **High-Priority Bypass**: Allows critical requests to bypass queue (max 10% of traffic)

## Usage

### Basic Setup

```typescript
import { RateLimitModule } from './github/queue';

@Module({
  imports: [RateLimitModule],
})
export class AppModule {}
```

### Enqueueing Requests

```typescript
import { RateLimitService, RequestPriority } from './github/queue';

@Injectable()
export class GitHubService {
  constructor(private rateLimitService: RateLimitService) {}

  async fetchUserData(userId: string) {
    // Enqueue a normal priority request
    const result = await this.rateLimitService.enqueueRequest(
      userId,
      async () => {
        // Your GitHub API call here
        return await this.githubClient.query({ ... });
      },
      RequestPriority.NORMAL,
      'graphql',
    );

    return result;
  }

  async criticalOperation(userId: string) {
    // High-priority request bypasses queue (up to 10% limit)
    const result = await this.rateLimitService.enqueueRequest(
      userId,
      async () => {
        return await this.githubClient.mutate({ ... });
      },
      RequestPriority.HIGH,
      'graphql',
    );

    return result;
  }
}
```

### Updating Rate Limits from Response Headers

After each GitHub API call, update the service with rate limit info:

```typescript
async makeGitHubRequest(userId: string) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ query: '...' }),
  });

  // Update rate limit tracking
  this.rateLimitService.updateRateLimitFromHeaders(
    userId,
    {
      'x-ratelimit-remaining': response.headers.get('x-ratelimit-remaining'),
      'x-ratelimit-limit': response.headers.get('x-ratelimit-limit'),
      'x-ratelimit-reset': response.headers.get('x-ratelimit-reset'),
    },
    'graphql',
  );

  return await response.json();
}
```

### Configuration

Configure rate limiting behavior:

```typescript
this.rateLimitService.configure({
  maxQueueSize: 1000,                    // Maximum pending requests
  requestTimeout: 2 * 60 * 1000,         // 2 minutes timeout
  throttleThreshold: 0.8,                 // Throttle at 80% quota
  throttleRate: 0.5,                      // Slow to 50% rate when throttling
  maxBypassRate: 0.1,                     // Allow 10% high-priority bypass
  bypassWindowMs: 60 * 60 * 1000,        // 1 hour bypass tracking window
});
```

### Monitoring Queue Statistics

```typescript
const stats = this.rateLimitService.getQueueStats(userId);

console.log({
  total: stats.total,           // Total requests in queue
  high: stats.high,             // High-priority count
  normal: stats.normal,         // Normal-priority count
  low: stats.low,               // Low-priority count
  oldestAge: stats.oldestAge,   // Age of oldest request (ms)
  bypassCount: stats.bypassCount // Recent bypass count
});
```

### Checking Rate Limit State

```typescript
const state = this.rateLimitService.getRateLimitState(userId);

if (state) {
  console.log({
    graphql: {
      remaining: state.graphql.remaining,
      limit: state.graphql.limit,
      resetAt: new Date(state.graphql.resetAt * 1000),
    },
    rest: {
      remaining: state.rest.remaining,
      limit: state.rest.limit,
      resetAt: new Date(state.rest.resetAt * 1000),
    },
  });
}
```

## Priority Levels

- **HIGH**: Critical operations that may bypass queue (max 10% of total traffic)
- **NORMAL**: Standard operations (default)
- **LOW**: Background tasks that can wait

## Rate Limiting Behavior

### 1. Request with Remaining Quota (AC-1.5.a)
- Executes immediately when quota is available
- Updates tracking after execution

### 2. Proactive Throttling (AC-1.5.b)
- At 80% quota utilization, throttles to 50% request rate
- Prevents hitting hard limits

### 3. Rate Limit Exceeded (AC-1.5.c)
- Pauses queue until rate limit reset time
- Automatically resumes after reset

### 4. High-Priority Bypass (AC-1.5.d)
- High-priority requests can bypass queue
- Limited to 10% of total traffic per hour

### 5. Request Timeout (AC-1.5.e)
- Requests in queue > 2 minutes automatically timeout
- Cleanup runs every 30 seconds
- Rejects with `RequestTimeoutError`

### 6. Queue Capacity (AC-1.5.f)
- Maximum 1,000 pending requests (configurable)
- New requests rejected with `QueueCapacityError` when full

## Error Handling

```typescript
try {
  await this.rateLimitService.enqueueRequest(userId, ...);
} catch (error) {
  if (error.name === 'QueueCapacityError') {
    // Queue is full - retry later or shed load
    console.error('Queue at capacity:', error.message);
  } else if (error.name === 'RequestTimeoutError') {
    // Request timed out in queue
    console.error('Request timed out:', error.message);
  } else {
    // Request execution failed
    console.error('Request failed:', error);
  }
}
```

## Architecture

### Components

- **RateLimitService**: Main service managing queues and rate limits
- **PriorityQueue**: Three-tier priority queue data structure
- **Types**: TypeScript interfaces for type safety

### Data Flow

```
Request → Enqueue → Priority Queue → Rate Limit Check → Execute → Update Limits
                         ↓
                    Throttling/Pause if needed
```

### Per-User Isolation

Each user has:
- Independent request queue
- Separate rate limit tracking (GraphQL + REST)
- Individual bypass count tracking

## Testing

Run the comprehensive test suite:

```bash
npm test -- src/github/queue
```

Tests cover:
- All 6 acceptance criteria
- Priority queue behavior
- Multi-user scenarios
- Load testing (1,000 requests)
- Error recovery
- GraphQL vs REST isolation

## Performance

- **Enqueue**: O(1) - constant time insertion
- **Dequeue**: O(1) - constant time retrieval
- **Queue Capacity**: Handles 1,000+ requests efficiently
- **Memory**: Minimal overhead per request (~200 bytes)
