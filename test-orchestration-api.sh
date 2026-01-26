#!/bin/bash

# Test script for orchestration API
# Usage: ./test-orchestration-api.sh [API_URL] [API_KEY]

API_URL="${1:-http://localhost:3000}"
API_KEY="${2:-test-key}"
WORKSPACE_ID="/Users/test/workspace1"

echo "Testing Orchestration API at $API_URL"
echo "========================================="
echo ""

# Test 1: Get workspace orchestration (should create if not exists)
echo "1. GET workspace orchestration"
curl -s -X GET \
  -H "X-API-Key: $API_KEY" \
  "$API_URL/api/orchestration/workspace/$(echo -n "$WORKSPACE_ID" | jq -sRr @uri)" | jq
echo ""

# Test 2: Update workspace desired
echo "2. UPDATE workspace desired to 3"
curl -s -X PUT \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"desired": 3}' \
  "$API_URL/api/orchestration/workspace/$(echo -n "$WORKSPACE_ID" | jq -sRr @uri)/desired" | jq
echo ""

# Test 3: Get global totals
echo "3. GET global orchestration"
curl -s -X GET \
  -H "X-API-Key: $API_KEY" \
  "$API_URL/api/orchestration/global" | jq
echo ""

# Test 4: List all workspaces
echo "4. LIST all workspaces"
curl -s -X GET \
  -H "X-API-Key: $API_KEY" \
  "$API_URL/api/orchestration/workspaces" | jq
echo ""

echo "========================================="
echo "Tests complete!"
