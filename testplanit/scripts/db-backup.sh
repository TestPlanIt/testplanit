#!/bin/bash

# Database Backup Script for TestPlanIt
# Creates a timestamped backup of the PostgreSQL database

# Color codes for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Load database connection from .env
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    exit 1
fi

# Extract database connection details from DATABASE_URL
# Format: postgresql://user:password@host:port/database
DB_URL=$(grep '^DATABASE_URL=' .env | cut -d '"' -f 2)

if [ -z "$DB_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL not found in .env${NC}"
    exit 1
fi

# Parse the connection string
# Format: postgresql://user:password@host:port/database?schema=public
DB_USER=$(echo "$DB_URL" | sed 's|postgresql://\([^:]*\):.*|\1|')
DB_PASS=$(echo "$DB_URL" | sed 's|postgresql://[^:]*:\([^@]*\)@.*|\1|')
DB_HOST=$(echo "$DB_URL" | sed 's|.*@\([^:]*\):.*|\1|')
DB_PORT=$(echo "$DB_URL" | sed 's|.*@[^:]*:\([0-9]*\)/.*|\1|')
DB_NAME=$(echo "$DB_URL" | sed 's|.*/\([^?]*\).*|\1|')

# Create backups directory if it doesn't exist
BACKUP_DIR="./backups"
mkdir -p "$BACKUP_DIR"

# Generate timestamp for backup file
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/testplanit_backup_${TIMESTAMP}.sql"

echo -e "${YELLOW}Starting database backup...${NC}"
echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo "Backup file: $BACKUP_FILE"
echo ""

# Set password for pg_dump
export PGPASSWORD="$DB_PASS"

# Create the backup
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  --format=plain \
  --no-owner \
  --no-acl \
  --verbose \
  --file="$BACKUP_FILE" 2>&1

# Check if backup was successful
if [ $? -eq 0 ]; then
    # Get file size
    FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo ""
    echo -e "${GREEN}✓ Backup completed successfully!${NC}"
    echo "File: $BACKUP_FILE"
    echo "Size: $FILE_SIZE"
    echo ""
    echo "To restore this backup, run:"
    echo -e "${YELLOW}  ./scripts/db-restore.sh $BACKUP_FILE${NC}"
else
    echo -e "${RED}✗ Backup failed!${NC}"
    exit 1
fi

# Unset password
unset PGPASSWORD

# List recent backups
echo ""
echo "Recent backups:"
ls -lht "$BACKUP_DIR" | head -6
