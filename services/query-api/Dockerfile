# Stage 1: Builder
FROM node:20-bookworm-slim as builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY services/query-api/package*.json ./
COPY services/query-api/tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY services/query-api/src ./src
COPY services/query-api/prisma ./prisma
COPY services/query-api/scripts/copy-static-assets.mjs ./scripts/copy-static-assets.mjs

# Generate Prisma Client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Stage 2: Migration runner
FROM builder as migrate

CMD ["npx", "prisma", "migrate", "deploy"]

# Stage 3: Runtime
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install production dependencies only
COPY services/query-api/package*.json ./
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY services/query-api/prisma ./prisma
COPY services/query-api/prompts ./prompts
COPY extensions/contribution-engine/extension.manifest.json ./extensions/contribution-engine/extension.manifest.json

# Run as non-root user
RUN chown -R node:node /app
USER node

EXPOSE 4000

CMD ["node", "dist/index.js"]
