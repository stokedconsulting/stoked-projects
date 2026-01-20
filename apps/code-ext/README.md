# Claude Projects for VS Code

<p align="center">
  <img src="media/extension-icon.png" alt="Claude Projects Logo" width="128" height="128">
</p>

<p align="center">
  <strong>Integrate GitHub Projects directly into VS Code with AI-powered automation</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#prerequisites">Prerequisites</a> •
  <a href="#usage">Usage</a> •
  <a href="#configuration">Configuration</a>
</p>

---

## What is Claude Projects?

Claude Projects brings GitHub Projects (V2) directly into your VS Code sidebar. View your project boards, update item statuses, and organize work by phases — all without leaving your editor. Plus, leverage Claude AI orchestration with auto-continuation for seamless project execution.

## Features

### 📊 GitHub Projects Integration
- **View Projects** - Browse repository and organization projects in the sidebar
- **Phase Organization** - Items automatically grouped by phase prefixes (`[Phase 1]`, `[P1.1]`)
- **Inline Status Updates** - Change item status directly from VS Code
- **Auto-Sync** - Phase master items automatically update based on work item progress
- **Filter Controls** - Toggle visibility of completed items

### 🤖 Claude AI Orchestration
- **One-Click Start** - Launch Claude sessions tied to specific projects
- **Auto-Continuation** - Monitors for stalled sessions and sends continuation prompts
- **Session Logging** - Complete audit trails in `.claude-sessions/`
- **Multi-Session Support** - Run multiple project sessions concurrently

### ⚡ Smart Automation
- **Auto-Close Issues** - GitHub issues automatically close when marked Done
- **Cache System** - Instant loading with smart background refresh
- **Optimistic Updates** - Immediate UI feedback while syncing

## Installation

### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions (`Cmd+Shift+X` / `Ctrl+Shift+X`)
3. Search for "Claude Projects"
4. Click **Install**

### From Source
```bash
git clone https://github.com/stokedconsulting/gh-projects-vscode.git
cd gh-projects-vscode
npm install
npm run compile
```

Then press `F5` to run in Extension Development Host.

## Prerequisites

Before using Claude Projects, ensure you have:

| Requirement | Description |
|-------------|-------------|
| **VS Code** | Version 1.96.0 or higher |
| **GitHub Account** | With access to GitHub Projects (V2) |
| **Git Repository** | Workspace must contain a git repo with GitHub remote |
| **Claude CLI** | *(Optional)* Required for AI orchestration features |

### GitHub Authentication

The extension uses VS Code's built-in GitHub authentication. On first use:
1. You'll be prompted to authorize VS Code
2. Grant access to your repositories and projects
3. Authentication persists across sessions

## Usage

### Viewing Projects

1. Open a folder containing a GitHub repository
2. Look for the **Claude Projects** panel in the bottom panel area
3. Click on the **Claude Projects** tab (the title shows your org or repository name)

The extension automatically discovers:
- Projects linked to your repository
- Organization-level projects (if accessible)

### Managing Items

| Action | How |
|--------|-----|
| **View on GitHub** | Click any project or item title |
| **Change Status** | Use the status dropdown next to each item |
| **Delete Item** | Click the 🗑️ button |
| **Mark Phase Done** | Click ✓ on any phase header |
| **Refresh Data** | Click the 🔄 button in the toolbar |

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
- `Cmd+Shift+P` → *Claude Projects: View Active Claude Sessions*
- `Cmd+Shift+P` → *Claude Projects: Stop All Claude Sessions*

## Configuration

### Extension Settings

Currently, the extension uses sensible defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| Inactivity Threshold | 60 seconds | Time before sending continuation prompt |
| Check Interval | 10 seconds | How often to check for Claude activity |

Future versions will expose these as configurable VS Code settings.

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

## Commands

| Command | Description |
|---------|-------------|
| `Claude Projects: Refresh Projects` | Reload project data |
| `Claude Projects: View Active Claude Sessions` | List running sessions |
| `Claude Projects: Stop All Claude Sessions` | Terminate all monitoring |

## Project Structure

```
gh-projects-vscode/
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

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with ❤️ for seamless GitHub Projects integration
</p>
