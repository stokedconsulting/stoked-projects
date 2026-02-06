# System Architecture

This document provides a comprehensive overview of the Claude Projects system architecture, focusing on the unified GitHub CLI service layer introduced in Project #77.

## Table of Contents

- [Overview](#overview)
- [Architecture Principles](#architecture-principles)
- [Component Architecture](#component-architecture)
- [Unified Service Layer](#unified-service-layer)
- [Data Flow](#data-flow)
- [Authentication & Authorization](#authentication--authorization)
- [Caching Strategy](#caching-strategy)
- [Error Handling](#error-handling)
- [Monitoring & Observability](#monitoring--observability)
- [Design Decisions](#design-decisions)

## Overview

The Claude Projects system is a distributed application for managing GitHub Projects with Claude AI integration. The system consists of three main components:

1. **VSCode Extension** - User interface and GitHub integration
2. **State Tracking API** - Centralized state management and GitHub operations
3. **MCP Server** - Model Context Protocol server for Claude AI integration

### System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         GitHub API                              │
│                   (Source of Truth)                             │
└─────────────────────────────────────────────────────────────────┘
                              ↕
                    (GraphQL & REST API)
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│              Unified GitHub Service Layer                        │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ GitHub Auth      │  │ Projects Service │  │ Issues       │  │
│  │ Service          │→ │                  │  │ Service      │  │
│  │                  │  │                  │  │              │  │
│  │ - Token Mgmt     │  │ - CRUD Ops       │  │ - CRUD Ops   │  │
│  │ - Multi-source   │  │ - GraphQL        │  │ - GraphQL    │  │
│  │ - Validation     │  │ - REST API       │  │ - REST API   │  │
│  │ - Caching        │  │                  │  │              │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ Rate Limiting    │  │ Error Handling   │  │ Logging      │  │
│  │ Service          │  │ & Recovery       │  │ & Metrics    │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         ↕                      ↕                      ↕
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ VSCode Extension │  │ State Tracking   │  │ MCP Server       │
│                  │  │ API              │  │                  │
│ - UI/UX          │  │                  │  │ - Claude AI      │
│ - File Watching  │  │ - HTTP Endpoints │  │   Integration    │
│ - Cache (5min)   │  │ - State Mgmt     │  │ - Tool Protocols │
│                  │  │ - MongoDB        │  │ - JSON Schemas   │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

## Architecture Principles

### 1. Separation of Concerns

Each component has a clearly defined responsibility:

- **VSCode Extension**: User interface, file system integration, workspace management
- **State Tracking API**: Business logic, data persistence, GitHub operations
- **MCP Server**: AI integration, tool protocols, structured communication with Claude

### 2. Single Source of Truth

- **GitHub Projects** is the authoritative source for project data
- All components sync state from GitHub, not from each other
- Local caches are invalidated and refreshed from GitHub API

### 3. Fail-Safe Design

- Components can operate independently if others fail
- Graceful degradation when services are unavailable
- Cache serves stale data when API is unreachable

### 4. Centralized GitHub CLI Access

- **All GitHub API calls** go through the unified service layer
- No direct `gh` CLI or Octokit calls in client components
- Consistent error handling, rate limiting, and logging

### 5. Layered Caching

Multiple cache layers optimize performance:

- **L1**: VSCode extension workspace cache (5-minute TTL)
- **L2**: State Tracking API in-memory cache (5-minute TTL)
- **L3**: MongoDB for persistent state

## Component Architecture

### VSCode Extension (`apps/code-ext`)

**Technology Stack:**
- TypeScript 5.x
- VSCode Extension API 1.96+
- Webpack 5 for bundling
- Webview UI (vanilla JS + CSS)

**Key Modules:**

```
apps/code-ext/src/
├── extension.ts                    # Extension entry point
├── projects-view-provider.ts       # Main controller
├── github-api.ts                   # GitHub API client (deprecated)
├── http-client.ts                  # HTTP client for API calls (new)
├── cache-manager.ts                # Workspace-scoped caching
├── claude-monitor.ts               # File-based IPC for Claude sessions
├── github-project-creator.ts       # Project creation wizard
├── phase-logic.ts                  # Phase-based organization logic
└── notifications/
    └── websocket-client.ts         # WebSocket for real-time updates
```

**Responsibilities:**
- Render project list UI in webview
- Manage workspace cache (5-minute TTL)
- Monitor `.claude-sessions/` for file-based IPC
- Provide user actions (link/unlink, mark done, create project)
- Authenticate with GitHub via VSCode auth provider

**Migration Status:**
- Migrating from direct `github-api.ts` calls to `http-client.ts`
- Phase 1: HTTP endpoints implemented in State Tracking API
- Phase 2: Extension updated to use HTTP endpoints (Work Item 4.1)

### State Tracking API (`packages/api`)

**Technology Stack:**
- NestJS 10.x
- MongoDB with Mongoose
- TypeScript 5.x
- Octokit for GitHub API
- AWS Lambda (serverless deployment)

**Key Modules:**

```
packages/api/src/
├── github/                          # Unified GitHub Service Layer
│   ├── auth/
│   │   ├── github-auth.service.ts   # Token management & validation
│   │   ├── strategies/              # Token source strategies
│   │   │   ├── vscode-token.strategy.ts
│   │   │   ├── config-token.strategy.ts
│   │   │   └── env-token.strategy.ts
│   │   └── errors/                  # Auth-specific errors
│   ├── projects/
│   │   └── projects.service.ts      # Projects CRUD operations
│   ├── issues/
│   │   └── issues.service.ts        # Issues CRUD operations
│   └── queue/
│       └── rate-limit.service.ts    # Rate limiting & request queue
├── modules/
│   ├── sessions/                    # Session state tracking
│   ├── tasks/                       # Task monitoring
│   ├── machines/                    # Machine/slot management
│   └── health/                      # Health checks & heartbeat
├── common/
│   ├── logging/                     # Structured logging
│   ├── metrics/                     # Performance metrics
│   ├── errors/                      # Global error handling
│   └── filters/                     # Exception filters
└── config/                          # Configuration management
```

**Responsibilities:**
- Provide HTTP endpoints for GitHub operations
- Manage GitHub authentication tokens from multiple sources
- Implement rate limiting and request queuing
- Track Claude AI session state
- Persist state in MongoDB
- Generate structured logs and metrics

### MCP Server (`packages/mcp-server`)

**Technology Stack:**
- Model Context Protocol SDK
- TypeScript 5.x
- Zod for JSON schema validation
- Node.js 18+

**Key Features:**
- Implements MCP tool protocol for Claude AI
- Provides structured tools for GitHub operations
- JSON schema validation for all inputs/outputs
- Delegates to State Tracking API for execution

**Tools Provided:**
- `github_projects_list` - List repository/org projects
- `github_project_items_list` - Get project items
- `github_issue_close` - Close an issue
- `github_project_item_update` - Update project item status
- (Additional tools as needed)

## Unified Service Layer

### Architecture Overview

The unified GitHub service layer centralizes all GitHub API access through the State Tracking API, eliminating direct `gh` CLI calls and providing:

1. **Consistent authentication** across all components
2. **Centralized rate limiting** to prevent API quota exhaustion
3. **Unified error handling** with structured error responses
4. **Comprehensive logging** for debugging and monitoring
5. **Request queuing** for burst protection

### GitHub Auth Service

**Token Source Strategies (Priority Order):**

1. **VSCode Token** - From VSCode authentication provider (preferred)
2. **Config Token** - From application configuration
3. **Environment Token** - From `GITHUB_TOKEN` environment variable

**Token Caching:**
- Tokens cached for 5 minutes to reduce validation calls
- Automatic scope validation before use
- Automatic refresh on expiration

**Error Handling:**
- `TokenNotFoundError` - No valid token from any source
- `InsufficientScopesError` - Token lacks required scopes
- `TokenExpiredError` - Token expired and cannot refresh
- `TokenValidationError` - Token validation failed

**Example Usage:**

```typescript
// In any service
constructor(private readonly githubAuth: GitHubAuthService) {}

async someMethod() {
  // Get token with required scopes
  const tokenMetadata = await this.githubAuth.getToken([
    'repo',
    'read:project',
    'project'
  ]);

  // Use token for API calls
  const octokit = new Octokit({ auth: tokenMetadata.token });
}
```

### Projects Service

**Key Methods:**

- `getLinkedProjects(owner, repo)` - Get projects linked to repository
- `getOrganizationProjects(owner)` - Get all organization projects
- `getProjectItems(projectId)` - Get items in a project
- `linkProjectToRepository(projectId, repositoryId)` - Link project to repo
- `unlinkProjectFromRepository(projectId, repositoryId)` - Unlink project
- `updateProjectItemStatus(itemId, fieldId, optionId)` - Update item status

**GraphQL Query Strategy:**
- Uses GitHub GraphQL API v4 for complex queries
- Falls back to REST API for simple operations
- Implements cursor-based pagination
- Handles rate limiting and retries

### Issues Service

**Key Methods:**

- `closeIssue(owner, repo, issueNumber)` - Close an issue
- `getIssue(owner, repo, issueNumber)` - Get issue details
- `updateIssueStatus(owner, repo, issueNumber, status)` - Update issue
- `addIssueComment(owner, repo, issueNumber, body)` - Add comment

### Rate Limit Service

**Features:**
- Token bucket algorithm for rate limiting
- Per-endpoint rate limits
- Automatic request queuing
- Rate limit monitoring and alerts

**Configuration:**

```typescript
// Default limits (per hour)
GITHUB_API_RATE_LIMIT: 5000
GITHUB_GRAPHQL_RATE_LIMIT: 5000
BURST_CAPACITY: 100
```

## Data Flow

### Project List Refresh Flow

```
1. User opens VSCode Extension
   ↓
2. Extension checks workspace cache
   ↓
3. Cache miss → Extension calls State Tracking API
   GET /api/github/projects?owner=foo&repo=bar
   ↓
4. API calls GitHub Auth Service for token
   ↓
5. GitHub Auth Service checks token cache
   ↓
6. Token cache hit → return cached token
   ↓
7. Projects Service calls GitHub GraphQL API
   ↓
8. API returns projects to Extension
   ↓
9. Extension caches response (5-minute TTL)
   ↓
10. Extension renders projects in webview
```

### Issue Close Flow

```
1. User clicks "Mark as Done" in Extension
   ↓
2. Extension calls State Tracking API
   POST /api/github/issues/close
   { owner, repo, issueNumber }
   ↓
3. API validates request and checks rate limits
   ↓
4. Issues Service gets token from Auth Service
   ↓
5. Issues Service calls GitHub GraphQL API
   mutation { closeIssue(...) }
   ↓
6. GitHub closes issue and returns confirmation
   ↓
7. API returns success to Extension
   ↓
8. Extension clears cache
   ↓
9. Extension writes signal file for Claude monitor
   .claude-sessions/{session_id}.signal
   ↓
10. Extension refreshes project list
```

### Claude AI Integration Flow

```
1. Claude Code executes task
   ↓
2. Claude calls MCP tool via MCP Server
   github_issue_close { owner, repo, issueNumber }
   ↓
3. MCP Server validates input with JSON schema
   ↓
4. MCP Server calls State Tracking API
   POST /api/github/issues/close
   ↓
5. API processes request (same as above)
   ↓
6. API returns result to MCP Server
   ↓
7. MCP Server returns structured response to Claude
   ↓
8. Claude updates context and continues
```

## Authentication & Authorization

### GitHub Authentication

**VSCode Extension:**
- Uses VSCode built-in GitHub auth provider
- Scopes: `repo`, `read:org`, `read:project`, `project`
- Token stored securely by VSCode
- Automatic refresh via VSCode

**State Tracking API:**
- Accepts tokens from multiple sources (VSCode, config, env)
- Validates token scopes before use
- Caches validated tokens (5-minute TTL)
- Logs token source for debugging

### API Authentication

**State Tracking API Endpoints:**
- API key authentication via `X-API-Key` header
- Keys stored in environment variables
- Rate limiting per API key
- Request logging with key ID

**MCP Server:**
- No direct authentication (runs locally)
- Delegates to State Tracking API
- Uses API key from environment

## Caching Strategy

### Multi-Layer Caching

**Layer 1: VSCode Extension Workspace Cache**
- Location: VSCode `workspaceState` API
- TTL: 5 minutes
- Scope: Per workspace
- Storage: `~/Library/Application Support/Code/User/workspaceStorage/`
- Key format: `ghProjects.cache.{owner}.{repo}`

**Layer 2: State Tracking API In-Memory Cache**
- Location: NestJS in-memory cache
- TTL: 5 minutes
- Scope: Global across all requests
- Invalidation: Manual or TTL expiry

**Layer 3: MongoDB Persistent Storage**
- Location: MongoDB Atlas
- TTL: No expiration (manual cleanup)
- Scope: Global across all instances
- Purpose: Session state, not GitHub data

### Cache Invalidation Strategy

**Automatic Invalidation:**
- TTL expiry (5 minutes)
- Mutation operations (create, update, delete)
- Error responses from GitHub API

**Manual Invalidation:**
- User clicks "Refresh" in Extension
- Extension receives signal file update
- API `/cache/clear` endpoint

**Cache Versioning:**
- Each cache entry includes version number
- Version mismatch triggers invalidation
- Prevents serving outdated data structures

### Stale-While-Revalidate

When cache expires:
1. Serve stale data immediately
2. Fetch fresh data in background
3. Update cache with fresh data
4. Notify UI of update (optional)

## Error Handling

### Error Classification

**User Errors (4xx):**
- `400 Bad Request` - Invalid input parameters
- `401 Unauthorized` - Missing or invalid API key
- `403 Forbidden` - Insufficient GitHub permissions
- `404 Not Found` - Resource doesn't exist

**System Errors (5xx):**
- `500 Internal Server Error` - Unexpected server error
- `502 Bad Gateway` - GitHub API error
- `503 Service Unavailable` - Service temporarily down
- `504 Gateway Timeout` - GitHub API timeout

### Error Response Format

```json
{
  "error": {
    "code": "INSUFFICIENT_SCOPES",
    "message": "GitHub token lacks required scopes: project, read:project",
    "details": {
      "requiredScopes": ["project", "read:project"],
      "actualScopes": ["repo", "read:org"]
    },
    "timestamp": "2026-01-24T10:30:00Z",
    "requestId": "req_abc123"
  }
}
```

### Recovery Strategies

**Token Errors:**
- Automatic retry with different token source
- Fallback to environment token
- User notification to re-authenticate

**Rate Limit Errors:**
- Automatic request queuing
- Exponential backoff
- Retry after rate limit reset

**Network Errors:**
- Automatic retry with exponential backoff
- Max 3 retries
- Serve stale cache on failure

## Monitoring & Observability

### Structured Logging

**Log Levels:**
- `ERROR` - Errors requiring attention
- `WARN` - Potential issues
- `INFO` - Important state changes
- `DEBUG` - Detailed debugging info
- `TRACE` - Very detailed debugging (development only)

**Log Format (JSON):**

```json
{
  "timestamp": "2026-01-24T10:30:00Z",
  "level": "INFO",
  "context": "ProjectsService",
  "message": "Fetched projects successfully",
  "metadata": {
    "owner": "myorg",
    "repo": "myrepo",
    "projectCount": 5,
    "duration": 234,
    "requestId": "req_abc123"
  }
}
```

### Metrics Collection

**Key Metrics:**
- API request rate (requests/second)
- API response time (p50, p95, p99)
- GitHub API quota usage
- Cache hit rate
- Error rate by type

**Metrics Storage:**
- CloudWatch Metrics (AWS deployment)
- Local metrics endpoint `/metrics` (Prometheus format)

### Health Checks

**Endpoints:**
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed component health
- `GET /health/ready` - Readiness probe for Kubernetes

**Health Check Components:**
- GitHub API connectivity
- MongoDB connectivity
- Token validity
- Rate limit status

## Design Decisions

### Why Unified Service Layer?

**Problem:**
- Multiple components making direct `gh` CLI calls
- Inconsistent error handling across components
- Difficult to implement rate limiting
- Hard to debug and monitor API usage
- No centralized token management

**Solution:**
- Centralize all GitHub API access in State Tracking API
- Unified authentication, error handling, and logging
- Single point for rate limiting and monitoring
- Clear separation of concerns

**Benefits:**
- Easier to maintain and debug
- Consistent behavior across components
- Better performance via caching
- Scalable architecture

### Why Three Components?

**VSCode Extension:**
- Provides user interface
- Runs in user's VSCode instance
- Has access to workspace and file system
- Can use VSCode authentication

**State Tracking API:**
- Centralized business logic
- Scalable backend service
- Persistent state storage
- Independent of VSCode

**MCP Server:**
- Claude AI integration
- Structured tool protocol
- JSON schema validation
- Runs in Claude's environment

### Why File-Based IPC?

**Alternatives Considered:**
- WebSocket connections
- HTTP polling
- VSCode extension messaging

**Decision: File-based signal files**

**Rationale:**
- Simple and robust
- No network dependencies
- Works with VSCode file watchers
- Easy to debug (files are visible)
- No persistent connections to manage

**Trade-offs:**
- Slightly higher latency (file system)
- Requires file system access
- Not suitable for high-frequency updates

### Why MongoDB for State Storage?

**Alternatives Considered:**
- PostgreSQL (relational)
- Redis (in-memory)
- DynamoDB (AWS)

**Decision: MongoDB**

**Rationale:**
- Flexible schema for session state
- Good performance for document queries
- Mature NestJS integration
- Easy to deploy on Atlas

**Trade-offs:**
- No strong transactional guarantees
- Eventual consistency
- Requires schema validation in code

### Why 5-Minute Cache TTL?

**Analysis:**
- Project data changes infrequently (minutes to hours)
- GitHub API has rate limits (5000/hour)
- Users expect reasonably fresh data

**Decision: 5 minutes**

**Rationale:**
- Balance between freshness and API quota usage
- Allows ~600 cache refreshes per hour per user
- Stale-while-revalidate minimizes perceived latency
- Manual refresh available for immediate updates

### Why NestJS for API?

**Alternatives Considered:**
- Express.js (lightweight)
- Fastify (high performance)
- Hono (edge-first)

**Decision: NestJS**

**Rationale:**
- Built-in dependency injection
- Decorator-based architecture
- First-class TypeScript support
- Rich ecosystem (Mongoose, Auth, etc.)
- Easy to test

**Trade-offs:**
- Higher learning curve
- More boilerplate code
- Slightly larger bundle size

## Future Considerations

### Planned Enhancements

1. **WebSocket Integration** - Real-time updates instead of file-based IPC
2. **GraphQL API** - Unified GraphQL endpoint for all operations
3. **Offline Mode** - Full offline support with sync on reconnect
4. **Multi-Region Deployment** - Deploy API to multiple regions
5. **Advanced Caching** - Redis cache layer for shared state
6. **Event Sourcing** - Track all state changes for audit trail

### Scalability Considerations

**Current Limits:**
- Single MongoDB instance (Atlas shared cluster)
- Single API instance (AWS Lambda)
- No CDN for static assets

**Scaling Plan:**
- MongoDB Atlas auto-scaling
- API auto-scaling via AWS Lambda
- CloudFront CDN for static content
- Read replicas for heavy read workloads

### Security Enhancements

**Planned:**
- Token encryption at rest
- API key rotation
- Rate limiting per user/org
- Audit logging for sensitive operations
- OWASP security headers

## Conclusion

The unified GitHub service layer provides a robust, scalable architecture for managing GitHub Projects with Claude AI integration. By centralizing GitHub API access, we achieve:

- **Reliability** - Consistent error handling and recovery
- **Performance** - Multi-layer caching and rate limiting
- **Maintainability** - Clear separation of concerns
- **Observability** - Comprehensive logging and metrics
- **Scalability** - Stateless services ready for horizontal scaling

For more information, see:
- [Developer Guide](./DEVELOPER_GUIDE.md)
- [Migration Guide](./MIGRATION_GUIDE.md)
- [API Reference](./api-reference.md)
- [Deployment Guide](./DEPLOYMENT.md)
