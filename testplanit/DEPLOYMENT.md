# TestPlanIt Deployment Guide

TestPlanIt ships with Docker Compose files that let you build and run the full stack on any server. Each deployment should build its own Docker images so that secrets, domains, and customer-specific settings stay local to that environment.

---

## 1. Prerequisites

- Docker 24+ and Docker Compose Plugin 2+
- At least 4 CPUs, 8 GB RAM, and 20 GB free disk space
- Access to the TestPlanIt source code (clone or release archive)

---

## 2. Prepare the Server

```bash
# Clone the repository (or copy a release bundle)
mkdir -p ~/testplanit && cd ~/testplanit

git clone https://github.com/testplanit/testplanit.git
cd testplanit/testplanit
```

If you are copying from a release archive, ensure the contents end up in `~/testplanit/testplanit` so the compose files work as-is.

---

## 3. Choose Your Deployment Configuration

TestPlanIt supports flexible deployment options. You can use Docker's included services or connect to external managed services.

### Option A: All-in-One Deployment (Recommended for Getting Started)

Use Docker Compose profiles to deploy all services (PostgreSQL, Valkey, Elasticsearch, MinIO) as containers:

```bash
# Deploy with all included services
docker compose -f docker-compose.prod.yml --profile with-postgres --profile with-valkey --profile with-elasticsearch --profile with-minio up -d
```

### Option B: Hybrid Deployment (Use External Services)

Mix and match Docker services with external managed services. Enable only the profiles you need:

```bash
# Example: Use external PostgreSQL and S3, but include Valkey and Elasticsearch
docker compose -f docker-compose.prod.yml --profile with-valkey --profile with-elasticsearch up -d
```

### Available Profiles

- `with-postgres` - Include PostgreSQL database container
- `with-valkey` - Include Valkey/Redis container for caching and job queues
- `with-elasticsearch` - Include Elasticsearch container for full-text search
- `with-minio` - Include MinIO container for S3-compatible file storage (also deploys nginx reverse proxy)

---

## 4. Configure Environment Variables

Create `testplanit/.env.production` with settings for your environment. Configuration varies based on which services you deploy:

### Example: All Services in Docker

```bash
# Database (Docker PostgreSQL)
DATABASE_URL="postgresql://user:password@postgres:5432/testplanit_prod?schema=public"

# Authentication
NEXTAUTH_URL="https://example.testplanit.com"
NEXTAUTH_SECRET="generate-with: openssl rand -base64 32"

# Valkey/Redis (Docker Valkey)
VALKEY_URL="valkey://valkey:6379"

# File Storage (Docker MinIO)
AWS_ACCESS_KEY_ID="minioadmin"
AWS_SECRET_ACCESS_KEY="minioadmin123"
AWS_REGION="us-east-1"
AWS_BUCKET_NAME="testplanit"
AWS_ENDPOINT_URL="http://minio:9000"
AWS_PUBLIC_ENDPOINT_URL="https://example.testplanit.com/minio"

# Search (Docker Elasticsearch)
ELASTICSEARCH_NODE="http://elasticsearch:9200"

# Application
NODE_ENV="production"
NEXT_PUBLIC_APP_URL="https://example.testplanit.com"
```

### Example: External Managed Services

```bash
# Database (External PostgreSQL - e.g., AWS RDS, Azure Database)
DATABASE_URL="postgresql://username:password@your-db-host.region.rds.amazonaws.com:5432/testplanit?schema=public"

# Authentication
NEXTAUTH_URL="https://example.testplanit.com"
NEXTAUTH_SECRET="generate-with: openssl rand -base64 32"

# Valkey/Redis (External - e.g., AWS ElastiCache, Azure Cache for Redis)
VALKEY_URL="valkey://your-redis-endpoint.cache.amazonaws.com:6379"

# File Storage (AWS S3)
AWS_ACCESS_KEY_ID="your-aws-access-key"
AWS_SECRET_ACCESS_KEY="your-aws-secret-key"
AWS_REGION="us-east-1"
AWS_BUCKET_NAME="your-bucket-name"
# Leave AWS_ENDPOINT_URL empty for AWS S3
AWS_ENDPOINT_URL=""
AWS_PUBLIC_ENDPOINT_URL=""

# Search (External Elasticsearch - e.g., AWS OpenSearch, Elastic Cloud)
ELASTICSEARCH_NODE="https://your-elasticsearch-endpoint.region.es.amazonaws.com:9200"

# Application
NODE_ENV="production"
NEXT_PUBLIC_APP_URL="https://example.testplanit.com"
```

### Tips

- Use unique values for `NEXTAUTH_SECRET` and all passwords.
- Point `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` at the hostname users will reach.
- When using external services, omit the corresponding `--profile` flag when deploying.
- See `.env.example` for detailed configuration options and examples.

---

## 5. Build and Start the Stack

From `testplanit/testplanit`:

```bash
# Build the production and worker images locally
docker compose -f docker-compose.prod.yml build

# Start with all included services (recommended for getting started)
docker compose -f docker-compose.prod.yml --profile with-postgres --profile with-valkey --profile with-elasticsearch --profile with-minio up -d

# OR start with selective services (example: only Valkey and Elasticsearch)
# docker compose -f docker-compose.prod.yml --profile with-valkey --profile with-elasticsearch up -d

# Check container status
docker compose -f docker-compose.prod.yml ps
```

Docker Compose builds the `production` and `workers` images from the local Dockerfile using your environment variables. The first build can take several minutes; subsequent builds reuse cached layers.

**Note**: If using the `with-postgres` profile, the `db-init-prod` service will automatically initialize the database schema and seed data on first run.

---

## 6. Updating an Existing Deployment

```bash
cd ~/testplanit/testplanit

git pull  # pull latest application code

# Rebuild images with the updated source
docker compose -f docker-compose.prod.yml build

# Apply the update (use the same profiles as your initial deployment)
docker compose -f docker-compose.prod.yml --profile with-postgres --profile with-valkey --profile with-elasticsearch --profile with-minio up -d
```

If you make changes to `.env.production`, restart the services afterward:

```bash
# Stop services (use the same profiles as your deployment)
docker compose -f docker-compose.prod.yml --profile with-postgres --profile with-valkey --profile with-elasticsearch --profile with-minio down

# Start services again
docker compose -f docker-compose.prod.yml --profile with-postgres --profile with-valkey --profile with-elasticsearch --profile with-minio up -d
```

---

## 7. Managing Multiple Environments

Run separate copies of the source tree per environment (e.g., `~/testplanit-prod`, `~/testplanit-customer`). Within each directory:

1. Create a dedicated `.env.production` file.
2. Adjust exposed ports in `docker-compose.prod.yml` to avoid conflicts.
3. Choose appropriate profiles based on which services each environment needs.
4. Build and run using the steps above.

Because each environment rebuilds the images locally, secrets remain isolated.

---

## 8. Common Operations

**Note**: Include the appropriate `--profile` flags with all commands based on your deployment configuration.

```bash
# Tail logs for the application
docker compose -f docker-compose.prod.yml logs -f prod

# Restart a service
docker compose -f docker-compose.prod.yml restart workers

# Stop all containers (data persisted on volumes)
# Include all profiles used in your deployment
docker compose -f docker-compose.prod.yml --profile with-postgres --profile with-valkey --profile with-elasticsearch --profile with-minio down

# Clean up volumes if you want a fresh start (DANGER: deletes data)
docker compose -f docker-compose.prod.yml --profile with-postgres --profile with-valkey --profile with-elasticsearch --profile with-minio down -v
```

---

## 9. Troubleshooting

| Symptom | Suggested Fix |
| --- | --- |
| Service not starting | Ensure you've included the correct `--profile` flags for the services you want to run. |
| `next-auth` or Prisma cannot connect to the database | Verify `DATABASE_URL` points to the correct host (either `postgres` for Docker or your external database host). If using `with-postgres` profile, check that the postgres container is healthy (`docker compose ps`). |
| Workers cannot connect to Valkey | Verify `VALKEY_URL` points to the correct host (either `valkey://valkey:6379` for Docker or your external Redis endpoint). |
| Search features not working | Verify `ELASTICSEARCH_NODE` is set correctly. If using `with-elasticsearch` profile, check that the elasticsearch container is healthy. |
| Images fail to load | Confirm `AWS_ENDPOINT_URL` and `AWS_PUBLIC_ENDPOINT_URL` are configured correctly. If using `with-minio` profile, ensure MinIO and nginx containers are running. |
| Port already in use | Update the port mappings in `docker-compose.prod.yml` (for example `30001:3000`) and restart. |
| Containers exit during start | Check logs with `docker compose logs --tail=100 <service>` for the failing service. |
| Cannot connect to external service | Ensure the application containers can reach external services (check network connectivity, security groups, firewalls). |

---

## 10. Deployment Scenarios

### Scenario 1: Full Self-Hosted (Small Team)

Best for: Small teams, development/staging environments, on-premise deployments

```bash
# Use all Docker services
docker compose -f docker-compose.prod.yml --profile with-postgres --profile with-valkey --profile with-elasticsearch --profile with-minio up -d
```

### Scenario 2: Managed Database + Self-Hosted Cache (Medium Team)

Best for: Teams wanting managed database but self-hosted caching and search

```bash
# Use external PostgreSQL (e.g., AWS RDS), but Docker for other services
docker compose -f docker-compose.prod.yml --profile with-valkey --profile with-elasticsearch --profile with-minio up -d
```

Configure `.env.production`:
```bash
DATABASE_URL="postgresql://user:pass@your-rds-endpoint.amazonaws.com:5432/testplanit?schema=public"
```

### Scenario 3: Fully Managed Services (Large Team/Production)

Best for: Large teams, high-availability production environments

```bash
# Only run the application, all services are external
docker compose -f docker-compose.prod.yml up -d
```

Configure `.env.production`:
```bash
DATABASE_URL="postgresql://user:pass@your-rds-endpoint.amazonaws.com:5432/testplanit?schema=public"
VALKEY_URL="valkey://your-elasticache-endpoint.cache.amazonaws.com:6379"
ELASTICSEARCH_NODE="https://your-opensearch-endpoint.es.amazonaws.com:9200"
AWS_ACCESS_KEY_ID="your-aws-key"
AWS_SECRET_ACCESS_KEY="your-aws-secret"
AWS_BUCKET_NAME="your-s3-bucket"
# Leave AWS_ENDPOINT_URL empty for AWS S3
```

---

## 11. Security Checklist

- Rotate all default passwords and secrets before exposing services publicly.
- Configure HTTPS in front of the services (e.g., via a reverse proxy such as Nginx/OpenResty, Traefik, or an external load balancer).
- When using external managed services, use IAM roles or service principals instead of hardcoded credentials when possible.
- Restrict access to the Docker host and secure SSH authentication.
- Enable VPC security groups or firewall rules to restrict access to services.
- Schedule regular updates (`git pull`, rebuild, redeploy) to stay current with security fixes.
- Regularly backup your database and file storage.

---

## 12. Need Help?

1. Examine container logs with `docker compose logs`.
2. Verify you're using the correct profiles for your deployment scenario.
3. Review health of dependencies - both Docker services and external services.
4. Rebuild images if you change environment variables or dependencies.
5. Reach out to the TestPlanIt team with the log output when requesting support.
