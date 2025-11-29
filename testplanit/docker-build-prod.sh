#!/bin/bash
# Build script for production Docker image with resource limits

# Enable BuildKit for better build performance
export DOCKER_BUILDKIT=1

# Build with explicit memory limits
docker compose -f docker-compose.prod.yml build \
  --memory 20g \
  --memory-swap 24g \
  --cpus 2 \
  prod workers

echo "Build complete!"
