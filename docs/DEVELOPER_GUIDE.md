# Developer Guide

Welcome to the Claude Projects development guide. This document will help you get started with development, understand the codebase structure, and follow best practices.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Environment](#development-environment)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Debugging](#debugging)
- [Common Tasks](#common-tasks)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 18+ (LTS recommended)
- **pnpm** 8+ (for monorepo management)
- **VSCode** 1.96+ (for extension development)
- **GitHub CLI** (`gh`) authenticated
- **Git** 2.30+
- **MongoDB** (local or Atlas account for API development)

### Initial Setup

1. **Clone the repository:**

```bash
git clone https://github.com/your-org/claude-projects.git
cd claude-projects
```

2. **Install dependencies:**

```bash
# Install pnpm if not already installed
npm install -g pnpm

# Install all dependencies (monorepo)
pnpm install
```

3. **Set up environment variables:**

```bash
# Copy example environment files
cp packages/api/.env.example packages/api/.env

# Edit .env with your configuration
# Required:
# - GITHUB_TOKEN (GitHub personal access token)
# - MONGODB_URI (MongoDB connection string)
# - API_KEY (API authentication key)
```

4. **Authenticate with GitHub CLI:**

```bash
gh auth login
# Follow prompts to authenticate
```

5. **Verify setup:**

```bash
# Check Node.js version
node --version  # Should be 18+

# Check pnpm version
pnpm --version  # Should be 8+

# Check GitHub CLI authentication
gh auth status

# Check MongoDB connection (if running locally)
mongosh --version
```

## Development Environment

### VSCode Setup

**Recommended Extensions:**

- **ESLint** (`dbaeumer.vscode-eslint`)
- **Prettier** (`esbenp.prettier-vscode`)
- **TypeScript + JavaScript** (built-in)
- **Jest Runner** (`firsttris.vscode-jest-runner`)
- **MongoDB for VS Code** (`mongodb.mongodb-vscode`)

**Workspace Settings:**

Create `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "files.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/.turbo": true
  }
}
```

### Editor Configuration

**ESLint Configuration** (`.eslintrc.js`):

```javascript
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist', 'node_modules'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
```

**Prettier Configuration** (`.prettierrc`):

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 80,
  "tabWidth": 2,
  "semi": true,
  "arrowParens": "always"
}
```

## Project Structure

### Monorepo Layout

```
claude-projects/
├── apps/
│   └── code-ext/                # VSCode Extension
│       ├── src/
│       │   ├── extension.ts     # Extension entry point
│       │   ├── projects-view-provider.ts
│       │   ├── github-api.ts    # GitHub API client (deprecated)
│       │   ├── http-client.ts   # HTTP client for API (new)
│       │   ├── cache-manager.ts
│       │   └── ...
│       ├── media/               # Webview assets
│       ├── commands/            # Claude commands
│       ├── package.json
│       └── webpack.config.js
│
├── packages/
│   ├── api/     # NestJS API
│   │   ├── src/
│   │   │   ├── github/          # Unified GitHub service layer
│   │   │   │   ├── auth/
│   │   │   │   ├── projects/
│   │   │   │   ├── issues/
│   │   │   │   └── queue/
│   │   │   ├── modules/         # Business logic modules
│   │   │   ├── common/          # Shared utilities
│   │   │   └── main.ts
│   │   ├── test/
│   │   ├── package.json
│   │   └── serverless.yml       # AWS deployment config
│   │
│   └── mcp-server/              # MCP Server
│       ├── src/
│       ├── package.json
│       └── README.md
│
├── examples/                    # Integration scripts
├── docs/                        # Documentation
├── tests/                       # Integration tests
├── pnpm-workspace.yaml         # Monorepo configuration
└── package.json                # Root package.json
```

### Component Responsibilities

**VSCode Extension (`apps/code-ext`):**
- User interface and interaction
- Workspace state management
- File system integration
- GitHub authentication (via VSCode)
- Local caching (5-minute TTL)

**State Tracking API (`packages/api`):**
- Business logic and data processing
- GitHub API integration (unified service layer)
- MongoDB persistence
- Session state management
- Rate limiting and error handling

**MCP Server (`packages/mcp-server`):**
- Claude AI integration
- MCP tool protocol implementation
- JSON schema validation
- Delegation to State Tracking API

## Development Workflow

### 1. VSCode Extension Development

**Build Extension:**

```bash
cd apps/code-ext

# Install dependencies
pnpm install

# Build extension
pnpm run build

# Watch mode (auto-rebuild on changes)
pnpm run watch
```

**Run Extension:**

1. Open `apps/code-ext` in VSCode
2. Press `F5` to launch Extension Development Host
3. A new VSCode window opens with extension loaded
4. Make changes and reload: `Cmd+R` (Mac) or `Ctrl+R` (Windows)

**Package Extension:**

```bash
cd apps/code-ext

# Create .vsix package
pnpm run package

# Install locally
code --install-extension claude-projects-*.vsix
```

**Debugging:**

- Set breakpoints in TypeScript files
- Use Debug Console for logging
- Open webview DevTools: `Cmd+Shift+P` → "Developer: Open Webview Developer Tools"

### 2. State Tracking API Development

**Run API Locally:**

```bash
cd packages/api

# Install dependencies
pnpm install

# Development mode (hot reload)
pnpm run start:dev

# Production build
pnpm run build

# Production mode
pnpm run start:prod
```

**Environment Variables:**

Create `packages/api/.env`:

```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017/claude-projects

# GitHub Authentication
GITHUB_TOKEN=ghp_your_personal_access_token

# API Authentication
API_KEY=your_secret_api_key

# Environment
NODE_ENV=development
PORT=3000

# Logging
LOG_LEVEL=debug
```

**Test API Endpoints:**

```bash
# Health check
curl http://localhost:3000/health

# Get projects (requires API key)
curl -H "X-API-Key: your_secret_api_key" \
  "http://localhost:3000/api/github/projects?owner=myorg&repo=myrepo"

# Close issue
curl -X POST http://localhost:3000/api/github/issues/close \
  -H "X-API-Key: your_secret_api_key" \
  -H "Content-Type: application/json" \
  -d '{"owner":"myorg","repo":"myrepo","issueNumber":123}'
```

### 3. MCP Server Development

**Run MCP Server:**

```bash
cd packages/mcp-server

# Install dependencies
pnpm install

# Development mode
pnpm run dev

# Build
pnpm run build

# Production mode
pnpm run start
```

**Test MCP Tools:**

```bash
# Test with MCP inspector (if available)
mcp-inspector packages/mcp-server/build/index.js

# Or use test script
node packages/mcp-server/test/manual-test.js
```

## Coding Standards

### TypeScript Guidelines

**1. Type Safety:**

```typescript
// Good: Explicit types
interface ProjectData {
  id: string;
  title: string;
  items: ProjectItem[];
}

async function getProject(id: string): Promise<ProjectData> {
  // Implementation
}

// Avoid: Implicit any
async function getProject(id) {  // Bad: id is any
  // Implementation
}
```

**2. Null Safety:**

```typescript
// Good: Handle nulls explicitly
const project = await getProject(id);
if (!project) {
  throw new Error('Project not found');
}

// Avoid: Assuming non-null
const title = project.title;  // Might throw if project is null
```

**3. Error Handling:**

```typescript
// Good: Specific error types
try {
  await githubAuth.getToken(['repo']);
} catch (error) {
  if (error instanceof TokenNotFoundError) {
    // Handle missing token
  } else if (error instanceof InsufficientScopesError) {
    // Handle insufficient scopes
  } else {
    throw error;
  }
}

// Avoid: Generic error handling
try {
  await githubAuth.getToken(['repo']);
} catch (error) {
  console.error(error);  // Too generic
}
```

### Code Organization

**1. Module Structure:**

```typescript
// module-name.service.ts

// Imports grouped by type
import { Injectable, Logger } from '@nestjs/common';  // Framework
import { Octokit } from '@octokit/rest';              // Third-party
import { GitHubAuthService } from '../auth';          // Local

// Interfaces/types first
export interface ServiceOptions {
  timeout?: number;
}

// Service class
@Injectable()
export class MyService {
  private readonly logger = new Logger(MyService.name);

  constructor(private readonly authService: GitHubAuthService) {}

  // Public methods first
  async publicMethod(): Promise<void> {
    // Implementation
  }

  // Private methods last
  private privateHelper(): void {
    // Implementation
  }
}
```

**2. File Naming:**

- Services: `*.service.ts`
- Controllers: `*.controller.ts`
- DTOs: `*.dto.ts`
- Interfaces: `*.interface.ts`
- Types: `*.types.ts`
- Tests: `*.spec.ts`

**3. Directory Structure:**

```
module-name/
├── module-name.module.ts       # Module definition
├── module-name.service.ts      # Business logic
├── module-name.controller.ts   # HTTP endpoints
├── dto/                        # Data transfer objects
│   ├── create-item.dto.ts
│   └── update-item.dto.ts
├── entities/                   # Database entities
│   └── item.entity.ts
└── module-name.service.spec.ts # Unit tests
```

### Naming Conventions

**Variables:**
- Use `camelCase` for variables and functions
- Use `PascalCase` for classes and interfaces
- Use `UPPER_SNAKE_CASE` for constants

```typescript
// Good
const projectId = '123';
const DEFAULT_TIMEOUT = 5000;
class ProjectService {}
interface ProjectData {}

// Avoid
const ProjectId = '123';           // Wrong case
const default_timeout = 5000;      // Wrong case
class projectService {}            // Wrong case
```

**Functions:**
- Use verb prefixes: `get`, `set`, `create`, `update`, `delete`, `fetch`, `validate`
- Be descriptive: `getUserById` not `getUser`

```typescript
// Good
async function fetchProjectItems(projectId: string): Promise<ProjectItem[]>
async function validateToken(token: string): Promise<boolean>
async function createNewProject(data: CreateProjectDto): Promise<Project>

// Avoid
async function items(id: string)  // Not descriptive
async function check(token: string)  // Vague
```

## Testing

### Unit Tests

**VSCode Extension Tests:**

```bash
cd apps/code-ext
pnpm run test
```

**API Tests:**

```bash
cd packages/api

# Run all tests
pnpm run test

# Run specific test file
pnpm run test -- github-auth.service.spec.ts

# Run with coverage
pnpm run test:cov

# Watch mode
pnpm run test:watch
```

**Test Structure:**

```typescript
// service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { MyService } from './my.service';

describe('MyService', () => {
  let service: MyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MyService],
    }).compile();

    service = module.get<MyService>(MyService);
  });

  describe('publicMethod', () => {
    it('should return expected result', async () => {
      const result = await service.publicMethod();
      expect(result).toBeDefined();
    });

    it('should handle errors gracefully', async () => {
      await expect(service.publicMethod()).rejects.toThrow();
    });
  });
});
```

### Integration Tests

```bash
cd tests

# Run integration tests
pnpm run test:integration

# Run specific test suite
pnpm run test:integration -- api
```

### E2E Tests

```bash
cd packages/api

# Run E2E tests
pnpm run test:e2e
```

## Debugging

### VSCode Extension Debugging

**Launch Configuration** (`.vscode/launch.json`):

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}/apps/code-ext"
      ],
      "outFiles": [
        "${workspaceFolder}/apps/code-ext/dist/**/*.js"
      ],
      "preLaunchTask": "npm: build"
    }
  ]
}
```

**Debug Steps:**

1. Set breakpoints in TypeScript files
2. Press `F5` to start debugging
3. Extension Development Host window opens
4. Trigger breakpoint by using extension
5. Use Debug Console to inspect variables

### API Debugging

**NestJS Debugging:**

```bash
# Start API with debugger
node --inspect-brk dist/main.js

# Or use VSCode launch config
```

**Launch Configuration:**

```json
{
  "name": "Debug API",
  "type": "node",
  "request": "launch",
  "runtimeExecutable": "pnpm",
  "runtimeArgs": ["run", "start:debug"],
  "cwd": "${workspaceFolder}/packages/api",
  "console": "integratedTerminal",
  "skipFiles": ["<node_internals>/**"]
}
```

### Logging

**Enable Debug Logging:**

```bash
# VSCode Extension
# Set in settings.json:
{
  "claudeProjects.logLevel": "debug"
}

# State Tracking API
# Set in .env:
LOG_LEVEL=debug
```

**View Logs:**

```bash
# VSCode Extension logs
# Open: View → Output → Claude Projects

# API logs
# Stdout when running locally
# CloudWatch logs when deployed to AWS
```

## Common Tasks

### Adding a New GitHub API Endpoint

1. **Define interface in service:**

```typescript
// packages/api/src/github/projects/projects.service.ts

async getProjectFields(projectId: string): Promise<ProjectField[]> {
  const query = `
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 100) {
            nodes {
              ... on ProjectV2Field {
                id
                name
              }
            }
          }
        }
      }
    }
  `;

  const { data, errors } = await this.fetchGraphQL(query, { projectId });

  if (errors) {
    throw new HttpException('Failed to fetch fields', HttpStatus.BAD_GATEWAY);
  }

  return data.node.fields.nodes;
}
```

2. **Create controller endpoint:**

```typescript
// packages/api/src/github/projects/projects.controller.ts

@Get(':projectId/fields')
async getFields(@Param('projectId') projectId: string) {
  return this.projectsService.getProjectFields(projectId);
}
```

3. **Update VSCode extension HTTP client:**

```typescript
// apps/code-ext/src/http-client.ts

async getProjectFields(projectId: string): Promise<ProjectField[]> {
  const response = await this.fetch(
    `/api/github/projects/${projectId}/fields`
  );
  return response.json();
}
```

4. **Add tests:**

```typescript
// packages/api/src/github/projects/projects.service.spec.ts

describe('getProjectFields', () => {
  it('should fetch project fields', async () => {
    const fields = await service.getProjectFields('project_123');
    expect(fields).toBeDefined();
    expect(fields.length).toBeGreaterThan(0);
  });
});
```

### Adding a New Cache Layer

1. **Define cache interface:**

```typescript
// packages/api/src/common/cache/cache.interface.ts

export interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
}
```

2. **Implement cache service:**

```typescript
// packages/api/src/common/cache/redis-cache.service.ts

@Injectable()
export class RedisCacheService implements ICacheService {
  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : null;
  }

  async set<T>(key: string, value: T, ttl = 300): Promise<void> {
    await this.redis.setex(key, ttl, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async clear(): Promise<void> {
    await this.redis.flushdb();
  }
}
```

3. **Register in module:**

```typescript
// packages/api/src/common/cache/cache.module.ts

@Module({
  providers: [
    {
      provide: 'ICacheService',
      useClass: RedisCacheService,
    },
  ],
  exports: ['ICacheService'],
})
export class CacheModule {}
```

### Migrating from gh CLI to API

See [Migration Guide](./MIGRATION_GUIDE.md) for detailed instructions.

## Best Practices

### 1. Always Use the Unified Service Layer

```typescript
// Good: Use service layer
constructor(private readonly projectsService: ProjectsService) {}

async getProjects() {
  return this.projectsService.getLinkedProjects(owner, repo);
}

// Avoid: Direct gh CLI calls
async getProjects() {
  const result = await exec('gh project list');  // Don't do this
}
```

### 2. Handle Errors Gracefully

```typescript
// Good: Specific error handling
try {
  const projects = await this.projectsService.getLinkedProjects(owner, repo);
  return projects;
} catch (error) {
  if (error instanceof TokenNotFoundError) {
    this.logger.warn('GitHub token not found, prompting user');
    await this.promptForAuthentication();
  } else {
    this.logger.error('Failed to fetch projects', error);
    throw new HttpException('Service unavailable', HttpStatus.SERVICE_UNAVAILABLE);
  }
}

// Avoid: Catching and ignoring
try {
  const projects = await this.projectsService.getLinkedProjects(owner, repo);
  return projects;
} catch (error) {
  console.log('Error:', error);  // Too generic
  return [];  // Hiding errors
}
```

### 3. Use Caching Appropriately

```typescript
// Good: Cache with TTL
async getProjects(owner: string, repo: string) {
  const cacheKey = `projects:${owner}:${repo}`;
  const cached = await this.cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const projects = await this.fetchFromGitHub(owner, repo);
  await this.cache.set(cacheKey, projects, 300); // 5 minutes
  return projects;
}

// Avoid: No cache invalidation
async getProjects(owner: string, repo: string) {
  const cached = this.cache[key];  // Never expires
  if (cached) return cached;

  const projects = await this.fetchFromGitHub(owner, repo);
  this.cache[key] = projects;  // No TTL
  return projects;
}
```

### 4. Log Appropriately

```typescript
// Good: Structured logging
this.logger.info('Fetching projects', {
  owner,
  repo,
  requestId: req.id,
});

// Avoid: Unstructured logging
console.log('Fetching projects for ' + owner + '/' + repo);
```

### 5. Validate Input

```typescript
// Good: Use DTOs with validation
export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;
}

@Post()
async create(@Body() dto: CreateProjectDto) {
  return this.projectsService.create(dto);
}

// Avoid: No validation
@Post()
async create(@Body() body: any) {
  return this.projectsService.create(body);  // Unsafe
}
```

## Troubleshooting

### Common Issues

**1. Build Errors:**

```bash
# Clear build cache
rm -rf dist node_modules/.cache

# Reinstall dependencies
pnpm install --force

# Rebuild
pnpm run build
```

**2. Extension Not Loading:**

```bash
# Reload VSCode window
Cmd+Shift+P → "Developer: Reload Window"

# Check extension logs
View → Output → Claude Projects

# Reinstall extension
code --uninstall-extension your-publisher.claude-projects
code --install-extension claude-projects-*.vsix
```

**3. API Connection Errors:**

```bash
# Check API is running
curl http://localhost:3000/health

# Check environment variables
cat packages/api/.env

# Check MongoDB connection
mongosh $MONGODB_URI
```

**4. GitHub API Errors:**

```bash
# Check authentication
gh auth status

# Refresh token
gh auth refresh -s repo,read:org,read:project,project

# Check API quota
gh api rate_limit
```

For more troubleshooting, see [Troubleshooting Guide](./TROUBLESHOOTING.md).

## Additional Resources

- [Architecture Documentation](./ARCHITECTURE.md)
- [API Reference](./api-reference.md)
- [Migration Guide](./MIGRATION_GUIDE.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [NestJS Documentation](https://docs.nestjs.com/)
- [VSCode Extension API](https://code.visualstudio.com/api)
- [GitHub GraphQL API](https://docs.github.com/en/graphql)

## Getting Help

- **Internal Documentation**: Check `docs/` directory
- **Code Comments**: Read inline documentation in source files
- **GitHub Issues**: Search existing issues or create new one
- **Team Chat**: Ask in #claude-projects channel

## Contributing

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make changes and write tests
3. Run linter: `pnpm run lint`
4. Run tests: `pnpm run test`
5. Commit with clear message: `git commit -m "feat: add new feature"`
6. Push and create PR: `git push origin feature/my-feature`

Happy coding!
