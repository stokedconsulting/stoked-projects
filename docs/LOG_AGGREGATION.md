# Log Aggregation Setup

This document describes how to aggregate logs from the Claude Projects API for centralized analysis and alerting.

## Overview

The API produces structured JSON logs that can be:
- Streamed to CloudWatch Logs (AWS)
- Sent to ELK Stack (Elasticsearch, Logstash, Kibana)
- Shipped to third-party services (Datadog, Splunk, etc.)

## Log Format

All logs are in JSON format with consistent schema:

```json
{
  "timestamp": "2025-01-24T10:30:45.123Z",
  "level": "info",
  "service": "claude-projects-api",
  "context": "SessionsService",
  "message": "Session created",
  "requestId": "req-12345",
  "userId": "user-abc",
  "sessionId": "sess-xyz",
  "duration": 125,
  "metadata": {
    "status": "active",
    "type": "execution"
  }
}
```

### Log Levels

- **debug**: Detailed diagnostic information (disabled in production)
- **info**: General informational messages
- **warn**: Warning messages for concerning but non-error conditions
- **error**: Error messages with stack traces and context

## CloudWatch Logs Integration

### Setup

1. **Create Log Group**
```bash
aws logs create-log-group --log-group-name /aws/lambda/claude-projects-api
aws logs put-retention-policy --log-group-name /aws/lambda/claude-projects-api --retention-in-days 30
```

2. **IAM Permissions**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

3. **Application Configuration**

Set environment variables:
```bash
CLOUDWATCH_ENABLED=true
CLOUDWATCH_LOG_GROUP=/aws/lambda/claude-projects-api
AWS_REGION=us-east-1
```

### CloudWatch Insights Queries

#### Error Rate
```
fields @timestamp, @message, level
| filter level = "error"
| stats count() as error_count by bin(5m)
```

#### Slow Requests
```
fields @timestamp, @message, duration
| filter duration > 2000
| sort @timestamp desc
| limit 100
```

#### Rate Limit Issues
```
fields @timestamp, @message, context
| filter context = "GithubService" and @message like /rate limit/
```

#### Database Errors
```
fields @timestamp, @message, error
| filter context = "DatabaseService"
| stats count() as db_errors by @message
```

#### Session Status Changes
```
fields @timestamp, sessionId, status, context
| filter context = "SessionsService"
| stats count() as status_changes by status
```

## ELK Stack Integration

### Docker Compose Setup

```yaml
version: '3.8'

services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.0.0
    container_name: elasticsearch
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    ports:
      - "9200:9200"
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data

  logstash:
    image: docker.elastic.co/logstash/logstash:8.0.0
    container_name: logstash
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf:ro
    ports:
      - "5000:5000/tcp"
      - "5000:5000/udp"
    depends_on:
      - elasticsearch

  kibana:
    image: docker.elastic.co/kibana/kibana:8.0.0
    container_name: kibana
    ports:
      - "5601:5601"
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    depends_on:
      - elasticsearch

volumes:
  elasticsearch_data:
```

### Logstash Configuration

Create `logstash.conf`:

```
input {
  tcp {
    port => 5000
    codec => json
  }
}

filter {
  mutate {
    add_field => { "[@metadata][index_name]" => "claude-projects-%{+YYYY.MM.dd}" }
  }
}

output {
  elasticsearch {
    hosts => ["elasticsearch:9200"]
    index => "%{[@metadata][index_name]}"
  }
}
```

### Application Configuration

In Node.js application:

```typescript
import * as winston from 'winston';

const logger = winston.createLogger({
  format: winston.format.json(),
  transports: [
    new winston.transports.Stream({
      stream: require('net').createConnection({ port: 5000, host: 'logstash' })
    })
  ]
});
```

### Kibana Dashboards

#### Log Volume Over Time
```
Time series | Metrics: Count | Bucket: Date histogram (@timestamp, 5m)
```

#### Error Rate by Component
```
Pie chart | Aggregation: Terms (context) | Metrics: Count
Filter: level = "error"
```

#### Request Duration Distribution
```
Histogram | Field: duration | Bucket: 100ms intervals
```

#### Top Error Messages
```
Table | Aggregation: Terms (@message) | Top 20
Filter: level = "error"
```

## Splunk Integration

### HTTP Event Collector (HEC)

1. **Create HEC Token**
   - Settings → Data Inputs → HTTP Event Collector
   - Create token, note the URL and token

2. **Application Configuration**
```bash
SPLUNK_HEC_URL=https://your-splunk-instance:8088
SPLUNK_HEC_TOKEN=your-hec-token
```

3. **Send Logs**
```bash
curl -k https://your-splunk-instance:8088/services/collector \
  -H "Authorization: Splunk your-hec-token" \
  -d '{"event":{"log": "message"}, "sourcetype": "json"}'
```

## Datadog Integration

### Setup

1. **Get API Key**
   - Datadog Dashboard → API/Application Keys → Create API Key

2. **Install Datadog Logger**
```bash
npm install --save @datadog/browser-logs
```

3. **Initialize Logger**
```typescript
import { datadogLogs } from '@datadog/browser-logs';

datadogLogs.init({
  applicationId: 'YOUR_APPLICATION_ID',
  clientToken: 'YOUR_CLIENT_TOKEN',
  site: 'datadoghq.com',
  service: 'claude-projects-api',
  env: 'production',
  sessionSampleRate: 100,
  version: '1.0.0'
});
```

## Log Retention Policies

### Development
- Duration: 7 days
- Level: debug, info, warn, error
- Format: Human-readable JSON

### Staging
- Duration: 14 days
- Level: info, warn, error
- Format: JSON

### Production
- Duration: 30 days
- Level: info, warn, error (no debug)
- Format: JSON
- Encryption: KMS encrypted

## Sensitive Data Handling

### Automatic Sanitization

The logger automatically redacts:
- API keys and tokens (patterns: `apiKey`, `token`, `secret`, `password`)
- Database credentials (patterns: `password`, `user`, `host`)
- AWS credentials (patterns: `aws_access_key_id`, `aws_secret_access_key`)
- PII (patterns: `email`, `phone`, `ssn`)

### Configuration

```typescript
const LOG_SANITIZE_PATTERNS = [
  /apikey=([^\s&]+)/gi,
  /token=([^\s&]+)/gi,
  /password=([^\s&]+)/gi,
  /authorization:\s*bearer\s+([^\s]+)/gi,
];

export function sanitizeLog(message: string): string {
  return LOG_SANITIZE_PATTERNS.reduce((sanitized, pattern) => {
    return sanitized.replace(pattern, '$1=***');
  }, message);
}
```

## Monitoring and Alerting

### Log-Based Metrics

Create metrics from logs:

#### Error Rate Metric
```
Metric name: error_rate
Filter: level = "error"
```

#### Slow Request Metric
```
Metric name: slow_requests
Filter: duration > 2000
```

### Alerts

#### High Error Rate
```
Alert condition: error_rate > 5%
Duration: 5 minutes
Notification: Slack, PagerDuty
```

#### Database Issues
```
Alert condition: count(database errors) > 10 in 5m
Notification: Slack #critical-alerts
```

## Best Practices

### Logging

1. **Use appropriate log levels**
   - debug: Detailed diagnostic info (disabled in prod)
   - info: Important events (session start, job completion)
   - warn: Concerning but non-critical (rate limit approaching)
   - error: Error conditions with context

2. **Include correlation IDs**
   - Track requests across services
   - Include in all logs for same request: `requestId`

3. **Add relevant context**
   - User/session identifiers
   - Operation duration/latency
   - Error causes and remediation steps

4. **Avoid logging sensitive data**
   - Never log raw API keys or tokens
   - Redact PII before logging
   - Use structured logging to sanitize automatically

### Log Queries

1. **Use filters for faster queries**
   - Filter by time range (last 1h, last 24h)
   - Filter by severity level
   - Filter by service/component

2. **Aggregate for insights**
   - Count errors by type
   - Calculate percentiles (p50, p95, p99)
   - Compare time periods

3. **Create dashboards**
   - Real-time error rate
   - Response time trends
   - Resource utilization
   - Session lifecycle metrics

## Troubleshooting

### Logs Not Appearing

1. Check log level configuration
   - Development: should include debug
   - Production: should be info or higher

2. Verify streaming is enabled
   ```bash
   echo $CLOUDWATCH_ENABLED
   echo $LOGSTASH_HOST
   ```

3. Check network connectivity
   ```bash
   telnet logstash-host 5000
   ```

### Missing Sensitive Data Redaction

1. Verify sanitization patterns are configured
2. Check log redaction service is running
3. Review recent logs for unredacted PII

### Log Retention Issues

1. Verify log retention policy is set
2. Check storage quota and increase if needed
3. Archive old logs to S3 if needed

## Related Documentation

- [Monitoring Setup](./MONITORING_SETUP.md)
- [Production Readiness Checklist](./production-readiness-checklist.md)
- [Security Audit](./security-audit.md)
- [CloudWatch Logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/)
- [ELK Stack Documentation](https://www.elastic.co/guide/en/elasticsearch/reference/)
