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

# Copy the source code for the docs workspace
COPY ./docs/ ./docs/

# Install dependencies ONLY for the docs workspace using filter
# Ensure pnpm is available
RUN npm install -g pnpm
# Run install from the root (/app) filtering for the 'docs' workspace
# Replace 'docs' with your actual workspace name if different (check root package.json or pnpm-workspace.yaml)
RUN pnpm install --filter docs --frozen-lockfile --prod=false

# Change working directory to the docs workspace for the build step
WORKDIR /app/docs

# Build the Docusaurus site within the /app/docs directory
RUN pnpm build

# Stage 2: Serve the static files with Nginx
FROM nginx:stable-alpine

# Remove default Nginx website content
RUN rm -rf /usr/share/nginx/html/*

# Copy the built static files from the builder stage
# The build output is still in /app/docs/build
COPY --from=builder /app/docs/build /usr/share/nginx/html

# Expose port 80 for Nginx
EXPOSE 80

# Default command to start Nginx (provided by the base image)
# CMD ["nginx", "-g", "daemon off;"]