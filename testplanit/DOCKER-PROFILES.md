# Docker Compose Profiles for Production

This document explains how to use Docker Compose profiles to flexibly deploy TestPlanIt with different service configurations.

## Overview

TestPlanIt's production Docker setup (`docker-compose.prod.yml`) uses Docker Compose profiles to make each service optional. This allows you to:

- Deploy all services in Docker containers (fully self-hosted)
- Use external managed services (e.g., AWS RDS, ElastiCache, S3, OpenSearch)
- Mix and match - use some Docker services and some external services

## Available Profiles

| Profile | Service | Purpose |
|---------|---------|---------|
| `with-postgres` | PostgreSQL 15 | Database storage |
| `with-valkey` | Valkey 8 | Redis-compatible cache and job queue |
| `with-elasticsearch` | Elasticsearch 9 | Full-text search engine |
| `with-minio` | MinIO + Nginx | S3-compatible file storage with reverse proxy |

## Quick Start

### All Services in Docker (Recommended for Getting Started)

```bash
docker compose -f docker-compose.prod.yml \
  --profile with-postgres \
  --profile with-valkey \
  --profile with-elasticsearch \
  --profile with-minio \
  up -d
```

### Only Application (All External Services)

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Custom Mix (Example: External Database, Docker for Everything Else)

```bash
docker compose -f docker-compose.prod.yml \
  --profile with-valkey \
  --profile with-elasticsearch \
  --profile with-minio \
  up -d
```

## Configuration by Profile

### with-postgres

**Included Services:**

- `postgres` - PostgreSQL 15 database
- `db-init-prod` - Initializes schema and seeds data

**Environment Variables:**
```bash
DATABASE_URL="postgresql://user:password@postgres:5432/testplanit_prod?schema=public"
POSTGRES_HOST="postgres"  # Optional, defaults to 'postgres'
POSTGRES_PORT="5432"      # Optional, defaults to 5432
```

**When to Use:**

- Development/staging environments
- Small to medium teams
- On-premise deployments
- Want full control over database

**External Alternative:**
Use AWS RDS, Azure Database for PostgreSQL, Google Cloud SQL, or any managed PostgreSQL service.

```bash
# Example with AWS RDS
DATABASE_URL="postgresql://username:password@mydb.123456.us-east-1.rds.amazonaws.com:5432/testplanit?schema=public"
```

---

### with-valkey

**Included Services:**

- `valkey` - Valkey 8 (Redis-compatible)

**Environment Variables:**
```bash
VALKEY_URL="valkey://valkey:6379"
```

**When to Use:**

- Development/staging environments
- Small to medium teams
- Want to minimize external dependencies

**External Alternative:**
Use AWS ElastiCache, Azure Cache for Redis, Google Cloud Memorystore, or any Redis-compatible service.

```bash
# Example with AWS ElastiCache
VALKEY_URL="valkey://my-redis.abc123.0001.use1.cache.amazonaws.com:6379"
```

---

### with-elasticsearch

**Included Services:**

- `elasticsearch-init` - Prepares data directory permissions
- `elasticsearch` - Elasticsearch 9 single-node

**Environment Variables:**
```bash
ELASTICSEARCH_NODE="http://elasticsearch:9200"
```

**When to Use:**

- Development/staging environments
- Need full-text search capabilities
- Want to minimize external costs

**External Alternative:**
Use AWS OpenSearch, Elastic Cloud, or any managed Elasticsearch service. Can also be omitted entirely if search features aren't needed.

```bash
# Example with AWS OpenSearch
ELASTICSEARCH_NODE="https://search-mydomain.us-east-1.es.amazonaws.com:443"

# Disable search features
ELASTICSEARCH_NODE=""
```

---

### with-minio

**Included Services:**

- `minio` - MinIO S3-compatible object storage
- `minio-init` - Creates initial bucket
- `nginx` - Reverse proxy for MinIO

**Environment Variables:**
```bash
AWS_ACCESS_KEY_ID="minioadmin"
AWS_SECRET_ACCESS_KEY="minioadmin123"
AWS_BUCKET_NAME="testplanit"
AWS_ENDPOINT_URL="http://minio:9000"
AWS_PUBLIC_ENDPOINT_URL="https://your-domain.com/minio"
MINIO_SERVER_URL="https://your-domain.com"
```

**When to Use:**

- Development/staging environments
- On-premise deployments
- Want full control over file storage
- Minimize cloud costs

**External Alternative:**
Use AWS S3, Azure Blob Storage, Google Cloud Storage, or any S3-compatible service.

```bash
# Example with AWS S3
AWS_ACCESS_KEY_ID="AKIAIOSFODNN7EXAMPLE"
AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
AWS_REGION="us-east-1"
AWS_BUCKET_NAME="my-testplanit-bucket"
AWS_ENDPOINT_URL=""  # Empty for AWS S3
AWS_PUBLIC_ENDPOINT_URL=""  # Empty for AWS S3
```

## Common Deployment Scenarios

### Scenario 1: Developer Environment

**Goal:** Quick local testing with minimal setup

```bash
docker compose -f docker-compose.prod.yml \
  --profile with-postgres \
  --profile with-valkey \
  --profile with-minio \
  up -d
```

### Scenario 2: Staging on AWS

**Goal:** Production-like environment with managed database

```bash
# Use AWS RDS for database, Docker for everything else
docker compose -f docker-compose.prod.yml \
  --profile with-valkey \
  --profile with-elasticsearch \
  --profile with-minio \
  up -d
```

### Scenario 3: Production on AWS

**Goal:** High availability with all managed services

```bash
# All services external
docker compose -f docker-compose.prod.yml up -d
```

Configure `.env.production`:

- AWS RDS for PostgreSQL
- AWS ElastiCache for Redis
- AWS S3 for storage
- AWS OpenSearch for search

### Scenario 4: Hybrid Cloud

**Goal:** Use cloud for database/storage, self-host cache/search

```bash
docker compose -f docker-compose.prod.yml \
  --profile with-valkey \
  --profile with-elasticsearch \
  up -d
```

Configure external AWS RDS (DATABASE_URL) and S3 (AWS_* vars).

## Tips and Best Practices

1. **Start Simple**: Begin with all Docker services, then migrate to external services as needed.

2. **Profile Consistency**: Use the same profiles for all operations (up, down, logs, etc.):
   ```bash
   PROFILES="--profile with-postgres --profile with-valkey --profile with-elasticsearch --profile with-minio"
   docker compose -f docker-compose.prod.yml $PROFILES up -d
   docker compose -f docker-compose.prod.yml $PROFILES logs -f
   docker compose -f docker-compose.prod.yml $PROFILES down
   ```

3. **Environment-Specific Configs**: Keep separate `.env.production` files for different environments:
   ```text
   ~/testplanit-dev/.env.production     # All Docker services
   ~/testplanit-staging/.env.production # Mix of Docker and external
   ~/testplanit-prod/.env.production    # All external services
   ```

4. **Cost Optimization**:
   - Start with Docker services in development/staging
   - Move to managed services in production for better uptime and support
   - Consider hybrid approach: managed database + self-hosted cache

5. **Backup Strategy**:
   - With Docker services: Backup `./docker-data/` directories
   - With external services: Use cloud-native backup solutions (RDS snapshots, S3 versioning, etc.)

6. **Networking**:
   - Docker services communicate via service names (e.g., `postgres`, `valkey`)
   - External services require publicly accessible endpoints or VPN/VPC peering

## Troubleshooting

**Issue**: Service won't start

- **Solution**: Verify you included the correct `--profile` flag for that service

**Issue**: Connection refused to service

- **Solution**: Check if using correct hostname (`postgres` for Docker, FQDN for external)

**Issue**: Profile services not appearing

- **Solution**: Ensure you're using Docker Compose v2+ (`docker compose` not `docker-compose`)

**Issue**: Data not persisting

- **Solution**: Check `./docker-data/` volumes are mounted correctly for Docker services

## See Also

- [DEPLOYMENT.md](./DEPLOYMENT.md) - Full deployment guide
- [.env.example](./.env.example) - Environment variable reference
- [docker-compose.prod.yml](./docker-compose.prod.yml) - Production compose file
