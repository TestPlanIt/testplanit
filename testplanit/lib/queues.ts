import { Queue } from "bullmq";
import valkeyConnection from "./valkey";
import type IORedis from "ioredis";
import {
  FORECAST_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  EMAIL_QUEUE_NAME,
  SYNC_QUEUE_NAME,
  TESTMO_IMPORT_QUEUE_NAME,
  ELASTICSEARCH_REINDEX_QUEUE_NAME,
  AUDIT_LOG_QUEUE_NAME,
} from "./queueNames";

// Re-export queue names for backward compatibility
export {
  FORECAST_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  EMAIL_QUEUE_NAME,
  SYNC_QUEUE_NAME,
  TESTMO_IMPORT_QUEUE_NAME,
  ELASTICSEARCH_REINDEX_QUEUE_NAME,
  AUDIT_LOG_QUEUE_NAME,
};

// Lazy-initialized queue instances
let _forecastQueue: Queue | null = null;
let _notificationQueue: Queue | null = null;
let _emailQueue: Queue | null = null;
let _syncQueue: Queue | null = null;
let _testmoImportQueue: Queue | null = null;
let _elasticsearchReindexQueue: Queue | null = null;
let _auditLogQueue: Queue | null = null;

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
    connection: valkeyConnection as IORedis,
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
    connection: valkeyConnection as IORedis,
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
    connection: valkeyConnection as IORedis,
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
    connection: valkeyConnection as IORedis,
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
    connection: valkeyConnection as IORedis,
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
    connection: valkeyConnection as IORedis,
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
    connection: valkeyConnection as IORedis,
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
  };
}
