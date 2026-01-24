# Watch Mode

Turbo watch mode enables automatic rebuilding when files change across the monorepo.

## Usage

```bash
# Start watch mode for all packages
pnpm watch
```

This will:
1. **Build dependencies first** - API builds before MCP server and extension
2. **Watch for changes** - Auto-rebuilds on file changes
3. **Rebuild dependents** - When API changes, MCP server and extension rebuild too

## Package Dependencies

```
state-tracking-api (base package)
    ├── mcp-server (depends on API)
    └── code-ext (depends on API)
```

## How It Works

- **state-tracking-api**: NestJS watch mode (`nest start --watch`)
- **mcp-server**: TypeScript watch mode (`tsc --watch`)
- **code-ext**: Webpack watch mode (`webpack --watch`)

Changes in any package trigger rebuilds in dependent packages automatically.

## Examples

### Change API code
```bash
# Edit packages/state-tracking-api/src/app.controller.ts
# → API rebuilds
# → MCP server rebuilds (depends on API)
# → Extension rebuilds (depends on API)
```

### Change MCP server code
```bash
# Edit packages/mcp-server/src/index.ts
# → Only MCP server rebuilds
```

### Change Extension code
```bash
# Edit apps/code-ext/src/extension.ts
# → Only extension rebuilds
```

## Performance

Turbo's intelligent caching ensures only affected packages rebuild, making watch mode extremely fast even in large monorepos.
