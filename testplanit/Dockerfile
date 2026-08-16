# syntax=docker.io/docker/dockerfile:1
#
# Built from the REPO ROOT context (see testplanit/docker-bake.hcl) so the build
# uses the single root pnpm-lock.yaml + pnpm-workspace.yaml. There is no
# duplicate lockfile under testplanit/. The pnpm workspace root lives at /app and
# the app at /app/testplanit; pnpm is provisioned by corepack from the pinned
# packageManager in the root package.json.

# ---- Base (workspace install + app build prep) ----
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat
# Build tools for native addons (bcrypt, etc.)
RUN apk add --no-cache --virtual .gyp python3 make g++
RUN apk add --no-cache postgresql-client curl
RUN corepack enable

# Workspace manifests + lockfile first, for better layer caching. Every member's
# package.json is needed so the frozen install can validate the shared lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY testplanit/package.json ./testplanit/
COPY docs/package.json ./docs/
COPY forge-app/package.json ./forge-app/
COPY cli/package.json ./cli/
COPY packages/api/package.json ./packages/api/
COPY packages/mcp-server/package.json ./packages/mcp-server/
COPY packages/wdio-testplanit-reporter/package.json ./packages/wdio-testplanit-reporter/

# Dependency patches referenced by pnpm-workspace.yaml#patchedDependencies; the
# frozen install reads these, so they must be present before it runs.
COPY patches ./patches/

# Install testplanit's dependencies (includes the @testplanit/api workspace pkg).
RUN pnpm install --frozen-lockfile --filter testplanit --ignore-scripts

# App source, plus the @testplanit/api workspace package it imports. Its built
# dist is committed (and un-ignored in .dockerignore); without it the workspace
# symlink resolves to an empty dir and `next build` cannot resolve @testplanit/api.
COPY testplanit/ ./testplanit/
COPY packages/api ./packages/api/

WORKDIR /app/testplanit
# Version info: use the pre-generated file if present, else derive it.
RUN if [ -f ".docker-version.json" ]; then \
        mkdir -p public && cp .docker-version.json ./public/version.json; \
    else \
        node scripts/generate-version.js || echo "Version generation skipped (git info not available)"; \
    fi

# 8192 is ample headroom: the ZenStack generate step peaks ~0.5 GB and the whole
# build tree peaks ~7 GB (next build self-caps at 4096 via the build script).
ENV NODE_OPTIONS="--max-old-space-size=8192"
# `-o zenstack` writes the v3 client to testplanit/zenstack (the `~/zenstack/*`
# import path), matching package.json's `generate` script. The flag is required:
# without it generate uses the default output dir and the build stage's
# `next build` cannot resolve `~/zenstack/models`. (Install runs with
# --ignore-scripts, so the postinstall generate never fires here.)
RUN pnpm zenstack generate --schema schema.zmodel -o zenstack
RUN apk del .gyp

COPY testplanit/wait-for-postgres.sh /usr/local/bin/wait-for-postgres.sh
RUN chmod +x /usr/local/bin/wait-for-postgres.sh

# ---- Development ----
FROM base AS development
ENV NODE_ENV=development
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- Production Dependencies (self-contained via pnpm deploy) ----
FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN apk add --no-cache --virtual .gyp python3 make g++
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY testplanit/package.json ./testplanit/
COPY docs/package.json ./docs/
COPY forge-app/package.json ./forge-app/
COPY cli/package.json ./cli/
COPY packages/api/package.json ./packages/api/
COPY packages/mcp-server/package.json ./packages/mcp-server/
COPY packages/wdio-testplanit-reporter/package.json ./packages/wdio-testplanit-reporter/
# Dependency patches referenced by pnpm-workspace.yaml#patchedDependencies; the
# frozen install reads these, so they must be present before it runs.
COPY patches ./patches/
RUN pnpm install --frozen-lockfile --filter testplanit --ignore-scripts
# Produce a self-contained production node_modules for testplanit (no symlinks
# pointing outside the deploy dir), suitable for copying into the final images.
COPY testplanit/ ./testplanit/
# @testplanit/api workspace dependency, so `pnpm deploy` bundles it into the
# self-contained production node_modules.
COPY packages/api ./packages/api/
RUN pnpm --filter=testplanit deploy --prod --legacy --ignore-scripts /app/deploy
# Rebuild native modules in the deployed tree.
RUN cd /app/deploy && npm rebuild bcrypt sharp 2>/dev/null || true
RUN apk del .gyp

# ---- Workers Dependencies (trimmed) ----
FROM deps AS deps-workers
# Remove packages not needed by workers (saves ~900MB). Workers only need:
# bullmq, prisma, elasticsearch, tiptap, happy-dom, nodemailer, bcrypt, aws-sdk, ioredis
RUN cd /app/deploy/node_modules/.pnpm && \
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
ARG BASE_DOMAIN
# SELF_HOSTED=true builds a domain-agnostic image (Next image optimizer off, no
# baked remotePatterns allowlist) so one published image runs on any host. The
# SaaS build leaves it unset and bakes BASE_DOMAIN instead. See next.config.ts.
ARG SELF_HOSTED
ENV SELF_HOSTED=${SELF_HOSTED}
ENV NODE_ENV=production
# next build self-caps at 4096 (build script); the whole build tree peaks ~7 GB,
# so 8192 leaves comfortable headroom.
ENV NODE_OPTIONS="--max-old-space-size=8192"
ENV VALKEY_URL=valkey://dummy:6379
ENV DATABASE_URL=postgresql://dummy:dummy@dummy:5432/dummy
ENV NEXTAUTH_SECRET=dummy-build-secret-min-32-characters-long
ENV NEXTAUTH_URL=http://localhost:3000
ENV SKIP_VALKEY_CONNECTION=true
ENV NEXT_TELEMETRY_DISABLED=1
ENV UV_THREADPOOL_SIZE=4
# Container layers start clean, so the Turbopack build cache is never restored.
ENV DOCKER_BUILD=true
ENV BASE_DOMAIN=${BASE_DOMAIN}
WORKDIR /app/testplanit
# The ZenStack v3 client is generated in the base stage (`pnpm zenstack
# generate`), which this stage inherits — there is no `prisma generate` anymore.
RUN npm run build

# ---- Production ----
FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN apk add --no-cache curl

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

RUN npm install -g pm2 && pm2 install pm2-logrotate && \
    pm2 set pm2-logrotate:max_size 50M && \
    pm2 set pm2-logrotate:retain 3 && \
    pm2 set pm2-logrotate:compress true && \
    pm2 set pm2-logrotate:workerInterval 60 && \
    pm2 set pm2-logrotate:rotateInterval '0 0 * * *'

# Next.js standalone output. With outputFileTracingRoot at the repo root, the
# standalone tree is rooted there, so server.js lands at ./testplanit/server.js.
COPY --from=build --chown=nextjs:nodejs /app/testplanit/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/testplanit/.next/static ./testplanit/.next/static
COPY --from=build /app/testplanit/public ./testplanit/public

# Worker files and runtime helpers.
COPY --from=build --chown=nextjs:nodejs /app/testplanit/workers ./testplanit/workers
COPY --from=build --chown=nextjs:nodejs /app/testplanit/scheduler.ts ./testplanit/scheduler.ts
COPY --from=build --chown=nextjs:nodejs /app/testplanit/ecosystem.config.js ./testplanit/ecosystem.config.js
COPY --from=build --chown=nextjs:nodejs /app/testplanit/lib ./testplanit/lib
COPY --from=build --chown=nextjs:nodejs /app/testplanit/db ./testplanit/db
# Self-contained production node_modules from the deploy stage.
COPY --from=deps --chown=nextjs:nodejs /app/deploy/node_modules ./testplanit/node_modules
# ZenStack v3 generated client + the schema it pushes from. tsx-run services
# (Elasticsearch reindex, audit triggers, seed) import from ~/zenstack at
# runtime, and `zenstack db push` reads schema.zmodel — both from source, so
# they must be present in the deployed tree. (v3 has no @zenstackhq/runtime
# .zenstack cache and no @prisma/client to copy.)
COPY --from=build --chown=nextjs:nodejs /app/testplanit/zenstack ./testplanit/zenstack
COPY --from=build --chown=nextjs:nodejs /app/testplanit/schema.zmodel ./testplanit/schema.zmodel
# Migration history — `zenstack migrate deploy` (docker-entrypoint.sh) applies it at startup.
COPY --from=build --chown=nextjs:nodejs /app/testplanit/migrations ./testplanit/migrations

COPY --from=build --chown=nextjs:nodejs /app/testplanit/services ./testplanit/services
COPY --from=build --chown=nextjs:nodejs /app/testplanit/utils ./testplanit/utils
COPY --from=build --chown=nextjs:nodejs /app/testplanit/types ./testplanit/types
COPY --from=build --chown=nextjs:nodejs /app/testplanit/scripts ./testplanit/scripts
COPY --from=build --chown=nextjs:nodejs /app/testplanit/docker-entrypoint.sh ./testplanit/docker-entrypoint.sh
RUN chmod +x ./testplanit/docker-entrypoint.sh

WORKDIR /app/testplanit
RUN npm install -g tsx
# ZenStack CLI for the db-init `zenstack db push` (the prod deploy tree is
# --prod, so the devDep CLI isn't present; install it globally). It pulls
# Prisma's schema engine internally to perform the push.
RUN npm install -g @zenstackhq/cli@3.8.0

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]

# ---- Workers ----
FROM node:24-alpine AS workers
ENV NODE_ENV=production
WORKDIR /app/testplanit
RUN apk add --no-cache postgresql-client
# System chromium for the URL-crawl screenshot capture. playwright-core
# drives it — no browser download. Capture is ON by default in this image;
# set CRAWL_SCREENSHOTS=false in the deployment env to disable.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV CRAWL_SCREENSHOTS=true
RUN npm install -g pm2 && pm2 install pm2-logrotate && \
    pm2 set pm2-logrotate:max_size 50M && \
    pm2 set pm2-logrotate:retain 3 && \
    pm2 set pm2-logrotate:compress true && \
    pm2 set pm2-logrotate:workerInterval 60 && \
    pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
RUN npm install -g tsx

COPY --from=build /app/testplanit/dist ./dist
COPY --from=build /app/testplanit/scheduler.ts ./scheduler.ts
COPY --from=build /app/testplanit/ecosystem.config.js ./ecosystem.config.js
COPY --from=build /app/testplanit/package.json ./package.json
COPY --from=deps-workers /app/deploy/node_modules ./node_modules

# ZenStack v3 generated client for the workers runtime (tsx-run workers import
# ~/zenstack from source). v3 has no @zenstackhq/runtime .zenstack cache and no
# @prisma/client to copy.
COPY --from=build /app/testplanit/zenstack ./zenstack

COPY --from=build /app/testplanit/lib ./lib
COPY --from=build /app/testplanit/workers ./workers
COPY --from=build /app/testplanit/db ./db
COPY --from=build /app/testplanit/services ./services
COPY --from=build /app/testplanit/utils ./utils
COPY --from=build /app/testplanit/types ./types
COPY --from=build /app/testplanit/env.js ./env.js
COPY --from=build /app/testplanit/tsconfig.json ./tsconfig.json
COPY --from=build /app/testplanit/messages ./messages
COPY --from=build /app/testplanit/messages ./dist/messages
COPY --from=build /app/testplanit/scripts ./scripts
COPY --from=base /usr/local/bin/wait-for-postgres.sh /usr/local/bin/wait-for-postgres.sh

RUN echo '#!/bin/sh' > /app/start-workers.sh && \
    echo 'echo "Starting workers..."' >> /app/start-workers.sh && \
    echo '/usr/local/bin/wait-for-postgres.sh postgres 5432' >> /app/start-workers.sh && \
    echo 'echo "Running scheduler to set up cron jobs..."' >> /app/start-workers.sh && \
    echo 'tsx scheduler.ts' >> /app/start-workers.sh && \
    echo 'echo "Starting workers with PM2..."' >> /app/start-workers.sh && \
    echo 'pm2-runtime start ecosystem.config.js' >> /app/start-workers.sh && \
    chmod +x /app/start-workers.sh

CMD ["/app/start-workers.sh"]
