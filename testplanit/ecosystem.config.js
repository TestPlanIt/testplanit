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
      max_memory_restart: '1G',
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
      max_memory_restart: '1G',
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
      max_memory_restart: '1G',
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
      max_memory_restart: '4G',
      node_args: '--max-old-space-size=3072',
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
      max_memory_restart: '10G',
      node_args: '--max-old-space-size=8192',
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
      max_memory_restart: '4G',
      node_args: '--max-old-space-size=3072',
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
      max_memory_restart: '4G',
      node_args: '--max-old-space-size=3072',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};