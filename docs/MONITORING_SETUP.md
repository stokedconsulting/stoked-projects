# Monitoring and Alerting Setup

This document describes the monitoring and alerting infrastructure for the Claude Projects API.

## Overview

The Claude Projects API includes comprehensive monitoring capabilities:

- **Prometheus Metrics**: Detailed application and system metrics
- **Grafana Dashboards**: Visual monitoring of key metrics
- **Alert Rules**: Automated alerting for critical issues
- **Health Checks**: Multiple health check endpoints for orchestration
- **Log Aggregation**: Structured logging for troubleshooting

## Prometheus Metrics Collection

### Metrics Endpoint

The API exposes Prometheus metrics at:
```
GET /metrics
```

Returns metrics in Prometheus text format (Content-Type: text/plain).

### Collected Metrics

#### HTTP Request Metrics

**http_requests_total** (counter)
- Total HTTP requests by method and path
- Labels: `method`, `path`
- Example: `http_requests_total{method="GET",path="/health"} 150`

**http_requests_by_method** (counter)
- Total HTTP requests by HTTP method
- Labels: `method`

**http_requests_by_status** (counter)
- Total HTTP requests by status code
- Labels: `status`

**http_requests_in_progress** (gauge)
- Current number of HTTP requests in progress
- Used for monitoring request concurrency

**http_response_time_ms** (histogram)
- HTTP response time in milliseconds
- Quantiles: 0.5, 0.95, 0.99
- Includes sum and count

#### Error Metrics

**http_errors_total** (counter)
- Total HTTP errors (4xx and 5xx)
- Labels: `endpoint`

#### Database Metrics

**db_query_time_ms** (histogram)
- Database query response time in milliseconds
- Quantiles: 0.5, 0.95, 0.99
- Includes sum and count

**db_connections_active** (gauge)
- Current active database connections

#### Session Metrics

**active_sessions** (gauge)
- Count of active sessions
- Updated from health check

#### Cache Metrics

**cache_hits** (counter)
- Total cache hits

**cache_misses** (counter)
- Total cache misses

**cache_evictions** (counter)
- Total cache evictions

**cache_hit_rate** (gauge)
- Cache hit rate as percentage (0-100)

#### GitHub API Metrics

**github_api_rate_limit_remaining** (gauge)
- Remaining GitHub API requests in current rate limit window

**github_api_rate_limit_reset** (gauge)
- Unix timestamp when rate limit resets

**github_api_latency_ms** (histogram)
- GitHub API call latency in milliseconds
- Quantiles: 0.5, 0.95, 0.99

## Prometheus Configuration

### Configuration File

Create `prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    monitor: 'claude-projects'

scrape_configs:
  - job_name: 'claude-projects-api'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    scrape_interval: 30s
    scrape_timeout: 10s
    scheme: http
```

### Docker Compose Setup

```yaml
version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - ./prometheus-alerts.yml:/etc/prometheus/alerts.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'

  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_SECURITY_ADMIN_USER=admin
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana-dashboards:/etc/grafana/provisioning/dashboards
      - ./grafana-datasources.yml:/etc/grafana/provisioning/datasources/datasources.yml
    depends_on:
      - prometheus

volumes:
  prometheus_data:
  grafana_data:
```

## Grafana Dashboards

### Available Dashboards

#### Claude Projects API Overview
**File**: `grafana-dashboard-overview.json`

Key visualizations:
- Request rate by method (line chart)
- Error rate (gauge)
- Response time percentiles (line chart, p50/p95/p99)
- Active sessions (gauge)
- Cache hit rate (line chart)
- GitHub API rate limit (gauge)
- Database query time percentiles (line chart)

### Dashboard Setup

1. **Import Dashboard**
   - Access Grafana: http://localhost:3001
   - Navigate to Dashboards → Import
   - Upload `grafana-dashboard-overview.json`
   - Select Prometheus data source

2. **Configure Data Source**
   - Settings → Data Sources → Add data source
   - Type: Prometheus
   - URL: http://prometheus:9090
   - Save & Test

3. **Create Custom Dashboards**
   - Use the PromQL queries below
   - Create panels for specific monitoring needs

### Common PromQL Queries

#### Request Rate (requests per second)
```promql
sum(rate(http_requests_total[5m])) by (method)
```

#### Error Rate (percentage)
```promql
(sum(rate(http_requests_by_status{status=~"5.."}[5m])) /
 sum(rate(http_requests_total[5m]))) * 100
```

#### P95 Response Time
```promql
histogram_quantile(0.95, rate(http_response_time_ms_bucket[5m]))
```

#### Database Connection Pool
```promql
db_connections_active
```

#### Cache Hit Rate
```promql
cache_hit_rate
```

#### GitHub API Latency
```promql
histogram_quantile(0.95, rate(github_api_latency_ms_bucket[5m]))
```

## Alert Rules

### Configuration File

Alert rules are defined in `prometheus-alerts.yml` and included in Prometheus configuration.

### Alert Thresholds

| Alert | Threshold | Duration | Severity |
|-------|-----------|----------|----------|
| HighErrorRate | > 5% | 5m | critical |
| HighResponseTime | p95 > 2000ms | 5m | warning |
| DatabaseConnectionFailed | 0 active | 2m | critical |
| HighMemoryUsage | > 90% | 5m | warning |
| GithubRateLimitLow | < 500 remaining | 5m | warning |
| GithubRateLimitExceeded | 0 remaining | 1m | critical |
| LowCacheHitRate | < 50% | 10m | info |
| HighDatabaseQueryTime | p95 > 1000ms | 5m | warning |
| HighGithubApiLatency | p95 > 5000ms | 5m | warning |
| HighActiveSessionCount | > 1000 | 5m | info |

### Alert Management

#### PagerDuty Integration

Configure in Prometheus:

```yaml
global:
  external_labels:
    cluster: 'production'

alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - alertmanager:9093

route:
  receiver: 'pagerduty'
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

receivers:
  - name: 'pagerduty'
    pagerduty_configs:
      - service_key: 'YOUR_PAGERDUTY_SERVICE_KEY'
        description: '{{ .GroupLabels.alertname }}'
```

#### Slack Integration

Configure Alertmanager:

```yaml
global:
  resolve_timeout: 5m

route:
  receiver: 'slack'
  group_wait: 30s
  group_interval: 5m

receivers:
  - name: 'slack'
    slack_configs:
      - api_url: 'YOUR_SLACK_WEBHOOK_URL'
        channel: '#api-alerts'
        title: '{{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'
```

## Health Check Endpoints

The API provides multiple health check endpoints:

### Basic Health Check
```
GET /health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-01-24T10:30:00.000Z",
  "uptime": 3600,
  "database": "connected",
  "latency": 2
}
```

### Readiness Probe (Kubernetes)
```
GET /health/ready
```

Returns 200 if ready to serve traffic, 503 otherwise.

### Liveness Probe (Kubernetes)
```
GET /health/live
```

Returns 200 if process is alive and responsive.

### Detailed Health Check
```
GET /health/detailed
```

Returns comprehensive health information including:
- Overall status (ok, degraded, unhealthy)
- Memory usage and thresholds
- Response time health
- Database connectivity
- Active session count

### System Information
```
GET /health/system
```

Returns system information:
- Node.js version
- Platform and architecture
- CPU count
- Memory statistics
- Heap usage

## Runbooks

### High Error Rate Alert

**Problem**: Error rate exceeds 5%

**Investigation**:
1. Check error types: `sum(http_errors_total) by (endpoint)`
2. Review error logs: `kubectl logs -f deployment/claude-projects-api`
3. Check database health: `GET /health/detailed`

**Resolution**:
- For database errors: Check MongoDB connectivity
- For timeout errors: Check upstream service availability
- For 500 errors: Check application logs for exceptions

**Prevention**:
- Monitor error rate continuously
- Implement circuit breakers for external services
- Use database connection pooling

### High Response Time Alert

**Problem**: P95 response time exceeds 2 seconds

**Investigation**:
1. Identify slow endpoints: `sort_desc(http_response_time_ms{quantile="0.95"})`
2. Check database query times: `histogram_quantile(0.95, db_query_time_ms_bucket)`
3. Profile application: Enable debug logging temporarily

**Resolution**:
- Add database indexes for slow queries
- Implement caching for frequently accessed data
- Scale API instances if load is high

**Prevention**:
- Regular database query performance review
- Implement query timeouts (30s recommended)
- Monitor response time trends

### Database Connection Failed Alert

**Problem**: No active database connections

**Investigation**:
1. Check MongoDB status: `kubectl exec -it mongodb-0 -- mongosh`
2. Verify connection string: `echo $MONGODB_URI`
3. Check network connectivity: `kubectl logs deployment/claude-projects-api | grep -i mongo`

**Resolution**:
- Restart MongoDB: `kubectl rollout restart sts/mongodb`
- Verify connection credentials
- Check network policies and firewall rules

**Prevention**:
- Use connection pooling with retry logic
- Monitor connection pool utilization
- Set appropriate connection timeouts

### GitHub Rate Limit Exceeded Alert

**Problem**: GitHub API rate limit exhausted

**Investigation**:
1. Check current requests: `curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit`
2. Identify API call source: Review application logs
3. Calculate reset time: Check rate limit reset endpoint

**Resolution**:
- Implement exponential backoff retry logic
- Use conditional requests (ETags) to avoid counting quota
- Batch API requests where possible

**Prevention**:
- Cache GitHub API responses
- Use GraphQL batching for multiple queries
- Monitor rate limit usage: `github_api_rate_limit_remaining`

## Monitoring Best Practices

### Metric Naming
- Use snake_case for metric names
- Include unit in metric name: `_ms` for milliseconds, `_bytes` for bytes
- Use labels for dimensions: `method`, `path`, `status`, `endpoint`

### Alert Configuration
- Set appropriate severity levels (critical, warning, info)
- Include runbook URL in alert annotations
- Use meaningful alert descriptions
- Set reasonable alert thresholds

### Dashboard Design
- Use appropriate visualization types (line chart for trends, gauge for status)
- Set meaningful time ranges (6h, 24h, 7d options)
- Group related metrics together
- Use color thresholds for quick status assessment

### Data Retention
- Prometheus: 30 days (configurable)
- Logs: 30+ days in CloudWatch
- Metrics: Archive to S3 after 90 days

## Troubleshooting

### Metrics Endpoint Not Responding

**Problem**: GET /metrics returns 404 or error

**Solution**:
1. Verify metrics controller is registered
2. Check application logs for errors
3. Ensure Prometheus service is injected

### Alerts Not Firing

**Problem**: Expected alerts don't trigger

**Solution**:
1. Check Prometheus targets: http://localhost:9090/targets
2. Verify alert rules are loaded: http://localhost:9090/alerts
3. Check alert thresholds against current metrics
4. Review Alertmanager logs

### High Memory Usage in Prometheus

**Problem**: Prometheus container consuming too much memory

**Solution**:
1. Reduce retention period: `--storage.tsdb.retention.time=7d`
2. Reduce scrape interval
3. Disable high-cardinality metric labels
4. Implement metrics sampling

### Grafana Dashboards Loading Slowly

**Problem**: Dashboard takes long to load or refresh

**Solution**:
1. Reduce time range for dashboard
2. Simplify queries (avoid complex aggregations)
3. Increase Prometheus scrape interval
4. Add caching headers in Grafana

## Related Documentation

- [Production Readiness Checklist](./production-readiness-checklist.md)
- [API Reference](./api-reference.md)
- [Security Audit](./security-audit.md)
- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
