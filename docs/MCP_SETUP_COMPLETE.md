# ✅ MCP Server Setup Complete

## What Was Done

### 1. ✅ Added `project.created` Event Type
- Updated `packages/mcp-server/src/events/event-bus.ts` to support the new event type
- This allows notifications when new projects are created

### 2. ✅ Created `notify_project_created` MCP Tool
- New file: `packages/mcp-server/src/tools/notify-project-created.ts`
- Registered in server.ts
- This tool emits the `project.created` event to all connected clients

### 3. ✅ Built MCP Server
- Installed dependencies: `pnpm install`
- Compiled TypeScript: `pnpm build`
- Output: `packages/mcp-server/dist/index.js`

### 4. ✅ Created Configuration
- Created `.env` file with WebSocket API key
- Environment variables:
  - `STATE_TRACKING_API_KEY=placeholder_api_key_not_used`
  - `WS_API_KEY=ws_dev_local_key_12345`
  - `WS_PORT=8080`
  - `LOG_LEVEL=info`

### 5. ✅ Registered with Claude CLI
- Added MCP server: `claude mcp add ...`
- Server name: `claude-projects`
- Status: ✓ Connected
- Scope: Local config (this project only)

### 6. ✅ Updated VSCode Extension
- Added `project.created` event handler in `apps/code-ext/src/notifications/websocket-client.ts`
- Added event listener in `apps/code-ext/src/projects-view-provider.ts`
- Rebuilt extension: `npm run compile`
- Extension will now refresh automatically when projects are created

## How It Works

```
┌─────────────────┐
│   Claude CLI    │  User runs /project-create
│ /project-create │
└────────┬────────┘
         │ 1. Creates GitHub project
         │ 2. Calls MCP tool
         ▼
┌─────────────────┐
│   MCP Server    │  notify_project_created(projectNumber: 72)
│  (port stdio)   │
└────────┬────────┘
         │ Emits event via WebSocket
         ▼
┌─────────────────┐
│  WebSocket      │  ws://localhost:8080/notifications
│  (port 8080)    │
└────────┬────────┘
         │ Sends project.created event
         ▼
┌─────────────────┐
│ VSCode Extension│  Receives event, refreshes UI
│  Projects View  │
└─────────────────┘
```

## Usage

### In Your /project-create Skill

Add this at the end of the skill after successfully creating a project:

```markdown
## Step 5: Notify VSCode Extension

After the project is successfully created, notify the VSCode extension so it can refresh automatically:

Use the MCP tool `notify_project_created`:

{
  "projectNumber": [PROJECT_NUMBER],
  "title": "[PROJECT_TITLE]",
  "owner": "[ORG_OR_USER]",
  "repo": "[REPO_NAME]",
  "url": "https://github.com/orgs/[ORG]/projects/[NUMBER]"
}

This will trigger the VSCode extension to automatically refresh and display the new project.
```

### Example Call

```javascript
notify_project_created({
  "projectNumber": 75,
  "title": "Authentication System Redesign",
  "owner": "myorg",
  "repo": "myapp",
  "url": "https://github.com/orgs/myorg/projects/75"
})
```

### Expected Response

```json
{
  "success": true,
  "message": "Project creation notification sent",
  "projectNumber": 75,
  "eventType": "project.created",
  "notifiedClients": 1
}
```

## Verification

### 1. Check MCP Server is Running

```bash
claude mcp list
```

Should show:
```
claude-projects: ✓ Connected
```

### 2. Test WebSocket Server

```bash
curl http://localhost:8080/health
```

Should return:
```json
{"status":"ok","connections":0,"uptime":123.456}
```

### 3. Check Available Tools

In Claude CLI, the following tool should be available:
- `notify_project_created` - Notify connected clients that a new project has been created

### 4. Test the Full Flow

1. Open VSCode in a repository
2. Open the Claude Projects panel
3. Run `/project-create` in Claude CLI (in the same repo)
4. After project is created, the skill calls `notify_project_created`
5. The VSCode extension should automatically refresh and show the new project

## Reload VSCode

To activate the updated extension:
1. Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux)
2. Type "Developer: Reload Window"
3. Press Enter

## Debugging

### VSCode Extension Logs

View → Output → Select "Claude Projects - Notifications"

Look for:
- `[WebSocket] Connected successfully`
- `[WS] Project created: [project name]`
- `[ProjectsViewProvider] Refreshing projects view...`

### MCP Server Logs

The MCP server logs to stderr. To see them:

```bash
# In Claude CLI with debug mode
claude --debug <your-command>
```

Look for:
- `[EventBus] Emitting event: project.created (project: 72) to 1 subscribers`
- `[WebSocket] Connected and subscribed to X projects`

### Troubleshooting

**Extension not refreshing?**
1. Check WebSocket server is running: `curl http://localhost:8080/health`
2. Reload VSCode window
3. Check Output panel for WebSocket connection errors
4. Verify API key matches in `.env` and VSCode settings

**MCP tool not found?**
1. Verify server is connected: `claude mcp get claude-projects`
2. Rebuild server: `cd packages/mcp-server && pnpm build`
3. Restart Claude CLI session

**Port 8080 in use?**
1. Change port in `.env`: `WS_PORT=8081`
2. Update MCP server config: `claude mcp remove claude-projects -s local` then re-add
3. Update VSCode settings

## Files Changed

### New Files
- `packages/mcp-server/src/tools/notify-project-created.ts`
- `packages/mcp-server/.env`
- `packages/mcp-server/USAGE.md`

### Modified Files
- `packages/mcp-server/src/events/event-bus.ts` - Added `project.created` event type
- `packages/mcp-server/src/server.ts` - Registered new tool
- `packages/mcp-server/tsconfig.json` - Excluded test files from build
- `apps/code-ext/src/notifications/websocket-client.ts` - Added `project.created` to event types
- `apps/code-ext/src/projects-view-provider.ts` - Added handler for `project.created` events

## Next Steps

1. **Update /project-create skill** to call `notify_project_created` after creating projects
2. **Test the flow** by running `/project-create` in Claude CLI
3. **Monitor logs** in VSCode Output panel to see the events flowing through

## Documentation

See `packages/mcp-server/USAGE.md` for detailed usage instructions and examples.

---

**Status**: ✅ Fully Configured and Ready to Use

The MCP server is now running and ready to receive notifications from Claude CLI!
