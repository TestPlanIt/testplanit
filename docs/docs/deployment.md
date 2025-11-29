---
title: Deployment
sidebar_position: 4 # Adjust position as needed
---

# Deploying TestPlanIt with Docker

This guide outlines the steps to deploy TestPlanIt to production using the comprehensive Docker Compose setup that includes all required services.

## Prerequisites

- A server with Docker and Docker Compose installed
- For all services, at least 8GB RAM and 4 CPU cores, 16GB and 8 CPU cores recommended
- Storage for persistent data volumes
- A domain name and SSL certificate (for HTTPS)

## Architecture Overview

TestPlanIt supports flexible deployment configurations. You can deploy all services in Docker containers or connect to external managed services.

**Core Services** (Always Deployed):

1. **Web Application** (`prod`) - Next.js application serving the UI and API
2. **Background Workers** (`workers`) - Process asynchronous jobs for:
   - Email sending and notifications
   - Scheduled tasks (daily digest emails at 8 AM, forecast updates at 3 AM)
   - Search indexing and file processing

**Optional Services** (Can Use Docker or External):
3. **PostgreSQL** (`postgres`) - Primary database storage
4. **Valkey** (`valkey`) - Redis-compatible cache and job queue
5. **Elasticsearch** (`elasticsearch`) - Full-text search engine (optional feature)
6. **MinIO** (`minio`) + **Nginx** (`nginx`) - S3-compatible file storage with reverse proxy

You can mix and match these services using Docker Compose profiles.

## Deployment Steps

### 1. Clone and Setup

```bash
# Clone the repository
git clone https://github.com/testplanit/testplanit.git
cd testplanit/testplanit
```

### 2. Choose Deployment Configuration

TestPlanIt uses Docker Compose profiles to make services optional. Choose your deployment strategy:

**Option A: All-in-One (Recommended for Getting Started)**

```bash
# Deploy all services in Docker containers
PROFILES="--profile with-postgres --profile with-valkey --profile with-elasticsearch --profile with-minio"
```

**Option B: Hybrid Deployment**

```bash
# Example: External database, Docker for everything else
PROFILES="--profile with-valkey --profile with-elasticsearch --profile with-minio"
```

**Option C: Fully Managed Services**

```bash
# Only run application, use external services for everything
PROFILES=""
```

Available profiles:

- `with-postgres` - Include PostgreSQL container
- `with-valkey` - Include Valkey/Redis container
- `with-elasticsearch` - Include Elasticsearch container (optional, for search)
- `with-minio` - Include MinIO + Nginx containers (S3-compatible storage)

### 3. Configure Environment

Create and customize `.env.production` based on your deployment choice:

**For All-in-One Deployment:**

```bash
# Database (Docker PostgreSQL)
DATABASE_URL="postgresql://user:password@postgres:5432/testplanit_prod?schema=public"

# Cache/Queue (Docker Valkey)
VALKEY_URL="valkey://valkey:6379"

# Search (Docker Elasticsearch)
ELASTICSEARCH_NODE="http://elasticsearch:9200"

# File Storage (Docker MinIO)
AWS_ACCESS_KEY_ID="minioadmin"
AWS_SECRET_ACCESS_KEY="minioadmin123"
AWS_BUCKET_NAME="testplanit"
AWS_ENDPOINT_URL="http://minio:9000"
AWS_PUBLIC_ENDPOINT_URL="https://your-domain.com/minio"

# Application
NEXTAUTH_URL="https://your-domain.com"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="change-me"
```

**For External Services:**

```bash
# External PostgreSQL (e.g., AWS RDS)
DATABASE_URL="postgresql://user:pass@your-rds.amazonaws.com:5432/testplanit?schema=public"

# External Redis (e.g., AWS ElastiCache)
VALKEY_URL="valkey://your-redis.cache.amazonaws.com:6379"

# External Elasticsearch (e.g., AWS OpenSearch)
ELASTICSEARCH_NODE="https://your-es.es.amazonaws.com:9200"

# AWS S3
AWS_ACCESS_KEY_ID="your-aws-key"
AWS_SECRET_ACCESS_KEY="your-aws-secret"
AWS_BUCKET_NAME="your-bucket"
AWS_ENDPOINT_URL=""  # Empty for AWS S3
AWS_PUBLIC_ENDPOINT_URL=""  # Empty for AWS S3

# Application
NEXTAUTH_URL="https://your-domain.com"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"
```

See [.env.example](https://github.com/testplanit/testplanit/blob/main/testplanit/.env.example) for all options.

### 4. Build and Deploy

```bash
# Set your chosen profiles (example uses all services)
PROFILES="--profile with-postgres --profile with-valkey --profile with-elasticsearch --profile with-minio"

# Build the images
docker compose -f docker-compose.prod.yml build

# Start services
docker compose -f docker-compose.prod.yml $PROFILES up -d
```

What happens during startup:

- Application and worker images are built
- **Database migrations run automatically** - The `migrate` service runs `prisma db push` to sync the database schema with the application before starting
- Selected services start (based on profiles)
- Database is seeded with initial data (if using `with-postgres` profile for first-time setup)
- MinIO buckets are created (if using `with-minio`)
- Application and workers become available

:::info Automatic Database Migrations
Every time you start the application, the `migrate` service automatically runs to ensure your database schema is in sync with the application version. This happens before the `prod` and `workers` services start, so you don't need to manually run migrations after updates.
:::

### 5. Access Your Application

- **Application**: `http://localhost:30000` (or your configured domain)
- **MinIO Console** (if using `with-minio`): `http://localhost:9001`
- **Elasticsearch** (if using `with-elasticsearch`): `http://localhost:9200`
- **Default Login**: `admin@example.com` / `admin` (change in production!)

### 6. Set Up External Access (HTTPS)

For production, configure a reverse proxy (nginx/Caddy/CloudFlare) to:

- Handle SSL termination
- Forward requests to port 30000 (TestPlanIt)
- Forward `/testplanit/` requests to port 80 (internal nginx for MinIO)

Example nginx configuration:

```nginx
server {
    listen 443 ssl;
    server_name testplanit.yourdomain.com;

    # SSL configuration
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Proxy main application
    location / {
        proxy_pass http://localhost:30000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Proxy MinIO file access
    location /testplanit/ {
        proxy_pass http://localhost:80/testplanit/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 100M;
    }
}
```

## Management Commands

**Note**: Include the same `$PROFILES` flags you used for deployment in all commands.

```bash
# Set your profiles (adjust based on your deployment)
PROFILES="--profile with-postgres --profile with-valkey --profile with-elasticsearch --profile with-minio"

# View service status
docker compose -f docker-compose.prod.yml ps

# View logs for all services
docker compose -f docker-compose.prod.yml logs -f

# View logs for specific service
docker compose -f docker-compose.prod.yml logs -f prod
docker compose -f docker-compose.prod.yml logs -f workers

# Stop all services
docker compose -f docker-compose.prod.yml $PROFILES down

# Update to latest version
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml $PROFILES up -d
# Note: Database migrations run automatically via the migrate service

# Backup data (if using Docker services)
docker compose -f docker-compose.prod.yml $PROFILES down
tar -czf testplanit-backup-$(date +%Y%m%d).tar.gz docker-data/

# Restore from backup
docker compose -f docker-compose.prod.yml $PROFILES down
sudo rm -rf docker-data/
tar -xzf testplanit-backup-YYYYMMDD.tar.gz
docker compose -f docker-compose.prod.yml $PROFILES up -d
```

## Service Details

### Background Workers & Scheduled Jobs

The workers container (`testplanit-workers`) handles:

**Scheduled Jobs** (via PM2 cron):

- Daily digest emails (8 AM)
- Forecast updates (3 AM)

**Queue Processing**:

- Email sending
- Notification delivery
- Search indexing
- File processing

#### Monitoring Workers

```bash
# View all worker processes
docker exec testplanit-workers pm2 list

# View worker logs
docker compose logs -f workers

# View specific worker logs
docker exec testplanit-workers pm2 logs notification-worker
```

### Data Persistence

All service data is stored in `./docker-data/`:

- `postgres/` - Database files
- `redis/` - Valkey persistence
- `elasticsearch/` - Search indexes
- `minio/` - File attachments

### File Storage Configuration

**Option 1: Docker MinIO** (`with-minio` profile)

- Internal endpoint: `http://minio:9000` (app → MinIO)
- External access: `https://yourdomain.com/minio/` (browser → files)
- Admin console: `http://localhost:9001`

**Option 2: AWS S3** (no MinIO profile)
Update `.env.production`:

```bash
AWS_ENDPOINT_URL=""  # Empty for AWS S3
AWS_PUBLIC_ENDPOINT_URL=""  # Empty for AWS S3
AWS_BUCKET_NAME=your-s3-bucket
AWS_ACCESS_KEY_ID=your-aws-key
AWS_SECRET_ACCESS_KEY=your-aws-secret
```

**Option 3: External MinIO**
Update `.env.production`:

```bash
AWS_ENDPOINT_URL="http://your-minio-host:9000"
AWS_PUBLIC_ENDPOINT_URL="https://your-public-minio-url"
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_BUCKET_NAME=your-bucket
```

## Maintenance Mode

When performing upgrades, data migrations, or other maintenance tasks that require taking the application offline, you can enable maintenance mode to display a friendly message to users instead of error pages.

Maintenance mode is handled by nginx and works even when the application is stopped.

### Enable Maintenance Mode

Create the maintenance config file inside the nginx container:

```bash
docker exec testplanit-nginx sh -c 'cat > /etc/nginx/maintenance.json << EOF
{
  "startTime": "2025-01-15T10:00:00Z",
  "expectedDuration": 30
}
EOF'
```

Replace `startTime` with the current UTC time (ISO format) and `expectedDuration` with expected minutes.

### Disable Maintenance Mode

```bash
docker exec testplanit-nginx rm /etc/nginx/maintenance.json
```

No nginx reload is required - the check happens on each request.

### How It Works

- When `/etc/nginx/maintenance.json` exists, nginx returns a 503 status with a static maintenance page
- The `/health` endpoint remains available for monitoring systems
- MinIO file access continues to work during maintenance
- The maintenance page is served from `/etc/nginx/maintenance.html`
- The page loads `/maintenance.json` to display start time and countdown

### Customizing the Maintenance Page

To customize the maintenance message, edit `maintenance.html` in the repository and redeploy.

### Typical Maintenance Workflow

```bash
# 1. Enable maintenance mode
docker exec testplanit-nginx sh -c 'cat > /etc/nginx/maintenance.json << EOF
{
  "startTime": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
  "expectedDuration": 30
}
EOF'

# 2. Stop application services
docker compose -f docker-compose.prod.yml stop prod workers

# 3. Perform maintenance (backups, migrations, updates, etc.)
# ...

# 4. Start application services
docker compose -f docker-compose.prod.yml start prod workers

# 5. Verify application is healthy
curl http://localhost:30000/api/health

# 6. Disable maintenance mode
docker exec testplanit-nginx rm /etc/nginx/maintenance.json
```

## Production Considerations

### Security

- **Secrets Management**: Never commit production secrets to git. Use secure methods:
  - Host environment variables
  - Docker secrets
  - Secrets management tools (Vault, AWS Secrets Manager)
- **HTTPS**: Configure external reverse proxy for SSL/TLS termination
- **Firewall**: Restrict access to internal service ports (5432, 6379, 9200, 9000)

### Monitoring & Maintenance

- Set up log aggregation for all services
- Monitor disk usage in `docker-data/` volumes
- Monitor memory usage (especially Elasticsearch)
- Set up health check alerts for critical services
- Schedule regular backups of `docker-data/`

### Scaling Considerations

- Workers can be scaled horizontally (multiple worker containers)
- Valkey acts as job queue ensuring jobs are processed only once
- Consider Valkey Cluster/Sentinel for high availability
- For large deployments, use external managed services:
  - Amazon RDS for PostgreSQL
  - Amazon ElastiCache for Redis/Valkey
  - Amazon OpenSearch for Elasticsearch
  - Amazon S3 for file storage

### Production Checklist

- [ ] Custom domain configured with SSL certificate
- [ ] NEXTAUTH_SECRET set to secure random value
- [ ] ADMIN_PASSWORD changed from default
- [ ] Email server configured (if using notifications)
- [ ] External reverse proxy configured
- [ ] Backup strategy implemented
- [ ] Monitoring and alerting configured
- [ ] Log retention policies set
- [ ] Security firewall rules applied
