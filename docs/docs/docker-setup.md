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
   - Scheduled tasks (daily digests at 8 AM, forecast updates at 3 AM, abandoned automated-run sweep every 15 minutes)
   - Search indexing and file processing
3. **PostgreSQL** (`postgres`) - Main database with automatic schema initialization
4. **Valkey** (`valkey`) - Job queue and caching (Redis-compatible in-memory data store)
5. **Elasticsearch** (`elasticsearch`) - Search and indexing engine
6. **RustFS** (`minio`) - S3-compatible object storage for file attachments
7. **Nginx** (`nginx`) - Reverse proxy for internal routing and file access
8. **Database Initialization** (`db-init`/`db-init-prod`) - Automatic schema setup and seeding
9. **Storage Initialization** (`minio-init`) - Automatic bucket creation, read-only public access, and CORS rules

## Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop/) with Compose plugin
- Git
- **RAM Requirements:**

  | Phase                    | Minimum | Recommended | Notes                             |
  | ------------------------ | ------- | ----------- | --------------------------------- |
  | **Building**             | 8GB     | 8GB         | Peaks ~7GB, only during the build |
  | **Running (Full Stack)** | 8GB     | 14GB        | All services combined             |

  **Memory-constrained systems:** The build peaks around 7GB and the running stack needs 8–14GB, so a machine sized for the running total also covers builds.

  **Per-service breakdown (running):**

  | Service                | Minimum  | Recommended |
  | ---------------------- | -------- | ----------- |
  | TestPlanIt Application | 3GB      | 4GB         |
  | Background Workers     | 2GB      | 4GB         |
  | PostgreSQL             | 1.5GB    | 2GB         |
  | Elasticsearch          | 2GB      | 3GB         |
  | RustFS (file storage)  | 512MB    | 1GB         |
  | Valkey (Redis)         | 32MB     | 64MB        |
  | **Total**              | **~8GB** | **~14GB**   |

  The Background Workers figure is steady-state for a typical single-tenant install. One always-on worker (SCIM access recompute) idles near 1.4GB on its own regardless of whether SCIM is configured, which is why the fleet no longer fits in the old 512MB floor. Individual workers also restart at higher ceilings under load — eight of them sit at a 3GB ceiling, and the busiest (the webhook dispatch and outbox workers) can approach 1.9GB steady-state RSS each in multi-tenant clusters. Multi-tenant operators should size the worker fleet well above the recommended figure; see the [worker memory tiers](./background-processes.md) for the per-worker breakdown.

  The PostgreSQL figures do not add headroom for `/dev/shm`, where Postgres puts the shared memory segments its parallel query workers use. The compose files cap that at 256MB (see **Tuning the caps** below), but it is a cap rather than a reservation — pages are consumed only as queries use them, so a small install never pays for it. Installs that report heavily over large result sets should budget the Postgres service toward the recommended figure or above, since that is when the segments are actually allocated.

  **Tuning the caps.** The compose file caps the worker fleet at `4G` of memory, Postgres at `2` CPUs, and Postgres's `/dev/shm` at `256mb`. Raise any of them without editing the file by setting environment variables in your shell, the default `.env`, or `--env-file` — **not** `.env.production`, which is a runtime `env_file` and is not read during compose variable substitution:

  ```bash
  # e.g. a 32GB host running large Testmo imports and heavy reporting:
  WORKERS_MEMORY_LIMIT=20G POSTGRES_CPU_LIMIT=4 POSTGRES_SHM_SIZE=1gb \
    docker compose -f testplanit/docker-compose.prod.yml up -d
  ```

  Raise `POSTGRES_SHM_SIZE` if a report or drill-down fails with **`could not resize shared memory segment ... No space left on device`**. That is Postgres running out of `/dev/shm`, not a TestPlanIt fault: report queries over large result tables pick parallel plans, and Docker's own default for that filesystem is only 64MB. It surfaces as a 500 from the reports API.

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

   For **Production**:

   ```bash
   cp .env.example .env.production
   ```

   Then open `.env.production` and update these values for your deployment:

   ```bash
   # REQUIRED CHANGES for production:

   # Database — the bundled Postgres container creates the testplanit_prod database
   DATABASE_URL="postgresql://user:password@postgres:5432/testplanit_prod?schema=public"

   # Job queue — the shipped default points at localhost, which inside a
   # container is the container itself; use the valkey service hostname
   VALKEY_URL="valkey://valkey:6379"

   # Search — same localhost issue; use the elasticsearch service hostname
   # (leave empty to disable search if you don't run the with-elasticsearch profile)
   ELASTICSEARCH_NODE="http://elasticsearch:9200"

   # Application URL (change to your domain)
   NEXTAUTH_URL="https://yourdomain.com"

   # Generate a secure secret (run this command and paste the result)
   # openssl rand -base64 32
   NEXTAUTH_SECRET="your-generated-secret-here"

   # External file access domain (must match your public URL)
   AWS_PUBLIC_ENDPOINT_URL="https://yourdomain.com"

   # Change the default admin email and password!
   ADMIN_EMAIL=admin@example.com
   ADMIN_NAME="Administrator Account"
   ADMIN_PASSWORD=your-secure-password

   # OPTIONAL: Email settings (required for Magic Link authentication and notifications)
   EMAIL_SERVER_HOST=smtp.your-provider.com
   EMAIL_SERVER_PORT=587
   EMAIL_SERVER_USER=your-email@domain.com
   EMAIL_SERVER_PASSWORD=your-password
   EMAIL_FROM=noreply@yourdomain.com
   ```

   **Important:** `.env.example` ships with local-development values, so the connection URLs above must be changed to the Docker service hostnames as shown. The remaining variables (file storage connection, ports, feature flags) work as shipped — only modify them if you're using external services.

   ### Optional: Change External Docker Ports

   You can override host-exposed ports with `DOCKER_*_PORT` variables (for example `DOCKER_POSTGRES_PORT=5732`).

   Compose files use fallback syntax such as `${DOCKER_POSTGRES_PORT:-5432}:5432`, which means:

   - use `DOCKER_POSTGRES_PORT` when set
   - otherwise fall back to `5432`

   Important behavior:

   - `env_file:` in `docker-compose*.yml` sets runtime variables inside containers
   - it does **not** control Compose interpolation for published ports

   If you changed port values in `.env.development` or `.env.production`, run Compose with `--env-file`:

   ```bash
   # Development
   docker compose --env-file .env.development -f docker-compose.dev.yml up -d --build

   # Production
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d
   ```

   Alternatively, place the `DOCKER_*_PORT` values in a local `.env` file (auto-loaded by Compose).

   Note: this only changes external host bindings. Internal service ports stay the same (for example PostgreSQL remains `postgres:5432` inside the Docker network).

4. **Choose Your Services:**

   TestPlanIt uses Docker Compose profiles to make services optional:

   - `dev` / `prod` - Development/Production app+workers profiles (includes all dependencies)
   - `with-postgres` - PostgreSQL database
   - `with-valkey` - Valkey/Redis cache and queue
   - `with-elasticsearch` - Elasticsearch search (optional)
   - `with-minio` - RustFS file storage + Nginx

   **Quick Start Options:**

   **All Services (Full Stack):**

   ```bash
   # Development
   docker compose --profile dev up --build

   # Production
   docker compose --profile prod up
   ```

   **Selective Services:**

   ```bash
   # Development without search
   docker compose up dev workers-dev postgres valkey minio --build

   # Production with only essential services
   docker compose up prod workers postgres valkey
   ```

5. **Start the Application:**

   **Development Mode** (with hot-reload, all services):

   ```bash
   docker compose --profile dev up --build
   ```

   **Production Mode** (optimized builds, all services):

   ```bash
   docker compose --profile prod up
   ```

   **Production with External Services:**

   ```bash
   # Example: Using external database and S3, Docker for cache/search
   docker compose -f docker-compose.prod.yml \
     --profile with-valkey \
     --profile with-elasticsearch \
     up
   ```

   Production runs the prebuilt `ghcr.io/testplanit/testplanit-selfhost` images,
   which Compose pulls on the first start. Development builds its image from your
   checkout, which is what `--build` does. To build the production images from
   source instead, add `--build`; see [Build from Source](./building-from-source.md).

   To pin a release, set `TESTPLANIT_VERSION` (for example `1.1.12`) in the
   shell, the default `.env`, or `--env-file`, not `.env.production`. The default,
   `latest`, follows the newest release.

   **What Happens During Startup:**
   1. Selected services start based on profiles
   2. PostgreSQL (if included) starts and becomes healthy
   3. Other services (Valkey, Elasticsearch, RustFS file storage) start
   4. Database initialization runs (if using PostgreSQL container)
   5. Storage initialization creates the bucket (if using the bundled storage)
   6. Main application and workers start
   7. Nginx proxy becomes available (if using the bundled storage)

   **First startup takes 2-5 minutes** as images are pulled (or built) and services initialize.

6. **Access TestPlanIt:**
   - **Development** (`dev`): [http://localhost:3000](http://localhost:3000)
     - Override with `DOCKER_DEV_APP_PORT`
   - **Production** (`prod`): [http://localhost:30000](http://localhost:30000)
     - Override with `DOCKER_PROD_APP_PORT`
   - **Default login**: `admin@example.com` / `admin` (change in production!)
   - **Demo Project**: A pre-populated Demo Project is created during initial setup with sample test cases, test runs, sessions, milestones, and issues. Use the **Help menu > Start Demo Project Tour** for a guided walkthrough.

7. **Access Additional Services (if enabled):**
   - **RustFS Console** (`with-minio`): [http://localhost:9001](http://localhost:9001)
     - Override with `DOCKER_MINIO_CONSOLE_PORT`
   - **Elasticsearch** (`with-elasticsearch`): [http://localhost:9200](http://localhost:9200)
     - Override with `DOCKER_ELASTICSEARCH_HTTP_PORT`
   - **PostgreSQL** (`with-postgres`): `localhost:5432` (user: `user` / password: `password`)
     - Override with `DOCKER_POSTGRES_PORT`
   - **Valkey** (`with-valkey`): `localhost:6379`
     - Override with `DOCKER_VALKEY_PORT`

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
docker volume rm testplanit-postgres-data
docker compose up prod workers
```

### Updates & Maintenance

```bash
# Update to the latest release (or the one TESTPLANIT_VERSION pins)
git pull
docker compose --profile prod pull
docker compose --profile prod up -d

# Build the production images from source instead
docker compose --profile prod build
docker compose --profile prod up -d

# View resource usage
docker compose top
docker system df
```

If you are updating from a release that bundled MinIO, migrate your files before starting the new version. See [Migrating from MinIO to RustFS](/docs/migrating-from-minio).

### File Storage Configuration

**RustFS (Default)**:
Provides S3-compatible file storage with automatic setup. The service is named `minio` and enabled with the `with-minio` profile:

- **Internal**: `http://minio:9000` (app ↔ storage)
- **External**: `https://yourdomain.com/testplanit/...` (browser access)
- **Console**: `http://localhost:9001` (admin interface)
- **Bucket**: `testplanit` (auto-created with read-only public access)

**Nginx Reverse Proxy**:
Automatically routes `/testplanit/` requests to the storage for external file access while preserving AWS signature validation.

**Switching to AWS S3**:
To use AWS S3 instead of the bundled storage:

```bash
# In .env.production, change:
AWS_ENDPOINT_URL=""  # Empty = use AWS S3
AWS_PUBLIC_ENDPOINT_URL=""  # Empty = use AWS S3
AWS_BUCKET_NAME=your-s3-bucket-name
# Omit BOTH key lines to authenticate with the EC2 instance role instead:
# https://docs.testplanit.com/docs/file-storage#running-without-static-keys
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
```

Then restart without the `with-minio` profile:

```bash
# Production example without the bundled storage
docker compose -f docker-compose.prod.yml \
  --profile with-postgres \
  --profile with-valkey \
  --profile with-elasticsearch \
  up -d
```

## Data Management

### Data Persistence

Most service data persists in `./docker-data/`:

```text
docker-data/
├── valkey/        # Valkey job queue persistence
├── elasticsearch/ # Search indexes
└── rustfs/        # File attachments
```

Postgres is the exception: it uses the named Docker volume `testplanit-postgres-data`
instead of a bind mount. Its data directory can't live inside `./docker-data/`
(or anywhere else under the build context) — once Postgres has run, it locks the
directory down to `0700`, which makes `docker compose build` fail with a
permission error on any later build.

Postgres was also bumped from 15 to 18 in the same change, so this isn't a
straight file-copy upgrade — Postgres 18 cannot read a Postgres 15 data
directory. Existing deployments need a `pg_dump` / `pg_restore` migration
instead.

:::warning Upgrading an existing deployment

Deployments created before this change run Postgres 15 with data directly in
`docker-data/postgres/`. Dump the database **before** switching to the
updated compose files — once you do, `postgres` starts on the new image and
can no longer read the old data directory:

```bash
# 1. On the OLD stack (still Postgres 15), dump the database.
docker compose exec -T postgres pg_dump -U user -Fc -d testplanit_prod > testplanit-backup.dump
docker compose down
```

Pull the updated compose files, then bring up a fresh Postgres 18 instance and restore into it:

```bash
# 2. Bring up the new (empty) Postgres 18 named volume and restore.
docker compose up postgres -d
# wait for it to report healthy, then:
docker compose exec -T postgres pg_restore -U user -d testplanit_prod --clean --if-exists < testplanit-backup.dump

# 3. Verify the app reads the migrated data correctly, then bring up the rest.
docker compose up prod workers -d
```

Once you've confirmed the migrated data is intact, the old `docker-data/postgres/`
directory is no longer used and can be removed. It's already locked down to
`0700` by the old Postgres process, so removing it needs a root context — either
`sudo rm -rf docker-data/postgres`, or from a throwaway container that doesn't
need host-level `sudo`:

```bash
docker run --rm -v "$(pwd)/docker-data:/data" alpine rm -rf /data/postgres
```

:::

### Backup & Restore

**Create Backup:**

```bash
# Stop services
docker compose down

# Back up the bind-mounted service data
tar -czf testplanit-backup-$(date +%Y%m%d).tar.gz docker-data/

# Back up the Postgres named volume separately
docker run --rm \
  -v testplanit-postgres-data:/data \
  -v "$(pwd):/backup" \
  alpine tar -czf /backup/testplanit-postgres-backup-$(date +%Y%m%d).tar.gz -C /data .

# Restart services
docker compose up prod workers -d
```

**Restore Backup:**

```bash
# Stop and remove current data
docker compose down
sudo rm -rf docker-data/
docker volume rm testplanit-postgres-data

# Extract the bind-mounted service data
tar -xzf testplanit-backup-YYYYMMDD.tar.gz

# Restore the Postgres named volume
docker volume create testplanit-postgres-data
docker run --rm \
  -v testplanit-postgres-data:/data \
  -v "$(pwd):/backup" \
  alpine tar -xzf /backup/testplanit-postgres-backup-YYYYMMDD.tar.gz -C /data

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
docker compose up prod workers

# Minimal development (no search/files)
docker compose up dev workers-dev postgres valkey --build

# Start in background (detached)
docker compose up prod workers -d
```

**Service Profiles:**

- `dev` - Development environment with all dependencies
- `prod` - Production environment with all dependencies
- `with-postgres` - PostgreSQL database container
- `with-valkey` - Valkey/Redis cache container
- `with-elasticsearch` - Elasticsearch search container
- `with-minio` - RustFS storage + Nginx proxy containers

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

_Mixed content errors / uploads fail with "Failed to fetch":_

- **Cause**: The app generates presigned URLs using the internal storage hostname (e.g., `http://minio:9000`), which the browser cannot reach. When the page is served over HTTPS, the browser blocks the HTTP request to the internal URL.
- **Symptoms**: Browser console shows `Mixed Content: ... requested an insecure resource 'http://minio:9000/...'` and file uploads fail.
- **Fix**: Set `IS_HOSTED=true` in your `.env.production` to enable proxy mode, which routes uploads through the Next.js server instead of directly to the storage:

  ```env
  IS_HOSTED=true
  ```

_Uploads appear to work, but the file then fails with `AccessDenied` (private S3 bucket):_

- **Cause**: In direct mode the app stores the presigned URL with its signature
  stripped, so every later read is an unauthenticated request to the bucket. A
  bucket with Block Public Access enabled refuses those.
- **Symptoms**: The upload itself returns `200` and the object really is in the
  bucket, but displaying or downloading it returns
  `<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>`.
  Existing attachments stored as `/api/storage/...` keep working, which makes it
  look like only new uploads are broken.
- **Fix**: Same flag — proxy mode serves files through the application, which
  holds the credentials:

  ```env
  IS_HOSTED=true
  ```

  Keep the bucket private. The alternative, making it publicly readable, exposes
  every attachment to the internet.

  Then recreate the container: `docker compose up -d --force-recreate prod`

- **Alternative**: Set `AWS_PUBLIC_ENDPOINT_URL=https://yourdomain.com` if the storage is accessible through your reverse proxy. See [File Storage docs](/docs/file-storage#storage-modes) for details.

_403 Forbidden on file uploads:_

- **Cause**: AWS signature mismatch between app and storage
- **Fix**: Ensure `AWS_PUBLIC_ENDPOINT_URL` matches your external domain exactly
- **Check**: RustFS console at `http://localhost:9001` → bucket `testplanit` exists

_Files not displaying:_

```bash
# Test storage direct access
curl -I http://localhost:9000/testplanit/

# Test nginx proxy
curl -I http://localhost:80/testplanit/

# Check storage health
curl http://localhost:9000/health
```

_Image optimization errors:_

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
docker volume rm testplanit-postgres-data
docker compose up prod workers
```
