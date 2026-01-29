#!/bin/bash

# Database Restore Script for TestPlanIt
# Restores a PostgreSQL database from a backup file

# Color codes for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if backup file is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: No backup file specified${NC}"
    echo "Usage: $0 <backup_file.sql>"
    echo ""
    echo "Available backups:"
    ls -lht ./backups/*.sql 2>/dev/null | head -5
    exit 1
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}Error: Backup file not found: $BACKUP_FILE${NC}"
    exit 1
fi

# Load database connection from .env
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    exit 1
fi

# Extract database connection details from DATABASE_URL
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

echo -e "${YELLOW}⚠️  WARNING: This will replace ALL data in the database!${NC}"
echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo "Backup file: $BACKUP_FILE"
echo ""

# Confirmation prompt
read -p "Are you sure you want to restore? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
fi

echo ""
echo -e "${YELLOW}Starting database restore...${NC}"

# Set password for psql
export PGPASSWORD="$DB_PASS"

# Drop all existing connections (optional, be careful!)
echo "Closing existing connections..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" \
  2>/dev/null

# Drop and recreate the database
echo "Dropping and recreating database..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\";" 2>&1
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$DB_NAME\";" 2>&1

# Restore the backup
echo "Restoring from backup..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  --quiet \
  < "$BACKUP_FILE" 2>&1

# Check if restore was successful
if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ Database restored successfully!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Restart your development server if running"
    echo "2. Run 'pnpm generate' if schema was changed"
else
    echo -e "${RED}✗ Restore failed!${NC}"
    exit 1
fi

# Unset password
unset PGPASSWORD
