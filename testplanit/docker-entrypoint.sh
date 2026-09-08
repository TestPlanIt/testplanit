#!/bin/sh
set -e

# Schema sync + extension setup run on the direct (non-pooled) connection;
# falls back to DATABASE_URL when DIRECT_DATABASE_URL is unset (no pooler).
INIT_DATABASE_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}"

# Boot must not depend on internet egress. zenstack and tsx are installed
# globally in the image and are called directly: going through npx makes the
# first run in every new container ask the npm registry for a newer version
# and wait out that request when the pod cannot reach it. CHECKPOINT_DISABLE
# turns off Prisma's telemetry beacon for the same reason.
#
# DEBUG=prisma:engines is a workaround, not diagnostics. On arm64 pods the
# first deploy against an empty database has been seen to stop before the
# schema engine starts, with no error and no timeout, and enabling this debug
# namespace is the only known way to get it moving. It prints one or two
# extra lines at boot.
echo "Running database migrations..."
# migrate deploy applies pending migrations only; it never drops data (unlike
# `db push --accept-data-loss`). Existing databases first built with db push must
# have the baseline marked applied once — see testplanit/migrations/README.md.
DATABASE_URL="$INIT_DATABASE_URL" CHECKPOINT_DISABLE=1 DEBUG=prisma:engines \
  zenstack migrate deploy --schema schema.zmodel --no-version-check

echo "Applying audit triggers..."
DATABASE_URL="$INIT_DATABASE_URL" tsx scripts/apply-triggers.ts

echo "Setting up PostgreSQL extensions..."
DATABASE_URL="$INIT_DATABASE_URL" tsx db/setup-extensions.ts

echo "Starting application..."
exec "$@"
