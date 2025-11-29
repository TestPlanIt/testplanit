#!/bin/bash
# Deployment script for Forge app
# Loads environment variables and deploys

set -e  # Exit on error

echo "Loading Forge credentials..."
source .env.forge

echo "Building webpack bundles..."
pnpm run build

echo "Deploying to Forge..."
pnpm exec forge deploy

echo "✅ Deployment complete!"
