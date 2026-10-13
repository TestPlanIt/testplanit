#!/bin/sh
# Prepares the bundled RustFS file storage for TestPlanIt: creates the bucket
# with its public-read and CORS rules, and stops while files from the old
# MinIO storage (./docker-data/minio) have not been migrated yet.
#
# Runs in the minio-init service of the Docker Compose files. Connection
# settings come from .env.production (AWS_ENDPOINT_URL, AWS_ACCESS_KEY_ID,
# AWS_SECRET_ACCESS_KEY, AWS_BUCKET_NAME), the same values the app uses.
set -eu

ENDPOINT="${AWS_ENDPOINT_URL:-http://minio:9000}"
BUCKET="${AWS_BUCKET_NAME:-testplanit}"
LEGACY_DIR="/docker-data/minio"

s3api() {
  aws --endpoint-url "$ENDPOINT" s3api "$@"
}

echo "Waiting for file storage at $ENDPOINT..."
until s3api list-buckets >/dev/null 2>&1; do
  sleep 2
done

if ! s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "Creating bucket $BUCKET..."
  s3api create-bucket --bucket "$BUCKET" >/dev/null
fi

# Uploads always use signed requests, so anonymous access is read-only.
s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Principal\": {\"AWS\": [\"*\"]},
    \"Action\": [\"s3:GetObject\"],
    \"Resource\": [\"arn:aws:s3:::$BUCKET/*\"]
  }]
}"

# Browsers upload with presigned PUTs from the app's origin.
s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"]
  }]
}'

legacy_has_files() {
  [ -d "$LEGACY_DIR" ] &&
    [ -n "$(find "$LEGACY_DIR" -mindepth 1 -path "$LEGACY_DIR/.minio.sys" -prune -o -type f -print 2>/dev/null | head -n 1)" ]
}

bucket_is_empty() {
  count=$(s3api list-objects-v2 --bucket "$BUCKET" --max-items 1 \
    --query 'length(Contents || `[]`)' --output text)
  [ "$count" = "0" ]
}

if legacy_has_files && bucket_is_empty; then
  if [ "${STORAGE_MIGRATION_SKIP:-}" = "true" ]; then
    echo "WARNING: ./docker-data/minio still holds files that are not in the new"
    echo "storage. Starting anyway because STORAGE_MIGRATION_SKIP=true."
  else
    cat <<'MESSAGE'

==========================================================================
 ACTION REQUIRED: migrate your files from MinIO to RustFS
==========================================================================
 TestPlanIt now stores files in RustFS, because MinIO no longer publishes
 Docker images. Your existing attachments, images and avatars are still in
 ./docker-data/minio and have not been copied to the new storage yet.

 TestPlanIt will not start until they are migrated, so it never comes up
 looking as if your files were lost. To migrate, run from the testplanit
 directory:

   ./scripts/migrate-minio-to-rustfs.sh

 Full guide: https://docs.testplanit.com/docs/migrating-from-minio

 To start without migrating (files uploaded before the upgrade will be
 missing), set STORAGE_MIGRATION_SKIP=true in .env.production.
==========================================================================

MESSAGE
    exit 1
  fi
fi

echo "File storage is ready."
