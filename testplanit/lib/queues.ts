import { Queue } from "bullmq";
import valkeyConnection from "./valkey";
import {
  FORECAST_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  EMAIL_QUEUE_NAME,
  SYNC_QUEUE_NAME,
  TESTMO_IMPORT_QUEUE_NAME,
  ELASTICSEARCH_REINDEX_QUEUE_NAME,
} from "./queueNames";

// Re-export queue names for backward compatibility
export {
  FORECAST_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  EMAIL_QUEUE_NAME,
  SYNC_QUEUE_NAME,
  TESTMO_IMPORT_QUEUE_NAME,
  ELASTICSEARCH_REINDEX_QUEUE_NAME,
};

let forecastQueue: Queue | null = null;
let notificationQueue: Queue | null = null;
let emailQueue: Queue | null = null;
let syncQueue: Queue | null = null;
let testmoImportQueue: Queue | null = null;
let elasticsearchReindexQueue: Queue | null = null;

// Initialize queue only if Valkey connection exists
if (valkeyConnection) {
  // Create and export the forecast queue instance
  forecastQueue = new Queue(FORECAST_QUEUE_NAME, {
    connection: valkeyConnection,
    defaultJobOptions: {
      // Configuration for jobs in this queue (optional)
      attempts: 3, // Number of times to retry a failed job
      backoff: {
        type: "exponential", // Exponential backoff strategy
        delay: 5000, // Initial delay 5s
      },
      removeOnComplete: {
        age: 3600 * 24 * 7, // keep up to 7 days
        count: 1000, // keep up to 1000 jobs
      },
      removeOnFail: {
        age: 3600 * 24 * 14, // keep up to 14 days
      },
    },
  });

  console.log(`Queue "${FORECAST_QUEUE_NAME}" initialized.`);

  // Optional: Add basic event listeners for logging/monitoring
  forecastQueue.on("error", (error) => {
    console.error(`Queue ${FORECAST_QUEUE_NAME} error:`, error);
  });
} else {
  console.warn(
    `Valkey connection not available, Queue "${FORECAST_QUEUE_NAME}" not initialized.`
  );
}

// Initialize notification queue
if (valkeyConnection) {
  notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, {
    connection: valkeyConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: {
        age: 3600 * 24 * 7, // keep up to 7 days
        count: 1000,
      },
      removeOnFail: {
        age: 3600 * 24 * 14, // keep up to 14 days
      },
    },
  });

  console.log(`Queue "${NOTIFICATION_QUEUE_NAME}" initialized.`);

  notificationQueue.on("error", (error) => {
    console.error(`Queue ${NOTIFICATION_QUEUE_NAME} error:`, error);
  });
} else {
  console.warn(
    `Valkey connection not available, Queue "${NOTIFICATION_QUEUE_NAME}" not initialized.`
  );
}

// Initialize email queue
if (valkeyConnection) {
  emailQueue = new Queue(EMAIL_QUEUE_NAME, {
    connection: valkeyConnection,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 10000,
      },
      removeOnComplete: {
        age: 3600 * 24 * 30, // keep up to 30 days
        count: 5000,
      },
      removeOnFail: {
        age: 3600 * 24 * 30, // keep up to 30 days
      },
    },
  });

  console.log(`Queue "${EMAIL_QUEUE_NAME}" initialized.`);

  emailQueue.on("error", (error) => {
    console.error(`Queue ${EMAIL_QUEUE_NAME} error:`, error);
  });
} else {
  console.warn(
    `Valkey connection not available, Queue "${EMAIL_QUEUE_NAME}" not initialized.`
  );
}

// Initialize sync queue
if (valkeyConnection) {
  syncQueue = new Queue(SYNC_QUEUE_NAME, {
    connection: valkeyConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: {
        age: 3600 * 24 * 3, // keep up to 3 days
        count: 500,
      },
      removeOnFail: {
        age: 3600 * 24 * 7, // keep up to 7 days
      },
    },
  });

  console.log(`Queue "${SYNC_QUEUE_NAME}" initialized.`);

  syncQueue.on("error", (error) => {
    console.error(`Queue ${SYNC_QUEUE_NAME} error:`, error);
  });
} else {
  console.warn(
    `Valkey connection not available, Queue "${SYNC_QUEUE_NAME}" not initialized.`
  );
}

// Initialize Testmo import queue
if (valkeyConnection) {
  testmoImportQueue = new Queue(TESTMO_IMPORT_QUEUE_NAME, {
    connection: valkeyConnection,
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

  testmoImportQueue.on("error", (error) => {
    console.error(`Queue ${TESTMO_IMPORT_QUEUE_NAME} error:`, error);
  });
} else {
  console.warn(
    `Valkey connection not available, Queue "${TESTMO_IMPORT_QUEUE_NAME}" not initialized.`
  );
}

// Initialize Elasticsearch reindex queue
if (valkeyConnection) {
  elasticsearchReindexQueue = new Queue(ELASTICSEARCH_REINDEX_QUEUE_NAME, {
    connection: valkeyConnection,
    defaultJobOptions: {
      attempts: 1, // Don't retry reindex jobs automatically
      removeOnComplete: {
        age: 3600 * 24 * 7, // keep up to 7 days
        count: 50,
      },
      removeOnFail: {
        age: 3600 * 24 * 14, // keep up to 14 days
      },
    },
  });

  console.log(`Queue "${ELASTICSEARCH_REINDEX_QUEUE_NAME}" initialized.`);

  elasticsearchReindexQueue.on("error", (error) => {
    console.error(`Queue ${ELASTICSEARCH_REINDEX_QUEUE_NAME} error:`, error);
  });
} else {
  console.warn(
    `Valkey connection not available, Queue "${ELASTICSEARCH_REINDEX_QUEUE_NAME}" not initialized.`
  );
}

// Export the potentially null queues
export { forecastQueue, notificationQueue, emailQueue, syncQueue, testmoImportQueue, elasticsearchReindexQueue };
