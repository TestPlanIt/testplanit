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
7. **Scheduler** - Sets up recurring jobs (cron jobs)

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

### Scheduler

- Sets up recurring jobs using cron patterns
- Configures daily digest emails (8 AM)
- Configures forecast updates (3 AM)
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
- Memory limit of 1GB
- Production environment variables

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

- Workers are configured with 1GB memory limit
- Adjust in `ecosystem.config.js` if needed
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

# Sync Worker (I/O-intensive, API rate-limited, default: 2)
# Moderate values (2-5) work well for external API calls
SYNC_CONCURRENCY=2

# Email Worker (I/O-intensive, default: 3)
# Can handle moderate concurrency (3-10) for email sending
EMAIL_CONCURRENCY=3

# Notification Worker (lightweight operations, default: 5)
# Can handle higher concurrency (5-20) for lightweight tasks
NOTIFICATION_CONCURRENCY=5

# Forecast Worker (CPU-intensive but parallelizable, default: 5)
# Set based on available CPU cores, typically 1-2x CPU count
FORECAST_CONCURRENCY=5
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