#!/bin/bash

# ==============================================================================
# Claude Projects MCP Server - Local Development Setup
# ==============================================================================
# Sets up the MCP server for local development with Claude Desktop
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

# Detect OS
detect_os() {
  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
  elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    OS="windows"
  else
    OS="unknown"
  fi
  echo "$OS"
}

# Get Claude Desktop config path based on OS
get_claude_config_path() {
  local os=$1
  case "$os" in
    macos)
      echo "$HOME/Library/Application Support/Claude/claude_desktop_config.json"
      ;;
    linux)
      echo "$HOME/.config/Claude/claude_desktop_config.json"
      ;;
    windows)
      echo "$APPDATA/Claude/claude_desktop_config.json"
      ;;
    *)
      echo ""
      ;;
  esac
}

# Main setup
main() {
  log_info "Starting local development setup..."
  echo ""

  # Step 1: Check Node.js and pnpm
  log_info "Checking prerequisites..."

  if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed"
    exit 1
  fi

  if ! command -v pnpm &> /dev/null; then
    log_info "Installing pnpm..."
    npm install -g pnpm
  fi

  log_success "Prerequisites met"
  echo ""

  # Step 2: Install dependencies
  log_info "Installing MCP server dependencies..."
  cd "$MCP_SERVER_DIR"
  pnpm install
  log_success "Dependencies installed"
  echo ""

  # Step 3: Build the server
  log_info "Building MCP server..."
  pnpm build
  log_success "Build complete"
  echo ""

  # Step 4: Setup .env file
  log_info "Setting up environment file..."
  if [ ! -f "$MCP_SERVER_DIR/.env" ]; then
    cp "$MCP_SERVER_DIR/.env.example" "$MCP_SERVER_DIR/.env"
    log_success "Created .env from template"

    log_warning "⚠️  Important: Edit the .env file with your values:"
    echo ""
    echo "  $MCP_SERVER_DIR/.env"
    echo ""
    echo "Required values:"
    echo "  - STATE_TRACKING_API_KEY: Your API key"
    echo "  - WS_API_KEY: A secure random string (32+ characters)"
    echo "  - GITHUB_TOKEN: Your GitHub PAT with repo scopes"
    echo ""
  else
    log_info ".env file already exists"
  fi
  echo ""

  # Step 5: Get MCP server path
  MCP_SERVER_ABSOLUTE_PATH=$(cd "$MCP_SERVER_DIR" && pwd)
  log_info "MCP Server path: $MCP_SERVER_ABSOLUTE_PATH"
  echo ""

  # Step 6: Configure Claude Desktop
  OS=$(detect_os)
  CLAUDE_CONFIG_PATH=$(get_claude_config_path "$OS")

  if [ -z "$CLAUDE_CONFIG_PATH" ]; then
    log_warning "Unable to detect Claude Desktop config path for your OS"
    OS="unknown"
  fi

  if [ "$OS" != "unknown" ]; then
    log_info "Configuring Claude Desktop for $OS..."

    # Ensure config directory exists
    CLAUDE_CONFIG_DIR=$(dirname "$CLAUDE_CONFIG_PATH")
    mkdir -p "$CLAUDE_CONFIG_DIR"

    # Create or update Claude Desktop config
    if [ ! -f "$CLAUDE_CONFIG_PATH" ]; then
      log_info "Creating Claude Desktop config..."
      cat > "$CLAUDE_CONFIG_PATH" << EOF
{
  "mcpServers": {
    "claude-projects": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "$MCP_SERVER_ABSOLUTE_PATH",
      "env": {
        "NODE_ENV": "development",
        "STATE_TRACKING_API_KEY": "\${STATE_TRACKING_API_KEY}",
        "WS_API_KEY": "\${WS_API_KEY}",
        "GITHUB_TOKEN": "\${GITHUB_TOKEN}",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
EOF
    else
      log_warning "Claude Desktop config already exists"
      log_info "Please manually add/update the server configuration:"
      log_info "  Path: $CLAUDE_CONFIG_PATH"
    fi

    log_success "Claude Desktop configured"
    echo ""
  fi

  # Step 7: Final instructions
  echo ""
  log_info "Setup complete! Next steps:"
  echo ""
  echo "1. Edit your environment file:"
  echo "   $MCP_SERVER_DIR/.env"
  echo ""
  echo "2. If not already done, update Claude Desktop config:"
  if [ "$OS" != "unknown" ]; then
    echo "   $CLAUDE_CONFIG_PATH"
  else
    log_info "   Refer to: $MCP_SERVER_DIR/claude_desktop_config.json"
  fi
  echo ""
  echo "3. Restart Claude Desktop"
  echo ""
  echo "4. In Claude, open Developer Tools (Cmd+Shift+I or Ctrl+Shift+I)"
  echo ""
  echo "5. Check the MCP tab to verify the server is connected"
  echo ""
  echo "6. Test by asking Claude to use a tool, e.g.:"
  echo "   '@health-check' to test API connectivity"
  echo ""
  echo "For more information, see:"
  echo "   $MCP_SERVER_DIR/README.md"
  echo "   $MCP_SERVER_DIR/claude_desktop_config.json"
  echo ""

  log_success "Local development setup complete!"
}

# Run main function
main "$@"
