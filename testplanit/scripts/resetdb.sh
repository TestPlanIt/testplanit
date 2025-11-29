#!/usr/bin/env bash
# resetdb.sh — restore PostgreSQL DB from a backup using .env DATABASE_URL
# Usage: ./resetdb.sh /path/to/backup.(dump|backup|sql) [path/to/.env]
#
# Optional env:
#   JOBS=4                  # parallel workers for pg_restore (custom dumps)
#   RESTORE_NO_OWN_PRIV=1   # add --no-owner --no-privileges
#   QUIET=1                 # less output
#
# Example:
#   JOBS=4 RESTORE_NO_OWN_PRIV=1 ./resetdb.sh "~/Desktop/Testmo Exports/4.dump" .env

set -euo pipefail

backup="${1:-}"
envfile=".env"

if [[ -z "$backup" || ! -f "$backup" ]]; then
  echo "❌ Backup file missing or not found."
  echo "Usage: $0 /path/to/backup.(dump|backup|sql) [path/to/.env]"
  exit 1
fi
if [[ ! -f "$envfile" ]]; then
  echo "❌ .env file not found at '$envfile'"
  exit 1
fi

# Extract DATABASE_URL (handles quoted/unquoted)
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$envfile" | head -n1 | sed -E 's/^DATABASE_URL=//')"
DATABASE_URL="${DATABASE_URL%\"}"; DATABASE_URL="${DATABASE_URL#\"}"
DATABASE_URL="${DATABASE_URL%\'}"; DATABASE_URL="${DATABASE_URL#\'}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "❌ DATABASE_URL not found in $envfile"
  exit 1
fi

# Parse: postgresql://user:pass@host:port/dbname?...
re='^postgresql://([^:/@]+):([^@]+)@([^:/?]+)(:([0-9]+))?/([^?]+)'
if [[ "$DATABASE_URL" =~ $re ]]; then
  export PGUSER="${BASH_REMATCH[1]}"
  export PGPASSWORD="${BASH_REMATCH[2]}"
  export PGHOST="${BASH_REMATCH[3]}"
  export PGPORT="${BASH_REMATCH[5]:-5432}"
  export PGDATABASE="${BASH_REMATCH[6]}"
else
  echo "❌ Could not parse DATABASE_URL: $DATABASE_URL"
  exit 1
fi

db="$PGDATABASE"
ext="$(echo "${backup##*.}" | tr '[:upper:]' '[:lower:]')"

# Optional flags as strings (avoid array expansion issues on macOS bash)
jobs_arg=""
[[ -n "${JOBS:-}" ]] && jobs_arg="--jobs $JOBS"

noown=""
[[ -n "${RESTORE_NO_OWN_PRIV:-}" ]] && noown="--no-owner --no-privileges"

quiet() { [[ -n "${QUIET:-}" ]] || echo "$@"; }

# Sanity checks for required CLIs
command -v psql >/dev/null 2>&1 || { echo "❌ psql not found in PATH"; exit 1; }
command -v pg_restore >/dev/null 2>&1 || { [[ "$ext" == "sql" ]] || { echo "❌ pg_restore not found in PATH"; exit 1; }; }

quiet "🔗 Host: $PGHOST  Port: $PGPORT  DB: $db  User: $PGUSER"
quiet "🗂  Backup: $backup"

drop_db_force() {
  # Try PG 13+ FORCE drop; if not supported, terminate connections then drop.
  if ! psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres \
        -v ON_ERROR_STOP=1 \
        -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);" >/dev/null 2>&1; then
    quiet "↪️  FORCE not supported or failed; terminating connections…"
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid();"
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c \
      "DROP DATABASE IF EXISTS \"$db\";"
  fi
}

case "$ext" in
  dump|backup)
    quiet "🧹 Dropping DB…"
    drop_db_force
    quiet "🆕 Creating DB…"
    createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$db"
    quiet "📥 Restoring custom dump…"
    # shellcheck disable=SC2086  # allow word splitting for $noown and $jobs_arg
    pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
      -d "$db" --exit-on-error $noown $jobs_arg \
      "$backup"
    ;;

  sql)
    quiet "🧹 Dropping DB…"
    drop_db_force
    quiet "🆕 Creating DB…"
    createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$db"
    quiet "📥 Restoring SQL… (this may take a while)"
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -f "$backup"
    ;;

  *)
    echo "❌ Unknown backup extension '.$ext'. Use .dump/.backup or .sql"
    exit 1
    ;;
esac

quiet "✅ Restore complete: $db ← $backup"

