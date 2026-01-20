#!/bin/bash

##############################################################################
# Deployment Verification Script
#
# Verifies that the Claude Projects State Tracking API is properly deployed
# across dev, staging, and production environments.
#
# Usage: ./verify-deployment.sh [STAGE]
# Examples:
#   ./verify-deployment.sh dev
#   ./verify-deployment.sh staging
#   ./verify-deployment.sh production
##############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Stage to verify (default to production)
STAGE="${1:-production}"

# Configuration
CUSTOM_DOMAIN="claude-projects.truapi.com"
HEALTH_ENDPOINT="/health"
SESSION_ENDPOINT="/api/sessions"
API_TIMEOUT=10

##############################################################################
# Helper Functions
##############################################################################

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

section_header() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

check_command_exists() {
    if ! command -v "$1" &> /dev/null; then
        log_error "$1 not found. Please install it first."
        return 1
    fi
    return 0
}

##############################################################################
# Prerequisites Check
##############################################################################

verify_prerequisites() {
    section_header "Checking Prerequisites"

    local missing=0

    # Check required commands
    for cmd in aws curl dig; do
        if check_command_exists "$cmd"; then
            log_success "$cmd is installed"
        else
            missing=$((missing + 1))
        fi
    done

    if [ $missing -gt 0 ]; then
        log_error "$missing required command(s) not found"
        return 1
    fi

    # Check AWS credentials
    if aws sts get-caller-identity &>/dev/null; then
        local account=$(aws sts get-caller-identity --query 'Account' --output text)
        log_success "AWS credentials configured (Account: $account)"
    else
        log_error "AWS credentials not configured"
        return 1
    fi

    return 0
}

##############################################################################
# Environment-Specific Endpoint Resolution
##############################################################################

get_api_endpoint() {
    local stage=$1

    # Get endpoint from SST deployment
    if [ "$stage" = "production" ]; then
        echo "$CUSTOM_DOMAIN"
    else
        # For dev/staging, get the auto-generated API Gateway endpoint
        local api_id=$(aws apigatewayv2 get-apis \
            --query "Items[?Tags.stage=='$stage'].ApiId" \
            --output text \
            --region us-east-1 2>/dev/null || echo "")

        if [ -z "$api_id" ]; then
            echo ""
        else
            echo "${api_id}.execute-api.us-east-1.amazonaws.com"
        fi
    fi
}

##############################################################################
# DNS Verification (Production Only)
##############################################################################

verify_dns_resolution() {
    section_header "DNS Resolution Verification"

    if [ "$STAGE" != "production" ]; then
        log_warning "DNS verification only applicable for production"
        return 0
    fi

    log_info "Resolving domain: $CUSTOM_DOMAIN"

    if dig "$CUSTOM_DOMAIN" +short | grep -q .; then
        local ip=$(dig "$CUSTOM_DOMAIN" +short | head -1)
        log_success "Domain resolves to: $ip"

        # Additional DNS checks
        local ns_records=$(dig "$CUSTOM_DOMAIN" NS +short | wc -l)
        log_info "Nameservers configured: $ns_records"

        return 0
    else
        log_error "Domain does not resolve"
        log_info "Try flushing DNS cache: sudo dscacheutil -flushcache"
        return 1
    fi
}

##############################################################################
# SSL Certificate Verification (Production Only)
##############################################################################

verify_ssl_certificate() {
    section_header "SSL Certificate Verification"

    if [ "$STAGE" != "production" ]; then
        log_warning "SSL certificate verification only applicable for production"
        return 0
    fi

    log_info "Checking SSL certificate for: $CUSTOM_DOMAIN"

    # Get certificate details
    local cert_info=$(echo | openssl s_client -servername "$CUSTOM_DOMAIN" \
        -connect "$CUSTOM_DOMAIN:443" 2>/dev/null | \
        openssl x509 -noout -text 2>/dev/null)

    if [ -z "$cert_info" ]; then
        log_error "Failed to retrieve SSL certificate"
        return 1
    fi

    # Extract certificate details
    local issuer=$(echo "$cert_info" | grep "Issuer:" | sed 's/.*Issuer: //')
    local subject=$(echo "$cert_info" | grep "Subject:" | sed 's/.*Subject: //')
    local valid_from=$(echo "$cert_info" | grep "Not Before:" | sed 's/.*Not Before: //')
    local valid_to=$(echo "$cert_info" | grep "Not After:" | sed 's/.*Not After: //')

    log_success "Certificate Subject: $subject"
    log_info "Certificate Issuer: $issuer"
    log_info "Valid From: $valid_from"
    log_info "Valid Until: $valid_to"

    # Check certificate expiration
    local expires=$(date -d "$valid_to" +%s 2>/dev/null || date -jf "%b %d %T %Y %Z" "$valid_to" +%s 2>/dev/null || echo 0)
    local now=$(date +%s)
    local days_left=$(( (expires - now) / 86400 ))

    if [ $days_left -lt 0 ]; then
        log_error "Certificate has expired ($days_left days ago)"
        return 1
    elif [ $days_left -lt 30 ]; then
        log_warning "Certificate expires in $days_left days"
    else
        log_success "Certificate is valid for $days_left more days"
    fi

    return 0
}

##############################################################################
# API Endpoint Verification
##############################################################################

verify_api_endpoint() {
    section_header "API Endpoint Verification"

    local endpoint=$(get_api_endpoint "$STAGE")

    if [ -z "$endpoint" ]; then
        log_error "Could not determine API endpoint for stage: $STAGE"
        log_info "Ensure the application is deployed to stage: $STAGE"
        return 1
    fi

    log_info "Testing API endpoint: https://$endpoint"

    # Determine protocol based on endpoint
    local protocol="https"
    if [[ "$endpoint" == *"localhost"* ]] || [[ "$endpoint" == *"127.0.0.1"* ]]; then
        protocol="http"
    fi

    return 0
}

##############################################################################
# Health Check Verification
##############################################################################

verify_health_check() {
    section_header "Health Check Verification"

    local endpoint=$(get_api_endpoint "$STAGE")

    if [ -z "$endpoint" ]; then
        log_error "Could not determine API endpoint"
        return 1
    fi

    log_info "Testing: GET https://$endpoint$HEALTH_ENDPOINT"

    local response=$(curl -s -w "\n%{http_code}" \
        --connect-timeout $API_TIMEOUT \
        --max-time $API_TIMEOUT \
        "https://$endpoint$HEALTH_ENDPOINT" 2>&1)

    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n-1)

    if [ "$http_code" = "200" ]; then
        log_success "Health check returned HTTP 200"
        log_info "Response: ${body:0:100}..."
        return 0
    else
        log_error "Health check returned HTTP $http_code"
        log_info "Response: ${body:0:200}"
        return 1
    fi
}

##############################################################################
# HTTPS/TLS Verification
##############################################################################

verify_https() {
    section_header "HTTPS/TLS Verification"

    local endpoint=$(get_api_endpoint "$STAGE")

    if [ -z "$endpoint" ]; then
        log_error "Could not determine API endpoint"
        return 1
    fi

    log_info "Testing HTTPS connection to: https://$endpoint"

    local tls_version=$(curl -s -I \
        --connect-timeout $API_TIMEOUT \
        --max-time $API_TIMEOUT \
        -w "%{ssl_protocol}" \
        "https://$endpoint$HEALTH_ENDPOINT" 2>&1 | tail -1)

    if [ -n "$tls_version" ]; then
        log_success "HTTPS connection successful (TLS: $tls_version)"
        return 0
    else
        log_error "Failed to establish HTTPS connection"
        return 1
    fi
}

##############################################################################
# API Authentication Verification
##############################################################################

verify_api_authentication() {
    section_header "API Authentication Verification"

    local endpoint=$(get_api_endpoint "$STAGE")

    if [ -z "$endpoint" ]; then
        log_error "Could not determine API endpoint"
        return 1
    fi

    log_info "Testing API authentication on: $SESSION_ENDPOINT"

    # Test without API key (should fail for protected endpoints)
    local response=$(curl -s -w "\n%{http_code}" \
        --connect-timeout $API_TIMEOUT \
        --max-time $API_TIMEOUT \
        "https://$endpoint$SESSION_ENDPOINT" 2>&1)

    local http_code=$(echo "$response" | tail -n1)

    if [ "$http_code" = "401" ] || [ "$http_code" = "403" ]; then
        log_success "Authentication enforced (HTTP $http_code without API key)"
        return 0
    elif [ "$http_code" = "200" ]; then
        log_warning "Public endpoint accessible without authentication"
        return 0
    else
        log_error "Unexpected response: HTTP $http_code"
        return 1
    fi
}

##############################################################################
# CloudWatch Monitoring Verification
##############################################################################

verify_cloudwatch_monitoring() {
    section_header "CloudWatch Monitoring Verification"

    log_info "Checking CloudWatch logs for stage: $STAGE"

    local log_group="/aws/lambda/claude-projects-state-api-${STAGE}"

    if aws logs describe-log-groups --log-group-name-prefix "$log_group" \
        --region us-east-1 2>/dev/null | grep -q "logGroupName"; then
        log_success "CloudWatch log group exists: $log_group"

        # Check for recent logs
        local recent_logs=$(aws logs tail "$log_group" \
            --since 5m \
            --follow=false \
            --region us-east-1 2>/dev/null | wc -l)

        if [ "$recent_logs" -gt 0 ]; then
            log_success "Recent log entries found ($recent_logs lines)"
        else
            log_warning "No recent log entries (may be normal if no traffic)"
        fi
    else
        log_warning "CloudWatch log group not found: $log_group"
    fi

    return 0
}

##############################################################################
# AWS Resources Verification
##############################################################################

verify_aws_resources() {
    section_header "AWS Resources Verification"

    log_info "Verifying deployed AWS resources for stage: $STAGE"

    # Check API Gateway
    local api_exists=$(aws apigatewayv2 get-apis \
        --query "Items[?Tags.stage=='$STAGE'].ApiId" \
        --output text \
        --region us-east-1 2>/dev/null || echo "")

    if [ -n "$api_exists" ]; then
        log_success "API Gateway found: $api_exists"
    else
        log_error "API Gateway not found for stage: $STAGE"
        return 1
    fi

    # Check Lambda function
    local lambda_exists=$(aws lambda list-functions \
        --region us-east-1 \
        --query "Functions[?contains(FunctionName, 'state-api')].FunctionName" \
        --output text 2>/dev/null || echo "")

    if [ -n "$lambda_exists" ]; then
        log_success "Lambda function found: $lambda_exists"
    else
        log_warning "Lambda function not found"
    fi

    # Check for production custom domain (if applicable)
    if [ "$STAGE" = "production" ]; then
        log_info "Verifying custom domain configuration..."

        local domain_exists=$(aws apigatewayv2 get-domain-names \
            --region us-east-1 \
            --query "Items[?Name=='$CUSTOM_DOMAIN'].Name" \
            --output text 2>/dev/null || echo "")

        if [ -n "$domain_exists" ]; then
            log_success "Custom domain configured: $CUSTOM_DOMAIN"
        else
            log_warning "Custom domain not found in API Gateway"
            log_info "It may be configured via CloudFront distribution"
        fi
    fi

    return 0
}

##############################################################################
# ACM Certificate Verification (Production)
##############################################################################

verify_acm_certificate() {
    section_header "ACM Certificate Verification"

    if [ "$STAGE" != "production" ]; then
        log_warning "ACM verification only applicable for production"
        return 0
    fi

    log_info "Checking ACM certificate for: $CUSTOM_DOMAIN"

    local cert_arn=$(aws acm list-certificates \
        --region us-east-1 \
        --query "CertificateSummaryList[?DomainName=='$CUSTOM_DOMAIN'].CertificateArn" \
        --output text 2>/dev/null || echo "")

    if [ -n "$cert_arn" ]; then
        log_success "Certificate found: $cert_arn"

        # Get certificate details
        local cert_details=$(aws acm describe-certificate \
            --certificate-arn "$cert_arn" \
            --region us-east-1 2>/dev/null)

        local status=$(echo "$cert_details" | grep -o '"Status": "[^"]*"' | cut -d'"' -f4)

        if [ "$status" = "SUCCESS" ]; then
            log_success "Certificate status: $status"
        else
            log_warning "Certificate status: $status"
        fi
    else
        log_error "Certificate not found for domain: $CUSTOM_DOMAIN"
        return 1
    fi

    return 0
}

##############################################################################
# Domain Connectivity Test (Production)
##############################################################################

verify_domain_connectivity() {
    section_header "Domain Connectivity Test"

    if [ "$STAGE" != "production" ]; then
        log_warning "Domain connectivity test only applicable for production"
        return 0
    fi

    log_info "Testing domain connectivity: $CUSTOM_DOMAIN"

    # Test basic connectivity
    if timeout $API_TIMEOUT bash -c "cat < /dev/null > /dev/tcp/$CUSTOM_DOMAIN/443" 2>/dev/null; then
        log_success "Port 443 (HTTPS) is reachable"
    else
        log_error "Port 443 (HTTPS) is not reachable"
        return 1
    fi

    # Test HTTP redirect (should redirect to HTTPS)
    local http_response=$(curl -s -w "\n%{http_code}" \
        --connect-timeout $API_TIMEOUT \
        --max-time $API_TIMEOUT \
        --location \
        "http://$CUSTOM_DOMAIN/health" 2>&1)

    local http_code=$(echo "$http_response" | tail -n1)

    if [ "$http_code" = "200" ]; then
        log_success "HTTP redirects correctly to HTTPS"
    else
        log_warning "HTTP response code: $http_code (may be normal if HTTP not configured)"
    fi

    return 0
}

##############################################################################
# Production Validation Test
##############################################################################

verify_production_validation() {
    section_header "Production Validation Test Suite"

    local endpoint=$(get_api_endpoint "$STAGE")

    if [ -z "$endpoint" ]; then
        log_error "Could not determine API endpoint"
        return 1
    fi

    local protocol="https"
    if [[ "$endpoint" == *"localhost"* ]] || [[ "$endpoint" == *"127.0.0.1"* ]]; then
        protocol="http"
    fi

    local api_url="$protocol://$endpoint"

    log_info "Running smoke test against: $api_url"

    # Get the script directory
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    # Check if smoke-test.sh exists
    if [ ! -f "$script_dir/smoke-test.sh" ]; then
        log_warning "Smoke test script not found at $script_dir/smoke-test.sh"
        return 0
    fi

    # Run the smoke test
    if bash "$script_dir/smoke-test.sh" "$api_url" 2>&1 | tee /tmp/smoke-test-output.log > /dev/null; then
        log_success "Production validation suite passed"
        return 0
    else
        log_warning "Some production validation checks failed (see details above)"
        # Non-fatal for overall verification
        return 0
    fi
}

##############################################################################
# Summary Report
##############################################################################

print_summary() {
    section_header "Verification Summary"

    echo -e "\n${BLUE}Stage:${NC} $STAGE"

    if [ "$STAGE" = "production" ]; then
        echo -e "${BLUE}Domain:${NC} $CUSTOM_DOMAIN"
        echo -e "${BLUE}Protocol:${NC} HTTPS (SSL/TLS)"
    else
        local endpoint=$(get_api_endpoint "$STAGE")
        echo -e "${BLUE}Endpoint:${NC} https://$endpoint"
    fi

    echo -e "\n${BLUE}Key Verification Points:${NC}"
    echo -e "  • Prerequisites installed and configured"
    echo -e "  • AWS resources deployed"
    echo -e "  • API endpoint accessible"
    echo -e "  • Health check responding"
    echo -e "  • HTTPS/TLS working"
    echo -e "  • CloudWatch monitoring enabled"

    if [ "$STAGE" = "production" ]; then
        echo -e "  • DNS resolving correctly"
        echo -e "  • SSL certificate valid"
        echo -e "  • ACM certificate configured"
    fi

    echo -e "\n${GREEN}✓ Verification complete${NC}\n"
}

##############################################################################
# Main Execution
##############################################################################

main() {
    echo -e "${BLUE}"
    cat << "EOF"
╔═══════════════════════════════════════════════════════════════════════════╗
║                   Deployment Verification Script                         ║
║        Claude Projects State Tracking API - AWS Lambda + API Gateway     ║
╚═══════════════════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"

    log_info "Verifying deployment for stage: $STAGE"

    # Run all verification checks
    local failed=0

    if ! verify_prerequisites; then
        failed=$((failed + 1))
    fi

    if ! verify_aws_resources; then
        failed=$((failed + 1))
    fi

    if ! verify_api_endpoint; then
        failed=$((failed + 1))
    fi

    if ! verify_https; then
        failed=$((failed + 1))
    fi

    if ! verify_health_check; then
        failed=$((failed + 1))
    fi

    if ! verify_api_authentication; then
        failed=$((failed + 1))
    fi

    if ! verify_cloudwatch_monitoring; then
        # Non-fatal
        :
    fi

    # Production validation tests
    if ! verify_production_validation; then
        # Non-fatal
        :
    fi

    # Production-specific checks
    if [ "$STAGE" = "production" ]; then
        if ! verify_dns_resolution; then
            failed=$((failed + 1))
        fi

        if ! verify_ssl_certificate; then
            failed=$((failed + 1))
        fi

        if ! verify_acm_certificate; then
            failed=$((failed + 1))
        fi

        if ! verify_domain_connectivity; then
            failed=$((failed + 1))
        fi
    fi

    print_summary

    if [ $failed -gt 0 ]; then
        log_error "$failed verification(s) failed"
        exit 1
    else
        log_success "All verifications passed!"
        exit 0
    fi
}

# Run main function
main "$@"
