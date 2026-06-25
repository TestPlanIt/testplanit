#!/bin/sh
set -e

# Schema sync + extension setup run on the direct (non-pooled) connection;
# falls back to DATABASE_URL when DIRECT_DATABASE_URL is unset (no pooler).
INIT_DATABASE_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}"

echo "Running database migrations..."
# migrate deploy applies pending migrations only; it never drops data (unlike
# `db push --accept-data-loss`). Existing databases first built with db push must
# have the baseline marked applied once — see testplanit/migrations/README.md.
DATABASE_URL="$INIT_DATABASE_URL" npx zenstack migrate deploy --schema schema.zmodel --no-version-check

echo "Applying audit triggers..."
DATABASE_URL="$INIT_DATABASE_URL" npx tsx scripts/apply-triggers.ts

echo "Setting up PostgreSQL extensions..."
DATABASE_URL="$INIT_DATABASE_URL" npx tsx db/setup-extensions.ts

echo "Starting application..."
exec "$@"
