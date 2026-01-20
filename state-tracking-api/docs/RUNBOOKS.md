# Operational Runbooks

Comprehensive procedures for common operational tasks and incident response for the Claude Projects State Tracking API.

## Table of Contents

- [Deployment Rollback](#deployment-rollback)
- [Database Migration](#database-migration)
- [Secret Rotation](#secret-rotation)
- [Incident Response](#incident-response)
- [Performance Degradation](#performance-degradation)
- [High Error Rates](#high-error-rates)
- [Scaling Operations](#scaling-operations)

---

## Deployment Rollback

### Quick Rollback (Last Deployed Version)

**When to use:** Something is critically broken after deployment and you need to revert immediately.

#### Steps

1. **Identify the previous deployment**
   ```bash
   cd ../claude-projects-project-70/state-tracking-api

   # List recent deployments
   aws cloudformation list-stacks \
     --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
     --query 'StackSummaries[0:5].{Name:StackName,Updated:LastUpdatedTime}'
   ```

2. **Verify the rollback target is healthy**
   ```bash
   # Check CloudFormation events for the previous version
   aws cloudformation describe-stack-events \
     --stack-name claude-projects-state-api-production \
     --query 'StackEvents[0:10].{Time:Timestamp,Status:ResourceStatus,Type:EventId}'
   ```

3. **Perform the rollback**
   ```bash
   # For production
   sst deploy --stage production --prior-deployment

   # OR manually trigger the previous CloudFormation template
   aws cloudformation continue-update-rollback \
     --stack-name claude-projects-state-api-production
   ```

4. **Verify rollback succeeded**
   ```bash
   # Check API endpoint
   curl -H "X-Api-Key: $API_KEY" https://claude-projects.truapi.com/health

   # Verify stack status
   aws cloudformation describe-stacks \
     --stack-name claude-projects-state-api-production \
     --query 'Stacks[0].StackStatus'
   ```

5. **Check logs for errors**
   ```bash
   # View Lambda logs from the last 10 minutes
   aws logs tail /aws/lambda/claude-projects-state-api-production --since 10m --follow
   ```

6. **Notify team**
   - Document the rollback in Slack/team channels
   - Include reason for rollback
   - Plan post-mortem/investigation

### Gradual Rollback (Canary Deployment)

**When to use:** You want to minimize impact while reverting changes.

#### Steps

1. **Create a canary route (10% of traffic)**
   ```bash
   # Edit sst.config.ts to add weighted routing
   # Route 90% to current, 10% to previous version
   aws apigateway create-deployment \
     --rest-api-id $API_ID \
     --stage-name production \
     --canary-settings trafficPercent=10,useStageCache=false
   ```

2. **Monitor canary metrics**
   ```bash
   # Watch error rates for the canary version
   aws cloudwatch get-metric-statistics \
     --namespace AWS/Lambda \
     --metric-name Errors \
     --dimensions Name=FunctionName,Value=claude-projects-state-api-production \
     --start-time 2026-01-20T12:00:00Z \
     --end-time 2026-01-20T13:00:00Z \
     --period 60 \
     --statistics Sum,Average
   ```

3. **If canary is healthy, increase traffic gradually**
   ```bash
   # Increase to 50%
   aws apigateway create-deployment \
     --rest-api-id $API_ID \
     --stage-name production \
     --canary-settings trafficPercent=50,useStageCache=false

   # Wait 15 minutes, then monitor again
   sleep 900

   # If still good, complete rollout
   aws apigateway create-deployment \
     --rest-api-id $API_ID \
     --stage-name production \
     --canary-settings trafficPercent=100,useStageCache=false
   ```

4. **If canary shows errors, full rollback**
   ```bash
   # Rollback the change
   sst deploy --stage production --prior-deployment
   ```

### Post-Rollback Checklist

- [ ] Verified API is responding normally
- [ ] Checked Lambda error logs (should be < 0.1%)
- [ ] Confirmed database connections are stable
- [ ] Validated metrics in CloudWatch
- [ ] Notified stakeholders
- [ ] Created incident ticket for investigation
- [ ] Scheduled post-mortem (if needed)

---

## Database Migration

### Pre-Migration Planning

**Timeframe:** Perform during low-traffic windows (weekends or after-hours)

1. **Estimate downtime**
   ```bash
   # Check current database size
   db.stats().dataSize / 1024 / 1024  # Size in MB in MongoDB shell

   # For large migrations, estimate: ~5 minutes per 1GB
   ```

2. **Create backup**
   ```bash
   # Create a backup of the database before migration
   # For MongoDB Atlas:
   - Log into MongoDB Atlas console
   - Navigate to Backup/Snapshots
   - Click "Create Snapshot" (takes 5-10 minutes)

   # Verify backup completed
   mongo $MONGODB_URI --eval "db.adminCommand('backupStatus')"
   ```

3. **Prepare rollback plan**
   - Document pre-migration state
   - Have restore procedure ready
   - Know backup restore time (typically 30 minutes)

### Schema Migration Example: Add Index

**Scenario:** Adding a compound index to improve query performance

```bash
# 1. Write migration script
cat > scripts/add-session-index.js << 'EOF'
// scripts/add-session-index.js
const mongoose = require('mongoose');

async function migrate() {
  const uri = process.env.MONGODB_URI;
  await mongoose.connect(uri);

  console.log('Creating compound index on sessions...');
  await mongoose.connection
    .collection('sessions')
    .createIndex({ project_id: 1, status: 1, created_at: -1 });

  console.log('Index created successfully');
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
EOF

# 2. Test migration against staging (REQUIRED)
export MONGODB_URI="<staging-connection-string>"
node scripts/add-session-index.js

# 3. Verify index was created (check MongoDB Atlas or shell)
db.sessions.getIndexes()

# 4. Deploy new code that uses the index
git add .
git commit -m "feat(db): add compound index on sessions"
sst deploy --stage production

# 5. Run migration on production
export MONGODB_URI="<production-connection-string>"
node scripts/add-session-index.js

# 6. Verify performance improvement
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=claude-projects-state-api-production \
  --start-time 2026-01-20T10:00:00Z \
  --end-time 2026-01-20T13:00:00Z \
  --period 300 \
  --statistics Average
```

### Schema Migration Example: Add Field

**Scenario:** Adding a new required field `environment` to sessions

```bash
# 1. Plan the migration (backward compatibility)
# - New code can handle both old and new format
# - Gradually migrate existing documents

# 2. Deploy code that:
#    - Accepts optional environment field
#    - Provides default value if missing
#    - Is fully compatible with old data

# 3. Run backfill migration
cat > scripts/backfill-environment.js << 'EOF'
async function backfill() {
  const uri = process.env.MONGODB_URI;
  await mongoose.connect(uri);

  const result = await mongoose.connection
    .collection('sessions')
    .updateMany(
      { environment: { $exists: false } },
      { $set: { environment: 'production' } }
    );

  console.log(`Updated ${result.modifiedCount} documents`);
  await mongoose.disconnect();
}

backfill().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
EOF

# 4. Run with progress monitoring
node scripts/backfill-environment.js

# 5. Verify completion
db.sessions.countDocuments({ environment: { $exists: false } })  // Should be 0
```

### Handling Large Collections

**For migrations on collections with > 10 million documents:**

1. **Batch the updates**
   ```javascript
   async function batchUpdate(query, update, batchSize = 10000) {
     let processed = 0;
     const total = await collection.countDocuments(query);

     while (processed < total) {
       const docs = await collection
         .find(query)
         .skip(processed)
         .limit(batchSize)
         .toArray();

       if (docs.length === 0) break;

       await collection.updateMany(
         { _id: { $in: docs.map(d => d._id) } },
         update
       );

       processed += docs.length;
       console.log(`Progress: ${processed}/${total}`);
     }
   }
   ```

2. **Monitor performance**
   ```bash
   # Check database CPU and connections
   watch -n 1 'mongostat --uri=$MONGODB_URI'
   ```

3. **Schedule during off-peak hours**
   - Large batches can impact production queries
   - Run during maintenance window

### Post-Migration Validation

- [ ] All documents migrated successfully
- [ ] No data loss occurred
- [ ] Query performance improved or maintained
- [ ] API endpoints responding normally
- [ ] Database connections stable
- [ ] Backup restored and verified (at least once)

### Rollback Procedure

```bash
# 1. Stop the migration immediately if in progress
# (Ctrl+C for scripts, or kill process)

# 2. Check for consistency issues
db.sessions.find({ /* check for partial updates */ }).count()

# 3. Restore from backup
# In MongoDB Atlas:
# - Navigate to Backup page
# - Click "Restore" on pre-migration snapshot
# - Wait for restore (30-60 minutes)
# - Update application connection string

# 4. Verify restoration
curl -H "X-Api-Key: $API_KEY" https://claude-projects.truapi.com/health/ready

# 5. Revert deployment (if needed)
sst deploy --stage production --prior-deployment
```

---

## Secret Rotation

### Rotating API Keys

**Frequency:** Every 90 days (quarterly)

#### Steps

1. **Generate new API keys**
   ```bash
   # Generate 3 new UUID keys
   node -e "console.log(crypto.randomUUID())" # Key 1
   node -e "console.log(crypto.randomUUID())" # Key 2 (backup)
   node -e "console.log(crypto.randomUUID())" # Key 3 (for internal services)

   # Example output:
   # 550e8400-e29b-41d4-a716-446655440000
   # 6ba7b810-9dad-11d1-80b4-00c04fd430c8
   # f47ac10b-58cc-4372-a567-0e02b2c3d479
   ```

2. **Add new keys to SST Secrets (without removing old ones)**
   ```bash
   # Update production secret
   sst secret set --stage production ApiKeys "550e8400-e29b-41d4-a716-446655440000,6ba7b810-9dad-11d1-80b4-00c04fd430c8,f47ac10b-58cc-4372-a567-0e02b2c3d479,<existing-old-keys>"

   # Deploy with new keys
   sst deploy --stage production
   ```

3. **Communicate new keys to clients**
   - Send email with new key and migration deadline
   - Update internal documentation
   - Provide migration guide

4. **Monitor old key usage**
   ```bash
   # Check logs for requests with old keys (if tracking is available)
   aws logs filter-log-events \
     --log-group-name /aws/lambda/claude-projects-state-api-production \
     --filter-pattern '"X-Api-Key": "old-key-pattern"' \
     --start-time $(date -d '24 hours ago' +%s)000
   ```

5. **Disable old keys after grace period (30 days)**
   ```bash
   # Remove old keys from ApiKeys secret
   sst secret set --stage production ApiKeys "550e8400-e29b-41d4-a716-446655440000,6ba7b810-9dad-11d1-80b4-00c04fd430c8,f47ac10b-58cc-4372-a567-0e02b2c3d479"

   sst deploy --stage production
   ```

6. **Verify new keys work**
   ```bash
   # Test with new key
   curl -H "X-Api-Key: 550e8400-e29b-41d4-a716-446655440000" \
     https://claude-projects.truapi.com/sessions

   # Should return 200 OK with session data
   ```

### Rotating MongoDB Credentials

**Frequency:** Every 6 months (semi-annual)

#### Steps

1. **Create new MongoDB user**
   ```bash
   # In MongoDB Atlas console:
   # - Database Access section
   # - Add New Database User
   # - Generate strong random password
   # - Assign same roles as existing user (readWrite on target database)

   # Or via CLI (if available)
   mongo admin --username admin --password \
     --eval 'db.createUser({
       user: "stateapi-new",
       pwd: "new-strong-password-here",
       roles: [{ role: "readWrite", db: "claude-projects" }]
     })'
   ```

2. **Update connection string in code**
   ```bash
   # New connection format
   mongodb+srv://stateapi-new:new-strong-password-here@cluster.mongodb.net/claude-projects?retryWrites=true&w=majority
   ```

3. **Update SST Secret**
   ```bash
   # Set new MongoDB URI in production secret
   sst secret set --stage production MongoDBUri \
     "mongodb+srv://stateapi-new:new-strong-password-here@cluster.mongodb.net/claude-projects?retryWrites=true&w=majority"

   # Deploy with new credentials
   sst deploy --stage production
   ```

4. **Verify connectivity**
   ```bash
   # Check API health endpoint (uses database)
   curl -H "X-Api-Key: $API_KEY" \
     https://claude-projects.truapi.com/health/ready

   # Should return status ok
   ```

5. **Test with direct connection**
   ```bash
   # Verify new credentials work
   mongosh "mongodb+srv://stateapi-new:password@cluster.mongodb.net/claude-projects" \
     --eval "db.sessions.countDocuments()"
   ```

6. **Disable old user**
   ```bash
   # In MongoDB Atlas console:
   # - Database Access section
   # - Delete the old user (stateapi-old)
   # OR set a removal date if supported
   ```

7. **Document the change**
   - Update internal credential vault/manager
   - Record in infrastructure documentation
   - Add to rotation schedule for next 6 months

### Rotating JWT/Signing Secrets (if applicable)

1. **Generate new secret key**
   ```bash
   # Use strong random generation
   openssl rand -base64 32
   ```

2. **Implement graceful secret rotation in code**
   ```typescript
   // Support both old and new keys for verification
   const verifyToken = (token: string, secretKey: string, newSecretKey: string) => {
     try {
       return jwt.verify(token, newSecretKey);
     } catch (e) {
       // Fallback to old key for backward compatibility
       return jwt.verify(token, secretKey);
     }
   };
   ```

3. **Deploy code changes first**
   ```bash
   git add .
   git commit -m "feat(auth): support dual JWT secrets for rotation"
   sst deploy --stage production
   ```

4. **Update the secret**
   ```bash
   sst secret set --stage production JwtSecret "new-secret-from-openssl"
   sst deploy --stage production
   ```

5. **Sign new tokens with new key**
   - New tokens use new key
   - Old tokens still validate with old key (temporary)

### Secret Rotation Checklist

- [ ] New secret generated with strong randomness
- [ ] Staged deployment with backward compatibility
- [ ] New secret tested in non-production first
- [ ] Deployed to production successfully
- [ ] All clients verified with new secret
- [ ] Old secret disabled after grace period
- [ ] Documented in rotation log
- [ ] Next rotation date scheduled (calendar reminder)

---

## Incident Response

### Severity Levels

| Level | Impact | Response Time | Examples |
|-------|--------|----------------|----------|
| **Critical (P1)** | Complete outage, data loss risk | 15 minutes | All requests failing, database unreachable, data corruption |
| **High (P2)** | Significant degradation, 25%+ requests failing | 1 hour | API very slow, recurring errors affecting 50% of users |
| **Medium (P3)** | Noticeable issues, < 25% requests affected | 4 hours | Elevated error rates, partial service degradation |
| **Low (P4)** | Minor issues, minimal user impact | 1 business day | Cosmetic issues, non-critical features down |

### Critical Incident (P1) Response

**Timeline: First 15 minutes**

#### Discovery & Initial Assessment

1. **Confirm incident**
   ```bash
   # Verify service is down
   curl -H "X-Api-Key: $API_KEY" https://claude-projects.truapi.com/health

   # Check health endpoint response time
   time curl -H "X-Api-Key: $API_KEY" https://claude-projects.truapi.com/health/ready
   ```

2. **Check current metrics**
   ```bash
   # Pull current CloudWatch metrics
   aws cloudwatch get-metric-statistics \
     --namespace AWS/Lambda \
     --metric-name Errors \
     --dimensions Name=FunctionName,Value=claude-projects-state-api-production \
     --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
     --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
     --period 60 \
     --statistics Sum,Average

   # Check duration (performance)
   aws cloudwatch get-metric-statistics \
     --namespace AWS/Lambda \
     --metric-name Duration \
     --dimensions Name=FunctionName,Value=claude-projects-state-api-production \
     --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
     --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
     --period 60 \
     --statistics Average,Maximum
   ```

3. **Gather diagnostics**
   ```bash
   # Check recent Lambda logs
   aws logs tail /aws/lambda/claude-projects-state-api-production --since 5m

   # Check API Gateway logs
   aws logs tail /aws/apigateway/claude-projects-state-api-production --since 5m

   # Check for throttling
   aws cloudwatch get-metric-statistics \
     --namespace AWS/Lambda \
     --metric-name Throttles \
     --dimensions Name=FunctionName,Value=claude-projects-state-api-production \
     --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
     --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
     --period 60 \
     --statistics Sum
   ```

#### Immediate Actions

4. **Declare incident** (in Slack/team channel)
   ```
   🚨 INCIDENT DECLARED - P1
   Service: Claude Projects State API (Production)
   Status: DEGRADED / DOWN
   Detection: [Time detected]
   Impact: All requests failing / High error rates
   Commander: [Your name]
   ```

5. **Trigger incident response team**
   - Page on-call engineer (if not already responding)
   - Notify engineering lead
   - Notify product/customer success

6. **Attempt immediate recovery** (if safe)
   ```bash
   # Option 1: Restart Lambda (if it appears hung)
   # This is done by issuing requests that would trigger a new function instance

   # Option 2: Check database connectivity
   # Try to connect directly to MongoDB
   mongosh $MONGODB_URI --eval "db.runCommand('ping')"

   # Option 3: Rollback last deployment
   # Only if you're certain the issue is deployment-related
   sst deploy --stage production --prior-deployment
   ```

7. **Monitor recovery**
   ```bash
   # Watch metrics in real-time
   watch -n 5 'aws cloudwatch get-metric-statistics \
     --namespace AWS/Lambda \
     --metric-name Errors \
     --dimensions Name=FunctionName,Value=claude-projects-state-api-production \
     --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
     --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
     --period 60 \
     --statistics Sum'
   ```

#### Post-Incident (After service restored)

8. **Verify recovery**
   ```bash
   # Health checks
   curl -H "X-Api-Key: $API_KEY" https://claude-projects.truapi.com/health
   curl -H "X-Api-Key: $API_KEY" https://claude-projects.truapi.com/health/ready

   # Sample API calls
   curl -H "X-Api-Key: $API_KEY" https://claude-projects.truapi.com/sessions | jq '.length'
   ```

9. **Document incident**
   - Record incident start/end times
   - Note root cause
   - List steps taken to resolve
   - Update status channel

10. **Schedule post-mortem** (within 48 hours)
    - Invite all responders and stakeholders
    - Discuss contributing factors
    - Create action items to prevent recurrence

### High Incident (P2) Response

1. **Alert the team** (within 15 minutes)
2. **Investigate root cause** (1 hour)
3. **Implement workaround or fix** (2 hours)
4. **Monitor for stability** (4 hours)
5. **Post-mortem** (within 1 week)

### Incident Runbook Decision Tree

```
Problem Detected
    │
    ├─ API not responding?
    │   ├─ Check Lambda logs
    │   ├─ Check database connection
    │   ├─ Check API Gateway metrics
    │   └─ Likely causes:
    │       - Database connection pool exhausted
    │       - Lambda timeout
    │       - Secret/credential issue
    │
    ├─ High error rate (> 5%)?
    │   ├─ Check error types in logs
    │   ├─ Identify affected endpoints
    │   └─ Likely causes:
    │       - Validation errors (check request format)
    │       - Database errors (check availability)
    │       - Timeout errors (check recent deployments)
    │
    ├─ High latency (> 5 seconds)?
    │   ├─ Check Lambda duration metrics
    │   ├─ Check database query performance
    │   └─ Likely causes:
    │       - Database queries slow
    │       - Network issues
    │       - Lambda memory insufficient
    │
    └─ Throttling?
        ├─ Check request volume
        ├─ Consider upgrading Lambda provisioning
        └─ Implement request rate limiting on client side
```

---

## Performance Degradation

### Symptom: Slow API Response Times

**Threshold:** Average response time > 2 seconds (should be < 500ms normally)

#### Diagnostic Steps

1. **Check Lambda duration metrics**
   ```bash
   aws cloudwatch get-metric-statistics \
     --namespace AWS/Lambda \
     --metric-name Duration \
     --dimensions Name=FunctionName,Value=claude-projects-state-api-production \
     --start-time $(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%S) \
     --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
     --period 60 \
     --statistics Average,Maximum,p99
   ```

2. **Check if it's application code or infrastructure**
   ```bash
   # Check API Gateway duration (includes network latency)
   aws cloudwatch get-metric-statistics \
     --namespace AWS/ApiGateway \
     --metric-name Latency \
     --dimensions Name=ApiName,Value=StateTrackingApi \
     --start-time $(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%S) \
     --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
     --period 60 \
     --statistics Average,Maximum

   # If API Gateway latency << Lambda duration:
   #   Problem is in application code (slow queries, processing)
   # If they're similar:
   #   Problem might be infrastructure (throttling, cold starts)
   ```

3. **Check for cold starts**
   ```bash
   # Look for "cold start" logs
   aws logs filter-log-events \
     --log-group-name /aws/lambda/claude-projects-state-api-production \
     --filter-pattern '"cold start"' \
     --start-time $(date -u -d '30 minutes ago' +%s)000 \
     --end-time $(date -u +%s)000

   # If many cold starts detected:
   #   Enable Lambda provisioned concurrency
   ```

4. **Check database performance**
   ```bash
   # Connect to MongoDB and check slow queries
   mongosh $MONGODB_URI << 'EOF'
   use admin
   db.setProfilingLevel(1, { slowms: 500 })  // Profile queries slower than 500ms
   db.system.profile.find().limit(10).sort({ ts: -1 }).pretty()
   EOF

   # Look for:
   # - Missing indexes
   # - Full collection scans
   # - Large batch operations
   ```

5. **Check for database connection issues**
   ```bash
   # Test MongoDB connectivity and latency
   time mongosh $MONGODB_URI --eval "db.admin.command('ping')"

   # If slow, check network:
   # - Firewall rules
   # - IP whitelist
   # - Network connectivity between Lambda VPC and MongoDB Atlas
   ```

#### Resolution Options

**If slow queries detected:**
```bash
# Add index (example)
mongosh $MONGODB_URI << 'EOF'
db.sessions.createIndex({ project_id: 1, status: 1 })
EOF

# Redeploy code to verify improvement
sst deploy --stage production
```

**If many cold starts:**
```bash
# Edit sst.config.ts to increase provisioned concurrency
# Then redeploy

# Or manually enable provisioned concurrency
aws lambda put-provisioned-concurrency-config \
  --function-name claude-projects-state-api-production \
  --provisioned-concurrent-executions 5
```

**If Lambda memory insufficient:**
```bash
# Edit sst.config.ts: increase memory from 512MB to 1024MB
# More memory = more CPU power (Lambda bill by memory * duration)

# Then redeploy
sst deploy --stage production
```

**If connection pool exhausted:**
```typescript
// In MongoDB connection setup, increase connection pool
// Edit app.module.ts
MongooseModule.forRoot(mongoUri, {
  maxPoolSize: 100,  // Increase from default 50
  minPoolSize: 10,
})
```

### Symptom: High Memory Usage

**Threshold:** Memory usage > 400MB (Lambda allocated = 512MB)

#### Steps

1. **Check Lambda memory metrics**
   ```bash
   # Note: Lambda doesn't expose memory usage directly in standard metrics
   # But you can estimate from timeout patterns
   # If requests are timing out at 30s, memory might be insufficient
   ```

2. **Monitor application memory in logs**
   ```bash
   # Add memory logging to application
   console.log(`Memory: ${process.memoryUsage().heapUsed / 1024 / 1024}MB`)

   # Check logs
   aws logs filter-log-log-events \
     --log-group-name /aws/lambda/claude-projects-state-api-production \
     --filter-pattern '"Memory:"' \
     --limit 100
   ```

3. **Increase Lambda memory**
   ```bash
   # Edit sst.config.ts
   memory: "1024 MB"  # Increase from 512MB

   # Deploy
   sst deploy --stage production
   ```

### Performance Degradation Checklist

- [ ] Identified if slow queries or infrastructure issue
- [ ] Checked database for missing indexes
- [ ] Reviewed recent deployments for regressions
- [ ] Verified Lambda is not cold-starting frequently
- [ ] Confirmed sufficient memory allocation
- [ ] Monitored recovery after fixes applied
- [ ] Documented root cause

---

## High Error Rates

### Symptom: Error Rate > 1% (Threshold)

**Severity:** Escalate if > 5% for more than 10 minutes

#### Step 1: Identify Error Type

```bash
# Get error breakdown from CloudWatch Logs Insights
aws logs start-query \
  --log-group-name /aws/lambda/claude-projects-state-api-production \
  --start-time $(date -u -d '30 minutes ago' +%s) \
  --end-time $(date -u +%s) \
  --query-string '
    fields @timestamp, statusCode, error
    | stats count() by statusCode
  '
```

#### Step 2: Classify Errors

**4xx Errors (Client Issues):**
- Usually not a production issue
- May indicate client bugs or API misuse
- Monitor trends but no immediate action

**5xx Errors (Server Issues):**
- Requires immediate investigation
- Root causes:
  - Application exceptions
  - Database errors
  - Timeout errors
  - External service failures

#### Step 3: Investigate by Error Code

**If lots of 500 Internal Server Errors:**
```bash
# Check logs for exceptions
aws logs tail /aws/lambda/claude-projects-state-api-production --since 15m

# Look for stack traces and error messages
# Common causes:
# - Validation errors not caught
# - Database connection issues
# - Unhandled promises/async errors
```

**If lots of 504 Gateway Timeout:**
```bash
# Lambda function timing out (30 second limit)
# Check what endpoints are timing out
aws logs filter-log-events \
  --log-group-name /aws/lambda/claude-projects-state-api-production \
  --filter-pattern '"Task timed out"' \
  --start-time $(date -u -d '30 minutes ago' +%s)000 \
  --end-time $(date -u +%s)000

# Solutions:
# 1. Optimize slow queries
# 2. Add database indexes
# 3. Increase Lambda timeout to 60 seconds (edit sst.config.ts)
# 4. Break long operations into async jobs
```

**If lots of 429 Rate Limit Exceeded:**
```bash
# Either:
# 1. Legitimate spike in traffic (check request count)
# 2. Single client hammering the API (check request logs)

# Check request count
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Count \
  --dimensions Name=ApiId,Value=$API_ID \
  --start-time $(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Sum

# If legitimate spike:
# - Increase Lambda throttle limit (edit sst.config.ts)
# - Or upgrade database tier

# If single client issue:
# - Rate limit that specific API key
# - Contact them to fix their usage pattern
```

**If 404 Not Found errors increased:**
```bash
# Client calling wrong endpoints
# Check which endpoints are 404ing
aws logs filter-log-events \
  --log-group-name /aws/lambda/claude-projects-state-api-production \
  --filter-pattern '"404"' \
  --start-time $(date -u -d '30 minutes ago' +%s)000 \
  --end-time $(date -u +%s)000

# If it's an endpoint that should exist:
# - May be a deployment issue
# - Verify recent deployment succeeded
```

#### Step 4: Implement Fix

```bash
# If code bug identified:
git add .
git commit -m "fix: handle concurrent connection errors"
sst deploy --stage production

# If infrastructure issue:
# Edit sst.config.ts and redeploy

# If database issue:
# Check MongoDB status, add index, optimize query, etc.
```

#### Step 5: Monitor Recovery

```bash
# Watch error rate after fix
watch -n 5 'aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=claude-projects-state-api-production \
  --start-time $(date -u -d '15 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Sum'
```

### High Error Rate Checklist

- [ ] Identified primary error type (4xx vs 5xx)
- [ ] Root cause identified
- [ ] Fix implemented and deployed
- [ ] Error rate dropped below 1%
- [ ] Verified other metrics are normal
- [ ] Created ticket for further investigation (if needed)

---

## Scaling Operations

### Vertical Scaling: Increase Lambda Memory

**When to use:** If Lambda is bottlenecked by CPU, not I/O

**Steps:**

1. **Confirm need for scaling**
   ```bash
   # High execution time + CPU-bound workload?
   # Higher memory = higher CPU allocation in Lambda

   # Check current memory usage patterns
   aws logs tail /aws/lambda/claude-projects-state-api-production \
     --since 30m --grep "Memory"
   ```

2. **Increase memory in sst.config.ts**
   ```typescript
   api.route("ANY /{proxy+}", {
     handler: "src/lambda.handler",
     memory: "1024 MB",  // Changed from 512MB
     // ... rest of config
   });
   ```

3. **Deploy and test**
   ```bash
   sst deploy --stage production

   # Run load test
   for i in {1..100}; do
     curl -H "X-Api-Key: $API_KEY" \
       https://claude-projects.truapi.com/sessions &
   done
   wait
   ```

4. **Monitor metrics**
   ```bash
   # Compare before/after metrics
   aws cloudwatch get-metric-statistics \
     --namespace AWS/Lambda \
     --metric-name Duration \
     --dimensions Name=FunctionName,Value=claude-projects-state-api-production \
     --start-time $(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%S) \
     --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
     --period 60 \
     --statistics Average,Maximum
   ```

### Horizontal Scaling: Database Connection Pool

**When to use:** If database connections are exhausted under load

**Steps:**

1. **Identify connection exhaustion**
   ```bash
   # Check MongoDB connection count
   mongosh $MONGODB_URI << 'EOF'
   db.runCommand({ connectionStatus: 1 })
   EOF
   ```

2. **Increase connection pool in app.module.ts**
   ```typescript
   MongooseModule.forRoot(mongoUri, {
     maxPoolSize: 150,  // Increased from 100
     minPoolSize: 20,   // Increased from 10
   })
   ```

3. **Verify database tier supports connections**
   ```bash
   # For MongoDB Atlas:
   # - M2/M5 tiers: 300 connections (shared cluster)
   # - M10+: 1000+ connections (dedicated)
   # - Scale up if needed in Atlas console
   ```

4. **Deploy and monitor**
   ```bash
   sst deploy --stage production

   # Check new connection pool stats
   mongosh $MONGODB_URI << 'EOF'
   db.runCommand({ connectionStatus: 1 })
   EOF
   ```

### Load Testing Before Scaling

**Always test in staging first:**

```bash
# 1. Deploy to staging
sst deploy --stage staging

# 2. Run load test (using Apache Bench)
ab -n 1000 -c 100 \
  -H "X-Api-Key: $API_KEY" \
  https://staging-claude-projects.truapi.com/sessions

# 3. Check metrics in staging
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=claude-projects-state-api-staging \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Average,Maximum

# 4. If staging looks good, apply same config to production
```

### Automatic Scaling Considerations

**Lambda doesn't need manual scaling** (it auto-scales)
- Automatically adds concurrent executions as needed
- May be throttled if burst capacity exceeded

**To reduce throttling:**
1. Increase provisioned concurrency
2. Reduce cold start time (by optimizing dependencies)

**Example: Enable provisioned concurrency**
```bash
aws lambda put-provisioned-concurrency-config \
  --function-name claude-projects-state-api-production \
  --provisioned-concurrent-executions 10
```

### Scaling Checklist

- [ ] Load testing completed in staging
- [ ] Scaling change deployed to staging first
- [ ] Metrics monitored and confirm improvement
- [ ] Capacity headroom added (don't run at 100%)
- [ ] Cost impact calculated
- [ ] Monitoring alerts adjusted for new baselines
- [ ] Rollback plan documented

---

## Emergency Procedures

### Complete Service Restart

**Warning: Use only as last resort after all troubleshooting fails**

```bash
# 1. Notify stakeholders
# Post to Slack/incident channel that you're performing emergency restart

# 2. Stop accepting new requests (optional, may not be possible)
# Update API Gateway to return 503 Service Unavailable

# 3. Clear any stuck connections
# Kill Lambda execution environment by disabling the function
aws lambda update-function-configuration \
  --function-name claude-projects-state-api-production \
  --environment Variables={}

# 4. Wait 30 seconds
sleep 30

# 5. Re-enable and re-deploy
sst deploy --stage production

# 6. Verify service is up
curl -H "X-Api-Key: $API_KEY" \
  https://claude-projects.truapi.com/health

# 7. Gradually resume normal traffic
```

### Data Loss Prevention

- **Daily automated backups** (MongoDB Atlas handles this)
- **Always test backup restores** (quarterly)
- **Keep point-in-time restore available** (30 days on MongoDB Atlas)

---

## Runbook Reference

**Keep this checklist handy:**

```bash
# Quick diagnosis commands
alias prod-logs="aws logs tail /aws/lambda/claude-projects-state-api-production --follow"
alias prod-errors="aws logs filter-log-events --log-group-name /aws/lambda/claude-projects-state-api-production --filter-pattern 'ERROR' --since 15m"
alias prod-status="curl -H 'X-Api-Key: $API_KEY' https://claude-projects.truapi.com/health/ready | jq ."

# Quick deployment commands
alias deploy-staging="sst deploy --stage staging"
alias deploy-prod="sst deploy --stage production"
alias rollback-prod="sst deploy --stage production --prior-deployment"
```

**Important phone numbers/contacts:**
- Infrastructure lead: [TBD]
- On-call engineer: [Rotate weekly]
- Database administrator: [TBD]

**Useful links:**
- [AWS CloudWatch Console](https://console.aws.amazon.com/cloudwatch/)
- [MongoDB Atlas Console](https://cloud.mongodb.com/)
- [SST Documentation](https://docs.sst.dev/)
- [NestJS Documentation](https://docs.nestjs.com/)

