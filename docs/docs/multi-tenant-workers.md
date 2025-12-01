---
sidebar_position: 9
---

# Multi-Tenant Worker Deployment

TestPlanIt supports a multi-tenant architecture where a single shared worker container can process jobs for multiple production instances. This is useful for reducing infrastructure costs while maintaining data isolation between tenants.

## Overview

In multi-tenant mode:

- **Web Application Instances**: Each tenant runs their own web application container with their own database
- **Shared Workers**: A single worker container processes background jobs for all tenants
- **Job Isolation**: Jobs include a `tenantId` field to ensure data isolation
- **Admin UI Filtering**: The job queue admin UI only shows jobs for the current tenant

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Tenant A      │     │   Tenant B      │     │   Tenant C      │
│   Web App       │     │   Web App       │     │   Web App       │
│   (Database A)  │     │   (Database B)  │     │   (Database C)  │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │                       │                       │
         └───────────────┬───────┴───────────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │   Shared Valkey     │
              │   (Job Queue)       │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │   Shared Workers    │
              │   (Multi-tenant)    │
              └─────────────────────┘
```

## Configuration

### Web Application Instances

Each web application instance needs to set its tenant ID:

```bash
# .env for Tenant A web app
INSTANCE_TENANT_ID="tenant-a"
DATABASE_URL="postgresql://user:pass@host:5432/tenant_a_db"
VALKEY_URL="valkey://shared-valkey:6379"
```

```bash
# .env for Tenant B web app
INSTANCE_TENANT_ID="tenant-b"
DATABASE_URL="postgresql://user:pass@host:5432/tenant_b_db"
VALKEY_URL="valkey://shared-valkey:6379"
```

### Shared Worker Container

The worker container requires multi-tenant mode enabled and tenant configurations:

```bash
# .env for shared workers
MULTI_TENANT_MODE="true"
VALKEY_URL="valkey://shared-valkey:6379"

# Option 1: JSON configuration
TENANT_CONFIGS='{
  "tenant-a": {
    "databaseUrl": "postgresql://user:pass@host:5432/tenant_a_db",
    "elasticsearchNode": "http://elasticsearch:9200",
    "elasticsearchIndex": "tenant_a"
  },
  "tenant-b": {
    "databaseUrl": "postgresql://user:pass@host:5432/tenant_b_db",
    "elasticsearchNode": "http://elasticsearch:9200",
    "elasticsearchIndex": "tenant_b"
  }
}'

# Option 2: Individual environment variables
TENANT_TENANT_A_DATABASE_URL="postgresql://user:pass@host:5432/tenant_a_db"
TENANT_TENANT_A_ELASTICSEARCH_NODE="http://elasticsearch:9200"
TENANT_TENANT_A_ELASTICSEARCH_INDEX="tenant_a"

TENANT_TENANT_B_DATABASE_URL="postgresql://user:pass@host:5432/tenant_b_db"
TENANT_TENANT_B_ELASTICSEARCH_NODE="http://elasticsearch:9200"
TENANT_TENANT_B_ELASTICSEARCH_INDEX="tenant_b"
```

## Environment Variables Reference

### Web Application Instance

| Variable | Description | Required |
|----------|-------------|----------|
| `INSTANCE_TENANT_ID` | Unique identifier for this tenant instance | Yes (multi-tenant) |
| `DATABASE_URL` | PostgreSQL connection string for this tenant | Yes |
| `VALKEY_URL` | Shared Valkey/Redis connection string | Yes |

### Worker Container

| Variable | Description | Required |
|----------|-------------|----------|
| `MULTI_TENANT_MODE` | Set to `"true"` to enable multi-tenant mode | Yes |
| `VALKEY_URL` | Shared Valkey/Redis connection string | Yes |
| `TENANT_CONFIGS` | JSON object with tenant configurations | One of these |
| `TENANT_<ID>_DATABASE_URL` | Database URL for tenant `<ID>` | One of these |
| `TENANT_<ID>_ELASTICSEARCH_NODE` | Elasticsearch URL for tenant | Optional |
| `TENANT_<ID>_ELASTICSEARCH_INDEX` | Elasticsearch index prefix | Optional |

## Scheduler Configuration

The scheduler automatically creates jobs for each tenant in multi-tenant mode:

```bash
# Run scheduler with multi-tenant config
MULTI_TENANT_MODE="true" \
TENANT_CONFIGS='{"tenant-a": {...}, "tenant-b": {...}}' \
pnpm scheduler
```

This creates separate scheduled jobs per tenant:
- `update-all-cases-forecast-tenant-a`
- `update-all-cases-forecast-tenant-b`
- `send-daily-digest-tenant-a`
- `send-daily-digest-tenant-b`

## Job Queue Admin UI

In multi-tenant mode, the Admin > Job Queues page automatically filters:
- **Job counts** show only jobs for the current tenant
- **Job list** shows only jobs belonging to the current tenant
- **Job actions** (retry, remove, etc.) are restricted to the current tenant's jobs

This prevents cross-tenant data leakage in the admin interface.

## Supported Workers

All workers support multi-tenant mode:

| Worker | Multi-tenant | Notes |
|--------|--------------|-------|
| Notification Worker | Yes | Creates tenant-specific notifications |
| Email Worker | Yes | Sends emails for correct tenant |
| Forecast Worker | Yes | Updates forecasts per tenant database |
| Sync Worker | Yes | Syncs issues to correct tenant database |
| Elasticsearch Reindex Worker | Yes | Indexes to tenant-specific ES index |
| Testmo Import Worker | Partial | Memory-intensive; consider per-tenant deployment |

### Testmo Import Worker Note

The Testmo Import Worker is memory-intensive and processes large JSON files. In multi-tenant deployments:
- Consider running separate import workers per tenant if imports are frequent
- Set `TESTMO_IMPORT_CONCURRENCY=1` to limit memory usage
- Monitor memory during large imports

## Docker Compose Example

```yaml
version: '3.8'

services:
  # Shared infrastructure
  valkey:
    image: valkey/valkey:8
    volumes:
      - valkey_data:/data

  # Tenant A web app
  tenant-a-web:
    image: testplanit/testplanit:latest
    environment:
      - INSTANCE_TENANT_ID=tenant-a
      - DATABASE_URL=postgresql://user:pass@tenant-a-db:5432/testplanit
      - VALKEY_URL=valkey://valkey:6379

  # Tenant B web app
  tenant-b-web:
    image: testplanit/testplanit:latest
    environment:
      - INSTANCE_TENANT_ID=tenant-b
      - DATABASE_URL=postgresql://user:pass@tenant-b-db:5432/testplanit
      - VALKEY_URL=valkey://valkey:6379

  # Shared workers
  workers:
    image: testplanit/testplanit:latest
    command: pnpm pm2:start --no-daemon
    environment:
      - MULTI_TENANT_MODE=true
      - VALKEY_URL=valkey://valkey:6379
      - TENANT_CONFIGS={"tenant-a":{"databaseUrl":"postgresql://user:pass@tenant-a-db:5432/testplanit"},"tenant-b":{"databaseUrl":"postgresql://user:pass@tenant-b-db:5432/testplanit"}}

volumes:
  valkey_data:
```

## Monitoring

### Worker Logs

Workers log tenant information for each job:

```
Processing sync job 123 of type sync-issues for tenant tenant-a
Processing notification job 456 of type create-notification for tenant tenant-b
```

### PM2 Monitoring

```bash
# View all worker logs
pm2 logs

# Filter by tenant in logs
pm2 logs | grep "tenant-a"
```

### Admin UI

Each tenant's admin UI shows:
- Job counts for their tenant only
- Job details and logs for their jobs
- No visibility into other tenants' jobs

## Troubleshooting

### Jobs not processing

1. Verify `MULTI_TENANT_MODE=true` on workers
2. Check tenant configuration is loaded:
   ```bash
   # Worker startup should log:
   # "Loaded 2 tenant configurations from TENANT_CONFIGS"
   ```
3. Verify job data includes `tenantId`

### Missing tenant configuration

```
Error: No configuration found for tenant: tenant-x
```

Add the missing tenant to `TENANT_CONFIGS` or create environment variables:
```bash
TENANT_TENANT_X_DATABASE_URL="postgresql://..."
```

### Jobs visible across tenants

Ensure web apps have `INSTANCE_TENANT_ID` set correctly. Jobs created without `tenantId` won't be filtered.

### Database connection errors

Each tenant database URL must be accessible from the worker container. Verify network connectivity and credentials.

## Security Considerations

1. **Database Isolation**: Each tenant has a separate database; workers connect dynamically based on job data
2. **Job Data**: The `tenantId` in job data determines which database is used; tampering could cause cross-tenant access
3. **Network Security**: Ensure worker container can only reach authorized tenant databases
4. **Credentials**: Use separate database credentials per tenant when possible
5. **Valkey Security**: Use authentication on shared Valkey instance

## Migration from Single-Tenant

To migrate an existing single-tenant deployment to multi-tenant:

1. **Assign Tenant ID**: Set `INSTANCE_TENANT_ID` on web app
2. **Update Workers**: Configure `MULTI_TENANT_MODE=true` and tenant configs
3. **Rerun Scheduler**: Clear old scheduled jobs and run scheduler with multi-tenant config
4. **Existing Jobs**: Jobs without `tenantId` will fail in multi-tenant mode; let them complete or remove them first

## Performance Considerations

- **Connection Pooling**: Each tenant gets a separate Prisma client; monitor total database connections
- **Memory**: Multiple Prisma clients increase memory usage; plan accordingly
- **Scheduler**: More tenants = more scheduled jobs; stagger schedules if needed
- **Queue Depth**: Monitor queue depth per tenant to identify bottlenecks
