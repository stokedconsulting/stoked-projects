# MCP Server Local Development Setup

This guide walks through setting up the Claude Projects MCP Server for local development with Claude Desktop.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Integration with Claude Desktop](#integration-with-claude-desktop)
- [Verification](#verification)
- [Next Steps](#next-steps)
- [Common Issues](#common-issues)

---

## Prerequisites

Before starting, ensure you have:

### Required Software

- **Node.js**: Version 18 or higher
  - Check: `node --version`
  - [Install Node.js](https://nodejs.org/)

- **pnpm**: Package manager
  - Check: `pnpm --version`
  - Install: `npm install -g pnpm`

- **Claude Desktop**: Latest version
  - [Download Claude Desktop](https://claude.ai/download)

- **Git**: For version control
  - Check: `git --version`

### Required Credentials

1. **GitHub Personal Access Token (PAT)**
   - Create at: https://github.com/settings/tokens
   - Required scopes:
     - `repo` - Full repository access
     - `read:org` - Read organization data
     - `read:project` - Read GitHub Projects
     - `project` - Project administration
   - Example token name: "Claude Projects Dev"
   - Keep this secure!

2. **State Tracking API Key**
   - Provided by Claude Projects team
   - Format: Usually a long string or UUID
   - Will be specified in your environment configuration

### Recommended: VSCode Extensions

- TypeScript support
- ESLint for code quality
- Prettier for formatting

---

## Installation

### Step 1: Clone or Navigate to Repository

```bash
# If not already in the project directory
cd /path/to/claude-projects-project-77
```

### Step 2: Run Automated Setup

The easiest way is to use our setup script:

```bash
cd deployment/scripts
./local-dev-setup.sh
```

This script will:
1. Check for prerequisites
2. Install dependencies
3. Build the MCP server
4. Create configuration files
5. Guide you through environment setup

**Skip to [Verification](#verification) if you use the setup script.**

### Step 3: Manual Setup (Alternative)

If you prefer manual setup:

#### 3a. Install Dependencies

```bash
cd packages/mcp-server
pnpm install
```

#### 3b. Build the Server

```bash
pnpm build
```

Verify the build succeeded:

```bash
ls -la dist/index.js
# Should show dist/index.js
```

#### 3c. Get the Absolute Path

```bash
pwd
# Output: /Users/username/path/to/claude-projects-project-77/packages/mcp-server
# You'll need this in the next section
```

---

## Configuration

### Step 1: Create .env File

Navigate to the MCP server directory:

```bash
cd packages/mcp-server
```

Copy the example file:

```bash
cp .env.example .env
```

### Step 2: Fill in Required Values

Edit the `.env` file with your credentials:

```bash
# Using your preferred editor
nano .env           # nano
vim .env            # vim
code .env           # VSCode
```

Or edit graphically if using an IDE.

#### Fill in these values:

```bash
# ==============================================================================
# REQUIRED: GitHub Token
# ==============================================================================
GITHUB_TOKEN=ghp_your_actual_token_here

# ==============================================================================
# REQUIRED: API Keys
# ==============================================================================
STATE_TRACKING_API_KEY=your-api-key-from-claude-projects-team
WS_API_KEY=generate-a-secure-random-string-32-characters-or-more

# ==============================================================================
# OPTIONAL: For Development
# ==============================================================================
NODE_ENV=development
LOG_LEVEL=debug
STATE_TRACKING_API_URL=http://localhost:3000

# If connecting to staging:
# STATE_TRACKING_API_URL=https://staging-api.claude-projects.example.com
```

### Step 3: Generate WS_API_KEY

Generate a secure random string for `WS_API_KEY`:

**macOS/Linux:**

```bash
openssl rand -hex 16
# or
head -c 32 /dev/urandom | base64
```

**Windows (PowerShell):**

```powershell
[Convert]::ToBase64String([byte[]](Get-Random -Count 32))
```

Copy the output and paste into `.env`:

```bash
WS_API_KEY=your-generated-string-here
```

### Step 4: Verify Configuration

Verify your `.env` file:

```bash
# Check required variables are set
grep -E "^(GITHUB_TOKEN|STATE_TRACKING_API_KEY|WS_API_KEY)=" .env

# Output should show all three set
```

---

## Integration with Claude Desktop

### Step 1: Locate Claude Desktop Config

Depending on your OS:

**macOS:**
```bash
~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**Linux:**
```bash
~/.config/Claude/claude_desktop_config.json
```

**Windows:**
```cmd
%APPDATA%\Claude\claude_desktop_config.json
```

### Step 2: Ensure Config Directory Exists

Create the directory if it doesn't exist:

**macOS/Linux:**
```bash
mkdir -p ~/Library/Application\ Support/Claude/
# or
mkdir -p ~/.config/Claude/
```

**Windows (PowerShell):**
```powershell
New-Item -ItemType Directory -Force -Path $env:APPDATA\Claude\
```

### Step 3: Configure MCP Server

Edit `claude_desktop_config.json` (create if it doesn't exist):

```json
{
  "mcpServers": {
    "claude-projects": {
      "command": "node",
      "args": [
        "dist/index.js"
      ],
      "cwd": "/absolute/path/to/packages/mcp-server",
      "env": {
        "NODE_ENV": "development",
        "STATE_TRACKING_API_KEY": "your-key-here",
        "WS_API_KEY": "your-ws-key-here",
        "GITHUB_TOKEN": "ghp_...",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

**IMPORTANT: Use the absolute path from Step 3c of Installation!**

Example paths:
- macOS: `/Users/username/work/claude-projects-project-77/packages/mcp-server`
- Linux: `/home/username/claude-projects/packages/mcp-server`
- Windows: `C:\Users\username\claude-projects\packages\mcp-server`

### Step 4: Restart Claude Desktop

1. Completely close Claude Desktop (quit from dock/taskbar)
2. Wait 2 seconds
3. Reopen Claude Desktop

You should see it starting the MCP server in the background.

---

## Verification

### Step 1: Check MCP Connection

In Claude Desktop:

1. Open the Developer Tools
   - **macOS**: Cmd+Shift+I
   - **Linux**: Ctrl+Shift+I
   - **Windows**: Ctrl+Shift+I

2. Go to the "MCP" tab

3. You should see "claude-projects" server listed

4. Status should show "Connected" (green dot)

### Step 2: Test a Tool

In a new Claude conversation, ask Claude to test the connection:

```
Can you use the health-check tool to verify the server is working?
```

Claude should respond with health check results.

### Step 3: Alternative Test Commands

Try any of these in Claude:

- `@health-check` - Test API connectivity
- `@list-issues` - List project issues
- `@read-project` - Read project details
- `@get-issue-details` - Get issue details

### Step 4: Check Logs

Monitor the server logs:

```bash
# Watch logs in real-time
tail -f /var/log/claude-projects-mcp-server.log

# Or check Claude Desktop logs:
# macOS: ~/Library/Logs/Claude/
# Linux: ~/.local/share/Claude/logs/
# Windows: %APPDATA%\Claude\logs\
```

---

## Next Steps

### Development Workflows

#### Hot Reload Development

Monitor for changes during development:

```bash
cd packages/mcp-server
pnpm watch
```

This rebuilds automatically when you change source files.

#### Running Tests

```bash
pnpm test
```

#### Linting Code

```bash
pnpm lint
```

### Updating Claude Desktop Config

After making changes to code:

1. The watcher auto-rebuilds (`pnpm watch`)
2. Restart Claude Desktop to load changes:
   - Close Claude: Cmd+Q (macOS) or Ctrl+Q (Linux) or Alt+F4 (Windows)
   - Reopen Claude

### Using with VSCode Extension

The MCP server integrates with the VSCode extension:

1. VSCode extension runs the VSCode side
2. MCP server runs as separate server process
3. WebSocket connects them for real-time updates

---

## Common Issues

### Issue: "Command Not Found: node"

**Cause**: Node.js not in PATH

**Solution**:
1. Check installation: `which node` or `node --version`
2. If not found, reinstall from https://nodejs.org/
3. Restart terminal/IDE

### Issue: "Cannot find module 'dotenv'"

**Cause**: Dependencies not installed

**Solution**:
```bash
cd packages/mcp-server
pnpm install
```

### Issue: "Port 8080 already in use"

**Cause**: Another process using the WebSocket port

**Solution**:
```bash
# Find process using port 8080
lsof -i :8080          # macOS/Linux
netstat -ano | findstr :8080  # Windows

# Kill the process
kill -9 <PID>          # macOS/Linux
taskkill /PID <PID> /F  # Windows

# Or change port in .env
WS_PORT=8081
```

### Issue: "API authentication failed"

**Cause**: Wrong or missing API key

**Solution**:
1. Verify API key in `.env`
2. Check key hasn't expired
3. Ensure `STATE_TRACKING_API_URL` is correct:
   - Development: `http://localhost:3000`
   - Or staging/production URL
4. Restart Claude Desktop

### Issue: "GITHUB_TOKEN not valid"

**Cause**: Token doesn't have required scopes or is expired

**Solution**:
1. Generate new token at https://github.com/settings/tokens
2. Add scopes: repo, read:org, read:project, project
3. Update `.env` with new token
4. Restart Claude

### Issue: MCP Server not appearing in Claude

**Cause**: Claude Desktop config not found or misconfigured

**Solution**:
1. Verify config file path is correct
2. Check JSON syntax: use JSON validator online
3. Verify absolute path to MCP server is correct
4. Check file permissions: `ls -la path/to/config.json`
5. Try restarting Claude Desktop completely

### Issue: Permission Denied when running setup script

**Cause**: Script not executable

**Solution**:
```bash
chmod +x deployment/scripts/local-dev-setup.sh
chmod +x deployment/scripts/health-check.sh
./deployment/scripts/local-dev-setup.sh
```

### Issue: Slow performance or timeouts

**Cause**: Network or API latency

**Solution**:
1. Increase timeout in `.env`:
   ```bash
   REQUEST_TIMEOUT_MS=30000  # 30 seconds
   ```
2. Check API server status
3. Check network connection
4. Monitor logs for errors:
   ```bash
   # In Developer Tools console, filter for errors
   ```

---

## Getting Help

### Documentation

- [Architecture Overview](../docs/mcp-integration.md)
- [Development Guide](../docs/mcp-development.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)

### Check Logs

```bash
# Claude Desktop logs location
# macOS
open ~/Library/Logs/Claude/

# Linux
ls ~/.local/share/Claude/logs/

# Windows
explorer %APPDATA%\Claude\logs\
```

### Report Issues

When reporting issues, include:

1. Output of `node --version` and `pnpm --version`
2. Error messages from:
   - Claude Desktop console (Cmd+Shift+I)
   - MCP server logs
3. Your `.env` file (without secrets)
4. Steps to reproduce

---

## Quick Reference Commands

```bash
# Setup
./deployment/scripts/local-dev-setup.sh

# Build
cd packages/mcp-server && pnpm build

# Watch (auto-rebuild)
pnpm watch

# Test
pnpm test

# Lint
pnpm lint

# Health check
node dist/tools/health-check.js

# Find MCP server path
pwd

# Verify .env
grep -E "^[A-Z_]+=" packages/mcp-server/.env
```

---

## Environment Variables Quick Guide

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `NODE_ENV` | No | development | Environment type |
| `STATE_TRACKING_API_KEY` | Yes | - | API authentication |
| `WS_API_KEY` | Yes | - | WebSocket auth |
| `GITHUB_TOKEN` | Yes | - | GitHub integration |
| `STATE_TRACKING_API_URL` | No | http://localhost:3000 | API endpoint |
| `LOG_LEVEL` | No | debug | Logging verbosity |
| `WS_PORT` | No | 8080 | WebSocket port |
| `REQUEST_TIMEOUT_MS` | No | 10000 | Request timeout |
| `RETRY_ATTEMPTS` | No | 3 | API retry count |

---

**You're all set!** 🎉

Start using the MCP server in Claude by referencing the available tools. For questions or issues, refer to the documentation above.
