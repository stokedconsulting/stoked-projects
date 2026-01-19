#!/bin/bash

# Script to set up SST secrets from senvn or manual input
# Usage: ./scripts/setup-secrets.sh [stage]
# Example: ./scripts/setup-secrets.sh production

set -e

STAGE=${1:-staging}

echo "========================================"
echo "Setting up SST Secrets for stage: $STAGE"
echo "========================================"
echo ""

# Function to set a secret
set_secret() {
  local secret_name=$1
  local secret_value=$2

  if [ -z "$secret_value" ]; then
    echo "Error: Secret value for $secret_name is empty"
    return 1
  fi

  echo "Setting $secret_name..."
  pnpm sst secret set "$secret_name" "$secret_value" --stage "$STAGE"
  echo "✓ $secret_name set successfully"
  echo ""
}

# Check if senvn is available
if command -v senvn &> /dev/null; then
  echo "📦 senvn detected - attempting to fetch secrets from senvn..."
  echo ""

  # Try to get MongoDB URI from senvn
  if MONGODB_URI=$(senvn get CLAUDE_PROJECTS_MONGODB_URI 2>/dev/null); then
    set_secret "MongoDBUri" "$MONGODB_URI"
  else
    echo "⚠️  Could not fetch CLAUDE_PROJECTS_MONGODB_URI from senvn"
    echo "Please enter manually:"
    read -r -p "MongoDB URI: " MONGODB_URI
    set_secret "MongoDBUri" "$MONGODB_URI"
  fi

  # Try to get API Keys from senvn
  if API_KEYS=$(senvn get CLAUDE_PROJECTS_API_KEYS 2>/dev/null); then
    set_secret "ApiKeys" "$API_KEYS"
  else
    echo "⚠️  Could not fetch CLAUDE_PROJECTS_API_KEYS from senvn"
    echo "Please enter manually (comma-separated):"
    read -r -p "API Keys: " API_KEYS
    set_secret "ApiKeys" "$API_KEYS"
  fi
else
  echo "⚠️  senvn not found - please enter secrets manually"
  echo ""

  # Get MongoDB URI
  read -r -p "MongoDB URI: " MONGODB_URI
  set_secret "MongoDBUri" "$MONGODB_URI"

  # Get API Keys
  read -r -p "API Keys (comma-separated): " API_KEYS
  set_secret "ApiKeys" "$API_KEYS"
fi

echo "========================================"
echo "✅ All secrets configured for $STAGE"
echo "========================================"
echo ""
echo "To verify secrets:"
echo "  pnpm sst secret list --stage $STAGE"
echo ""
echo "To deploy:"
echo "  pnpm deploy:$STAGE"
echo ""
