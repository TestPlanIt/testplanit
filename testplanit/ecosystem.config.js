// Use compiled JavaScript in production, tsx in development
const isDev = process.env.NODE_ENV !== "production";

module.exports = {
  apps: [
    {
      name: "scheduler",
      script: isDev ? "tsx" : "node",
      args: isDev ? "scheduler.ts" : "dist/scheduler.js",
      instances: 1,
      autorestart: false,
      watch: false,
      max_memory_restart: "512M",
      node_args: "--max-old-space-size=384",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "notification-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/notificationWorker.ts"
        : "dist/workers/notificationWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      node_args: "--max-old-space-size=384",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "email-worker",
      script: isDev ? "tsx" : "node",
      args: isDev ? "workers/emailWorker.ts" : "dist/workers/emailWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      node_args: "--max-old-space-size=384",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "forecast-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/forecastWorker.ts"
        : "dist/workers/forecastWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      node_args: "--max-old-space-size=1536",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "testmo-import-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/testmoImportWorker.ts"
        : "dist/workers/testmoImportWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      // Large Testmo exports (multi-GB JSON) are streamed and analyzed here, so
      // this worker needs far more headroom than the 512M default that
      // OOM-killed big imports. Defaults to a 4G ceiling, which handles typical
      // large exports on a modest host; installs that import very large exports
      // can raise both values via env (host RAM permitting), e.g.
      // TESTMO_IMPORT_MAX_MEMORY_RESTART=18G TESTMO_IMPORT_MAX_OLD_SPACE_MB=16384.
      max_memory_restart: process.env.TESTMO_IMPORT_MAX_MEMORY_RESTART || "4G",
      node_args: `--max-old-space-size=${
        process.env.TESTMO_IMPORT_MAX_OLD_SPACE_MB || "3072"
      }`,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "sync-worker",
      script: isDev ? "tsx" : "node",
      args: isDev ? "workers/syncWorker.ts" : "dist/workers/syncWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      node_args: "--max-old-space-size=768",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "elasticsearch-reindex-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/elasticsearchReindexWorker.ts"
        : "dist/workers/elasticsearchReindexWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      // A full reindex sweeps every project's cases/runs/sessions/issues and
      // bulk-loads them into Elasticsearch, so this worker needs far more
      // headroom than the 512M default that OOM-killed full-DB reindexes: PM2
      // SIGKILLs the worker mid-job, BullMQ redelivers the same job, and it
      // restarts from the top — never finishing. Defaults to a 2G ceiling
      // (matching the forecast worker's full-history sweeps); very large tenants
      // can raise both via env (host RAM permitting), e.g.
      // ELASTICSEARCH_REINDEX_MAX_MEMORY_RESTART=4G ELASTICSEARCH_REINDEX_MAX_OLD_SPACE_MB=3072.
      max_memory_restart:
        process.env.ELASTICSEARCH_REINDEX_MAX_MEMORY_RESTART || "2G",
      node_args: `--max-old-space-size=${
        process.env.ELASTICSEARCH_REINDEX_MAX_OLD_SPACE_MB || "1536"
      }`,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "audit-log-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/auditLogWorker.ts"
        : "dist/workers/auditLogWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      // CDC correlation (Loop B) caches one raw Prisma client per tenant in
      // multi-tenant mode (one Rust query engine each), the same per-tenant-client
      // footprint as the webhook outbox worker — so it shares that 3G tier. The
      // ceiling is harmless headroom in single-tenant mode (one client).
      max_memory_restart: "3G",
      node_args: "--max-old-space-size=2304",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "budget-alert-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/budgetAlertWorker.ts"
        : "dist/workers/budgetAlertWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      node_args: "--max-old-space-size=384",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "auto-tag-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/autoTagWorker.ts"
        : "dist/workers/autoTagWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      node_args: "--max-old-space-size=384",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "derive-case-steps-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/deriveCaseStepsWorker.ts"
        : "dist/workers/deriveCaseStepsWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      node_args: "--max-old-space-size=384",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "repo-cache-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/repoCacheWorker.ts"
        : "dist/workers/repoCacheWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      node_args: "--max-old-space-size=384",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "copy-move-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/copyMoveWorker.ts"
        : "dist/workers/copyMoveWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      node_args: "--max-old-space-size=384",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "duplicate-scan-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/duplicateScanWorker.ts"
        : "dist/workers/duplicateScanWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      node_args: "--max-old-space-size=384",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "magic-select-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/magicSelectWorker.ts"
        : "dist/workers/magicSelectWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      node_args: "--max-old-space-size=384",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "step-scan-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/stepSequenceScanWorker.ts"
        : "dist/workers/stepSequenceScanWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      node_args: "--max-old-space-size=384",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "generate-from-url-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/generateFromUrlWorker.ts"
        : "dist/workers/generateFromUrlWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      node_args: "--max-old-space-size=384",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "iteration-generation-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/iterationGenerationWorker.ts"
        : "dist/workers/iterationGenerationWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      node_args: "--max-old-space-size=384",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "scim-access-recompute-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/scimAccessRecomputeWorker.ts"
        : "dist/workers/scimAccessRecomputeWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      node_args: "--max-old-space-size=1536",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "webhook-dispatch-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/webhookDispatchWorker.ts"
        : "dist/workers/webhookDispatchWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "3G",
      node_args: "--max-old-space-size=2304",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "webhook-outbox-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/webhookOutboxWorker.ts"
        : "dist/workers/webhookOutboxWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "3G",
      node_args: "--max-old-space-size=2304",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "webhook-retention-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/webhookRetentionWorker.ts"
        : "dist/workers/webhookRetentionWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "3G",
      node_args: "--max-old-space-size=2304",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "dcl-retention-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/dataChangeLogRetentionWorker.ts"
        : "dist/workers/dataChangeLogRetentionWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "3G",
      node_args: "--max-old-space-size=2304",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
