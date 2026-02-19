#!/bin/bash
# Deploy api to local launchd service

set -e

cd "$(dirname "$0")/.."

if [ ! -d "dist" ] || [ ! -f "dist/main.js" ]; then
    echo "🔨 Building api..."
    npm run build
else
    echo "✅ Using existing build artifacts..."
fi

echo "📦 Copying built files..."
DEPLOY_DIR="/Users/stoked/work/stoked-projects/apps/code-ext/dist/api"

# Create deploy directory if it doesn't exist
mkdir -p "$DEPLOY_DIR"

# Copy dist files
rsync -av --delete dist/ "$DEPLOY_DIR/"

# Copy package.json and package-lock.json
cp package.json "$DEPLOY_DIR/"
cp package-lock.json "$DEPLOY_DIR/" 2>/dev/null || true

echo "📚 Installing production dependencies..."
cd "$DEPLOY_DIR"
npm install --production --ignore-scripts

echo "🔄 Restarting service..."
launchctl unload ~/Library/LaunchAgents/stoked-projects-api.plist 2>/dev/null || true
sleep 2
launchctl load ~/Library/LaunchAgents/stoked-projects-api.plist

echo "✅ Deployment complete!"
echo "📊 Checking service status..."
sleep 2
launchctl list | grep stoked-projects-api || echo "⚠️  Service not running"

echo ""
echo "🔍 Testing API..."
sleep 1
curl -s http://localhost:8167/health | jq || echo "⚠️  API not responding"
