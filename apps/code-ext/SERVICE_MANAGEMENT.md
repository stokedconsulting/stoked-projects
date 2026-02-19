# Stoked Projects API Service Management

This document explains how the Stoked Projects extension manages the API service across different platforms.

## Overview

The extension automatically installs and manages a system-level API service that provides:
- Real-time WebSocket notifications for project updates
- State tracking for Claude AI sessions
- Centralized API for GitHub Projects operations

The service is **shared across all VSCode instances** on your machine, ensuring consistent state and efficient resource usage.

## Platform Support

### ✅ macOS (launchd)
- Service installed to: `~/Library/LaunchAgents/stoked-projects-api.plist`
- Logs: `~/Library/Logs/stoked-projects/`
- Auto-starts on login (if configured)

### ✅ Linux (systemd)
- Service installed to: `~/.config/systemd/user/stoked-projects-api.service`
- Logs: `~/.local/share/stoked-projects/logs/`
- Auto-starts on login (if configured)

### ✅ Windows (NSSM)
- Service installed to: Windows Service Manager
- Configuration: `%APPDATA%/stoked-projects/service-config.xml`
- Logs: `%APPDATA%/stoked-projects/logs/`
- **Requirement**: [NSSM](https://nssm.cc/) must be installed

## Automatic Configuration

### API Key
The extension automatically generates a cryptographically secure API key on first run. This key is:
- **Stored in VSCode globalState** (shared across all instances)
- **256-bit random hex string**
- **Automatically configured** for both the service and WebSocket client
- No manual configuration required

### Service Installation
On extension activation, the service manager:
1. Checks if the service is installed
2. Installs it if not present
3. Generates/retrieves the shared API key
4. Configures the service with the API key
5. Starts the service (if auto-start is enabled)

## Settings

All settings are prefixed with `claudeProjects.*`:

### Service Settings

#### `claudeProjects.service.autoStart`
- **Type**: boolean
- **Default**: `true`
- **Description**: Automatically start the API service when the extension activates

#### `claudeProjects.service.port`
- **Type**: number
- **Default**: `8167`
- **Description**: Port for the API service (requires service restart)

### MongoDB Settings

#### `claudeProjects.mongodb.mode`
- **Type**: enum (`local`, `atlas`, `custom`)
- **Default**: `local`
- **Description**: MongoDB connection mode

#### `claudeProjects.mongodb.atlas.username`
- **Type**: string
- **Description**: MongoDB Atlas username (only used when mode is 'atlas')

#### `claudeProjects.mongodb.atlas.password`
- **Type**: string
- **Description**: MongoDB Atlas password (only used when mode is 'atlas')

#### `claudeProjects.mongodb.atlas.cluster`
- **Type**: string
- **Description**: MongoDB Atlas cluster URL (only used when mode is 'atlas')

#### `claudeProjects.mongodb.customUri`
- **Type**: string
- **Default**: `mongodb://localhost:27017/stoked-projects`
- **Description**: Custom MongoDB URI (only used when mode is 'custom')

### Notification Settings

#### `claudeProjects.notifications.enabled`
- **Type**: boolean
- **Default**: `true`
- **Description**: Enable real-time WebSocket notifications

#### `claudeProjects.notifications.websocketUrl`
- **Type**: string
- **Default**: `ws://localhost:8167/notifications`
- **Description**: WebSocket URL for real-time notifications

## Service Management

### Viewing Logs

**macOS/Linux:**
```bash
# API service logs
tail -f ~/.stoked-projects/logs/api.log

# Error logs
tail -f ~/.stoked-projects/logs/api.error.log
```

**Windows:**
```powershell
# Open logs directory
explorer %APPDATA%\stoked-projects\logs
```

**VSCode:**
- Open Output panel: `View > Output`
- Select "Stoked Projects - API Service" from dropdown

### Manual Service Control

The service manager provides programmatic control, but you can also use system tools:

**macOS:**
```bash
# Check status
launchctl list | grep stoked-projects-api

# Stop service
launchctl stop stoked-projects-api

# Start service
launchctl start stoked-projects-api

# Unload service
launchctl unload ~/Library/LaunchAgents/stoked-projects-api.plist

# Load service
launchctl load ~/Library/LaunchAgents/stoked-projects-api.plist
```

**Linux:**
```bash
# Check status
systemctl --user status stoked-projects-api

# Stop service
systemctl --user stop stoked-projects-api

# Start service
systemctl --user start stoked-projects-api

# Restart service
systemctl --user restart stoked-projects-api

# Disable auto-start
systemctl --user disable stoked-projects-api

# Enable auto-start
systemctl --user enable stoked-projects-api

# View logs
journalctl --user -u stoked-projects-api -f
```

**Windows:**
```powershell
# Check status
nssm status stoked-projects-api

# Stop service
nssm stop stoked-projects-api

# Start service
nssm start stoked-projects-api

# Restart service
nssm restart stoked-projects-api
```

## Health Check

The service exposes a health check endpoint:

```bash
curl http://localhost:8167/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-01-24T10:30:00.000Z"
}
```

## Troubleshooting

### Service won't start

1. **Check logs** in the Output panel (`Stoked Projects - API Service`)
2. **Verify port is available**:
   ```bash
   # macOS/Linux
   lsof -i :8167

   # Windows
   netstat -ano | findstr :8167
   ```
3. **Check MongoDB connection** (if using local mode, ensure MongoDB is running)
4. **Reinstall service**: Uninstall and restart VSCode to trigger reinstallation

### WebSocket not connecting

1. **Verify service is running** (check health endpoint)
2. **Check WebSocket URL** in settings matches service port
3. **Verify API key** is generated (should happen automatically)
4. **Check firewall** isn't blocking localhost connections

### Windows: "NSSM is not installed"

Download and install NSSM from https://nssm.cc/download:
1. Download the latest release
2. Extract `nssm.exe` to a directory in your PATH (e.g., `C:\Windows\System32`)
3. Restart VSCode
4. Extension will detect NSSM and install the service

## Architecture

```
┌─────────────────────────────────────────────┐
│         VSCode Extension (User 1)           │
│  ┌────────────────────────────────────────┐ │
│  │   ApiServiceManager                    │ │
│  │   - Auto-install service               │ │
│  │   - Generate API key (globalState)     │ │
│  │   - Health monitoring                  │ │
│  └────────────────────────────────────────┘ │
└───────────────┬─────────────────────────────┘
                │
                │ WebSocket + HTTP
                │ (localhost:8167)
                │
                ▼
┌─────────────────────────────────────────────┐
│      System Service (stoked-projects-api)   │
│  ┌────────────────────────────────────────┐ │
│  │   NestJS API                           │ │
│  │   - WebSocket server (/notifications)  │ │
│  │   - REST API endpoints                 │ │
│  │   - MongoDB connection                 │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
                ▲
                │
                │ WebSocket + HTTP
                │ (shared API key)
                │
┌───────────────┴─────────────────────────────┐
│         VSCode Extension (User 2)           │
│  ┌────────────────────────────────────────┐ │
│  │   Uses same globalState API key       │ │
│  │   Connects to same service instance    │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## Security Notes

- **API key is local-only**: Never transmitted over the network
- **Service binds to localhost**: Not accessible from other machines
- **API key storage**: VSCode globalState (encrypted at rest by VSCode)
- **MongoDB credentials**: Stored in VSCode settings (consider using environment variables for production)

## Optimization Notes

### Extension Size

The current build includes the API's `node_modules` folder (~55 MB), which significantly increases extension size. Future optimizations:

1. **Bundle API separately**: Use webpack to create a standalone API bundle
2. **Download on demand**: Download API package from GitHub releases on first install
3. **Exclude dev dependencies**: Only include production dependencies

For now, this ensures the extension works out-of-the-box on all platforms.

## Migration from Old Configuration

If you have old `ghProjects.*` settings, they are no longer used. The new settings are:
- `ghProjects.notifications.*` → `claudeProjects.notifications.*`
- `ghProjects.mcp.apiKey` → (auto-managed, no manual configuration needed)

The extension will automatically generate and configure the API key on first run.
