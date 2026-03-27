// Use compiled JavaScript in production, tsx in development
const isDev = process.env.NODE_ENV !== 'production';

module.exports = {
  apps: [
    {
      name: 'scheduler',
      script: isDev ? 'tsx' : 'node',
      args: isDev ? 'scheduler.ts' : 'dist/scheduler.js',
      instances: 1,
      autorestart: false,
      watch: false,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'notification-worker',
      script: isDev ? 'tsx' : 'node',
      args: isDev ? 'workers/notificationWorker.ts' : 'dist/workers/notificationWorker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'email-worker',
      script: isDev ? 'tsx' : 'node',
      args: isDev ? 'workers/emailWorker.ts' : 'dist/workers/emailWorker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'forecast-worker',
      script: isDev ? 'tsx' : 'node',
      args: isDev ? 'workers/forecastWorker.ts' : 'dist/workers/forecastWorker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'testmo-import-worker',
      script: isDev ? 'tsx' : 'node',
      args: isDev ? 'workers/testmoImportWorker.ts' : 'dist/workers/testmoImportWorker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'sync-worker',
      script: isDev ? 'tsx' : 'node',
      args: isDev ? 'workers/syncWorker.ts' : 'dist/workers/syncWorker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      node_args: '--max-old-space-size=768',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'elasticsearch-reindex-worker',
      script: isDev ? 'tsx' : 'node',
      args: isDev ? 'workers/elasticsearchReindexWorker.ts' : 'dist/workers/elasticsearchReindexWorker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'audit-log-worker',
      script: isDev ? 'tsx' : 'node',
      args: isDev ? 'workers/auditLogWorker.ts' : 'dist/workers/auditLogWorker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'budget-alert-worker',
      script: isDev ? 'tsx' : 'node',
      args: isDev ? 'workers/budgetAlertWorker.ts' : 'dist/workers/budgetAlertWorker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'auto-tag-worker',
      script: isDev ? 'tsx' : 'node',
      args: isDev ? 'workers/autoTagWorker.ts' : 'dist/workers/autoTagWorker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'repo-cache-worker',
      script: isDev ? 'tsx' : 'node',
      args: isDev ? 'workers/repoCacheWorker.ts' : 'dist/workers/repoCacheWorker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'copy-move-worker',
      script: isDev ? 'tsx' : 'node',
      args: isDev ? 'workers/copyMoveWorker.ts' : 'dist/workers/copyMoveWorker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'duplicate-scan-worker',
      script: isDev ? 'tsx' : 'node',
      args: isDev ? 'workers/duplicateScanWorker.ts' : 'dist/workers/duplicateScanWorker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'magic-select-worker',
      script: isDev ? 'tsx' : 'node',
      args: isDev ? 'workers/magicSelectWorker.ts' : 'dist/workers/magicSelectWorker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'step-scan-worker',
      script: isDev ? 'tsx' : 'node',
      args: isDev ? 'workers/stepSequenceScanWorker.ts' : 'dist/workers/stepSequenceScanWorker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};