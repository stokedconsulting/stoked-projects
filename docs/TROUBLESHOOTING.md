# Troubleshooting Guide

Comprehensive troubleshooting guide for all components of the Claude Projects system.

## Table of Contents

- [Quick Diagnostics](#quick-diagnostics)
- [VSCode Extension Issues](#vscode-extension-issues)
- [State Tracking API Issues](#api-issues)
- [MCP Server Issues](#mcp-server-issues)
- [GitHub Integration Issues](#github-integration-issues)
- [Performance Issues](#performance-issues)
- [Common Error Messages](#common-error-messages)
- [Debugging Tools](#debugging-tools)
- [Getting Help](#getting-help)

## Quick Diagnostics

### System Health Check

Run this quick check to diagnose common issues:

```bash
#!/bin/bash
# health-check.sh

echo "=== Claude Projects Health Check ==="

# Check Node.js
if command -v node &> /dev/null; then
  echo "✓ Node.js $(node --version)"
else
  echo "✗ Node.js not installed"
fi

# Check pnpm
if command -v pnpm &> /dev/null; then
  echo "✓ pnpm $(pnpm --version)"
else
  echo "✗ pnpm not installed"
fi

# Check GitHub CLI
if command -v gh &> /dev/null; then
  echo "✓ GitHub CLI $(gh --version | head -1)"
  gh auth status &> /dev/null && echo "  ✓ Authenticated" || echo "  ✗ Not authenticated"
else
  echo "✗ GitHub CLI not installed"
fi

# Check State Tracking API
if curl -s http://localhost:3000/health &> /dev/null; then
  echo "✓ State Tracking API is running"
else
  echo "✗ State Tracking API is not running"
fi

# Check MongoDB
if mongosh --eval "db.adminCommand('ping')" &> /dev/null; then
  echo "✓ MongoDB is accessible"
else
  echo "✗ MongoDB is not accessible"
fi
```

### Common Checks

**1. Check all services are running:**

```bash
# State Tracking API
curl http://localhost:3000/health

# MongoDB
mongosh --eval "db.adminCommand('ping')"

# VSCode Extension
# Open VSCode → View → Output → Claude Projects
```

**2. Check environment variables:**

```bash
# State Tracking API
cd packages/api
cat .env | grep -v "^#" | grep -v "^$"

# MCP Server
cd packages/mcp-server
cat .env | grep -v "^#" | grep -v "^$"
```

**3. Check logs:**

```bash
# State Tracking API logs
tail -f packages/api/logs/*.log

# VSCode Extension logs
# View → Output → Claude Projects

# MCP Server logs
tail -f deployment/logs/mcp-server.log
```

## VSCode Extension Issues

### Extension Not Loading

**Symptoms:**
- Extension doesn't appear in sidebar
- "Claude Projects" panel is missing
- Extension commands not available

**Diagnosis:**

```bash
# Check extension is installed
code --list-extensions | grep claude-projects

# Check for errors in extension host
# Open: Help → Toggle Developer Tools → Console
```

**Solutions:**

1. **Reload VSCode Window:**
   ```
   Cmd+Shift+P → "Developer: Reload Window"
   ```

2. **Reinstall Extension:**
   ```bash
   cd apps/code-ext
   pnpm run package
   code --install-extension claude-projects-*.vsix --force
   ```

3. **Check Extension Logs:**
   ```
   View → Output → Select "Claude Projects"
   ```

4. **Clear Extension Cache:**
   ```bash
   # macOS
   rm -rf ~/Library/Application\ Support/Code/User/workspaceStorage/*

   # Linux
   rm -rf ~/.config/Code/User/workspaceStorage/*
   ```

### Projects Not Showing

**Symptoms:**
- Extension loads but no projects appear
- "No projects found" message
- Projects panel is empty

**Diagnosis:**

```bash
# Check GitHub authentication
gh auth status

# Check repository has projects
gh project list --owner myorg --repo myrepo

# Check extension logs for errors
# View → Output → Claude Projects
```

**Solutions:**

1. **Authenticate with GitHub:**
   ```
   Cmd+Shift+P → "GitHub: Sign in"
   ```

2. **Grant GitHub Permissions:**
   - Go to GitHub → Settings → Applications
   - Find "Visual Studio Code"
   - Grant organization access if needed

3. **Check Repository:**
   ```bash
   # Verify you're in a git repository
   git remote -v

   # Check remote URL is correct
   git config --get remote.origin.url
   ```

4. **Clear Cache:**
   ```
   Click trash icon in Claude Projects panel
   Or: Cmd+Shift+P → "Claude Projects: Clear Cache"
   ```

### Extension Crashes

**Symptoms:**
- Extension stops responding
- VSCode becomes unresponsive
- Error messages in console

**Diagnosis:**

1. **Check Developer Console:**
   ```
   Help → Toggle Developer Tools → Console
   Look for red error messages
   ```

2. **Check Extension Host Process:**
   ```
   Cmd+Shift+P → "Developer: Show Running Extensions"
   ```

**Solutions:**

1. **Restart Extension Host:**
   ```
   Cmd+Shift+P → "Developer: Restart Extension Host"
   ```

2. **Disable Conflicting Extensions:**
   ```
   Cmd+Shift+P → "Extensions: Disable All Installed Extensions"
   Then enable one by one to find conflict
   ```

3. **Reset Extension State:**
   ```bash
   # Delete workspace state
   rm -rf ~/Library/Application\ Support/Code/User/workspaceStorage/*
   ```

### Auto-Refresh Not Working

**Symptoms:**
- Changes in GitHub not reflected in extension
- Signal files not triggering refresh
- Manual refresh required

**Diagnosis:**

```bash
# Check signal files exist
ls -la .claude-sessions/*.signal

# Check file watcher is active
# In extension logs, look for "Watching signal files"
```

**Solutions:**

1. **Check Signal Files:**
   ```bash
   # Create test signal file
   mkdir -p .claude-sessions
   echo '{"state":"idle"}' > .claude-sessions/test.signal

   # Watch for refresh in extension
   ```

2. **Restart File Watcher:**
   ```
   Reload VSCode window: Cmd+Shift+P → "Developer: Reload Window"
   ```

3. **Check File Permissions:**
   ```bash
   ls -la .claude-sessions/
   # Files should be readable by current user
   ```

## State Tracking API Issues

### API Won't Start

**Symptoms:**
- `npm run start:dev` fails
- Port already in use error
- MongoDB connection error

**Diagnosis:**

```bash
# Check port is available
lsof -i :3000

# Check MongoDB is running
mongosh --eval "db.adminCommand('ping')"

# Check environment variables
cd packages/api
cat .env | grep -E "^(MONGODB_URI|GITHUB_TOKEN|API_KEY)"
```

**Solutions:**

1. **Kill Process Using Port:**
   ```bash
   # Find process on port 3000
   lsof -i :3000

   # Kill it
   kill -9 <PID>

   # Or use different port
   echo "PORT=3001" >> .env
   ```

2. **Start MongoDB:**
   ```bash
   # Using Docker
   docker run -d -p 27017:27017 mongo:latest

   # Or local installation
   brew services start mongodb-community

   # Verify
   mongosh --eval "db.adminCommand('ping')"
   ```

3. **Fix Environment Variables:**
   ```bash
   # Copy example file
   cp .env.example .env

   # Edit with required values
   nano .env
   ```

### Authentication Errors

**Symptoms:**
- 401 Unauthorized responses
- "Invalid API key" errors
- "Token not found" errors

**Diagnosis:**

```bash
# Test API key
curl -H "X-API-Key: your_api_key" http://localhost:3000/api/github/health

# Check GitHub token
export GITHUB_TOKEN=ghp_your_token
gh auth status --hostname github.com
```

**Solutions:**

1. **Verify API Key:**
   ```bash
   # Check .env file
   grep API_KEY packages/api/.env

   # Update if needed
   echo "API_KEY=new_secure_key_here" >> .env
   ```

2. **Refresh GitHub Token:**
   ```bash
   # Refresh token scopes
   gh auth refresh -s repo,read:org,read:project,project

   # Get token
   gh auth token

   # Update .env
   echo "GITHUB_TOKEN=$(gh auth token)" >> .env
   ```

3. **Check Token Scopes:**
   ```bash
   # Verify token has required scopes
   curl -H "Authorization: token $GITHUB_TOKEN" \
     https://api.github.com/user | jq '.scopes'
   ```

### Rate Limiting Issues

**Symptoms:**
- "Rate limit exceeded" errors
- 429 Too Many Requests responses
- Slow API responses

**Diagnosis:**

```bash
# Check rate limit status
curl -H "X-API-Key: your_api_key" \
  http://localhost:3000/api/github/rate-limit

# Check GitHub API rate limit
gh api rate_limit
```

**Solutions:**

1. **Increase Cache TTL:**
   ```bash
   # In .env
   echo "CACHE_TTL=600" >> .env  # 10 minutes instead of 5
   ```

2. **Reduce Concurrent Requests:**
   ```bash
   # In .env
   echo "MAX_CONCURRENT_REQUESTS=5" >> .env
   ```

3. **Wait for Rate Limit Reset:**
   ```bash
   # Check when rate limit resets
   gh api rate_limit | jq '.rate.reset'

   # Convert to human-readable
   date -r $(gh api rate_limit | jq '.rate.reset')
   ```

### Database Connection Issues

**Symptoms:**
- "MongoDB connection failed"
- "Connection timeout"
- API starts but can't query data

**Diagnosis:**

```bash
# Test MongoDB connection
mongosh "$MONGODB_URI"

# Check MongoDB logs
docker logs mongodb-container

# Verify connection string format
echo $MONGODB_URI
# Should be: mongodb://localhost:27017/database-name
```

**Solutions:**

1. **Fix Connection String:**
   ```bash
   # Local MongoDB
   echo "MONGODB_URI=mongodb://localhost:27017/claude-projects" >> .env

   # MongoDB Atlas
   echo "MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/dbname" >> .env
   ```

2. **Check MongoDB Service:**
   ```bash
   # macOS
   brew services list | grep mongodb

   # Linux
   systemctl status mongod

   # Docker
   docker ps | grep mongo
   ```

3. **Create Database:**
   ```bash
   # Connect to MongoDB
   mongosh

   # Create database
   use claude-projects

   # Verify
   show dbs
   ```

## MCP Server Issues

See [MCP Server Troubleshooting](../deployment/TROUBLESHOOTING.md) for detailed MCP-specific issues.

**Quick Fixes:**

```bash
# Restart MCP Server
docker-compose restart mcp-server

# Check logs
docker-compose logs -f mcp-server

# Verify configuration
cat packages/mcp-server/.env

# Test health check
curl http://localhost:8080/health
```

## GitHub Integration Issues

### GraphQL Query Failures

**Symptoms:**
- "GraphQL errors" in logs
- Null responses from API
- "Resource not found" errors

**Diagnosis:**

```bash
# Test GraphQL query directly
gh api graphql -f query='
  query {
    viewer {
      login
    }
  }
'

# Check API logs for errors
tail -f packages/api/logs/error.log
```

**Solutions:**

1. **Verify Query Syntax:**
   ```graphql
   # Test query in GitHub GraphQL Explorer
   # https://docs.github.com/en/graphql/overview/explorer
   ```

2. **Check Permissions:**
   ```bash
   # Verify token has required scopes
   gh auth status

   # Refresh with correct scopes
   gh auth refresh -s repo,read:org,read:project,project
   ```

3. **Update Query:**
   ```typescript
   // Check for deprecated fields
   // Update GraphQL query to use current API version
   ```

### Organization Access Issues

**Symptoms:**
- "OAuth App access restrictions" error
- Organization projects not accessible
- 403 Forbidden for org resources

**Solutions:**

1. **Grant Organization Access:**
   - Go to: `https://github.com/organizations/YOUR_ORG/settings/oauth_application_policy`
   - Find "Visual Studio Code"
   - Click "Grant" to allow access

2. **Use Personal Access Token:**
   ```bash
   # Create token with org access
   # https://github.com/settings/tokens/new
   # Scopes: repo, read:org, read:project, project

   # Update .env
   echo "GITHUB_TOKEN=ghp_your_new_token" >> .env
   ```

### Project Linking Issues

**Symptoms:**
- Can't link project to repository
- "Link Project" button doesn't work
- Projects don't appear in correct view

**Diagnosis:**

```bash
# Check project ID and repository ID
gh api graphql -f query='
  query {
    repository(owner: "myorg", name: "myrepo") {
      id
    }
  }
'
```

**Solutions:**

1. **Verify IDs:**
   ```typescript
   // Check projectId and repositoryId are not null
   console.log('Project ID:', projectId);
   console.log('Repository ID:', repositoryId);
   ```

2. **Check Permissions:**
   ```bash
   # Need 'project' scope, not just 'read:project'
   gh auth refresh -s repo,read:org,read:project,project
   ```

3. **Clear Cache:**
   ```
   Click trash icon in extension
   Reload window
   ```

## Performance Issues

### Slow Extension Performance

**Symptoms:**
- Extension takes long to load
- UI feels sluggish
- High CPU usage

**Solutions:**

1. **Increase Cache TTL:**
   ```json
   // VSCode settings.json
   {
     "claudeProjects.cacheTTL": 600  // 10 minutes
   }
   ```

2. **Reduce Concurrent Requests:**
   ```typescript
   // Limit parallel project fetches
   const projects = await Promise.all(
     projectIds.slice(0, 5).map(fetchProject)
   );
   ```

3. **Optimize Webview:**
   ```javascript
   // Use virtual scrolling for large lists
   // Lazy load project items
   ```

### Slow API Responses

**Symptoms:**
- API requests take > 2 seconds
- Timeout errors
- High response times in logs

**Diagnosis:**

```bash
# Measure response time
time curl http://localhost:3000/api/github/projects?owner=myorg&repo=myrepo

# Check database query performance
# In MongoDB shell:
db.setProfilingLevel(2)
db.system.profile.find().sort({ts: -1}).limit(5)
```

**Solutions:**

1. **Add Database Indexes:**
   ```javascript
   // In schema files
   @Index({ sessionId: 1, timestamp: -1 })
   ```

2. **Enable Query Caching:**
   ```bash
   # In .env
   echo "ENABLE_QUERY_CACHE=true" >> .env
   ```

3. **Optimize GraphQL Queries:**
   ```graphql
   # Fetch only needed fields
   # Use pagination for large results
   # Avoid deep nested queries
   ```

### High Memory Usage

**Symptoms:**
- Process using > 500MB RAM
- Memory leaks
- System becomes slow

**Diagnosis:**

```bash
# Check memory usage
ps aux | grep node | grep -E "(api|mcp-server)"

# Use Node.js profiler
node --inspect packages/api/dist/main.js
# Then open chrome://inspect
```

**Solutions:**

1. **Reduce Cache Size:**
   ```bash
   # In .env
   echo "MAX_CACHE_SIZE=100" >> .env  # Limit cache entries
   ```

2. **Enable Garbage Collection:**
   ```bash
   # Run with GC flags
   node --expose-gc --max-old-space-size=512 dist/main.js
   ```

3. **Find Memory Leaks:**
   ```bash
   # Use heap snapshot
   node --inspect-brk dist/main.js
   # Take heap snapshots in Chrome DevTools
   ```

## Common Error Messages

### "No GitHub token found"

**Cause:** GitHub authentication not configured

**Solution:**
```bash
gh auth login
# Or set GITHUB_TOKEN in .env
```

### "Insufficient scopes"

**Cause:** GitHub token lacks required permissions

**Solution:**
```bash
gh auth refresh -s repo,read:org,read:project,project
```

### "MongoDB connection failed"

**Cause:** MongoDB not running or wrong connection string

**Solution:**
```bash
# Start MongoDB
brew services start mongodb-community

# Or update connection string
echo "MONGODB_URI=mongodb://localhost:27017/claude-projects" >> .env
```

### "Port 3000 already in use"

**Cause:** Another process using the port

**Solution:**
```bash
# Kill process
lsof -i :3000
kill -9 <PID>

# Or use different port
echo "PORT=3001" >> .env
```

### "Rate limit exceeded"

**Cause:** Too many GitHub API requests

**Solution:**
```bash
# Wait for reset
gh api rate_limit | jq '.rate.reset'

# Or increase cache TTL
echo "CACHE_TTL=600" >> .env
```

### "Workspace not a git repository"

**Cause:** VSCode opened in non-git folder

**Solution:**
```bash
# Initialize git
git init
git remote add origin https://github.com/owner/repo.git

# Or open correct folder in VSCode
```

## Debugging Tools

### VSCode Extension Debugging

1. **Open Extension Development Host:**
   ```
   F5 in VSCode (apps/code-ext folder)
   ```

2. **View Extension Logs:**
   ```
   View → Output → Select "Claude Projects"
   ```

3. **Inspect Webview:**
   ```
   Cmd+Shift+P → "Developer: Open Webview Developer Tools"
   ```

### API Debugging

1. **Enable Debug Logging:**
   ```bash
   echo "LOG_LEVEL=debug" >> .env
   ```

2. **Use Node Inspector:**
   ```bash
   node --inspect-brk dist/main.js
   # Open chrome://inspect
   ```

3. **Monitor Requests:**
   ```bash
   # Watch logs in real-time
   tail -f packages/api/logs/combined.log
   ```

### Network Debugging

1. **Monitor HTTP Requests:**
   ```bash
   # macOS/Linux
   tcpdump -i any -A port 3000 | grep -E "(GET|POST|PUT|DELETE)"
   ```

2. **Test Endpoints:**
   ```bash
   # Health check
   curl http://localhost:3000/health

   # Projects endpoint
   curl -H "X-API-Key: key" \
     "http://localhost:3000/api/github/projects?owner=o&repo=r"
   ```

### Database Debugging

1. **Query MongoDB:**
   ```bash
   mongosh
   use claude-projects
   db.sessions.find().pretty()
   ```

2. **Check Indexes:**
   ```bash
   db.sessions.getIndexes()
   ```

3. **Profile Slow Queries:**
   ```bash
   db.setProfilingLevel(2)
   db.system.profile.find({millis: {$gt: 100}})
   ```

## Getting Help

### Before Asking for Help

1. **Check this guide** for your specific issue
2. **Search existing issues** on GitHub
3. **Gather diagnostic information** (see below)
4. **Try basic troubleshooting steps** first

### Diagnostic Information to Provide

```bash
# System information
uname -a
node --version
pnpm --version
gh --version

# Service status
curl http://localhost:3000/health
mongosh --eval "db.adminCommand('ping')"

# Extension logs
# Copy from: View → Output → Claude Projects

# API logs
tail -100 packages/api/logs/error.log

# Configuration (redact secrets)
cat .env | sed 's/=.*/=REDACTED/'
```

### Where to Get Help

1. **GitHub Issues**: For bugs and feature requests
2. **Documentation**: Check all docs in `docs/` folder
3. **Stack Overflow**: Tag with `claude-projects`
4. **Team Chat**: Internal team channels

### Creating a Bug Report

Include:
- **Description**: What happened vs. what you expected
- **Steps to reproduce**: Detailed steps
- **Environment**: OS, Node version, etc.
- **Logs**: Relevant error logs (redact secrets)
- **Screenshots**: If UI issue

## Useful Commands Reference

```bash
# Health checks
curl http://localhost:3000/health
mongosh --eval "db.adminCommand('ping')"
gh auth status

# Start services
cd packages/api && pnpm run start:dev
brew services start mongodb-community

# View logs
tail -f packages/api/logs/*.log
docker-compose logs -f mcp-server

# Clear caches
rm -rf ~/Library/Application\ Support/Code/User/workspaceStorage/*
curl -X DELETE http://localhost:3000/api/cache

# Restart services
docker-compose restart
brew services restart mongodb-community

# Debugging
node --inspect-brk dist/main.js
LOG_LEVEL=debug pnpm run start:dev
```

---

**Last Updated**: 2026-01-24

For more information, see:
- [Architecture Guide](./ARCHITECTURE.md)
- [Developer Guide](./DEVELOPER_GUIDE.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [API Reference](./api-reference.md)
