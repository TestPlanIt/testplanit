# syntax=docker.io/docker/dockerfile:1

# ---- Base ----
FROM node:24-alpine AS base
WORKDIR /app
# Copy package manager files first
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* .npmrc* ./
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
# Add build tools needed for native addons like bcrypt
RUN apk add --no-cache --virtual .gyp python3 make g++
# Add postgresql client for pg_isready used in wait script
RUN apk add --no-cache postgresql-client
# Add curl for health checks
RUN apk add --no-cache curl
# Install pnpm globally
RUN npm install -g pnpm@latest
# Copy package files first for better caching
# COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* .npmrc* ./
# Install dependencies first
RUN \
    if [ -f yarn.lock ]; then yarn install --frozen-lockfile --ignore-scripts; \
    elif [ -f package-lock.json ]; then npm ci --ignore-scripts; \
    elif [ -f pnpm-lock.yaml ]; then pnpm i --ignore-scripts; \
    else echo "Lockfile not found." && exit 1; \
    fi

# Copy all source code after dependencies are installed
COPY . .

# Check if pre-generated version file exists (created by docker-build.sh)
# If it exists, use it; otherwise generate version info during build
RUN if [ -f ".docker-version.json" ]; then \
        echo "Using pre-generated version information" && \
        mkdir -p public && \
        cp .docker-version.json ./public/version.json; \
    else \
        echo "Generating version information during build..." && \
        node scripts/generate-version.js || echo "Version generation skipped (git info not available)"; \
    fi

# Increase memory limit for build process
ENV NODE_OPTIONS="--max-old-space-size=8192"
# Generate ZenStack files with high memory allocation
RUN NODE_OPTIONS="--max-old-space-size=8192" pnpm zenstack generate
# Fix ZenStack symlinks
RUN node scripts/fix-zenstack-symlink.js
# Clean up build dependencies (optional, saves space)
RUN apk del .gyp

# Copy wait script
COPY wait-for-postgres.sh /usr/local/bin/wait-for-postgres.sh
RUN chmod +x /usr/local/bin/wait-for-postgres.sh

# ---- Development ----
FROM base AS development
ENV NODE_ENV=development
# Source code and node_modules are already copied from base
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- Production Dependencies ----
# This stage installs only production dependencies for a smaller final image
FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
# Add build tools for native addons like bcrypt
RUN apk add --no-cache --virtual .gyp python3 make g++
RUN npm install -g pnpm@latest
COPY package.json pnpm-lock.yaml* .npmrc* ./
# Install only production dependencies
# --ignore-scripts skips postinstall (which needs zenstack, a dev dep)
RUN pnpm install --prod --ignore-scripts
# Rebuild native modules (bcrypt, sharp, etc.) using npm rebuild
# This avoids pnpm's lifecycle scripts that require dev dependencies
RUN npm rebuild bcrypt sharp 2>/dev/null || true
# Clean up build tools
RUN apk del .gyp

# ---- Workers Dependencies ----
# Separate stage for workers with unnecessary packages removed
FROM deps AS deps-workers
# Remove packages not needed by workers (saves ~900MB)
# Workers only need: bullmq, prisma, elasticsearch, tiptap, happy-dom, nodemailer, bcrypt, aws-sdk, ioredis
RUN cd node_modules/.pnpm && \
    rm -rf next@* @next+swc* @swc+core* \
           react-dom@* \
           emojibase-data@* \
           pdfjs-dist@* \
           simple-icons@* \
           lucide-react@* \
           @atlaskit+* \
           @radix-ui+* \
           @reduxjs+* \
           redux@* \
           framer-motion@* motion@* \
           @tanstack+react-table* @tanstack+react-virtual* @tanstack+react-form* \
           @dnd-kit+* \
           cmdk@* \
           embla-carousel* \
           recharts@* \
           playwright* @playwright+* \
           faker@* \
           openai@* \
           ai@* \
           effect@* \
           d3@* d3-* @observablehq+* \
           2>/dev/null || true

# ---- Build ----
FROM base AS build

# Build arguments for image optimization domains
ARG BASE_DOMAIN

ENV NODE_ENV=production
# Increase memory limit for build process to 16GB (machine has 32GB)
ENV NODE_OPTIONS="--max-old-space-size=16384"
# Set dummy environment variables for build validation
# These are not used at runtime - actual values come from docker-compose environment
ENV VALKEY_URL=valkey://dummy:6379
ENV DATABASE_URL=postgresql://dummy:dummy@dummy:5432/dummy
ENV NEXTAUTH_SECRET=dummy-build-secret-min-32-characters-long
ENV NEXTAUTH_URL=http://localhost:3000
# Skip connections during build
ENV SKIP_VALKEY_CONNECTION=true
# Disable Next.js telemetry to save resources
ENV NEXT_TELEMETRY_DISABLED=1
# Limit UV_THREADPOOL_SIZE to reduce concurrent operations
ENV UV_THREADPOOL_SIZE=4
# Set base domain for wildcard image optimization patterns in next.config.mjs
# This allows *.testplanit.com to work with image optimization
ENV BASE_DOMAIN=${BASE_DOMAIN}
WORKDIR /app
# Source code and node_modules are already copied from base
# Generate Prisma client for build (use pnpm to ensure correct version from package.json)
RUN pnpm prisma generate
# Ensure .zenstack directory exists and is properly linked
RUN node scripts/fix-zenstack-symlink.js
# Build with reduced parallelism and optimizations
# Note: npm run build already includes version generation, but we've done it earlier
RUN npm run build

# ---- Production ----
FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
# Set Node.js heap size to 4GB for production
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Add curl for healthchecks
RUN apk add --no-cache curl

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Install PM2 globally
RUN npm install -g pm2

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# Explicitly copy static assets to the location expected by the server relative to the final WORKDIR
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./app/.next/static
# Copy public folder to ./app/public (same level as server.js after WORKDIR change)
# This ensures static files like tpi_logo_square.png are accessible
COPY --from=build /app/public ./app/public

# Copy worker files and ecosystem config
COPY --from=build --chown=nextjs:nodejs /app/workers ./app/workers
COPY --from=build --chown=nextjs:nodejs /app/scheduler.ts ./app/scheduler.ts
COPY --from=build --chown=nextjs:nodejs /app/ecosystem.config.js ./app/ecosystem.config.js
COPY --from=build --chown=nextjs:nodejs /app/lib ./app/lib
COPY --from=build --chown=nextjs:nodejs /app/prisma ./app/prisma
# Copy only production dependencies (from deps stage, not build stage)
# This excludes dev dependencies like typescript, prisma CLI, playwright, etc.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./app/node_modules
# Copy ZenStack generated files from base stage (deps stage doesn't run zenstack generate)
# These are needed for the enhance function and model metadata at runtime
# In Docker, pnpm puts the .zenstack dir inside the @zenstackhq+runtime package in .pnpm virtual store
# The symlink @zenstackhq/runtime/.zenstack points to ../../.zenstack (relative to runtime)
# So we need to copy zenstack files to node_modules/.pnpm/@zenstackhq+runtime@*/node_modules/.zenstack
RUN --mount=from=base,source=/app/node_modules/.pnpm,target=/base-pnpm \
    zenstack_src=$(find /base-pnpm -type d -name ".zenstack" | head -1) && \
    zenstack_dest=$(find ./app/node_modules/.pnpm -type d -path "*@zenstackhq+runtime*/node_modules/.zenstack" | head -1) && \
    if [ -n "$zenstack_src" ] && [ -n "$zenstack_dest" ]; then \
        echo "Copying zenstack files from $zenstack_src to $zenstack_dest" && \
        cp -r "$zenstack_src"/* "$zenstack_dest"/ && \
        chown -R nextjs:nodejs "$zenstack_dest" && \
        echo "Done copying zenstack files"; \
    else \
        echo "Warning: zenstack_src=$zenstack_src zenstack_dest=$zenstack_dest"; \
    fi
# Note: Prisma client is included in the standalone build's node_modules
# The standalone build at /app/.next/standalone already includes @prisma/client

# Copy services for Elasticsearch reindexing capability
COPY --from=build --chown=nextjs:nodejs /app/services ./app/services
COPY --from=build --chown=nextjs:nodejs /app/utils ./app/utils
COPY --from=build --chown=nextjs:nodejs /app/types ./app/types

# Copy scripts (needed before changing WORKDIR)
COPY --from=build --chown=nextjs:nodejs /app/scripts ./app/scripts

# Copy entrypoint script for database migrations on startup
COPY --from=build --chown=nextjs:nodejs /app/docker-entrypoint.sh ./app/docker-entrypoint.sh
RUN chmod +x ./app/docker-entrypoint.sh

# Set the working directory to where server.js and dependencies are located
WORKDIR /app/app

# Fix ZenStack symlinks
RUN node scripts/fix-zenstack-symlink.js

# Note: Prisma client is included in the standalone build
# Generated during build stage (line 75) and included by Next.js output tracing

# Install tsx for running TypeScript scripts in production
RUN npm install -g tsx

# Install prisma CLI for database migrations (locked to 6.x to match package.json)
RUN npm install -g prisma@6

USER nextjs

EXPOSE 3000
ENV PORT=3000
# server.js is created by next build with output: "standalone"
# Use entrypoint to run database migrations before starting the server
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]

# ---- Workers ----
FROM node:24-alpine AS workers
ENV NODE_ENV=production
WORKDIR /app

# Add postgresql client for pg_isready used in wait script
RUN apk add --no-cache postgresql-client

# Install PM2 globally
RUN npm install -g pm2

# Install tsx for TypeScript execution
RUN npm install -g tsx

# Copy only the compiled workers and necessary dependencies from build stage
# Copy compiled workers
COPY --from=build /app/dist ./dist

# Copy necessary runtime files
COPY --from=build /app/scheduler.ts ./scheduler.ts
COPY --from=build /app/ecosystem.config.js ./ecosystem.config.js
COPY --from=build /app/package.json ./package.json

# Copy only production dependencies (from deps-workers stage, with UI packages removed)
COPY --from=deps-workers /app/node_modules ./node_modules

# Copy ZenStack generated files from base stage (deps-workers doesn't run zenstack generate)
# These are needed for the enhance function and model metadata at runtime
# The zenstack runtime expects .zenstack to be at ../../.zenstack relative to @zenstackhq/runtime
# i.e., at node_modules/.pnpm/@zenstackhq+runtime@*/node_modules/.zenstack
RUN --mount=from=base,source=/app/node_modules/.pnpm,target=/base-pnpm \
    zenstack_src=$(find /base-pnpm -type d -name ".zenstack" | head -1) && \
    runtime_pkg=$(find ./node_modules/.pnpm -type d -path "*@zenstackhq+runtime*/node_modules/@zenstackhq/runtime" | head -1) && \
    if [ -n "$zenstack_src" ] && [ -n "$runtime_pkg" ]; then \
        zenstack_dest=$(dirname $(dirname "$runtime_pkg"))/.zenstack && \
        mkdir -p "$zenstack_dest" && \
        echo "Copying zenstack files from $zenstack_src to $zenstack_dest" && \
        cp -r "$zenstack_src"/* "$zenstack_dest"/ && \
        echo "Done copying zenstack files to workers"; \
    else \
        echo "Warning: zenstack_src=$zenstack_src runtime_pkg=$runtime_pkg"; \
    fi

# Copy generated Prisma client from build stage (deps stage doesn't run prisma generate)
# The .prisma directory contains the generated client code
# Use dynamic path discovery since version numbers change with dependency updates
RUN --mount=from=build,source=/app/node_modules/.pnpm,target=/build-pnpm \
    prisma_src=$(find /build-pnpm -type d -name ".prisma" -path "*@prisma+client*" | head -1) && \
    if [ -n "$prisma_src" ]; then \
        # Extract the relative path from the pnpm directory
        rel_path=${prisma_src#/build-pnpm/} && \
        dest_dir="./node_modules/.pnpm/${rel_path}" && \
        mkdir -p "$dest_dir" && \
        echo "Copying Prisma client from $prisma_src to $dest_dir" && \
        cp -r "$prisma_src"/* "$dest_dir"/ && \
        echo "Done copying Prisma client to workers"; \
    else \
        echo "ERROR: Could not find .prisma directory in build stage" && exit 1; \
    fi

# Copy lib directory (needed for workers runtime)
COPY --from=build /app/lib ./lib

# Copy workers source files (needed by scheduler.ts for job name constants)
COPY --from=build /app/workers ./workers

# Copy prisma schema (needed for Prisma client)
COPY --from=build /app/prisma ./prisma

# Copy services, utils, types (needed for workers)
COPY --from=build /app/services ./services
COPY --from=build /app/utils ./utils
COPY --from=build /app/types ./types

# Copy env.js (needed by services/elasticsearchService.ts)
COPY --from=build /app/env.js ./env.js

# Copy tsconfig.json (needed by tsx for path alias resolution like ~/types/search)
COPY --from=build /app/tsconfig.json ./tsconfig.json

# Copy translation files for email worker
# Copy to both /app/messages (for reference) and /app/dist/messages (where server-translations.ts looks)
COPY --from=build /app/messages ./messages
COPY --from=build /app/messages ./dist/messages

# Copy scripts (needed for fix-zenstack-symlink.js)
COPY --from=build /app/scripts ./scripts

# Fix ZenStack symlinks (creates symlink from @zenstackhq/runtime/.zenstack -> ../../.zenstack)
RUN node scripts/fix-zenstack-symlink.js

# Copy wait script
COPY --from=base /usr/local/bin/wait-for-postgres.sh /usr/local/bin/wait-for-postgres.sh

# Create startup script
RUN echo '#!/bin/sh' > /app/start-workers.sh && \
    echo 'echo "Starting workers..."' >> /app/start-workers.sh && \
    echo '/usr/local/bin/wait-for-postgres.sh postgres 5432' >> /app/start-workers.sh && \
    echo 'echo "Running scheduler to set up cron jobs..."' >> /app/start-workers.sh && \
    echo 'tsx scheduler.ts' >> /app/start-workers.sh && \
    echo 'echo "Starting workers with PM2..."' >> /app/start-workers.sh && \
    echo 'pm2-runtime start ecosystem.config.js' >> /app/start-workers.sh && \
    chmod +x /app/start-workers.sh

CMD ["/app/start-workers.sh"]
