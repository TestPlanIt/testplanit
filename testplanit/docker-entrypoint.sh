#!/bin/sh
set -e

echo "Running database migrations..."
prisma db push --skip-generate --accept-data-loss

echo "Setting up PostgreSQL extensions..."
npx tsx prisma/setup-extensions.ts

echo "Starting application..."
exec "$@"
