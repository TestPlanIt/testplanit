# Stage 1: Build the Docusaurus site
FROM node:24-alpine AS builder

# Set base working directory
WORKDIR /app

# Copy the root lock file first
COPY pnpm-lock.yaml ./

# Copy the package.json for the docs workspace to define the workspace
COPY docs/package.json ./docs/

# --- Add root package.json and workspace definition if needed ---
# If your pnpm workspaces are defined in the root package.json or pnpm-workspace.yaml, copy them too
COPY package.json ./
COPY pnpm-workspace.yaml ./

# Dependency patches referenced by pnpm-workspace.yaml#patchedDependencies; the
# frozen install reads these, so they must be present before it runs.
COPY patches ./patches/

# Copy the source code for the docs workspace
COPY ./docs/ ./docs/

# Install dependencies ONLY for the docs workspace using filter
# Ensure pnpm is available
RUN npm install -g pnpm@10
# Run install from the root (/app) filtering for the 'docs' workspace
# Replace 'docs' with your actual workspace name if different (check root package.json or pnpm-workspace.yaml)
RUN pnpm install --filter docs --frozen-lockfile --prod=false

# Change working directory to the docs workspace for the build step
WORKDIR /app/docs

# Which release line this site documents and where it is served from.
# docs-release.yml derives these from the branch or tag being built.
ARG DOCS_APP_VERSION
ARG DOCS_URL=https://docs.testplanit.com
ARG DOCS_ALGOLIA_INDEX=testplanit
ARG DOCS_VERSIONS_JSON=""
ENV DOCS_APP_VERSION=${DOCS_APP_VERSION} \
    DOCS_URL=${DOCS_URL} \
    DOCS_ALGOLIA_INDEX=${DOCS_ALGOLIA_INDEX} \
    DOCS_VERSIONS_JSON=${DOCS_VERSIONS_JSON}
RUN test -n "$DOCS_APP_VERSION" || { echo "DOCS_APP_VERSION build arg is required" >&2; exit 1; }

# Build the Docusaurus site within the /app/docs directory
RUN pnpm build

# Stage 2: Serve the static files with Nginx
FROM nginx:stable-alpine

# Remove default Nginx website content
RUN rm -rf /usr/share/nginx/html/*

# Serve the site's own 404 page and expose versions.json cross-origin
COPY docs/nginx/default.conf /etc/nginx/conf.d/default.conf

# Copy the built static files from the builder stage
# The build output is still in /app/docs/build
COPY --from=builder /app/docs/build /usr/share/nginx/html

# Expose port 80 for Nginx
EXPOSE 80

# Default command to start Nginx (provided by the base image)
# CMD ["nginx", "-g", "daemon off;"]