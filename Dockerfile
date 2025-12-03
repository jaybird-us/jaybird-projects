# jayBird Projects GitHub App
# Multi-stage build for minimal image size

# Stage 1: Build the React client
FROM node:20-alpine AS client-builder

WORKDIR /app/client

# Copy client package files
COPY client/package*.json ./

# Install client dependencies
RUN npm install

# Copy client source
COPY client/ ./

# Build client
RUN npm run build

# Stage 2: Build server dependencies
FROM node:20-alpine AS server-builder

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only (skip postinstall since client is built separately)
# Then rebuild native modules
RUN npm install --omit=dev --ignore-scripts && npm rebuild better-sqlite3

# Stage 3: Production image
FROM node:20-alpine

WORKDIR /app

# Copy node_modules from server builder
COPY --from=server-builder /app/node_modules ./node_modules

# Copy built client from client builder
COPY --from=client-builder /app/client/dist ./public

# Copy application code (server)
COPY src/ ./src/
COPY package*.json ./
COPY docker-entrypoint.sh ./

# Create data directory for SQLite
# Note: Running as root for Railway volume mount compatibility
RUN mkdir -p /app/data

# Set up entrypoint script
RUN chmod +x /app/docker-entrypoint.sh

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start server via entrypoint
ENTRYPOINT ["/app/docker-entrypoint.sh"]
