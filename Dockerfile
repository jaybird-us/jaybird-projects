# jayBird Projects GitHub App
# Multi-stage build for minimal image size

FROM node:20-alpine AS builder

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only (skip postinstall since client folder isn't available)
# Then rebuild native modules
RUN npm install --omit=dev --ignore-scripts && npm rebuild better-sqlite3

# Production image
FROM node:20-alpine

WORKDIR /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY . .

# Create data directory for SQLite
# Note: Running as root for Railway volume mount compatibility
RUN mkdir -p /app/data

# Copy and set up entrypoint script
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start server via entrypoint
ENTRYPOINT ["/app/docker-entrypoint.sh"]
