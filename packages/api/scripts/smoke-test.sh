#!/bin/bash

##############################################################################
# Production Smoke Test Script
#
# Validates critical API endpoints and functionality in production environments.
# Tests basic functionality, response times, and error handling.
#
# Usage: ./smoke-test.sh <API_URL> [API_KEY]
# Examples:
#   ./smoke-test.sh http://localhost:3000
#   ./smoke-test.sh https://claude-projects.truapi.com your-api-key
#   ./smoke-test.sh https://api.staging.example.com staging-key
##############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL="${1:?Error: API_URL is required. Usage: ./smoke-test.sh <API_URL> [API_KEY]}"
API_KEY="${2:-test-valid-api-key-12345678}"
TIMEOUT=10
RESPONSE_TIME_THRESHOLD=2000 # milliseconds

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Session/Task IDs for cleanup
SESSION_ID=""
TASK_IDS=()

##############################################################################
# Helper Functions
##############################################################################

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
    ((TESTS_PASSED++))
}

log_error() {
    echo -e "${RED}✗${NC} $1"
    ((TESTS_FAILED++))
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((TESTS_SKIPPED++))
}

section_header() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

sub_section() {
    echo -e "\n${YELLOW}→${NC} $1"
}

check_command_exists() {
    if ! command -v "$1" &> /dev/null; then
        log_error "$1 not found. Please install it first."
        return 1
    fi
    return 0
}

# Verify prerequisites
verify_prerequisites() {
    section_header "Checking Prerequisites"

    local missing=0

    for cmd in curl jq; do
        if check_command_exists "$cmd"; then
            log_success "$cmd is installed"
        else
            missing=$((missing + 1))
        fi
    done

    if [ $missing -gt 0 ]; then
        log_error "$missing required command(s) not found"
        exit 1
    fi

    # Verify API URL is accessible
    sub_section "Verifying API connectivity"

    if curl -s --max-time $TIMEOUT "$API_URL/health" > /dev/null 2>&1; then
        log_success "API is accessible at $API_URL"
    else
        log_error "Cannot reach API at $API_URL"
        exit 1
    fi
}

# Test response time
test_response_time() {
    local endpoint=$1
    local expected_max_time=$2
    local method=${3:-GET}
    local auth=${4:-false}

    local start_time=$(date +%s%N | cut -b1-13)

    if [ "$auth" = "true" ]; then
        local response=$(curl -s --max-time $TIMEOUT \
            -X "$method" \
            -H "X-API-Key: $API_KEY" \
            "$API_URL$endpoint")
    else
        local response=$(curl -s --max-time $TIMEOUT \
            -X "$method" \
            "$API_URL$endpoint")
    fi

    local end_time=$(date +%s%N | cut -b1-13)
    local duration=$((end_time - start_time))

    if [ "$duration" -lt "$expected_max_time" ]; then
        log_success "Response time for $endpoint: ${duration}ms (threshold: ${expected_max_time}ms)"
        echo "$response"
    else
        log_warning "Response time for $endpoint: ${duration}ms (threshold: ${expected_max_time}ms)"
        echo "$response"
    fi
}

# Cleanup function
cleanup() {
    section_header "Cleaning Up"

    if [ -n "$SESSION_ID" ]; then
        sub_section "Deleting test session"

        local response=$(curl -s --max-time $TIMEOUT \
            -X DELETE \
            -H "X-API-Key: $API_KEY" \
            "$API_URL/sessions/$SESSION_ID")

        if echo "$response" | jq . > /dev/null 2>&1 || [ -z "$response" ]; then
            log_success "Session cleanup successful"
        else
            log_warning "Session cleanup may have failed: $response"
        fi
    fi
}

# Trap EXIT to ensure cleanup
trap cleanup EXIT

##############################################################################
# Test Sections
##############################################################################

test_health_endpoints() {
    section_header "Testing Health Endpoints"

    # Health check
    sub_section "GET /health"
    local health_response=$(test_response_time "/health" 500 "GET" false)

    if echo "$health_response" | jq '.status' | grep -q "ok"; then
        log_success "Health endpoint returns correct status"
    else
        log_error "Health endpoint status invalid"
        echo "Response: $health_response"
        return 1
    fi

    # Ready check
    sub_section "GET /health/ready"
    local ready_response=$(test_response_time "/health/ready" 500 "GET" false)

    if echo "$ready_response" | jq '.ready' | grep -q "true"; then
        log_success "Readiness check returns ready=true"
    else
        log_error "Readiness check failed"
        echo "Response: $ready_response"
        return 1
    fi
}

test_authentication() {
    section_header "Testing Authentication"

    sub_section "GET /sessions without API key"
    local response=$(curl -s --max-time $TIMEOUT -w "\n%{http_code}" "$API_URL/sessions")
    local http_code=$(echo "$response" | tail -n1)

    if [ "$http_code" = "401" ]; then
        log_success "Unauthenticated request rejected (401)"
    else
        log_error "Expected 401, got $http_code"
        return 1
    fi

    sub_section "GET /sessions with invalid API key"
    local response=$(curl -s --max-time $TIMEOUT \
        -w "\n%{http_code}" \
        -H "X-API-Key: invalid-key" \
        "$API_URL/sessions")
    local http_code=$(echo "$response" | tail -n1)

    if [ "$http_code" = "401" ]; then
        log_success "Invalid API key rejected (401)"
    else
        log_error "Expected 401, got $http_code"
        return 1
    fi

    sub_section "GET /sessions with valid API key"
    local response=$(curl -s --max-time $TIMEOUT \
        -w "\n%{http_code}" \
        -H "X-API-Key: $API_KEY" \
        "$API_URL/sessions")
    local http_code=$(echo "$response" | tail -n1)

    if [ "$http_code" = "200" ]; then
        log_success "Valid API key accepted (200)"
    else
        log_error "Expected 200, got $http_code"
        return 1
    fi
}

test_session_workflow() {
    section_header "Testing Session Workflow"

    sub_section "POST /sessions - Create session"
    local create_response=$(curl -s --max-time $TIMEOUT \
        -X POST \
        -H "X-API-Key: $API_KEY" \
        -H "Content-Type: application/json" \
        -d '{
            "project_id": "smoke-test-'$(date +%s)'",
            "machine_id": "smoke-machine-'$(date +%s)'",
            "docker_slot": 1,
            "metadata": {"test": "smoke_test"}
        }' \
        "$API_URL/sessions")

    if ! echo "$create_response" | jq '.session_id' > /dev/null 2>&1; then
        log_error "Failed to create session"
        echo "Response: $create_response"
        return 1
    fi

    SESSION_ID=$(echo "$create_response" | jq -r '.session_id')
    log_success "Session created: $SESSION_ID"

    sub_section "GET /sessions/:id - Retrieve session"
    local get_response=$(curl -s --max-time $TIMEOUT \
        -H "X-API-Key: $API_KEY" \
        "$API_URL/sessions/$SESSION_ID")

    if echo "$get_response" | jq -e ".session_id == \"$SESSION_ID\"" > /dev/null; then
        log_success "Session retrieved successfully"
    else
        log_error "Failed to retrieve session"
        echo "Response: $get_response"
        return 1
    fi

    sub_section "GET /sessions - List sessions"
    local list_response=$(curl -s --max-time $TIMEOUT \
        -H "X-API-Key: $API_KEY" \
        "$API_URL/sessions?limit=10")

    if echo "$list_response" | jq '.[0]' > /dev/null 2>&1; then
        log_success "Sessions list retrieved successfully"
    else
        log_error "Failed to retrieve sessions list"
        echo "Response: $list_response"
        return 1
    fi
}

test_task_workflow() {
    section_header "Testing Task Workflow"

    if [ -z "$SESSION_ID" ]; then
        log_warning "Session ID not set, skipping task tests"
        return 0
    fi

    sub_section "POST /sessions/:id/tasks - Create task"
    local create_response=$(curl -s --max-time $TIMEOUT \
        -X POST \
        -H "X-API-Key: $API_KEY" \
        -H "Content-Type: application/json" \
        -d '{
            "title": "Smoke Test Task",
            "description": "Test task for smoke testing",
            "status": "pending"
        }' \
        "$API_URL/sessions/$SESSION_ID/tasks")

    if ! echo "$create_response" | jq '.task_id' > /dev/null 2>&1; then
        log_error "Failed to create task"
        echo "Response: $create_response"
        return 1
    fi

    local task_id=$(echo "$create_response" | jq -r '.task_id')
    TASK_IDS+=("$task_id")
    log_success "Task created: $task_id"

    sub_section "GET /sessions/:id/tasks - List tasks"
    local list_response=$(curl -s --max-time $TIMEOUT \
        -H "X-API-Key: $API_KEY" \
        "$API_URL/sessions/$SESSION_ID/tasks")

    if echo "$list_response" | jq '.[0]' > /dev/null 2>&1; then
        log_success "Tasks list retrieved successfully"
    else
        log_error "Failed to retrieve tasks list"
        echo "Response: $list_response"
        return 1
    fi

    sub_section "PUT /sessions/:id/tasks/:task_id - Update task"
    local update_response=$(curl -s --max-time $TIMEOUT \
        -X PUT \
        -H "X-API-Key: $API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"status": "in_progress"}' \
        "$API_URL/sessions/$SESSION_ID/tasks/$task_id")

    if echo "$update_response" | jq -e '.status == "in_progress"' > /dev/null 2>&1; then
        log_success "Task updated successfully"
    else
        log_error "Failed to update task"
        echo "Response: $update_response"
        return 1
    fi
}

test_heartbeat() {
    section_header "Testing Heartbeat Endpoint"

    if [ -z "$SESSION_ID" ]; then
        log_warning "Session ID not set, skipping heartbeat tests"
        return 0
    fi

    sub_section "POST /sessions/:id/heartbeat - Send heartbeat"
    local heartbeat_response=$(curl -s --max-time $TIMEOUT \
        -X POST \
        -H "X-API-Key: $API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"metadata": {"status": "working"}}' \
        "$API_URL/sessions/$SESSION_ID/heartbeat")

    if echo "$heartbeat_response" | jq '.session_id' > /dev/null 2>&1; then
        log_success "Heartbeat sent successfully"
    else
        log_error "Failed to send heartbeat"
        echo "Response: $heartbeat_response"
        return 1
    fi
}

test_error_handling() {
    section_header "Testing Error Handling"

    sub_section "GET /sessions/:id with invalid ID"
    local response=$(curl -s --max-time $TIMEOUT \
        -w "\n%{http_code}" \
        -H "X-API-Key: $API_KEY" \
        "$API_URL/sessions/invalid-session-id-12345")
    local http_code=$(echo "$response" | tail -n1)

    if [ "$http_code" = "404" ]; then
        log_success "Non-existent session returns 404"
    else
        log_warning "Expected 404, got $http_code"
    fi

    sub_section "POST /sessions with invalid data"
    local response=$(curl -s --max-time $TIMEOUT \
        -w "\n%{http_code}" \
        -X POST \
        -H "X-API-Key: $API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"invalid_field": "value"}' \
        "$API_URL/sessions")
    local http_code=$(echo "$response" | tail -n1)

    if [ "$http_code" = "400" ]; then
        log_success "Invalid request returns 400"
    else
        log_warning "Expected 400, got $http_code"
    fi
}

test_rate_limiting() {
    section_header "Testing Rate Limiting"

    sub_section "Sending rapid health check requests"
    local success_count=0
    local error_count=0

    for i in {1..20}; do
        local http_code=$(curl -s --max-time $TIMEOUT \
            -w "%{http_code}" \
            -o /dev/null \
            "$API_URL/health")

        if [ "$http_code" = "200" ]; then
            ((success_count++))
        elif [ "$http_code" = "429" ]; then
            ((error_count++))
        fi
    done

    log_success "Rate limit test: $success_count/20 requests succeeded"

    if [ $error_count -gt 0 ]; then
        log_warning "Rate limit triggered: $error_count requests throttled"
    fi
}

test_data_consistency() {
    section_header "Testing Data Consistency"

    if [ -z "$SESSION_ID" ]; then
        log_warning "Session ID not set, skipping data consistency tests"
        return 0
    fi

    sub_section "Verifying session data consistency"
    local response1=$(curl -s --max-time $TIMEOUT \
        -H "X-API-Key: $API_KEY" \
        "$API_URL/sessions/$SESSION_ID")

    local response2=$(curl -s --max-time $TIMEOUT \
        -H "X-API-Key: $API_KEY" \
        "$API_URL/sessions/$SESSION_ID")

    if [ "$(echo "$response1" | jq '.session_id')" = "$(echo "$response2" | jq '.session_id')" ]; then
        log_success "Session data is consistent across multiple reads"
    else
        log_error "Session data inconsistency detected"
        return 1
    fi
}

##############################################################################
# Main Execution
##############################################################################

main() {
    echo -e "\n${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║     Production Smoke Test Suite                           ║${NC}"
    echo -e "${BLUE}║     API URL: $API_URL${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"

    verify_prerequisites
    test_health_endpoints
    test_authentication
    test_session_workflow
    test_task_workflow
    test_heartbeat
    test_error_handling
    test_rate_limiting
    test_data_consistency

    # Print Summary
    section_header "Test Summary"

    local total=$((TESTS_PASSED + TESTS_FAILED + TESTS_SKIPPED))
    echo -e "${GREEN}✓ Passed: $TESTS_PASSED${NC}"
    echo -e "${RED}✗ Failed: $TESTS_FAILED${NC}"
    echo -e "${YELLOW}⚠ Skipped: $TESTS_SKIPPED${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}All critical tests passed!${NC}\n"
        return 0
    else
        echo -e "${RED}Some tests failed. Please review the output above.${NC}\n"
        return 1
    fi
}

# Run main function
main
exit_code=$?

exit $exit_code
