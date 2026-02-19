# Stoked Projects VSCode Extension

Manage GitHub Projects with real-time sync and Claude AI integration.

## Features

- **View Projects**: Repository-linked and organization projects
- **Auto-Refresh**: Automatically updates when Claude Code completes tasks
- **Link/Unlink**: Link organization projects to repositories
- **Phase-Based Organization**: Group work items by project phases
- **Claude Integration**: Launch Claude Code sessions with context
- **Review Commands**: Built-in quality review system
- **Unified Service Layer**: Integrated with State Tracking API for reliable GitHub operations

### 🔔 Real-Time Notifications

- **WebSocket Integration** - Live updates when Claude modifies projects via MCP
- **Instant Sync** - UI updates automatically when issues change
- **Event Buffering** - Missed events replayed on reconnection
- **Low Latency** - <100ms notification delivery

## Installation

1. Install the extension in VSCode
2. Reload VSCode
3. The extension will automatically install Claude review commands to `~/.claude/commands/`

## Claude Commands

The extension includes five Claude commands that are automatically installed.

### Commands Installed

**Review Commands:**

- `/review-item` - Review individual issues
- `/review-phase` - Review all items in a phase
- `/review-project` - Full project review

**Project Commands:**

- `/project-start` - Start working on a project with Claude
- `/project-create` - Create a new GitHub project with Claude

See `examples/REVIEW_COMMANDS.md` in the main repo for detailed usage.

## Usage

### View Projects

1. Open the **Stoked Projects** panel (bottom panel)
2. Projects are organized by phases
3. Click on items to view details

### Link Projects

1. Right-click an organization project
2. Select **"Link to Current Project"** 🔗
3. Project moves to Repository Projects

### Start Working

1. Right-click a project
2. Select **"Start"** or **"Start with Context"**
3. Claude Code launches in a new terminal

### Review Work

1. Right-click a project/phase/item
2. Select **"Review Project/Phase/Item"** 📋
3. Claude analyzes and updates status

## Requirements

- **VSCode** 1.80.0 or higher
- **GitHub CLI** (`gh`) installed and authenticated
- **Claude Code** installed
- Git repository with GitHub remote

### Phase Organization

Items are automatically grouped by naming convention:

```
[Phase 1] Setup - MASTER      → Phase 1 master item
[P1.1] Initialize project     → Phase 1 work item 1
[P1.2] Configure environment  → Phase 1 work item 2
[Phase 2] Development - MASTER → Phase 2 master item
```

### Claude AI Sessions

1. Click **▶** on any project to start a Claude session
2. Claude runs with `/gh-project N` command
3. The extension monitors for inactivity
4. If Claude stalls, a continuation prompt is sent automatically

**Manage Sessions:**

- `Cmd+Shift+P` → _Claude Projects: View Active Claude Sessions_
- `Cmd+Shift+P` → _Claude Projects: Stop All Claude Sessions_

## Configuration

### Extension Settings

Access settings via `Cmd+,` (or `Ctrl+,`) and search for "Stoked Projects":

| Setting                                 | Default                             | Description                                                        |
| --------------------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| **WebSocket Notifications**             |                                     |                                                                    |
| `claudeProjects.notifications.enabled`      | `true`                              | Enable real-time notifications via WebSocket                       |
| `claudeProjects.notifications.websocketUrl` | `ws://localhost:8080/notifications` | WebSocket URL for the MCP notification server                      |
| `claudeProjects.mcp.apiKey`                 | _(empty)_                           | API key for MCP server authentication (required for notifications) |
| **Claude Sessions**                     |                                     |                                                                    |
| Inactivity Threshold                    | 60 seconds                          | Time before sending continuation prompt                            |
| Check Interval                          | 10 seconds                          | How often to check for Claude activity                             |

### WebSocket Notification Setup

To enable real-time notifications when Claude modifies projects:

1. **Start the MCP Server** with WebSocket support:

   ```bash
   cd packages/mcp-server
   # Ensure WS_API_KEY is set in .env
   pnpm start
   ```

2. **Configure the Extension** with matching API key:
   - Open VSCode Settings (`Cmd+,` or `Ctrl+,`)
   - Search for "Stoked Projects"
   - Set `claudeProjects.mcp.apiKey` to match the `WS_API_KEY` in MCP server `.env`
   - Verify `claudeProjects.notifications.websocketUrl` points to MCP server (default: `ws://localhost:8080/notifications`)
   - Ensure `claudeProjects.notifications.enabled` is `true`

3. **Verify Connection**:
   - Check VSCode Output panel → "Stoked Projects" channel
   - Look for: `WebSocket connected to ws://localhost:8080/notifications`
   - If connection fails, check MCP server is running and API key matches

### Configuration Example

**VSCode Settings (settings.json)**:

```json
{
  "claudeProjects.notifications.enabled": true,
  "claudeProjects.notifications.websocketUrl": "ws://localhost:8080/notifications",
  "claudeProjects.mcp.apiKey": "ws_your_api_key_here"
}
```

**MCP Server (.env)**:

```bash
STATE_TRACKING_API_KEY=sk_your_api_key_here
WS_API_KEY=ws_your_api_key_here
WS_PORT=8080
```

**Important**: The `WS_API_KEY` in MCP server `.env` must match the `claudeProjects.mcp.apiKey` in VSCode settings.

## Troubleshooting

### Projects Not Showing

1. **Check GitHub remote** - Ensure your workspace has a valid GitHub remote
2. **Verify authentication** - Re-authenticate via VS Code's GitHub integration
3. **Organization access** - OAuth App restrictions may block org projects

### Claude Sessions Not Working

1. **Install Claude CLI** - Ensure `claude` command is available in terminal
2. **Check permissions** - The `--dangerously-skip-permissions` flag is required
3. **Review session logs** - Check `.claude-sessions/` for error details

### Cache Issues

Click the 🔄 refresh button to force a fresh data fetch.

### WebSocket Connection Issues

**Problem**: Not receiving real-time updates when Claude modifies projects

**Checklist**:

1. **Verify MCP server is running**:

   ```bash
   cd packages/mcp-server
   pnpm start
   ```

2. **Check API key configuration**:
   - MCP server `.env` has `WS_API_KEY=ws_your_key_here`
   - VSCode settings has `claudeProjects.mcp.apiKey` with matching key

3. **Verify WebSocket URL**:
   - Default: `ws://localhost:8080/notifications`
   - Check `WS_PORT` in MCP server `.env` matches port in URL

4. **Check Output panel**:
   - Open VSCode Output panel (`Cmd+Shift+U` or `Ctrl+Shift+U`)
   - Select "Stoked Projects" from dropdown
   - Look for connection errors or authentication failures

5. **Test MCP server WebSocket**:
   ```bash
   # Test if WebSocket server is listening
   telnet localhost 8080
   # or
   curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
        "http://localhost:8080/notifications?apiKey=ws_your_key_here"
   ```

**Common Errors**:

- `WebSocket connection failed: ECONNREFUSED`
  - Solution: Start the MCP server (`pnpm start` in `packages/mcp-server`)

- `WebSocket authentication failed`
  - Solution: Verify API keys match between MCP server and VSCode settings

- `WebSocket closed with code 1006`
  - Solution: Check MCP server logs for errors; may indicate server crash or configuration issue

## Commands

| Command                                        | Description              |
| ---------------------------------------------- | ------------------------ |
| `Stoked Projects: Refresh Projects`            | Reload project data      |
| `Stoked Projects: View Active Claude Sessions` | List running sessions    |
| `Stoked Projects: Stop All Claude Sessions`    | Terminate all monitoring |

## Project Structure

```
stoked-projects-vscode/
├── src/
│   ├── extension.ts              # Extension entry point
│   ├── projects-view-provider.ts # Main UI provider
│   ├── github-api.ts             # GitHub GraphQL API
│   ├── phase-logic.ts            # Phase grouping logic
│   ├── claude-monitor.ts         # Auto-continuation monitor
│   └── cache-manager.ts          # Data caching
├── media/
│   ├── main.js                   # Webview UI logic
│   ├── style.css                 # Webview styles
│   └── extension-icon.png        # Extension icon
└── .claude-sessions/             # Session logs (gitignored)
```

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

UNLICENSED - Private use only
