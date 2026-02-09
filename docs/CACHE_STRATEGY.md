# Cache Strategy Alignment

## Overview

This document defines a unified caching strategy across all layers of the Claude Projects system:
- **VSCode Extension** (`apps/code-ext`)
- **State Tracking API** (`packages/api`)
- **MCP Server** (`packages/mcp-server`)

The strategy ensures consistency, predictability, and optimal performance across all components while maintaining data freshness and minimizing unnecessary API calls.

## Cache Layers

### 1. VSCode Extension Cache (Workspace-Local)

**Location:** VSCode `workspaceState` (persisted to `~/.vscode-server/data/`)

**Purpose:** Minimize GitHub API calls for frequently accessed project data

**Cached Data:**
- Repository projects
- Organization projects
- Status options
- Custom fields metadata

**Configuration:**
```typescript
- TTL: 5 minutes (300,000 ms)
- Version: 1 (bumped on breaking changes)
- Scope: Per owner/repo combination
- Key format: `ghProjects.cache.{owner}.{repo}`
```

**Invalidation:**
- Automatic on expiry after 5 minutes
- Manual via UI "Clear Cache" button
- Triggered on mutation operations (update, delete, create)
- Triggered when switching workspaces

**Cache Control Headers (if served via webview):**
- Not directly applicable (stored in workspaceState)
- Serve webview assets with `Cache-Control: no-cache` to force validation

---

### 2. API Token Cache (In-Memory, Per-Instance)

**Location:** `GitHubAuthService` in-memory singleton

**Purpose:** Reduce repeated token validation calls

**Cached Data:**
- GitHub token metadata
- Token scopes
- Token expiration info
- Token source information

**Configuration:**
```typescript
- TTL: 5 minutes (300,000 ms)
- Scope: Per token source
- Validation: Cache remains valid until TTL expires
- Strategy: Lazy refresh on access
```

**Invalidation:**
- Automatic on expiry
- On scope validation failure
- On explicit `clearCache()` call
- On token source change

**API Response Headers:**
```
Cache-Control: no-store
X-Cache: BYPASS (token responses should never be cached by proxies)
```

---

### 3. API HTTP Response Cache

**Location:** Managed by NestJS interceptors and HTTP headers

**Purpose:** Allow clients to cache safe GET requests locally

**Cached Responses:**

**Read Operations (Safe to Cache):**
- `GET /sessions/{id}` - Session state (TTL: 1 minute)
- `GET /tasks/{id}` - Task details (TTL: 5 minutes)
- `GET /tasks` - Task list (TTL: 5 minutes)
- `GET /health` - Health check (TTL: 30 seconds, max-age)
- `GET /health/detailed` - System metrics (TTL: 1 minute)

**Mutation Operations (Never Cache):**
- `POST /tasks` - Create
- `PATCH /tasks/{id}` - Update
- `DELETE /tasks/{id}` - Delete
- Any non-idempotent operation

**Configuration:**
```typescript
// For cacheable GET endpoints
Cache-Control: public, max-age=300, s-maxage=600
  - max-age: 5 minutes (client cache)
  - s-maxage: 10 minutes (shared cache/CDN)
  - public: Safe to cache by any cache

// For frequently changing endpoints
Cache-Control: public, max-age=60, s-maxage=120
  - max-age: 1 minute (client cache)
  - s-maxage: 2 minutes (shared cache)

// For health checks
Cache-Control: public, max-age=30
  - max-age: 30 seconds
  - No shared cache

// For responses that must never be cached
Cache-Control: no-store
  - Proxy/browser must not cache
  - Examples: authentication, sensitive data

// For validation-based caching
Cache-Control: public, max-age=0, must-revalidate
  - Client must validate with server before reuse
  - Uses ETag/Last-Modified headers
```

**Headers:**
```
ETag: "{hash of response body}"
Last-Modified: "{ISO 8601 timestamp}"
Vary: Authorization, Accept-Encoding
```

**Invalidation Strategies:**

1. **TTL-based:** Remove after max-age expires
2. **Event-based:** Invalidate on mutation
3. **Manual:** Via cache invalidation endpoints (admin only)
4. **Validation:** Use ETags for conditional requests

---

### 4. MCP Server Client Cache

**Location:** In-memory cache in API client (per server instance)

**Purpose:** Reduce repeated API calls for project operations

**Cached Data:**
- Project details
- Phase information
- Issue lists
- Repository metadata

**Configuration:**
```typescript
- TTL: Inherited from API response headers (max-age)
- Strategy: Respect API Cache-Control headers
- Scope: Per API client instance
- Size: No hard limit (monitoring recommended)
```

**Invalidation:**
- Automatic on TTL expiry (from max-age)
- On explicit cache clear (rare)
- On API 304 Not Modified response

---

## Unified Cache Key Strategy

### Extension Cache Keys
```
ghProjects.cache.{owner}.{repo}
  Example: ghProjects.cache.anthropic.claude-projects

ghProjects.cache.meta.{owner}
  Example: ghProjects.cache.meta.anthropic (for org metadata)
```

### API Cache Keys
```
session:{sessionId}
  Example: session:abc123xyz

task:{taskId}
  Example: task:def456uvw

project:{projectId}
  Example: project:ghi789rst
```

### MCP Client Cache Keys
```
projects:{owner}:{repo}
  Example: projects:anthropic:claude-projects

issues:{projectId}
  Example: issues:GH_PROJECT_ID_123
```

---

## Cache Invalidation Matrix

| Component | Operation | Trigger | TTL Reset |
|-----------|-----------|---------|-----------|
| Extension | Create/Update/Delete Project | Mutation event | Immediate |
| Extension | Create/Update/Delete Task | Mutation event | Immediate |
| API | Create/Update/Delete Task | Endpoint POST/PATCH/DELETE | N/A (no cache) |
| API | Get Task | Response headers | max-age (usually 5m) |
| MCP | GitHub API mutations | Mutation tool called | Clear local instance cache |
| MCP | GitHub API reads | Response headers | max-age (usually 5m) |

---

## HTTP Cache Headers Configuration

### API Middleware (Global)

```typescript
// Apply to all responses via interceptor
app.use((req: Request, res: Response, next: NextFunction) => {
  // Default: no cache for safety
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Cache-Strategy', 'bypassed');
  next();
});
```

### Per-Endpoint Configuration

**Health Checks:**
```typescript
@Get('health')
async check() {
  // Responses can be cached for 30 seconds
  // Suitable for monitoring/liveness probes
  return this.healthService.check();
}
// Header: Cache-Control: public, max-age=30
```

**Session Data:**
```typescript
@Get('sessions/:id')
async getSession(@Param('id') id: string) {
  // Session state rarely changes during active use
  // Cache for 1 minute, but require revalidation
  return this.sessionsService.get(id);
}
// Header: Cache-Control: public, max-age=60, must-revalidate
// Include: ETag, Last-Modified
```

**Task Data:**
```typescript
@Get('tasks/:id')
async getTask(@Param('id') id: string) {
  // Task details can be cached safely
  // Cache for 5 minutes with revalidation
  return this.tasksService.get(id);
}
// Header: Cache-Control: public, max-age=300, must-revalidate
// Include: ETag, Last-Modified
```

**Mutations:**
```typescript
@Post('tasks')
@Patch('tasks/:id')
@Delete('tasks/:id')
async mutateTask(...) {
  // Mutation responses must never be cached
  // Always fresh to reflect changes
  return this.tasksService.mutate(...);
}
// Header: Cache-Control: no-store
// Header: Pragma: no-cache
```

---

## ETag Implementation

### ETag Generation

```typescript
// For responses that support caching
private generateETag(data: any): string {
  const json = JSON.stringify(data);
  const hash = crypto
    .createHash('md5')
    .update(json)
    .digest('hex');
  return `"${hash}"`;
}
```

### ETag Validation

```typescript
@Get('tasks/:id')
async getTask(
  @Req() req: Request,
  @Param('id') id: string
) {
  const task = await this.tasksService.get(id);
  const etag = this.generateETag(task);

  // Check If-None-Match header
  if (req.headers['if-none-match'] === etag) {
    return new HttpException('Not Modified', HttpStatus.NOT_MODIFIED);
  }

  // Return with ETag header
  const response = this.taskToDTO(task);
  res.setHeader('ETag', etag);
  return response;
}
```

---

## Cache Monitoring & Metrics

### Metrics to Track

1. **Cache Hit Rate**
   - Extension: Percentage of requests served from cache
   - API: Percentage of 304 responses vs 200
   - MCP: Client-side cache effectiveness

2. **Cache Size**
   - Extension: Workspace state size
   - API: Token cache memory usage
   - MCP: Client cache instance size

3. **Stale Data Events**
   - Times cache expired before invalidation
   - Times 304 Not Modified was received
   - Times manual invalidation occurred

4. **TTL Effectiveness**
   - Average time data in cache before expiry
   - Average time data in cache before invalidation
   - Cache misses due to TTL expiry

### Logging

```typescript
// Cache hit
[CacheManager] Cache hit: ghProjects.cache.anthropic.claude-projects (age: 45s)

// Cache miss
[CacheManager] Cache miss: ghProjects.cache.anthropic.claude-projects

// Cache invalidation
[CacheManager] Cache invalidated: ghProjects.cache.anthropic.claude-projects (reason: mutation)

// ETag validation
[APIClient] Validation hit: tasks/abc123 (304 Not Modified)

// Token cache
[GitHubAuthService] Token cached (source: vscode, scopes: [repo, read:org], ttl: 5m)
```

---

## Implementation Checklist

### VSCode Extension
- [x] CacheManager with TTL support
- [ ] Add cache invalidation on mutations
- [ ] Add cache age display in UI
- [ ] Add manual cache clear button
- [ ] Monitor cache hits/misses

### API (State Tracking)
- [x] Rate limiting (ThrottlerModule)
- [ ] Add cache headers interceptor
- [ ] Add ETag generation utility
- [ ] Add ETag validation logic
- [ ] Add cache metrics tracking
- [ ] Document per-endpoint cache behavior

### MCP Server
- [ ] Respect API cache headers
- [ ] Implement client-side cache
- [ ] Add cache invalidation on mutations
- [ ] Log cache effectiveness metrics

---

## Best Practices

### For Extension Developers

1. **Always check cache before API calls**
   ```typescript
   const cached = await cacheManager.loadCache(owner, repo);
   if (cached && !cacheManager.isCacheStale(cached)) {
     return cached;
   }
   ```

2. **Invalidate cache on mutations**
   ```typescript
   await updateProject(...);
   await cacheManager.clearCache(owner, repo);
   ```

3. **Show cache status in UI**
   ```
   "Using cached data (last updated 2m ago)" // if stale
   "Fresh data" // if within TTL
   ```

### For API Developers

1. **Always set appropriate Cache-Control headers**
   - Safe reads: `max-age=300`
   - Mutations: `no-store`

2. **Validate data freshness with ETags**
   ```typescript
   const etag = this.generateETag(data);
   res.setHeader('ETag', etag);
   ```

3. **Log cache decisions**
   ```typescript
   logger.debug('Cache decision', {
     endpoint: '/tasks/123',
     decision: 'CACHE_HIT|CACHE_MISS|VALIDATION',
     etag,
   });
   ```

### For MCP Server Developers

1. **Respect API cache headers**
   ```typescript
   const cacheControl = response.headers.get('Cache-Control');
   const maxAge = this.parseMaxAge(cacheControl);
   ```

2. **Implement TTL-based expiry**
   ```typescript
   if (Date.now() - cachedAt > maxAge * 1000) {
     cache.delete(key);
   }
   ```

3. **Handle 304 responses gracefully**
   ```typescript
   if (response.status === 304) {
     return cache.get(key);
   }
   ```

---

## Testing

### Extension Tests
```typescript
describe('CacheManager', () => {
  it('should return cached data before expiry', async () => {
    await cache.saveCache(owner, repo, projects, [], []);
    const cached = await cache.loadCache(owner, repo);
    expect(cached).toBeDefined();
  });

  it('should invalidate expired cache', async () => {
    await cache.saveCache(owner, repo, projects, [], []);
    jest.useFakeTimers();
    jest.advanceTimersByTime(6 * 60 * 1000); // 6 minutes
    const cached = await cache.loadCache(owner, repo);
    expect(cached).toBeNull();
  });
});
```

### API Tests
```typescript
describe('Cache Headers', () => {
  it('should include Cache-Control headers on health endpoint', async () => {
    const response = await request(app.getHttpServer())
      .get('/health');
    expect(response.headers['cache-control']).toMatch(/max-age=\d+/);
  });

  it('should not cache mutation responses', async () => {
    const response = await request(app.getHttpServer())
      .post('/tasks')
      .send({ title: 'New task' });
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
```

---

## Troubleshooting

### Cache Not Invalidating
1. Check cache TTL hasn't expired
2. Verify mutation triggers invalidation
3. Check for multiple cache instances
4. Review logs for cache hits/misses

### Stale Data Issues
1. Reduce TTL if data changes frequently
2. Implement event-based invalidation
3. Use validation-based caching (ETags)
4. Monitor cache age metrics

### Cache Hitting Size Limits
1. Implement cache eviction policy (LRU)
2. Reduce TTL to clear stale entries sooner
3. Monitor cache size metrics
4. Consider distributed cache for API

---

## Future Enhancements

1. **Distributed Caching:** Redis for API caching across instances
2. **Cache Warming:** Pre-populate common queries
3. **Partial Invalidation:** Invalidate specific cache entries on mutations
4. **Adaptive TTL:** Adjust TTL based on update frequency
5. **Cache Compression:** Reduce workspaceState size with compression
6. **Cache Analytics:** Dashboard for cache hit rates and effectiveness

---

## References

- [HTTP Caching Spec (RFC 9111)](https://tools.ietf.org/html/rfc9111)
- [ETag Best Practices](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag)
- [Cache-Control Directives](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control)
- [NestJS Caching](https://docs.nestjs.com/techniques/caching)
