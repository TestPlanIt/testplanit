---
sidebar_position: 8
---

# Background Processes

TestPlanit uses several background workers and scheduled jobs to handle asynchronous tasks and improve application performance. This document explains how to set up and manage these processes.

## Overview

The application uses the following background processes:

1. **Notification Worker** - Handles creating notifications and sending notification emails
2. **Email Worker** - Processes email sending tasks
3. **Forecast Worker** - Updates test case forecasting data
4. **Sync Worker** - Synchronizes issues with external integrations
5. **Testmo Import Worker** - Processes large Testmo JSON imports
6. **Elasticsearch Reindex Worker** - Reindexes entities for search functionality
7. **Auto Tag Worker** - Runs AI-powered automatic tagging on test cases and other entities
8. **Audit Log Worker** - Persists audit log entries for user and system actions
9. **Budget Alert Worker** - Checks and sends alerts for AI model budget thresholds
10. **Repo Cache Worker** - Automatically refreshes expired code repository caches for QuickScript
11. **Magic Select Worker** - Processes AI-powered test case selection jobs for test runs
12. **Webhook Dispatch Worker** - Delivers outbound webhooks to subscribed external endpoints
13. **Webhook Outbox Worker** - Polls the outbox table and fans events out to webhook configs
14. **Webhook Retention Worker** - Daily purge of webhook delivery / dedup / outbox rows older than 30 days
15. **DataChangeLog Retention Worker** - Daily purge of processed audit change-capture rows older than 30 days
16. **Scheduler** - Sets up recurring jobs (cron jobs)

## Workers

### Notification Worker

- Creates in-app notifications
- Sends immediate notification emails
- Processes daily digest emails (scheduled at 8 AM daily)
- Default concurrency: 5 (lightweight operations)
- Location: `workers/notificationWorker.ts`

### Email Worker

- Handles all email sending operations
- Processes email queue jobs
- Default concurrency: 3 (I/O-intensive)
- Location: `workers/emailWorker.ts`

### Forecast Worker

- Updates forecasting data for test cases
- Runs scheduled updates (3 AM daily)
- Default concurrency: 5 (CPU-intensive but parallelizable)
- Location: `workers/forecastWorker.ts`

### Sync Worker

- Synchronizes issues with external integrations (Jira, Linear, etc.)
- Handles individual issue refreshes and bulk project syncs
- Default concurrency: 2 (I/O-intensive, API rate-limited)
- Location: `workers/syncWorker.ts`

### Testmo Import Worker

- Processes large Testmo JSON export files
- Imports test cases, runs, and related data
- Default concurrency: 1 (memory-intensive operations)
- Location: `workers/testmoImportWorker.ts`

### Elasticsearch Reindex Worker

- Reindexes entities into Elasticsearch for search functionality
- Handles full and partial reindexing operations
- Processes batches of documents for efficient indexing
- Default concurrency: 2 (I/O-intensive, balanced for ES performance)
- Location: `workers/elasticsearchReindexWorker.ts`

**Supported Operations:**

- Full reindex of all entities
- Selective reindex by entity type (repository-cases, test-runs, sessions, etc.)
- Project-specific reindexing
- Batch processing with configurable batch sizes

### Auto Tag Worker

- Runs AI-powered automatic tagging on test cases and other entities
- Processes tagging jobs triggered by content changes
- Default concurrency: 3 (one per entity type)
- Location: `workers/autoTagWorker.ts`

### Audit Log Worker

- Persists audit log entries for user and system actions
- High throughput, independent operations
- Default concurrency: 10 (lightweight, independent writes)
- Also runs the CDC correlation loop (Loop B): drains each database's `DataChangeLog` into the readable `AuditLog`; in multi-tenant mode it polls every configured tenant per cycle, re-reading the tenant list so runtime additions are picked up
- Location: `workers/auditLogWorker.ts`

### Budget Alert Worker

- Checks AI model budget thresholds and sends alerts
- Default concurrency: 2
- Location: `workers/budgetAlertWorker.ts`

### Repo Cache Worker

- Automatically refreshes expired code repository caches used by QuickScript AI generation
- Runs a daily sweep (4 AM) to find configs with expired or missing caches and re-fetches from git
- Only refreshes caches that have actually expired — configs with valid caches are skipped
- Default concurrency: 1 (serial processing to avoid hammering git provider APIs)
- Location: `workers/repoCacheWorker.ts`

### Magic Select Worker

- Processes AI-powered test case selection (Magic Select) jobs in the background
- Analyzes test cases against test run metadata using LLM batching
- Reports batch progress and tracks truncated responses per batch
- Default concurrency: 1 (each job involves multiple LLM batch calls)
- Location: `workers/magicSelectWorker.ts`

### Webhook Dispatch Worker

- Consumes the `webhook-dispatch` BullMQ queue and POSTs each event to its subscribed endpoints
- Honors per-config retry curve (0s, 30s, 5m, 30m, 2h, 6h, 12h) and writes a `WebhookDelivery` row per attempt
- Caps response-body buffering to prevent a misbehaving consumer from exhausting worker memory
- Default concurrency: 5 (overridable via `WEBHOOK_DISPATCH_CONCURRENCY`)
- Location: `workers/webhookDispatchWorker.ts`

### Webhook Outbox Worker

- Polls `WebhookOutboxEvent` every 2s using `FOR UPDATE SKIP LOCKED` and fans matched events into the dispatch queue
- Multi-tenant aware: in `MULTI_TENANT_MODE=true` it iterates every configured tenant per cycle and stamps `tenantId` onto each enqueued dispatch job
- Multiple replicas can run concurrently without double-claiming
- Location: `workers/webhookOutboxWorker.ts`

### Webhook Retention Worker

- Wakes once per day and purges `WebhookDelivery`, `WebhookEventDedup`, and dispatched `WebhookOutboxEvent` rows older than 30 days
- Multi-tenant aware: runs the purge against every configured tenant database per cycle and emits one audit row per (tenant, run)
- Batched `LIMIT 1000` deletes to avoid lock contention
- Location: `workers/webhookRetentionWorker.ts`

### DataChangeLog Retention Worker

- Wakes once per day and batch-deletes processed `DataChangeLog` rows (the audit change-capture substrate) older than 30 days
- Never deletes unprocessed rows — the audit log worker must correlate them into `AuditLog` first; the append-only enforcement triggers (`tpl_dcl_no_delete` / `tpl_dcl_no_update`) enforce this at the database level too
- Batched `LIMIT 1000` deletes to avoid lock contention with the capture path; emits one `DCL_RETENTION_PURGED` audit event per run
- Multi-tenant aware: runs the purge against every configured tenant database per cycle and emits one audit row per (tenant, run)
- Standalone daily loop (no BullMQ queue) — self-schedules internally rather than via the scheduler
- Location: `workers/dataChangeLogRetentionWorker.ts`

### Scheduler

- Sets up recurring jobs using cron patterns
- Configures daily digest emails (8 AM)
- Configures forecast updates (3 AM)
- Configures code repository cache refresh (4 AM)
- Location: `scheduler.ts`

## Running Workers

### Development Mode

For development, you can run workers in the foreground:

```bash
# Run all workers together (foreground)
pnpm start:workers

# Or run individual workers
pnpm worker:notification
pnpm worker:email
pnpm worker:forecast

# Run scheduler separately
pnpm scheduler
```

### Production Mode (Background Processes)

For production environments, use PM2 to run workers as background daemons:

#### Start all workers

```bash
pnpm pm2:start
```

This command:

1. Runs the scheduler once to set up cron jobs
2. Starts all three workers as background processes
3. Automatically restarts workers if they crash

#### Stop all workers

```bash
pnpm pm2:stop
```

#### Restart all workers

```bash
pnpm pm2:restart
```

#### Check worker status

```bash
pnpm pm2:status
```

#### View worker logs

```bash
pnpm pm2:logs

# View logs for specific worker
pm2 logs notification-worker
pm2 logs email-worker
pm2 logs forecast-worker
```

#### Remove all workers from PM2

```bash
pnpm pm2:delete
```

## PM2 Configuration

The PM2 configuration is defined in `ecosystem.config.js`. Each worker is configured with:

- Automatic restart on failure
- Per-worker `max_memory_restart` and `--max-old-space-size` tuned to that worker's footprint
- Production environment variables

### Worker memory tiers

Most workers run with a 512 MB `max_memory_restart` ceiling and a 384 MB old-space limit, which is sufficient for lightweight queue consumers. The following workers run with elevated ceilings because they load a heavier dependency tree at idle and/or carry larger payloads:

| Worker | `max_memory_restart` | `--max-old-space-size` | Why |
| --- | --- | --- | --- |
| Sync Worker | 1G | 768M | Loads integration adapters + Elasticsearch sync extensions |
| Testmo Import Worker | 4G (configurable) | 3072M (configurable) | Streams and analyzes multi-GB Testmo JSON exports; the default 512 MB tier OOM-killed large imports. Override both via `TESTMO_IMPORT_MAX_MEMORY_RESTART` and `TESTMO_IMPORT_MAX_OLD_SPACE_MB` for very large exports (e.g. `18G` / `16384`), host RAM permitting |
| Forecast Worker | 2G | 1536M | Recomputes run/case forecasts over large historical result sets; the default 512 MB tier was OOM-killed under production data volumes |
| Elasticsearch Reindex Worker | 2G (configurable) | 1536M (configurable) | A full reindex sweeps every project's cases/runs/sessions/issues/milestones and bulk-loads them into Elasticsearch; the default 512 MB tier OOM-killed full-DB reindexes mid-job — PM2 SIGKILLs the worker, BullMQ redelivers the same job, and it restarts from the top, so runs never finish indexing. Override both via `ELASTICSEARCH_REINDEX_MAX_MEMORY_RESTART` and `ELASTICSEARCH_REINDEX_MAX_OLD_SPACE_MB` for very large tenants (many projects / large run history), host RAM permitting |
| SCIM Access Recompute Worker | 2G | 1536M | Loads the full ZenStack runtime to recompute `User.access` tiers from IdP group mappings; boots to ~1.4 GB RSS at idle, so the default 512 MB tier triggered a tight PM2 SIGINT/restart loop rather than a real OOM |
| Audit Log Worker | 3G | 2304M | The CDC correlation loop (Loop B) caches one raw Prisma client per tenant in multi-tenant mode — one Rust query engine per tenant, the same per-tenant footprint as the webhook outbox worker. Harmless headroom in single-tenant mode (a single client). |
| Webhook Dispatch Worker | 3G | 2304M | Loads ZenStack runtime + ES sync services + audit log service; carries full `test_run.completed` payloads under concurrency=5; observed steady-state RSS in multi-tenant clusters sits near 1.9 GB |
| Webhook Outbox Worker | 3G | 2304M | Same heavy dependency tree as dispatch; caches one Prisma client per tenant in multi-tenant mode |
| Webhook Retention Worker | 3G | 2304M | Iterates every tenant's database per pass; headroom protects against batched-delete loops on tenants with large retention backlogs. Tenant Prisma clients are disconnected after each pass to release Rust query engine buffers, so steady-state should drop substantially after the first few passes — these ceilings can be lowered once production telemetry confirms it. |
| DataChangeLog Retention Worker | 3G | 2304M | Loads the audit log service plus the raw Prisma base client and runs a batched-delete loop over the high-volume change-capture table; headroom mirrors the webhook retention worker so a large purge backlog (e.g. after a heavy import) does not trip the ceiling mid-pass. |

## Persistence Across Reboots

To ensure workers start automatically after server reboots:

1. Save the current PM2 process list:

   ```bash
   pm2 save
   ```

2. Generate startup script:

   ```bash
   pm2 startup
   ```

   Follow the instructions provided by this command.

## Prerequisites

All workers require:

- Valkey server running (for BullMQ job queues)
- PostgreSQL database configured
- Environment variables properly set

## Monitoring

You can monitor worker health and performance using:

1. **PM2 Monitoring**

   ```bash
   pm2 monit
   ```

2. **PM2 Web Dashboard** (optional)

   ```bash
   pm2 install pm2-web
   ```

3. **Application Logs**
   - Workers log to PM2 logs
   - Check `pm2 logs` for detailed output

## Troubleshooting

### Workers not starting

- Check Valkey connection: Ensure Valkey server is running
- Verify database connection: Check PostgreSQL credentials
- Review logs: `pnpm pm2:logs`

### Jobs not processing

- Check queue health in Valkey
- Verify worker is running: `pnpm pm2:status`
- Check for errors in worker logs

### Memory issues

- Most workers run with a 512 MB ceiling; the sync worker runs with a 1 GB ceiling; the forecast, SCIM access recompute, and Elasticsearch reindex workers run with a 2 GB ceiling; the audit log worker, the three webhook workers (dispatch, outbox, retention), and the DataChangeLog retention worker run with a 3 GB ceiling. See the **Worker memory tiers** table above for the rationale on each elevated tier.
- If a worker is being killed and restarted by PM2 in a tight loop (visible as repeated `restart` events in `pm2 status`), raise `max_memory_restart` and `--max-old-space-size` in `ecosystem.config.js` for that worker before assuming there is a real leak.
- Monitor with `pm2 monit`

## Environment Variables

Workers use the same environment variables as the main application. Ensure these are set:

- `DATABASE_URL` - PostgreSQL connection string
- `VALKEY_URL` - Valkey connection string
- `AWS_*` - AWS credentials for file storage
- `EMAIL_*` - Email service configuration

## Configuring Worker Concurrency

Worker concurrency controls how many jobs each worker processes simultaneously. Higher concurrency can improve throughput on powerful machines but increases CPU and memory usage.

### Available Concurrency Settings

You can configure concurrency for each worker using environment variables:

```bash
# Testmo Import Worker (memory-intensive, default: 1)
# Keep this low (1-2) as imports consume significant memory
TESTMO_IMPORT_CONCURRENCY=1

# Testmo Import Worker memory ceiling (defaults: 4G restart / 3072 MB heap).
# Raise both for very large multi-GB exports, host RAM permitting.
# TESTMO_IMPORT_MAX_MEMORY_RESTART=18G
# TESTMO_IMPORT_MAX_OLD_SPACE_MB=16384

# Sync Worker (I/O-intensive, API rate-limited, default: 2)
# Moderate values (2-5) work well for external API calls
SYNC_CONCURRENCY=2

# Email Worker (I/O-intensive, default: 3)
# Can handle moderate concurrency (3-10) for email sending
EMAIL_CONCURRENCY=3

# Auto Tag Worker (default: 3)
# One per entity type; increase cautiously as AI calls are expensive
AUTO_TAG_CONCURRENCY=3

# Notification Worker (lightweight operations, default: 5)
# Can handle higher concurrency (5-20) for lightweight tasks
NOTIFICATION_CONCURRENCY=5

# Forecast Worker (CPU-intensive but parallelizable, default: 5)
# Set based on available CPU cores, typically 1-2x CPU count
FORECAST_CONCURRENCY=5

# Budget Alert Worker (default: 2)
BUDGET_ALERT_CONCURRENCY=2

# Elasticsearch Reindex Worker (I/O-intensive, default: 2)
# Balanced for Elasticsearch performance; increase for faster reindexing
ELASTICSEARCH_REINDEX_CONCURRENCY=2

# Elasticsearch Reindex Worker memory ceiling (defaults: 2G restart / 1536 MB heap).
# Raise both for very large tenants (many projects / large run history), host RAM permitting.
# ELASTICSEARCH_REINDEX_MAX_MEMORY_RESTART=4G
# ELASTICSEARCH_REINDEX_MAX_OLD_SPACE_MB=3072

# Audit Log Worker (lightweight independent writes, default: 10)
# Can safely be set higher on powerful machines
AUDIT_LOG_CONCURRENCY=10

# Webhook Dispatch Worker (I/O-intensive, default: 5)
# Each job POSTs to one external endpoint with a 10s timeout; raise on
# beefier hosts, lower if external endpoints are slow or rate-limited
WEBHOOK_DISPATCH_CONCURRENCY=5
```

### Setting Concurrency Values

Add the desired concurrency values to your `.env` file:

```bash
# Example: High-performance server configuration
FORECAST_CONCURRENCY=10
NOTIFICATION_CONCURRENCY=10
EMAIL_CONCURRENCY=5
SYNC_CONCURRENCY=3
TESTMO_IMPORT_CONCURRENCY=2
```

```bash
# Example: Low-resource server configuration
FORECAST_CONCURRENCY=2
NOTIFICATION_CONCURRENCY=3
EMAIL_CONCURRENCY=2
SYNC_CONCURRENCY=1
TESTMO_IMPORT_CONCURRENCY=1
```

### Applying Changes

After updating concurrency settings in `.env`:

1. **Restart workers** for changes to take effect:

   ```bash
   pnpm pm2:restart
   ```

2. **Verify settings** in the Admin UI:
   - Navigate to **Admin > Job Queues**
   - Check the "Concurrency" column to confirm new values

### Recommendations

- **Start with defaults** and monitor performance
- **Monitor resource usage** (CPU, memory, database connections)
- **Consider your workload**:
  - High-volume test imports: Increase `FORECAST_CONCURRENCY`
  - Frequent email notifications: Increase `EMAIL_CONCURRENCY` and `NOTIFICATION_CONCURRENCY`
  - Many external integrations: Increase `SYNC_CONCURRENCY` (but respect API rate limits)
- **Database connection pool**: Ensure your database can handle `sum(all concurrency values) + web server connections`
- **Memory limits**: Each concurrent Testmo import can use 500MB-1GB of memory

### Monitoring

Check worker performance and queue health:

```bash
# View real-time worker status
pm2 monit

# Check queue statistics
pnpm pm2:logs

# Admin UI monitoring
# Navigate to Admin > Job Queues for live queue statistics
```

## Security Considerations

- Workers run with the same permissions as the Node.js process
- Ensure proper file permissions on production servers
- Keep PM2 and dependencies updated
- Monitor worker logs for suspicious activity