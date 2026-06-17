#!/bin/sh
set -e

# Schema sync + extension setup run on the direct (non-pooled) connection;
# falls back to DATABASE_URL when DIRECT_DATABASE_URL is unset (no pooler).
INIT_DATABASE_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}"

echo "Running database migrations..."
DATABASE_URL="$INIT_DATABASE_URL" prisma db push --skip-generate --accept-data-loss

echo "Applying audit triggers..."
DATABASE_URL="$INIT_DATABASE_URL" npx tsx scripts/apply-triggers.ts

echo "Setting up PostgreSQL extensions..."
DATABASE_URL="$INIT_DATABASE_URL" npx tsx prisma/setup-extensions.ts

echo "Starting application..."
exec "$@"
