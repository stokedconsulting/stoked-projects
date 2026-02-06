# Monitoring Guide

Comprehensive monitoring setup and best practices for the Claude Projects State Tracking API.

## Table of Contents

- [CloudWatch Dashboard Setup](#cloudwatch-dashboard-setup)
- [Alert Configuration](#alert-configuration)
- [Key Metrics to Watch](#key-metrics-to-watch)
- [Log Analysis Procedures](#log-analysis-procedures)
- [Performance Baselines](#performance-baselines)
- [Custom Metrics](#custom-metrics)
- [Dashboards & Visualization](#dashboards--visualization)

---

## CloudWatch Dashboard Setup

### Create Main Operations Dashboard

**Access:** AWS Console → CloudWatch → Dashboards

1. **Create new dashboard**
   ```bash
   # Via CLI
   aws cloudwatch put-dashboard \
     --dashboard-name "Claude-Projects-State-API-Production" \
     --dashboard-body file://dashboards/main.json
   ```

2. **Dashboard definition (dashboards/main.json)**
   ```json
   {
     "widgets": [
       {
         "type": "metric",
         "properties": {
           "metrics": [
             [ "AWS/Lambda", "Invocations", { "stat": "Sum", "period": 300, "region": "us-east-1", "dimensions": { "FunctionName": "claude-projects-state-api-production" } } ],
             [ ".", "Errors", { "stat": "Sum", "region": "us-east-1" } ],
             [ ".", "Throttles", { "stat": "Sum", "region": "us-east-1" } ],
             [ ".", "Duration", { "stat": "Average", "region": "us-east-1" } ],
             [ ".", "ConcurrentExecutions", { "stat": "Maximum", "region": "us-east-1" } ]
           ],
           "period": 300,
           "stat": "Average",
           "region": "us-east-1",
           "title": "Lambda Function Metrics",
           "yAxis": { "left": { "min": 0 } }
         }
       },
       {
         "type": "metric",
         "properties": {
           "metrics": [
             [ "AWS/ApiGateway", "Count", { "stat": "Sum", "dimensions": { "ApiName": "StateTrackingApi" } } ],
             [ ".", "4XXError", { "stat": "Sum" } ],
             [ ".", "5XXError", { "stat": "Sum" } ],
             [ ".", "Latency", { "stat": "Average" } ]
           ],
           "period": 300,
           "stat": "Average",
           "region": "us-east-1",
           "title": "API Gateway Metrics"
         }
       }
     ]
   }
   ```

### Database Monitoring Dashboard

1. **Create database dashboard**
   ```bash
   aws cloudwatch put-dashboard \
     --dashboard-name "Claude-Projects-MongoDB" \
     --dashboard-body file://dashboards/database.json
   ```

2. **Dashboard definition (dashboards/database.json)**
   ```json
   {
     "widgets": [
       {
         "type": "metric",
         "properties": {
           "title": "MongoDB Connection Status",
           "metrics": [
             [ "AWS/Logs", "IncomingLogEvents", { "stat": "Sum", "dimensions": { "LogGroupName": "/aws/lambda/claude-projects-state-api-production" } } ]
           ],
           "period": 60,
           "stat": "Sum",
           "region": "us-east-1"
         }
       }
     ]
   }
   ```

3. **MongoDB Atlas Console** (for detailed metrics)
   - Log into MongoDB Atlas
   - Navigate to: Cluster → Metrics
   - Key metrics to monitor:
     - Operations/sec (queries, inserts, updates)
     - Connection count
     - Document count
     - CPU utilization
     - Disk I/O operations/sec

---

## Alert Configuration

### Critical Alerts (Immediate Page)

#### 1. Lambda Error Rate > 1%

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "claude-projects-api-high-error-rate" \
  --alarm-description "Alert when Lambda error rate exceeds 1%" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 60 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=FunctionName,Value=claude-projects-state-api-production \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:incident-alerts
```

#### 2. Lambda Throttling Detected

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "claude-projects-api-throttling" \
  --alarm-description "Alert when Lambda is being throttled" \
  --metric-name Throttles \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 60 \
  --threshold 0 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 1 \
  --dimensions Name=FunctionName,Value=claude-projects-state-api-production \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:incident-alerts
```

#### 3. API Gateway 5xx Errors > 5%

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "claude-projects-api-gateway-errors" \
  --alarm-description "Alert when API Gateway returns too many 5xx errors" \
  --metric-name 5XXError \
  --namespace AWS/ApiGateway \
  --statistic Sum \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=ApiId,Value=$API_ID \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:incident-alerts
```

### High Priority Alerts (2 hour SLA)

#### 4. High API Latency (> 2 seconds)

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "claude-projects-api-high-latency" \
  --alarm-description "Alert when API latency exceeds 2 seconds" \
  --metric-name Duration \
  --namespace AWS/Lambda \
  --statistic Average \
  --period 300 \
  --threshold 2000 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 3 \
  --dimensions Name=FunctionName,Value=claude-projects-state-api-production \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:performance-alerts
```

#### 5. High Concurrent Executions

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "claude-projects-api-high-concurrency" \
  --alarm-description "Alert when concurrent executions exceed 50" \
  --metric-name ConcurrentExecutions \
  --namespace AWS/Lambda \
  --statistic Maximum \
  --period 60 \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=FunctionName,Value=claude-projects-state-api-production \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:performance-alerts
```

### Low Priority Alerts (Daily Review)

#### 6. High Request Volume

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "claude-projects-api-high-volume" \
  --alarm-description "Alert on unusually high request volume" \
  --metric-name Count \
  --namespace AWS/ApiGateway \
  --statistic Sum \
  --period 300 \
  --threshold 10000 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 3 \
  --dimensions Name=ApiId,Value=$API_ID \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:info-alerts
```

### SNS Topic Setup for Notifications

```bash
# Create SNS topics for different alert levels
aws sns create-topic --name claude-projects-incident-alerts
aws sns create-topic --name claude-projects-performance-alerts
aws sns create-topic --name claude-projects-info-alerts

# Subscribe to topics
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:ACCOUNT_ID:claude-projects-incident-alerts \
  --protocol email \
  --notification-endpoint oncall@company.com

# For Slack integration (use Lambda + Webhook)
# Create Lambda function to forward SNS to Slack
```

### Alert Configuration Checklist

- [ ] All critical alerts configured
- [ ] SNS topics created and subscribed
- [ ] Alert thresholds validated against baselines
- [ ] Test alert delivery (send manual test)
- [ ] Documented alert response procedures
- [ ] On-call rotation aware of alerts

---

## Key Metrics to Watch

### Application Metrics

| Metric | Namespace | Source | Normal Range | Alert Threshold |
|--------|-----------|--------|--------------|-----------------|
| **Request Count** | AWS/ApiGateway | API Gateway | 100-1000 req/min | > 5000 req/min |
| **Error Rate** | AWS/Lambda | Lambda | < 0.1% | > 1% |
| **Latency (Avg)** | AWS/ApiGateway | API Gateway | 50-200ms | > 2000ms |
| **Latency (P99)** | AWS/Lambda | Lambda logs | 200-500ms | > 5000ms |
| **Invocations** | AWS/Lambda | Lambda | Varies by load | Plateaued = issue |
| **Duration (Avg)** | AWS/Lambda | Lambda | 50-150ms | > 2000ms |
| **Concurrent Exec** | AWS/Lambda | Lambda | 1-20 | > 100 |
| **Throttles** | AWS/Lambda | Lambda | 0 | > 0 |

### Infrastructure Metrics

| Metric | Namespace | Source | Normal Range | Alert Threshold |
|--------|-----------|--------|--------------|-----------------|
| **4xx Errors** | AWS/ApiGateway | API Gateway | 1-5% of traffic | > 10% |
| **5xx Errors** | AWS/ApiGateway | API Gateway | < 0.1% | > 1% |
| **Memory Usage** | Custom | Application logs | < 300MB | > 400MB |
| **CPU Utilization** | CloudWatch | Lambda | 10-30% | > 80% |

### Database Metrics (MongoDB Atlas)

| Metric | Normal Range | Alert Threshold |
|--------|--------------|-----------------|
| **Operations/sec** | 10-100 ops/sec | > 1000 ops/sec |
| **Connection Count** | 10-50 connections | > 200 connections |
| **Query Time (avg)** | 1-5ms | > 100ms |
| **Disk I/O ops/sec** | < 10K | > 50K |
| **CPU Utilization** | 10-30% | > 80% |
| **Memory Utilization** | 30-60% | > 90% |

### Session Metrics (Application-Specific)

```bash
# Custom metrics to emit from application
# POST /cloudwatch/metrics

{
  "MetricData": [
    {
      "MetricName": "ActiveSessions",
      "Value": 45,
      "Unit": "Count",
      "Timestamp": "2026-01-20T12:00:00Z"
    },
    {
      "MetricName": "SessionRecoveryAttempts",
      "Value": 3,
      "Unit": "Count",
      "Timestamp": "2026-01-20T12:00:00Z"
    },
    {
      "MetricName": "AverageSessionDuration",
      "Value": 300,
      "Unit": "Seconds",
      "Timestamp": "2026-01-20T12:00:00Z"
    }
  ]
}
```

---

## Log Analysis Procedures

### Real-time Log Monitoring

```bash
# Watch production logs live
aws logs tail /aws/lambda/claude-projects-state-api-production --follow

# Watch only errors
aws logs tail /aws/lambda/claude-projects-state-api-production \
  --follow \
  --filter-pattern "ERROR"

# Watch specific endpoint
aws logs tail /aws/lambda/claude-projects-state-api-production \
  --follow \
  --filter-pattern '"/sessions"'

# Watch authentication failures
aws logs tail /aws/lambda/claude-projects-state-api-production \
  --follow \
  --filter-pattern 'unauthorized OR forbidden'
```

### Log Insights Queries

**Query 1: Error Rate by Status Code**

```sql
fields @timestamp, statusCode
| stats count() as total by statusCode
| sort total desc
```

**Query 2: P99 Latency Trend**

```sql
fields duration
| stats pct(duration, 99) as p99_latency by bin(5m)
```

**Query 3: Database Connection Errors**

```sql
fields @message
| filter @message like /connection.*error/i
| stats count() as error_count by @message
```

**Query 4: Slowest Endpoints**

```sql
fields @timestamp, path, duration
| filter ispresent(duration)
| stats avg(duration) as avg_duration, max(duration) as max_duration, count() as invocations by path
| sort max_duration desc
```

**Query 5: API Key Usage**

```sql
fields @message, apiKey
| filter ispresent(apiKey)
| stats count() as requests by apiKey
| sort requests desc
```

**Query 6: Session Operations**

```sql
fields @message, operation, sessionId
| filter @message like /session/i
| stats count() as operations by operation
```

**Query 7: Error Rate Over Time**

```sql
fields statusCode
| stats count() as total, count(filter statusCode >= 500) as errors by bin(5m)
| eval error_rate = round((errors / total) * 100, 2)
```

**Query 8: Timeout Analysis**

```sql
fields @message, duration
| filter @message like /timeout/i OR duration > 25000
| stats count() as timeouts, avg(duration) as avg_duration
```

### Log Analysis Workflow

1. **Detect anomaly from alerts**
   ```bash
   # Alert fires: "High error rate detected"
   ```

2. **Quick investigation**
   ```bash
   # Get error summary from last 30 minutes
   aws logs start-query \
     --log-group-name /aws/lambda/claude-projects-state-api-production \
     --start-time $(date -u -d '30 minutes ago' +%s) \
     --end-time $(date -u +%s) \
     --query-string 'fields statusCode | stats count() by statusCode'
   ```

3. **Deep dive into specific error type**
   ```bash
   # If 5xx errors are high
   aws logs start-query \
     --log-group-name /aws/lambda/claude-projects-state-api-production \
     --start-time $(date -u -d '30 minutes ago' +%s) \
     --end-time $(date -u +%s) \
     --query-string 'fields @message, @timestamp | filter statusCode >= 500 | limit 100'
   ```

4. **Extract root cause**
   ```bash
   # Look for patterns in error messages
   # Common patterns:
   # - "MongoError: connect ECONNREFUSED" → Database connection issue
   # - "ValidationError: field X is required" → API misuse
   # - "Task timed out" → Lambda timeout
   # - "ENOTFOUND" → DNS/network issue
   ```

5. **Document findings**
   - Root cause
   - Affected endpoints
   - Number of failed requests
   - Recommended fix

### Viewing Logs in Different Ways

**AWS CloudWatch Console:**
- URL: https://console.aws.amazon.com/logs
- Real-time viewing
- Easy filtering and search

**AWS CLI:**
```bash
# Simple tail
aws logs tail /aws/lambda/claude-projects-state-api-production --follow

# Filter and paginate
aws logs filter-log-events \
  --log-group-name /aws/lambda/claude-projects-state-api-production \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --end-time $(date -u +%s)000 \
  --filter-pattern 'ERROR' \
  --max-items 50
```

**Third-party Tools:**
- **Datadog:** Real-time monitoring + logs + APM
- **New Relic:** Application performance monitoring
- **LogRocket:** Error tracking + session replay
- **Sentry:** Error/exception tracking

---

## Performance Baselines

### Establishing Baselines

Run benchmarks in production-like staging environment:

```bash
# 1. Deploy to staging
sst deploy --stage staging

# 2. Run baseline tests (low load)
ab -n 100 -c 5 \
  -H "X-Api-Key: $API_KEY" \
  https://staging-claude-projects.truapi.com/sessions

# 3. Record metrics
# - Average response time
# - Min/max latency
# - 95th percentile
# - Error count

# 4. Document baseline
cat > docs/BASELINES.md << 'EOF'
# Performance Baselines

## Staging (Dev tier)
- Average latency: 120ms
- P95 latency: 250ms
- P99 latency: 500ms
- Error rate: 0%

## Production (Production tier)
- Average latency: 90ms
- P95 latency: 180ms
- P99 latency: 350ms
- Error rate: < 0.1%
EOF
```

### Current Baselines

**GET /sessions**
- Normal: 80-120ms
- Alert threshold: > 500ms
- Under load (100 req/s): 150-200ms

**POST /sessions**
- Normal: 100-150ms
- Alert threshold: > 1000ms
- Under load (50 req/s): 200-300ms

**PUT /sessions/:id**
- Normal: 120-180ms
- Alert threshold: > 1000ms

**GET /tasks**
- Normal: 60-100ms
- Alert threshold: > 500ms

**Database query (avg)**
- Normal: 5-20ms
- Alert threshold: > 100ms

**Lambda cold start**
- Normal: 2-3 seconds
- Acceptable: < 5 seconds
- With provisioned concurrency: < 100ms

### Deviation Investigation

If metrics deviate from baseline:

1. **Check for recent changes**
   ```bash
   git log --oneline -10
   # Look for code changes that could affect performance
   ```

2. **Compare metrics before/after**
   ```bash
   # Get metrics from 1 hour ago
   aws cloudwatch get-metric-statistics \
     --namespace AWS/Lambda \
     --metric-name Duration \
     --dimensions Name=FunctionName,Value=claude-projects-state-api-production \
     --start-time 2026-01-20T11:00:00Z \
     --end-time 2026-01-20T12:00:00Z \
     --period 300 \
     --statistics Average
   ```

3. **Check for increased load**
   ```bash
   # Request volume increased?
   aws cloudwatch get-metric-statistics \
     --namespace AWS/ApiGateway \
     --metric-name Count \
     --dimensions Name=ApiId,Value=$API_ID \
     --start-time 2026-01-20T11:00:00Z \
     --end-time 2026-01-20T12:00:00Z \
     --period 300 \
     --statistics Sum
   ```

4. **Check database performance**
   ```bash
   # Slow queries?
   mongosh $MONGODB_URI << 'EOF'
   db.system.profile.find({ millis: { $gt: 100 } }).limit(10).pretty()
   EOF
   ```

---

## Custom Metrics

### Emitting Custom Metrics from Application

Create a service to emit custom CloudWatch metrics:

```typescript
// src/common/services/metrics.service.ts
import { Injectable } from '@nestjs/common';
import * as AWS from 'aws-sdk';

@Injectable()
export class MetricsService {
  private cloudwatch: AWS.CloudWatch;

  constructor() {
    this.cloudwatch = new AWS.CloudWatch({ region: process.env.AWS_REGION });
  }

  async putMetric(
    metricName: string,
    value: number,
    unit: string = 'Count',
  ) {
    const params = {
      MetricData: [
        {
          MetricName: metricName,
          Value: value,
          Unit: unit,
          Timestamp: new Date(),
          Namespace: 'ClaudeProjects/StateTrackingAPI',
          Dimensions: [
            {
              Name: 'Environment',
              Value: process.env.NODE_ENV || 'development',
            },
          ],
        },
      ],
    };

    try {
      await this.cloudwatch.putMetricData(params).promise();
    } catch (error) {
      console.error('Failed to put metric:', error);
      // Don't throw - metric emission shouldn't break the app
    }
  }

  async recordSessionCreated() {
    await this.putMetric('SessionsCreated', 1, 'Count');
  }

  async recordSessionRecovery() {
    await this.putMetric('SessionsRecovered', 1, 'Count');
  }

  async recordDatabaseLatency(latencyMs: number) {
    await this.putMetric('DatabaseLatency', latencyMs, 'Milliseconds');
  }
}
```

### Using Custom Metrics

```typescript
// In sessions.service.ts
@Injectable()
export class SessionsService {
  constructor(private metricsService: MetricsService) {}

  async createSession(dto: CreateSessionDto) {
    const session = await this.sessionsModel.create(dto);

    // Emit metric
    await this.metricsService.recordSessionCreated();

    return session;
  }

  async recoverSession(sessionId: string) {
    const session = await this.sessionsModel.findByIdAndUpdate(sessionId, {
      status: 'ACTIVE',
      'metadata.recovery_attempts': { $inc: 1 },
    });

    // Emit metric
    await this.metricsService.recordSessionRecovery();

    return session;
  }
}
```

### CloudWatch Dashboard for Custom Metrics

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["ClaudeProjects/StateTrackingAPI", "SessionsCreated", {"stat": "Sum"}],
          [".", "SessionsRecovered", {"stat": "Sum"}],
          [".", "DatabaseLatency", {"stat": "Average"}]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "Application Metrics"
      }
    }
  ]
}
```

---

## Dashboards & Visualization

### Pre-built Dashboard Export

Export dashboards for easier sharing:

```bash
# Export current dashboard
aws cloudwatch get-dashboard \
  --dashboard-name "Claude-Projects-State-API-Production" \
  > dashboards/exported.json

# Import to another account/region
aws cloudwatch put-dashboard \
  --dashboard-name "Claude-Projects-State-API-Production" \
  --dashboard-body file://dashboards/exported.json
```

### Mobile-Friendly Dashboards

For on-call engineers:

```bash
# Create simplified "on-call" dashboard
# Show only critical metrics
# - Error rate (traffic light: green/yellow/red)
# - Current latency
# - Concurrent executions
# - Recent deployments
```

### Metrics Summary Template

```markdown
## Daily Metrics Report

### Yesterday's Performance
- Peak error rate: 0.2%
- Peak latency (avg): 180ms
- Peak concurrent executions: 45
- Total requests: 1.2M
- Database operations: 850K

### Trends
- Error rate: ↓ (was 0.5% day before)
- Latency: → (stable)
- Load: ↑ (10% more traffic)

### Incidents
- None

### Recommendations
- Monitor latency (slight upward trend)
- Database scaling may be needed in next quarter
```

### Monitoring Checklist

- [ ] All critical metrics have alerts
- [ ] CloudWatch dashboards created and verified
- [ ] SNS topics configured for alerts
- [ ] On-call team trained on dashboard
- [ ] Baselines documented
- [ ] Incident response procedures documented
- [ ] Custom metrics implemented (if applicable)
- [ ] Log retention policies set appropriately
- [ ] Cost optimization reviewed (can reduce retention, sample logs)
