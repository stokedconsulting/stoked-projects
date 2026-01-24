#!/bin/bash

# ==============================================================================
# Claude Projects MCP Server - Container Startup Script
# ==============================================================================
# Initializes and starts the MCP server with proper configuration
# This script runs inside the Docker container
# ==============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Validate required environment variables
validate_environment() {
  log_info "Validating environment variables..."

  local required_vars=(
    "STATE_TRACKING_API_KEY"
    "WS_API_KEY"
  )

  local missing_vars=()

  for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
      missing_vars+=("$var")
    fi
  done

  if [ ${#missing_vars[@]} -gt 0 ]; then
    log_error "Missing required environment variables:"
    for var in "${missing_vars[@]}"; do
      echo "  - $var"
    done
    return 1
  fi

  log_success "All required environment variables are set"
  return 0
}

# Set default environment variables
set_defaults() {
  log_info "Setting default environment variables..."

  export NODE_ENV="${NODE_ENV:-production}"
  export LOG_LEVEL="${LOG_LEVEL:-warn}"
  export STATE_TRACKING_API_URL="${STATE_TRACKING_API_URL:-https://api.claude-projects.example.com}"
  export REQUEST_TIMEOUT_MS="${REQUEST_TIMEOUT_MS:-20000}"
  export RETRY_ATTEMPTS="${RETRY_ATTEMPTS:-5}"
  export WS_PORT="${WS_PORT:-8080}"
  export WS_HOST="${WS_HOST:-0.0.0.0}"
  export GRACEFUL_SHUTDOWN_TIMEOUT="${GRACEFUL_SHUTDOWN_TIMEOUT:-90000}"

  log_success "Default environment variables set"
}

# Display startup information
show_startup_info() {
  cat << EOF

╔════════════════════════════════════════════════════════════╗
║  Claude Projects MCP Server - Starting Up                 ║
╚════════════════════════════════════════════════════════════╝

Environment Configuration:
  - Node Environment: $NODE_ENV
  - Log Level: $LOG_LEVEL
  - API URL: $STATE_TRACKING_API_URL
  - WebSocket Port: $WS_PORT
  - WebSocket Host: $WS_HOST
  - Request Timeout: ${REQUEST_TIMEOUT_MS}ms
  - Retry Attempts: $RETRY_ATTEMPTS
  - Graceful Shutdown Timeout: ${GRACEFUL_SHUTDOWN_TIMEOUT}ms

EOF
}

# Setup signal handlers for graceful shutdown
setup_signal_handlers() {
  log_info "Setting up signal handlers for graceful shutdown..."

  # Handle SIGTERM
  trap 'handle_sigterm' SIGTERM

  # Handle SIGINT
  trap 'handle_sigint' SIGINT

  log_success "Signal handlers configured"
}

handle_sigterm() {
  log_info "Received SIGTERM - initiating graceful shutdown..."
  # The server process should handle this directly
  kill -SIGTERM $$
}

handle_sigint() {
  log_info "Received SIGINT - initiating graceful shutdown..."
  # The server process should handle this directly
  kill -SIGINT $$
}

# Perform health check before startup
pre_startup_check() {
  log_info "Performing pre-startup checks..."

  # Check if dist directory exists
  if [ ! -d "/app/dist" ]; then
    log_error "Built server files not found at /app/dist"
    return 1
  fi

  # Check if index.js exists
  if [ ! -f "/app/dist/index.js" ]; then
    log_error "Server entry point not found at /app/dist/index.js"
    return 1
  fi

  log_success "Pre-startup checks passed"
  return 0
}

# Create necessary directories
prepare_directories() {
  log_info "Preparing directories..."

  mkdir -p /app/logs
  chmod 755 /app/logs

  log_success "Directories prepared"
}

# Main startup
main() {
  log_info "Starting MCP Server initialization..."
  echo ""

  # Step 1: Validate environment
  if ! validate_environment; then
    log_error "Environment validation failed"
    exit 1
  fi
  echo ""

  # Step 2: Set defaults
  set_defaults
  echo ""

  # Step 3: Display startup info
  show_startup_info

  # Step 4: Prepare directories
  if ! prepare_directories; then
    log_error "Failed to prepare directories"
    exit 1
  fi
  echo ""

  # Step 5: Pre-startup checks
  if ! pre_startup_check; then
    log_error "Pre-startup checks failed"
    exit 1
  fi
  echo ""

  # Step 6: Setup signal handlers
  setup_signal_handlers
  echo ""

  # Step 7: Start the server
  log_success "All checks passed - starting MCP Server"
  echo ""

  exec node /app/dist/index.js
}

# Run main function
main "$@"
