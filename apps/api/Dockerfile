# ============================================================================
# CalmStacks EduConnect API - Production Multi-Stage Dockerfile
# ============================================================================

# Stage 1: Build & TypeScript Compilation
FROM node:22-alpine AS builder

WORKDIR /app

# Install native dependencies required by argon2 during build
RUN apk add --no-cache python3 make g++

# Copy workspace package manifests
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install full workspace dependencies for building
RUN npm install

# Copy source and migrations
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src
COPY apps/api/migrations ./apps/api/migrations

# Compile TypeScript
RUN npm run build --workspace apps/api

# Stage 2: Production Runtime
FROM node:22-alpine AS runner

WORKDIR /app

# Install native dependencies for argon2 runtime if needed
RUN apk add --no-cache python3 make g++ curl

ENV NODE_ENV=production
ENV API_PORT=4000

# Copy workspace manifests
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/

# Install only production dependencies
RUN npm install --omit=dev --workspace @educonnect/api

# Copy compiled code and migration scripts from builder
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/migrations ./apps/api/migrations
COPY apps/api/docker-entrypoint.sh ./apps/api/

RUN chmod +x ./apps/api/docker-entrypoint.sh

EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD curl -f http://localhost:4000/health || exit 1

ENTRYPOINT ["./apps/api/docker-entrypoint.sh"]
