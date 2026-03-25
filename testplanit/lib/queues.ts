import { Queue } from "bullmq";
import {
  AUDIT_LOG_QUEUE_NAME, AUTO_TAG_QUEUE_NAME, BUDGET_ALERT_QUEUE_NAME, COPY_MOVE_QUEUE_NAME, DUPLICATE_SCAN_QUEUE_NAME, ELASTICSEARCH_REINDEX_QUEUE_NAME, EMAIL_QUEUE_NAME, FORECAST_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME, REPO_CACHE_QUEUE_NAME, STEP_SCAN_QUEUE_NAME, SYNC_QUEUE_NAME,
  TESTMO_IMPORT_QUEUE_NAME
} from "./queueNames";
import valkeyConnection from "./valkey";

// Re-export queue names for backward compatibility
export {
  FORECAST_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  EMAIL_QUEUE_NAME,
  SYNC_QUEUE_NAME,
  TESTMO_IMPORT_QUEUE_NAME,
  ELASTICSEARCH_REINDEX_QUEUE_NAME,
  AUDIT_LOG_QUEUE_NAME,
  BUDGET_ALERT_QUEUE_NAME,
  AUTO_TAG_QUEUE_NAME,
  REPO_CACHE_QUEUE_NAME,
  COPY_MOVE_QUEUE_NAME,
  DUPLICATE_SCAN_QUEUE_NAME,
  STEP_SCAN_QUEUE_NAME,
};

// Lazy-initialized queue instances
let _forecastQueue: Queue | null = null;
let _notificationQueue: Queue | null = null;
let _emailQueue: Queue | null = null;
let _syncQueue: Queue | null = null;
let _testmoImportQueue: Queue | null = null;
let _elasticsearchReindexQueue: Queue | null = null;
let _auditLogQueue: Queue | null = null;
let _budgetAlertQueue: Queue | null = null;
let _autoTagQueue: Queue | null = null;
let _repoCacheQueue: Queue | null = null;
let _copyMoveQueue: Queue | null = null;
let _duplicateScanQueue: Queue | null = null;
let _stepScanQueue: Queue | null = null;

/**
 * Get the forecast queue instance (lazy initialization)
 * Only creates the queue when first accessed
 */
export function getForecastQueue(): Queue | null {
  if (_forecastQueue) return _forecastQueue;
  if (!valkeyConnection) {
    console.warn(
      `Valkey connection not available, Queue "${FORECAST_QUEUE_NAME}" not initialized.`
    );
    return null;
  }

  _forecastQueue = new Queue(FORECAST_QUEUE_NAME, {
    connection: valkeyConnection as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: {
        age: 3600 * 24 * 7,
        count: 1000,
      },
      removeOnFail: {
        age: 3600 * 24 * 14,
      },
    },
  });

  console.log(`Queue "${FORECAST_QUEUE_NAME}" initialized.`);

  _forecastQueue.on("error", (error) => {
    console.error(`Queue ${FORECAST_QUEUE_NAME} error:`, error);
  });

  return _forecastQueue;
}

/**
 * Get the notification queue instance (lazy initialization)
 */
export function getNotificationQueue(): Queue | null {
  if (_notificationQueue) return _notificationQueue;
  if (!valkeyConnection) {
    console.warn(
      `Valkey connection not available, Queue "${NOTIFICATION_QUEUE_NAME}" not initialized.`
    );
    return null;
  }

  _notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, {
    connection: valkeyConnection as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: {
        age: 3600 * 24 * 7,
        count: 1000,
      },
      removeOnFail: {
        age: 3600 * 24 * 14,
      },
    },
  });

  console.log(`Queue "${NOTIFICATION_QUEUE_NAME}" initialized.`);

  _notificationQueue.on("error", (error) => {
    console.error(`Queue ${NOTIFICATION_QUEUE_NAME} error:`, error);
  });

  return _notificationQueue;
}

/**
 * Get the email queue instance (lazy initialization)
 */
export function getEmailQueue(): Queue | null {
  if (_emailQueue) return _emailQueue;
  if (!valkeyConnection) {
    console.warn(
      `Valkey connection not available, Queue "${EMAIL_QUEUE_NAME}" not initialized.`
    );
    return null;
  }

  _emailQueue = new Queue(EMAIL_QUEUE_NAME, {
    connection: valkeyConnection as any,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 10000,
      },
      removeOnComplete: {
        age: 3600 * 24 * 30,
        count: 5000,
      },
      removeOnFail: {
        age: 3600 * 24 * 30,
      },
    },
  });

  console.log(`Queue "${EMAIL_QUEUE_NAME}" initialized.`);

  _emailQueue.on("error", (error) => {
    console.error(`Queue ${EMAIL_QUEUE_NAME} error:`, error);
  });

  return _emailQueue;
}

/**
 * Get the sync queue instance (lazy initialization)
 */
export function getSyncQueue(): Queue | null {
  if (_syncQueue) return _syncQueue;
  if (!valkeyConnection) {
    console.warn(
      `Valkey connection not available, Queue "${SYNC_QUEUE_NAME}" not initialized.`
    );
    return null;
  }

  _syncQueue = new Queue(SYNC_QUEUE_NAME, {
    connection: valkeyConnection as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: {
        age: 3600 * 24 * 3,
        count: 500,
      },
      removeOnFail: {
        age: 3600 * 24 * 7,
      },
    },
  });

  console.log(`Queue "${SYNC_QUEUE_NAME}" initialized.`);

  _syncQueue.on("error", (error) => {
    console.error(`Queue ${SYNC_QUEUE_NAME} error:`, error);
  });

  return _syncQueue;
}

/**
 * Get the Testmo import queue instance (lazy initialization)
 */
export function getTestmoImportQueue(): Queue | null {
  if (_testmoImportQueue) return _testmoImportQueue;
  if (!valkeyConnection) {
    console.warn(
      `Valkey connection not available, Queue "${TESTMO_IMPORT_QUEUE_NAME}" not initialized.`
    );
    return null;
  }

  _testmoImportQueue = new Queue(TESTMO_IMPORT_QUEUE_NAME, {
    connection: valkeyConnection as any,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: {
        age: 3600 * 24 * 30,
        count: 100,
      },
      removeOnFail: {
        age: 3600 * 24 * 30,
      },
    },
  });

  console.log(`Queue "${TESTMO_IMPORT_QUEUE_NAME}" initialized.`);

  _testmoImportQueue.on("error", (error) => {
    console.error(`Queue ${TESTMO_IMPORT_QUEUE_NAME} error:`, error);
  });

  return _testmoImportQueue;
}

/**
 * Get the Elasticsearch reindex queue instance (lazy initialization)
 */
export function getElasticsearchReindexQueue(): Queue | null {
  if (_elasticsearchReindexQueue) return _elasticsearchReindexQueue;
  if (!valkeyConnection) {
    console.warn(
      `Valkey connection not available, Queue "${ELASTICSEARCH_REINDEX_QUEUE_NAME}" not initialized.`
    );
    return null;
  }

  _elasticsearchReindexQueue = new Queue(ELASTICSEARCH_REINDEX_QUEUE_NAME, {
    connection: valkeyConnection as any,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: {
        age: 3600 * 24 * 7,
        count: 50,
      },
      removeOnFail: {
        age: 3600 * 24 * 14,
      },
    },
  });

  console.log(`Queue "${ELASTICSEARCH_REINDEX_QUEUE_NAME}" initialized.`);

  _elasticsearchReindexQueue.on("error", (error) => {
    console.error(`Queue ${ELASTICSEARCH_REINDEX_QUEUE_NAME} error:`, error);
  });

  return _elasticsearchReindexQueue;
}

/**
 * Get the audit log queue instance (lazy initialization)
 * Used for async audit log processing to avoid blocking mutations
 */
export function getAuditLogQueue(): Queue | null {
  if (_auditLogQueue) return _auditLogQueue;
  if (!valkeyConnection) {
    console.warn(
      `Valkey connection not available, Queue "${AUDIT_LOG_QUEUE_NAME}" not initialized.`
    );
    return null;
  }

  _auditLogQueue = new Queue(AUDIT_LOG_QUEUE_NAME, {
    connection: valkeyConnection as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      // Long retention for audit logs - keep completed jobs for 1 year
      removeOnComplete: {
        age: 3600 * 24 * 365, // 1 year
        count: 100000,
      },
      // Keep failed jobs for investigation
      removeOnFail: {
        age: 3600 * 24 * 90, // 90 days
      },
    },
  });

  console.log(`Queue "${AUDIT_LOG_QUEUE_NAME}" initialized.`);

  _auditLogQueue.on("error", (error) => {
    console.error(`Queue ${AUDIT_LOG_QUEUE_NAME} error:`, error);
  });

  return _auditLogQueue;
}

/**
 * Get the budget alert queue instance (lazy initialization)
 * Used for async budget threshold checking after LLM usage
 */
export function getBudgetAlertQueue(): Queue | null {
  if (_budgetAlertQueue) return _budgetAlertQueue;
  if (!valkeyConnection) {
    console.warn(
      `Valkey connection not available, Queue "${BUDGET_ALERT_QUEUE_NAME}" not initialized.`
    );
    return null;
  }

  _budgetAlertQueue = new Queue(BUDGET_ALERT_QUEUE_NAME, {
    connection: valkeyConnection as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: {
        age: 3600 * 24 * 7, // 7 days
        count: 1000,
      },
      removeOnFail: {
        age: 3600 * 24 * 14, // 14 days
      },
    },
  });

  console.log(`Queue "${BUDGET_ALERT_QUEUE_NAME}" initialized.`);

  _budgetAlertQueue.on("error", (error) => {
    console.error(`Queue ${BUDGET_ALERT_QUEUE_NAME} error:`, error);
  });

  return _budgetAlertQueue;
}

/**
 * Get the auto-tag queue instance (lazy initialization)
 * Used for AI-powered tag suggestion jobs
 */
export function getAutoTagQueue(): Queue | null {
  if (_autoTagQueue) return _autoTagQueue;
  if (!valkeyConnection) {
    console.warn(
      `Valkey connection not available, Queue "${AUTO_TAG_QUEUE_NAME}" not initialized.`
    );
    return null;
  }

  _autoTagQueue = new Queue(AUTO_TAG_QUEUE_NAME, {
    connection: valkeyConnection as any,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: {
        age: 3600 * 24, // 24 hours
        count: 100,
      },
      removeOnFail: {
        age: 3600 * 24 * 7, // 7 days
      },
    },
  });

  console.log(`Queue "${AUTO_TAG_QUEUE_NAME}" initialized.`);

  _autoTagQueue.on("error", (error) => {
    console.error(`Queue ${AUTO_TAG_QUEUE_NAME} error:`, error);
  });

  return _autoTagQueue;
}

/**
 * Get the repo cache queue instance (lazy initialization)
 * Used for automatic code repository cache refresh jobs
 */
export function getRepoCacheQueue(): Queue | null {
  if (_repoCacheQueue) return _repoCacheQueue;
  if (!valkeyConnection) {
    console.warn(
      `Valkey connection not available, Queue "${REPO_CACHE_QUEUE_NAME}" not initialized.`
    );
    return null;
  }

  _repoCacheQueue = new Queue(REPO_CACHE_QUEUE_NAME, {
    connection: valkeyConnection as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 10000,
      },
      removeOnComplete: {
        age: 3600 * 24 * 7, // 7 days
        count: 1000,
      },
      removeOnFail: {
        age: 3600 * 24 * 14, // 14 days
      },
    },
  });

  console.log(`Queue "${REPO_CACHE_QUEUE_NAME}" initialized.`);

  _repoCacheQueue.on("error", (error) => {
    console.error(`Queue ${REPO_CACHE_QUEUE_NAME} error:`, error);
  });

  return _repoCacheQueue;
}

/**
 * Get the copy-move queue instance (lazy initialization)
 * Used for cross-project test case copy and move operations.
 * attempts: 1 — no retry; partial retries on copy/move create duplicate cases.
 * concurrency: 1 — enforced at the worker level to prevent ZenStack v3 deadlocks.
 */
export function getCopyMoveQueue(): Queue | null {
  if (_copyMoveQueue) return _copyMoveQueue;
  if (!valkeyConnection) {
    console.warn(
      `Valkey connection not available, Queue "${COPY_MOVE_QUEUE_NAME}" not initialized.`
    );
    return null;
  }
  _copyMoveQueue = new Queue(COPY_MOVE_QUEUE_NAME, {
    connection: valkeyConnection as any,
    defaultJobOptions: {
      attempts: 1, // LOCKED: no retry - partial retry creates duplicates
      removeOnComplete: { age: 3600 * 24 * 7, count: 500 },
      removeOnFail: { age: 3600 * 24 * 14 },
    },
  });
  console.log(`Queue "${COPY_MOVE_QUEUE_NAME}" initialized.`);
  _copyMoveQueue.on("error", (error) => {
    console.error(`Queue ${COPY_MOVE_QUEUE_NAME} error:`, error);
  });
  return _copyMoveQueue;
}

/**
 * Get the duplicate scan queue instance (lazy initialization)
 * Used for background duplicate detection scanning jobs
 */
export function getDuplicateScanQueue(): Queue | null {
  if (_duplicateScanQueue) return _duplicateScanQueue;
  if (!valkeyConnection) {
    console.warn(
      `Valkey connection not available, Queue "${DUPLICATE_SCAN_QUEUE_NAME}" not initialized.`
    );
    return null;
  }

  _duplicateScanQueue = new Queue(DUPLICATE_SCAN_QUEUE_NAME, {
    connection: valkeyConnection as any,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 3600 * 24, count: 100 },
      removeOnFail: { age: 3600 * 24 * 7 },
    },
  });

  console.log(`Queue "${DUPLICATE_SCAN_QUEUE_NAME}" initialized.`);

  _duplicateScanQueue.on("error", (error) => {
    console.error(`Queue ${DUPLICATE_SCAN_QUEUE_NAME} error:`, error);
  });

  return _duplicateScanQueue;
}

/**
 * Get the step-scan queue instance (lazy initialization)
 * Used for background step sequence scan jobs.
 * attempts: 1 — no retry; user retries from UI.
 * concurrency: 1 — enforced at the worker level to prevent ZenStack v3 deadlocks.
 */
export function getStepScanQueue(): Queue | null {
  if (_stepScanQueue) return _stepScanQueue;
  if (!valkeyConnection) {
    console.warn(
      `Valkey connection not available, Queue "${STEP_SCAN_QUEUE_NAME}" not initialized.`
    );
    return null;
  }
  _stepScanQueue = new Queue(STEP_SCAN_QUEUE_NAME, {
    connection: valkeyConnection as any,
    defaultJobOptions: {
      attempts: 1, // LOCKED: no retry — user retries from UI
      removeOnComplete: { age: 3600 * 24 * 7, count: 500 },
      removeOnFail: { age: 3600 * 24 * 14 },
    },
  });
  console.log(`Queue "${STEP_SCAN_QUEUE_NAME}" initialized.`);
  _stepScanQueue.on("error", (error) => {
    console.error(`Queue ${STEP_SCAN_QUEUE_NAME} error:`, error);
  });
  return _stepScanQueue;
}

/**
 * Get all queues (initializes all of them)
 * Use this only when you need access to all queues (e.g., admin dashboard)
 */
export function getAllQueues() {
  return {
    forecastQueue: getForecastQueue(),
    notificationQueue: getNotificationQueue(),
    emailQueue: getEmailQueue(),
    syncQueue: getSyncQueue(),
    testmoImportQueue: getTestmoImportQueue(),
    elasticsearchReindexQueue: getElasticsearchReindexQueue(),
    auditLogQueue: getAuditLogQueue(),
    budgetAlertQueue: getBudgetAlertQueue(),
    autoTagQueue: getAutoTagQueue(),
    repoCacheQueue: getRepoCacheQueue(),
    copyMoveQueue: getCopyMoveQueue(),
    duplicateScanQueue: getDuplicateScanQueue(),
    stepScanQueue: getStepScanQueue(),
  };
}
