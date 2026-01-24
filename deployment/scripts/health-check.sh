#!/bin/bash

# ==============================================================================
# Claude Projects MCP Server - Health Check Script
# ==============================================================================
# Monitors the health of the MCP server and reports status
# Usage: ./health-check.sh [container-name] [options]
# ==============================================================================

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
CONTAINER_NAME="${1:-claude-projects-mcp-server}"
CHECK_INTERVAL=30
MAX_ATTEMPTS=10
VERBOSE=false

# Functions
log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
  echo -e "${RED}[✗]${NC} $1"
}

show_usage() {
  cat << EOF
Usage: $0 [container-name] [options]

Arguments:
  container-name  Docker container name (default: claude-projects-mcp-server)

Options:
  --interval      Check interval in seconds (default: 30)
  --max-attempts  Maximum number of checks (default: 10)
  --verbose       Enable verbose output
  --once          Run health check once and exit
  --help          Show this help message

Examples:
  # Check health once
  $0 --once

  # Monitor with 60 second interval
  $0 --interval 60

  # Monitor with verbose output
  $0 --verbose

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval)
      CHECK_INTERVAL="$2"
      shift 2
      ;;
    --max-attempts)
      MAX_ATTEMPTS="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --once)
      MAX_ATTEMPTS=1
      shift
      ;;
    --help)
      show_usage
      exit 0
      ;;
    *)
      CONTAINER_NAME="$1"
      shift
      ;;
  esac
done

# Health check functions
check_container_running() {
  if docker ps -q -f name="$CONTAINER_NAME" | grep -q .; then
    return 0
  else
    return 1
  fi
}

check_container_health() {
  local health_status=$(docker inspect "$CONTAINER_NAME" --format='{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
  echo "$health_status"
}

check_api_endpoint() {
  local port="${1:-8080}"
  timeout 5 bash -c "echo >/dev/tcp/localhost/$port" 2>/dev/null || return 1
}

check_ws_connection() {
  # Try to connect to WebSocket endpoint
  timeout 5 bash -c 'exec 3<>/dev/tcp/localhost/8080; echo -e "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n" >&3; cat <&3' 2>/dev/null || return 1
}

check_docker_stats() {
  docker stats --no-stream "$CONTAINER_NAME" --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null || return 1
}

show_container_logs() {
  local lines="${1:-20}"
  log_info "Recent logs (last $lines lines):"
  docker logs --tail "$lines" "$CONTAINER_NAME" 2>/dev/null | head -n "$lines"
}

# Main health check
main() {
  local attempt=1
  local failed_checks=0

  log_info "Starting health check for: $CONTAINER_NAME"
  echo ""

  while [ $attempt -le $MAX_ATTEMPTS ]; do
    echo "=== Check $attempt/$MAX_ATTEMPTS $(date '+%Y-%m-%d %H:%M:%S') ==="
    echo ""

    # Check 1: Container running
    if check_container_running; then
      log_success "Container is running"
    else
      log_error "Container is NOT running"
      ((failed_checks++))
    fi

    # Check 2: Container health status
    if check_container_running; then
      local health_status=$(check_container_health)
      case "$health_status" in
        healthy)
          log_success "Health status: HEALTHY"
          ;;
        starting)
          log_warning "Health status: STARTING"
          ;;
        unhealthy)
          log_error "Health status: UNHEALTHY"
          ((failed_checks++))
          ;;
        *)
          log_warning "Health status: $health_status"
          ;;
      esac
    fi

    # Check 3: API endpoint accessible
    if check_api_endpoint; then
      log_success "API endpoint accessible (port 8080)"
    else
      log_error "API endpoint NOT accessible"
      ((failed_checks++))
    fi

    # Check 4: Resource usage
    if check_container_running; then
      if [ "$VERBOSE" = true ]; then
        log_info "Resource usage:"
        check_docker_stats | tail -n +2 | sed 's/^/  /'
      fi
    fi

    # Check 5: Recent logs (if verbose)
    if [ "$VERBOSE" = true ] && check_container_running; then
      echo ""
      show_container_logs 5
    fi

    echo ""

    # Exit on first check if --once
    if [ $MAX_ATTEMPTS -eq 1 ]; then
      break
    fi

    # Sleep before next check
    if [ $attempt -lt $MAX_ATTEMPTS ]; then
      log_info "Next check in $CHECK_INTERVAL seconds (Ctrl+C to stop)..."
      sleep "$CHECK_INTERVAL"
    fi

    ((attempt++))
  done

  # Final summary
  echo ""
  echo "=== Health Check Summary ==="
  echo "Total checks: $MAX_ATTEMPTS"
  echo "Failed checks: $failed_checks"
  echo ""

  if [ $failed_checks -eq 0 ]; then
    log_success "All health checks passed!"
    return 0
  else
    log_error "$failed_checks check(s) failed"
    log_warning "Showing recent logs:"
    echo ""
    show_container_logs 20
    return 1
  fi
}

# Run health check
main "$@"
