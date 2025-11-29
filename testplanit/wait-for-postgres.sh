#!/bin/sh
# wait-for-postgres.sh

set -e

host="$1"
port="$2"
shift 2
cmd="$@"

# Extract user and db from DATABASE_URL for pg_isready
# Assumes URL format: postgresql://user:password@host:port/db?params
DB_USER=$(echo $DATABASE_URL | sed -n 's|postgresql://\([^:]*\):.*|\1|p')
DB_NAME=$(echo $DATABASE_URL | sed -n 's|.*@.*:[0-9]*/\([^?]*\)?.*|\1|p')

# Check if user and dbname were extracted
if [ -z "$DB_USER" ]; then
  echo "Could not parse user from DATABASE_URL. Exiting."
  exit 1
fi
if [ -z "$DB_NAME" ]; then
  echo "Could not parse database name from DATABASE_URL. Exiting."
  exit 1
fi

echo "Waiting for database user '$DB_USER' on database '$DB_NAME' at $host:$port..."

# Loop until pg_isready confirms the connection is ready
until pg_isready -h "$host" -p "$port" -U "$DB_USER" -d "$DB_NAME" -q; do
  >&2 echo "Postgres is unavailable - sleeping"
  sleep 1
done

>&2 echo "Postgres is up - executing command"
exec "$@"