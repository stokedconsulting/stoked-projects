# Claude Projects

A comprehensive system for managing GitHub Projects with Claude AI integration.

## Components

### 1. VSCode Extension (`apps/code-ext`)

**Claude Projects** - VSCode extension for managing GitHub Projects with real-time sync and Claude AI orchestration.

**Features:**
- View repository and organization projects
- Auto-refresh when Claude Code completes tasks
- Link/unlink projects to repositories
- Phase-based project organization
- Claude session monitoring and auto-continuation
- Mark items as done, create new projects

**Installation:**
```bash
cd apps/code-ext
pnpm install
pnpm run build
```

Then reload VSCode: F1 → "Developer: Reload Window"

### 2. State Tracking API (`packages/api`)

**NestJS API** for runtime state tracking of Claude AI sessions.

**Status:** 75% complete (Phase 1 done, Phase 2 in progress)

**Features:**
- Session state tracking (active, idle, crashed)
- Task monitoring and recovery
- Machine/Docker slot management
- MongoDB-based persistence
- API key authentication

**Setup:**
```bash
cd packages/api
npm install
npm run start:dev
```

### 3. Review Commands (Claude Code Skills)

**Three hierarchical commands** for comprehensive quality review:

#### `/review-item` - Individual Issue Review
Reviews a single issue and verifies acceptance criteria.

```bash
claude /review-item 59
claude /review-item 70 2.2
```

#### `/review-phase` - Phase Orchestration
Reviews all items in a phase using parallel sub-agents.

```bash
claude /review-phase 70 2
claude /review-phase 1
```

#### `/review-project` - Project Orchestration
Full project review with executive summary.

```bash
claude /review-project 70
```

**See:** [`examples/REVIEW_COMMANDS.md`](examples/REVIEW_COMMANDS.md)

## Integration Architecture

**NEW in Project #77**: Unified GitHub Service Layer centralizes all GitHub API access through the State Tracking API, providing consistent authentication, rate limiting, error handling, and caching.

```
┌─────────────────────────────────────────────────────────────┐
│                     GitHub API                               │
│                  (Source of Truth)                           │
└─────────────────────────────────────────────────────────────┘
                            ↕
                  (GraphQL & REST API)
                            ↕
┌─────────────────────────────────────────────────────────────┐
│            Unified GitHub Service Layer                      │
│         (State Tracking API - NestJS)                        │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Auth Service │→ │ Projects     │  │ Issues       │      │
│  │ - Token Mgmt │  │ Service      │  │ Service      │      │
│  │ - Validation │  │ - CRUD Ops   │  │ - CRUD Ops   │      │
│  │ - Caching    │  │ - GraphQL    │  │ - GraphQL    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                              │
│  Rate Limiting • Error Handling • Logging & Metrics         │
└─────────────────────────────────────────────────────────────┘
         ↕                      ↕                      ↕
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ VSCode Extension │  │ MCP Server       │  │ Claude Code      │
│ - UI/UX          │  │ - Claude AI      │  │ Commands         │
│ - HTTP Client    │  │   Integration    │  │ /review-*        │
│ - File Watching  │  │ - Tool Protocols │  │ /project-*       │
│ - Cache (5min)   │  │ - JSON Schemas   │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
         ↓                                            ↓
         └────────────────────────────────────────────┘
                            ↓
                   (Signal Files)
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              .claude-sessions/*.signal                       │
│          (File-based IPC mechanism)                         │
└─────────────────────────────────────────────────────────────┘
```

### Key Benefits of Unified Service Layer

- **Centralized Authentication**: Single point for GitHub token management
- **Automatic Rate Limiting**: Prevents API quota exhaustion
- **Consistent Error Handling**: Standardized error responses across all components
- **Multi-layer Caching**: Reduces redundant API calls, improves performance
- **Comprehensive Logging**: Centralized logging for debugging and monitoring

See [Architecture Documentation](docs/ARCHITECTURE.md) for detailed information.

## Quick Start

### 1. Install VSCode Extension

```bash
cd apps/code-ext
pnpm install
pnpm run build
```

Reload VSCode and open the "Claude Projects" panel.

### 2. Install Review Commands

```bash
# Skills are already in ~/.config/claude/skills/
./examples/test-review-commands.sh
```

### 3. Test Integration

```bash
# Test the update notification system
./examples/test-update.sh
```

## Usage Examples

### Managing Projects in VSCode

1. **View Projects**: Open Claude Projects panel (bottom panel)
2. **Link Project**: Right-click org project → "Link to Current Project"
3. **Start Work**: Right-click project → "Start Project"
4. **Auto-Refresh**: Extension updates when Claude completes tasks

### Running Reviews

```bash
# Review a completed feature
claude /review-item 5

# Review a phase before sign-off
claude /review-phase 70 1

# Generate weekly status report
claude /review-project 70
```

### Claude Code Integration

When Claude Code completes a task:

```bash
# Automatically called by Claude Code
./examples/update-project.sh --close-issue 5 --project 70

# Or manually update status
./examples/update-project.sh --issue 5 --status "Done" --project 70
```

## Files & Scripts

### Scripts
- `examples/update-project.sh` - Update GitHub + notify extension
- `examples/claude-hook.sh` - Claude Code hook for session tracking
- `examples/claude-session-wrapper.sh` - Session wrapper with auto-continuation
- `examples/test-update.sh` - Test update notification
- `examples/test-review-commands.sh` - Test review command installation

### Documentation
- `examples/INTEGRATION.md` - Claude Code integration guide
- `examples/REVIEW_COMMANDS.md` - Review commands documentation
- `packages/api/README.md` - API documentation

### Claude Commands
- `~/.claude/commands/review-item.md` - Item review command
- `~/.claude/commands/review-phase.md` - Phase review command
- `~/.claude/commands/review-project.md` - Project review command
- `~/.claude/commands/project-start.md` - Project start command
- `~/.claude/commands/project-create.md` - Project creation command

**Note:** These commands are automatically installed by the VSCode extension on first activation.

## Development

### Build Extension

```bash
cd apps/code-ext
pnpm run build
```

### Build API

```bash
cd packages/api
npm run build
```

### Watch Mode

```bash
# Extension
cd apps/code-ext
pnpm run watch

# API
cd packages/api
npm run start:dev
```

## Current Status

### ✅ Complete
- Phase 1: Foundation & Database Schema (100%)
  - MongoDB schemas for sessions, tasks, machines
  - NestJS project structure
  - API key authentication
  - Health check endpoints

- VSCode Extension Core
  - Project viewing and management
  - Link/unlink projects
  - Auto-refresh on updates
  - Phase-based organization

- Review Commands
  - Three-tier review system
  - Parallel execution
  - Auto status updates

### 🟡 In Progress
- Phase 2: Core Session State Tracking (75%)
  - ✅ Session CRUD endpoints
  - ✅ Heartbeat mechanism
  - ✅ Machine/slot tracking
  - ⏳ Session health queries

### ⏳ Planned
- Phase 3: Task Monitoring & Recovery
- Phase 4: Deployment & Production Readiness
- Phase 5: Monitoring, Logging & Polish

## Contributing

1. Use the review commands before submitting PRs
2. Ensure acceptance criteria are clearly defined
3. Run `claude /review-item` on your changes
4. Update project status via update-project.sh

## Architecture Decisions

### Why File-based IPC?
- Simple and robust
- No network dependencies
- Works with file watchers
- Easy to debug

### Why Three-tier Review?
- Matches project structure (item → phase → project)
- Enables parallel execution
- Provides multiple levels of granularity
- Scalable to large projects

### Why Separate Extension + API?
- Extension for UI and GitHub integration
- API for state persistence and multi-machine coordination
- Decoupled for independent scaling

## Documentation

### Comprehensive Guides

- **[Architecture Guide](docs/ARCHITECTURE.md)** - System architecture and unified service layer
- **[Developer Guide](docs/DEVELOPER_GUIDE.md)** - Getting started with development
- **[Migration Guide](docs/MIGRATION_GUIDE.md)** - Migrating from gh CLI to unified service
- **[Troubleshooting Guide](docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[Deployment Guide](docs/DEPLOYMENT.md)** - Production deployment procedures
- **[API Reference](docs/api-reference.md)** - Complete API documentation

### Component Documentation

- **Extension**: [apps/code-ext/README.md](apps/code-ext/README.md)
- **State Tracking API**: Package-specific documentation
- **MCP Server**: [packages/mcp-server/README.md](packages/mcp-server/README.md)

### Integration Guides

- **[Claude Code Integration](examples/INTEGRATION.md)** - Integration with Claude Code
- **[Review Commands](examples/REVIEW_COMMANDS.md)** - Using the review system
- **[MCP Integration](docs/mcp-integration.md)** - Model Context Protocol integration
- **[MCP Development](docs/mcp-development.md)** - Developing MCP tools

## Troubleshooting

### Extension not showing projects
1. Check you're in a git repository
2. Check GitHub authentication via VSCode
3. Check Output panel: View → Output → Claude Projects
4. Clear cache: Right-click in panel → Clear Cache

### Review commands not working
1. Check installation: `./examples/test-review-commands.sh`
2. Verify MCP Server is running
3. Check you're in project root
4. Enable verbose mode: `claude --verbose /review-item 5`

### Projects not updating
1. Check signal files: `ls -la .claude-sessions/*.signal`
2. Verify MCP Server connectivity
3. Reload VSCode: Cmd+Shift+P → Reload Window
4. Check WebSocket connection status in Output panel
3. Check extension logs in Developer Tools

## License

UNLICENSED - Private use only

## Support

File issues in the repository with appropriate labels:
- `extension` - VSCode extension issues
- `api` - State tracking API issues
- `review-commands` - Review command issues
- `integration` - Cross-component integration issues
