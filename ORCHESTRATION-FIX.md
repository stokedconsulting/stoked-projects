# Orchestration Synchronization Fix

## Problem
The extension was only updating local state when you changed the "Workspace Desired" value. It wasn't calling the API, so:
- Global totals never updated
- Other IDE windows didn't see changes
- Values weren't persisted

## Solution
Implemented actual HTTP API calls to the state-tracking-API:

### Changes Made

1. **Added API methods** (`src/api-client.ts`):
   - `updateWorkspaceDesired()` - PUT to API
   - `getWorkspaceOrchestration()` - GET from API

2. **Added interface methods** (`src/github-api.ts`):
   - Same methods (throw error for direct GraphQL mode)

3. **Updated provider** (`src/projects-view-provider.ts`):
   - `updateOrchestrationDesired()` now calls `_githubAPI.updateWorkspaceDesired()`
   - Added `fetchOrchestrationData()` to get initial values on startup
   - Updates both workspace AND global values from API response

## How It Works Now

```
User changes "Workspace Desired" to 3
            ↓
Extension: PUT /api/orchestration/workspace/.../desired { desired: 3 }
            ↓
API: Updates MongoDB, calculates global totals from ALL workspaces
            ↓
API Response: {
  workspace: { running: 0, desired: 3 },
  global: { running: 5, desired: 8 }  ← Sum of ALL workspaces
}
            ↓
Extension: Updates UI immediately with response
            ↓
WebSocket: API broadcasts to other connected clients
            ↓
Other IDE Windows: Update their Global displays
```

## Testing

### 1. Start the API

```bash
cd packages/state-tracking-api

# Set MongoDB connection (or use default localhost)
export MONGODB_URI="mongodb://localhost:27017/claude-projects"

# Start API in dev mode
npm run start:dev
```

The API should start on `http://localhost:3000`

### 2. Configure Extension

**Option A: Use APIClient (HTTP mode)**

In VSCode Settings (`Cmd+,`):
```json
{
  "claudeProjects.useAPIService": true,
  "claudeProjects.apiBaseUrl": "http://localhost:3000"
}
```

**Option B: Direct GraphQL mode**
- Orchestration won't work in this mode
- You'll see an error in the Output panel

### 3. Reload VSCode

Press `Cmd+Shift+P` → "Developer: Reload Window"

### 4. Test Synchronization

**Single Window Test:**
1. Open the Claude Projects panel
2. Change "Workspace Desired" to 1
3. Watch "Global Desired" update to 1 **immediately**
4. Check Output panel (View → Output → Claude Projects) for API logs

**Multi-Window Test:**
1. Open VSCode Window A in folder `/Users/you/project-a`
2. Open VSCode Window B in folder `/Users/you/project-b`
3. In Window A: Set "Workspace Desired" to 2
   - Window A Global: should show 2
4. In Window B: Set "Workspace Desired" to 3
   - Window A Global: should update to 5
   - Window B Global: should show 5
5. Both windows should show: Global Desired = 5 (sum of 2 + 3)

### 5. API Test Script

Test the API directly:

```bash
# Test with default settings
./test-orchestration-api.sh

# Test with custom API URL and key
./test-orchestration-api.sh http://localhost:3000 your-api-key
```

Expected output:
```json
{
  "workspace": {
    "workspace_id": "/Users/test/workspace1",
    "running": 0,
    "desired": 3
  },
  "global": {
    "running": 0,
    "desired": 3
  }
}
```

## Troubleshooting

### Global Desired shows 0

**Check:**
1. Is the API running? Check `http://localhost:3000/health`
2. Is `useAPIService` set to `true` in settings?
3. Check Output panel for errors: View → Output → Claude Projects

**Fix:**
```bash
# Make sure API is running
cd packages/state-tracking-api
npm run start:dev

# Check MongoDB connection
echo $MONGODB_URI
# Should show: mongodb://localhost:27017/claude-projects
```

### "Orchestration not supported in direct GraphQL mode"

**Problem:** Extension is using GitHubAPI (direct GraphQL) instead of APIClient

**Fix:** Enable API service mode in VSCode settings:
```json
{
  "claudeProjects.useAPIService": true
}
```

### API returns authentication error

**Check API key configuration:**

```bash
# In packages/state-tracking-api/.env (or set environment variable)
API_KEYS=your-api-key-here

# The extension will send the GitHub token as the API key
# For development, you can allow any key by not setting API_KEYS
```

### WebSocket not connecting

WebSocket synchronization between IDE windows will be implemented separately. For now:
- Each window must manually refresh to see changes from other windows
- Click the refresh button in the orchestration panel
- Or reload the window: `Cmd+Shift+P` → "Reload Window"

## Verification Checklist

- [ ] API starts successfully: `npm run start:dev`
- [ ] MongoDB is running and accessible
- [ ] Extension settings have `useAPIService: true`
- [ ] VSCode window reloaded after changing settings
- [ ] Output panel shows API calls: `[Orchestration] Updating workspace...`
- [ ] Changing "Workspace Desired" updates "Global Desired" immediately
- [ ] API test script returns valid JSON responses
- [ ] Multiple windows show same global totals (after refresh)

## Next Steps

1. **Implement WebSocket in extension** - Real-time sync without refresh
2. **Add running count tracking** - Track actual LLM processes
3. **Add visual indicators** - Show when values are stale/syncing
4. **Error recovery** - Retry failed API calls
5. **Offline mode** - Queue updates when API is unavailable

## Files Changed

- ✅ `apps/code-ext/src/api-client.ts` - Added orchestration methods
- ✅ `apps/code-ext/src/github-api.ts` - Added interface methods
- ✅ `apps/code-ext/src/projects-view-provider.ts` - Implemented API calls
- ✅ `test-orchestration-api.sh` - Test script
- ✅ Extension builds successfully

## Architecture

```
┌─────────────────────┐
│ VSCode Extension    │
│ (API Client Mode)   │
└──────────┬──────────┘
           │ HTTP REST
           ▼
┌─────────────────────┐
│ State Tracking API  │
│ (NestJS + Express)  │
└──────────┬──────────┘
           │ Mongoose
           ▼
┌─────────────────────┐
│ MongoDB             │
│ orchestration coll  │
└─────────────────────┘
```

All workspace values are stored in MongoDB. Global totals are calculated by aggregating all workspace documents. The API returns both workspace and global data in every response, ensuring immediate synchronization.
