# MCP Integration Guide

Complete setup walkthrough for integrating Claude Code with the MCP server, state tracking API, and VSCode extension.

---

## Table of Contents

1. [Overview](#overview)
2. [System Requirements](#system-requirements)
3. [Architecture](#architecture)
4. [Setup Steps](#setup-steps)
   - [Step 1: State Tracking API Access](#step-1-state-tracking-api-access)
   - [Step 2: MCP Server Setup](#step-2-mcp-server-setup)
   - [Step 3: Claude Desktop Configuration](#step-3-claude-desktop-configuration)
   - [Step 4: VSCode Extension Setup](#step-4-vscode-extension-setup)
5. [Verification](#verification)
6. [Common Workflows](#common-workflows)
7. [Troubleshooting Integration](#troubleshooting-integration)

---

## Overview

The Claude Projects MCP integration connects four key components:

```mermaid
graph LR
    A[Claude Desktop] -->|MCP stdio| B[MCP Server]
    B -->|HTTPS API| C[State Tracking API]
    C -->|GraphQL| D[GitHub Projects]
    B -->|WebSocket| E[VSCode Extension]
    E -->|GitHub API| D
```

**Component Roles**:
- **Claude Desktop**: AI agent that executes project management tasks
- **MCP Server**: Protocol bridge providing tools to Claude and notifications to VSCode
- **State Tracking API**: Backend service managing GitHub Projects state and synchronization
- **VSCode Extension**: UI for viewing and manually managing projects
- **GitHub Projects**: Source of truth for project data

---

## System Requirements

### Software Requirements

| Component | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | 18.x or higher | Runtime for MCP server and VSCode extension |
| **pnpm** | 8.x or higher | Package manager (monorepo workspace support) |
| **Claude Desktop** | Latest | AI agent runtime with MCP support |
| **VS Code** | 1.96.0+ | Extension host |
| **Git** | 2.x+ | Version control and repository detection |

### Access Requirements

| Resource | Required For |
|----------|-------------|
| **GitHub Account** | Accessing GitHub Projects |
| **State Tracking API Key** | MCP server authentication |
| **WebSocket API Key** | VSCode extension real-time notifications |
| **GitHub Personal Access Token** | (Handled by VSCode's built-in GitHub auth) |

### Network Requirements

- Outbound HTTPS access to `claude-projects.truapi.com` (state tracking API)
- Outbound HTTPS access to `api.github.com` (GitHub GraphQL API)
- Localhost WebSocket connection on port `8080` (MCP server ↔ VSCode extension)

---

## Architecture

### Component Communication Flow

```mermaid
sequenceDiagram
    participant Claude as Claude Desktop
    participant MCP as MCP Server
    participant API as State Tracking API
    participant GH as GitHub Projects
    participant VSCode as VSCode Extension

    Note over Claude,VSCode: 1. Claude reads project state
    Claude->>MCP: read_project(projectNumber: 70)
    MCP->>API: GET /api/projects/70
    API->>GH: GraphQL query
    GH-->>API: Project data
    API-->>MCP: Project JSON
    MCP-->>Claude: Tool result

    Note over Claude,VSCode: 2. Claude updates issue status
    Claude->>MCP: update_issue_status(70, 42, "done")
    MCP->>API: PATCH /api/projects/70/issues/42
    API->>GH: GraphQL mutation
    GH-->>API: Updated issue
    API-->>MCP: Success response
    MCP->>MCP: Emit issue.updated event
    MCP-->>Claude: Tool result
    MCP->>VSCode: WebSocket event notification

    Note over VSCode: 3. VSCode updates UI
    VSCode->>VSCode: Refresh project view
```

### Data Flow

1. **Claude → MCP Server**: Tool calls via stdio (JSON-RPC)
2. **MCP Server → API**: HTTPS REST requests with API key authentication
3. **API → GitHub**: GraphQL queries and mutations
4. **MCP Server → VSCode**: WebSocket notifications for real-time updates
5. **VSCode → GitHub**: Direct API calls for manual operations

---

## Setup Steps

### Step 1: State Tracking API Access

#### Obtain API Keys

Contact your administrator or project lead to obtain:
1. **State Tracking API Key** (format: `sk_live_...` or `sk_dev_...`)
2. **WebSocket API Key** (format: `ws_...`)

These keys provide:
- Authentication for the state tracking API
- WebSocket connection authentication for real-time notifications

#### Test API Access

Verify your API key works:

```bash
curl -H "Authorization: Bearer sk_your_api_key_here" \
     https://claude-projects.truapi.com/api/projects
```

Expected response: JSON array of projects or empty array `[]`

If you get a `401 Unauthorized` error, your API key is invalid or expired.

---

### Step 2: MCP Server Setup

#### Install Dependencies

```bash
# Navigate to monorepo root
cd /path/to/claude-projects-project-72

# Install all dependencies (including mcp-server)
pnpm install
```

#### Configure Environment

Create MCP server configuration file:

```bash
cd packages/mcp-server
cp .env.example .env
```

Edit `.env` with your API keys:

```bash
# Required: State Tracking API authentication
STATE_TRACKING_API_KEY=sk_your_api_key_here

# Required: WebSocket server authentication
WS_API_KEY=ws_your_websocket_key_here

# Optional: API URL (default shown)
STATE_TRACKING_API_URL=https://claude-projects.truapi.com

# Optional: Logging verbosity (debug, info, warn, error)
LOG_LEVEL=info

# Optional: WebSocket server port
WS_PORT=8080
```

#### Build the Server

```bash
cd packages/mcp-server
pnpm build
```

This compiles TypeScript to JavaScript in `dist/` directory.

#### Test the Server

Start the server in standalone mode to verify configuration:

```bash
pnpm start:dev
```

Expected output:
```
Tool registered: health_check
Tool registered: read_project
Tool registered: get_project_phases
Tool registered: list_issues
Tool registered: get_issue_details
Tool registered: create_issue
Tool registered: update_issue
Tool registered: update_issue_status
Tool registered: update_issue_phase
WebSocket server listening on port 8080
MCP server started
```

Press `Ctrl+C` to stop. If you see errors, check the [Troubleshooting](#troubleshooting-integration) section.

---

### Step 3: Claude Desktop Configuration

#### Locate Configuration File

Find your Claude Desktop configuration file:

**macOS**:
```bash
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows**:
```
%APPDATA%\Claude\claude_desktop_config.json
```

**Linux**:
```
~/.config/Claude/claude_desktop_config.json
```

#### Add MCP Server

Edit the configuration file to add the MCP server:

```json
{
  "mcpServers": {
    "claude-projects": {
      "command": "node",
      "args": [
        "/absolute/path/to/claude-projects-project-72/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "STATE_TRACKING_API_KEY": "sk_your_api_key_here",
        "WS_API_KEY": "ws_your_websocket_key_here",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

**Important Notes**:
- Use **absolute paths**, not relative paths or `~` shortcuts
- Replace `/absolute/path/to/` with your actual repository location
- The `env` section can override `.env` file values
- Add multiple servers by adding more entries under `mcpServers`

**Example with Multiple Servers**:
```json
{
  "mcpServers": {
    "claude-projects": {
      "command": "node",
      "args": ["/Users/you/repos/claude-projects-project-72/packages/mcp-server/dist/index.js"],
      "env": {
        "STATE_TRACKING_API_KEY": "sk_your_key",
        "WS_API_KEY": "ws_your_key"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/workspace"]
    }
  }
}
```

#### Restart Claude Desktop

1. Quit Claude Desktop completely (ensure it's not running in background)
2. Relaunch Claude Desktop
3. Check MCP server loaded successfully

To verify:
1. Start a new Claude conversation
2. Look for available tools in the tool picker
3. You should see tools like `health_check`, `read_project`, `list_issues`, etc.

If tools don't appear, check Claude Desktop logs (location varies by OS).

---

### Step 4: VSCode Extension Setup

#### Install Extension

**Option A: From Source (Development)**

```bash
cd /path/to/claude-projects-project-72/apps/code-ext
pnpm install
pnpm compile
```

Press `F5` to launch Extension Development Host.

**Option B: From VSIX (Production)**

```bash
cd apps/code-ext
pnpm package
code --install-extension gh-projects-vscode-0.0.1.vsix
```

#### Configure WebSocket Connection

1. Open VSCode Settings (`Cmd+,` or `Ctrl+,`)
2. Search for "Claude Projects"
3. Configure the following settings:

```json
{
  "ghProjects.notifications.enabled": true,
  "ghProjects.notifications.websocketUrl": "ws://localhost:8080/notifications",
  "ghProjects.mcp.apiKey": "ws_your_websocket_key_here"
}
```

**Settings Explanation**:
- `notifications.enabled`: Enable/disable WebSocket notifications
- `notifications.websocketUrl`: MCP server WebSocket endpoint (default: `ws://localhost:8080/notifications`)
- `mcp.apiKey`: WebSocket authentication key (must match MCP server's `WS_API_KEY`)

#### GitHub Authentication

On first use, the extension will prompt for GitHub authentication:

1. Click "Authorize" when prompted
2. Sign in to GitHub in your browser
3. Grant permissions for:
   - Read access to repositories
   - Read/write access to GitHub Projects

This authentication is handled by VSCode's built-in GitHub extension and persists across sessions.

---

## Verification

### Test End-to-End Integration

Follow these steps to verify the complete integration:

#### 1. Verify MCP Server

Start the MCP server:

```bash
cd packages/mcp-server
pnpm start
```

Keep this running in a terminal. You should see:
```
Tool registered: health_check
...
WebSocket server listening on port 8080
MCP server started
```

#### 2. Verify Claude Desktop Connection

Open Claude Desktop and run:

```
Use the health_check tool to verify connectivity
```

Claude should respond with:
```json
{
  "apiAvailable": true,
  "authenticated": true,
  "responseTimeMs": 150,
  "apiVersion": "1.0.0"
}
```

#### 3. Verify VSCode Extension

1. Open VSCode with a workspace containing a Git repository
2. Open the **Claude Projects** panel (bottom panel area)
3. Check the Output panel (`Cmd+Shift+U` or `Ctrl+Shift+U`) → "Claude Projects" channel
4. Look for: `WebSocket connected to ws://localhost:8080/notifications`

#### 4. Test Real-Time Notifications

**In Claude Desktop**, update an issue status:

```
Update issue 42 in project 70 to status "done"
```

Claude will use the `update_issue_status` tool. The MCP server will:
1. Call the state tracking API
2. Emit an `issue.updated` event
3. Send WebSocket notification to VSCode

**In VSCode**, you should see:
1. The project view automatically refreshes
2. Issue 42's status changes to "Done"
3. Output panel logs: `Received event: issue.updated`

**If the UI doesn't update automatically**, check:
- MCP server is running
- WebSocket connection is established (check Output panel)
- API keys match between MCP server and VSCode settings

---

## Common Workflows

### Workflow 1: Claude-Driven Development

**Goal**: Let Claude manage project tasks end-to-end

1. **In VSCode**: View project board and identify next task
2. **In Claude Desktop**: Ask Claude to work on a specific issue
   ```
   Work on issue 42 in project 70. Read the issue details, implement the feature, and update the status to done when complete.
   ```
3. **Claude Executes**:
   - Reads issue details with `get_issue_details`
   - Implements the feature using other tools (file operations, etc.)
   - Updates status with `update_issue_status`
4. **In VSCode**: Automatically see the status update in real-time

### Workflow 2: Manual Management with Claude Assistance

**Goal**: Manually manage projects with Claude providing assistance

1. **In VSCode**: Browse projects and select an item
2. **In Claude Desktop**: Ask Claude for context
   ```
   Read project 70 and summarize the current phase and open issues
   ```
3. **Claude Analyzes**:
   - Uses `read_project` to get overview
   - Uses `list_issues` with filters to analyze status
   - Provides summary and recommendations
4. **In VSCode**: Manually update statuses based on Claude's analysis

### Workflow 3: Automated Project Orchestration

**Goal**: Full project automation with phase progression

1. **In Claude Desktop**: Start project orchestration
   ```
   Execute project 72 from start to finish, working through all phases systematically
   ```
2. **Claude Orchestrates**:
   - Reads project phases with `get_project_phases`
   - Iterates through each phase:
     - Lists phase issues with `list_issues(phase="Phase N")`
     - Works on each issue
     - Updates status to `done`
     - Moves to next phase
3. **In VSCode**: Watch progress in real-time as statuses update
4. **Completion**: Claude reports when all phases complete

---

## Troubleshooting Integration

### MCP Server Not Connecting

**Symptom**: Claude Desktop doesn't show MCP tools

**Checklist**:
1. Verify `claude_desktop_config.json` path is correct and absolute
2. Check MCP server builds without errors (`pnpm build`)
3. Ensure `.env` has `STATE_TRACKING_API_KEY` set
4. Check Claude Desktop logs for error messages
5. Try running MCP server standalone (`pnpm start:dev`) to test configuration

**Common Errors**:
- `Error: Cannot find module 'dist/index.js'` → Run `pnpm build` in `packages/mcp-server`
- `Error: Required environment variable STATE_TRACKING_API_KEY not set` → Add to `.env` or `claude_desktop_config.json`

---

### WebSocket Connection Failures

**Symptom**: VSCode extension doesn't receive real-time updates

**Diagnosis**:

1. **Check MCP server is running**:
   ```bash
   # MCP server must be running for WebSocket to work
   cd packages/mcp-server
   pnpm start
   ```

2. **Verify WebSocket server started**:
   Look for log line: `WebSocket server listening on port 8080`

3. **Test WebSocket connectivity**:
   ```bash
   # Test if port is open
   telnet localhost 8080

   # Or use wscat
   npm install -g wscat
   wscat -c "ws://localhost:8080/notifications?apiKey=ws_your_key"
   ```

4. **Check VSCode Output panel**:
   - Open Output panel (`Cmd+Shift+U`)
   - Select "Claude Projects" from dropdown
   - Look for connection errors

**Common Issues**:
- `ECONNREFUSED` → MCP server not running
- `Authentication failed` → API keys don't match
- `Connection closed with code 1006` → Server crashed or configuration error

---

### API Authentication Errors

**Symptom**: Tools return `401 Unauthorized` or `403 Forbidden`

**Solutions**:

1. **Verify API key is valid**:
   ```bash
   curl -H "Authorization: Bearer $STATE_TRACKING_API_KEY" \
        https://claude-projects.truapi.com/health
   ```

2. **Check API key has correct permissions**:
   - Must have read access to projects
   - Must have write access for update operations

3. **Ensure API key not expired**:
   Contact administrator for new key if expired

4. **Verify environment variable loading**:
   - Check `.env` file exists and is readable
   - Confirm no typos in variable names
   - Try setting in `claude_desktop_config.json` instead

---

### Performance Issues

**Symptom**: Slow response times or timeouts

**Diagnosis**:

1. **Check API response times**:
   ```bash
   # Time a simple API call
   time curl -H "Authorization: Bearer $STATE_TRACKING_API_KEY" \
             https://claude-projects.truapi.com/api/projects
   ```

2. **Enable debug logging**:
   ```bash
   # In .env
   LOG_LEVEL=debug
   ```

3. **Increase timeout values**:
   ```bash
   # In .env
   REQUEST_TIMEOUT_MS=30000  # 30 seconds
   RETRY_ATTEMPTS=5
   ```

4. **Check network latency**:
   ```bash
   ping claude-projects.truapi.com
   traceroute claude-projects.truapi.com
   ```

---

### GitHub Projects Not Showing

**Symptom**: VSCode extension shows no projects

**Checklist**:

1. **Verify workspace has Git repository**:
   ```bash
   git remote -v
   # Should show GitHub remote URL
   ```

2. **Check GitHub authentication**:
   - Click GitHub account icon in VSCode status bar
   - Ensure signed in and authorized

3. **Verify GitHub Projects exist**:
   - Visit GitHub repository
   - Check Projects tab exists
   - Confirm projects are linked to repository

4. **Check organization access**:
   - If organization project, verify you have access
   - OAuth App restrictions may block access

---

## Advanced Configuration

### Custom API Endpoints

For staging or self-hosted environments:

```bash
# .env
STATE_TRACKING_API_URL=https://staging.claude-projects.example.com
```

### Multiple MCP Servers

Run MCP servers on different ports for development/production:

```json
{
  "mcpServers": {
    "claude-projects-dev": {
      "command": "node",
      "args": ["/path/to/dev/packages/mcp-server/dist/index.js"],
      "env": {
        "STATE_TRACKING_API_KEY": "sk_dev_...",
        "WS_API_KEY": "ws_dev_...",
        "WS_PORT": "8080"
      }
    },
    "claude-projects-prod": {
      "command": "node",
      "args": ["/path/to/prod/packages/mcp-server/dist/index.js"],
      "env": {
        "STATE_TRACKING_API_KEY": "sk_live_...",
        "WS_API_KEY": "ws_live_...",
        "WS_PORT": "8081"
      }
    }
  }
}
```

Configure VSCode extension to connect to the appropriate port.

### Logging and Debugging

**Enable verbose logging** for troubleshooting:

```bash
# MCP Server
LOG_LEVEL=debug

# VSCode Extension
# Open Output panel and watch "Claude Projects" channel
```

**Log Locations**:
- **MCP Server**: stderr (visible in Claude Desktop logs or standalone terminal)
- **VSCode Extension**: VSCode Output panel → "Claude Projects"
- **Claude Desktop**: Platform-specific log files
  - macOS: `~/Library/Logs/Claude/`
  - Windows: `%APPDATA%\Claude\Logs\`
  - Linux: `~/.config/Claude/logs/`

---

## Next Steps

After completing integration setup:

1. **Read the [API Reference](./api-reference.md)** for detailed tool documentation
2. **Review the [Developer Guide](./mcp-development.md)** to add custom tools
3. **Explore example prompts** for common project management tasks
4. **Set up automated workflows** using Claude orchestration

---

## Support

For integration issues:

- **MCP Server**: See [packages/mcp-server/README.md](../packages/mcp-server/README.md)
- **VSCode Extension**: See [apps/code-ext/README.md](../apps/code-ext/README.md)
- **API Reference**: See [docs/api-reference.md](./api-reference.md)
- **Developer Guide**: See [docs/mcp-development.md](./mcp-development.md)

---

Built with the [Model Context Protocol](https://modelcontextprotocol.io/) for seamless AI integration.
