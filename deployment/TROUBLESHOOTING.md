# MCP Server Troubleshooting Guide

Common issues and solutions for the Claude Projects MCP Server.

## Table of Contents

- [Startup Issues](#startup-issues)
- [Configuration Issues](#configuration-issues)
- [API Connectivity](#api-connectivity)
- [Claude Desktop Integration](#claude-desktop-integration)
- [Performance Issues](#performance-issues)
- [Docker Issues](#docker-issues)
- [Advanced Debugging](#advanced-debugging)
- [Getting Help](#getting-help)

---

## Startup Issues

### Server Won't Start

#### Error: "Required environment variable not set"

**Problem**: Missing required environment variables

**Diagnosis**:
```bash
# Check which variables are missing
echo $STATE_TRACKING_API_KEY
echo $WS_API_KEY
```

**Solution**:
1. Check `.env` file exists:
   ```bash
   ls -la packages/mcp-server/.env
   ```
2. Verify all required variables are set:
   ```bash
   # Should show values, not empty
   grep STATE_TRACKING_API_KEY packages/mcp-server/.env
   grep WS_API_KEY packages/mcp-server/.env
   ```
3. Reload environment:
   ```bash
   # Close and reopen terminal/Claude
   # Or source the .env file
   source packages/mcp-server/.env
   ```

#### Error: "Cannot find module"

**Problem**: Dependencies not installed or built

**Diagnosis**:
```bash
# Check if dist directory exists
ls -la packages/mcp-server/dist/
```

**Solution**:
```bash
cd packages/mcp-server
pnpm install
pnpm build
```

#### Error: "Port already in use"

**Problem**: WebSocket port (8080) already in use

**Diagnosis**:
```bash
# Check what's using port 8080
lsof -i :8080        # macOS/Linux
netstat -ano | findstr :8080  # Windows
```

**Solution**:
```bash
# Option 1: Kill the process
kill -9 <PID>        # macOS/Linux
taskkill /PID <PID> /F  # Windows

# Option 2: Change port in .env
echo "WS_PORT=8081" >> packages/mcp-server/.env
```

### Server Starts but Crashes

#### Error: "Cannot read property 'X' of undefined"

**Problem**: Configuration parsing error

**Diagnosis**:
```bash
# Check .env file format
cat packages/mcp-server/.env

# Check for syntax errors
# Should be KEY=VALUE format
```

**Solution**:
1. Verify `.env` format:
   ```bash
   # Should look like:
   # STATE_TRACKING_API_KEY=your-key
   # WS_API_KEY=your-key
   ```
2. No spaces around `=`:
   ```bash
   # Wrong: STATE_TRACKING_API_KEY = your-key
   # Right: STATE_TRACKING_API_KEY=your-key
   ```
3. Check for special characters in values:
   ```bash
   # Escape if needed
   export STATE_TRACKING_API_KEY="value-with-special-chars"
   ```

#### Error: "SIGTERM" or "SIGKILL"

**Problem**: Process being terminated by system

**Diagnosis**:
```bash
# Check system logs
dmesg | grep -i killed  # Linux
log stream --level=error --predicate 'eventMessage contains[cd] "killed"'  # macOS
```

**Solution**:
1. Check memory usage:
   ```bash
   ps aux | grep node
   # Look at RSS (memory) column
   ```
2. If high, increase memory:
   ```bash
   # For Docker
   # Increase memory limit in docker-compose.yml
   ```
3. Check available system resources:
   ```bash
   free -h      # Linux
   vm_stat      # macOS
   ```

---

## Configuration Issues

### Invalid Configuration

#### Error: "Invalid log level"

**Problem**: Invalid LOG_LEVEL value

**Valid values**: debug, info, warn, error

**Solution**:
```bash
# Fix in .env
echo "LOG_LEVEL=info" > packages/mcp-server/.env
```

#### Error: "Invalid port number"

**Problem**: Port outside valid range (1-65535)

**Solution**:
```bash
# Set valid port
echo "WS_PORT=8080" >> packages/mcp-server/.env
```

#### Error: "Invalid request timeout"

**Problem**: REQUEST_TIMEOUT_MS is not positive number

**Solution**:
```bash
# Must be positive integer in milliseconds
echo "REQUEST_TIMEOUT_MS=10000" >> packages/mcp-server/.env
```

### Configuration Not Loaded

#### Problem: Changes to .env not taking effect

**Diagnosis**:
```bash
# Check if process is using old config
ps aux | grep node

# Check what environment variables process sees
cat /proc/<PID>/environ | tr '\0' '\n' | grep STATE_TRACKING
```

**Solution**:
1. Restart the server:
   ```bash
   # For Claude Desktop, completely quit and reopen
   # For Docker
   docker-compose restart mcp-server
   ```
2. Verify file was saved:
   ```bash
   cat packages/mcp-server/.env
   ```
3. Check file permissions:
   ```bash
   ls -la packages/mcp-server/.env
   # Should be readable by current user
   ```

---

## API Connectivity

### Cannot Connect to API

#### Error: "ECONNREFUSED" or "Connection refused"

**Problem**: Cannot reach API server

**Diagnosis**:
```bash
# Test connectivity to API
curl -v https://api.claude-projects.example.com

# Check DNS resolution
nslookup api.claude-projects.example.com
```

**Solution**:
1. Verify API URL in `.env`:
   ```bash
   grep STATE_TRACKING_API_URL packages/mcp-server/.env
   ```
2. Check if API is running:
   ```bash
   curl https://api.claude-projects.example.com/health
   ```
3. Check network connectivity:
   ```bash
   ping api.claude-projects.example.com
   ```
4. Check firewall:
   ```bash
   # On server: check port is listening
   netstat -tlnp | grep :3000
   ```

#### Error: "ETIMEDOUT" or "Request timeout"

**Problem**: API response too slow

**Diagnosis**:
```bash
# Measure response time
curl -w "@curl-format.txt" -o /dev/null -s https://api.claude-projects.example.com/health

# Check server load
top -n 1 | head -15
```

**Solution**:
1. Increase timeout:
   ```bash
   echo "REQUEST_TIMEOUT_MS=30000" >> packages/mcp-server/.env
   ```
2. Check API server health:
   ```bash
   curl https://api.claude-projects.example.com/health
   ```
3. Monitor server resources
4. Check network latency:
   ```bash
   ping -c 5 api.claude-projects.example.com
   ```

### Authentication Failed

#### Error: "401 Unauthorized"

**Problem**: Invalid API key

**Diagnosis**:
```bash
# Check key is not empty
test -n "$STATE_TRACKING_API_KEY" && echo "Key is set" || echo "Key is empty"

# Check key format
echo $STATE_TRACKING_API_KEY | wc -c
```

**Solution**:
1. Verify key in `.env`:
   ```bash
   # Should not be "your-api-key-here" or placeholder
   grep -v "^#" packages/mcp-server/.env | grep STATE_TRACKING_API_KEY
   ```
2. Get correct key from admin/dashboard
3. Update `.env` and restart
4. Test API key:
   ```bash
   curl -H "Authorization: Bearer $STATE_TRACKING_API_KEY" \
     https://api.claude-projects.example.com/health
   ```

#### Error: "403 Forbidden"

**Problem**: Key doesn't have required permissions

**Solution**:
1. Check key scopes/permissions with admin
2. Generate new key with required permissions
3. Update `.env` with new key
4. Restart server

### API Response Issues

#### Error: "500 Internal Server Error"

**Problem**: API server error

**Diagnosis**:
```bash
# Check API server logs
ssh api-server
tail -f /var/log/api-server.log

# Test API directly
curl -v https://api.claude-projects.example.com/projects
```

**Solution**:
1. Retry with increased timeout:
   ```bash
   echo "RETRY_ATTEMPTS=5" >> packages/mcp-server/.env
   ```
2. Contact API administrator
3. Check API server status page
4. Wait for server recovery

---

## Claude Desktop Integration

### MCP Server Not Listed

#### Problem: "claude-projects" server not showing in MCP tab

**Diagnosis**:
```bash
# Check config file exists
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Check JSON syntax
jq . ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**Solution**:
1. Verify config file path:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Linux: `~/.config/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Check JSON syntax:
   ```bash
   # Use online JSON validator
   # Ensure proper quotes and commas
   ```

3. Verify absolute path to MCP server:
   ```bash
   pwd  # From packages/mcp-server directory
   # Use this exact path in config
   ```

4. Restart Claude Desktop completely:
   - Quit from dock/app menu
   - Wait 2 seconds
   - Reopen

### Server Shows but Connection Failed

#### Problem: "MCP server disconnected" in Claude

**Diagnosis**:
```bash
# Check server is actually running
ps aux | grep "node.*dist/index.js"

# Check logs if running in terminal
# Look for errors in output
```

**Solution**:
1. Check `.env` file:
   ```bash
   cat packages/mcp-server/.env | grep -E "^(NODE_ENV|STATE_TRACKING_API_KEY|WS_API_KEY)"
   ```

2. Check required variables are set:
   ```bash
   [ -z "$STATE_TRACKING_API_KEY" ] && echo "Missing API KEY"
   [ -z "$WS_API_KEY" ] && echo "Missing WS KEY"
   ```

3. Try running server directly:
   ```bash
   cd packages/mcp-server
   node dist/index.js
   # Check for error messages
   ```

4. Check logs in Claude:
   - Dev Tools (Cmd+Shift+I)
   - Console tab
   - Look for error messages

### Tool Not Available

#### Problem: Tool shows in list but won't execute

**Diagnosis**:
```bash
# Check server logs for errors
tail -f /var/log/mcp-server.log

# Test tool directly
# In Claude, try: @health-check
```

**Solution**:
1. Verify tool is enabled in config:
   ```bash
   grep -A 2 '"health-check"' packages/mcp-server/mcp-server-config.json
   ```

2. Check server logs for tool execution errors

3. Verify API connectivity (health-check test)

4. Restart Claude and retry

---

## Performance Issues

### High CPU Usage

#### Problem: Server consuming excessive CPU

**Diagnosis**:
```bash
# Check CPU usage
top -p $(pgrep -f "node.*dist/index.js")

# Monitor over time
watch -n 1 'top -p $(pgrep -f "node.*dist/index.js") -b -n 1'
```

**Solution**:
1. Check for infinite loops in logs
2. Monitor request volume
3. Restart server:
   ```bash
   docker-compose restart mcp-server
   ```
4. Check API server performance
5. Profile if issue persists

### High Memory Usage

#### Problem: Server consuming excessive memory

**Diagnosis**:
```bash
# Check memory usage
ps aux | grep "node.*dist/index.js"
# Look at RSS column

# Monitor memory over time
watch -n 1 'ps aux | grep "node.*dist/index.js"'

# Check for memory leaks
node --inspect dist/index.js
# Then use Chrome DevTools
```

**Solution**:
1. Restart server:
   ```bash
   docker-compose restart mcp-server
   ```

2. Reduce caching:
   ```bash
   # In mcp-server-config.json
   # Set cacheTtl to lower value or disable
   ```

3. Increase available memory
4. Profile with Chrome DevTools if issue persists

### Slow Response Time

#### Problem: Tools executing slowly

**Diagnosis**:
```bash
# Measure response time in Claude console
# Look for timing information

# Check server logs for slow queries
grep "ms" /var/log/mcp-server.log
```

**Solution**:
1. Increase timeout:
   ```bash
   echo "REQUEST_TIMEOUT_MS=20000" >> packages/mcp-server/.env
   ```

2. Check API server performance

3. Monitor network latency

4. Cache more aggressively:
   ```bash
   # In mcp-server-config.json
   # Increase cacheTtl
   ```

---

## Docker Issues

### Container Won't Start

#### Error: "Docker: command not found"

**Solution**:
1. Install Docker:
   ```bash
   # macOS
   brew install docker

   # Linux
   sudo apt-get install docker.io

   # Windows
   # Download Docker Desktop
   ```

2. Start Docker daemon:
   ```bash
   # macOS
   open /Applications/Docker.app

   # Linux
   sudo systemctl start docker
   ```

#### Error: "Cannot connect to Docker daemon"

**Solution**:
```bash
# Check Docker is running
docker ps

# If not running:
# macOS: open /Applications/Docker.app
# Linux: sudo systemctl start docker

# Check permissions:
# Linux: sudo usermod -aG docker $USER
```

### Container Exits Immediately

#### Diagnosis**:
```bash
# Check container logs
docker-compose logs mcp-server

# Check exit code
docker-compose ps | grep mcp-server
```

**Solution**:
```bash
# Check environment variables
docker-compose exec mcp-server env | grep STATE_TRACKING

# Run with verbose logging
LOG_LEVEL=debug docker-compose up mcp-server
```

### Health Check Failing

#### Problem: Container marked as "unhealthy"

**Diagnosis**:
```bash
# Check health check command
docker-compose exec mcp-server node dist/tools/health-check.js

# Check container health details
docker inspect claude-projects-mcp-server --format='{{json .State.Health}}'
```

**Solution**:
1. Run health check manually:
   ```bash
   docker-compose exec mcp-server node dist/tools/health-check.js
   ```

2. Check API connectivity from container:
   ```bash
   docker-compose exec mcp-server curl -v $STATE_TRACKING_API_URL/health
   ```

3. Increase health check timeout:
   ```bash
   # In docker-compose.yml
   healthcheck:
     timeout: 15s
   ```

### Volume Permission Issues

#### Error: "Permission denied" writing to volumes

**Solution**:
```bash
# Fix volume permissions
sudo chown -R $(id -u):$(id -g) deployment/logs/

# Or run container with different user
# In docker-compose.yml
user: "1000:1000"
```

---

## Advanced Debugging

### Enable Debug Logging

```bash
# In .env
LOG_LEVEL=debug

# In docker-compose.yml
environment:
  LOG_LEVEL: debug

# Restart and check logs
docker-compose logs -f mcp-server
```

### Inspect Running Process

```bash
# List processes
ps aux | grep node

# Attach debugger
node --inspect=0.0.0.0:9229 dist/index.js

# Then open chrome://inspect in Chrome
```

### Monitor Network Traffic

```bash
# macOS/Linux
tcpdump -i any -A port 8080

# More readable
tcpdump -i any -A port 8080 | grep -A 10 "POST"
```

### Check System Resources

```bash
# Overall system status
top

# Disk usage
df -h

# Memory
free -h        # Linux
vm_stat        # macOS

# Network
netstat -an | grep :8080
```

### Database Queries (if applicable)

```bash
# Check slow queries
docker-compose exec postgres tail -f /var/log/postgresql/slow_queries.log

# Or check logs
docker-compose logs postgres
```

---

## Getting Help

### Gathering Debug Information

When reporting issues, provide:

1. **Version info**:
   ```bash
   node --version
   pnpm --version
   docker --version
   ```

2. **Configuration** (without secrets):
   ```bash
   # Redact API keys
   cat packages/mcp-server/.env | sed 's/=.*/=REDACTED/'
   ```

3. **Error logs**:
   ```bash
   # Claude Desktop logs
   docker-compose logs mcp-server

   # Or Claude Desktop console
   # Cmd+Shift+I → Console tab
   ```

4. **System info**:
   ```bash
   uname -a
   docker ps
   ```

### Useful Commands Reference

```bash
# Build and start
cd deployment && docker-compose build && docker-compose up -d

# View logs
docker-compose logs -f mcp-server

# Health check
./deployment/scripts/health-check.sh --verbose

# Environment check
docker-compose exec mcp-server env | sort

# API connectivity test
docker-compose exec mcp-server curl -v $STATE_TRACKING_API_URL/health

# Restart services
docker-compose restart

# Stop services
docker-compose down

# Full cleanup
docker-compose down -v
```

### Documentation Links

- [Setup Guide](./SETUP.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Architecture](../docs/mcp-integration.md)
- [Development](../docs/mcp-development.md)

---

## Quick Checklist

- [ ] Node.js 18+ installed
- [ ] Dependencies installed: `pnpm install`
- [ ] Server built: `pnpm build`
- [ ] `.env` file exists with all required variables
- [ ] API key is valid and not empty
- [ ] Port 8080 is available
- [ ] Claude Desktop config points to correct path
- [ ] Claude Desktop restarted after config changes
- [ ] MCP server shows in Claude's MCP tab
- [ ] Health check tool works

If all checks pass but issues persist, refer to advanced debugging section.
