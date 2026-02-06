# Troubleshooting Guide

Solutions to common problems and debugging procedures for the Claude Projects State Tracking API.

## Table of Contents

- [API Connection Issues](#api-connection-issues)
- [Authentication Problems](#authentication-problems)
- [Database Issues](#database-issues)
- [Performance Problems](#performance-problems)
- [Deployment Issues](#deployment-issues)
- [AWS-Specific Problems](#aws-specific-problems)
- [Debugging Procedures](#debugging-procedures)
- [Common Error Messages](#common-error-messages)

---

## API Connection Issues

### Issue: Cannot Connect to API Endpoint

**Symptoms:**
- `curl: (7) Failed to connect to claude-projects.truapi.com`
- Connection timeout errors
- DNS resolution failures

**Diagnosis Steps:**

1. **Check if API Gateway is deployed**
   ```bash
   # List API Gateways
   aws apigateway get-rest-apis --query 'items[?name==`StateTrackingApi`]'

   # If not found, deployment failed - check CloudFormation
   aws cloudformation describe-stacks \
     --stack-name claude-projects-state-api-production \
     --query 'Stacks[0].StackStatus'
   ```

2. **Verify DNS resolution**
   ```bash
   # Test DNS
   nslookup claude-projects.truapi.com

   # If not resolving, check Route53
   aws route53 list-hosted-zones-by-name --dns-name truapi.com
   ```

3. **Check if API is accessible**
   ```bash
   # Try direct HTTP (without SSL)
   curl -v http://claude-projects.truapi.com/health

   # Try HTTPS
   curl -v https://claude-projects.truapi.com/health

   # If SSL error, check certificate in ACM
   aws acm describe-certificate \
     --certificate-arn arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERT_ID
   ```

4. **Check Lambda function status**
   ```bash
   # Verify Lambda exists and is accessible
   aws lambda get-function \
     --function-name claude-projects-state-api-production
   ```

**Solutions:**

| Symptom | Cause | Solution |
|---------|-------|----------|
| `curl: (6) Could not resolve host` | DNS not resolving | Check Route53 records, wait for propagation (up to 48 hours) |
| `curl: (35) SSL connect error` | SSL certificate issue | Re-issue cert in ACM, update in API Gateway |
| Connection timeout | API Gateway not receiving requests | Redeploy: `sst deploy --stage production` |
| Lambda not found | Deployment incomplete | Check CloudFormation stack events |

### Issue: 502 Bad Gateway

**Symptoms:**
- API returns HTTP 502
- "BadGatewayException" in response

**Causes:**
1. Lambda function crashed
2. Lambda timeout exceeded
3. Lambda out of memory
4. Lambda cold start too slow

**Troubleshooting:**

```bash
# 1. Check Lambda logs for errors
aws logs tail /aws/lambda/claude-projects-state-api-production --since 10m

# 2. Check if Lambda is responding
aws lambda invoke \
  --function-name claude-projects-state-api-production \
  --payload '{"httpMethod":"GET","path":"/health"}' \
  response.json && cat response.json

# 3. Check Lambda memory and timeout
aws lambda get-function-configuration \
  --function-name claude-projects-state-api-production \
  --query '{Memory:MemorySize,Timeout:Timeout}'

# 4. Check if Lambda is throttled
aws lambda get-concurrency-config \
  --function-name claude-projects-state-api-production
```

**Fixes:**

```bash
# Increase memory (improves CPU and cold start)
# Edit sst.config.ts: change "512 MB" to "1024 MB"
sst deploy --stage production

# Increase timeout
# Edit sst.config.ts: change "30 seconds" to "60 seconds"
sst deploy --stage production

# Enable provisioned concurrency to reduce cold starts
aws lambda put-provisioned-concurrency-config \
  --function-name claude-projects-state-api-production \
  --provisioned-concurrent-executions 5
```

---

## Authentication Problems

### Issue: 401 Unauthorized - "Invalid API Key"

**Symptoms:**
- API returns HTTP 401
- "Unauthorized" error message
- "Invalid API Key" in response

**Diagnosis:**

1. **Verify API key exists**
   ```bash
   # Check that API key is in environment
   sst secret get --stage production ApiKeys
   ```

2. **Check request headers**
   ```bash
   # Verify API key is in request
   curl -v -H "X-Api-Key: your-key-here" \
     https://claude-projects.truapi.com/sessions

   # Or with Bearer token
   curl -v -H "Authorization: Bearer your-key-here" \
     https://claude-projects.truapi.com/sessions
   ```

3. **Verify key format**
   ```bash
   # API keys should be UUID v4 format (36 characters)
   # Example: 550e8400-e29b-41d4-a716-446655440000

   # Check your key
   echo "550e8400-e29b-41d4-a716-446655440000" | wc -c  # Should be 37 (36 chars + newline)
   ```

**Solutions:**

| Issue | Solution |
|-------|----------|
| Wrong header name | Use `X-Api-Key` or `Authorization: Bearer` (not `Api-Key` or `Token`) |
| Key typo | Double-check key spelling, copy-paste from vault |
| Expired key | Check if key was rotated, get new key |
| Key not deployed | Run `sst deploy --stage production` after updating secret |
| Development mode bypass not working | Ensure `NODE_ENV=development` and no API keys configured |

### Issue: 403 Forbidden - "Not Authorized"

**Symptoms:**
- API returns HTTP 403
- "Forbidden" error message
- API key is valid but access denied

**This typically means:**
- API key is valid
- But user doesn't have permission for the resource
- Or the resource belongs to a different organization/project

**Note:** Current API doesn't implement detailed authorization, so this is rare. Check logs if occurring.

---

## Database Issues

### Issue: MongoDB Connection Refused

**Symptoms:**
```
MongoError: connect ECONNREFUSED 127.0.0.1:27017
ENOTFOUND atlas.mongodb.net
```

**Diagnosis Steps:**

1. **Verify MongoDB URI is correct**
   ```bash
   # Check what URI is being used
   sst secret get --stage production MongoDBUri

   # Test connection directly
   mongosh "mongodb+srv://user:pass@cluster.mongodb.net/database"
   ```

2. **Check network connectivity**
   ```bash
   # Ping MongoDB server
   ping cluster.mongodb.net

   # Check DNS resolution
   nslookup cluster.mongodb.net

   # Verify port 27017 is accessible
   nc -zv cluster.mongodb.net 27017
   ```

3. **Verify credentials**
   ```bash
   # Try connecting with explicit credentials
   mongosh "mongodb+srv://username:password@cluster.mongodb.net/database" \
     --eval "db.adminCommand('ping')"

   # If authentication fails, credentials are wrong
   ```

4. **Check IP whitelist** (for MongoDB Atlas)
   ```bash
   # MongoDB Atlas restricts connections to whitelisted IPs
   # For Lambda, you need to whitelist:
   # - Your office IP (if deploying from office)
   # - Lambda IP (if using VPC peering or internet access)
   # - Or allow 0.0.0.0/0 (not recommended for production)

   # Check current whitelist in MongoDB Atlas console:
   # Navigate to: Security → Network Access
   ```

**Solutions:**

```bash
# Fix 1: Verify URI format
# Format: mongodb+srv://username:password@host/database?retryWrites=true&w=majority

# Fix 2: Update connection string in secret
sst secret set --stage production MongoDBUri \
  "mongodb+srv://user:password@cluster.mongodb.net/database"

# Fix 3: Restart Lambda to pick up new connection string
sst deploy --stage production

# Fix 4: Test connection
aws lambda invoke \
  --function-name claude-projects-state-api-production \
  --payload '{"httpMethod":"GET","path":"/health/ready"}' \
  response.json
```

### Issue: Slow Database Queries

**Symptoms:**
- API responds slowly (> 500ms)
- Database queries taking > 100ms
- High CPU usage in MongoDB

**Diagnosis:**

1. **Check slow query log**
   ```bash
   # Connect to MongoDB
   mongosh $MONGODB_URI << 'EOF'

   # Enable profiling for slow queries
   db.setProfilingLevel(1, { slowms: 100 })

   # View recent slow queries
   db.system.profile.find({ millis: { $gt: 100 } }).limit(10).pretty()
   EOF
   ```

2. **Identify missing indexes**
   ```bash
   # Check existing indexes on sessions collection
   mongosh $MONGODB_URI << 'EOF'
   db.sessions.getIndexes()
   EOF

   # Common queries that need indexes:
   # - Find by project_id: db.sessions.find({ project_id: X })
   # - Find by status: db.sessions.find({ status: "ACTIVE" })
   # - Find by date range: db.sessions.find({ created_at: { $gt: date } })
   ```

3. **Check for full collection scans**
   ```bash
   # Queries without indexes do full scans
   # Look for executionStages.stage: "COLLSCAN" in slow query logs
   # This indicates no matching index exists
   ```

**Solutions:**

```bash
# Add missing indexes
mongosh $MONGODB_URI << 'EOF'

# Index for project_id (used in find by project)
db.sessions.createIndex({ project_id: 1 })

# Compound index for status + created_at (used in listing)
db.sessions.createIndex({ status: 1, created_at: -1 })

# Index for recovery queries
db.sessions.createIndex({ "metadata.recovery_attempts": 1 })
EOF

# Verify indexes created
mongosh $MONGODB_URI << 'EOF'
db.sessions.getIndexes()
EOF
```

### Issue: Connection Pool Exhausted

**Symptoms:**
- Error: "Pool connection timeout"
- Error: "POOL_CLOSED"
- Under high load, requests fail with connection errors

**Diagnosis:**

```bash
# Check how many connections are open
mongosh $MONGODB_URI << 'EOF'
db.runCommand({ connectionStatus: 1 })
EOF

# Check current vs max pool size
aws lambda get-function-configuration \
  --function-name claude-projects-state-api-production \
  --query 'Environment.Variables'
```

**Solution:**

```bash
# Increase connection pool in app.module.ts
# Look for MongooseModule.forRoot() configuration
# Increase maxPoolSize from 50 to 100 or 150

// stt.config.ts or app.module.ts
MongooseModule.forRoot(mongoUri, {
  maxPoolSize: 150,
  minPoolSize: 20,
})

# Redeploy
sst deploy --stage production

# For MongoDB Atlas tier:
# - M2/M5: max 300 connections
# - M10+: max 1000 connections
# - Upgrade tier if needed
```

### Issue: Data Corruption or Inconsistency

**Symptoms:**
- Duplicate records
- Missing data
- Invalid state transitions

**Diagnosis:**

```bash
# Check for duplicates
mongosh $MONGODB_URI << 'EOF'
db.sessions.aggregate([
  { $group: { _id: "$session_id", count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } }
])
EOF

# Verify referential integrity
mongosh $MONGODB_URI << 'EOF'
# Check for sessions without corresponding tasks
db.sessions.find({
  _id: { $nin: db.tasks.distinct("session_id") }
}).count()
EOF
```

**Recovery:**

```bash
# Restore from backup
# 1. In MongoDB Atlas console
# 2. Navigate to Backup → Snapshots
# 3. Click "Restore" on pre-incident snapshot
# 4. Wait for restore (30-60 minutes)
# 5. Update connection string
# 6. Test application

# Or manually rebuild data
mongosh $MONGODB_URI << 'EOF'
# Delete corrupted records
db.sessions.deleteMany({ /* criteria */ })

# Rebuild from external source if available
EOF
```

---

## Performance Problems

### Issue: API Responds Slowly (> 2 seconds)

**See:** [Performance Degradation section in RUNBOOKS.md](./RUNBOOKS.md#performance-degradation)

### Issue: High CPU Usage

**Symptoms:**
- CloudWatch shows high CPU
- Lambda duration increases
- Errors about "resource limits exceeded"

**Causes:**
1. Inefficient code (nested loops, bad algorithms)
2. Large payloads being processed
3. Regex operations on large strings
4. Synchronous operations blocking event loop

**Diagnosis:**

```bash
# Check recent deployments
git log --oneline -5

# Look for code that changed performance characteristics
git diff HEAD~1 HEAD -- src/

# Profile the code (add timing logs)
# Look for functions taking > 100ms

# Check CloudWatch metrics for concurrent executions
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=claude-projects-state-api-production \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Maximum,Average
```

**Solutions:**

1. **Optimize slow code**
   ```typescript
   // Bad: O(n²) complexity
   for (const session of sessions) {
     const task = tasks.find(t => t.sessionId === session.id);
   }

   // Good: O(n) with Map
   const taskMap = new Map(tasks.map(t => [t.sessionId, t]));
   for (const session of sessions) {
     const task = taskMap.get(session.id);
   }
   ```

2. **Increase Lambda memory**
   ```bash
   # Edit sst.config.ts
   memory: "1024 MB"  # More memory = more CPU

   sst deploy --stage production
   ```

3. **Add caching**
   ```typescript
   // Cache frequently accessed data
   const cache = new Map();
   const getSession = async (id) => {
     if (cache.has(id)) return cache.get(id);
     const session = await sessionsModel.findById(id);
     cache.set(id, session);
     return session;
   };
   ```

### Issue: High Memory Usage

**Symptoms:**
- Lambda out-of-memory errors
- Slow garbage collection
- Request failures after running for a while

**Diagnosis:**

```bash
# Add memory logging to code
console.log(`Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`)

# Check logs
aws logs tail /aws/lambda/claude-projects-state-api-production --follow --filter-pattern "Memory:"

# Check Lambda memory allocation
aws lambda get-function-configuration \
  --function-name claude-projects-state-api-production \
  --query 'MemorySize'
```

**Solutions:**

1. **Increase Lambda memory**
   ```bash
   # Edit sst.config.ts: change "512 MB" to "1024 MB"
   sst deploy --stage production
   ```

2. **Fix memory leaks**
   ```typescript
   // Bad: Growing array that never gets cleared
   const requests = [];
   app.post('/request', (req, res) => {
     requests.push(req);  // Never cleared!
   });

   // Good: Use proper async/await with scope
   app.post('/request', async (req, res) => {
     const data = await processRequest(req);  // Freed after response
     res.send(data);
   });
   ```

3. **Monitor for leaks**
   ```typescript
   // Add periodic memory reporting
   setInterval(() => {
     const mem = process.memoryUsage();
     console.log({
       heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
       heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
       external: Math.round(mem.external / 1024 / 1024),
     });
   }, 10000);
   ```

---

## Deployment Issues

### Issue: Deployment Fails with "Invalid Lambda"

**Symptoms:**
```
Error: Invalid Lambda function
ValidationException: An error occurred when calling the CreateFunction operation
```

**Causes:**
1. NestJS build failed
2. Missing dependencies
3. Invalid handler path
4. File size too large

**Troubleshooting:**

```bash
# 1. Check build output
pnpm run build

# 2. Verify handler exists
ls -la dist/lambda.js

# 3. Check file size (Lambda has 250MB limit)
ls -lh dist/

# 4. Rebuild and redeploy
pnpm run build
sst deploy --stage production
```

**Solutions:**

```bash
# Fix 1: Rebuild with clean state
rm -rf dist node_modules
pnpm install
pnpm run build

# Fix 2: Check for build errors
pnpm run build 2>&1 | tail -20

# Fix 3: Reduce bundle size
# Edit tsconfig.json to exclude dev dependencies
# Remove unnecessary packages from dependencies
```

### Issue: Environment Variables Not Set

**Symptoms:**
- Lambda can't access `process.env.MONGODB_URI`
- Error: "MONGODB_URI is undefined"

**Diagnosis:**

```bash
# Check secret is set
sst secret list --stage production

# Check Lambda environment
aws lambda get-function-configuration \
  --function-name claude-projects-state-api-production \
  --query 'Environment.Variables'
```

**Solutions:**

```bash
# Set secret if missing
sst secret set --stage production MongoDBUri \
  "mongodb+srv://user:pass@cluster.mongodb.net/database"

# Redeploy to apply
sst deploy --stage production

# Verify it was set
sst secret get --stage production MongoDBUri
```

### Issue: Rollback Fails

**Symptoms:**
- Can't rollback to previous version
- "StackUpdateRollback" status

**Solutions:**

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name claude-projects-state-api-production \
  --query 'Stacks[0].StackStatus'

# Continue rollback if stuck
aws cloudformation continue-update-rollback \
  --stack-name claude-projects-state-api-production

# Force delete and redeploy
aws cloudformation delete-stack \
  --stack-name claude-projects-state-api-production

# Wait for deletion
aws cloudformation wait stack-delete-complete \
  --stack-name claude-projects-state-api-production

# Redeploy
sst deploy --stage production
```

---

## AWS-Specific Problems

### Issue: Access Denied / IAM Permission Error

**Symptoms:**
```
AccessDenied: User is not authorized to perform: lambda:InvokeFunction
```

**Causes:**
1. IAM user doesn't have required permissions
2. Cross-account access issue
3. Resource-based policy restricts access

**Solutions:**

```bash
# Check current user
aws sts get-caller-identity

# Check IAM policy
aws iam get-user-policy --user-name YOUR_USER --policy-name YOUR_POLICY

# Add Lambda permissions if needed
aws iam attach-user-policy \
  --user-name YOUR_USER \
  --policy-arn arn:aws:iam::aws:policy/AWSLambdaFullAccess

# Verify role has permissions for deployment
aws iam get-role-policy \
  --role-name claude-projects-state-api-role \
  --policy-name inline-policy
```

### Issue: S3 Bucket Not Found

**Symptoms:**
- "NoSuchBucket" error
- SST state not found
- Deployment fails

**Solutions:**

```bash
# List S3 buckets to find SST state bucket
aws s3 ls | grep sst

# If bucket doesn't exist, SST will create it automatically
# Just run deploy again
sst deploy --stage production
```

### Issue: CloudFormation Stack in CREATE_FAILED State

**Symptoms:**
- Stack won't deploy or update
- Status shows CREATE_FAILED

**Solutions:**

```bash
# View stack events to see what failed
aws cloudformation describe-stack-events \
  --stack-name claude-projects-state-api-production \
  --query 'StackEvents[0:10].{Time:Timestamp,Status:ResourceStatus,Reason:ResourceStatusReason}'

# Delete and redeploy
aws cloudformation delete-stack \
  --stack-name claude-projects-state-api-production

# Wait for deletion
aws cloudformation wait stack-delete-complete \
  --stack-name claude-projects-state-api-production

# Redeploy
sst deploy --stage production
```

### Issue: Lambda Function Not Updating

**Symptoms:**
- Code changes don't take effect after deploy
- Old code still running
- Cache issues

**Solutions:**

```bash
# Force rebuild and clear cache
rm -rf .sst dist

# Redeploy
sst deploy --stage production

# Update alias to force invocation of new version
aws lambda update-alias \
  --function-name claude-projects-state-api-production \
  --name live \
  --function-version $(aws lambda list-versions-by-function \
    --function-name claude-projects-state-api-production \
    --query 'Versions[-1].Version' \
    --output text)
```

---

## Debugging Procedures

### Enable Debug Logging

1. **In Application Code**
   ```typescript
   // Add debug logging
   if (process.env.DEBUG) {
     console.log('Debug info:', data);
   }

   // Or use debug library
   import debug from 'debug';
   const log = debug('app:sessions');
   log('Creating session', dto);
   ```

2. **In Environment**
   ```bash
   # Set debug environment variable
   sst secret set --stage production DEBUG "true"
   sst deploy --stage production

   # View logs
   aws logs tail /aws/lambda/claude-projects-state-api-production --follow
   ```

### Trace Request Through Logs

```bash
# Find request by endpoint
aws logs filter-log-events \
  --log-group-name /aws/lambda/claude-projects-state-api-production \
  --filter-pattern '"/sessions"' \
  --limit 20

# Find by request ID (if logged)
aws logs filter-log-events \
  --log-group-name /aws/lambda/claude-projects-state-api-production \
  --filter-pattern '"request-id": "550e8400-e29b-41d4-a716-446655440000"'

# Find by error type
aws logs filter-log-events \
  --log-group-name /aws/lambda/claude-projects-state-api-production \
  --filter-pattern '"MongoError"'
```

### Local Testing

```bash
# Run locally with dev environment
pnpm run start:dev

# Test endpoint locally
curl -H "X-Api-Key: test-key" http://localhost:3000/sessions

# Run with SST (deploys and runs locally)
pnpm sst:dev

# Run with debugging
node --inspect-brk -r tsconfig-paths/register \
  -r ts-node/register node_modules/.bin/nest start
```

---

## Common Error Messages

### "ValidationError: field X is required"

**Cause:** Missing required field in request body

**Fix:**
```bash
# Include all required fields
curl -X POST \
  -H "X-Api-Key: key" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "123",
    "status": "ACTIVE",
    "machine_id": "machine-1"
  }' \
  https://claude-projects.truapi.com/sessions
```

### "ENOTFOUND atlas.mongodb.net"

**Cause:** DNS cannot resolve MongoDB domain

**Fix:**
```bash
# Check network connectivity
ping atlas.mongodb.net

# Verify credentials and domain
# Check sst secret
sst secret get --stage production MongoDBUri
```

### "Task timed out after 30 seconds"

**Cause:** Lambda execution exceeds timeout

**Fix:**
```bash
# Increase timeout in sst.config.ts
timeout: "60 seconds"

# Or optimize slow code
# See Performance Problems section
```

### "Too many connections"

**Cause:** Connection pool exhausted

**Fix:**
```bash
# Increase connection pool
# See Database Issues → Connection Pool Exhausted
```

### "CORS policy: Cross-origin request blocked"

**Cause:** Frontend domain not in CORS allowed list

**Fix:**
```bash
# Edit sst.config.ts CORS configuration
cors: {
  allowOrigins: ["https://yourdomain.com", "http://localhost:3000"],
  allowMethods: ["GET", "POST", "PUT", "DELETE"],
  // ...
}

sst deploy --stage production
```

### "Signature does not match"

**Cause:** AWS credential signature invalid (usually expired or wrong key)

**Fix:**
```bash
# Refresh AWS credentials
aws configure

# Or use temporary credentials
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."

sst deploy --stage production
```

---

## Getting Help

If none of these solutions work:

1. **Check CloudWatch Logs** - Most detailed error info
   ```bash
   aws logs tail /aws/lambda/claude-projects-state-api-production --follow
   ```

2. **Check Application Logs** - Next level of detail
   ```bash
   git log --oneline -5
   pnpm run test
   ```

3. **Enable Debug Mode**
   ```bash
   DEBUG=* sst dev
   ```

4. **Contact Support**
   - For AWS issues: AWS Support Console
   - For SST issues: [SST Discord Community](https://discord.gg/sst)
   - For Application issues: Create GitHub issue with logs
