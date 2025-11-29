---
title: External Database Deployment
sidebar_position: 5
---

# Deploying TestPlanIt with an External Database

This guide explains how to deploy TestPlanIt using Docker with an external PostgreSQL database instead of the containerized database.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Database Setup](#database-setup)
- [Docker Compose Configuration](#docker-compose-configuration)
- [Common Issues and Solutions](#common-issues-and-solutions)

## Overview

TestPlanIt's Docker deployment uses profiles to make all services optional. You can easily use external managed services instead of Docker containers for:

- **PostgreSQL** - Use AWS RDS, Azure Database, Google Cloud SQL, etc.
- **Valkey/Redis** - Use AWS ElastiCache, Azure Cache, Google Memorystore, etc.
- **Elasticsearch** - Use AWS OpenSearch, Elastic Cloud, etc.
- **S3 Storage** - Use AWS S3, Azure Blob Storage, Google Cloud Storage, etc.

Common reasons to use external services:

- Production deployments with existing infrastructure
- Better performance, scalability, and high availability
- Centralized management and monitoring
- Automated backups and disaster recovery
- Running multiple TestPlanIt instances against shared services

## Prerequisites

- Docker and Docker Compose installed
- Access to a PostgreSQL 15+ database server
- Database credentials with appropriate permissions
- Network connectivity from Docker host to database server

## Database Setup

### Step 1: Create Database and User

Connect to your PostgreSQL server and create a dedicated database and user:

```sql
-- Connect as postgres superuser
-- Create the database
CREATE DATABASE testplanit_prod;

-- Create a dedicated user
CREATE USER testplanit WITH PASSWORD 'your_secure_password';

-- Grant all privileges to the user
GRANT ALL PRIVILEGES ON DATABASE testplanit_prod TO testplanit;
```

### Step 2: Configure Database Permissions

The TestPlanIt user needs full ownership of the database to create and modify tables:

```sql
-- Connect to the database
\c testplanit_prod

-- Make the user owner of the database and schema
ALTER DATABASE testplanit_prod OWNER TO testplanit;
ALTER SCHEMA public OWNER TO testplanit;

-- Grant create privilege
GRANT CREATE ON DATABASE testplanit_prod TO testplanit;
GRANT USAGE, CREATE ON SCHEMA public TO testplanit;
```

### Step 3: Transfer Ownership of Existing Tables (If Applicable)

If you're migrating from an existing setup where tables are owned by a different user:

```sql
-- Connect as the current owner or superuser
\c testplanit_prod

-- Transfer schema ownership
ALTER SCHEMA public OWNER TO testplanit;

-- Transfer all table ownership
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' OWNER TO testplanit;';
  END LOOP;
END $$;

-- Transfer all sequence ownership
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'
  LOOP
    EXECUTE 'ALTER SEQUENCE public.' || quote_ident(r.sequence_name) || ' OWNER TO testplanit;';
  END LOOP;
END $$;

-- Set default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO testplanit;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO testplanit;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO testplanit;
```

### Step 4: Verify Database Permissions

Check that the user has proper ownership:

```sql
-- Check database and schema ownership
SELECT
  'Database' as object_type,
  datname as name,
  pg_catalog.pg_get_userbyid(datdba) as owner
FROM pg_database
WHERE datname = 'testplanit_prod'
UNION ALL
SELECT
  'Schema' as object_type,
  nspname as name,
  pg_catalog.pg_get_userbyid(nspowner) as owner
FROM pg_namespace
WHERE nspname = 'public';

-- Check table ownership
SELECT tablename, tableowner
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename
LIMIT 10;
```

All should show `testplanit` as the owner.

## Docker Compose Configuration

### Step 1: Create Environment File

Create a `.env.production` file (or `.env.production.yourinstance` for multiple instances):

**Example 1: External Database Only** (Use Docker for other services)

```env
# External PostgreSQL (e.g., AWS RDS)
DATABASE_URL="postgresql://testplanit:your_secure_password@your-rds.us-east-1.rds.amazonaws.com:5432/testplanit_prod?schema=public"

# Docker Valkey
VALKEY_URL="valkey://valkey:6379"

# Docker Elasticsearch
ELASTICSEARCH_NODE="http://elasticsearch:9200"

# Docker MinIO
AWS_ACCESS_KEY_ID="minioadmin"
AWS_SECRET_ACCESS_KEY="minioadmin123"
AWS_BUCKET_NAME="testplanit"
AWS_ENDPOINT_URL="http://minio:9000"
AWS_PUBLIC_ENDPOINT_URL="https://your-domain.com/minio"

# Application
NEXTAUTH_URL="https://your-domain.com"
NEXTAUTH_SECRET="your_nextauth_secret_here"
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="change-me"
```

**Example 2: All External Services** (No Docker services)

```env
# External PostgreSQL
DATABASE_URL="postgresql://testplanit:password@your-db-host:5432/testplanit_prod?schema=public"

# External Redis/ElastiCache
VALKEY_URL="valkey://your-redis.cache.amazonaws.com:6379"

# External Elasticsearch/OpenSearch
ELASTICSEARCH_NODE="https://your-es.es.amazonaws.com:9200"

# AWS S3
AWS_ACCESS_KEY_ID="your_aws_key"
AWS_SECRET_ACCESS_KEY="your_aws_secret"
AWS_BUCKET_NAME="your-bucket"
AWS_REGION="us-east-1"
AWS_ENDPOINT_URL=""  # Empty for AWS S3
AWS_PUBLIC_ENDPOINT_URL=""  # Empty for AWS S3

# Application
NEXTAUTH_URL="https://your-domain.com"
NEXTAUTH_SECRET="your_nextauth_secret_here"
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="change-me"

# Email (optional)
EMAIL_SERVER_HOST="smtp.yourdomain.com"
EMAIL_SERVER_PORT="587"
EMAIL_SERVER_USER="your_email_user"
EMAIL_SERVER_PASSWORD="your_email_password"
EMAIL_FROM="testplanit@yourdomain.com"
```

### Step 2: Choose Docker Compose Profiles

TestPlanIt uses Docker Compose profiles to enable/disable services. The included `docker-compose.prod.yml` already supports this - just choose which profiles to enable:

**Available Profiles:**

- `with-postgres` - PostgreSQL database container
- `with-valkey` - Valkey/Redis cache container
- `with-elasticsearch` - Elasticsearch search container
- `with-minio` - MinIO storage + Nginx proxy

**Deployment Examples:**

**Example 1: External Database, Docker for Everything Else**

```bash
# Omit with-postgres profile to use external database
PROFILES="--profile with-valkey --profile with-elasticsearch --profile with-minio"

docker compose -f docker-compose.prod.yml $PROFILES build
docker compose -f docker-compose.prod.yml $PROFILES up -d
```

**Example 2: Only External Database and S3**

```bash
# Use Docker Valkey and Elasticsearch, external DB and S3
PROFILES="--profile with-valkey --profile with-elasticsearch"

docker compose -f docker-compose.prod.yml $PROFILES build
docker compose -f docker-compose.prod.yml $PROFILES up -d
```

**Example 3: All External Services**

```bash
# Run only the application, no Docker services
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

### Step 3: Initialize External Database (If Needed)

If you're using an external PostgreSQL database for the first time, initialize the schema manually:

```bash
# Run db push and seed using a temporary container
docker compose -f docker-compose.prod.yml run --rm \
  -e DATABASE_URL="your-external-database-url" \
  prod sh -c "pnpm prisma db push --accept-data-loss && pnpm tsx prisma/seed.ts"
```

Or use your existing database if it's already initialized.

### Step 4: Monitor Deployment

```bash
# View service status
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f

# View specific service logs
docker compose -f docker-compose.prod.yml logs -f prod
docker compose -f docker-compose.prod.yml logs -f workers
```

## Common Issues and Solutions

### Issue 1: Permission Denied Errors

**Error:**

```text
Error: ERROR: permission denied for table Account
```

**Solution:**
Follow the database permission setup in [Step 2](#step-2-configure-database-permissions) and [Step 3](#step-3-transfer-ownership-of-existing-tables-if-applicable) above.

### Issue 2: Services Won't Start

**Error:**

```text
Service 'postgres' not found
```

**Solution:**
You're referencing a service that's not enabled. Make sure you're only using profiles for services you want to run. For example, if using an external database, don't include `--profile with-postgres`.

### Issue 3: Connection Refused

**Error:**

```text
Error: connect ECONNREFUSED
```

**Solution:**

- Verify the database server is accessible from the Docker host
- Check firewall rules allow connections to the database port
- Verify the `DATABASE_URL` in your `.env.production` file has the correct host and port
- Test connectivity: `telnet database-host database-port`

### Issue 4: Tables Already Exist

**Error:**

```text
Error: Table already exists
```

**Solution:**
If you're migrating an existing database:

1. Remove `--accept-data-loss` from the `db-init-prod` command
2. Use `pnpm prisma db push` without the flag to preserve data
3. Or use `pnpm prisma migrate deploy` if using migrations

### Issue 5: Different User Created Tables

If tables exist but were created by a different user (e.g., `admin` instead of `testplanit`), you must transfer ownership:

```bash
# Connect as the table owner or superuser
PGPASSWORD='owner_password' psql -h database-host -p 5432 -U owner_user -d testplanit_prod

# Then run the ownership transfer SQL from Step 3 above
```

## Multiple Instances

To run multiple TestPlanIt instances against different databases:

1. Create separate environment files:
   - `.env.production.instance1`
   - `.env.production.instance2`

2. Create separate Docker Compose files:
   - `docker-compose.instance1.yml`
   - `docker-compose.instance2.yml`

3. Use different ports and container names in each compose file

4. Use different network names to isolate instances

## Best Practices

1. **Use strong passwords** for database users
2. **Enable SSL/TLS** for database connections in production
3. **Regular backups** of the external database
4. **Monitor database performance** and connection pools
5. **Use read replicas** for high-traffic deployments
6. **Keep database and application on the same network/region** for low latency
7. **Configure connection pooling** in your `DATABASE_URL` if needed:

   ```text
   DATABASE_URL="postgresql://user:pass@host:5432/db?schema=public&connection_limit=10&pool_timeout=20"
   ```

## Troubleshooting Commands

```bash
# Test database connectivity from Docker host
telnet database-host database-port

# Check database permissions
PGPASSWORD='password' psql -h host -p port -U user -d database -c "\dp"

# View database and schema ownership
PGPASSWORD='password' psql -h host -p port -U user -d database -c "
SELECT
  'Database' as type, datname as name, pg_get_userbyid(datdba) as owner
FROM pg_database WHERE datname = 'testplanit_prod'
UNION ALL
SELECT
  'Schema', nspname, pg_get_userbyid(nspowner)
FROM pg_namespace WHERE nspname = 'public';
"

# Check table ownership
PGPASSWORD='password' psql -h host -p port -U user -d database -c "
SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public';
"

# View Docker container logs
docker compose -f docker-compose.prod.yml logs -f db-init-prod
docker compose -f docker-compose.prod.yml logs -f workers
docker compose -f docker-compose.prod.yml logs -f prod
```

## Support

For additional help:

- Check the [Deployment](./deployment.md) guide for standard Docker deployment
- Review [Installation](./installation.md) for general setup guidance
- Open an issue on [GitHub](https://github.com/testplanit/testplanit)
