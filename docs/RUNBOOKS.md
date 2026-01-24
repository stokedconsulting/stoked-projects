# Runbooks for Common Issues

This document provides step-by-step procedures for responding to alerts and common operational issues.

## Alert Response Framework

### Severity Levels

- **Critical (P1)**: Service unavailable or severely degraded
- **Warning (P2)**: Service degraded but operational
- **Info (P3)**: Informational, no immediate action required

### Response SLA

- Critical: 5 minutes
- Warning: 15 minutes
- Info: 24 hours

## Runbook: High Error Rate

**Alert**: Error rate > 5% for 5 minutes

### Step 1: Assess Situation
1. Navigate to Grafana dashboard: http://grafana:3001/d/claude-projects-overview
2. Check error rate gauge
3. Identify time when error rate increased
4. Check for recent deployments

```bash
# Check error logs in last hour
kubectl logs -f deployment/claude-projects-api --since=1h | grep ERROR
```

### Step 2: Identify Error Type
1. Run CloudWatch query:
```
fields @timestamp, @message, level, context
| filter level = "error"
| stats count() as error_count by context
| sort error_count desc
```

2. Check if errors are from:
   - Database (MongoDB)
   - External API (GitHub)
   - Internal application logic

### Step 3: Take Action

**If Database Errors**:
```bash
# Check MongoDB connectivity
kubectl exec -it mongodb-0 -- mongosh
db.adminCommand('ping')

# Check connection pool
kubectl exec deployment/claude-projects-api -- curl localhost:3000/health/detailed | jq '.database'

# Restart MongoDB if needed
kubectl rollout restart sts/mongodb
```

**If GitHub API Errors**:
```bash
# Check GitHub API status
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/status

# Check rate limit
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit

# If rate limited: wait for reset time shown in response
```

**If Application Errors**:
```bash
# Check for recent deployments
kubectl rollout history deployment/claude-projects-api

# Review application logs for stack traces
kubectl logs -f deployment/claude-projects-api --tail=100 | grep -A 5 ERROR

# If critical: rollback to previous version
kubectl rollout undo deployment/claude-projects-api
```

### Step 4: Verify Resolution
1. Check error rate returned to normal (<1%)
2. Verify no new errors in logs
3. Run smoke tests
```bash
curl -X GET http://api:3000/health
curl -X GET http://api:3000/health/detailed
```

### Step 5: Post-Incident

1. Document root cause
2. Update this runbook if new pattern identified
3. Create ticket to prevent recurrence

---

## Runbook: High Response Time

**Alert**: P95 response time > 2 seconds for 5 minutes

### Step 1: Identify Slow Endpoints
```bash
# Query Prometheus for slowest endpoints
# In Grafana, run:
sort_desc(histogram_quantile(0.95, rate(http_response_time_ms_bucket[5m])))
```

Or use CloudWatch:
```
fields @timestamp, @message, duration, context
| filter duration > 2000
| stats avg(duration) as avg_duration, max(duration) as max_duration by context
| sort avg_duration desc
```

### Step 2: Check Resource Usage
```bash
# CPU usage
kubectl top pod -l app=claude-projects-api

# Memory usage
kubectl top pod -l app=claude-projects-api

# Disk I/O
kubectl exec deployment/claude-projects-api -- iostat -x 1

# Network I/O
kubectl exec deployment/claude-projects-api -- ss -s
```

### Step 3: Check Database Performance
```bash
# Connect to MongoDB
kubectl exec -it mongodb-0 -- mongosh

# Check slow queries (if profiling enabled)
db.system.profile.find().sort({millis: -1}).limit(5)

# Check indexes
db.sessions.getIndexes()

# Check index statistics
db.sessions.aggregate([{$indexStats: {}}])
```

### Step 4: Take Action

**If High Database Load**:
```bash
# Check query patterns
db.system.profile.find({"millis": {$gt: 1000}}).limit(10)

# Rebuild index if fragmented
db.sessions.reIndex()

# Add missing index for common queries
db.sessions.createIndex({status: 1, createdAt: -1})
```

**If High Memory Usage**:
```bash
# Check process memory
kubectl top pod <pod-name>

# If > 90%, restart pod
kubectl rollout restart deployment/claude-projects-api

# Or scale up if load is high
kubectl scale deployment/claude-projects-api --replicas=3
```

**If High CPU Usage**:
```bash
# Scale up replicas
kubectl scale deployment/claude-projects-api --replicas=3

# Monitor if CPU reduces
kubectl top pod -l app=claude-projects-api
```

### Step 5: Verify Resolution
1. Monitor response time percentiles
```bash
histogram_quantile(0.95, rate(http_response_time_ms_bucket[5m]))
```
2. Should return to < 1000ms

### Step 6: Preventive Measures
1. Review and optimize slow query patterns
2. Update database indexes
3. Consider caching for frequently accessed data
4. Implement query timeouts (30 seconds)

---

## Runbook: Database Connection Failed

**Alert**: No active database connections

### Step 1: Immediate Actions
```bash
# Check MongoDB is running
kubectl get pods -l app=mongodb

# Check pod status
kubectl describe pod mongodb-0

# Check logs
kubectl logs mongodb-0
```

### Step 2: Verify Connectivity
```bash
# From API pod, test MongoDB connection
kubectl exec -it deployment/claude-projects-api -- \
  mongosh $MONGODB_URI

# Check connection string
kubectl exec deployment/claude-projects-api -- echo $MONGODB_URI
```

### Step 3: Check Network

```bash
# Verify DNS resolution
kubectl exec deployment/claude-projects-api -- nslookup mongodb

# Check network policies
kubectl get networkpolicy

# Test port connectivity
kubectl exec deployment/claude-projects-api -- telnet mongodb 27017
```

### Step 4: Restart Services

```bash
# Restart MongoDB
kubectl rollout restart sts/mongodb

# Wait for MongoDB to be ready
kubectl wait --for=condition=Ready pod -l app=mongodb --timeout=300s

# Restart API
kubectl rollout restart deployment/claude-projects-api

# Verify connection
kubectl logs -f deployment/claude-projects-api | grep -i connected
```

### Step 5: Verify Health
```bash
# Check health endpoint
curl http://api:3000/health/detailed

# Should show: "database": "connected"
```

### Step 6: Investigation

If connection fails again:
1. Check MongoDB logs for errors
```bash
kubectl logs mongodb-0 | tail -100
```

2. Check API configuration
```bash
kubectl exec deployment/claude-projects-api -- env | grep MONGODB
```

3. Verify credentials
```bash
kubectl get secret mongodb-credentials -o jsonpath='{.data.password}' | base64 -d
```

---

## Runbook: GitHub API Rate Limit Exceeded

**Alert**: GitHub API rate limit exhausted

### Step 1: Understand Current Status
```bash
# Check rate limit
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/rate_limit | jq '.'

# Shows:
# - remaining: requests left
# - limit: total requests in window
# - reset: Unix timestamp when limit resets
```

### Step 2: Immediate Actions

**Option 1: Wait for Reset**
- Rate limit typically resets after 1 hour
- For public API: limit is 60 requests/hour per IP
- For authenticated API: 5,000 requests/hour per token

**Option 2: Use Different Token**
```bash
# If multiple tokens available
export GITHUB_TOKEN=$BACKUP_GITHUB_TOKEN

# Restart API with new token
kubectl set env deployment/claude-projects-api \
  GITHUB_TOKEN=$BACKUP_GITHUB_TOKEN
kubectl rollout restart deployment/claude-projects-api
```

### Step 3: Reduce API Calls

**Implement Conditional Requests**:
```bash
# Use ETags to avoid consuming quota
curl -H "Authorization: token $GITHUB_TOKEN" \
  -H "If-None-Match: \"644b5b0155e6404a9cc4bd9d8b0677\" \
  https://api.github.com/repos/owner/repo
```

**Batch API Requests**:
- Use GraphQL to batch multiple queries
- Fetch multiple projects in single request

**Enable Caching**:
- Cache GitHub API responses
- 5-minute TTL for project data
- 1-hour TTL for rate-limited data

### Step 4: Monitor Recovery
```bash
# Monitor rate limit recovery
# Run every minute:
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/rate_limit | jq '.resources.core | {remaining, reset}'
```

### Step 5: Prevent Future Incidents

1. **Monitor Rate Limit** (alert at < 500 remaining)
```
github_api_rate_limit_remaining < 500
```

2. **Implement Backoff**
```typescript
if (response.status === 403 && response.headers['x-ratelimit-remaining'] === '0') {
  const resetTime = parseInt(response.headers['x-ratelimit-reset']);
  const delay = (resetTime * 1000) - Date.now();
  await sleep(delay + 1000);
}
```

3. **Use GraphQL Batching**
- Fetch 10 projects in single query
- Save 90% of API quota

---

## Runbook: Low Cache Hit Rate

**Alert**: Cache hit rate < 50%

### Step 1: Analyze Cache Performance
```
fields @timestamp, cache_hit, cache_miss
| stats sum(cache_hit) as hits, sum(cache_miss) as misses by bin(1h)
| fields hits, misses, (hits/(hits+misses))*100 as hit_rate
```

### Step 2: Identify Cache Misses
1. Query metrics:
```
cache_misses > cache_hits
```

2. Check cache configuration:
```bash
kubectl exec deployment/claude-projects-api -- env | grep CACHE
```

3. Review cache keys:
```bash
# If using Redis
redis-cli KEYS "*" | wc -l  # Number of cache entries
```

### Step 3: Take Action

**Increase Cache TTL**:
```typescript
// Increase from 5m to 15m
const CACHE_TTL = 900; // 15 minutes
```

**Expand Cache Size**:
```bash
# If using Redis
kubectl set env deployment/claude-projects-api \
  REDIS_MAX_MEMORY=512m
```

**Add Warming**:
```typescript
// Pre-fetch frequently accessed data on startup
async function warmCache() {
  const projects = await fetchProjects();
  for (const project of projects) {
    await cache.set(`project:${project.id}`, project, 900);
  }
}

// Call on service initialization
```

### Step 4: Monitor Improvement
```
cache_hit_rate
```
Should increase to > 75% within 1 hour

---

## Runbook: Active Session Count Too High

**Alert**: Active sessions > 1000

### Step 1: Understand Session Distribution
```bash
# Query database
db.sessions.aggregate([
  {$group: {_id: "$status", count: {$sum: 1}}},
  {$sort: {count: -1}}
])
```

### Step 2: Check Session Lifecycle
```bash
# Find old sessions that should be completed
db.sessions.find({
  status: "active",
  createdAt: {$lt: new Date(Date.now() - 24*60*60*1000)}
}).count()
```

### Step 3: Take Action

**If Sessions Stuck in Active State**:
```bash
# Mark stalled sessions as completed
db.sessions.updateMany(
  {
    status: "active",
    createdAt: {$lt: new Date(Date.now() - 24*60*60*1000)},
    lastHeartbeat: {$lt: new Date(Date.now() - 1*60*60*1000)}
  },
  {$set: {status: "stalled"}}
)
```

**Scale API If Legitimate Load**:
```bash
# Increase replicas
kubectl scale deployment/claude-projects-api --replicas=5
```

### Step 4: Prevent Future Issues

1. Implement session timeout:
```typescript
const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
if (Date.now() - session.lastHeartbeat > SESSION_TIMEOUT) {
  session.status = 'timeout';
}
```

2. Monitor session lifecycle:
```
active_sessions
```

---

## General Troubleshooting Commands

### Health Checks
```bash
# Quick health check
curl http://api:3000/health

# Detailed health check
curl http://api:3000/health/detailed

# Readiness (Kubernetes)
curl http://api:3000/health/ready

# Liveness (Kubernetes)
curl http://api:3000/health/live
```

### Logs
```bash
# Recent logs
kubectl logs -f deployment/claude-projects-api

# Last 100 lines
kubectl logs deployment/claude-projects-api --tail=100

# Last hour
kubectl logs deployment/claude-projects-api --since=1h

# Errors only
kubectl logs deployment/claude-projects-api | grep ERROR
```

### Metrics
```bash
# Get Prometheus metrics
curl http://api:3000/metrics

# Top 10 endpoints by request count
curl http://prometheus:9090/api/v1/query?query=topk(10,http_requests_total)
```

### Database
```bash
# Connect to MongoDB
kubectl exec -it mongodb-0 -- mongosh

# Check collection stats
db.sessions.stats()

# Check indexes
db.sessions.getIndexes()
```

## Escalation Procedure

### Level 1: Alert Acknowledged
- Responder: On-call engineer
- Time limit: 5 minutes
- Action: Assess situation, gather information

### Level 2: Incident Commander
- Responder: Senior engineer
- Time limit: 15 minutes
- Action: Implement fix or coordinate with team

### Level 3: Service Owner
- Responder: Service owner/tech lead
- Time limit: 30 minutes
- Action: Approve major changes, coordinate with stakeholders

## Post-Incident Review

After critical incident:
1. Document what happened
2. Document actions taken
3. Identify root cause
4. Create preventive measures
5. Update this runbook
6. Schedule postmortem (within 48 hours)

## Contact Information

- **On-Call Engineer**: [PagerDuty]
- **Service Owner**: [Slack @service-owner]
- **GitHub Status**: https://github.com/status
- **AWS Status**: https://status.aws.amazon.com
- **Slack Channel**: #api-alerts
