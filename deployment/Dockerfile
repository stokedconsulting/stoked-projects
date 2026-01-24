# Multi-stage build for Claude Projects MCP Server
# Stage 1: Builder
FROM node:18-alpine AS builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY packages/mcp-server/package.json packages/mcp-server/pnpm-lock.yaml* ./

# Install dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copy source code
COPY packages/mcp-server/src ./src
COPY packages/mcp-server/tsconfig.json ./

# Build TypeScript
RUN pnpm build

# Stage 2: Runtime
FROM node:18-alpine

WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache dumb-init

# Create non-root user for security
RUN addgroup -g 1000 mcp && adduser -D -u 1000 -G mcp mcp

# Copy package files from builder
COPY packages/mcp-server/package.json packages/mcp-server/pnpm-lock.yaml* ./

# Install production dependencies only
RUN npm install -g pnpm && pnpm install --frozen-lockfile --prod && pnpm prune --prod

# Copy built application from builder
COPY --from=builder /build/dist ./dist

# Copy .env.example for reference
COPY packages/mcp-server/.env.example ./

# Create necessary directories
RUN mkdir -p /app/logs && chown -R mcp:mcp /app

# Switch to non-root user
USER mcp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD node dist/tools/health-check.js || exit 1

# Graceful shutdown signal handler
STOPSIGNAL SIGTERM

# Set entrypoint using dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the server
CMD ["node", "dist/index.js"]

# Expose WebSocket port
EXPOSE 8080

# Labels for metadata
LABEL maintainer="Claude Projects Team"
LABEL description="MCP Server for Claude Projects integration"
LABEL version="0.1.0"
