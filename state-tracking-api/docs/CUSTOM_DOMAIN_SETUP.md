# Custom Domain Configuration Guide

This guide walks through setting up a custom domain for the Claude Projects State Tracking API using AWS Certificate Manager (ACM), Route53, and API Gateway.

## Overview

The production API is configured to use the custom domain `claude-projects.truapi.com`. This requires:

1. Creating an SSL/TLS certificate in AWS Certificate Manager
2. Validating the certificate via DNS
3. Configuring the domain in SST/API Gateway
4. Verifying the domain resolves and the certificate is valid

## Prerequisites

- AWS account with appropriate permissions
- AWS CLI configured with credentials
- Access to DNS provider for truapi.com domain
- SST CLI installed locally

## Step-by-Step Setup

### Step 1: Create SSL Certificate in ACM

The SSL certificate must be created in **us-east-1** region, as this is required by API Gateway for custom domains.

```bash
# Request a new certificate for the custom domain
aws acm request-certificate \
  --domain-name claude-projects.truapi.com \
  --validation-method DNS \
  --region us-east-1
```

**Output:**
The command returns a Certificate ARN like: `arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERTIFICATE_ID`

Save this ARN for later reference.

### Step 2: DNS Validation

AWS requires DNS validation to prove you own the domain. The certificate remains "Pending validation" until DNS records are added.

#### Option A: Using Route53 (Recommended)

If the domain is hosted in AWS Route53:

```bash
# Get the validation records (DNS name and value)
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERTIFICATE_ID \
  --region us-east-1 \
  --query 'Certificate.DomainValidationOptions[*].[DomainName,ResourceRecord.{Name:Name,Type:Type,Value:Value}]' \
  --output table
```

The output will show:
- **Domain Name**: `claude-projects.truapi.com`
- **Record Name** (CNAME): `_XXXXX.claude-projects.truapi.com`
- **Record Type**: `CNAME`
- **Record Value**: `_XXXXX.acm-validations.aws.`

Add this CNAME record to your Route53 hosted zone for `truapi.com`:

```bash
# Using AWS CLI (optional automation)
aws route53 change-resource-record-sets \
  --hosted-zone-id ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "_XXXXX.claude-projects.truapi.com",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [{"Value": "_XXXXX.acm-validations.aws"}]
      }
    }]
  }'
```

#### Option B: Using External DNS Provider

If your domain is hosted elsewhere (e.g., GoDaddy, Namecheap):

1. Log into your DNS provider
2. Create a new CNAME record with:
   - **Name**: `_XXXXX.claude-projects` (substitute the validation token)
   - **Type**: `CNAME`
   - **Value**: `_XXXXX.acm-validations.aws`
3. Save the record

### Step 3: Verify Certificate Validation

Check the certificate status:

```bash
# View certificate details
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERTIFICATE_ID \
  --region us-east-1 \
  --query 'Certificate.[Status,DomainName]'
```

Expected output: `["SUCCESS", "claude-projects.truapi.com"]`

The validation typically completes within 5-30 minutes once DNS records are added.

### Step 4: Configure Domain in SST

The custom domain is already configured in `sst.config.ts` for the production stage:

```typescript
// sst.config.ts - lines 47-53
...(stage === "production" && {
  domain: {
    name: "claude-projects.truapi.com",
    // For non-production, use stage prefix
    // name: `${stage}-claude-projects.truapi.com`,
  },
}),
```

**Important Notes:**

- The domain is only active in production (`stage === "production"`)
- Development and staging deployments do not use custom domain
- Development uses: `https://[api-id].execute-api.us-east-1.amazonaws.com`
- Staging can optionally use a domain prefix if needed

### Step 5: Deploy to Production

Once the certificate is validated, deploy to production:

```bash
# Set SST stage to production
export AWS_PROFILE=your-aws-profile

# Deploy
cd state-tracking-api
pnpm deploy:prod
```

**What SST does during deployment:**

1. Locates the validated certificate in ACM
2. Creates an API Gateway custom domain name mapping
3. If using Route53, creates the necessary DNS alias records
4. Configures the base path mapping (if needed)

**Deployment output will show:**
```
API Endpoint: https://claude-projects.truapi.com
```

### Step 6: DNS Propagation

After deployment, DNS may take a few minutes to propagate globally:

```bash
# Check DNS resolution
nslookup claude-projects.truapi.com

# Should return an API Gateway endpoint
# Name: claude-projects.truapi.com
# Address: [CloudFront IP address]
```

### Step 7: Verify Domain Configuration

Test the domain is working correctly:

```bash
# Health check endpoint
curl -v https://claude-projects.truapi.com/health

# Should return:
# - HTTP 200
# - Valid SSL certificate
# - JSON response from API
```

## Certificate Management

### Renewing Certificates

AWS ACM automatically renews certificates for you. No action is needed.

### Viewing Certificates

```bash
# List all certificates in us-east-1
aws acm list-certificates --region us-east-1

# Get details of a specific certificate
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERTIFICATE_ID \
  --region us-east-1
```

### Deleting Certificates

Only delete certificates that are no longer in use:

```bash
aws acm delete-certificate \
  --certificate-arn arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERTIFICATE_ID \
  --region us-east-1
```

**Warning:** This will break the custom domain. Only do this if you're replacing the certificate.

## Staging Domain Configuration (Optional)

To add a custom domain for staging, modify `sst.config.ts`:

```typescript
// Add domain for staging
...(stage === "staging" && {
  domain: {
    name: "staging-claude-projects.truapi.com",
  },
}),
```

Then follow the same ACM certificate creation and DNS validation steps for `staging-claude-projects.truapi.com`.

## Troubleshooting

### Issue: Certificate Remains "Pending validation"

**Cause:** DNS validation records not created or propagated

**Solution:**
1. Verify DNS records are correctly added to your provider
2. Check record name, type, and value exactly match
3. Wait 5-30 minutes for DNS propagation
4. Try: `nslookup _XXXXX.claude-projects.truapi.com` to verify record exists

### Issue: Domain Returns 404

**Cause:** API Gateway hasn't completed domain mapping setup

**Solution:**
1. Wait 5-10 minutes after deployment
2. Check deployment completed successfully: `pnpm sst info --stage production`
3. Verify SSL certificate is validated: `aws acm describe-certificate`
4. Check API Gateway console for custom domain mappings

### Issue: SSL Certificate Error in Browser

**Cause:** Certificate not yet propagated or incorrect certificate

**Solution:**
1. Verify certificate ARN matches what's deployed
2. Clear browser cache and DNS cache: `sudo dscacheutil -flushcache`
3. Try accessing with `curl -v` to see certificate details
4. Check certificate status in ACM console

### Issue: DNS Not Resolving

**Cause:** DNS records not created or incorrect values

**Solution:**
1. Double-check DNS record values match ACM validation request
2. Try flushing local DNS: `sudo dscacheutil -flushcache`
3. Use online DNS checker: `nslookup` or `dig`
4. Wait for DNS TTL to expire (usually 5 minutes)

## Environment-Specific Domain Configuration

### Development

**Endpoint:** `https://[api-id].execute-api.us-east-1.amazonaws.com`

- No custom domain
- Auto-generated by API Gateway
- Change on each deployment

### Staging

**Endpoint:** `https://[api-id].execute-api.us-east-1.amazonaws.com`

- Optional: Add stage-prefixed custom domain
- Useful for testing domain configuration before production
- Requires separate certificate and DNS records

### Production

**Endpoint:** `https://claude-projects.truapi.com`

- Custom domain required
- SSL certificate automatically validated and renewed by AWS
- DNS records configured in Route53

## Related Documentation

- [DEPLOYMENT.md](./DEPLOYMENT.md) - General deployment procedures
- [AWS ACM Documentation](https://docs.aws.amazon.com/acm/)
- [API Gateway Custom Domain Documentation](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-custom-domains.html)
- [SST API Gateway Configuration](https://sst.dev/docs/component/aws/api-gateway-v2)

## Common Commands Reference

```bash
# List all ACM certificates in us-east-1
aws acm list-certificates --region us-east-1

# Get certificate details
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERTIFICATE_ID \
  --region us-east-1

# Get DNS validation records
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERTIFICATE_ID \
  --region us-east-1 \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'

# Test domain with curl
curl -v https://claude-projects.truapi.com/health

# Check DNS resolution
nslookup claude-projects.truapi.com
dig claude-projects.truapi.com

# View SST deployment info
pnpm sst info --stage production

# Get API Gateway endpoints
aws apigatewayv2 get-apis

# Delete a certificate (use with caution!)
aws acm delete-certificate \
  --certificate-arn arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERTIFICATE_ID \
  --region us-east-1
```

## Security Considerations

1. **Always use HTTPS**: Custom domains use SSL/TLS encryption
2. **Certificate Auto-Renewal**: AWS ACM handles this automatically
3. **DNS Security**: Use Route53 for better security
4. **Access Control**: Restrict API access via API keys or IAM
5. **Monitoring**: Set up CloudWatch alarms for domain/certificate issues

## Next Steps

After successfully configuring the custom domain:

1. Update client applications to use `https://claude-projects.truapi.com`
2. Set up domain-specific monitoring and alerts
3. Document the domain in your runbooks
4. Test failover and recovery procedures
5. Consider implementing rate limiting and WAF rules
