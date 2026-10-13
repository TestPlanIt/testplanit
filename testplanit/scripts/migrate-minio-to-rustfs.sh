#!/usr/bin/env bash
# Copies TestPlanIt's files from the old MinIO storage (./docker-data/minio)
# into the RustFS storage that replaced it, then verifies the copy.
#
# Run from anywhere; it works in the testplanit directory. TestPlanIt is
# stopped during the copy so no files change, and ./docker-data/minio is only
# read, never modified. Guide: https://docs.testplanit.com/docs/migrating-from-minio
set -euo pipefail

cd "$(dirname "$0")/.."

# Defaults match docker-compose.prod.yml. For docker-compose.yml, run with
# STORAGE_COMPOSE_FILE=docker-compose.yml STORAGE_PROFILE=prod.
COMPOSE_FILE_NAME="${STORAGE_COMPOSE_FILE:-docker-compose.prod.yml}"
STORAGE_PROFILE="${STORAGE_PROFILE:-with-minio}"

compose() {
  docker compose -f "$COMPOSE_FILE_NAME" -f docker-compose.minio-migration.yml \
    --profile "$STORAGE_PROFILE" --profile minio-migration "$@"
}

if [ -z "$(ls -A docker-data/minio 2>/dev/null)" ]; then
  echo "./docker-data/minio is missing or empty, so there is nothing to migrate."
  exit 0
fi

if ! docker image inspect minio/minio:latest >/dev/null 2>&1; then
  cat <<'MESSAGE'
The minio/minio image is not on this machine, and MinIO no longer publishes it,
so the old storage cannot be started to copy from.

Follow "Migrating without the MinIO image" in the guide instead:
https://docs.testplanit.com/docs/migrating-from-minio
MESSAGE
  exit 1
fi

echo "Stopping TestPlanIt so no files change during the copy..."
compose stop prod workers >/dev/null 2>&1 || true

echo "Copying files from MinIO to RustFS (this can take a while)..."
if ! compose run --rm minio-migrate; then
  compose rm --stop --force legacy-minio >/dev/null 2>&1 || true
  echo
  echo "The copy did not complete. Nothing was deleted; ./docker-data/minio is"
  echo "unchanged. Fix the error above and run this script again."
  exit 1
fi

compose rm --stop --force legacy-minio >/dev/null 2>&1 || true

cat <<MESSAGE

Migration complete. Every file was copied and verified.

Start TestPlanIt again with the command you normally use, for example:

  docker compose -f $COMPOSE_FILE_NAME --profile $STORAGE_PROFILE up -d

Keep ./docker-data/minio as a backup until you have checked your files in
TestPlanIt, then delete it to free the disk space.
MESSAGE
