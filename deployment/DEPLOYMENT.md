# MCP Server Deployment Guide

This guide covers deploying the Claude Projects MCP Server in development, staging, and production environments.

## Table of Contents

- [Quick Start](#quick-start)
- [Local Development](#local-development)
- [Staging Deployment](#staging-deployment)
- [Production Deployment](#production-deployment)
- [Docker Deployment](#docker-deployment)
- [Environment Configuration](#environment-configuration)
- [Health Checks & Monitoring](#health-checks--monitoring)
- [Troubleshooting](#troubleshooting)
- [Graceful Shutdown](#graceful-shutdown)

---

## Quick Start

### Option 1: Local Development (Recommended for Development)

```bash
cd deployment/scripts
./local-dev-setup.sh
```

This will:
1. Install dependencies
2. Build the MCP server
3. Configure Claude Desktop
4. Guide you through environment setup

### Option 2: Docker Development

```bash
cd deployment
docker-compose up
```

### Option 3: Production Deployment

```bash
cd deployment/scripts
./deploy.sh production --build --push --registry docker.io/mycompany
```

---

## Local Development

### Prerequisites

- Node.js 18+
- pnpm
- Claude Desktop installed
- GitHub PAT with repo scopes

### Setup Steps

1. **Run the setup script:**

```bash
./deployment/scripts/local-dev-setup.sh
```

2. **Configure environment:**

Edit `packages/mcp-server/.env`:

```bash
cp packages/mcp-server/.env.example packages/mcp-server/.env
```

Required variables:
- `STATE_TRACKING_API_KEY`: Your API key
- `WS_API_KEY`: Secure random string (32+ characters)
- `GITHUB_TOKEN`: GitHub PAT with repo, read:org, read:project scopes

3. **Build the server:**

```bash
cd packages/mcp-server
pnpm install
pnpm build
```

4. **Update Claude Desktop config:**

Find your Claude Desktop config file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add or update:

```json
{
  "mcpServers": {
    "claude-projects": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/packages/mcp-server",
      "env": {
        "NODE_ENV": "development",
        "STATE_TRACKING_API_KEY": "your-key",
        "WS_API_KEY": "your-ws-key",
        "GITHUB_TOKEN": "ghp_...",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

5. **Restart Claude Desktop**

6. **Verify in Claude:**
   - Open Developer Tools (Cmd+Shift+I)
   - Check MCP tab
   - Test with: `@health-check`

### Development Commands

```bash
# Watch mode - auto-rebuild on changes
cd packages/mcp-server
pnpm watch

# Run tests
pnpm test

# Lint code
pnpm lint
```

---

## Staging Deployment

### Prerequisites

- Docker and Docker Compose
- Access to staging API server
- Staging database credentials
- GitHub PAT for staging environment

### Deployment Steps

1. **Create environment config:**

```bash
mkdir -p deployment/config
cat > deployment/config/.env.staging << EOF
NODE_ENV=staging
STATE_TRACKING_API_URL=https://staging-api.claude-projects.example.com
STATE_TRACKING_API_KEY=staging-key-here
WS_API_KEY=staging-ws-key-here
GITHUB_TOKEN=staging-github-token
LOG_LEVEL=info
REQUEST_TIMEOUT_MS=15000
RETRY_ATTEMPTS=5
WS_PORT=8080
WS_HOST=0.0.0.0
EOF
```

2. **Deploy with Docker Compose:**

```bash
cd deployment
./scripts/deploy.sh staging --build
```

3. **Enable reverse proxy for SSL:**

```bash
docker-compose --profile with-proxy up -d
```

4. **Monitor deployment:**

```bash
./scripts/health-check.sh --interval 30
```

5. **View logs:**

```bash
docker-compose logs -f mcp-server
```

### Staging Configuration

| Setting | Value |
|---------|-------|
| Log Level | `info` |
| Request Timeout | 15s |
| Retry Attempts | 5 |
| API URL | Staging endpoint |
| Port | 8080 |
| Host | 0.0.0.0 |

---

## Production Deployment

### Prerequisites

- Production Docker registry access
- Production API credentials
- Production database access
- GitHub PAT for production
- SSL certificates
- Domain name
- Monitoring and alerting setup

### Pre-Deployment Checklist

- [ ] All environment variables configured
- [ ] API credentials secured in secrets management
- [ ] SSL certificates obtained
- [ ] Monitoring configured
- [ ] Backup procedures tested
- [ ] Graceful shutdown tested
- [ ] Health checks verified
- [ ] Rate limiting configured
- [ ] CORS settings reviewed
- [ ] Authentication verified

### Deployment Steps

1. **Create production environment:**

```bash
mkdir -p deployment/config
cat > deployment/config/.env.production << EOF
NODE_ENV=production
STATE_TRACKING_API_URL=https://api.claude-projects.example.com
STATE_TRACKING_API_KEY=${PRODUCTION_API_KEY}
WS_API_KEY=${PRODUCTION_WS_KEY}
GITHUB_TOKEN=${PRODUCTION_GITHUB_TOKEN}
LOG_LEVEL=warn
REQUEST_TIMEOUT_MS=20000
RETRY_ATTEMPTS=5
WS_PORT=8080
WS_HOST=0.0.0.0
GRACEFUL_SHUTDOWN_TIMEOUT=90000
EOF
```

2. **Build and push image:**

```bash
cd deployment/scripts
./deploy.sh production \
  --build \
  --push \
  --registry docker.io/mycompany \
  --version 1.0.0
```

3. **Deploy to production:**

```bash
cd deployment
NODE_ENV=production docker-compose --profile with-proxy --profile with-cache up -d
```

4. **Verify deployment:**

```bash
./scripts/health-check.sh --verbose
```

5. **Monitor services:**

```bash
docker-compose logs -f mcp-server nginx
```

### Production Configuration

| Setting | Value |
|---------|-------|
| Log Level | `warn` |
| Request Timeout | 20s |
| Retry Attempts | 5 |
| API URL | Production endpoint |
| Port | 8080 (behind proxy) |
| Host | 0.0.0.0 |
| Graceful Shutdown | 90s |
| Memory Limit | 512MB |
| CPU Limit | 1 core |

### Production Features

- **Reverse Proxy**: Nginx for SSL termination and load balancing
- **Caching**: Redis for performance optimization
- **Monitoring**: Built-in health checks
- **Logging**: Structured JSON logging to file
- **Auto-restart**: Container restart on failure
- **Resource Limits**: CPU and memory constraints
- **Security**: Non-root user, no new privileges

---

## Docker Deployment

### Building Docker Image

#### Local Build

```bash
cd deployment
docker build -t claude-projects-mcp-server:latest -f Dockerfile ..
```

#### With Docker Compose

```bash
cd deployment
docker-compose build
```

#### Production Build

```bash
docker build \
  --no-cache \
  -t claude-projects-mcp-server:1.0.0 \
  -f deployment/Dockerfile \
  .
```

### Running Container

#### Development

```bash
docker run \
  --rm \
  -e NODE_ENV=development \
  -e STATE_TRACKING_API_KEY=dev-key \
  -e WS_API_KEY=dev-ws-key \
  -e GITHUB_TOKEN=ghp_... \
  -p 8080:8080 \
  claude-projects-mcp-server:latest
```

#### Production

```bash
docker run \
  --detach \
  --restart unless-stopped \
  --name mcp-server \
  -e NODE_ENV=production \
  -e STATE_TRACKING_API_KEY=prod-key \
  -e WS_API_KEY=prod-ws-key \
  -e GITHUB_TOKEN=ghp_... \
  -p 8080:8080 \
  -v /app/logs:/app/logs \
  --health-cmd="node dist/tools/health-check.js" \
  --health-interval=30s \
  --health-timeout=10s \
  --health-retries=3 \
  --health-start-period=40s \
  claude-projects-mcp-server:latest
```

### Docker Compose Commands

```bash
# Start services
docker-compose up -d

# Start with proxy and cache
docker-compose --profile with-proxy --profile with-cache up -d

# View logs
docker-compose logs -f mcp-server

# Stop services
docker-compose down

# Stop and remove volumes
docker-compose down -v

# Check service status
docker-compose ps

# Execute command in container
docker-compose exec mcp-server node dist/tools/health-check.js
```

---

## Environment Configuration

### Required Variables

#### API Configuration

- `STATE_TRACKING_API_KEY` (required): API authentication key
- `STATE_TRACKING_API_URL` (optional): API base URL
  - Dev: `http://localhost:3000`
  - Staging: `https://staging-api.claude-projects.example.com`
  - Production: `https://api.claude-projects.example.com`

#### WebSocket Configuration

- `WS_API_KEY` (required): WebSocket authentication key
- `WS_PORT` (optional): WebSocket server port (default: 8080)
- `WS_HOST` (optional): WebSocket host binding (default: localhost)

#### GitHub Integration

- `GITHUB_TOKEN` (required): GitHub Personal Access Token
  - Required scopes: `repo`, `read:org`, `read:project`, `project`

### Optional Variables

- `NODE_ENV`: Environment type (development, staging, production)
- `LOG_LEVEL`: Logging verbosity (debug, info, warn, error)
- `REQUEST_TIMEOUT_MS`: API request timeout in ms (default: 10000)
- `RETRY_ATTEMPTS`: Number of retry attempts (default: 3)
- `GRACEFUL_SHUTDOWN_TIMEOUT`: Shutdown timeout in ms (default: 30000)

### Environment Profiles

#### Development

```bash
NODE_ENV=development
LOG_LEVEL=debug
REQUEST_TIMEOUT_MS=10000
RETRY_ATTEMPTS=3
WS_HOST=localhost
```

#### Staging

```bash
NODE_ENV=staging
LOG_LEVEL=info
REQUEST_TIMEOUT_MS=15000
RETRY_ATTEMPTS=5
WS_HOST=0.0.0.0
```

#### Production

```bash
NODE_ENV=production
LOG_LEVEL=warn
REQUEST_TIMEOUT_MS=20000
RETRY_ATTEMPTS=5
WS_HOST=0.0.0.0
GRACEFUL_SHUTDOWN_TIMEOUT=90000
```

---

## Health Checks & Monitoring

### Built-in Health Check Tool

```bash
node dist/tools/health-check.js
```

### Health Check Script

```bash
# Check once
./deployment/scripts/health-check.sh --once

# Monitor with verbose output
./deployment/scripts/health-check.sh --verbose

# Monitor with custom interval
./deployment/scripts/health-check.sh --interval 60
```

### Health Check Endpoints

The server includes health checks that verify:

1. **Container Running**: Basic process existence
2. **API Connectivity**: Connection to State Tracking API
3. **WebSocket Port**: Accessibility of WebSocket server
4. **Resource Usage**: CPU and memory consumption
5. **Log Status**: Recent error logs

### Docker Health Check

```bash
docker inspect claude-projects-mcp-server --format='{{.State.Health.Status}}'
```

### Monitoring Integration

Set up monitoring for:

- Container uptime
- Memory usage (target: < 300MB)
- CPU usage (target: < 50%)
- WebSocket connections
- API request latency
- Error rates

Example Prometheus metrics:

```yaml
- job_name: 'mcp-server'
  static_configs:
    - targets: ['localhost:9090']
```

---

## Troubleshooting

### Server Won't Start

**Check environment variables:**

```bash
docker-compose logs mcp-server | grep -i "error\|required"
```

**Verify configuration:**

```bash
grep -E "^[A-Z_]+" deployment/config/.env.production
```

### Connection Timeout

**Increase timeout:**

```bash
export REQUEST_TIMEOUT_MS=30000
docker-compose restart mcp-server
```

**Check network:**

```bash
docker exec mcp-server curl -v https://api.claude-projects.example.com
```

### High Memory Usage

**Check memory limits:**

```bash
docker stats mcp-server
```

**Increase memory allocation:**

Edit `docker-compose.yml` and set:

```yaml
deploy:
  resources:
    limits:
      memory: 1G
```

### WebSocket Connection Failed

**Verify port is open:**

```bash
docker exec mcp-server netstat -tlnp | grep 8080
```

**Check firewall rules:**

```bash
sudo ufw allow 8080/tcp
```

**Test connection:**

```bash
curl -i http://localhost:8080
```

### API Key Issues

**Verify key format:**

```bash
# Check key is set
docker-compose exec mcp-server env | grep API_KEY

# Verify it's not empty
[ -z "$STATE_TRACKING_API_KEY" ] && echo "EMPTY" || echo "SET"
```

**Test API connectivity:**

```bash
docker-compose exec mcp-server curl -H "Authorization: Bearer $STATE_TRACKING_API_KEY" https://api.claude-projects.example.com/health
```

### View Detailed Logs

```bash
# Last 100 lines
docker-compose logs mcp-server -n 100

# Follow in real-time
docker-compose logs -f mcp-server

# Specific time range
docker-compose logs mcp-server --since 10m
```

---

## Graceful Shutdown

### Manual Shutdown

```bash
# Stop container gracefully
docker-compose down

# Force stop after timeout
docker-compose kill
```

### Signal Handling

The server handles:

- `SIGTERM`: Initiates graceful shutdown (default timeout: 90s)
- `SIGINT`: Initiates graceful shutdown
- `SIGHUP`: Reloads configuration

### Testing Graceful Shutdown

```bash
# Send SIGTERM
docker-compose exec mcp-server kill -SIGTERM 1

# Monitor logs during shutdown
docker-compose logs -f mcp-server
```

### Shutdown Sequence

1. Server receives termination signal
2. Closes WebSocket connections
3. Finishes active requests (with timeout)
4. Closes database connections
5. Exits cleanly

---

## Rollback Procedures

### Rollback to Previous Version

```bash
# Check deployment history
git log --oneline deployment/

# Checkout previous version
git checkout HEAD~1

# Redeploy
./deployment/scripts/deploy.sh production --build
```

### Database Rollback

If data changes were made:

```bash
# Contact database administrator for restore
# Backups typically stored in: /backups/
```

---

## Scaling

### Horizontal Scaling (Load Balancing)

Use Docker Stack or Kubernetes:

```bash
# Scale to 3 instances
docker service scale mcp=3

# With load balancer
docker-compose scale mcp-server=3
```

### Vertical Scaling (Resource Increase)

Increase resource limits:

```yaml
# docker-compose.yml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 1G
```

---

## Additional Resources

- [Architecture Documentation](../docs/mcp-integration.md)
- [Development Guide](../docs/mcp-development.md)
- [Setup Instructions](./SETUP.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)
