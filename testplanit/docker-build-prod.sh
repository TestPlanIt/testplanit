#!/bin/bash
# Build script for production Docker image with resource limits

# Enable BuildKit for better build performance
export DOCKER_BUILDKIT=1

# Build with explicit memory limits
docker compose -f docker-compose.prod.yml build \
  --memory 10g \
  prod workers db-init-prod

echo "Build complete!"
