# Migration Guide: From gh CLI to Unified Service Layer

This guide helps you migrate from direct `gh` CLI calls to the unified GitHub service layer provided by the State Tracking API.

## Table of Contents

- [Overview](#overview)
- [Why Migrate?](#why-migrate)
- [Migration Strategy](#migration-strategy)
- [Step-by-Step Migration](#step-by-step-migration)
- [Code Examples](#code-examples)
- [Testing Migration](#testing-migration)
- [Rollback Plan](#rollback-plan)
- [FAQ](#faq)

## Overview

**Project #77** introduces a unified GitHub service layer that centralizes all GitHub API access through the State Tracking API. This replaces direct `gh` CLI calls and provides:

- Unified authentication
- Centralized rate limiting
- Consistent error handling
- Better performance via caching
- Comprehensive logging

### Migration Timeline

- **Phase 1 (Work Items 1.x-2.x)**: State Tracking API implementation ✅
- **Phase 2 (Work Items 3.x-4.x)**: MCP server and extension migration ✅
- **Phase 3 (Work Item 5.3)**: Documentation and final cleanup 🔄

## Why Migrate?

### Problems with Direct gh CLI Calls

**1. Inconsistent Error Handling**
```bash
# Different components handle gh errors differently
gh project list || echo "Failed"  # Component A
gh project list 2>&1 | grep -q "error" && exit 1  # Component B
```

**2. No Rate Limiting**
```bash
# Each component can exhaust API quota independently
for i in {1..100}; do
  gh project list  # 100 API calls, no throttling
done
```

**3. Authentication Complexity**
```bash
# Each component manages GitHub authentication separately
gh auth status || gh auth login
export GITHUB_TOKEN=$(gh auth token)
```

**4. Difficult to Test**
```bash
# Hard to mock gh CLI in tests
# Requires installing gh CLI in CI/CD
# Brittle integration tests
```

### Benefits of Unified Service Layer

**1. Centralized Authentication**
```typescript
// Single authentication service handles all tokens
const token = await githubAuth.getToken(['repo', 'project']);
// Automatic caching, validation, and refresh
```

**2. Automatic Rate Limiting**
```typescript
// Built-in rate limiting prevents quota exhaustion
await rateLimitService.throttle(() =>
  projectsService.getProjects(owner, repo)
);
```

**3. Consistent Error Handling**
```typescript
// Standardized error types and responses
try {
  await projectsService.getProjects(owner, repo);
} catch (error) {
  if (error instanceof InsufficientScopesError) {
    // Handle missing scopes
  }
}
```

**4. Better Performance**
```typescript
// Multi-layer caching reduces API calls
const projects = await projectsService.getLinkedProjects(owner, repo);
// Cached for 5 minutes, no redundant API calls
```

## Migration Strategy

### Phased Approach

**Phase 1: Add HTTP Client (Parallel)**
- Keep existing `gh` CLI code
- Add new HTTP client for API calls
- Run both in parallel for validation

**Phase 2: Migrate Endpoints (Incremental)**
- Migrate one endpoint at a time
- Test thoroughly before next endpoint
- Monitor for regressions

**Phase 3: Deprecate gh CLI (Final)**
- Remove all `gh` CLI dependencies
- Update documentation
- Clean up legacy code

### Risk Mitigation

**1. Feature Flags**
```typescript
// Toggle between old and new implementation
if (config.useUnifiedService) {
  return await httpClient.getProjects(owner, repo);
} else {
  return await ghCLI.getProjects(owner, repo);
}
```

**2. Shadow Mode**
```typescript
// Run both, compare results, use old implementation
const ghResult = await ghCLI.getProjects(owner, repo);
const apiResult = await httpClient.getProjects(owner, repo);

if (!isEqual(ghResult, apiResult)) {
  logger.warn('Results differ', { ghResult, apiResult });
}

return ghResult; // Use old implementation while validating
```

**3. Gradual Rollout**
- Start with read-only operations
- Then migrate write operations
- Finally migrate critical operations

## Step-by-Step Migration

### Step 1: Set Up State Tracking API

**1.1 Install and Configure:**

```bash
cd packages/api

# Install dependencies
pnpm install

# Configure environment variables
cp .env.example .env

# Edit .env
# Required:
# - GITHUB_TOKEN
# - MONGODB_URI
# - API_KEY
```

**1.2 Start API:**

```bash
# Development mode
pnpm run start:dev

# Verify API is running
curl http://localhost:3000/health
```

**1.3 Test API Endpoints:**

```bash
# Test authentication
curl -H "X-API-Key: your_api_key" \
  http://localhost:3000/api/github/health

# Test projects endpoint
curl -H "X-API-Key: your_api_key" \
  "http://localhost:3000/api/github/projects?owner=myorg&repo=myrepo"
```

### Step 2: Add HTTP Client to Your Component

**2.1 Install Dependencies:**

```bash
# If in VSCode extension
cd apps/code-ext
pnpm add node-fetch

# If in separate component
pnpm add node-fetch
```

**2.2 Create HTTP Client:**

```typescript
// http-client.ts
import fetch from 'node-fetch';

export class GitHubHTTPClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl = 'http://localhost:3000', apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private async fetch(path: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'API request failed');
    }

    return response;
  }

  async getLinkedProjects(owner: string, repo: string) {
    const response = await this.fetch(
      `/api/github/projects?owner=${owner}&repo=${repo}`
    );
    return response.json();
  }

  async closeIssue(owner: string, repo: string, issueNumber: number) {
    const response = await this.fetch('/api/github/issues/close', {
      method: 'POST',
      body: JSON.stringify({ owner, repo, issueNumber }),
    });
    return response.json();
  }
}
```

**2.3 Use HTTP Client:**

```typescript
// Before (gh CLI)
import { exec } from 'child_process';

async function getProjects(owner: string, repo: string) {
  const cmd = `gh project list --owner ${owner} --repo ${repo} --format json`;
  const result = await execAsync(cmd);
  return JSON.parse(result.stdout);
}

// After (Unified Service)
import { GitHubHTTPClient } from './http-client';

async function getProjects(owner: string, repo: string) {
  const client = new GitHubHTTPClient(
    process.env.API_URL,
    process.env.API_KEY
  );
  return client.getLinkedProjects(owner, repo);
}
```

### Step 3: Migrate Shell Scripts

**3.1 Before (Direct gh CLI):**

```bash
#!/bin/bash
# update-project.sh

OWNER="$1"
REPO="$2"
ISSUE="$3"

# Close issue
gh issue close "$ISSUE" --repo "$OWNER/$REPO"

# Update project status
PROJECT_ID=$(gh project list --owner "$OWNER" --format json | jq -r '.[0].id')
ITEM_ID=$(gh project item-list "$PROJECT_ID" --format json | jq -r ".[] | select(.content.number == $ISSUE) | .id")

gh project item-edit "$ITEM_ID" --field-id "Status" --project-id "$PROJECT_ID" --text "Done"
```

**3.2 After (API Client):**

```bash
#!/bin/bash
# update-project.sh

OWNER="$1"
REPO="$2"
ISSUE="$3"

API_URL="${API_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-your_api_key}"

# Close issue via API
curl -X POST "$API_URL/api/github/issues/close" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"repo\":\"$REPO\",\"issueNumber\":$ISSUE}"

# Update project status via API
curl -X POST "$API_URL/api/github/projects/items/update-status" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"$OWNER\",\"repo\":\"$REPO\",\"issueNumber\":$ISSUE,\"status\":\"Done\"}"
```

**3.3 Or Use Node.js Script:**

```javascript
#!/usr/bin/env node
// update-project.js

const { GitHubHTTPClient } = require('./http-client');

async function main() {
  const [owner, repo, issueNumber] = process.argv.slice(2);

  const client = new GitHubHTTPClient(
    process.env.API_URL || 'http://localhost:3000',
    process.env.API_KEY
  );

  // Close issue
  await client.closeIssue(owner, repo, parseInt(issueNumber));

  // Update project status
  await client.updateIssueStatus(owner, repo, parseInt(issueNumber), 'Done');

  console.log(`Issue #${issueNumber} closed and marked as Done`);
}

main().catch(console.error);
```

### Step 4: Update VSCode Extension

**4.1 Replace github-api.ts with http-client.ts:**

```typescript
// Before: apps/code-ext/src/projects-view-provider.ts
import { GitHubAPI } from './github-api';

export class ProjectsViewProvider {
  private githubApi: GitHubAPI;

  constructor() {
    this.githubApi = new GitHubAPI();
  }

  async loadProjects() {
    const projects = await this.githubApi.getLinkedProjects(owner, repo);
    return projects;
  }
}

// After:
import { GitHubHTTPClient } from './http-client';

export class ProjectsViewProvider {
  private httpClient: GitHubHTTPClient;

  constructor() {
    this.httpClient = new GitHubHTTPClient(
      vscode.workspace.getConfiguration('claudeProjects').get('apiUrl'),
      vscode.workspace.getConfiguration('claudeProjects').get('apiKey')
    );
  }

  async loadProjects() {
    const projects = await this.httpClient.getLinkedProjects(owner, repo);
    return projects;
  }
}
```

**4.2 Update Configuration:**

```json
// package.json - Extension configuration
{
  "contributes": {
    "configuration": {
      "title": "Claude Projects",
      "properties": {
        "claudeProjects.apiUrl": {
          "type": "string",
          "default": "http://localhost:3000",
          "description": "State Tracking API URL"
        },
        "claudeProjects.apiKey": {
          "type": "string",
          "default": "",
          "description": "API Key for authentication"
        }
      }
    }
  }
}
```

### Step 5: Test Migration

**5.1 Unit Tests:**

```typescript
// http-client.spec.ts
import { GitHubHTTPClient } from './http-client';
import fetchMock from 'jest-fetch-mock';

describe('GitHubHTTPClient', () => {
  let client: GitHubHTTPClient;

  beforeEach(() => {
    fetchMock.resetMocks();
    client = new GitHubHTTPClient('http://localhost:3000', 'test-key');
  });

  it('should fetch projects', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({
      projects: [{ id: '1', title: 'Test Project' }]
    }));

    const result = await client.getLinkedProjects('owner', 'repo');

    expect(result.projects).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/github/projects?owner=owner&repo=repo',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-API-Key': 'test-key'
        })
      })
    );
  });

  it('should handle errors', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ message: 'Unauthorized' }),
      { status: 401 }
    );

    await expect(
      client.getLinkedProjects('owner', 'repo')
    ).rejects.toThrow('Unauthorized');
  });
});
```

**5.2 Integration Tests:**

```bash
# Start State Tracking API
cd packages/api
pnpm run start:dev &

# Run integration tests
cd tests
pnpm run test:integration
```

**5.3 Manual Testing:**

```bash
# Test extension with new API
# 1. Open VSCode
# 2. Load extension
# 3. Open Claude Projects panel
# 4. Verify projects load correctly
# 5. Try marking issue as done
# 6. Verify issue closes and project updates
```

## Code Examples

### Example 1: List Projects

**Before (gh CLI):**

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function listProjects(owner: string, repo: string) {
  try {
    const { stdout } = await execAsync(
      `gh project list --owner ${owner} --repo ${repo} --format json`
    );
    return JSON.parse(stdout);
  } catch (error) {
    console.error('Failed to list projects:', error);
    throw error;
  }
}
```

**After (Unified Service):**

```typescript
import { GitHubHTTPClient } from './http-client';

async function listProjects(owner: string, repo: string) {
  const client = new GitHubHTTPClient(
    process.env.API_URL,
    process.env.API_KEY
  );

  try {
    const { projects } = await client.getLinkedProjects(owner, repo);
    return projects;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      console.error('API key invalid or expired');
    } else if (error instanceof RateLimitError) {
      console.error('Rate limit exceeded, retry later');
    } else {
      console.error('Failed to list projects:', error);
    }
    throw error;
  }
}
```

### Example 2: Close Issue

**Before (gh CLI):**

```bash
#!/bin/bash

OWNER="$1"
REPO="$2"
ISSUE="$3"

gh issue close "$ISSUE" --repo "$OWNER/$REPO" || {
  echo "Failed to close issue"
  exit 1
}
```

**After (API Client):**

```typescript
import { GitHubHTTPClient } from './http-client';

async function closeIssue(owner: string, repo: string, issueNumber: number) {
  const client = new GitHubHTTPClient(
    process.env.API_URL,
    process.env.API_KEY
  );

  const result = await client.closeIssue(owner, repo, issueNumber);

  if (!result.success) {
    throw new Error('Failed to close issue');
  }

  return result;
}
```

### Example 3: Update Project Item

**Before (gh CLI):**

```bash
#!/bin/bash

PROJECT_ID="$1"
ITEM_ID="$2"
STATUS="$3"

gh project item-edit "$ITEM_ID" \
  --project-id "$PROJECT_ID" \
  --field-id "Status" \
  --text "$STATUS"
```

**After (API Client):**

```typescript
import { GitHubHTTPClient } from './http-client';

async function updateItemStatus(
  projectId: string,
  itemId: string,
  status: string
) {
  const client = new GitHubHTTPClient(
    process.env.API_URL,
    process.env.API_KEY
  );

  return client.updateProjectItemStatus(projectId, itemId, status);
}
```

## Testing Migration

### Testing Checklist

- [ ] API health check responds successfully
- [ ] Authentication works with API key
- [ ] Projects list returns expected data
- [ ] Project items list returns expected data
- [ ] Issue close updates GitHub correctly
- [ ] Project item status update works
- [ ] Error handling works for all endpoints
- [ ] Rate limiting prevents quota exhaustion
- [ ] Caching reduces redundant API calls
- [ ] Logs provide useful debugging information

### Performance Testing

**Before Migration:**

```bash
# Measure gh CLI performance
time gh project list --owner myorg --repo myrepo
# ~2-3 seconds per call, no caching
```

**After Migration:**

```bash
# Measure API performance
time curl -H "X-API-Key: $API_KEY" \
  "$API_URL/api/github/projects?owner=myorg&repo=myrepo"
# First call: ~2-3 seconds
# Subsequent calls (within 5 min): <100ms (cached)
```

### Load Testing

```bash
# Install k6
brew install k6

# Create load test script
cat > load-test.js <<EOF
import http from 'k6/http';
import { check } from 'k6';

export default function () {
  const res = http.get('http://localhost:3000/api/github/projects?owner=myorg&repo=myrepo', {
    headers: { 'X-API-Key': process.env.API_KEY }
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
}
EOF

# Run load test
k6 run --vus 10 --duration 30s load-test.js
```

## Rollback Plan

### If Migration Fails

**1. Revert Code Changes:**

```bash
# Revert to previous commit
git revert HEAD

# Or reset to specific commit
git reset --hard <commit-before-migration>
```

**2. Switch Back to gh CLI:**

```typescript
// Use feature flag to switch back
const USE_UNIFIED_SERVICE = false;

async function getProjects(owner: string, repo: string) {
  if (USE_UNIFIED_SERVICE) {
    return httpClient.getLinkedProjects(owner, repo);
  } else {
    return ghCLI.getProjects(owner, repo);
  }
}
```

**3. Disable API Endpoints:**

```typescript
// In State Tracking API
@Controller('api/github')
export class GitHubController {
  @Get('projects')
  async getProjects() {
    if (!config.ENABLE_UNIFIED_SERVICE) {
      throw new HttpException('Service disabled', HttpStatus.SERVICE_UNAVAILABLE);
    }
    // Implementation
  }
}
```

### Monitoring During Migration

**1. Track Error Rates:**

```typescript
// Log all errors during migration period
logger.error('API error during migration', {
  endpoint: '/api/github/projects',
  error: error.message,
  stack: error.stack,
  migrationPhase: 'testing',
});
```

**2. Compare Results:**

```typescript
// Run both old and new implementations, compare results
const ghResult = await ghCLI.getProjects(owner, repo);
const apiResult = await httpClient.getLinkedProjects(owner, repo);

if (!isEqual(ghResult, apiResult)) {
  logger.warn('Migration validation failed', {
    ghResult,
    apiResult,
    diff: diff(ghResult, apiResult),
  });
}
```

**3. Set Alerts:**

```bash
# Alert if error rate > 5%
# Alert if response time > 2 seconds
# Alert if rate limit exceeded
```

## FAQ

**Q: Do I need to migrate all at once?**

A: No. Migrate incrementally, one endpoint at a time. Use feature flags to control rollout.

**Q: What if the API is down?**

A: Extension can fall back to serving stale cache. Configure timeout and retry logic.

**Q: How do I handle authentication?**

A: API key is stored in VSCode settings. For local development, use `.env` file.

**Q: What about rate limiting?**

A: State Tracking API implements rate limiting automatically. You don't need to handle it in your code.

**Q: Can I still use gh CLI for some operations?**

A: Yes, but it's not recommended. Unified service provides better performance and reliability.

**Q: How do I debug API calls?**

A: Enable debug logging in extension settings and check Output panel (View → Output → Claude Projects).

**Q: What if I find a bug in the API?**

A: Report it in GitHub issues. Use feature flag to revert to gh CLI temporarily.

**Q: How do I test locally?**

A: Run State Tracking API locally (`pnpm run start:dev`) and point extension to `http://localhost:3000`.

**Q: What about CI/CD?**

A: Deploy State Tracking API first, then update extension to use new endpoints. Test in staging before production.

**Q: How do I migrate shell scripts?**

A: Replace `gh` CLI calls with `curl` to API endpoints, or rewrite in Node.js using HTTP client.

## Next Steps

1. Review [Architecture Documentation](./ARCHITECTURE.md)
2. Read [Developer Guide](./DEVELOPER_GUIDE.md)
3. Check [API Reference](./api-reference.md)
4. Review [Deployment Guide](./DEPLOYMENT.md)

For help, contact the team or file an issue on GitHub.
