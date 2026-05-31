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

# Install only the testplanit project's dependencies (it has no workspace deps).
RUN pnpm install --frozen-lockfile --filter testplanit --ignore-scripts

# App source.
COPY testplanit/ ./testplanit/

WORKDIR /app/testplanit
# Version info: use the pre-generated file if present, else derive it.
RUN if [ -f ".docker-version.json" ]; then \
        mkdir -p public && cp .docker-version.json ./public/version.json; \
    else \
        node scripts/generate-version.js || echo "Version generation skipped (git info not available)"; \
    fi

ENV NODE_OPTIONS="--max-old-space-size=16384"
RUN pnpm zenstack generate
RUN node scripts/fix-zenstack-symlink.js
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
RUN pnpm install --frozen-lockfile --filter testplanit --ignore-scripts
# Produce a self-contained production node_modules for testplanit (no symlinks
# pointing outside the deploy dir), suitable for copying into the final images.
COPY testplanit/ ./testplanit/
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
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=16384"
ENV VALKEY_URL=valkey://dummy:6379
ENV DATABASE_URL=postgresql://dummy:dummy@dummy:5432/dummy
ENV NEXTAUTH_SECRET=dummy-build-secret-min-32-characters-long
ENV NEXTAUTH_URL=http://localhost:3000
ENV SKIP_VALKEY_CONNECTION=true
ENV NEXT_TELEMETRY_DISABLED=1
ENV UV_THREADPOOL_SIZE=4
ENV BASE_DOMAIN=${BASE_DOMAIN}
WORKDIR /app/testplanit
RUN pnpm prisma generate
RUN node scripts/fix-zenstack-symlink.js
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
COPY --from=build --chown=nextjs:nodejs /app/testplanit/prisma ./testplanit/prisma
# Self-contained production node_modules from the deploy stage (overlays the
# standalone-traced node_modules with the full prod set: prisma client, etc.).
COPY --from=deps --chown=nextjs:nodejs /app/deploy/node_modules ./testplanit/node_modules
# ZenStack generated files (deploy ran with --ignore-scripts, so the deployed
# @zenstackhq/runtime has no .zenstack yet — create and populate it).
RUN --mount=from=base,source=/app/node_modules/.pnpm,target=/base-pnpm \
    zenstack_src=$(find /base-pnpm -type d -name ".zenstack" | head -1) && \
    runtime_pkg=$(find ./testplanit/node_modules/.pnpm -type d -path "*@zenstackhq+runtime*/node_modules/@zenstackhq/runtime" | head -1) && \
    if [ -n "$zenstack_src" ] && [ -n "$runtime_pkg" ]; then \
        zenstack_dest="$(dirname "$(dirname "$runtime_pkg")")/.zenstack" && \
        mkdir -p "$zenstack_dest" && \
        cp -r "$zenstack_src"/* "$zenstack_dest"/ && \
        chown -R nextjs:nodejs "$zenstack_dest" && \
        echo "Done copying zenstack files ($zenstack_dest)"; \
    else \
        echo "Warning: zenstack_src=$zenstack_src runtime_pkg=$runtime_pkg"; \
    fi

# Generated Prisma client into the deployed tree (deploy ran --ignore-scripts),
# so tsx-run services (e.g. Elasticsearch reindex) have a working client.
RUN --mount=from=build,source=/app/node_modules/.pnpm,target=/build-pnpm \
    prisma_src=$(find /build-pnpm -type d -name ".prisma" -path "*@prisma+client*" | head -1) && \
    dest_client=$(find ./testplanit/node_modules/.pnpm -type d -path "*@prisma+client*/node_modules/@prisma/client" | head -1) && \
    if [ -n "$prisma_src" ] && [ -n "$dest_client" ]; then \
        dest_dir="$(dirname "$(dirname "$dest_client")")/.prisma" && \
        mkdir -p "$dest_dir" && \
        cp -r "$prisma_src"/* "$dest_dir"/ && \
        chown -R nextjs:nodejs "$dest_dir" && \
        echo "Done copying Prisma client to production ($dest_dir)"; \
    else \
        echo "Warning: prisma_src=$prisma_src dest_client=$dest_client"; \
    fi

COPY --from=build --chown=nextjs:nodejs /app/testplanit/services ./testplanit/services
COPY --from=build --chown=nextjs:nodejs /app/testplanit/utils ./testplanit/utils
COPY --from=build --chown=nextjs:nodejs /app/testplanit/types ./testplanit/types
COPY --from=build --chown=nextjs:nodejs /app/testplanit/scripts ./testplanit/scripts
COPY --from=build --chown=nextjs:nodejs /app/testplanit/docker-entrypoint.sh ./testplanit/docker-entrypoint.sh
RUN chmod +x ./testplanit/docker-entrypoint.sh

WORKDIR /app/testplanit
RUN node scripts/fix-zenstack-symlink.js
RUN npm install -g tsx
RUN npm install -g prisma@6

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

# ZenStack generated files for the workers runtime.
RUN --mount=from=base,source=/app/node_modules/.pnpm,target=/base-pnpm \
    zenstack_src=$(find /base-pnpm -type d -name ".zenstack" | head -1) && \
    runtime_pkg=$(find ./node_modules/.pnpm -type d -path "*@zenstackhq+runtime*/node_modules/@zenstackhq/runtime" | head -1) && \
    if [ -n "$zenstack_src" ] && [ -n "$runtime_pkg" ]; then \
        zenstack_dest=$(dirname $(dirname "$runtime_pkg"))/.zenstack && \
        mkdir -p "$zenstack_dest" && \
        cp -r "$zenstack_src"/* "$zenstack_dest"/ && \
        echo "Done copying zenstack files to workers"; \
    else \
        echo "Warning: zenstack_src=$zenstack_src runtime_pkg=$runtime_pkg"; \
    fi

# Generated Prisma client from the build stage. In a pnpm workspace the virtual
# store lives at the workspace root (/app/node_modules/.pnpm); the --prod deploy
# tree may use a different peer-hash dir than the build tree, so locate the
# destination by the deployed @prisma/client rather than reusing the build path.
RUN --mount=from=build,source=/app/node_modules/.pnpm,target=/build-pnpm \
    prisma_src=$(find /build-pnpm -type d -name ".prisma" -path "*@prisma+client*" | head -1) && \
    dest_client=$(find ./node_modules/.pnpm -type d -path "*@prisma+client*/node_modules/@prisma/client" | head -1) && \
    if [ -n "$prisma_src" ] && [ -n "$dest_client" ]; then \
        dest_dir="$(dirname "$(dirname "$dest_client")")/.prisma" && \
        mkdir -p "$dest_dir" && \
        cp -r "$prisma_src"/* "$dest_dir"/ && \
        echo "Done copying Prisma client to workers ($dest_dir)"; \
    else \
        echo "ERROR: prisma_src=$prisma_src dest_client=$dest_client" && exit 1; \
    fi

COPY --from=build /app/testplanit/lib ./lib
COPY --from=build /app/testplanit/workers ./workers
COPY --from=build /app/testplanit/prisma ./prisma
COPY --from=build /app/testplanit/services ./services
COPY --from=build /app/testplanit/utils ./utils
COPY --from=build /app/testplanit/types ./types
COPY --from=build /app/testplanit/env.js ./env.js
COPY --from=build /app/testplanit/tsconfig.json ./tsconfig.json
COPY --from=build /app/testplanit/messages ./messages
COPY --from=build /app/testplanit/messages ./dist/messages
COPY --from=build /app/testplanit/scripts ./scripts
RUN node scripts/fix-zenstack-symlink.js
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
