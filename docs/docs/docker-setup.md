---
title: Docker Setup
---

# Docker Installation Guide

This guide shows how to run TestPlanIt using Docker Compose with all required services included. The setup is self-contained and supports both development and production modes.

## Services Included

The Docker Compose setup starts these containerized services:

1. **TestPlanIt Application** (`dev`/`prod`) - Next.js web application
2. **Background Workers** (`workers-dev`/`workers`) - Process asynchronous jobs:
   - Email sending and notifications
   - Scheduled tasks (daily digests at 8 AM, forecast updates at 3 AM)
   - Search indexing and file processing
3. **PostgreSQL** (`postgres`) - Main database with automatic schema initialization
4. **Valkey** (`valkey`) - Job queue and caching (Redis-compatible in-memory data store)
5. **Elasticsearch** (`elasticsearch`) - Search and indexing engine
6. **MinIO** (`minio`) - S3-compatible object storage for file attachments
7. **Nginx** (`nginx`) - Reverse proxy for internal routing and file access
8. **Database Initialization** (`db-init`/`db-init-prod`) - Automatic schema setup and seeding
9. **MinIO Initialization** (`minio-init`) - Automatic bucket creation and permissions

## Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop/) with Compose plugin
- Git
- 8GB+ RAM available for containers (16GB recommended to run all services)
- 25GB+ disk space for data and images

## Installation & Setup Steps

1. **Clone the repository:**
    Open your terminal and clone the TestPlanIt monorepo:

    ```bash
    git clone https://github.com/testplanit/testplanit.git
    cd testplanit
    ```

2. **Navigate to the application directory:**

    ```bash
    cd testplanit
    ```

3. **Set up Environment Variables:**

    For **Development**:

    ```bash
    cp .env.example .env.development
    ```

    For **Production** (optional customization):
    The `.env.production` file is pre-configured for Docker deployment. You may customize:

    ```bash
    # Application URL (change to your domain)
    NEXTAUTH_URL="https://demo.testplanit.com"

    # Generate secure secret
    NEXTAUTH_SECRET="$(openssl rand -base64 32)"

    # External file access domain
    AWS_PUBLIC_ENDPOINT_URL="https://demo.testplanit.com"

    # Default admin account
    ADMIN_EMAIL=admin@example.com
    ADMIN_NAME="Administrator Account"
    ADMIN_PASSWORD=admin

    # Email settings (required for Magic Link authentication and notifications)
    EMAIL_SERVER_HOST=smtp.your-provider.com
    EMAIL_SERVER_PORT=587
    EMAIL_SERVER_USER=your-email@domain.com
    EMAIL_SERVER_PASSWORD=your-password
    EMAIL_FROM=noreply@yourdomain.com
    ```

    **Note:** All internal service connections (database, Valkey, Elasticsearch, MinIO) are pre-configured and don't need modification.

4. **Choose Your Services:**

    TestPlanIt uses Docker Compose profiles to make services optional:

    - `dev` / `prod` - Development/Production app+workers profiles (includes all dependencies)
    - `with-postgres` - PostgreSQL database
    - `with-valkey` - Valkey/Redis cache and queue
    - `with-elasticsearch` - Elasticsearch search (optional)
    - `with-minio` - MinIO file storage + Nginx

    **Quick Start Options:**

    **All Services (Full Stack):**

    ```bash
    # Development
    docker compose --profile dev up --build

    # Production
    docker compose --profile prod up --build
    ```

    **Selective Services:**

    ```bash
    # Development without search
    docker compose up dev workers-dev postgres valkey minio --build

    # Production with only essential services
    docker compose up prod workers postgres valkey --build
    ```

5. **Start the Application:**

    **Development Mode** (with hot-reload, all services):

    ```bash
    docker compose --profile dev up --build
    ```

    **Production Mode** (optimized builds, all services):

    ```bash
    docker compose --profile prod up --build
    ```

    **Production with External Services:**

    ```bash
    # Example: Using external database and S3, Docker for cache/search
    docker compose -f docker-compose.prod.yml \
      --profile with-valkey \
      --profile with-elasticsearch \
      up --build
    ```

    The `--build` flag ensures images are built from the latest code.

    **What Happens During Startup:**
    1. Selected services start based on profiles
    2. PostgreSQL (if included) starts and becomes healthy
    3. Other services (Valkey, Elasticsearch, MinIO) start
    4. Database initialization runs (if using PostgreSQL container)
    5. MinIO initialization creates buckets (if using MinIO container)
    6. Main application and workers start
    7. Nginx proxy becomes available (if using MinIO)

    **First startup takes 2-5 minutes** as images are built and services initialize.

6. **Access TestPlanIt:**
    - **Development**: [http://localhost:3000](http://localhost:3000)
    - **Production**: [http://localhost:30000](http://localhost:30000)
    - **Default login**: `admin@example.com` / `admin` (change in production!)

7. **Access Additional Services (if enabled):**
    - **MinIO Console** (`with-minio`): [http://localhost:9001](http://localhost:9001)
    - **Elasticsearch** (`with-elasticsearch`): [http://localhost:9200](http://localhost:9200)
    - **PostgreSQL** (`with-postgres`): `localhost:5432` (user: `user` / password: `password`)
    - **Valkey** (`with-valkey`): `localhost:6379`

## Environment Management

### Starting & Stopping

```bash
# Start in foreground (see logs)
docker compose up prod workers

# Start in background (detached)
docker compose up prod workers -d

# Stop services (keeps data)
docker compose down

# Stop and remove containers/networks
docker compose down --remove-orphans

# Fresh start (removes all data!)
docker compose down
sudo rm -rf docker-data/
docker compose up prod workers --build
```

### Updates & Maintenance

```bash
# Update to latest version
git pull
docker compose build
docker compose up prod workers -d

# Rebuild specific service
docker compose build prod
docker compose up prod -d

# View resource usage
docker compose top
docker system df
```

### File Storage Configuration

**MinIO (Default)**:
Provides S3-compatible file storage with automatic setup:

- **Internal**: `http://minio:9000` (app ↔ MinIO)
- **External**: `https://yourdomain.com/testplanit/...` (browser access)
- **Console**: `http://localhost:9001` (admin interface)
- **Bucket**: `testplanit` (auto-created with public read permissions)

**Nginx Reverse Proxy**:
Automatically routes `/testplanit/` requests to MinIO for external file access while preserving AWS signature validation.

**Switching to AWS S3**:
To use AWS S3 instead of MinIO:

```bash
# In .env.production, change:
AWS_ENDPOINT_URL=""  # Empty = use AWS S3
AWS_PUBLIC_ENDPOINT_URL=""  # Empty = use AWS S3
AWS_BUCKET_NAME=your-s3-bucket-name
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
```

Then restart without the `with-minio` profile:

```bash
# Production example without MinIO
docker compose -f docker-compose.prod.yml \
  --profile with-postgres \
  --profile with-valkey \
  --profile with-elasticsearch \
  up --build
```

## Data Management

### Data Persistence

All service data persists in `./docker-data/`:

```text
docker-data/
├── postgres/      # Database files
├── valkey/        # Valkey job queue persistence
├── elasticsearch/ # Search indexes
└── minio/         # File attachments
```

### Backup & Restore

**Create Backup:**

```bash
# Stop services
docker compose down

# Create timestamped backup
tar -czf testplanit-backup-$(date +%Y%m%d).tar.gz docker-data/

# Restart services
docker compose up prod workers -d
```

**Restore Backup:**

```bash
# Stop and remove current data
docker compose down
sudo rm -rf docker-data/

# Extract backup
tar -xzf testplanit-backup-YYYYMMDD.tar.gz

# Restart services
docker compose up prod workers -d
```

### Database Operations

```bash
# Access database directly
docker compose exec postgres psql -U user -d testplanit_prod

# Dump database
docker compose exec postgres pg_dump -U user testplanit_prod > backup.sql

# Restore database (with services stopped)
docker compose exec postgres psql -U user -d testplanit_prod < backup.sql
```

### Service Management

**Start specific service combinations:**

```bash
# Full development stack
docker compose up dev workers-dev --build

# Full production stack
docker compose up prod workers --build

# Minimal development (no search/files)
docker compose up dev workers-dev postgres valkey --build

# Start in background (detached)
docker compose up prod workers --build -d
```

**Service Profiles:**

- `dev` - Development environment with all dependencies
- `prod` - Production environment with all dependencies
- `with-postgres` - PostgreSQL database container
- `with-valkey` - Valkey/Redis cache container
- `with-elasticsearch` - Elasticsearch search container
- `with-minio` - MinIO storage + Nginx proxy containers

Mix profiles to customize your deployment (e.g., `--profile with-postgres --profile with-valkey` for just database and cache).

### Monitoring & Logs

```bash
# Check service status
docker compose ps

# View all logs (follow mode)
docker compose logs -f

# View specific service logs
docker compose logs -f prod        # Main application
docker compose logs -f workers     # Background jobs
docker compose logs -f postgres    # Database
docker compose logs -f elasticsearch # Search engine
docker compose logs -f minio       # File storage

# View initialization logs
docker compose logs db-init-prod    # Database setup
docker compose logs minio-init      # Storage setup
```

## Troubleshooting

### Common Issues

**Services won't start:**

```bash
# Check service status
docker compose ps

# Check specific service health
docker compose ps postgres
docker compose ps elasticsearch

# View startup logs
docker compose logs db-init-prod
docker compose logs minio-init
```

**Database connection issues:**

```bash
# Check PostgreSQL health
docker compose ps postgres
docker compose logs postgres

# Test database connection
docker compose exec postgres psql -U user -d testplanit_prod -c "SELECT 1;"
```

**Search not working:**

```bash
# Check Elasticsearch status
curl http://localhost:9200/_cluster/health

# Reindex data through admin interface
# Go to: Admin → System → Reindex Search Data
```

**File upload/display issues:**

*403 Forbidden on file uploads:*

- **Cause**: AWS signature mismatch between app and MinIO
- **Fix**: Ensure `AWS_PUBLIC_ENDPOINT_URL` matches your external domain exactly
- **Check**: MinIO console at `http://localhost:9001` → bucket `testplanit` exists with public read

*Files not displaying:*

```bash
# Test MinIO direct access
curl -I http://localhost:9000/testplanit/

# Test nginx proxy
curl -I http://localhost:80/testplanit/

# Check MinIO health
curl http://localhost:9000/minio/health/live
```

*Image optimization errors:*

- Add your domain to `next.config.mjs` `images.remotePatterns`
- Verify files accessible at: `https://yourdomain.com/testplanit/...`

**Background jobs not processing:**

```bash
# Check worker status
docker compose logs workers

# Test Valkey connection
docker compose exec valkey valkey-cli ping

# Check worker processes inside container
docker exec testplanit-workers pm2 list
```

### Reset Everything

```bash
# Nuclear option - fresh start
docker compose down
sudo rm -rf docker-data/
docker compose up prod workers --build
```
