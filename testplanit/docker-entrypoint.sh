#!/bin/sh
set -e

echo "Running database migrations..."
prisma db push --skip-generate

echo "Starting application..."
exec "$@"
