#!/bin/bash

# ==============================================================================
# Claude Projects MCP Server - Deployment Script
# ==============================================================================
# Deploys the MCP server to production or staging environment
# Usage: ./deploy.sh [environment] [options]
# ==============================================================================

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$DEPLOYMENT_DIR")"
MCP_SERVER_DIR="$PROJECT_ROOT/packages/mcp-server"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
ENVIRONMENT="${1:-production}"
BUILD_IMAGE=false
PUSH_IMAGE=false
REGISTRY=""
VERSION="latest"

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

show_usage() {
  cat << EOF
Usage: $0 [environment] [options]

Environments:
  development   Deploy to local development environment
  staging       Deploy to staging environment
  production    Deploy to production environment (default)

Options:
  --build       Build Docker image before deployment
  --push        Push image to Docker registry after build
  --registry    Docker registry URL (e.g., docker.io/myregistry)
  --version     Image version tag (default: latest)
  --no-cache    Build Docker image without cache
  --help        Show this help message

Examples:
  # Deploy to production with built image
  $0 production --build

  # Deploy to staging and push to registry
  $0 staging --build --push --registry docker.io/mycompany

  # Deploy development locally without rebuilding
  $0 development

EOF
}

# Parse arguments
while [[ $# -gt 1 ]]; do
  case "$2" in
    --build)
      BUILD_IMAGE=true
      shift
      ;;
    --push)
      PUSH_IMAGE=true
      shift
      ;;
    --registry)
      REGISTRY="$3"
      shift 2
      ;;
    --version)
      VERSION="$3"
      shift 2
      ;;
    --no-cache)
      DOCKER_BUILD_OPTS="--no-cache"
      shift
      ;;
    --help)
      show_usage
      exit 0
      ;;
    *)
      log_error "Unknown option: $2"
      show_usage
      exit 1
      ;;
  esac
done

# Validate environment
case "$ENVIRONMENT" in
  development|staging|production)
    log_info "Deploying to: $ENVIRONMENT"
    ;;
  *)
    log_error "Invalid environment: $ENVIRONMENT"
    show_usage
    exit 1
    ;;
esac

# Step 1: Validate prerequisites
log_info "Validating prerequisites..."

if ! command -v docker &> /dev/null; then
  log_error "Docker is not installed"
  exit 1
fi

if ! command -v docker-compose &> /dev/null; then
  log_error "Docker Compose is not installed"
  exit 1
fi

if [ ! -f "$DEPLOYMENT_DIR/docker-compose.yml" ]; then
  log_error "docker-compose.yml not found at $DEPLOYMENT_DIR"
  exit 1
fi

if [ ! -f "$MCP_SERVER_DIR/.env" ]; then
  log_error ".env file not found in $MCP_SERVER_DIR"
  log_info "Create it from .env.example:"
  log_info "  cp $MCP_SERVER_DIR/.env.example $MCP_SERVER_DIR/.env"
  exit 1
fi

log_success "Prerequisites validated"

# Step 2: Load environment configuration
log_info "Loading environment configuration for: $ENVIRONMENT"

ENV_FILE="$DEPLOYMENT_DIR/config/.env.$ENVIRONMENT"
if [ ! -f "$ENV_FILE" ]; then
  log_warning "Environment config not found: $ENV_FILE"
  log_info "Using default .env from: $MCP_SERVER_DIR"
  ENV_FILE="$MCP_SERVER_DIR/.env"
fi

export $(cat "$ENV_FILE" | grep -v '^#' | xargs)
log_success "Configuration loaded"

# Step 3: Build Docker image if requested
if [ "$BUILD_IMAGE" = true ]; then
  log_info "Building Docker image..."

  IMAGE_NAME="claude-projects-mcp-server"
  IMAGE_TAG="${REGISTRY:+$REGISTRY/}$IMAGE_NAME:$VERSION"

  docker build \
    $DOCKER_BUILD_OPTS \
    -t "$IMAGE_TAG" \
    -t "$IMAGE_NAME:latest" \
    -f "$DEPLOYMENT_DIR/Dockerfile" \
    "$PROJECT_ROOT"

  if [ $? -eq 0 ]; then
    log_success "Docker image built successfully: $IMAGE_TAG"
  else
    log_error "Failed to build Docker image"
    exit 1
  fi

  # Step 4: Push image to registry if requested
  if [ "$PUSH_IMAGE" = true ]; then
    if [ -z "$REGISTRY" ]; then
      log_error "--push requires --registry to be specified"
      exit 1
    fi

    log_info "Pushing image to registry: $REGISTRY"
    docker push "$IMAGE_TAG"

    if [ $? -eq 0 ]; then
      log_success "Image pushed successfully to: $REGISTRY"
    else
      log_error "Failed to push image"
      exit 1
    fi
  fi
fi

# Step 5: Deploy using docker-compose
log_info "Deploying using docker-compose..."

cd "$DEPLOYMENT_DIR"

# Set environment for docker-compose
export NODE_ENV="$ENVIRONMENT"

case "$ENVIRONMENT" in
  development)
    log_info "Starting services in development mode..."
    docker-compose up -d
    ;;
  staging)
    log_info "Starting services in staging mode..."
    docker-compose --profile with-proxy up -d
    ;;
  production)
    log_info "Starting services in production mode..."
    docker-compose --profile with-proxy --profile with-cache up -d
    ;;
esac

if [ $? -eq 0 ]; then
  log_success "Services started successfully"
else
  log_error "Failed to start services"
  exit 1
fi

# Step 6: Verify deployment
log_info "Verifying deployment..."
sleep 5

# Check if containers are running
CONTAINERS=$(docker-compose ps -q)
if [ -z "$CONTAINERS" ]; then
  log_error "No containers are running"
  docker-compose logs
  exit 1
fi

# Check health status
HEALTH_STATUS=$(docker-compose exec -T mcp-server docker inspect claude-projects-mcp-server --format='{{.State.Health.Status}}' 2>/dev/null || echo "unknown")

case "$HEALTH_STATUS" in
  healthy)
    log_success "Service is healthy"
    ;;
  starting)
    log_info "Service is starting up..."
    ;;
  *)
    log_warning "Service health status: $HEALTH_STATUS"
    ;;
esac

# Step 7: Display status
log_info "Deployment complete!"
echo ""
log_info "Service Status:"
docker-compose ps

echo ""
log_info "View logs with:"
echo "  docker-compose logs -f mcp-server"

echo ""
log_info "Stop services with:"
echo "  docker-compose down"

echo ""
log_success "Deployment successful for environment: $ENVIRONMENT"
