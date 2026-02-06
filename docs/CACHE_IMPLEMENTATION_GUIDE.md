# Cache Strategy Implementation Guide

## Overview

This guide provides implementation details for aligning caching across the Claude Projects system. It covers:
- **Extension** (VSCode workspace cache)
- **API** (HTTP response caching with ETags)
- **MCP Server** (Client-side request caching)

## Files Modified/Created

### 1. Cache Policy Definitions
**File:** `/packages/api/src/common/cache/cache-policy.ts`

Unified cache policy definitions used across all components.

**Key Classes:**
- `CachePolicy` - Enum of cache policies (NO_CACHE, SHORT, MEDIUM, LONG, etc.)
- `CACHE_POLICIES` - Policy configurations with TTLs and headers
- `ENDPOINT_CACHE_CONFIG` - Per-endpoint cache policies
- `getCachePolicyForEndpoint()` - Lookup cache policy for an endpoint

**Usage:**
```typescript
import {
  getCachePolicyForEndpoint,
  shouldCacheResponse,
  CachePolicy
} from '@/common/cache/cache-policy';

// Get policy for endpoint
const policy = getCachePolicyForEndpoint('GET', '/tasks/123');
console.log(policy.cacheControl); // "public, max-age=300, must-revalidate"

// Check if response should be cached
const shouldCache = shouldCacheResponse('GET', 200); // true
```

### 2. API Cache Headers Interceptor
**File:** `/packages/api/src/common/interceptors/cache-headers.interceptor.ts`

NestJS interceptor that automatically sets Cache-Control headers on responses.

**Features:**
- Automatic cache header injection based on endpoint
- ETag generation for response validation
- Last-Modified header support
- Logging of cache decisions

**Configuration:**
The interceptor includes built-in configs for common endpoints:
- Health checks: `max-age=30`
- Session GET: `max-age=60, must-revalidate`
- Task GET: `max-age=300, must-revalidate`
- Mutations: `no-store, private`

**How it works:**
1. Intercepts all responses
2. Matches endpoint path and method against patterns
3. Sets `Cache-Control` header based on match
4. Generates ETag for revalidation
5. Sets `X-Cache-Strategy` header for debugging

### 3. Extension Cache Manager Enhanced
**File:** `/apps/code-ext/src/cache-manager.ts`

Enhanced version with metrics tracking and better invalidation.

**New Features:**
- `CacheMetrics` interface for tracking hits, misses, invalidations
- `recordCacheHit()` - Track successful cache lookups
- `recordCacheMiss()` - Track cache misses
- `recordInvalidation()` - Track invalidation events with reason
- `getHitRate()` - Calculate overall hit rate percentage
- `getMetrics()` - Get detailed cache metrics

**Usage:**
```typescript
// Track cache operations automatically
const cached = await cacheManager.loadCache(owner, repo);

// Get metrics
const metrics = cacheManager.getMetrics();
const hitRate = cacheManager.getHitRate();

// Clear cache with reason tracking
await cacheManager.clearCache(owner, repo, 'mutation-event');
```

### 4. MCP Server Cache Client
**File:** `/packages/mcp-server/src/cache/cache-client.ts`

Lightweight client-side cache manager for MCP tool responses.

**Features:**
- TTL-based expiry (configurable per entry)
- LRU (Least Recently Used) eviction
- ETag support for revalidation
- Cache metrics (hits, misses, hit rate)
- Respects Cache-Control headers

**Usage:**
```typescript
import { createCacheClient, CacheClient } from './cache/cache-client';

// Create cache with 5-minute default TTL
const cache = createCacheClient<ProjectData>({
  maxSize: 1000,
  defaultMaxAge: 300
});

// Store response with TTL from Cache-Control header
const maxAge = CacheClient.parseMaxAge(response.headers['cache-control']);
cache.set(key, data, maxAge, etag);

// Retrieve cached data
const cached = cache.get(key);

// Get metrics
console.log(cache.getMetrics());
// { size: 42, hits: 156, misses: 23, hitRate: 87, evictions: 2 }
```

---

## Integration Points

### VSCode Extension Integration

**Before (No caching):**
```typescript
// projects-view-provider.ts
const data = await this.githubApi.getProjects(owner, repo);
return this.renderProjects(data); // Always fresh from API
```

**After (With caching):**
```typescript
// projects-view-provider.ts
let data = await this.cacheManager.loadCache(owner, repo);

if (!data) {
  data = await this.githubApi.getProjects(owner, repo);
  await this.cacheManager.saveCache(
    owner, repo,
    data.repoProjects,
    data.orgProjects,
    data.statusOptions
  );
}

return this.renderProjects(data);
```

**Invalidation on mutations:**
```typescript
// On project update/create/delete
await this.cacheManager.clearCache(owner, repo, 'mutation');
this.refreshData(); // Triggers UI update
```

### API Controller Integration

**Before (No cache headers):**
```typescript
@Get('tasks/:id')
async getTask(@Param('id') id: string) {
  return this.tasksService.get(id);
  // Response has no Cache-Control header
  // Client has no guidance on caching
}
```

**After (With cache headers interceptor):**
```typescript
@Get('tasks/:id')
async getTask(@Param('id') id: string) {
  return this.tasksService.get(id);
  // Interceptor automatically adds:
  // Cache-Control: public, max-age=300, must-revalidate
  // ETag: "{hash}"
  // Last-Modified: {date}
}
```

### MCP Tool Integration

**Before (No caching):**
```typescript
export async function callGetProjectPhases(projectId: string) {
  const response = await apiClient.get(`/projects/${projectId}/phases`);
  return response;
  // Every call hits the API
}
```

**After (With client cache):**
```typescript
const cache = createCacheClient<ProjectPhases>();

export async function callGetProjectPhases(projectId: string) {
  // Check cache first
  const cached = cache.get(`phases:${projectId}`);
  if (cached) return cached;

  // Cache miss - fetch from API
  const response = await apiClient.get(`/projects/${projectId}/phases`);

  // Parse Cache-Control header and cache response
  const maxAge = CacheClient.parseMaxAge(response.headers['cache-control']);
  const etag = response.headers['etag'];
  cache.set(`phases:${projectId}`, response.data, maxAge, etag);

  return response.data;
}
```

---

## Cache Header Examples

### Health Endpoint Response
```http
GET /health HTTP/1.1

HTTP/1.1 200 OK
Cache-Control: public, max-age=30
X-Cache-Strategy: Health checks
Content-Type: application/json

{
  "status": "ok",
  "timestamp": "2025-01-24T...",
  "uptime": 3600
}
```

### Task Data Response (Cacheable)
```http
GET /tasks/task-123 HTTP/1.1

HTTP/1.1 200 OK
Cache-Control: public, max-age=300, must-revalidate
ETag: "5d41402abc4b2a76b9719d911017c592"
Last-Modified: Fri, 24 Jan 2025 15:30:45 GMT
Vary: Authorization, Accept-Encoding
X-Cache-Strategy: Task data (GET only)
Content-Type: application/json

{
  "id": "task-123",
  "title": "Implement feature",
  "status": "in_progress"
}
```

### Conditional Request (304 Not Modified)
```http
GET /tasks/task-123 HTTP/1.1
If-None-Match: "5d41402abc4b2a76b9719d911017c592"

HTTP/1.1 304 Not Modified
Cache-Control: public, max-age=300, must-revalidate
ETag: "5d41402abc4b2a76b9719d911017c592"
```

### Mutation Response (No Cache)
```http
POST /tasks HTTP/1.1

HTTP/1.1 201 Created
Cache-Control: no-store, private
Pragma: no-cache
X-Cache-Strategy: Default (no cache)
Content-Type: application/json

{
  "id": "task-new-456",
  "title": "New task",
  "status": "pending"
}
```

---

## Testing Cache Behavior

### Extension Cache Tests
```typescript
describe('CacheManager with metrics', () => {
  let cacheManager: CacheManager;
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    context = createMockExtensionContext();
    cacheManager = new CacheManager(context);
  });

  it('should track cache hits and misses', async () => {
    // Populate cache
    await cacheManager.saveCache('org', 'repo', [], [], []);

    // Hit
    await cacheManager.loadCache('org', 'repo');
    // Miss (different repo)
    await cacheManager.loadCache('org', 'other-repo');

    const metrics = cacheManager.getMetrics();
    expect(metrics.get('org/repo')?.hits).toBe(1);
    expect(metrics.get('org/other-repo')?.misses).toBe(1);
  });

  it('should calculate hit rate correctly', async () => {
    // 2 hits, 1 miss = 66% hit rate
    await cacheManager.saveCache('o1', 'r1', [], [], []);
    await cacheManager.loadCache('o1', 'r1'); // hit
    await cacheManager.loadCache('o1', 'r1'); // hit
    await cacheManager.loadCache('o1', 'r2'); // miss

    expect(cacheManager.getHitRate()).toBe(66);
  });

  it('should track invalidation reasons', async () => {
    await cacheManager.saveCache('o1', 'r1', [], [], []);
    await cacheManager.clearCache('o1', 'r1', 'mutation-event');

    const metrics = cacheManager.getMetrics().get('o1/r1');
    expect(metrics?.lastInvalidationReason).toBe('mutation-event');
    expect(metrics?.invalidations).toBe(1);
  });
});
```

### API Cache Header Tests
```typescript
describe('CacheHeadersInterceptor', () => {
  it('should set cache headers for GET requests', async () => {
    const response = await request(app.getHttpServer())
      .get('/tasks/123');

    expect(response.headers['cache-control']).toBe('public, max-age=300, must-revalidate');
    expect(response.headers['etag']).toBeDefined();
  });

  it('should not cache mutation responses', async () => {
    const response = await request(app.getHttpServer())
      .post('/tasks')
      .send({ title: 'New task' });

    expect(response.headers['cache-control']).toBe('no-store, private');
  });

  it('should handle 304 Not Modified', async () => {
    // First request
    const firstResponse = await request(app.getHttpServer())
      .get('/tasks/123');
    const etag = firstResponse.headers['etag'];

    // Conditional request with ETag
    const secondResponse = await request(app.getHttpServer())
      .get('/tasks/123')
      .set('If-None-Match', etag);

    expect(secondResponse.status).toBe(304);
  });
});
```

### MCP Cache Tests
```typescript
describe('CacheClient', () => {
  let cache: CacheClient<any>;

  beforeEach(() => {
    cache = createCacheClient({ defaultMaxAge: 60 });
  });

  it('should cache and retrieve data', () => {
    const data = { id: '123', name: 'Project' };
    cache.set('project:123', data, 60);

    const retrieved = cache.get('project:123');
    expect(retrieved).toEqual(data);
  });

  it('should expire entries after TTL', async () => {
    jest.useFakeTimers();

    cache.set('key', { data: 'value' }, 10);
    expect(cache.get('key')).toBeDefined();

    jest.advanceTimersByTime(11000);
    expect(cache.get('key')).toBeNull();

    jest.useRealTimers();
  });

  it('should track metrics correctly', () => {
    cache.set('key1', { data: 'v1' });
    cache.get('key1'); // hit
    cache.get('key1'); // hit
    cache.get('key2'); // miss
    cache.get('key3'); // miss

    const metrics = cache.getMetrics();
    expect(metrics.hits).toBe(2);
    expect(metrics.misses).toBe(2);
    expect(metrics.hitRate).toBe(50);
  });

  it('should parse Cache-Control headers', () => {
    const maxAge = CacheClient.parseMaxAge('public, max-age=300');
    expect(maxAge).toBe(300);
  });

  it('should evict oldest entry when full', () => {
    const smallCache = createCacheClient({ maxSize: 2 });

    jest.useFakeTimers();
    smallCache.set('key1', { data: 'v1' });
    jest.advanceTimersByTime(1000);

    smallCache.set('key2', { data: 'v2' });
    jest.advanceTimersByTime(1000);

    smallCache.set('key3', { data: 'v3' }); // Should evict key1

    expect(smallCache.has('key1')).toBe(false);
    expect(smallCache.has('key2')).toBe(true);
    expect(smallCache.has('key3')).toBe(true);

    jest.useRealTimers();
  });
});
```

---

## Monitoring & Observability

### Logging Cache Decisions

Enable debug logging to see cache decisions:

```typescript
// Extension
console.log('[CacheManager] Cache hit: ghProjects.cache.org/repo (age: 45s)');
console.log('[CacheManager] Cache miss: ghProjects.cache.org/repo');
console.log('[CacheManager] Cache invalidated: ghProjects.cache.org/repo (reason: mutation)');

// API
console.debug('[CacheHeadersInterceptor] Health checks (max-age=30)');
console.debug('[CacheHeadersInterceptor] Task data (max-age=300, must-revalidate)');

// MCP
console.log('[CacheClient] Cache hit rate: 87% (156 hits, 23 misses)');
```

### Metrics Dashboard (Future)

Suggested metrics to track in a monitoring dashboard:

**Extension:**
- Cache hit rate by repository
- Cache size per workspace
- Invalidation frequency by reason

**API:**
- 304 Not Modified rate
- ETag collision rate (if using simple hash)
- Cache policy distribution (how many requests use each policy)

**MCP:**
- Client-side cache hit rate
- Cache eviction frequency
- Average entry TTL

---

## Troubleshooting

### Cache Not Being Used

1. **Check cache headers:**
   ```bash
   curl -i https://api.example.com/tasks/123
   # Look for Cache-Control header
   ```

2. **Check extension logs:**
   ```
   [CacheManager] Cache hit: ... (age: 45s)
   [CacheManager] Cache miss: ...
   ```

3. **Verify cache policy:**
   - Health check should have `max-age=30`
   - Task GET should have `max-age=300, must-revalidate`
   - Mutations should have `no-store`

### Stale Data Issues

1. **Check TTL:**
   - Is data changing faster than TTL?
   - Consider reducing TTL for frequently updated data

2. **Implement event-based invalidation:**
   - Clear cache on mutations
   - Publish cache invalidation events

3. **Use ETags for validation:**
   - Server returns 304 if data unchanged
   - Client reuses cached data

### Cache Memory Growing

1. **Check cache size:**
   ```typescript
   const metrics = cache.getMetrics();
   console.log(`Cache size: ${metrics.size} entries`);
   ```

2. **Reduce TTL** to clear entries sooner

3. **Implement cache limits:**
   - Max cache size per component
   - LRU eviction policy (already in MCP CacheClient)

---

## Migration Checklist

- [x] Define unified cache policies
- [x] Create cache policy definitions file
- [x] Implement API cache headers interceptor
- [x] Add cache headers to app.module.ts
- [x] Enhance extension cache manager with metrics
- [x] Create MCP client-side cache manager
- [ ] Update extension to use cache invalidation on mutations
- [ ] Update MCP tools to use client-side cache
- [ ] Add cache metrics to logging
- [ ] Document cache behavior per endpoint
- [ ] Add cache control to all API endpoints
- [ ] Add ETag generation to mutable endpoints
- [ ] Test cache behavior (unit tests)
- [ ] Test cache behavior (integration tests)
- [ ] Monitor cache effectiveness in production

---

## References

- [HTTP Caching Spec (RFC 9111)](https://tools.ietf.org/html/rfc9111)
- [Cache-Control Directive Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control)
- [ETag Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag)
- [NestJS Caching Guide](https://docs.nestjs.com/techniques/caching)
- [VSCode Extension Storage API](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext)
