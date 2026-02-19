# MCP Server Usage Guide

## Overview

The Stoked Projects MCP server enables real-time notifications from Claude CLI to the VSCode extension when projects are created or updated.

## Architecture

```
Claude CLI (/project-create skill)
    ↓ (calls MCP tool)
MCP Server (notify_project_created)
    ↓ (emits event via WebSocket)
VSCode Extension
    ↓ (refreshes UI)
Updated Projects View
```

## Setup

### 1. Build the MCP Server

```bash
cd packages/mcp-server
pnpm install
pnpm build
```

### 2. Configure Claude CLI

The MCP server is already configured in your local Claude CLI config. Verify with:

```bash
claude mcp list
```

You should see:
```
stoked-projects:
  Status: ✓ Connected
  Type: stdio
  Command: node
  Args: /Users/stoked/work/stoked-projects/packages/mcp-server/dist/index.js
  Environment:
    STATE_TRACKING_API_KEY=placeholder_api_key_not_used
    WS_API_KEY=ws_dev_local_key_12345
    LOG_LEVEL=info
    WS_PORT=8080
```

### 3. Rebuild VSCode Extension

```bash
cd apps/code-ext
npm run compile
```

Then reload the VSCode window: `Cmd+Shift+P` → "Developer: Reload Window"

## Usage

### From /project-create Skill

When `/project-create` finishes creating a GitHub project, it should call the MCP tool:

```javascript
// Call the notify_project_created tool
{
  "projectNumber": 72,
  "title": "My New Project",
  "owner": "yourorg",
  "repo": "yourrepo",
  "url": "https://github.com/orgs/yourorg/projects/72"
}
```

### Available MCP Tools

#### notify_project_created

**Description**: Notify connected clients (VSCode extension) that a new GitHub project has been created.

**Parameters**:
- `projectNumber` (required): GitHub Project number
- `title` (optional): Project title
- `owner` (optional): Repository owner (org or user)
- `repo` (optional): Repository name
- `url` (optional): Project URL
- `metadata` (optional): Additional project metadata

**Example Usage in Claude CLI**:

```bash
# The skill should call this after successfully creating project #72
notify_project_created({
  "projectNumber": 72,
  "title": "New Feature Development",
  "owner": "myorg",
  "repo": "myrepo",
  "url": "https://github.com/orgs/myorg/projects/72"
})
```

**Response**:
```json
{
  "success": true,
  "message": "Project creation notification sent",
  "projectNumber": 72,
  "eventType": "project.created",
  "notifiedClients": 1
}
```

### Event Flow

1. **Claude CLI** runs `/project-create` skill
2. **Skill** creates GitHub project using `gh` CLI
3. **Skill** calls MCP tool `notify_project_created` with project details
4. **MCP Server** emits `project.created` event to WebSocket (port 8080)
5. **VSCode Extension** receives event and refreshes projects view
6. **User** sees new project appear instantly in VSCode sidebar

## WebSocket Server

The MCP server runs a WebSocket server on port 8080 (configurable via `WS_PORT` env var) that the VSCode extension connects to.

### Connection Details

- **URL**: `ws://localhost:8080/notifications`
- **Authentication**: Bearer token via Authorization header
- **API Key**: `ws_dev_local_key_12345` (set in .env file)

### Event Types

- `project.created` - New project created
- `project.updated` - Project metadata updated
- `issue.created` - New issue added to project
- `issue.updated` - Issue fields modified
- `issue.deleted` - Issue removed from project
- `phase.updated` - Phase metadata changed

## VSCode Extension Configuration

The extension automatically connects to the WebSocket server when a workspace is opened. Configure in VSCode settings:

```json
{
  "claudeProjects.notifications.enabled": true,
  "claudeProjects.notifications.wsUrl": "ws://localhost:8080/notifications",
  "claudeProjects.notifications.wsApiKey": "ws_dev_local_key_12345"
}
```

## Debugging

### Check MCP Server Status

```bash
# List MCP servers
claude mcp list

# Get details about stoked-projects server
claude mcp get stoked-projects
```

### Check WebSocket Server

```bash
# Test WebSocket server is running
curl http://localhost:8080/health

# Should return:
# {"status":"ok","connections":0,"uptime":123.456}
```

### VSCode Extension Logs

1. Open VSCode Output panel: `View` → `Output`
2. Select "Stoked Projects - Notifications" from dropdown
3. Look for WebSocket connection and event logs

### MCP Server Logs

MCP server logs are written to stderr and visible in Claude CLI debug logs:

```bash
# Enable debug mode
claude --debug <your-command>

# Or check MCP-specific logs
claude --mcp-debug <your-command>
```

## Troubleshooting

### Extension Not Receiving Events

1. Check WebSocket server is running: `curl http://localhost:8080/health`
2. Check extension Output panel for connection errors
3. Verify API key matches in both MCP server and extension settings
4. Try reloading VSCode window: `Cmd+Shift+P` → "Developer: Reload Window"

### MCP Tool Not Available

1. Verify MCP server is configured: `claude mcp list`
2. Rebuild MCP server: `cd packages/mcp-server && pnpm build`
3. Restart Claude CLI session

### Port Already in Use

If port 8080 is already in use, change it:

1. Update MCP server config: `claude mcp remove stoked-projects -s local`
2. Re-add with new port: `claude mcp add -e WS_PORT=8081 ...`
3. Update VSCode settings: `claudeProjects.notifications.wsUrl` to `ws://localhost:8081/notifications`

## Example: Complete Flow

```bash
# 1. User runs /project-create in Claude CLI
/project-create "New Feature Development"

# 2. Skill creates project and gets project #72
# (using gh CLI commands)

# 3. Skill calls MCP tool
notify_project_created({
  "projectNumber": 72,
  "title": "New Feature Development",
  "owner": "myorg",
  "repo": "myrepo"
})

# 4. MCP server logs:
# [2026-01-23T17:08:00.000Z] [EventBus] Emitting event: project.created (project: 72) to 1 subscribers

# 5. VSCode extension logs:
# [WebSocket] Received: {"type":"event","event":{"type":"project.created",...}}
# [WS] Project created: New Feature Development
# [ProjectsViewProvider] Refreshing projects view...

# 6. Projects view in VSCode refreshes and shows new project
```

## Next Steps

To integrate this into the `/project-create` skill:

1. Add MCP tool call at the end of the skill
2. Pass the created project number and metadata
3. The extension will automatically refresh when it receives the event

The skill template should include:

```markdown
After successfully creating the project, notify the VSCode extension:

Use the MCP tool `notify_project_created` with the following parameters:
- projectNumber: [the created project number]
- title: [project title]
- owner: [repo owner]
- repo: [repo name]
- url: [project URL from GitHub]

This will trigger an automatic refresh of the VSCode extension's projects view.
```
