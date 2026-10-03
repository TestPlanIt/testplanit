// Use compiled JavaScript in production, tsx in development
const isDev = process.env.NODE_ENV !== "production";

// Node's heap gets 75% of a worker's PM2 restart ceiling, leaving the rest for
// buffers and native memory.
const HEAP_RATIO = 0.75;

/** A PM2 size ("512M", "2G", or bare bytes) in megabytes; null if unreadable. */
function toMegabytes(size) {
  const match = /^(\d+(?:\.\d+)?)\s*([KMG])?$/i.exec(String(size).trim());
  if (!match) return null;
  const value = Number(match[1]);
  const unit = (match[2] || "").toUpperCase();
  if (unit === "G") return value * 1024;
  if (unit === "M") return value;
  if (unit === "K") return value / 1024;
  return value / (1024 * 1024);
}

/**
 * PM2 restart ceiling and Node heap for one worker. Env overrides, most
 * specific first:
 *   <prefix>_MAX_MEMORY_RESTART / <prefix>_MAX_OLD_SPACE_MB — this worker
 *   WORKER_MAX_MEMORY_RESTART / WORKER_MAX_OLD_SPACE_MB — every `shared` worker
 * The heap defaults to 75% of whichever restart ceiling applies, so setting a
 * ceiling alone is enough. A heap set at a broader level than the ceiling is
 * ignored, so raising one worker never pairs its ceiling with another's heap.
 */
function memoryLimits(defaultRestart, { prefix, shared = false } = {}) {
  const read = (name) => process.env[name] || undefined;
  const levels = [];
  if (prefix) {
    levels.push({
      restart: read(`${prefix}_MAX_MEMORY_RESTART`),
      heap: read(`${prefix}_MAX_OLD_SPACE_MB`),
    });
  }
  if (shared) {
    levels.push({
      restart: read("WORKER_MAX_MEMORY_RESTART"),
      heap: read("WORKER_MAX_OLD_SPACE_MB"),
    });
  }

  const restartLevel = levels.findIndex((level) => level.restart);
  let restart =
    restartLevel === -1 ? defaultRestart : levels[restartLevel].restart;
  if (toMegabytes(restart) === null) {
    console.warn(
      `[ecosystem] Ignoring unreadable memory ceiling "${restart}"; using ${defaultRestart}.`
    );
    restart = defaultRestart;
  }

  const candidates =
    restartLevel === -1 ? levels : levels.slice(0, restartLevel + 1);
  const heapSetting = candidates.map((level) => level.heap).find(Boolean);
  const heapMb =
    Number(heapSetting) > 0
      ? Math.floor(Number(heapSetting))
      : Math.floor(toMegabytes(restart) * HEAP_RATIO);

  return {
    max_memory_restart: restart,
    node_args: `--max-old-space-size=${heapMb}`,
  };
}

module.exports = {
  apps: [
    {
      name: "scheduler",
      script: isDev ? "tsx" : "node",
      args: isDev ? "scheduler.ts" : "dist/scheduler.js",
      instances: 1,
      autorestart: false,
      watch: false,
      ...memoryLimits("512M", { shared: true }),
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
      ...memoryLimits("512M", { shared: true }),
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
      ...memoryLimits("512M", { shared: true }),
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
      ...memoryLimits("2G"),
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
      // can raise it via env (host RAM permitting), e.g.
      // TESTMO_IMPORT_MAX_MEMORY_RESTART=18G.
      ...memoryLimits("4G", { prefix: "TESTMO_IMPORT" }),
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
      ...memoryLimits("1G"),
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
      // can raise it via env (host RAM permitting), e.g.
      // ELASTICSEARCH_REINDEX_MAX_MEMORY_RESTART=4G.
      ...memoryLimits("2G", { prefix: "ELASTICSEARCH_REINDEX" }),
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
      ...memoryLimits("3G"),
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
      ...memoryLimits("512M", { shared: true }),
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
      ...memoryLimits("512M", { shared: true }),
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
      ...memoryLimits("512M", { shared: true }),
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
      // A refresh holds a repository's whole archive and its cached file
      // contents in memory at once. The 512M default suits typical repositories;
      // installs caching very large ones can raise it via env (host RAM
      // permitting), e.g. REPO_CACHE_MAX_MEMORY_RESTART=2G.
      ...memoryLimits("512M", { prefix: "REPO_CACHE", shared: true }),
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
      ...memoryLimits("512M", { shared: true }),
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
      ...memoryLimits("512M", { shared: true }),
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
      ...memoryLimits("512M", { shared: true }),
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "impact-analysis-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/impactAnalysisWorker.ts"
        : "dist/workers/impactAnalysisWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      ...memoryLimits("512M", { shared: true }),
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
      ...memoryLimits("512M", { shared: true }),
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
      ...memoryLimits("512M", { shared: true }),
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
      ...memoryLimits("512M", { shared: true }),
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
      ...memoryLimits("2G"),
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
      ...memoryLimits("3G"),
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
      ...memoryLimits("3G"),
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
      ...memoryLimits("3G"),
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
      ...memoryLimits("3G"),
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "dataset-lease-sweep-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/datasetLeaseSweepWorker.ts"
        : "dist/workers/datasetLeaseSweepWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      ...memoryLimits("3G"),
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "execution-dispatch-worker",
      script: isDev ? "tsx" : "node",
      args: isDev
        ? "workers/executionDispatchWorker.ts"
        : "dist/workers/executionDispatchWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      ...memoryLimits("3G"),
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
